import { checkTitle, generateSlots, normalizeCode, TITLE_MAX, type SeasonInfo, type Visibility } from '@deulleotdagam/shared';
import { api, ApiFailure } from '../api';
import { backgroundPickerHtml, esc, treeWithOrnamentsInner } from '../render/scene';
import { navigate } from '../router';
import * as store from '../storage';
import { themeAssets } from '../theme';
import { $, toast } from '../ui/dom';

const theme = themeAssets('pixel');

/** 메인 화면 그림: 장식이 조금 달린 나무 한 그루 (장식용이며 실제 방 배치와 무관) */
function heroArt(): string {
  const g = theme.geometry;
  const slots = generateSlots(20261225);
  const items = ['star-topper', 'ball-red', 'bell', 'gift', 'snowflake', 'candy-cane', 'ball-gold', 'heart'];
  const placements = slots.slice(0, 8).map((s, i) => ({
    treeId: 'B', slotId: s.id, itemId: s.isTop ? 'star-topper' : items[i], memo: '', authorId: '', createdAt: 0,
  }));
  const tree = { id: 'B', name: '', scale: 1, position: 0, slots, bands: { b1: 'fairy-lights', b2: 'garland-gold', b3: 'lights-string' } };
  return `<svg viewBox="${g.stageViewBox.join(' ')}" shape-rendering="crispEdges" aria-hidden="true">${treeWithOrnamentsInner(theme, tree, placements)}</svg>`;
}

const fmtDate = (t: number) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(t);

