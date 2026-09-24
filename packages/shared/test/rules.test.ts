import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  accepts, canDelete, checkMemo, checkName, checkTitle, containsBanned,
  CODE_ALPHABET, currentSeason, formatKey, hashOwnerKey, isJoinCode, isOwnerKey, isRoomId, isSeasonOver,
  isValidBackground, isValidItem, isValidString, lastEndedSeason, newJoinCode, newOwnerKey, newRoomId, normalizeCode, PIXEL_THEME, SEASONS,
} from '../src';

const T = PIXEL_THEME;

describe('accepts (슬롯 허용)', () => {
  it('꼭대기는 별만, 별은 꼭대기에만', () => {
    expect(accepts({ isTop: true }, 'star-topper', T)).toBe(true);
    expect(accepts({ isTop: true }, 'ball-red', T)).toBe(false);
    expect(accepts({ isTop: false }, 'star-topper', T)).toBe(false);
    expect(accepts({ isTop: false }, 'ball-red', T)).toBe(true);
  });
});

describe('canDelete (삭제 권한)', () => {
  const p = { authorId: 'g1' };
  it('본인 장식은 본인이', () => expect(canDelete({ guestId: 'g1', isOwner: false }, p)).toBe(true));
  it('남의 장식은 못 뗌', () => expect(canDelete({ guestId: 'g2', isOwner: false }, p)).toBe(false));
  it('방장은 모두', () => expect(canDelete({ guestId: 'g2', isOwner: true }, p)).toBe(true));
});

describe('텍스트 검증', () => {
  it('메모는 비어도 되고 40자까지', () => {
    expect(checkMemo('')).toEqual({ ok: true, value: '' });
    expect(checkMemo('가'.repeat(40)).ok).toBe(true);
    expect(checkMemo('가'.repeat(41))).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(checkMemo('  메리\n크리스마스  ')).toEqual({ ok: true, value: '메리 크리스마스' });
    expect(checkMemo(123)).toEqual({ ok: true, value: '' });
  });
  it('이모지는 글자 단위로 센다', () => {
    expect(checkMemo('🎄'.repeat(40)).ok).toBe(true);
  });
  it('방 이름은 비면 안 되고 20자까지', () => {
    expect(checkTitle('  ')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(checkTitle('가'.repeat(21)).ok).toBe(false);
    expect(checkName('눈사람 12')).toEqual({ ok: true, value: '눈사람 12' });
  });
  it('금칙어: 공백/특수문자/숫자를 끼워 넣어도 걸린다', () => {
    expect(containsBanned('시발')).toBe(true);
    expect(containsBanned('시 1 발!')).toBe(true);
    expect(containsBanned('F u c k')).toBe(true);
    expect(checkMemo('병.신')).toEqual({ ok: false, reason: 'BANNED' });
  });
  it('금칙어: 흔한 표현은 막지 않는다', () => {
    for (const ok of ['메리 크리스마스!', '보지 마세요', '새끼 고양이 귀여워', '시바견 최고', '꺼내 보자']) expect(containsBanned(ok), ok).toBe(false);
  });
  it('금칙어: 환경설정으로 추가한 단어', () => {
    expect(containsBanned('바보야', ['바보'])).toBe(true);
  });
  it('장식/조명 id는 테마 목록에 있어야 한다', () => {
    expect(isValidItem(T, 'ball-blue')).toBe(true);
    expect(isValidItem(T, 'ball-purple')).toBe(false); // 플랫 전용
    expect(isValidItem(T, 42)).toBe(false);
    expect(isValidString(T, 'fairy-lights')).toBe(true);
    expect(isValidString(T, 'ball-red')).toBe(false);
  });
});

describe('식별자', () => {
  it('참여 코드: 8자, 혼동 문자 없음', () => {
    for (let i = 0; i < 500; i++) {
      const c = newJoinCode();
      expect(isJoinCode(c)).toBe(true);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });
  it('방장 키: 20자(약 99bit), 참여 코드와 형식이 다르다', () => {
    const k = newOwnerKey();
    expect(isOwnerKey(k)).toBe(true);
    expect(isJoinCode(k)).toBe(false);
    expect(Math.log2(CODE_ALPHABET.length) * k.length).toBeGreaterThan(80);
    expect(formatKey('ABCDEFGHJKMNPQRSTUVW')).toBe('ABCD-EFGH-JKMN-PQRS-TUVW');
  });
  it('입력 정리: 소문자·하이픈·공백 허용', () => {
    expect(normalizeCode(' abcd-efgh ')).toBe('ABCDEFGH');
  });
  it('roomId는 128bit hex', () => {
    expect(isRoomId(newRoomId())).toBe(true);
    expect(isRoomId('../etc')).toBe(false);
  });
  it('방장 키 해시는 표시 형식과 무관', async () => {
    expect(await hashOwnerKey('abcd-efgh-jkmn-pqrs-tuvw')).toBe(await hashOwnerKey('ABCDEFGHJKMNPQRSTUVW'));
  });
});

describe('시즌', () => {
  const s = SEASONS[0];
  it('끝나기 전에는 현재 시즌, 끝나면 지난 시즌', () => {
    expect(currentSeason(s.endsAt - 1)?.id).toBe(s.id);
    expect(lastEndedSeason(s.endsAt - 1)).toBeUndefined();
    expect(currentSeason(s.endsAt)).toBeUndefined();
    expect(lastEndedSeason(s.endsAt)?.id).toBe(s.id);
    expect(isSeasonOver(s.id, s.endsAt)).toBe(true);
  });
  it('크리스마스 시즌은 KST 12/1 ~ 12/31', () => {
    expect(new Date(s.startsAt).toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(new Date(s.endsAt).toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });
});

describe('배경', () => {
  it('기본 배경은 목록에 있고, 목록 밖의 값은 거부', () => {
    expect(isValidBackground(T, T.defaultBackground)).toBe(true);
    expect(isValidBackground(T, 'aurora')).toBe(true);
    expect(isValidBackground(T, 'beach')).toBe(false);
    expect(isValidBackground(T, null)).toBe(false);
  });
  it('모든 배경 그림 파일이 있고 메타데이터(C2PA)가 제거돼 있다', () => {
    for (const b of T.backgrounds) {
      const url = new URL(`../../web/public/backgrounds/bg-${b.id}.svg`, import.meta.url);
      expect(existsSync(url), b.id).toBe(true);
      const svg = readFileSync(url, 'utf8');
      expect(svg).toMatch(/viewBox="0 0 160 90"/);
      expect(svg).not.toMatch(/c2pa|<metadata/);
    }
  });
});
