// 방 화면의 움직임.
// - 배경 레이어: 불꽃·촛불·연기·오로라·별똥별(프레임), 구름(흐름), 새(가끔 날아감), 거실 창밖 눈
// - 나무: 불규칙한 바람에 높이별로 휘는 모양. 프레임은 원본 나무에서 줄마다 옆으로 옮겨 만든다
//   (Claude Design의 나무 프레임과 같은 방식이지만, 띠 3~6개 대신 곡선으로 한 줄씩 옮겨 자연스럽게 휜다)
// - 눈: 코드로 만든 픽셀 눈송이, 바람 방향으로 비스듬히
// 픽셀아트가 뭉개지지 않도록 모든 이동은 그림 1픽셀 단위다.
import type { TreeSnapshot } from '@deulleotdagam/shared';
import motion from '../theme/pixel-motion.json';
import type { SvgAsset, ThemeAssets } from '../theme';
import twinkleCss from '../assets/pixel/twinkle-pixel.css?raw';
import { swagSvg } from './scene';

export type WindKind = 'breeze' | 'wind';
export interface BackgroundMotion { wind: WindKind | null; snow: 0 | 1 | 2 }

type FrameLayerSpec = { src: string; frames: number; fps: number; playOnce?: boolean; intervalSec?: number[] };

/** 배경별 움직임 설정: 나무 바람은 motion.json의 tree 값, 눈은 코드 설정 */
const SNOW: Record<string, 0 | 1 | 2> = { 'snowy-night': 2, village: 1 };
export function backgroundMotion(bgId: string): BackgroundMotion {
  const spec = (motion as Record<string, unknown>)[bgId] as { tree?: string } | undefined;
  const wind = spec?.tree === 'breeze' || spec?.tree === 'wind' ? spec.tree : null;
  return { wind, snow: SNOW[bgId] ?? 0 };
}

// ---------- 배경 레이어 ----------

const layerCache = new Map<string, Promise<string>>();
const birdSprites = new Map<string, { w: number; h: number; yMin: number; yMax: number; fps: number; px: number; every: number[]; svg: string }>();
function loadText(file: string): Promise<string> {
  let p = layerCache.get(file);
  if (!p) {
    p = fetch('/' + file.replace(/^\/+/, '')).then(r => { if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.text(); });
    p.catch(() => layerCache.delete(file));
    layerCache.set(file, p);
  }
  return p;
}

const svgInner = (raw: string) => raw.slice(raw.indexOf('>', raw.indexOf('<svg')) + 1, raw.lastIndexOf('</svg>'));
const frameGroups = (raw: string) => [...raw.matchAll(/<g class="f(\d+)"[^>]*>([\s\S]*?)<\/g>/g)].map(m => m[2]);

/** 프레임 레이어: 한 번에 한 프레임만 보이도록 CSS로 번갈아 보여준다 (room.css "배경 움직임") */
function frameLayerSvg(raw: string, spec: FrameLayerSpec, name: string): string {
  const frames = frameGroups(raw);
  const n = frames.length;
  const dur = n / spec.fps;
  const once = spec.playOnce ? ' fx-once' : '';
  return `<g class="fx-frames n${n}${once}" data-layer="${name}" style="--dur:${dur}s">`
    + frames.map((f, i) => `<g class="fx-f${i === 0 ? ' first' : ''}" style="animation-delay:${(i * dur) / n}s">${f}</g>`).join('')
    + '</g>';
}

/**
 * 배경 그림(바탕)에 얹을 움직이는 레이어들. 결과는 480×270 좌표의 SVG 조각이다.
 * 새와 별똥별처럼 가끔 나타나는 것은 여기서 자리만 만들고 시작은 startBackgroundTimers가 한다.
 */
export async function backgroundLayersSvg(bgId: string): Promise<string> {
  const spec = (motion as Record<string, any>)[bgId] as Record<string, any> | undefined;
  if (!spec) return '';
  const out: string[] = [];
  for (const name of (spec.layers ?? []) as string[]) {
    const l = spec[name];
    if (!l?.src) continue;
    const raw = await loadText(l.src).catch(() => '');
    if (!raw) continue;
    if (name === 'clouds') {
      // 끊김 없이 이어지는 구름 띠를 두 장 붙여 1픽셀씩 흘려보낸다
      const strip = `<svg width="${l.w}" height="${l.h}" viewBox="0 0 ${l.w} ${l.h}" shape-rendering="crispEdges">${svgInner(raw)}</svg>`;
      const secs = l.w / l.pxPerSec;
      out.push(`<g transform="translate(0 ${l.y})"><g class="fx-clouds${l.direction < 0 ? '' : ' rev'}" style="--w:${l.w};--dur:${secs}s">`
        + `${strip}<g transform="translate(${l.w} 0)">${strip}</g></g></g>`);
    } else if (name === 'bird') {
      // 새 그림은 날려 보낼 때마다 복사해 쓰므로 화면에 두지 않고 보관만 한다
      birdSprites.set(bgId, { w: l.w, h: l.h, yMin: l.yMin, yMax: l.yMax, fps: l.fps, px: l.pxPerFrame, every: l.intervalSec, svg: frameLayerSvg(raw, l, 'bird') });
      out.push(`<g class="fx-birds" data-bg="${bgId}"></g>`);
    } else {
      out.push(frameLayerSvg(raw, l, name));
    }
  }
  if (spec.window) out.push(windowSnowSvg(spec.windowVisible ?? spec.window, spec.windowMullions ?? []));
  return out.join('');
}

