import type {
  ApiError, ArchiveResponse, CreateRoomResponse, JoinResponse, RoomSnapshot, SeasonInfo, Visibility,
} from '@deulleotdagam/shared';

/** 배포 시 Worker가 다른 도메인이면 VITE_API_BASE에 주소를 넣는다. 비우면 같은 출처의 /api */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const NETWORK_MESSAGE = '서버에 연결하지 못했어요. 오늘 사용량이 많으면 한국 시간 오전 9시에 다시 열려요';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'NETWORK', NETWORK_MESSAGE);
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 한도 초과 시 Cloudflare 오류 페이지 등 */ }
  if (!res.ok) {
    const err = data as Partial<ApiError> | null;
    if (err?.error) throw new ApiFailure(res.status, err.error, err.message ?? '문제가 생겼어요');
    if (res.status === 429 || res.status >= 500)
      throw new ApiFailure(res.status, 'QUOTA_EXCEEDED', '오늘은 사용량이 많아 잠시 쉬어가요. 한국 시간 오전 9시에 다시 열려요');
    throw new ApiFailure(res.status, 'UNKNOWN', '문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요');
  }
  return data as T;
}

export const api = {
  season: () => call<SeasonInfo>('GET', '/api/season'),
  createRoom: (title: string, visibility: Visibility) => call<CreateRoomResponse>('POST', '/api/rooms', { title, visibility }),
  join: (code: string) => call<JoinResponse>('GET', `/api/join/${encodeURIComponent(code)}`),
  resume: (ownerKey: string) => call<JoinResponse>('POST', '/api/owner/resume', { ownerKey }),
  randomPublic: (exclude?: string) => call<{ joinCode: string; title: string }>('GET', `/api/rooms/random-public${exclude ? `?exclude=${exclude}` : ''}`),
  archive: (limit = 12) => call<ArchiveResponse>('GET', `/api/archive?limit=${limit}`),
  archivedSnapshot: (roomId: string) => call<RoomSnapshot>('GET', `/api/rooms/${roomId}/snapshot`),
};

export function wsUrl(roomId: string): string {
  const base = API_BASE || location.origin;
  return base.replace(/^http/, 'ws') + `/api/rooms/${roomId}/ws`;
}
