import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgroundMotion, rowDx, treeFrameSvg, windMax } from '../src/render/fx';
import motion from '../src/theme/pixel-motion.json';
import { themeAssets } from '../src/theme';

const theme = themeAssets('pixel');

/** SVG 사각형들을 (x,y) → 색 지도로 */
function pixels(inner: string): Map<string, string> {
  const px = new Map<string, string>();
  for (const m of inner.matchAll(/<rect\b([^>]*?)\/?>/g)) {
    const a = (n: string) => /\b(\w+)="/.test(n) ? (new RegExp(`\\b${n}="([^"]+)"`).exec(m[1])?.[1] ?? '') : '';
    const x = +a('x'), y = +a('y'), w = +a('width'), h = +a('height');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px.set(`${xx},${yy}`, a('fill'));
  }
  return px;
}

describe('나무 바람 프레임', () => {
  it('줄기·화분은 움직이지 않고, 위로 갈수록 덜하지 않게 휜다', () => {
    for (const d of [-5, -3, 3, 5]) {
      for (let row = theme.trunkStart; row < 192; row++) expect(rowDx(theme, d, row)).toBe(0);
      let prev = 0;
      for (let row = theme.trunkStart - 1; row >= 12; row--) {
        const dx = Math.abs(rowDx(theme, d, row));
        expect(dx).toBeGreaterThanOrEqual(prev);
        prev = dx;
      }
      expect(rowDx(theme, d, 12)).toBe(d); // 꼭대기는 정확히 d픽셀
    }
  });

  it('프레임은 원본 나무를 줄마다 rowDx만큼 옮긴 것과 픽셀 단위로 같다', () => {
    const base = pixels(theme.tree.inner);
    for (const d of [-5, -2, 0, 1, 4]) {
      const frame = pixels(treeFrameSvg(theme, d));
      const expected = new Map([...base].map(([k, c]) => {
        const [x, y] = k.split(',').map(Number);
        return [`${x + rowDx(theme, d, y)},${y}`, c];
      }));
      expect(frame.size).toBe(expected.size);
      for (const [k, c] of expected) expect(frame.get(k), `d=${d} ${k}`).toBe(c);
    }
  });

  it('최대 기울기는 motion.json(Claude Design 설정)을 따른다', () => {
    expect(windMax('breeze')).toBe(3);
    expect(windMax('wind')).toBe(5);
  });
});

describe('배경 움직임 설정 (motion.json)', () => {
  it('배경별 바람: 거실은 없음, 새벽은 센 바람', () => {
    expect(backgroundMotion('living-room').wind).toBeNull();
    expect(backgroundMotion('winter-dawn').wind).toBe('wind');
    expect(backgroundMotion('snowy-night')).toEqual({ wind: 'breeze', snow: 2 });
  });

  it('레이어 파일이 모두 있고 프레임 수가 설정과 같다', () => {
    const m = motion as Record<string, any>;
    for (const bg of theme.geometry.backgrounds) {
      const spec = m[bg.id];
      expect(spec, bg.id).toBeTruthy();
      for (const name of spec.layers ?? []) {
        const file = new URL(`../public/${spec[name].src}`, import.meta.url);
        expect(existsSync(file), `${bg.id}/${name}`).toBe(true);
        const svg = readFileSync(file, 'utf8');
        expect(svg).not.toMatch(/\bid="|<style|<metadata|c2pa|<image/);
        if (spec[name].frames) expect((svg.match(/<g class="f\d+"/g) ?? []).length, `${bg.id}/${name}`).toBe(spec[name].frames);
      }
    }
  });
});
