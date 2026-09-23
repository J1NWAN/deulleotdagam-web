// tree.svg의 <rect>를 읽어 픽셀 줄별 좌우 끝(x)을 구한다. 04 문서 3절 "나무 윤곽 데이터".
// 사용법: node scripts/extract-tree-rows.mjs [svg 경로] [시작 y] [끝 y]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function extractRows(svg, y0 = 5, y1 = 51) {
  const rows = {};
  for (const m of svg.matchAll(/<rect\b([^>]*)>/g)) {
    const attr = n => Number((m[1].match(new RegExp(`\\b${n}="([\\d.]+)"`)) || [])[1]);
    const x = attr('x'), y = attr('y'), w = attr('width'), h = attr('height');
    for (let yy = y; yy < y + h; yy++) {
      if (yy < y0 || yy > y1) continue;
      const r = rows[yy] || (rows[yy] = [Infinity, -Infinity]);
      r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x + w);
    }
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] || 'packages/web/src/assets/pixel/tree.svg';
  const rows = extractRows(readFileSync(path, 'utf8'), Number(process.argv[3] || 5), Number(process.argv[4] || 51));
  console.log('{' + Object.entries(rows).map(([y, [a, b]]) => `${y}:[${a},${b}]`).join(',') + '}');
}
