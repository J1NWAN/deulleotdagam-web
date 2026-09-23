import type { Band, Placement, RoomSnapshot, TreeSnapshot } from '@deulleotdagam/shared';
import type { ThemeAssets } from '../theme';

export const esc = (t: unknown) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function itemSvg(theme: ThemeAssets, itemId: string, attrs = 'aria-hidden="true"'): string {
  const a = theme.items[itemId];
  return a ? `<svg viewBox="${a.viewBox}" shape-rendering="crispEdges" ${attrs}>${a.inner}</svg>` : '';
}

export function stringSvg(theme: ThemeAssets, stringId: string): string {
  const a = theme.strings[stringId];
  return a ? `<svg viewBox="${a.viewBox}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${a.inner}</svg>` : '';
}

/** 층 하단에 걸치는 조명 띠: 늘리지 않고 고정 배율로 그린 뒤 가운데만 잘라 쓴다 (04 문서 4절) */
export function swagSvg(theme: ThemeAssets, stringId: string, b: Band): string {
  const st = theme.strings[stringId];
  if (!st) return '';
  const W = st.width, H = st.height, k = theme.swagScale;
  const vw = Math.min(W, b.w / k);
  const w = vw * k, h = H * k;
  return `<svg x="${b.cx - w / 2}" y="${b.y}" width="${w}" height="${h}" viewBox="${(W - vw) / 2} 0 ${vw} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">${st.inner}</svg>`;
}

/** 나무 그림 + 조명 (슬롯 버튼은 따로 얹는다) */
export function treeArtSvg(theme: ThemeAssets, tree: Pick<TreeSnapshot, 'bands'>): string {
  const g = theme.geometry;
  const bands = g.bands.map(b => (tree.bands[b.id] ? swagSvg(theme, tree.bands[b.id], b) : '')).join('');
  return `<svg viewBox="${g.stageViewBox.join(' ')}" shape-rendering="crispEdges" aria-hidden="true"><g>${theme.tree.inner}</g>${bands}</svg>`;
}

/**
 * 장식까지 그린 나무 한 그루 (지난 시즌 썸네일, 공유 이미지, 메인 화면 그림용).
 * 결과는 나무 좌표계(stageViewBox) 안의 SVG 조각이다.
 */
export function treeWithOrnamentsInner(theme: ThemeAssets, tree: TreeSnapshot, placements: Placement[]): string {
  const g = theme.geometry;
  const bands = g.bands.map(b => (tree.bands[b.id] ? swagSvg(theme, tree.bands[b.id], b) : '')).join('');
  const orn = tree.slots.map(s => {
    const p = placements.find(p => p.treeId === tree.id && p.slotId === s.id);
    const a = p && theme.items[p.itemId];
    if (!a) return '';
    return `<svg x="${s.x - s.size / 2}" y="${s.y - s.size / 2}" width="${s.size}" height="${s.size}" viewBox="${a.viewBox}" shape-rendering="crispEdges">${a.inner}</svg>`;
  }).join('');
  return `<g>${theme.tree.inner}</g>${bands}${orn}`;
}

/**
 * 방 전체(나무 3그루)를 한 장의 SVG로. 벽지/바닥 배경 포함.
 * width×height 픽셀 기준 좌표를 쓰므로 canvas에 그대로 그릴 수 있다.
 */
export function forestSvg(theme: ThemeAssets, snap: Pick<RoomSnapshot, 'trees' | 'placements'>, width: number, height: number, opts: { background?: boolean; colors?: { wall: string; wallLine: string; floor: string; floorLine: string } } = {}): string {
  const g = theme.geometry;
  const [vx, vy, vw, vh] = g.stageViewBox;
  const floorH = height * 0.13;
  const trees = [...snap.trees].sort((a, b) => a.position - b.position);
  // 가운데 나무 높이를 기준으로 폭을 맞추고, 양옆은 scale만큼 작게
  const gap = width * 0.02;
  const baseH = height * 0.86;
  let unitW = (baseH * vw) / vh;
  const totalW = trees.reduce((n, t) => n + unitW * t.scale, 0) + gap * (trees.length - 1);
  const fit = Math.min(1, (width * 0.96) / totalW);
  unitW *= fit;
  let x = (width - (trees.reduce((n, t) => n + unitW * t.scale, 0) + gap * (trees.length - 1))) / 2;
  const bottom = height - floorH * 0.35;
  const parts = trees.map(t => {
    const w = unitW * t.scale, h = (w * vh) / vw;
    const svg = `<svg x="${x}" y="${bottom - h}" width="${w}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}" shape-rendering="crispEdges">${treeWithOrnamentsInner(theme, t, snap.placements)}</svg>`;
    x += w + gap;
    return svg;
  }).join('');
  const c = opts.colors ?? { wall: '#d9c2c6', wallLine: '#cfb5ba', floor: '#9a6a4c', floorLine: '#875b40' };
  const bg = opts.background === false ? '' : `
    <defs>
      <pattern id="wp" width="26" height="10" patternUnits="userSpaceOnUse"><rect width="22" height="10" fill="${c.wall}"/><rect x="22" width="4" height="10" fill="${c.wallLine}"/></pattern>
      <pattern id="fp" width="94" height="10" patternUnits="userSpaceOnUse"><rect width="90" height="10" fill="${c.floor}"/><rect x="90" width="4" height="10" fill="${c.floorLine}"/></pattern>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#wp)"/>
    <rect y="${height - floorH}" width="${width}" height="${floorH}" fill="url(#fp)"/>
    <rect y="${height - floorH}" width="${width}" height="4" fill="${c.floorLine}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges" aria-hidden="true">${bg}${parts}</svg>`;
}
