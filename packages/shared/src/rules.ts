import type { Slot, ThemeGeometry } from './theme';

export const MEMO_MAX = 40;
export const TITLE_MAX = 20;
export const NAME_MAX = 10;

/** 슬롯 허용: 꼭대기는 별만, 별은 꼭대기에만 */
export function accepts(slot: Pick<Slot, 'isTop'>, itemId: string, theme: Pick<ThemeGeometry, 'topItem'>): boolean {
  return slot.isTop ? itemId === theme.topItem : itemId !== theme.topItem;
}

/** 삭제 권한: 본인이 단 장식이거나 방장. 최종 판단은 서버에서 한다. */
export function canDelete(me: { guestId: string; isOwner: boolean }, placement: { authorId: string }): boolean {
  return me.isOwner || placement.authorId === me.guestId;
}

// TODO(open-question #8): 금칙어 목록 출처 미정. 코드 내 기본 목록 + 환경변수(BANNED_WORDS, 쉼표 구분)로 확장 (임시안)
export const DEFAULT_BANNED_WORDS = [
  // '보지 마', '새끼 고양이'처럼 흔한 표현을 막지 않도록 짧은 단어는 넣지 않는다
  '시발', '씨발', '씨바', 'ㅅㅂ', 'ㅆㅂ', '씨팔', '시팔', '병신', 'ㅂㅅ', '븅신', '좆', 'ㅈㄹ', '지랄',
  '개새끼', '개새기', '개색기', '개색끼', '미친놈', '미친년', '염병', '엠창', '느금마', '니애미',
  '섹스', '창녀', '걸레년', '죽어라',
  'fuck', 'shit', 'bitch', 'porn',
];

/** 공백·특수문자·숫자를 섞어 피하는 경우를 줄이기 위한 정규화 */
export function normalizeForFilter(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\d~`!@#$%^&*()\-_=+[\]{}\\|;:'",.<>/?·•ㆍ…]+/g, '');
}

export function containsBanned(text: string, extra: readonly string[] = []): boolean {
  const n = normalizeForFilter(text);
  if (!n) return false;
  return [...DEFAULT_BANNED_WORDS, ...extra].some(w => {
    const nw = normalizeForFilter(w);
    return nw.length > 0 && n.includes(nw);
  });
}

export type TextCheck = { ok: true; value: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' | 'BANNED' };

function checkText(raw: unknown, max: number, allowEmpty: boolean, extra: readonly string[]): TextCheck {
  // 줄바꿈/제어문자 제거, 앞뒤 공백 정리
  const value = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!value && !allowEmpty) return { ok: false, reason: 'EMPTY' };
  if ([...value].length > max) return { ok: false, reason: 'TOO_LONG' };
  if (value && containsBanned(value, extra)) return { ok: false, reason: 'BANNED' };
  return { ok: true, value };
}

export const checkMemo = (raw: unknown, extra: readonly string[] = []) => checkText(raw, MEMO_MAX, true, extra);
export const checkTitle = (raw: unknown, extra: readonly string[] = []) => checkText(raw, TITLE_MAX, false, extra);
export const checkName = (raw: unknown, extra: readonly string[] = []) => checkText(raw, NAME_MAX, false, extra);

export function isValidItem(theme: ThemeGeometry, itemId: unknown): itemId is string {
  return typeof itemId === 'string' && theme.items.some(i => i.id === itemId);
}

export function isValidString(theme: ThemeGeometry, stringId: unknown): stringId is string {
  return typeof stringId === 'string' && theme.strings.some(s => s.id === stringId);
}

export function isValidBackground(theme: ThemeGeometry, id: unknown): id is string {
  return typeof id === 'string' && theme.backgrounds.some(b => b.id === id);
}