/** 거실 창밖 눈: 창틀(가로·세로 살)로 나뉜 유리 칸마다 따로 내리게 해서 창틀 위로 눈이 지나가지 않게 한다 */
function windowSnowSvg(win: { x: number; y: number; w: number; h: number }, bars: { x: number; y: number; w: number; h: number }[]): string {
  const xs = [win.x, win.x + win.w], ys = [win.y, win.y + win.h];
  for (const b of bars) {
    if (b.h >= win.h - 2) xs.splice(1, 0, b.x, b.x + b.w);
    else ys.splice(1, 0, b.y, b.y + b.h);
  }
  const panes: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < xs.length; i += 2) for (let j = 0; j < ys.length; j += 2)
    panes.push({ x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] });
  return panes.map(p => {
    const flakes = Array.from({ length: Math.max(3, Math.round((p.w * p.h) / 500)) }, () => {
      const dur = 6 + Math.random() * 5;
      return `<rect x="${Math.floor(Math.random() * p.w)}" y="-2" width="1" height="1" fill="#f5f8ff" class="fx-wsnow"`
        + ` style="--h:${p.h + 3};--dur:${dur.toFixed(1)}s;animation-delay:-${(Math.random() * dur).toFixed(1)}s"/>`;
    }).join('');
    // 중첩 svg는 자기 영역 밖을 잘라 준다
    return `<svg x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}" shape-rendering="crispEdges">${flakes}</svg>`;
  }).join('');
}

/** 가끔 나타나는 것(새, 별똥별)을 띄우는 타이머. 멈추는 함수를 돌려준다 */
export function startBackgroundTimers(bgSvg: SVGSVGElement, isActive: () => boolean): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (sec: number[], fn: () => void) => {
    const [a, b] = sec.length === 2 ? sec : [20, 40];
    timers.push(setTimeout(fn, (a + Math.random() * (b - a)) * 1000));
  };

  // 별똥별: 한 번 재생하고 다음 기회를 기다린다
  bgSvg.querySelectorAll<SVGGElement>('.fx-once').forEach(g => {
    const spec = (motion as Record<string, any>)['snowy-night']?.meteor as FrameLayerSpec | undefined;
    const loop = () => later(spec?.intervalSec ?? [20, 45], () => {
      if (isActive()) { g.classList.remove('play'); void g.getBoundingClientRect(); g.classList.add('play'); }
      loop();
    });
    timers.push(setTimeout(() => { if (isActive()) g.classList.add('play'); loop(); }, 4000));
  });

  // 새: 화면을 가로질러 날아간다
  bgSvg.querySelectorAll<SVGGElement>('.fx-birds').forEach(host => {
    const cfg = birdSprites.get(host.dataset.bg ?? '');
    if (!cfg) return;
    const fly = () => {
      if (isActive()) {
        const y = Math.round(cfg.yMin + Math.random() * (cfg.yMax - cfg.yMin));
        const distance = 480 + cfg.w * 2;
        const secs = distance / (cfg.px * cfg.fps);
        const bird = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        bird.setAttribute('transform', `translate(${-cfg.w} ${y})`);
        bird.innerHTML = `<g class="fx-bird" style="--dist:${distance};--dur:${secs}s;--steps:${Math.round(distance / cfg.px)}">`
          + `<svg width="${cfg.w}" height="${cfg.h}" viewBox="0 0 ${cfg.w} ${cfg.h}" shape-rendering="crispEdges">${cfg.svg}</svg></g>`;
        host.appendChild(bird);
        bird.querySelector('.fx-bird')?.addEventListener('animationend', () => bird.remove(), { once: true });
      }
      later(cfg.every, fly);
    };
    later([3, 8], fly);
  });

  return () => timers.forEach(clearTimeout);
}

