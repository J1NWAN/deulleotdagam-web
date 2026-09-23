// 식별자 3종(roomId / joinCode / ownerKey)과 게스트 토큰. 03 문서 2절.

/** 혼동 문자(0/O, 1/I/L) 제외 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;
/** 31^20 ≈ 2^99 */
export const OWNER_KEY_LENGTH = 20;

function randomChars(n: number, alphabet = CODE_ALPHABET): string {
  // 편향 없는 선택을 위해 alphabet 길이의 배수 범위만 사용
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < n) {
    const buf = crypto.getRandomValues(new Uint8Array(n * 2));
    for (const b of buf) {
      if (b < limit) out += alphabet[b % alphabet.length];
      if (out.length === n) break;
    }
  }
  return out;
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const newRoomId = () => randomHex(16);
export const newGuestId = () => randomHex(8);
export const newGuestToken = () => randomHex(24);
export const newJoinCode = () => randomChars(JOIN_CODE_LENGTH);
export const newOwnerKey = () => randomChars(OWNER_KEY_LENGTH);

export const isRoomId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

/** 입력값 정리: 소문자/공백/하이픈 허용 */
export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function isJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c));
}

export function isOwnerKey(key: string): boolean {
  return key.length === OWNER_KEY_LENGTH && [...key].every(c => CODE_ALPHABET.includes(c));
}

/** 4자리씩 끊어 표시: ABCD-EFGH-... */
export function formatKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const hashOwnerKey = (key: string) => sha256Hex('owner:' + normalizeCode(key));
export const hashGuestToken = (token: string) => sha256Hex('guest:' + token);
/** IP는 원문 저장 금지. 비밀 솔트와 함께 해시한 값만 쓴다. */
export const hashIp = (ip: string, salt: string) => sha256Hex('ip:' + salt + ':' + ip);
