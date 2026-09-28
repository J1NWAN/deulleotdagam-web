// 방 화면의 움직임: 바람에 흔들리는 나무(층별)와 내리는 눈.
// 픽셀아트가 뭉개지지 않도록 흔들림은 그림 1픽셀 단위로 끊어서 움직인다 (CSS: room.css "움직임").
import type { TreeSnapshot } from '@deulleotdagam/shared';
import type { ThemeAssets } from '../theme';
import { swagSvg } from './scene';

/** 층 번호: 1~4 = 나무 층, 0 = 줄기·화분(흔들리지 않음) */
export type Tier = 0 | 1 | 2 | 3 | 4;

const tierCache = new WeakMap<ThemeAssets, Record<Tier, string>>();

/** 그림 그리드 줄(y)이 속한 층 */
function tierOfRow(theme: ThemeAssets, row: number): Tier {
  const [t2, t3, t4, trunk] = theme.tierStarts;
  return row >= trunk ? 0 : row >= t4 ? 4 : row >= t3 ? 3 : row >= t2 ? 2 : 1;
}

/** 슬롯 좌표(단위 y)가 속한 층. 꼭대기 별 자리는 1층과 같이 움직인다 */
export function tierOfUnitY(theme: ThemeAssets, y: number): Tier {
  const scale = theme.tree.width / theme.geometry.width;
  return Math.max(1, tierOfRow(theme, Math.round(y * scale))) as Tier;
}

/** tree.svg의 <rect>를 층별로 나눈다. 층 경계를 넘는 사각형은 경계에서 잘라 나눈다 */
function splitTree(theme: ThemeAssets): Record<Tier, string> {
  const cached = tierCache.get(theme);
  if (cached) return cached;
  const out: Record<Tier, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  const bounds = [0, ...theme.tierStarts, Infinity];
  for (const m of theme.tree.inner.matchAll(/<rect\b([^>]*?)\/?>(?:<\/rect>)?/g)) {
    const attrs = m[1];
    const y = Number(/\by="(\d+)"/.exec(attrs)?.[1]);
    const h = Number(/\bheight="(\d+)"/.exec(attrs)?.[1]);
    for (let i = 0; i < bounds.length - 1; i++) {
      const top = Math.max(y, bounds[i]), bottom = Math.min(y + h, bounds[i + 1]);
      if (bottom <= top) continue;
      const piece = attrs.replace(/\by="\d+"/, `y="${top}"`).replace(/\bheight="\d+"/, `height="${bottom - top}"`);
      out[tierOfRow(theme, top)].push(`<rect${piece}/>`);
    }
  }
  const joined = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('')])) as Record<Tier, string>;
  tierCache.set(theme, joined);
  return joined;
}

/**
 * 방 화면용 나무: 줄기·4층·3층·2층·1층을 겹친 SVG 레이어 5장.
 * 각 층의 조명 띠도 그 층 레이어에 넣어 함께 흔들린다. 위층이 아래층 위에 그려진다.
 */
export function treeLayersHtml(theme: ThemeAssets, tree: Pick<TreeSnapshot, 'bands'>): string {
  const g = theme.geometry;
  const parts = splitTree(theme);
  const order: Tier[] = [0, 4, 3, 2, 1];
  return order.map(t => {
    const bands = g.bands
      .filter(b => (theme.bandTier[b.id] ?? 0) === t && tree.bands[b.id])
      .map(b => swagSvg(theme, tree.bands[b.id], b)).join('');
    return `<svg class="layer${t ? ` sw t${t}` : ''}" viewBox="${g.stageViewBox.join(' ')}" shape-rendering="crispEdges" aria-hidden="true">`
      + `<svg width="${g.width}" height="${g.height}" viewBox="${theme.tree.viewBox}" shape-rendering="crispEdges">${parts[t]}</svg>${bands}</svg>`;
  }).join('');
}

/**
 * 내리는 눈: 나무 뒤(작고 많게)와 앞(크고 적게) 두 겹.
 * 눈송이 크기는 배경 그림 1픽셀(또는 2픽셀)에 맞춘다.
 */
export function snowHtml(level: 0 | 1 | 2): { back: string; front: string } {
  if (!level) return { back: '', front: '' };
  const counts = level === 2 ? [46, 14] : [24, 6];
  const flake = (front: boolean) => {
    const dur = (front ? 7 : 11) + Math.random() * (front ? 4 : 7);
    const style = [
      `left:${(Math.random() * 100).toFixed(2)}%`,
      `--s:${front ? 2 : Math.random() < 0.3 ? 2 : 1}`,
      `--dur:${dur.toFixed(1)}s`,
      `--delay:-${(Math.random() * dur).toFixed(1)}s`,
      `--dx:${(Math.random() * 6 - 3).toFixed(1)}`,
      `--sway:${(2.5 + Math.random() * 2.5).toFixed(1)}s`,
      `opacity:${(front ? 0.9 : 0.55 + Math.random() * 0.35).toFixed(2)}`,
    ].join(';');
    return `<i style="${style}"><b></b></i>`;
  };
  return {
    back: Array.from({ length: counts[0] }, () => flake(false)).join(''),
    front: Array.from({ length: counts[1] }, () => flake(true)).join(''),
  };
}