export function landingScreen(root: HTMLElement) {
  let season: SeasonInfo | null = null;
  let visibility: Visibility = 'private';
  let background = theme.geometry.defaultBackground;
  const recent = store.recentRooms.list();

  root.innerHTML = `
  <div class="page">
    <section class="hero">
      <div class="hero-text">
        <h1>들렀다감<small id="subtitle">겨울 트리 꾸미기</small></h1>
        <p>링크를 받고 친구 방에 들러<br>트리에 장식 하나 달고, 메모 한 줄 남기고 가요.<br>회원가입은 필요 없어요.</p>
        <span class="season" id="seasonTxt" hidden></span>
      </div>
      <div class="hero-art">${heroArt()}</div>
    </section>

    <main class="main">
      <div class="actions">
        <section class="panel featured" aria-labelledby="createH">
          <h2 id="createH">방 만들기</h2>
          <p>나무 세 그루가 있는 방을 만들고 친구에게 참여 코드를 보내 주세요.</p>
          <form id="createForm" novalidate>
            <label class="sr-only" for="titleIn">방 이름</label>
            <input type="text" id="titleIn" maxlength="${TITLE_MAX}" placeholder="방 이름 (예: 우리 거실 트리)" autocomplete="off">
            <span class="seg" role="group" aria-label="공개 설정">
              <button type="button" data-vis="private" aria-pressed="true">비공개방</button>
              <button type="button" data-vis="public" aria-pressed="false">공개방</button>
            </span>
            <p id="visHint">참여 코드를 아는 사람만 들어올 수 있어요.</p>
            <fieldset class="bg-field">
              <legend>배경 고르기 <small>(방장은 나중에 바꿀 수 있어요)</small></legend>
              <div class="bg-opts sm" id="bgOpts">${backgroundPickerHtml(theme, background)}</div>
            </fieldset>
            <button class="pxbtn primary big" id="createBtn" type="submit">방 만들기</button>
            <p class="field-err" id="createErr" role="alert"></p>
          </form>
        </section>

        <section class="panel" aria-labelledby="joinH">
          <h2 id="joinH">코드로 입장하기</h2>
          <form id="joinForm" class="inline" novalidate>
            <label class="sr-only" for="codeIn">참여 코드</label>
            <input type="text" class="code-input" id="codeIn" maxlength="12" placeholder="참여 코드 8자리" autocomplete="off" autocapitalize="characters">
            <button class="pxbtn" type="submit">입장</button>
          </form>
          <p class="field-err" id="joinErr" role="alert"></p>
        </section>

        <section class="panel" aria-labelledby="randH">
          <h2 id="randH">랜덤 공개방 입장하기</h2>
          <p>다른 사람이 공개해 둔 방에 들러 장식을 달아 보세요.</p>
          <button class="pxbtn" id="randomBtn" type="button">아무 공개방에 들르기</button>
        </section>

        <section class="panel" aria-labelledby="ownerH">
          <h2 id="ownerH">방장 ID로 내 방 들어가기</h2>
          <form id="ownerForm" class="inline" novalidate>
            <label class="sr-only" for="ownerIn">방장 ID</label>
            <input type="text" class="code-input" id="ownerIn" maxlength="30" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
            <button class="pxbtn" type="submit">들어가기</button>
          </form>
          <p class="field-err" id="ownerErr" role="alert"></p>
        </section>

        <section class="panel" aria-labelledby="archH">
          <h2 id="archH">지난 시즌 방 둘러보기</h2>
          <p>지난 시즌에 완성된 방들을 구경해요.</p>
          <a class="pxbtn" href="/archive" data-link>둘러보기</a>
        </section>
      </div>

      ${recent.length ? `<section class="recent" aria-labelledby="recentH">
        <h2 id="recentH">최근 들른 방</h2>
        <ul>${recent.map(r => `<li><a href="/r/${esc(r.joinCode)}" data-link>${r.owner ? '<span class="role">방장</span>' : ''}${esc(r.title)}</a></li>`).join('')}</ul>
      </section>` : ''}
    </main>

    <footer class="foot">
      <span>들렀다감 · 회원가입 없이 가볍게</span>
      <a href="/privacy" data-link>개인정보처리방침</a>
    </footer>
  </div>`;

  api.season().then(s => {
    season = s;
    if (s.current) {
      $('subtitle').textContent = s.current.subtitle;
      $('titleIn').setAttribute('placeholder', `방 이름 (예: ${s.current.defaultTitle})`);
      const t = $('seasonTxt');
      t.textContent = s.now < s.current.startsAt
        ? `시즌: ${fmtDate(s.current.startsAt)} ~ ${fmtDate(s.current.endsAt - 1)} · 미리 꾸며도 돼요`
        : `시즌: ${fmtDate(s.current.endsAt - 1)}까지`;
      t.hidden = false;
    } else {
      // 시즌 사이: 방 만들기/랜덤 입장 비활성
      $('seasonTxt').textContent = '지금은 시즌이 쉬는 중이에요. 다음 시즌에 만나요';
      $('seasonTxt').hidden = false;
      ($('createBtn') as HTMLButtonElement).disabled = true;
      ($('randomBtn') as HTMLButtonElement).disabled = true;
    }
  }).catch(() => { /* 시즌 정보 없이도 입장은 가능 */ });

  root.querySelectorAll<HTMLButtonElement>('[data-vis]').forEach(b => b.addEventListener('click', () => {
    visibility = b.dataset.vis as Visibility;
    root.querySelectorAll('[data-vis]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('visHint').textContent = visibility === 'public'
      ? '누구나 "랜덤 공개방 입장"으로 들어올 수 있어요.'
      : '참여 코드를 아는 사람만 들어올 수 있어요.';
  }));

  $('bgOpts').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-bg]');
    if (!b) return;
    background = b.dataset.bg!;
    $('bgOpts').querySelectorAll('[data-bg]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });

  $('createForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('createErr');
    const raw = ($('titleIn') as HTMLInputElement).value.trim() || season?.current?.defaultTitle || '우리 거실 트리';
    const chk = checkTitle(raw);
    if (!chk.ok) { err.textContent = chk.reason === 'BANNED' ? '방 이름에 쓸 수 없는 말이 들어 있어요' : '방 이름은 1~20자로 써 주세요'; return; }
    const btn = $('createBtn') as HTMLButtonElement;
    btn.disabled = true; err.textContent = '';
    try {
      const r = await api.createRoom(chk.value, visibility, background);
      store.ownerKey.set(r.roomId, r.ownerKey);
      store.justCreated.set(r.roomId, true);
      store.recentRooms.add({ joinCode: r.joinCode, title: chk.value, owner: true });
      navigate(`/r/${r.joinCode}`);
    } catch (x) {
      err.textContent = x instanceof ApiFailure ? x.message : '방을 만들지 못했어요';
      btn.disabled = false;
    }
  });

  $('joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = normalizeCode(($('codeIn') as HTMLInputElement).value);
    if (code.length !== 8) { $('joinErr').textContent = '참여 코드 8자리를 입력해 주세요'; return; }
    try {
      const r = await api.join(code);
      navigate(`/r/${r.joinCode}`);
    } catch (x) {
      $('joinErr').textContent = x instanceof ApiFailure ? x.message : '입장하지 못했어요';
    }
  });

  $('ownerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = normalizeCode(($('ownerIn') as HTMLInputElement).value);
    if (key.length !== 20) { $('ownerErr').textContent = '방장 ID 20자리를 입력해 주세요'; return; }
    try {
      const r = await api.resume(key);
      store.ownerKey.set(r.roomId, key);
      store.recentRooms.add({ joinCode: r.joinCode, title: r.title, owner: true });
      navigate(`/r/${r.joinCode}`);
    } catch (x) {
      $('ownerErr').textContent = x instanceof ApiFailure ? x.message : '들어가지 못했어요';
    }
  });

  $('randomBtn').addEventListener('click', async () => {
    try {
      const r = await api.randomPublic();
      navigate(`/r/${r.joinCode}`);
    } catch (x) {
      toast(x instanceof ApiFailure ? x.message : '공개방을 찾지 못했어요');
    }
  });
}
