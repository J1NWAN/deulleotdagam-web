import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateLayout, generateSlots, PIXEL_THEME, PIXEL_TREE_ROWS } from '../src';
// @ts-expect-error 타입 없는 빌드 스크립트
import { extractRows } from '../../../scripts/extract-tree-rows.mjs';

const SEEDS = 3000;
const T = PIXEL_THEME;

describe('generateSlots (층별 구역 + 최소 칸 보장)', () => {
  const all = Array.from({ length: SEEDS }, (_, i) => generateSlots(i * 7919 + 1));

  it('꼭대기 별 슬롯 1개가 맨 앞에 있다', () => {
    for (const slots of all) {
      expect(slots[0]).toEqual({ id: 'top', x: 24, y: 2.2, size: 9, zone: null, isTop: true });
      expect(slots.filter(s => s.isTop)).toHaveLength(1);
    }
  });

  it('몸통 슬롯은 10~14개이고 개수가 고르게 나온다', () => {
    const hist: Record<number, number> = {};
    for (const slots of all) {
      const n = slots.length - 1;
      expect(n).toBeGreaterThanOrEqual(T.minBodySlots);
      expect(n).toBeLessThanOrEqual(T.maxBodySlots);
      hist[n] = (hist[n] ?? 0) + 1;
    }
    for (let n = 10; n <= 14; n++) expect(hist[n]).toBeGreaterThan(SEEDS / 5 * 0.6);
  });

  it('구역별 최소/최대 칸 위반이 없다', () => {
    for (const slots of all) {
      for (const z of T.zones) {
        const c = slots.filter(s => s.zone === z.id).length;
        expect(c, `zone ${z.id}`).toBeGreaterThanOrEqual(z.min);
        expect(c, `zone ${z.id}`).toBeLessThanOrEqual(z.max);
      }
    }
  });

  it('슬롯끼리 겹치지 않는다', () => {
    for (const slots of all) {
      const body = slots.filter(s => !s.isTop);
      for (let i = 0; i < body.length; i++)
        for (let j = i + 1; j < body.length; j++) {
          const a = body[i], b = body[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual((a.size + b.size) / 2 + 0.4 - 0.02);
        }
    }
  });

  it('모든 몸통 슬롯 중심이 자기 구역과 나무 윤곽 안에 있다', () => {
    for (const slots of all) {
      for (const s of slots.filter(s => !s.isTop)) {
        const z = T.zones.find(z => z.id === s.zone)!;
        expect(s.y).toBeGreaterThanOrEqual(z.y0);
        expect(s.y).toBeLessThanOrEqual(z.y1);
        // 좌표는 소수 둘째 자리로 반올림해 저장하므로 y가 x.50이면 알고리즘이 본 줄은 바로 윗줄일 수 있다
        const cand = Math.abs(s.y % 1 - 0.5) < 0.006 ? [Math.floor(s.y), Math.ceil(s.y)] : [Math.round(s.y)];
        const l = Math.min(...cand.map(y => PIXEL_TREE_ROWS[y][0]));
        const r = Math.max(...cand.map(y => PIXEL_TREE_ROWS[y][1]));
        expect(s.x - s.size * 0.42).toBeGreaterThanOrEqual(l - 0.01);
        expect(s.x + s.size * 0.42).toBeLessThanOrEqual(r + 0.01);
        expect(s.size).toBeGreaterThanOrEqual(5.8);
        expect(s.size).toBeLessThanOrEqual(7.4);
      }
    }
  });

  it('id는 y→x 순서로 s1, s2, ... 이다', () => {
    for (const slots of all.slice(0, 200)) {
      const body = slots.slice(1);
      body.forEach((s, i) => expect(s.id).toBe('s' + (i + 1)));
      for (let i = 1; i < body.length; i++) {
        const a = body[i - 1], b = body[i];
        expect(a.y < b.y || (a.y === b.y && a.x <= b.x)).toBe(true);
      }
    }
  });

  it('같은 시드면 같은 결과', () => {
    expect(generateSlots(42)).toEqual(generateSlots(42));
    expect(generateLayout(7)).toEqual(generateLayout(7));
  });

  it('방 레이아웃은 나무 3그루', () => {
    const layout = generateLayout(123);
    expect(Object.keys(layout)).toEqual(['A', 'B', 'C']);
  });
});

describe('나무 윤곽 데이터', () => {
  it('PIXEL_TREE_ROWS가 tree.svg에서 뽑은 값과 같다', () => {
    const svg = readFileSync(new URL('../../web/src/assets/pixel/tree.svg', import.meta.url), 'utf8');
    const rows = extractRows(svg, 5, 51);
    expect(Object.fromEntries(Object.entries(rows).map(([y, v]) => [Number(y), v]))).toEqual(PIXEL_TREE_ROWS);
  });
});
