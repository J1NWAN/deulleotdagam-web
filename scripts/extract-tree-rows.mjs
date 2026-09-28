// tree.svg의 <rect>를 읽어 줄별 나무 윤곽(좌우 끝 x)을 구한다. 04 문서 3절 "나무 윤곽 데이터".
// 그림은 고해상도 그리드(예: 144×192)로 그리고, 슬롯 좌표계는 48×64 단위를 유지한다.
// scale = 그리드 픽셀 / 좌표 단위 (144/48 = 3). 좌표 단위 한 줄 = 그리드 scale줄을 합친 범위.
// 사용법: node scripts/extract-tree-rows.mjs [svg 경로] [시작 y] [끝 y]   (y는 좌표 단위)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 그리드 줄별 [min x, max x] */
export function extractGridRows(svg) {
  const rows = {};
  for (const m of svg.matchAll(/<rect\b([^>]*)>/g)) {
    const attr = n => Number((m[1].match(new RegExp(`\\b${n}="([\\d.]+)"`)) || [])[1]);
    const x = attr('x'), y = attr('y'), w = attr('width'), h = attr('height');
    for (let yy = y; yy < y + h; yy++) {
      const r = rows[yy] || (rows[yy] = [Infinity, -Infinity]);
      r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x + w);
    }
  }
  return rows;
}

/** 슬롯 좌표 단위(48×64) 줄별 [왼쪽 끝, 오른쪽 끝]. 소수 둘째 자리까지 */
export function extractRows(svg, y0 = 5, y1 = 51, unitWidth = 48) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const scale = vb ? Number(vb[1]) / unitWidth : 1;
  const grid = extractGridRows(svg);
  const rows = {};
  for (let y = y0; y <= y1; y++) {
    const parts = [];
    for (let k = 0; k < scale; k++) if (grid[y * scale + k]) parts.push(grid[y * scale + k]);
    if (!parts.length) continue;
    const round = v => Math.round((v / scale) * 100) / 100;
    rows[y] = [round(Math.min(...parts.map(p => p[0]))), round(Math.max(...parts.map(p => p[1])))];
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] || 'packages/web/src/assets/pixel/tree.svg';
  const rows = extractRows(readFileSync(path, 'utf8'), Number(process.argv[3] || 5), Number(process.argv[4] || 51));
  console.log('{' + Object.entries(rows).map(([y, [a, b]]) => `${y}:[${a},${b}]`).join(',') + '}');
}
