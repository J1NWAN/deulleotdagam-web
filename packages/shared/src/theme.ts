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
  /** 방을 만들 때 기본으로 걸어 두는 조명 */
  defaultBands: Record<string, Record<string, string>>;
}

// tree.svg 픽셀 줄별 좌우 끝 (scripts/extract-tree-rows.mjs로 다시 뽑을 수 있음, 테스트에서 일치 여부 확인)
export const PIXEL_TREE_ROWS: TreeRows = {5:[22,26],6:[21,27],7:[21,27],8:[20,28],9:[20,28],10:[20,28],11:[19,29],12:[19,29],13:[19,29],14:[18,30],15:[18,30],16:[18,30],17:[17,31],18:[17,31],19:[17,31],20:[16,32],21:[17,31],22:[16,32],23:[16,32],24:[15,33],25:[14,34],26:[14,34],27:[14,34],28:[13,35],29:[12,36],30:[13,35],31:[12,36],32:[13,35],33:[13,35],34:[12,36],35:[11,37],36:[10,38],37:[9,39],38:[8,40],39:[8,40],40:[7,41],41:[8,40],42:[9,39],43:[9,39],44:[8,40],45:[7,41],46:[6,42],47:[5,43],48:[4,44],49:[3,45],50:[2,46],51:[1,47]};

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
  bands: [
    { id: 'b1', label: '2층', cx: 24, w: 22, y: 25.2 },
    { id: 'b2', label: '3층', cx: 24, w: 30, y: 35.2 },
    { id: 'b3', label: '4층', cx: 24, w: 39.5, y: 45.6 },
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
