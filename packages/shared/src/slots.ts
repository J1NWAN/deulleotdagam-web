import { PIXEL_THEME, type Slot, type ThemeGeometry, type TreeRows, type Zone } from './theme';

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Placed = { x: number; y: number; size: number; zone: number };

function zoneArea(z: Zone, rows: TreeRows): number {
  let a = 0;
  for (let y = z.y0; y <= z.y1; y++) a += rows[y][1] - rows[y][0];
  return a;
}

function tryPlace(r: () => number, z: Zone, rows: TreeRows, out: Placed[]): boolean {
  for (let tries = 0; tries < 400; tries++) {
    const size = 5.8 + r() * 1.6;
    const y = z.y0 + r() * (z.y1 - z.y0);
    const row = rows[Math.round(y)];
    const lo = row[0] + size * 0.42, hi = row[1] - size * 0.42;
    if (hi <= lo) continue;
    const x = lo + r() * (hi - lo);
    if (out.every(o => Math.hypot(o.x - x, o.y - y) >= (o.size + size) / 2 + 0.4)) {
      out.push({ x: +x.toFixed(2), y: +y.toFixed(2), size: +size.toFixed(2), zone: z.id });
      return true;
    }
  }
  return false;
}

/** 나무 한 그루의 슬롯: 꼭대기 별 슬롯 1개 + 층별 구역 기반 몸통 슬롯 (04 문서 3절) */
export function generateSlots(seed: number, theme: ThemeGeometry = PIXEL_THEME): Slot[] {
  const { rows, zones } = theme;
  const r = mulberry32(seed);
  const want = theme.minBodySlots + Math.floor(r() * (theme.maxBodySlots - theme.minBodySlots + 1));
  for (let round = 0; round < 40; round++) {
    const out: Placed[] = [];
    // 가장 좁은 1층부터 최소 칸을 채워야 넓은 층에 밀려 실패하지 않는다
    const ok = zones.every(z => { for (let i = 0; i < z.min; i++) if (!tryPlace(r, z, rows, out)) return false; return true; });
    if (!ok) continue;
    for (let guard = 0; out.length < want && guard < 200; guard++) {
      const open = zones.filter(z => out.filter(o => o.zone === z.id).length < z.max);
      if (!open.length) break;
      const total = open.reduce((n, z) => n + zoneArea(z, rows), 0);
      let pick = r() * total, chosen = open[0];
      for (const c of open) { pick -= zoneArea(c, rows); if (pick <= 0) { chosen = c; break; } }
      tryPlace(r, chosen, rows, out);
    }
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return [{ ...theme.topSlot }, ...out.map((o, i) => ({ id: 's' + (i + 1), ...o, isTop: false }))];
  }
  throw new Error('slot generation failed');
}

/** 방 하나의 나무별 슬롯. 결과 좌표를 서버에 저장하므로 시드는 디버깅용 기록일 뿐이다. */
export function generateLayout(roomSeed: number, theme: ThemeGeometry = PIXEL_THEME): Record<string, Slot[]> {
  return Object.fromEntries(theme.trees.map((t, i) => [t.id, generateSlots(roomSeed + i * 9973, theme)]));
}