/** 공유 이미지용: 바탕 + 각 레이어의 첫 프레임 + 구름 띠를 합친 정지 그림 */
export async function backgroundStillSvg(bgId: string, base: SvgAsset): Promise<SvgAsset> {
  const spec = (motion as Record<string, any>)[bgId] as Record<string, any> | undefined;
  const extra: string[] = [];
  for (const name of (spec?.layers ?? []) as string[]) {
    const l = spec![name];
    if (!l?.src || l.playOnce || name === 'bird') continue;
    const raw = await loadText(l.src).catch(() => '');
    if (!raw) continue;
    if (name === 'clouds') extra.push(`<svg y="${l.y}" width="480" height="${l.h}" viewBox="0 0 480 ${l.h}" shape-rendering="crispEdges">${svgInner(raw)}</svg>`);
    else extra.push(frameGroups(raw)[0] ?? '');
  }
  return { ...base, inner: base.inner + extra.join('') };
}

// ---------- 나무 바람 ----------

const TREE_TOP = 12;      // 나무 끝 줄 (그림 그리드)
const WIND_BIAS: Record<WindKind, number> = { breeze: 0.8, wind: 1.9 }; // 바람 방향(오른쪽)으로 기우는 정도

export function windMax(kind: WindKind): number {
  return Math.max(...(motion.tree[kind].topDx as number[]).map(Math.abs));
}

/** 줄(y)마다 옆으로 옮길 양: 줄기·화분은 0, 위로 갈수록 곡선으로 커진다 */
export function rowDx(theme: ThemeAssets, d: number, row: number): number {
  const trunk = theme.trunkStart;
  if (row >= trunk || d === 0) return 0;
  const t = Math.min(1, Math.max(0, (trunk - row) / (trunk - TREE_TOP)));
  return Math.round(d * Math.pow(t, 1.7));
}

