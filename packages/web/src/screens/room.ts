import {
  accepts, canDelete, formatKey, itemName, MEMO_MAX, NAME_MAX, seasonById,
  type C2S, type Placement, type RoomSnapshot, type S2C, type Slot, type TreeSnapshot,
} from '@deulleotdagam/shared';
import { api, ApiFailure, NETWORK_MESSAGE, wsUrl } from '../api';
import { backgroundPickerHtml, esc, itemSvg, stringSvg, treeArtSvg } from '../render/scene';
import { navigate } from '../router';
import { openShareDialog } from '../share';
import * as store from '../storage';
import { loadBackground, themeAssets, type ThemeAssets } from '../theme';
import { $, closeAllDialogs, closeDialog, copyText, openDialog, toast, topDialog } from '../ui/dom';
import { noticeScreen } from './notice';

type Me = { guestId: string; isOwner: boolean; name: string };
type Source = { code: string } | { archiveRoomId: string };

const RECONNECT_MAX_MS = 15_000;
const PING_MS = 45_000;

export function roomScreen(root: HTMLElement, source: Source): () => void {
  let alive = true;
  let theme: ThemeAssets = themeAssets('pixel');
  let snap: RoomSnapshot | null = null;
  let me: Me | null = null;
  let roomId = '';
  let readonly = 'archiveRoomId' in source;
  let ws: WebSocket | null = null;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let everConnected = false;
  const pendingPlace = new Set<string>();
  const pendingRemove = new Set<string>();

  const key = (treeId: string, slotId: string) => `${treeId}:${slotId}`;
  const treeOf = (id: string) => snap!.trees.find(t => t.id === id)!;
  const slotOf = (k: string): [TreeSnapshot, Slot] => {
    const [tid, sid] = k.split(':');
    const t = treeOf(tid);
    return [t, t.slots.find(s => s.id === sid)!];
  };
  const placementAt = (treeId: string, slotId: string) => snap!.placements.find(p => p.treeId === treeId && p.slotId === slotId);
  const totalSlots = () => snap!.trees.reduce((n, t) => n + t.slots.length, 0);
  const nameOf = (guestId: string) => {
    const n = snap!.guests[guestId] || '손님';
    return guestId === snap!.ownerGuestId && n !== '방장' ? `${n}(방장)` : n;
  };
  const isMine = (p: Placement) => !!me && p.authorId === me.guestId;
  const iname = (id: string) => itemName(theme.geometry, id);

  root.innerHTML = `<main class="notice"><div class="card"><h3>방에 들어가는 중…</h3><p>잠시만 기다려 주세요.</p></div></main>`;

  function showNotice(title: string, body: string, icon?: string) {
    stop();
    document.body.classList.remove('room-mode');
    noticeScreen(root, { title, body, icon });
  }

  // ---------- 연결 ----------

  async function start() {
    if ('archiveRoomId' in source) {
      try {
        snap = await api.archivedSnapshot(source.archiveRoomId);
        roomId = snap.roomId;
        theme = themeAssets(snap.themeId);
        mount();
      } catch (x) {
        showNotice('둘러볼 수 없는 방이에요', x instanceof ApiFailure ? x.message : NETWORK_MESSAGE);
      }
      return;
    }
    try {
      const j = await api.join(source.code);
      if (!alive) return;
      roomId = j.roomId;
      if (j.joinCode !== source.code) history.replaceState(null, '', `/r/${j.joinCode}`);
      connect();
    } catch (x) {
      if (!(x instanceof ApiFailure)) throw x;
      if (x.code === 'NOT_FOUND') store.recentRooms.remove(source.code);
      showNotice(x.code === 'DISABLED' ? '잠시 닫아 둔 방이에요' : x.code === 'NOT_FOUND' ? '방을 찾을 수 없어요' : '들어갈 수 없어요',
        x.code === 'DISABLED' ? '신고가 여러 번 들어와 관리자가 확인하고 있어요.' : x.message);
    }
  }

  function connect() {
    if (!alive) return;
    const sock = new WebSocket(wsUrl(roomId));
    ws = sock;
    sock.onopen = () => {
      // 방장 키는 URL이 아니라 첫 메시지 본문으로 보낸다
      const hello: C2S = { t: 'hello', guestToken: store.guestToken.get(roomId) ?? undefined, ownerKey: store.ownerKey.get(roomId) ?? undefined };
      sock.send(JSON.stringify(hello));
    };
    sock.onmessage = e => { try { onMessage(JSON.parse(e.data) as S2C); } catch (err) { console.error(err); } };
    sock.onclose = e => {
      if (ws !== sock || !alive) return;
      ws = null;
      clearInterval(pingTimer);
      if (e.code === 4000) return; // roomDeleted 메시지에서 처리
      if (e.code === 4003) return showNotice('잠시 닫아 둔 방이에요', '신고가 여러 번 들어와 관리자가 확인하고 있어요.');
      if (e.code === 4004) return showNotice('방을 찾을 수 없어요', '방장이 방을 삭제했을 수도 있어요.');
      setConn(true);
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** retry++);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => {
      // 몇 번 실패하면 방이 없어졌거나 닫혔는지 확인
      if (retry >= 3 && 'code' in source) {
        try { await api.join(snap?.joinCode ?? source.code); } catch (x) {
          if (x instanceof ApiFailure && (x.code === 'NOT_FOUND' || x.code === 'DISABLED'))
            return showNotice(x.code === 'DISABLED' ? '잠시 닫아 둔 방이에요' : '방을 찾을 수 없어요', x.message);
        }
      }
      connect();
    }, delay);
  }

  /** 변경분을 놓쳤으면 다시 연결해 스냅샷을 새로 받는다 */
  function resync() {
    const old = ws;
    ws = null;
    old?.close(1000, 'resync');
    connect();
  }

  function send(msg: C2S): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN || !me) { toast('연결 중이에요. 잠시 뒤에 다시 해 주세요'); return false; }
    ws.send(JSON.stringify(msg));
    return true;
  }

  function stop() {
    alive = false;
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    const s = ws; ws = null;
    s?.close(1000, 'leave');
  }

  function onMessage(m: S2C) {
    if (m.t === 'welcome') {
      const first = !snap;
      snap = m.snapshot;
      me = m.me;
      theme = themeAssets(snap.themeId);
      readonly = snap.status !== 'active';
      if (m.guestToken) store.guestToken.set(roomId, m.guestToken);
      const sentKey = store.ownerKey.get(roomId);
      if (sentKey && !m.me.isOwner) { store.ownerKey.set(roomId, null); toast('방장 ID가 맞지 않아 참여자로 들어왔어요'); }
      store.recentRooms.add({ joinCode: snap.joinCode, title: snap.title, owner: m.me.isOwner });
      retry = 0;
      everConnected = true;
      pendingPlace.clear(); pendingRemove.clear();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}'); }, PING_MS);
      mount();
      setConn(false);
      if (first && me.isOwner && store.justCreated.get(roomId)) openIntro();
      return;
    }
    if (!snap) return;
    if ('rev' in m && typeof m.rev === 'number') {
      if (m.rev !== snap.rev + 1) { if (m.rev > snap.rev) resync(); return; }
      snap.rev = m.rev;
    }
    switch (m.t) {
      case 'placed': {
        const p = m.placement;
        snap.placements = snap.placements.filter(x => !(x.treeId === p.treeId && x.slotId === p.slotId));
        snap.placements.push(p);
        if (m.authorName) snap.guests[p.authorId] = m.authorName;
        const k = key(p.treeId, p.slotId);
        const wasCompleted = !!snap.completedAt;
        snap.completedAt = m.completedAt;
        updateSlot(p.treeId, p.slotId, true);
        if (pendingPlace.delete(k)) toast(`${iname(p.itemId)}을(를) 달았어요`);
        if (!wasCompleted && m.completedAt && snap.placements.length === totalSlots()) toast('세 그루 모두 완성됐어요!', 3000);
        break;
      }
      case 'removed': {
        const k = key(m.treeId, m.slotId);
        const p = placementAt(m.treeId, m.slotId);
        snap.placements = snap.placements.filter(x => !(x.treeId === m.treeId && x.slotId === m.slotId));
        updateSlot(m.treeId, m.slotId);
        if (pendingRemove.delete(k) && p) toast(`${iname(p.itemId)}을(를) 뗐어요`);
        if (viewing === k) closeDialog($('viewDlg'));
        break;
      }
      case 'backgroundChanged': {
        snap.background = m.background;
        applyBackground();
        $('bgOpts')?.querySelectorAll('[data-bg]').forEach(x => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.bg === m.background)));
        if (me?.isOwner && $('bgDlg')?.classList.contains('open')) toast('배경을 바꿨어요');
        break;
      }
      case 'bandChanged': {
        const t = treeOf(m.treeId);
        if (m.stringId) t.bands[m.bandId] = m.stringId; else delete t.bands[m.bandId];
        updateTreeArt(m.treeId);
        if ($('lightsDlg')?.classList.contains('open')) renderLights();
        break;
      }
      case 'roomChanged': {
        const vis = snap.visibility;
        snap.visibility = m.visibility;
        snap.status = m.status;
        if (m.status === 'disabled') return showNotice('잠시 닫아 둔 방이에요', '신고가 여러 번 들어와 관리자가 확인하고 있어요.');
        if (m.status === 'archived' && !readonly) { readonly = true; mount(); toast('시즌이 끝나 이제 구경만 할 수 있어요', 3500); break; }
        renderChrome();
        if (vis !== m.visibility && me?.isOwner)
          toast(m.visibility === 'public' ? '공개방으로 바꿨어요. 누구나 랜덤 입장으로 들어올 수 있어요' : '비공개방으로 바꿨어요');
        break;
      }
      case 'guestChanged': {
        snap.guests[m.guestId] = m.name;
        if (me && m.guestId === me.guestId) {
          me.name = m.name;
          if ($('nameDlg')?.classList.contains('open')) { closeDialog($('nameDlg')); toast('이름을 바꿨어요'); }
        }
        renderChrome();
        break;
      }
      case 'reported':
        closeDialog($('reportDlg'));
        toast('신고했어요. 여러 사람이 신고한 방은 잠시 닫히고 관리자가 확인해요', 3500);
        break;
      case 'roomDeleted':
        ws = null;
        if (me?.isOwner && m.reason === 'owner') {
          store.ownerKey.set(roomId, null);
          store.recentRooms.remove(snap.joinCode);
          stop();
          navigate('/', { replace: true });
          toast('방을 삭제했어요');
          return;
        }
        store.recentRooms.remove(snap.joinCode);
        return showNotice(m.reason === 'owner' ? '방장이 방을 삭제했어요' : '방이 정리됐어요',
          m.reason === 'owner' ? '이 방은 더 이상 볼 수 없어요. 새 방을 만들어 꾸며 보세요.' : '오랫동안 장식이 거의 없던 방이라 자동으로 정리됐어요.');
      case 'error':
        onError(m.code, m.message);
        break;
    }
  }

  function onError(code: string, message?: string) {
    if (code === 'SLOT_TAKEN' || code === 'INVALID_ITEM' || code === 'INVALID_SLOT' || code === 'MEMO_REJECTED' || code === 'READ_ONLY') {
      // 달던 장식을 되돌림
      for (const k of pendingPlace) { pendingPlace.delete(k); const [t, s] = k.split(':'); updateSlot(t, s); }
    }
    pendingRemove.clear();
    const fallback: Record<string, string> = {
      SLOT_TAKEN: '그 자리는 방금 다른 사람이 채웠어요',
      NOT_ALLOWED: '권한이 없어요',
      RATE_LIMITED: '너무 빨리 보내고 있어요. 잠시 후 다시 해 주세요',
      QUOTA_EXCEEDED: '오늘은 사용량이 많아 잠시 쉬어가요. 한국 시간 오전 9시에 다시 열려요',
      READ_ONLY: '시즌이 끝나 이제는 구경만 할 수 있어요',
      ALREADY_REPORTED: '이미 신고했어요',
    };
    if (code === 'NAME_REJECTED') { $('nameErr').textContent = message ?? '쓸 수 없는 이름이에요'; return; }
    if (code === 'NOT_ALLOWED' && $('deleteDlg')?.classList.contains('open')) { $('deleteErr').textContent = message ?? '방 이름이 맞지 않아요'; return; }
    if (code === 'ALREADY_REPORTED') closeDialog($('reportDlg'));
    toast(message ?? fallback[code] ?? '요청을 처리하지 못했어요', 3000);
  }

  // ---------- 화면 ----------

  function mount() {
    if (!snap) return;
    closeAllDialogs();
    document.body.classList.add('room-mode');
    document.body.classList.toggle(theme.pausedClass, !store.twinkle.get());
    document.title = `${snap.title} · 들렀다감`;
    const owner = !!me?.isOwner;
    const season = seasonById(snap.seasonId);
    const archiveView = 'archiveRoomId' in source;
    root.innerHTML = `
    <div class="app${readonly ? ' readonly' : ''}">
      <header class="top">
        <a class="home" href="${archiveView ? '/archive' : '/'}" data-link>${archiveView ? '← 지난 시즌' : '들렀다감'}</a>
        <h1 class="title" id="roomTitle">${esc(snap.title)}</h1>
        ${readonly ? '<span class="badge ro">읽기 전용</span>' : `<button class="badge" id="privBtn" title="방장만 바꿀 수 있어요"></button>`}
        <div class="count" aria-live="polite"><span id="countTxt"></span><span class="bar"><i id="countBar"></i></span></div>
        <a class="home-m" href="/" data-link aria-label="처음으로" title="처음으로"><svg viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M4 0h2v1H4zM3 1h4v1H3zM2 2h6v1H2zM1 3h8v1H1zM0 4h10v1H0zM1 5h8v5H6V7H4v3H1z"/></svg></a>
        <span class="spacer"></span>
        ${!readonly && owner ? `<button class="pxbtn" id="bgBtn">배경 바꾸기</button><button class="pxbtn" id="lightsBtn">조명 꾸미기</button><button class="pxbtn" id="myIdBtn">내 방 ID</button>` : ''}
        ${!archiveView ? `<button class="pxbtn primary" id="shareBtn">참여 코드 <span class="code">${esc(snap.joinCode)}</span> 복사</button>` : ''}
      </header>

      <main class="stage" id="stage">
        <button class="done" id="doneBanner" type="button">${readonly ? '모든 자리에 장식이 달린 방이에요' : '세 그루 모두 완성됐어요! 사진으로 남겨 볼까요?'}</button>
        <div class="stage-bg" id="stageBg" aria-hidden="true"></div>
        <div class="conn" id="conn" hidden>연결이 끊겼어요 · 다시 연결하는 중…</div>
        <div class="forest" id="forest"></div>
      </main>

      ${readonly ? '' : `
      <aside class="tray" aria-label="장식 목록">
        <h2>장식 고르기</h2>
        <p class="hint">장식을 나무의 빈 자리로 끌어다 놓으세요. 눌러서 고른 다음 빈 자리를 눌러도 돼요. 별은 꼭대기에만 달 수 있어요.</p>
        <div class="items" id="items"></div>
      </aside>`}

      <footer class="roombar">
        ${me ? `<span class="me">내 이름 <b id="myName"></b></span>${readonly ? '' : '<button class="link" id="nameBtn">이름 바꾸기</button>'}` : `<span class="me">${esc(season?.subtitle ?? '')} · 지난 시즌</span>`}
        <span class="spacer"></span>
        <button class="link" id="twinkleBtn"></button>
        <button class="link" id="photoBtn">사진으로 남기기</button>
        ${!readonly && me && !owner ? '<button class="link" id="reportRoomBtn">방 신고</button>' : ''}
        ${!readonly && owner ? '<button class="link danger" id="deleteBtn">방 삭제</button>' : ''}
      </footer>
    </div>
    <div class="tip" id="tip" hidden></div>
    ${dialogsHtml()}`;

    applyBackground();
    renderForest();
    if (!readonly) renderItems();
    renderChrome();
    bindChrome();
  }

  function dialogsHtml() {
    return `
    <div class="scrim" id="memoDlg" role="dialog" aria-modal="true" aria-labelledby="memoTitle">
      <div class="card">
        <button class="dlg-x" id="memoClose" aria-label="닫기" title="닫기"><svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM6 0h1v1H6zM5 1h1v1H5zM4 2h1v1H4zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z"/></svg></button>
        <div class="memo-head"><span id="memoIcon"></span><div><h3 id="memoTitle">메모 남기기</h3><div class="who" id="memoWho"></div></div></div>
        <label class="sr-only" for="memoInput">메모</label>
        <textarea id="memoInput" maxlength="${MEMO_MAX}" placeholder="이 장식에 남길 한마디 (선택)"></textarea>
        <div class="charc"><span id="memoCount">0</span>/${MEMO_MAX}</div>
        <div class="row"><button class="pxbtn" id="memoCancel">취소</button><button class="pxbtn primary" id="memoOk">장식 달기</button></div>
      </div>
    </div>
    <div class="scrim" id="viewDlg" role="dialog" aria-modal="true" aria-labelledby="viewTitle">
      <div class="card">
        <div class="memo-head"><span id="viewIcon"></span><div><h3 id="viewTitle"></h3><div class="who" id="viewWho"></div></div></div>
        <div class="memo-body" id="viewMemo"></div>
        <div class="row">
          <button class="pxbtn danger" id="viewReport" hidden>신고</button>
          <button class="pxbtn" id="viewDel" hidden>장식 떼기</button>
          <button class="pxbtn primary" id="viewClose">닫기</button>
        </div>
      </div>
    </div>
    <div class="scrim" id="introDlg" role="dialog" aria-modal="true" aria-labelledby="introTitle">
      <div class="card">
        <h3 id="introTitle">방이 만들어졌어요</h3>
        <p>아래 두 코드는 쓰임이 달라요.</p>
        <div class="key owner">
          <span class="lab">방장 전용 ID · 나만 알고 있기</span>
          <div class="val"><span id="ownerIdTxt"></span><button class="pxbtn" id="copyOwner">복사</button></div>
          <p class="warn">이 ID를 잃어버리면 다른 기기에서 방장으로 들어올 수 없어요. 다른 사람에게 알려주지 마세요.</p>
        </div>
        <div class="key">
          <span class="lab">참여 코드 · 친구에게 공유하기</span>
          <div class="val sm"><span id="joinCodeTxt"></span><button class="pxbtn" id="copyJoin">링크 복사</button></div>
          <p>이 코드나 공유 링크로 친구들이 함께 꾸밀 수 있어요.</p>
        </div>
        <div class="row"><button class="pxbtn primary" id="introOk">ID를 저장했어요</button></div>
      </div>
    </div>
    <div class="scrim" id="lightsDlg" role="dialog" aria-modal="true" aria-labelledby="lightsTitle">
      <div class="card">
        <h3 id="lightsTitle">조명 꾸미기</h3>
        <p>나무를 고른 다음 층마다 두를 조명이나 가랜드를 골라주세요. 방장만 바꿀 수 있어요.</p>
        <div id="lightsRows"></div>
        <div class="row"><button class="pxbtn primary" id="lightsClose">완료</button></div>
      </div>
    </div>
    <div class="scrim" id="bgDlg" role="dialog" aria-modal="true" aria-labelledby="bgTitle">
      <div class="card wide">
        <h3 id="bgTitle">배경 바꾸기</h3>
        <p>방에 들어온 모두에게 바로 바뀐 배경이 보여요. 방장만 바꿀 수 있어요.</p>
        <div class="bg-opts" id="bgOpts">${backgroundPickerHtml(theme, snap!.background)}</div>
        <div class="row"><button class="pxbtn primary" id="bgClose">완료</button></div>
      </div>
    </div>
    <div class="scrim" id="nameDlg" role="dialog" aria-modal="true" aria-labelledby="nameTitle">
      <div class="card">
        <h3 id="nameTitle">이름 바꾸기</h3>
        <p>장식을 달 때 함께 보이는 이름이에요.</p>
        <label class="sr-only" for="nameInput">이름</label>
        <input type="text" id="nameInput" maxlength="${NAME_MAX}" autocomplete="nickname">
        <p class="field-err" id="nameErr" role="alert"></p>
        <div class="row"><button class="pxbtn" id="nameCancel">취소</button><button class="pxbtn primary" id="nameOk">바꾸기</button></div>
      </div>
    </div>
    <div class="scrim" id="deleteDlg" role="dialog" aria-modal="true" aria-labelledby="deleteTitle">
      <div class="card">
        <h3 id="deleteTitle">방을 삭제할까요?</h3>
        <p class="warn">삭제하면 모든 장식과 메모가 사라지고 되돌릴 수 없어요. 들어와 있는 친구들도 더 이상 볼 수 없어요.</p>
        <p>확인을 위해 방 이름 <b id="deleteName"></b>을(를) 그대로 입력해 주세요.</p>
        <label class="sr-only" for="deleteInput">방 이름 확인</label>
        <input type="text" id="deleteInput" autocomplete="off">
        <p class="field-err" id="deleteErr" role="alert"></p>
        <div class="row"><button class="pxbtn" id="deleteCancel">취소</button><button class="pxbtn primary" id="deleteOk" disabled>영구 삭제</button></div>
      </div>
    </div>
    <div class="scrim" id="reportDlg" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
      <div class="card">
        <h3 id="reportTitle">신고하기</h3>
        <p id="reportDesc"></p>
        <label class="sr-only" for="reportInput">신고 이유</label>
        <input type="text" id="reportInput" maxlength="100" placeholder="이유 (선택)">
        <div class="row"><button class="pxbtn" id="reportCancel">취소</button><button class="pxbtn primary" id="reportOk">신고</button></div>
      </div>
    </div>`;
  }

  function slotHtml(tree: TreeSnapshot, s: Slot, fresh = false): string {
    const k = key(tree.id, s.id);
    const p = placementAt(tree.id, s.id);
    const style = `left:${(s.x / 48) * 100}%;top:${((s.y + 4) / 68) * 100}%;width:${(s.size / 48) * 100}%`;
    if (p) {
      return `<button class="slot filled${isMine(p) ? ' mine' : ''}${fresh ? ' new' : ''}" data-slot="${k}" style="${style}"
        aria-label="${esc(tree.name)}: ${esc(iname(p.itemId))}, ${esc(nameOf(p.authorId))}님이 달았어요. 메모 보기">${itemSvg(theme, p.itemId)}</button>`;
    }
    return `<button class="slot empty${s.isTop ? ' top' : ''}${pendingPlace.has(k) ? ' pending' : ''}" data-slot="${k}" style="${style}"
      aria-label="${esc(tree.name)}: ${s.isTop ? '꼭대기 빈 자리 (별 전용)' : '빈 자리'}"${readonly ? ' tabindex="-1"' : ''}></button>`;
  }

  function plateHtml(tree: TreeSnapshot) {
    const filled = snap!.placements.filter(p => p.treeId === tree.id).length;
    const full = filled === tree.slots.length;
    return `${esc(tree.name)} <b>${full ? '완성' : `${filled}/${tree.slots.length}`}</b>`;
  }

  function renderForest() {
    const forest = $('forest');
    const keep = forest.scrollLeft;
    forest.innerHTML = [...snap!.trees].sort((a, b) => a.position - b.position).map(t => `
      <section class="tree-col${t.scale < 1 ? ' side' : ''}" aria-label="${esc(t.name)}">
        <div class="tree-wrap" id="tw-${t.id}">${treeArtSvg(theme, t)}${t.slots.map(s => slotHtml(t, s)).join('')}</div>
        <div class="plate${snap!.placements.filter(p => p.treeId === t.id).length === t.slots.length ? ' full' : ''}" id="plate-${t.id}">${plateHtml(t)}</div>
      </section>`).join('');
    forest.scrollLeft = keep;
    renderProgress();
    markOk();
  }

  /** 바뀐 슬롯만 다시 그린다 */
  function updateSlot(treeId: string, slotId: string, fresh = false) {
    const el = root.querySelector(`[data-slot="${key(treeId, slotId)}"]`);
    const t = treeOf(treeId);
    const s = t.slots.find(x => x.id === slotId);
    if (!el || !s) return;
    const hadFocus = document.activeElement === el;
    el.outerHTML = slotHtml(t, s, fresh);
    if (hadFocus) (root.querySelector(`[data-slot="${key(treeId, slotId)}"]`) as HTMLElement | null)?.focus();
    const plate = $('plate-' + treeId);
    plate.innerHTML = plateHtml(t);
    plate.classList.toggle('full', snap!.placements.filter(p => p.treeId === treeId).length === t.slots.length);
    renderProgress();
    markOk();
  }

  /** 배경 그림을 받아 무대 뒤에 깐다. 받기 전이나 실패하면 기본 벽지 무늬가 보인다 */
  function applyBackground() {
    const id = snap?.background;
    if (!id) return;
    loadBackground(id).then(bg => {
      const el = $('stageBg');
      if (!el || snap?.background !== id) return;
      el.innerHTML = `<svg viewBox="${bg.viewBox}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">${bg.inner}</svg>`;
      $('stage').classList.add('has-bg');
    }).catch(err => console.error(err));
  }

  function updateTreeArt(treeId: string) {
    const wrap = $('tw-' + treeId);
    wrap?.querySelector(':scope > svg')?.remove();
    wrap?.insertAdjacentHTML('afterbegin', treeArtSvg(theme, treeOf(treeId)));
  }

  function renderProgress() {
    const n = snap!.placements.length, total = totalSlots();
    $('countTxt').textContent = `${n}/${total}`;
    $('countBar').style.width = (n / total) * 100 + '%';
    $('doneBanner').classList.toggle('show', n === total);
  }

  function renderItems() {
    $('items').innerHTML = theme.geometry.items.map(i =>
      `<button class="item" data-item="${i.id}" aria-pressed="false">${itemSvg(theme, i.id)}<span>${esc(i.name)}</span></button>`).join('');
  }

  function renderChrome() {
    if (!snap) return;
    const priv = $('privBtn');
    if (priv) {
      priv.textContent = snap.visibility === 'private' ? '비공개방' : '공개방';
      priv.setAttribute('aria-pressed', String(snap.visibility === 'private'));
      (priv as HTMLButtonElement).disabled = !me?.isOwner;
      priv.setAttribute('aria-label', `${priv.textContent}${me?.isOwner ? ' (눌러서 바꾸기)' : ''}`);
    }
    if ($('myName') && me) $('myName').textContent = me.name + (me.isOwner && me.name !== '방장' ? ' (방장)' : '');
    $('twinkleBtn').textContent = store.twinkle.get() ? '반짝임 끄기' : '반짝임 켜기';
  }

  function setConn(broken: boolean) {
    const c = $('conn');
    if (c) c.hidden = !broken || !everConnected;
  }

  // ---------- 장식 고르기 / 끌어다 놓기 (프로토타입 동작 이식) ----------

  let picked: string | null = null;
  let drag: { item: string; startX: number; startY: number; active: boolean; el: HTMLElement; id: number; ghost?: HTMLElement; hot?: HTMLElement | null } | null = null;

  function markOk() {
    const item = picked || (drag?.active ? drag.item : null);
    root.querySelectorAll<HTMLElement>('.slot.empty').forEach(el => {
      const [, s] = slotOf(el.dataset.slot!);
      el.classList.toggle('ok', !!item && accepts(s, item, theme.geometry));
    });
  }

  function setPicked(item: string | null) {
    picked = item;
    root.querySelectorAll('.item').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.item === item)));
    $('stage')?.classList.toggle('picking', !!item);
    markOk();
    if (item) toast(item === theme.geometry.topItem ? '별은 트리 꼭대기에 달 수 있어요' : `${iname(item)}을(를) 달 빈 자리를 눌러주세요`);
  }

  function onPointerDown(e: PointerEvent) {
    const b = (e.target as Element).closest<HTMLElement>('.item');
    if (!b || e.button > 0) return;
    drag = { item: b.dataset.item!, startX: e.clientX, startY: e.clientY, active: false, el: b, id: e.pointerId };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < 8) return;
      // 모바일 가로 목록에서 가로로 미는 동작은 스크롤
      if (getComputedStyle(drag.el).touchAction === 'pan-x' && Math.abs(dx) > Math.abs(dy) && e.pointerType !== 'mouse') { drag = null; return; }
      drag.active = true;
      try { drag.el.setPointerCapture(e.pointerId); } catch { /* */ }
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'ghost';
      drag.ghost.innerHTML = itemSvg(theme, drag.item);
      document.body.appendChild(drag.ghost);
      setPicked(null);
      $('stage').classList.add('dragging');
      markOk();
      hideTip();
    }
    e.preventDefault();
    drag.ghost!.style.left = e.clientX + 'px';
    drag.ghost!.style.top = e.clientY + 'px';
    let best: HTMLElement | null = null, bestD = Infinity;
    root.querySelectorAll<HTMLElement>('.slot.empty.ok').forEach(el => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < Math.max(r.width * 1.1, 34) && d < bestD) { best = el; bestD = d; }
    });
    if (drag.hot && drag.hot !== best) drag.hot.classList.remove('hot');
    (best as HTMLElement | null)?.classList.add('hot');
    drag.hot = best;
  }

  function endDrag(e: PointerEvent, cancel: boolean) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.active) { if (!cancel) setPicked(picked === d.item ? null : d.item); return; }
    d.ghost?.remove();
    $('stage')?.classList.remove('dragging');
    if (d.hot) { d.hot.classList.remove('hot'); if (!cancel) openMemo(d.hot.dataset.slot!, d.item); }
    else if (!cancel) toast('빈 자리 가까이에 놓아주세요');
    markOk();
  }
  const onUp = (e: PointerEvent) => endDrag(e, false);
  const onCancel = (e: PointerEvent) => endDrag(e, true);

  // ---------- 대화상자 ----------

  let pending: { slotKey: string; item: string } | null = null;
  let viewing: string | null = null;
  let lightsTree = 'B';
  let reportTarget = 'room';

  function openMemo(slotKey: string, item: string) {
    const [t, s] = slotOf(slotKey);
    if (placementAt(t.id, s.id)) { toast('그 자리는 이미 채워졌어요'); return; }
    pending = { slotKey, item };
    $('memoIcon').innerHTML = itemSvg(theme, item);
    $('memoTitle').textContent = `${iname(item)}에 메모 남기기`;
    $('memoWho').textContent = `${me?.name ?? ''}(으)로 남겨요`;
    ($('memoInput') as HTMLTextAreaElement).value = '';
    $('memoCount').textContent = '0';
    openDialog($('memoDlg'), { focus: $('memoInput') });
  }

  function confirmMemo() {
    if (!pending) return;
    const [treeId, slotId] = pending.slotKey.split(':');
    const memo = ($('memoInput') as HTMLTextAreaElement).value.trim();
    if (placementAt(treeId, slotId)) { toast('그 자리는 방금 다른 사람이 채웠어요'); closeDialog($('memoDlg')); pending = null; return; }
    if (send({ t: 'place', treeId, slotId, itemId: pending.item, memo })) {
      pendingPlace.add(pending.slotKey);
      updateSlot(treeId, slotId);
    }
    pending = null;
    closeDialog($('memoDlg'));
  }

  function openView(slotKey: string) {
    const [t, s] = slotOf(slotKey);
    const p = placementAt(t.id, s.id);
    if (!p) return;
    viewing = slotKey;
    $('viewIcon').innerHTML = itemSvg(theme, p.itemId);
    $('viewTitle').textContent = iname(p.itemId);
    $('viewWho').textContent = isMine(p) ? '내가 달았어요' : `${nameOf(p.authorId)}님이 달았어요`;
    const m = $('viewMemo');
    m.textContent = p.memo || '남긴 메모가 없어요';
    m.classList.toggle('none', !p.memo);
    const del = $('viewDel');
    del.hidden = readonly || !me || !canDelete(me, p);
    del.textContent = isMine(p) ? '장식 떼기' : '방장 권한으로 떼기';
    $('viewReport').hidden = readonly || !me || me.isOwner || isMine(p);
    openDialog($('viewDlg'), { focus: $('viewClose'), onClose: () => { viewing = null; } });
  }

  function openIntro() {
    const k = store.ownerKey.get(roomId);
    $('ownerIdTxt').textContent = k ? formatKey(k) : '이 기기에는 저장돼 있지 않아요';
    $('joinCodeTxt').textContent = snap!.joinCode;
    openDialog($('introDlg'), { focus: $('introOk'), locked: store.justCreated.get(roomId) });
  }

  function renderLights() {
    const g = theme.geometry;
    const tabs = `<div class="seg tree-tabs" role="group" aria-label="나무 고르기">${snap!.trees.map(t =>
      `<button data-tree="${t.id}" aria-pressed="${t.id === lightsTree}">${esc(t.name)}</button>`).join('')}</div>`;
    const tree = treeOf(lightsTree);
    $('lightsRows').innerHTML = tabs + [...g.bands].reverse().map(b => {
      const cur = tree.bands[b.id] ?? '';
      const opts = [{ id: '', name: '없음' }, ...g.strings].map(o =>
        `<button data-band="${b.id}" data-str="${o.id}" aria-pressed="${cur === o.id}" aria-label="${b.label}: ${esc(o.name)}" title="${esc(o.name)}">${o.id ? stringSvg(theme, o.id) : '없음'}</button>`).join('');
      return `<div class="lights-row"><span>${b.label}</span><div class="lights-opts">${opts}</div></div>`;
    }).join('');
  }

  function openReport(target: string) {
    reportTarget = target;
    $('reportDesc').textContent = target === 'room'
      ? '이 방에 불쾌한 내용이 있나요? 여러 사람이 신고하면 방이 잠시 닫히고 관리자가 확인해요.'
      : '이 장식의 메모가 불쾌한가요? 여러 사람이 신고하면 방이 잠시 닫히고 관리자가 확인해요.';
    ($('reportInput') as HTMLInputElement).value = '';
    openDialog($('reportDlg'), { focus: $('reportInput') });
  }

  // ---------- 툴팁 (마우스만) ----------

  function hideTip() { const t = $('tip'); if (t) t.hidden = true; }
  function onOver(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || drag) return;
    const el = (e.target as Element).closest<HTMLElement>('.slot.filled');
    if (!el) return;
    const [t, s] = slotOf(el.dataset.slot!);
    const p = placementAt(t.id, s.id);
    if (!p) return;
    const tip = $('tip');
    tip.innerHTML = (p.memo ? esc(p.memo) : '<span style="opacity:.6">메모 없음</span>') + `<small>${esc(nameOf(p.authorId))} · 눌러서 자세히</small>`;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2; x = Math.max(8, Math.min(x, innerWidth - tr.width - 8));
    let y = r.top - tr.height - 8; if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  // ---------- 이벤트 연결 ----------

  function bindChrome() {
    const on = (id: string, fn: () => void) => $(id)?.addEventListener('click', fn);
    const forest = $('forest');

    forest.addEventListener('click', e => {
      const el = (e.target as Element).closest<HTMLElement>('.slot');
      if (!el) return;
      const [t, s] = slotOf(el.dataset.slot!);
      if (el.classList.contains('filled')) { hideTip(); openView(el.dataset.slot!); return; }
      if (readonly || el.classList.contains('pending')) return;
      if (picked) {
        if (!accepts(s, picked, theme.geometry)) { toast(s.isTop ? '꼭대기에는 별만 달 수 있어요' : '별은 꼭대기에만 달 수 있어요'); return; }
        const it = picked; setPicked(null); openMemo(key(t.id, s.id), it);
      } else {
        toast(s.isTop ? '꼭대기에는 별을 달아보세요' : '장식 목록에서 장식을 골라주세요');
      }
    });
    forest.addEventListener('pointerover', onOver);
    forest.addEventListener('pointerout', e => { if ((e.target as Element).closest('.slot.filled')) hideTip(); });

    const items = $('items');
    if (items) {
      items.addEventListener('pointerdown', onPointerDown);
      // 키보드 Enter/Space는 pointer 이벤트가 없으므로 click으로 선택
      items.addEventListener('click', e => {
        const b = (e.target as Element).closest<HTMLElement>('.item');
        if (!b || e.detail !== 0) return;
        setPicked(picked === b.dataset.item ? null : b.dataset.item!);
      });
    }

    on('privBtn', () => { if (me?.isOwner) send({ t: 'setVisibility', visibility: snap!.visibility === 'private' ? 'public' : 'private' }); });
    on('shareBtn', () => copyText(`${location.origin}/r/${snap!.joinCode}`, '참여 링크를 복사했어요. 친구에게 보내주세요'));
    on('myIdBtn', openIntro);
    on('lightsBtn', () => { renderLights(); openDialog($('lightsDlg'), { focus: $('lightsClose') }); });
    on('lightsClose', () => closeDialog($('lightsDlg')));
    on('bgBtn', () => openDialog($('bgDlg'), { focus: $('bgOpts').querySelector<HTMLElement>('[aria-pressed="true"]') }));
    on('bgClose', () => closeDialog($('bgDlg')));
    $('bgOpts').addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('[data-bg]');
      if (b && b.dataset.bg !== snap!.background) send({ t: 'setBackground', background: b.dataset.bg! });
    });
    $('lightsRows').addEventListener('click', e => {
      const tb = (e.target as Element).closest<HTMLElement>('button[data-tree]');
      if (tb) { lightsTree = tb.dataset.tree!; renderLights(); ($('lightsRows').querySelector(`[data-tree="${lightsTree}"]`) as HTMLElement).focus(); return; }
      const b = (e.target as Element).closest<HTMLElement>('button[data-band]');
      if (b) send({ t: 'setBand', treeId: lightsTree, bandId: b.dataset.band!, stringId: b.dataset.str || null });
    });

    on('copyOwner', () => { const k = store.ownerKey.get(roomId); if (k) copyText(formatKey(k), '방장 ID를 복사했어요'); });
    on('copyJoin', () => copyText(`${location.origin}/r/${snap!.joinCode}`, '참여 링크를 복사했어요'));
    on('introOk', () => { store.justCreated.set(roomId, false); closeDialog($('introDlg')); });

    ($('memoInput') as HTMLTextAreaElement).addEventListener('input', e => { $('memoCount').textContent = String([...(e.target as HTMLTextAreaElement).value].length); });
    $('memoInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); confirmMemo(); } });
    on('memoCancel', () => { pending = null; closeDialog($('memoDlg')); });
    on('memoClose', () => { pending = null; closeDialog($('memoDlg')); });
    on('memoOk', confirmMemo);

    on('viewClose', () => closeDialog($('viewDlg')));
    on('viewDel', () => {
      if (!viewing) return;
      const [treeId, slotId] = viewing.split(':');
      if (send({ t: 'remove', treeId, slotId })) pendingRemove.add(viewing);
      closeDialog($('viewDlg'));
    });
    on('viewReport', () => { const v = viewing; closeDialog($('viewDlg')); if (v) openReport(`placement:${v}`); });
    on('reportRoomBtn', () => openReport('room'));
    on('reportCancel', () => closeDialog($('reportDlg')));
    on('reportOk', () => send({ t: 'report', target: reportTarget as `placement:${string}:${string}`, reason: ($('reportInput') as HTMLInputElement).value.trim() || undefined }));

    on('nameBtn', () => {
      ($('nameInput') as HTMLInputElement).value = me?.name ?? '';
      $('nameErr').textContent = '';
      openDialog($('nameDlg'), { focus: $('nameInput') });
    });
    on('nameCancel', () => closeDialog($('nameDlg')));
    const submitName = () => {
      const name = ($('nameInput') as HTMLInputElement).value.trim();
      if (!name) { $('nameErr').textContent = '이름을 입력해 주세요'; return; }
      send({ t: 'setName', name });
    };
    on('nameOk', submitName);
    $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitName(); });

    on('deleteBtn', () => {
      $('deleteName').textContent = snap!.title;
      ($('deleteInput') as HTMLInputElement).value = '';
      ($('deleteOk') as HTMLButtonElement).disabled = true;
      $('deleteErr').textContent = '';
      openDialog($('deleteDlg'), { focus: $('deleteInput') });
    });
    $('deleteInput').addEventListener('input', e => {
      ($('deleteOk') as HTMLButtonElement).disabled = (e.target as HTMLInputElement).value.trim() !== snap!.title;
    });
    on('deleteCancel', () => closeDialog($('deleteDlg')));
    on('deleteOk', () => send({ t: 'deleteRoom', confirm: ($('deleteInput') as HTMLInputElement).value }));

    on('twinkleBtn', () => {
      store.twinkle.set(!store.twinkle.get());
      document.body.classList.toggle(theme.pausedClass, !store.twinkle.get());
      renderChrome();
    });
    const share = () => openShareDialog(theme, snap!, nameOf);
    on('photoBtn', share);
    on('doneBanner', share);
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !topDialog() && picked) setPicked(null); };
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey);

  start().catch(err => { console.error(err); showNotice('들어갈 수 없어요', NETWORK_MESSAGE); });

  return () => {
    stop();
    drag?.ghost?.remove();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('room-mode', theme.pausedClass);
  };
}
