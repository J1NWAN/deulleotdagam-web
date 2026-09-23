# 04. 나무, 슬롯, 조명 배치 규칙

기준: `prototype/pixel-3trees.html` (픽셀아트). 플랫 버전 값은 마지막 절에 정리했습니다.

## 1. 좌표계 (픽셀 테마)
- `tree.svg`는 `viewBox="0 0 48 64"` (1단위 = 도트 1칸). 윗부분에 별이 올라갈 여백을 두기 위해 화면에서는 **`viewBox="0 -4 48 68"`** 로 그립니다.
- 슬롯 좌표 `(x, y)`는 슬롯 **중심점**, `size`는 장식 한 변의 길이이며 모두 이 트리 좌표계 단위입니다.
- 화면 배치(퍼센트): `left = x/48`, `top = (y+4)/68`, `width = size/48` (컨테이너 비율 48:68)
- 장식 SVG는 `viewBox="0 0 16 16"`, 조명 SVG는 `64×12` 또는 `64×14`
- 도트가 뭉개지지 않도록 SVG에 `shape-rendering="crispEdges"`

## 2. 나무 3그루
| tree_id | 이름 | scale | 배치 |
|---|---|---|---|
| A | 첫째 나무 | 0.86 | 왼쪽 |
| B | 둘째 나무 | 1.0 | 가운데 |
| C | 셋째 나무 | 0.86 | 오른쪽 |

- 데스크톱: 세 그루를 한 화면에 나란히 (`container-type: size`로 무대 크기에 맞춰 폭 계산)
- 모바일(760px 이하): 한 그루씩 크게, 가로 스와이프(`scroll-snap`). 세 그루를 한꺼번에 넣으면 장식이 손가락으로 누르기 어려울 만큼 작아지기 때문
- 나무 아래 이름표: "첫째 나무 3/14", 가득 차면 "완성"

## 3. 슬롯 생성 알고리즘 (층별 구역 + 최소 칸 보장)

### 규칙
- 슬롯 = **꼭대기 별 슬롯 1개** + **몸통 슬롯 10~14개** (나무마다 개수 랜덤)
- 몸통은 트리 그림의 네 층에 맞춘 **네 구역**으로 나누고, 구역마다 최소/최대 칸 수를 둠

| 구역 | y 범위 | 최소 | 최대 |
|---|---|---|---|
| 1층 | 9 ~ 19 | 1 | 2 |
| 2층 | 21 ~ 30 | 2 | 4 |
| 3층 | 31 ~ 40 | 3 | 5 |
| 4층 | 41 ~ 50 | 4 | 6 |

최소 칸 합계가 10이므로 "시즌별 최소 슬롯 10개" 기획이 자동으로 지켜집니다.

### 순서
1. 나무별 목표 개수 `want` = 10~14 중 랜덤
2. **1층부터** 각 구역의 최소 칸을 채움 (가장 좁은 층이 먼저 자리를 잡아야 실패하지 않음)
3. 남은 칸은 **구역 넓이에 비례한 가중치**로 구역을 골라 추가 (최대 칸 수를 넘는 구역은 제외)
4. 한 칸을 놓을 때: 크기 `5.8 ~ 7.4`, 구역 안에서 y를 고르고, 그 줄의 나무 좌우 끝(`ROWS`)에서 크기의 42%만큼 안쪽으로 x를 고름. 기존 슬롯과 **중심 거리 ≥ (두 크기 합)/2 + 0.4** 이어야 채택
5. 최소 칸을 못 채우면 그 라운드를 버리고 다시 (최대 40라운드)
6. y → x 순으로 정렬하고 `s1, s2, …` id 부여 (키보드 탐색 순서)

프로토타입에서 시드 3,000개로 검증: **최소/최대 위반 0건**, 몸통 칸 수 10~14가 고르게 분포.

### 나무 윤곽 데이터 (`tree.svg` 픽셀 줄별 좌우 끝, 픽셀 테마 전용)
```ts
// y: [왼쪽 끝 x, 오른쪽 끝 x]
export const PIXEL_TREE_ROWS: Record<number, [number, number]> = {5:[22,26],6:[21,27],7:[21,27],8:[20,28],9:[20,28],10:[20,28],11:[19,29],12:[19,29],13:[19,29],14:[18,30],15:[18,30],16:[18,30],17:[17,31],18:[17,31],19:[17,31],20:[16,32],21:[17,31],22:[16,32],23:[16,32],24:[15,33],25:[14,34],26:[14,34],27:[14,34],28:[13,35],29:[12,36],30:[13,35],31:[12,36],32:[13,35],33:[13,35],34:[12,36],35:[11,37],36:[10,38],37:[9,39],38:[8,40],39:[8,40],40:[7,41],41:[8,40],42:[9,39],43:[9,39],44:[8,40],45:[7,41],46:[6,42],47:[5,43],48:[4,44],49:[3,45],50:[2,46],51:[1,47]};
```
`tree.svg`를 바꾸면 이 표도 다시 뽑아야 합니다. SVG의 `<rect>`를 읽어 줄별 min/max x를 구하는 **빌드 스크립트**로 만들어 두는 것을 권장합니다.

