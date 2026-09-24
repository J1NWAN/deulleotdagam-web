import {
  checkTitle, currentSeason, getTheme, hashIp, isValidBackground, hashOwnerKey, isJoinCode, isOwnerKey, isRoomId, lastEndedSeason, newJoinCode,
  newOwnerKey, newRoomId, normalizeCode, seasonById, isSeasonOver,
  type ApiError, type ApiErrorCode, type ArchiveResponse, type ArchiveRoom, type CreateRoomResponse, type JoinResponse,
  type RoomStatus, type SeasonInfo, type Visibility,
} from '@deulleotdagam/shared';
import { bannedWords, createLimit, type Env, isQuotaError, now } from './env';

export { RoomDO } from './room';

const ARCHIVE_COMPLETE_TARGET = 10;
const ARCHIVE_LIMIT_MAX = 24;

class HttpError extends Error {
  constructor(public status: number, public code: ApiErrorCode, message: string) { super(message); }
}

function cors(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || (allowed.length && !allowed.includes(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function body<T>(request: Request): Promise<Partial<T>> {
  const text = await request.text();
  if (text.length > 4096) throw new HttpError(413, 'BAD_REQUEST', '요청이 너무 커요');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'BAD_REQUEST', '잘못된 요청이에요'); }
}

async function ipHash(request: Request, env: Env): Promise<string> {
  if (!env.IP_SALT) throw new Error('IP_SALT is not configured');
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
  return hashIp(ip, env.IP_SALT);
}

const roomStub = (env: Env, roomId: string) => env.ROOM.get(env.ROOM.idFromName(roomId));

/** 0~1 난수 기준으로 인덱스를 따라 읽고, 모자라면 반대쪽에서 채운다 (ORDER BY random() 금지) */
async function pickRandom<T>(env: Env, sql: string, binds: unknown[], limit: number): Promise<T[]> {
  const r = Math.random();
  const first = await env.DB.prepare(`${sql} AND rand >= ? ORDER BY rand LIMIT ?`).bind(...binds, r, limit).all<T>();
  const rows = first.results;
  if (rows.length < limit) {
    const rest = await env.DB.prepare(`${sql} AND rand < ? ORDER BY rand LIMIT ?`).bind(...binds, r, limit - rows.length).all<T>();
    rows.push(...rest.results);
  }
  return rows;
}

// ---------- 핸들러 ----------

function seasonInfo(env: Env): SeasonInfo {
  const t = now(env);
  const cur = currentSeason(t), last = lastEndedSeason(t);
  return {
    now: t,
    current: cur ? { id: cur.id, subtitle: cur.subtitle, roomNoun: cur.roomNoun, defaultTitle: cur.defaultTitle, startsAt: cur.startsAt, endsAt: cur.endsAt } : null,
    lastEnded: last ? { id: last.id, subtitle: last.subtitle, roomNoun: last.roomNoun } : null,
  };
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const input = await body<{ title: string; visibility: Visibility; background: string }>(request);
  const season = currentSeason(now(env));
  if (!season) throw new HttpError(409, 'NO_SEASON', '지금은 시즌이 쉬는 중이라 방을 만들 수 없어요');
  const title = checkTitle(input.title ?? season.defaultTitle, bannedWords(env));
  if (!title.ok) throw new HttpError(400, 'TITLE_REJECTED',
    title.reason === 'EMPTY' ? '방 이름을 입력해 주세요' : title.reason === 'TOO_LONG' ? '방 이름은 20자까지 쓸 수 있어요' : '방 이름에 쓸 수 없는 말이 들어 있어요');
  const visibility: Visibility = input.visibility === 'public' ? 'public' : 'private';
  const theme = getTheme(season.themeId);
  const background = input.background ?? theme.defaultBackground;
  if (!isValidBackground(theme, background)) throw new HttpError(400, 'BAD_REQUEST', '고를 수 없는 배경이에요');

  // 생성 횟수 제한: IP는 솔트 해시로만 다룬다
  const day = new Date().toISOString().slice(0, 10);
  const { count } = (await env.DB.prepare(
    `INSERT INTO create_limit (ip_hash, day, count) VALUES (?, ?, 1)
     ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1 RETURNING count`,
  ).bind(await ipHash(request, env), day).first<{ count: number }>())!;
  if (count > createLimit(env)) throw new HttpError(429, 'RATE_LIMITED', '오늘은 방을 충분히 만들었어요. 내일 다시 만들어 주세요');

  const roomId = newRoomId();
  const ownerKey = newOwnerKey();
  const ownerKeyHash = await hashOwnerKey(ownerKey);
  // 색인을 먼저 써서 참여 코드를 확보한다 (UNIQUE 충돌이면 다시 뽑기)
  let joinCode = '';
  for (let i = 0; i < 5 && !joinCode; i++) {
    const code = newJoinCode();
    try {
      await env.DB.prepare(
        `INSERT INTO rooms_index (room_id, join_code, owner_key_hash, title, season_id, visibility, status, is_complete, rand, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
      ).bind(roomId, code, ownerKeyHash, title.value, season.id, visibility, Math.random(), now(env)).run();
      joinCode = code;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  if (!joinCode) throw new HttpError(500, 'INTERNAL', '참여 코드를 만들지 못했어요. 다시 시도해 주세요');
  try {
    await roomStub(env, roomId).init({ roomId, title: title.value, visibility, seasonId: season.id, themeId: season.themeId, joinCode, ownerKeyHash, background });
  } catch (err) {
    await env.DB.prepare(`DELETE FROM rooms_index WHERE room_id = ?`).bind(roomId).run();
    throw err;
  }
  return json({ roomId, joinCode, ownerKey } satisfies CreateRoomResponse, 201);
}

async function joinByCode(code: string, env: Env): Promise<Response> {
  const c = normalizeCode(code);
  if (!isJoinCode(c)) throw new HttpError(404, 'NOT_FOUND', '참여 코드를 다시 확인해 주세요');
  const row = await env.DB.prepare(`SELECT room_id, join_code, title, status, season_id FROM rooms_index WHERE join_code = ?`)
    .bind(c).first<{ room_id: string; join_code: string; title: string; status: RoomStatus; season_id: string }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', '그런 방을 찾을 수 없어요. 방장이 방을 삭제했을 수도 있어요');
  if (row.status === 'disabled') throw new HttpError(403, 'DISABLED', '신고가 여러 번 들어와 잠시 닫아 둔 방이에요');
  const status: RoomStatus = row.status === 'active' && isSeasonOver(row.season_id, now(env)) ? 'archived' : row.status;
  return json({ roomId: row.room_id, joinCode: row.join_code, title: row.title, status } satisfies JoinResponse);
}

async function resumeOwner(request: Request, env: Env): Promise<Response> {
  const input = await body<{ ownerKey: string }>(request);
  const key = normalizeCode(input.ownerKey);
  if (!isOwnerKey(key)) throw new HttpError(404, 'NOT_FOUND', '방장 ID를 다시 확인해 주세요');
  const row = await env.DB.prepare(`SELECT room_id, join_code, title, status FROM rooms_index WHERE owner_key_hash = ?`)
    .bind(await hashOwnerKey(key)).first<{ room_id: string; join_code: string; title: string; status: RoomStatus }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', '이 방장 ID로 된 방이 없어요');
  if (row.status === 'disabled') throw new HttpError(403, 'DISABLED', '신고가 여러 번 들어와 잠시 닫아 둔 방이에요');
  return json({ roomId: row.room_id, joinCode: row.join_code, title: row.title, status: row.status } satisfies JoinResponse);
}

async function deleteRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  const input = await body<{ ownerKey: string; confirm: string }>(request);
  const key = normalizeCode(input.ownerKey);
  if (!isOwnerKey(key)) throw new HttpError(403, 'NOT_ALLOWED', '방장만 방을 삭제할 수 있어요');
  const res = await roomStub(env, roomId).deleteByOwner(await hashOwnerKey(key), String(input.confirm ?? ''));
  if (res === 'not_found') throw new HttpError(404, 'NOT_FOUND', '그런 방을 찾을 수 없어요');
  if (res === 'not_allowed') throw new HttpError(403, 'NOT_ALLOWED', '방장 ID나 방 이름이 맞지 않아요');
  return json({ ok: true });
}

async function randomPublic(url: URL, env: Env): Promise<Response> {
  const season = url.searchParams.get('season') || currentSeason(now(env))?.id;
  if (!season) throw new HttpError(404, 'NOT_FOUND', '지금은 열린 시즌이 없어요');
  const exclude = normalizeCode(url.searchParams.get('exclude'));
  const rows = await pickRandom<{ join_code: string; title: string }>(env,
    `SELECT join_code, title FROM rooms_index WHERE season_id = ? AND visibility = 'public' AND status = 'active' AND join_code != ?`,
    [season, exclude], 1);
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', '아직 공개된 방이 없어요. 첫 공개방을 만들어 보세요');
  return json({ joinCode: rows[0].join_code, title: rows[0].title });
}

// TODO(open-question #3): 시즌이 끝난 뒤에만 지난 시즌에 편입 (임시안)
// 비공개방은 참여 코드를 아는 사람끼리의 공간이므로 둘러보기에는 공개방만 노출한다 (사용자 확인 필요)
async function archive(url: URL, env: Env): Promise<Response> {
  const t = now(env);
  const requested = url.searchParams.get('season');
  const season = requested ? seasonById(requested) : lastEndedSeason(t);
  if (!season || !isSeasonOver(season.id, t)) return json({ season: null, rooms: [] } satisfies ArchiveResponse);
  const limit = Math.min(ARCHIVE_LIMIT_MAX, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  const base = `SELECT room_id, title, is_complete FROM rooms_index WHERE season_id = ? AND visibility = 'public' AND status != 'disabled' AND is_complete = ?`;
  type Row = { room_id: string; title: string; is_complete: number };
  const rooms: Row[] = await pickRandom<Row>(env, base, [season.id, 1], limit);
  // 완성된 방이 10개 미만이면 미완성 방도 함께
  if (rooms.length < ARCHIVE_COMPLETE_TARGET) rooms.push(...await pickRandom<Row>(env, base, [season.id, 0], limit - rooms.length));
  return json({
    season: { id: season.id, subtitle: season.subtitle, roomNoun: season.roomNoun },
    rooms: rooms.map(r => ({ roomId: r.room_id, title: r.title, isComplete: !!r.is_complete }) satisfies ArchiveRoom),
  } satisfies ArchiveResponse);
}

async function archivedSnapshot(env: Env, roomId: string): Promise<Response> {
  const snap = await roomStub(env, roomId).archivedSnapshot();
  if (!snap) throw new HttpError(404, 'NOT_FOUND', '둘러볼 수 없는 방이에요');
  return json(snap, 200, { 'Cache-Control': 'public, max-age=300' });
}

async function openSocket(request: Request, env: Env, roomId: string): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'BAD_REQUEST', 'websocket only');
  // 없는 roomId로 Durable Object가 만들어지지 않도록 색인에서 먼저 확인
  const row = await env.DB.prepare(`SELECT status FROM rooms_index WHERE room_id = ?`).bind(roomId).first<{ status: RoomStatus }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', '그런 방을 찾을 수 없어요');
  if (row.status === 'disabled') throw new HttpError(403, 'DISABLED', '신고가 여러 번 들어와 잠시 닫아 둔 방이에요');
  const headers = new Headers(request.headers);
  headers.set('X-IP-Hash', await ipHash(request, env));
  return roomStub(env, roomId).fetch(new Request(request, { headers }));
}

// TODO(open-question #7): 관리자 화면은 없음. 대시보드/스크립트에서 이 API를 호출해 처리 (임시안)
async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) throw new HttpError(401, 'NOT_ALLOWED', 'unauthorized');
  if (request.method === 'GET' && url.pathname === '/api/admin/rooms') {
    const status = url.searchParams.get('status') ?? 'disabled';
    const { results } = await env.DB.prepare(`SELECT room_id, join_code, title, season_id, visibility, status, created_at FROM rooms_index WHERE status = ? LIMIT 100`)
      .bind(status).all();
    return json({ rooms: results });
  }
  const m = /^\/api\/admin\/rooms\/([0-9a-f]{32})$/.exec(url.pathname);
  if (request.method === 'POST' && m) {
    const { action } = await body<{ action: 'restore' | 'disable' | 'delete' }>(request);
    const stub = roomStub(env, m[1]);
    const ok = action === 'delete' ? await stub.adminDelete()
      : action === 'restore' ? await stub.adminSetStatus('active')
      : action === 'disable' ? await stub.adminSetStatus('disabled')
      : null;
    if (ok === null) throw new HttpError(400, 'BAD_REQUEST', 'action must be restore | disable | delete');
    if (!ok) throw new HttpError(404, 'NOT_FOUND', 'room not found');
    return json({ ok: true });
  }
  throw new HttpError(404, 'NOT_FOUND', 'not found');
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  let r: RegExpExecArray | null;

  if (m === 'GET' && p === '/api/season') return json(seasonInfo(env));
  if (m === 'POST' && p === '/api/rooms') return createRoom(request, env);
  if (m === 'GET' && (r = /^\/api\/join\/([^/]+)$/.exec(p))) return joinByCode(decodeURIComponent(r[1]), env);
  if (m === 'POST' && p === '/api/owner/resume') return resumeOwner(request, env);
  if (m === 'GET' && p === '/api/rooms/random-public') return randomPublic(url, env);
  if (m === 'GET' && p === '/api/archive') return archive(url, env);
  if (p.startsWith('/api/admin/')) return admin(request, env, url);
  if ((r = /^\/api\/rooms\/([^/]+)\/(ws|snapshot|delete)$/.exec(p))) {
    const [, roomId, action] = r;
    if (!isRoomId(roomId)) throw new HttpError(404, 'NOT_FOUND', '그런 방을 찾을 수 없어요');
    if (m === 'GET' && action === 'ws') return openSocket(request, env, roomId);
    if (m === 'GET' && action === 'snapshot') return archivedSnapshot(env, roomId);
    if (m === 'POST' && action === 'delete') return deleteRoom(request, env, roomId);
  }
  throw new HttpError(404, 'NOT_FOUND', 'not found');
}

export default {
  async fetch(request, env): Promise<Response> {
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // 웹소켓은 CORS 대상이 아니므로 Origin을 직접 확인
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (request.headers.get('Upgrade') === 'websocket' && origin && allowed.length && !allowed.includes(origin))
      return json({ error: 'NOT_ALLOWED', message: 'origin not allowed' } satisfies ApiError, 403);
    try {
      const res = await route(request, env);
      if (res.status === 101) return res;
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code, message: err.message } satisfies ApiError, err.status, headers);
      console.error('request failed', err);
      if (isQuotaError(err))
        return json({ error: 'QUOTA_EXCEEDED', message: '오늘은 사용량이 많아 잠시 쉬어가요. 한국 시간 오전 9시에 다시 열려요' } satisfies ApiError, 503, headers);
      return json({ error: 'INTERNAL', message: '잠시 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요' } satisfies ApiError, 500, headers);
    }
  },

  // 매일 00:00 UTC: 이틀 지난 생성 횟수 기록 삭제
  async scheduled(_event, env): Promise<void> {
    const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await env.DB.prepare(`DELETE FROM create_limit WHERE day < ?`).bind(cutoff).run();
  },
} satisfies ExportedHandler<Env>;
