// 시즌 오브젝트(트리)의 스타일 의존 값. 테마를 추가할 때는 ThemeGeometry를 하나 더 만들면 된다.
// SVG 문자열과 반짝임 CSS는 프론트(@deulleotdagam/web)의 테마 설정에 있다.

export interface Zone { id: number; label: string; y0: number; y1: number; min: number; max: number }
export interface Slot { id: string; x: number; y: number; size: number; zone: number | null; isTop: boolean }
export interface Band { id: string; label: string; cx: number; w: number; y: number }
export interface TreeDef { id: string; name: string; scale: number; position: number }
export interface NamedItem { id: string; name: string }

export type TreeRows = Record<number, [number, number]>;

export interface ThemeGeometry {
  id: string;
  /** 트리 SVG 원본 viewBox의 폭/높이 (슬롯 좌표계) */
  width: number;
  height: number;
  /** 화면에 그릴 때의 viewBox (꼭대기 별 여백 포함) */
  stageViewBox: [number, number, number, number];
  rows: TreeRows;
  zones: Zone[];
  topSlot: Slot;
  minBodySlots: number;
  maxBodySlots: number;
  trees: TreeDef[];
  bands: Band[];
  /** 사용자가 다는 장식 */
  items: NamedItem[];
  /** 방장이 층별로 고르는 조명/가랜드 */
  strings: NamedItem[];
  topItem: string;
  /** 방 배경 (그림은 web/public/backgrounds/bg-{id}.svg). 방을 만들 때 고르고 방장이 바꿀 수 있다 */
  backgrounds: NamedItem[];
  defaultBackground: string;
  /** 방을 만들 때 기본으로 걸어 두는 조명 */
  defaultBands: Record<string, Record<string, string>>;
}

// 나무 윤곽: 줄(좌표 단위 y)별 좌우 끝 x. tree.svg(144×192 그리드, 좌표 단위의 3배)에서
// scripts/extract-tree-rows.mjs로 뽑은 값이며, 테스트에서 그림과 일치하는지 확인한다.
// 이미 만든 방은 만들 때 저장한 슬롯 좌표를 그대로 쓰므로 이 값이 바뀌어도 영향이 없다.
export const PIXEL_TREE_ROWS: TreeRows = {5:[23,25],6:[22.67,25.33],7:[22.33,25.67],8:[22,26],9:[21.33,26.67],10:[21,27],11:[20.67,27.33],12:[20.33,27.67],13:[19.67,28.33],14:[19.33,28.67],15:[19,29],16:[18.67,29.33],17:[18.33,29.67],18:[17.67,30.33],19:[17,31],20:[16,32],21:[16,32],22:[16.67,31.33],23:[16.33,31.67],24:[15.67,32.33],25:[15.33,32.67],26:[15,33],27:[14.33,33.67],28:[13.67,34.33],29:[12.33,35.67],30:[12,36],31:[12.67,35.33],32:[13,35],33:[12.33,35.67],34:[11.67,36.33],35:[11.33,36.67],36:[10.67,37.33],37:[10,38],38:[9,39],39:[7.67,40.33],40:[7,41],41:[7.33,40.67],42:[10,38],43:[9,39],44:[8.33,39.67],45:[7.33,40.67],46:[6.33,41.67],47:[5.67,42.33],48:[4.67,43.33],49:[3.33,44.67],50:[1.67,46.33],51:[1,47]};

export const PIXEL_ZONES: Zone[] = [
  { id: 1, label: '1층', y0: 9,  y1: 19, min: 1, max: 2 },
  { id: 2, label: '2층', y0: 21, y1: 30, min: 2, max: 4 },
  { id: 3, label: '3층', y0: 31, y1: 40, min: 3, max: 5 },
  { id: 4, label: '4층', y0: 41, y1: 50, min: 4, max: 6 },
];

export const PIXEL_THEME: ThemeGeometry = {
  id: 'pixel',
  width: 48,
  height: 64,
  stageViewBox: [0, -4, 48, 68],
  rows: PIXEL_TREE_ROWS,
  zones: PIXEL_ZONES,
  topSlot: { id: 'top', x: 24, y: 2.2, size: 9, zone: null, isTop: true },
  minBodySlots: 10,
  maxBodySlots: 14,
  // TODO(open-question #5): 모든 방이 3그루 고정 (임시안)
  trees: [
    { id: 'A', name: '첫째 나무', scale: 0.86, position: 0 },
    { id: 'B', name: '둘째 나무', scale: 1, position: 1 },
    { id: 'C', name: '셋째 나무', scale: 0.86, position: 2 },
  ],
  // 조명 띠 위치(표시 전용, 방 데이터에 저장하지 않음). 조명 그림(128×24)의 줄이 각 층 아랫단 바로 위에 오도록 맞춤
  bands: [
    { id: 'b1', label: '2층', cx: 24, w: 22, y: 26 },
    { id: 'b2', label: '3층', cx: 24, w: 30, y: 36 },
    { id: 'b3', label: '4층', cx: 24, w: 39.5, y: 46.4 },
  ],
  items: [
    { id: 'ball-red', name: '빨간 방울' },
    { id: 'ball-blue', name: '파란 방울' },
    { id: 'ball-gold', name: '금색 방울' },
    { id: 'star-topper', name: '별' },
    { id: 'bell', name: '종' },
    { id: 'candy-cane', name: '지팡이 사탕' },
    { id: 'gift', name: '선물 상자' },
    { id: 'snowflake', name: '눈송이' },
    { id: 'heart', name: '하트' },
    { id: 'bow', name: '리본' },
    { id: 'gingerbread', name: '진저브레드' },
    { id: 'stocking', name: '양말' },
  ],
  strings: [
    { id: 'lights-string', name: '컬러 전구' },
    { id: 'garland-gold', name: '금빛 가랜드' },
    { id: 'bead-chain', name: '구슬 줄' },
    { id: 'fairy-lights', name: '요정 전구' },
  ],
  topItem: 'star-topper',
  backgrounds: [
    { id: 'living-room', name: '따뜻한 거실' },
    { id: 'snowy-night', name: '눈 내리는 밤' },
    { id: 'village', name: '겨울 마을' },
    { id: 'aurora', name: '오로라' },
    { id: 'winter-dawn', name: '겨울 새벽' },
  ],
  defaultBackground: 'living-room',
  defaultBands: {
    A: { b2: 'bead-chain', b3: 'fairy-lights' },
    B: { b1: 'fairy-lights', b2: 'garland-gold', b3: 'lights-string' },
    C: { b1: 'garland-gold', b3: 'lights-string' },
  },
};

const THEMES: Record<string, ThemeGeometry> = { pixel: PIXEL_THEME };

export function getTheme(id: string): ThemeGeometry {
  const t = THEMES[id];
  if (!t) throw new Error(`unknown theme: ${id}`);
  return t;
}

export function itemName(theme: ThemeGeometry, id: string): string {
  return theme.items.find(i => i.id === id)?.name ?? id;
}
