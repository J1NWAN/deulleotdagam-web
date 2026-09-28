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
  /** 조명 1픽셀의 크기(좌표 단위). 나무 그림 1픽셀과 같게 해 도트 크기를 통일한다 */
  swagScale: number;
  /**
   * 나무 흔들림용 층 나누기: 2층·3층·4층·줄기가 시작되는 그림 그리드 줄(y).
   * 그 위는 1층이다. 줄기와 화분은 흔들리지 않는다.
   */
  tierStarts: [number, number, number, number];
  /** 조명 띠가 걸리는 층 (띠도 그 층과 같이 흔들린다) */
  bandTier: Record<string, number>;
  /** 배경별 움직임: wind 0 없음(실내) · 1 살랑 · 2 조금 센 바람 / snow 0 없음 · 1 조금 · 2 많이 */
  backgroundFx: Record<string, { wind: 0 | 1 | 2; snow: 0 | 1 | 2 }>;
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

function build(id: string, svg: Record<string, SvgAsset>, pausedClass: string, fx: typeof PIXEL_FX): ThemeAssets {
  const geometry = getTheme(id);
  // 나무 그림 그리드(144) ÷ 좌표 단위(48) = 3 → 조명 1픽셀 = 1/3 단위
  const swagScale = geometry.width / svg.tree.width;
  const pick = (ids: { id: string }[]) => Object.fromEntries(ids.map(i => {
    if (!svg[i.id]) throw new Error(`missing asset ${id}/${i.id}`);
    return [i.id, svg[i.id]];
  }));
  return { geometry, tree: svg.tree, items: pick(geometry.items), strings: pick(geometry.strings), pausedClass, swagScale, ...fx };
}

// 픽셀 테마 움직임 설정. tierStarts는 tree.svg(144×192)의 층 아랫단 다음 줄
const PIXEL_FX: Pick<ThemeAssets, 'tierStarts' | 'bandTier' | 'backgroundFx'> = {
  tierStarts: [66, 94, 124, 157],
  bandTier: { b1: 2, b2: 3, b3: 4 },
  backgroundFx: {
    'living-room': { wind: 0, snow: 0 },
    'snowy-night': { wind: 1, snow: 2 },
    village: { wind: 1, snow: 1 },
    aurora: { wind: 1, snow: 0 },
    'winter-dawn': { wind: 2, snow: 0 },
  },
};

const THEMES: Record<string, ThemeAssets> = {
  pixel: build('pixel', pixelSvg, 'px-paused', PIXEL_FX),
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
