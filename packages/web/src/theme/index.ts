// 테마별 그림 에셋. 좌표/구역/장식 목록 같은 기하 값은 @deulleotdagam/shared 의 ThemeGeometry에 있다.
// SVG는 CSS 반짝임 애니메이션이 동작하도록 문자열로 가져와 인라인 삽입한다.
import { getTheme, type ThemeGeometry } from '@deulleotdagam/shared';
import '../assets/pixel/twinkle-pixel.css';

export interface SvgAsset { viewBox: string; width: number; height: number; inner: string }

export interface ThemeAssets {
  geometry: ThemeGeometry;
  tree: SvgAsset;
  items: Record<string, SvgAsset>;
  strings: Record<string, SvgAsset>;
  /** 반짝임 일시정지 클래스 (테마별 CSS 접두어) */
  pausedClass: string;
  /** 도트 크기를 층마다 같게 유지하려고 조명은 고정 배율로 그린 뒤 가운데만 잘라 쓴다 */
  swagScale: number;
}

function parseSvg(raw: string): SvgAsset {
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 16 16';
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  const start = raw.indexOf('>', raw.indexOf('<svg')) + 1;
  const inner = raw.slice(start, raw.lastIndexOf('</svg>'));
  return { viewBox, width, height, inner };
}

const pixelFiles = import.meta.glob('../assets/pixel/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const pixelSvg = Object.fromEntries(
  Object.entries(pixelFiles).map(([path, raw]) => [path.split('/').pop()!.replace('.svg', ''), parseSvg(raw)]),
);

function build(id: string, svg: Record<string, SvgAsset>, pausedClass: string, swagScale: number): ThemeAssets {
  const geometry = getTheme(id);
  const pick = (ids: { id: string }[]) => Object.fromEntries(ids.map(i => {
    if (!svg[i.id]) throw new Error(`missing asset ${id}/${i.id}`);
    return [i.id, svg[i.id]];
  }));
  return { geometry, tree: svg.tree, items: pick(geometry.items), strings: pick(geometry.strings), pausedClass, swagScale };
}

const THEMES: Record<string, ThemeAssets> = {
  pixel: build('pixel', pixelSvg, 'px-paused', 0.62),
};

export function themeAssets(id: string): ThemeAssets {
  return THEMES[id] ?? THEMES.pixel;
}

// ---------- 배경 ----------
// 배경 그림은 개당 150~230KB라 번들에 넣지 않고 public/backgrounds에서 고른 것만 불러온다.
// 반짝임 애니메이션(px- 클래스)이 동작하도록 받아서 인라인으로 넣는다.

export const backgroundUrl = (id: string) => `/backgrounds/bg-${id}.svg`;

const bgCache = new Map<string, Promise<SvgAsset>>();

export function loadBackground(id: string): Promise<SvgAsset> {
  let p = bgCache.get(id);
  if (!p) {
    p = fetch(backgroundUrl(id)).then(r => {
      if (!r.ok) throw new Error(`background ${id}: ${r.status}`);
      return r.text();
    }).then(parseSvg);
    p.catch(() => bgCache.delete(id));
    bgCache.set(id, p);
  }
  return p;
}