/** 원본 나무의 사각형을 줄별로 옮긴 프레임 SVG (반짝임 CSS 포함, <img>로 쓴다) */
export function treeFrameSvg(theme: ThemeAssets, d: number): string {
  const rects: string[] = [];
  for (const m of theme.tree.inner.matchAll(/<rect\b([^>]*?)\/?>(?:<\/rect>)?/g)) {
    const attrs = m[1];
    const x = Number(/\bx="(-?\d+)"/.exec(attrs)?.[1]);
    const y = Number(/\by="(\d+)"/.exec(attrs)?.[1]);
    const h = Number(/\bheight="(\d+)"/.exec(attrs)?.[1]);
    // 같은 이동량이 이어지는 줄끼리는 한 사각형으로 둔다
    let start = y;
    for (let row = y; row <= y + h; row++) {
      if (row < y + h && rowDx(theme, d, row) === rowDx(theme, d, start)) continue;
      const dx = rowDx(theme, d, start);
      rects.push(`<rect${attrs.replace(/\bx="-?\d+"/, `x="${x + dx}"`).replace(/\by="\d+"/, `y="${start}"`).replace(/\bheight="\d+"/, `height="${row - start}"`)}/>`);
      start = row;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${theme.tree.viewBox}" width="${theme.tree.width}" height="${theme.tree.height}" shape-rendering="crispEdges"><style>${twinkleCss}</style>${rects.join('')}</svg>`;
}

const frameUrlCache = new Map<string, Promise<Map<number, string>>>();

/** -max~+max 모든 기울기의 나무 프레임을 이미지로 만들어 둔다 (바람 부는 배경에서만) */
export function treeFrames(theme: ThemeAssets, kind: WindKind): Promise<Map<number, string>> {
  const key = theme.geometry.id + ':' + kind;
  let p = frameUrlCache.get(key);
  if (!p) {
    p = (async () => {
      const max = windMax(kind);
      const urls = new Map<number, string>();
      for (let d = -max; d <= max; d++) {
        const url = URL.createObjectURL(new Blob([treeFrameSvg(theme, d)], { type: 'image/svg+xml' }));
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        urls.set(d, url);
      }
      return urls;
    })();
    frameUrlCache.set(key, p);
  }
  return p;
}

/** 방 화면 나무(정지): 나무 그림 + 조명을 한 장의 SVG로 */
export function treeStaticHtml(theme: ThemeAssets, tree: Pick<TreeSnapshot, 'bands'>): string {
  const g = theme.geometry;
  const bands = g.bands.map(b => (tree.bands[b.id] ? swagSvg(theme, tree.bands[b.id], b) : '')).join('');
  return `<svg class="layer" viewBox="${g.stageViewBox.join(' ')}" shape-rendering="crispEdges" aria-hidden="true">`
    + `<svg width="${g.width}" height="${g.height}" viewBox="${theme.tree.viewBox}" shape-rendering="crispEdges">${theme.tree.inner}</svg>${bands}</svg>`;
}

/** 방 화면 나무(바람): 프레임 이미지 한 장 + 조명 띠를 띠마다 따로 (나무와 같이 옮기기 위해) */
export function treeAnimatedHtml(theme: ThemeAssets, tree: Pick<TreeSnapshot, 'bands'>, src: string): string {
  const g = theme.geometry;
  const [, vy, , vh] = g.stageViewBox;
  const top = ((0 - vy) / vh) * 100, height = (g.height / vh) * 100;
  const bands = g.bands.filter(b => tree.bands[b.id]).map(b =>
    `<svg class="layer band" data-row="${Math.round((b.y + 3) * (theme.tree.width / g.width))}" viewBox="${g.stageViewBox.join(' ')}" shape-rendering="crispEdges" aria-hidden="true">${swagSvg(theme, tree.bands[b.id], b)}</svg>`).join('');
  return `<img class="layer tree-frame" src="${src}" alt="" style="top:${top}%;height:${height}%" draggable="false">${bands}`;
}

/**
 * 바람 엔진: 나무마다 불규칙한 바람(느린 흔들림 + 돌풍 + 잠잠함)을 따라 기울기를 바꾼다.
 * 한 번에 1픽셀씩만 움직여 중간 모양을 거치고, 세 나무는 바람이 지나가듯 조금씩 늦게 반응한다.
 */
export class TreeWind {
  private timer: ReturnType<typeof setInterval> | undefined;
  private cur = new Map<string, number>();
  private seed = Math.random() * 1000;

  constructor(
    private theme: ThemeAssets,
    private kind: WindKind,
    private urls: Map<number, string>,
    private wraps: () => { id: string; position: number; el: HTMLElement }[],
  ) {}

  start() {
    if (this.timer) return;
    const tick = this.kind === 'wind' ? 125 : 160;
    this.timer = setInterval(() => this.step(), tick);
    this.step();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 슬롯이 다시 그려진 뒤 현재 기울기를 다시 적용 */
  refresh(id: string) {
    const w = this.wraps().find(x => x.id === id);
    if (w) this.apply(w.el, this.cur.get(id) ?? 0, true);
  }

  private target(t: number, position: number): number {
    const max = windMax(this.kind);
    const s = this.seed + position * 17.3;
    const tt = t - position * 0.45; // 왼쪽 나무부터 바람이 닿는다
    // 느린 흔들림 몇 개를 겹친 부드러운 잡음 (-1 ~ 1)
    const n = 0.55 * Math.sin(tt * 0.95 + s) + 0.3 * Math.sin(tt * 2.3 + s * 1.7) + 0.15 * Math.sin(tt * 4.1 + s * 0.3);
    // 돌풍과 잠잠함: 10~20초 주기로 세기가 오르내린다
    const gust = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(tt * 0.33 + s * 0.11), 2);
    const bias = WIND_BIAS[this.kind] * (0.4 + 0.6 * gust);
    return Math.max(-max, Math.min(max, bias + n * max * 0.95 * gust));
  }

  private step() {
    const t = performance.now() / 1000;
    for (const w of this.wraps()) {
      const goal = Math.round(this.target(t, w.position));
      const now = this.cur.get(w.id) ?? 0;
      const next = now + Math.sign(goal - now);
      if (next !== now || !this.cur.has(w.id)) {
        this.cur.set(w.id, next);
        this.apply(w.el, next, false);
      }
    }
  }

  private apply(wrap: HTMLElement, d: number, force: boolean) {
    const img = wrap.querySelector<HTMLImageElement>('img.tree-frame');
    const url = this.urls.get(d);
    if (img && url && (force || img.getAttribute('src') !== url)) img.src = url;
    const scale = this.theme.tree.width / this.theme.geometry.width;
    // 장식과 조명도 자기 높이의 나무 줄과 같은 만큼 옮긴다
    wrap.querySelectorAll<HTMLElement>('.slot').forEach(el => {
      const dx = rowDx(this.theme, d, Math.round(Number(el.dataset.ty) * scale));
      el.style.translate = dx ? `calc(${dx} * 100cqw / ${this.theme.tree.width}) 0` : '';
    });
    wrap.querySelectorAll<SVGElement>('svg.band').forEach(el => {
      const dx = rowDx(this.theme, d, Number(el.dataset.row));
      el.style.translate = dx ? `calc(${dx} * 100cqw / ${this.theme.tree.width}) 0` : '';
    });
  }
}

// ---------- 눈 ----------

/**
 * 내리는 눈: 나무 뒤(작고 많게)와 앞(크고 적게) 두 겹.
 * 눈송이 크기는 배경 그림 1픽셀(또는 2픽셀)에 맞추고, 바람이 불면 바람 방향으로 흘러간다.
 */
export function snowHtml(level: 0 | 1 | 2): { back: string; front: string } {
  if (!level) return { back: '', front: '' };
  const counts = level === 2 ? [46, 14] : [24, 6];
  const flake = (front: boolean) => {
    const dur = (front ? 7 : 11) + Math.random() * (front ? 4 : 7);
    const style = [
      `left:${(Math.random() * 110 - 10).toFixed(2)}%`,
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