### TypeScript 이식본
```ts
export interface Zone { id: number; label: string; y0: number; y1: number; min: number; max: number }
export interface Slot { id: string; x: number; y: number; size: number; zone: number | null; isTop: boolean }

export const PIXEL_ZONES: Zone[] = [
  { id: 1, label: '1층', y0: 9,  y1: 19, min: 1, max: 2 },
  { id: 2, label: '2층', y0: 21, y1: 30, min: 2, max: 4 },
  { id: 3, label: '3층', y0: 31, y1: 40, min: 3, max: 5 },
  { id: 4, label: '4층', y0: 41, y1: 50, min: 4, max: 6 },
];
export const MIN_BODY_SLOTS = 10;
export const MAX_BODY_SLOTS = 14;
const TOP_SLOT: Slot = { id: 'top', x: 24, y: 2.2, size: 9, zone: null, isTop: true };

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

function zoneArea(z: Zone, rows: Record<number, [number, number]>): number {
  let a = 0;
  for (let y = z.y0; y <= z.y1; y++) a += rows[y][1] - rows[y][0];
  return a;
}

function tryPlace(r: () => number, z: Zone, rows: Record<number, [number, number]>, out: Placed[]): boolean {
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

export function generateSlots(
  seed: number,
  rows: Record<number, [number, number]> = PIXEL_TREE_ROWS,
  zones: Zone[] = PIXEL_ZONES,
): Slot[] {
  const r = mulberry32(seed);
  const want = MIN_BODY_SLOTS + Math.floor(r() * (MAX_BODY_SLOTS - MIN_BODY_SLOTS + 1));
  for (let round = 0; round < 40; round++) {
    const out: Placed[] = [];
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
    return [TOP_SLOT, ...out.map((o, i) => ({ id: 's' + (i + 1), ...o, isTop: false }))];
  }
  throw new Error('slot generation failed');
}
```

- 방 생성 시 나무별 시드는 `roomSeed + index * 9973`로 만들었지만, **결과 좌표를 DB에 저장**하므로 시드는 디버깅용 기록일 뿐입니다.
- 단위 테스트 필수: 시드 수천 개로 ① 구역별 최소/최대 ② 몸통 10~14 ③ 슬롯끼리 겹침 없음 ④ 모든 슬롯이 나무 윤곽 안.

## 4. 조명(가랜드) 배치
- 층 하단 가장자리에 걸치는 3개의 띠: `b1`(2층), `b2`(3층), `b3`(4층)
- 픽셀 테마 값 (트리 좌표계)

| band | 라벨 | 중심 x | 보이는 폭 w | 위쪽 y |
|---|---|---|---|---|
| b1 | 2층 | 24 | 22 | 25.2 |
| b2 | 3층 | 24 | 30 | 35.2 |
| b3 | 4층 | 24 | 39.5 | 45.6 |

- **도트 크기를 층마다 같게 유지**하려고, 조명 SVG를 늘리지 않고 **고정 배율 0.62**로 그린 뒤 가운데 부분만 잘라 씁니다:
  `visibleWidth = min(64, w / 0.62)`, 중첩 `<svg>`의 `viewBox="((64-visibleWidth)/2) 0 visibleWidth H"`, 실제 크기 `visibleWidth*0.62 × H*0.62`
- 조명 종류: `lights-string`(컬러 전구), `garland-gold`(금빛 가랜드), `bead-chain`(구슬 줄), `fairy-lights`(요정 전구), 또는 없음
- 프로토타입 기본값: A = {b2: bead-chain, b3: fairy-lights}, B = {b1: fairy-lights, b2: garland-gold, b3: lights-string}, C = {b1: garland-gold, b3: lights-string}

## 5. 반짝임 애니메이션
- SVG를 **인라인으로 삽입**해야 CSS 애니메이션이 적용됩니다 (`<img>`로 넣으면 동작하지 않음)
- 픽셀 테마: `assets/pixel/twinkle-pixel.css` — 클래스 접두어 `px-`, 일시정지 클래스 `px-paused`
- 플랫 테마: `assets/flat/twinkle-flat.css` — 접두어 `fl-`, 일시정지 `fl-paused`
- ⚠️ 두 파일이 원래 같은 이름(`twinkle.css`)이라 한쪽이 덮어써져 반짝임이 사라진 적이 있음. **테마별 파일명을 분리해서 유지**하고, 테마 설정에서 CSS와 접두어를 함께 지정하세요.
- 두 CSS 모두 `prefers-reduced-motion`에서 애니메이션을 끕니다.

## 6. 플랫 테마 값 (추후 검토용 — 지금은 구현하지 않음)

참고: `prototype/flat-1tree.html`, 나무 1그루·고정 슬롯 버전
- `tree.svg` `viewBox="0 0 400 510"`, 화면 `viewBox="0 -50 400 560"`, 화분 없음(줄기만)
- 장식 `viewBox="0 0 100 100"`, 조명은 `400×56 ~ 400×84` 벡터 → **자르지 않고 층 폭에 맞춰 통째로 축소**
- 층 하단 대략값: 1층 y≈160, 2층 ≈250, 3층 ≈345, 4층 ≈440 / 조명 폭 205, 275, 345
- 트리 SVG가 `<path>` 기반이라 픽셀처럼 줄별 윤곽을 바로 뽑을 수 없음. 플랫 테마를 채택하면 **래스터화해서 줄별 윤곽을 측정**하거나 층별 사다리꼴로 근사해 `ROWS`/`ZONES`를 새로 만들어야 합니다.
- `tree.svg`에 `clipPath` id(`tree-c1` 등)가 있어 **한 페이지에 나무를 여러 번 인라인하면 id가 충돌**합니다. 3그루로 만들 때는 인스턴스마다 id 접두어를 바꿔 주세요.
