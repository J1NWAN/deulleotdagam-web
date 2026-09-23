import type { RoomDO } from './room';

export interface Env {
  ROOM: DurableObjectNamespace<RoomDO>;
  DB: D1Database;
  IP_SALT?: string;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  CREATE_LIMIT_PER_DAY?: string;
  REPORT_THRESHOLD?: string;
  BANNED_WORDS?: string;
  /** 테스트용: 자동 삭제까지 걸리는 시간 (기본 30일) */
  AUTO_DELETE_AFTER_MS?: string;
  /** 테스트용: 시계를 앞으로 옮긴다 (시즌 종료 확인 등) */
  CLOCK_OFFSET_MS?: string;
}

export const DAY_MS = 86_400_000;

export const now = (env: Env) => Date.now() + (Number(env.CLOCK_OFFSET_MS) || 0);
export const bannedWords = (env: Env) => (env.BANNED_WORDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
export const autoDeleteAfter = (env: Env) => Number(env.AUTO_DELETE_AFTER_MS) || 30 * DAY_MS;
export const reportThreshold = (env: Env) => Number(env.REPORT_THRESHOLD) || 3;
export const createLimit = (env: Env) => Number(env.CREATE_LIMIT_PER_DAY) || 5;

/** Cloudflare 무료 한도를 넘었을 때 나는 오류인지 */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /exceeded|limit reached|too many requests|quota/i.test(msg);
}
