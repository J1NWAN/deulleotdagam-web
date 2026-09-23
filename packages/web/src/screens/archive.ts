import type { ArchiveResponse, RoomSnapshot } from '@deulleotdagam/shared';
import { api, ApiFailure } from '../api';
import { esc, forestSvg, itemSvg } from '../render/scene';
import { themeAssets } from '../theme';

/** 지난 시즌 방 둘러보기: 완성된 방 랜덤 노출(10개 미만이면 미완성 포함), 열람 전용 */
export function archiveScreen(root: HTMLElement) {
  let alive = true;
  const theme = themeAssets('pixel');
  document.title = '지난 시즌 방 둘러보기 · 들렀다감';
  root.innerHTML = `
    <div class="page">
      <header class="page-top"><a class="brand" href="/" data-link>들렀다감</a><span class="sub">지난 시즌 방 둘러보기</span></header>
      <main class="main">
        <h1 style="margin:0;font-size:1.3rem" id="archTitle">지난 시즌 방 둘러보기</h1>
        <p style="margin:6px 0 0;color:var(--ink-soft)">구경만 할 수 있어요. 장식을 달 수는 없어요.</p>
        <div id="archBody"><p>불러오는 중…</p></div>
      </main>
    </div>`;

  const css = getComputedStyle(document.documentElement);
  const colors = {
    wall: css.getPropertyValue('--wall').trim() || '#d9c2c6', wallLine: css.getPropertyValue('--wall-line').trim() || '#cfb5ba',
    floor: css.getPropertyValue('--floor').trim() || '#9a6a4c', floorLine: css.getPropertyValue('--floor-line').trim() || '#875b40',
  };

  const empty = (noun: string) => `
    <div class="empty-state">
      ${itemSvg(theme, 'snowflake', 'aria-hidden="true"')}
      <h2 style="margin:10px 0 0;font-size:1.1rem">지난 시즌에 완성된 ${esc(noun)} 방이 없어요</h2>
      <p>이번 시즌 방을 멋지게 꾸며 두면, 시즌이 끝난 뒤 여기에서 다른 사람들이 구경할 수 있어요.</p>
      <p><a class="pxbtn" href="/" data-link>처음으로</a></p>
    </div>`;

  api.archive(12).then(async (res: ArchiveResponse) => {
    if (!alive) return;
    const body = document.getElementById('archBody')!;
    if (!res.season || !res.rooms.length) {
      // 끝난 시즌이 아직 없으면 현재 시즌 이름으로 안내
      let noun = res.season?.roomNoun;
      if (!noun) noun = (await api.season().catch(() => null))?.current?.roomNoun ?? '겨울 트리';
      body.innerHTML = empty(noun);
      return;
    }
    document.getElementById('archTitle')!.textContent = `지난 시즌 · ${res.season.subtitle}`;
    body.innerHTML = `<div class="gallery">${res.rooms.map(r => `
      <a class="gcard" href="/archive/${r.roomId}" data-link>
        <div class="thumb" id="th-${r.roomId}"></div>
        <div class="meta"><b>${esc(r.title)}</b><span class="badge ${r.isComplete ? 'ro' : ''}">${r.isComplete ? '완성' : '읽기 전용'}</span></div>
      </a>`).join('')}</div>`;
    // 썸네일은 방마다 읽기 전용 스냅샷으로 그린다
    await Promise.all(res.rooms.map(async r => {
      try {
        const snap: RoomSnapshot = await api.archivedSnapshot(r.roomId);
        const el = document.getElementById('th-' + r.roomId);
        if (el && alive) el.innerHTML = forestSvg(themeAssets(snap.themeId), snap, 600, 400, { colors });
      } catch { /* 썸네일 없이 표시 */ }
    }));
  }).catch(x => {
    const body = document.getElementById('archBody');
    if (body) body.innerHTML = `<div class="empty-state"><p>${esc(x instanceof ApiFailure ? x.message : '목록을 불러오지 못했어요')}</p></div>`;
  });

  return () => { alive = false; };
}
