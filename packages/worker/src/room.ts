import { DurableObject } from 'cloudflare:workers';
import {
  accepts, autoName, canDelete, checkMemo, checkName, generateLayout, getTheme, hashGuestToken, hashOwnerKey, isSeasonOver,
  isValidBackground, isValidItem, isValidString, newGuestId, newGuestToken, OWNER_DEFAULT_NAME,
  type C2S, type ErrorCode, type Placement, type RoomSnapshot, type RoomStatus, type S2C, type Slot,
  type TreeSnapshot, type Visibility,
} from '@deulleotdagam/shared';
import { autoDeleteAfter, bannedWords, type Env, isQuotaError, now, reportThreshold } from './env';

export interface InitParams {
  roomId: string;
  title: string;
  visibility: Visibility;
  seasonId: string;
  themeId: string;
  joinCode: string;
  ownerKeyHash: string;
  background: string;
}

interface RoomRow {
  id: string; season_id: string; theme_id: string; visibility: Visibility; status: RoomStatus;
  join_code: string; owner_key_hash: string; owner_guest_id: string; title: string; seed: number;
  created_at: number; last_activity_at: number; completed_at: number | null; is_complete: number; rev: number;
  background: string | null;
}

/** 소켓마다 hibernation 이후에도 남는 정보 (serializeAttachment) */
interface Attachment { ready: boolean; guestId?: string; isOwner?: boolean; name?: string; ipHash: string }

const AUTO_DELETE_MIN_PLACEMENTS = 5; // TODO(open-question #4): 방 전체 기준 (임시안)
const MAX_MESSAGE_BYTES = 2048;
const RATE = { burst: 20, perSec: 4 };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS room (
  id TEXT PRIMARY KEY, season_id TEXT NOT NULL, theme_id TEXT NOT NULL, visibility TEXT NOT NULL, status TEXT NOT NULL,
  join_code TEXT NOT NULL, owner_key_hash TEXT NOT NULL, owner_guest_id TEXT NOT NULL, title TEXT NOT NULL, seed INTEGER NOT NULL,
  created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL, completed_at INTEGER,
  is_complete INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, background TEXT
);
CREATE TABLE IF NOT EXISTS tree (tree_id TEXT PRIMARY KEY, position INTEGER NOT NULL, scale REAL NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS slot (
  tree_id TEXT NOT NULL, slot_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, size REAL NOT NULL,
  zone INTEGER, is_top INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tree_id, slot_id)
);
CREATE TABLE IF NOT EXISTS placement (
  tree_id TEXT NOT NULL, slot_id TEXT NOT NULL, item_id TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
  author_guest_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (tree_id, slot_id)
);
CREATE TABLE IF NOT EXISTS band (tree_id TEXT NOT NULL, band_id TEXT NOT NULL, string_id TEXT, PRIMARY KEY (tree_id, band_id));
CREATE TABLE IF NOT EXISTS guest (guest_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, display_name TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS report (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_guest_id TEXT NOT NULL, reporter_ip_hash TEXT NOT NULL,
  target TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, UNIQUE (reporter_guest_id, target)
);
`;

export class RoomDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private cached: RoomRow | null | undefined;
  private buckets = new Map<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 연결 유지용 ping은 객체를 깨우지 않고 런타임이 바로 응답 (hibernation 유지, 사용량 절약)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------- 상태 ----------

  /** 초기화되지 않은 객체는 스키마조차 만들지 않는다 → "없는 방" */
  private room(): RoomRow | null {
    if (this.cached !== undefined) return this.cached;
    const hasTable = this.sql.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='room'`).toArray().length > 0;
    // 배경 기능 이전에 만든 방은 컬럼을 추가한다 (NULL = 테마 기본 배경)
    if (hasTable && !this.sql.exec(`SELECT 1 FROM pragma_table_info('room') WHERE name = 'background'`).toArray().length)
      this.sql.exec(`ALTER TABLE room ADD COLUMN background TEXT`);
    this.cached = hasTable ? (this.sql.exec<RoomRow & Record<string, SqlStorageValue>>(`SELECT * FROM room LIMIT 1`).toArray()[0] ?? null) : null;
    return this.cached;
  }

  private bumpRev(): number {
    const t = now(this.env);
    const rev = this.sql.exec<{ rev: number }>(`UPDATE room SET rev = rev + 1, last_activity_at = ? RETURNING rev`, t).one().rev;
    this.cached = undefined;
    return rev;
  }

  /** 시즌이 끝났으면 읽기 전용으로 전환 (접속/요청 시점에 확인) */
  private async refreshSeason(): Promise<RoomRow | null> {
    const r = this.room();
    if (r && r.status === 'active' && isSeasonOver(r.season_id, now(this.env))) {
      this.sql.exec(`UPDATE room SET status = 'archived'`);
      this.cached = undefined;
      await this.env.DB.prepare(`UPDATE rooms_index SET status = 'archived' WHERE room_id = ?`).bind(r.id).run();
      const rev = this.bumpRev();
      this.broadcast({ t: 'roomChanged', rev, visibility: r.visibility, status: 'archived' });
    }
    return this.room();
  }

  // ---------- RPC (Worker에서 호출) ----------

  async init(p: InitParams): Promise<void> {
    if (this.room()) throw new Error('room already initialized');
    const theme = getTheme(p.themeId);
    const t = now(this.env);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    const layout = generateLayout(seed, theme);
    const ownerGuestId = newGuestId();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(SCHEMA);
      this.sql.exec(
        `INSERT INTO room (id, season_id, theme_id, visibility, status, join_code, owner_key_hash, owner_guest_id, title, seed, created_at, last_activity_at, background)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.roomId, p.seasonId, p.themeId, p.visibility, p.joinCode, p.ownerKeyHash, ownerGuestId, p.title, seed, t, t, p.background,
      );
      // 방장 게스트는 토큰이 아니라 방장 키로만 인식하므로 쓸 수 없는 토큰 해시를 넣어 둔다
      this.sql.exec(`INSERT INTO guest (guest_id, token_hash, display_name, created_at) VALUES (?, ?, ?, ?)`,
        ownerGuestId, 'owner:' + ownerGuestId, OWNER_DEFAULT_NAME, t);
      for (const tree of theme.trees) {
        this.sql.exec(`INSERT INTO tree (tree_id, position, scale, name) VALUES (?, ?, ?, ?)`, tree.id, tree.position, tree.scale, tree.name);
        for (const s of layout[tree.id])
          this.sql.exec(`INSERT INTO slot (tree_id, slot_id, x, y, size, zone, is_top) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            tree.id, s.id, s.x, s.y, s.size, s.zone, s.isTop ? 1 : 0);
        for (const band of theme.bands)
          this.sql.exec(`INSERT INTO band (tree_id, band_id, string_id) VALUES (?, ?, ?)`, tree.id, band.id, theme.defaultBands[tree.id]?.[band.id] ?? null);
      }
    });
    this.cached = undefined;
    await this.ctx.storage.setAlarm(t + autoDeleteAfter(this.env));
  }

  /** 지난 시즌 둘러보기용 읽기 전용 스냅샷. 공개방이고 시즌이 끝난 방만 */
  async archivedSnapshot(): Promise<RoomSnapshot | null> {
    const r = await this.refreshSeason();
    if (!r || r.status !== 'archived' || r.visibility !== 'public') return null;
    const snap = this.snapshot();
    return { ...snap, joinCode: '' };
  }

  async deleteByOwner(ownerKeyHash: string, confirm: string): Promise<'ok' | 'not_found' | 'not_allowed'> {
    const r = this.room();
    if (!r) return 'not_found';
    if (r.owner_key_hash !== ownerKeyHash || confirm.trim() !== r.title) return 'not_allowed';
    await this.destroy('owner');
    return 'ok';
  }

  async adminSetStatus(status: 'active' | 'disabled'): Promise<boolean> {
    const r = this.room();
    if (!r) return false;
    await this.setStatus(status);
    if (status === 'active') this.sql.exec(`DELETE FROM report`); // 복구하면 신고 누적을 초기화
    return true;
  }

  async adminDelete(): Promise<boolean> {
    if (!this.room()) return false;
    await this.destroy('admin');
    return true;
  }

  // ---------- 자동 삭제 ----------

  override async alarm(): Promise<void> {
    const r = this.room();
    if (!r) return;
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM placement`).one().n;
    if (count < AUTO_DELETE_MIN_PLACEMENTS) await this.destroy('expired');
  }

  /**
   * 방 영구 삭제. 색인을 먼저 지워야 삭제 도중 참여 코드로 들어와 빈 방이 생기는 일이 없다.
   * RoomDO는 초기화되지 않은 상태에서 요청을 받으면 방을 만들지 않고 "없는 방"으로 응답한다.
   */
  private async destroy(reason: 'owner' | 'expired' | 'admin'): Promise<void> {
    const r = this.room();
    if (!r) return;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: 'roomDeleted', reason } satisfies S2C)); ws.close(4000, 'room deleted'); } catch { /* 이미 닫힘 */ }
    }
    await this.env.DB.prepare(`DELETE FROM rooms_index WHERE room_id = ?`).bind(r.id).run();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.cached = null;
  }

  private async setStatus(status: RoomStatus): Promise<void> {
    const r = this.room()!;
    this.sql.exec(`UPDATE room SET status = ?`, status);
    this.cached = undefined;
    await this.env.DB.prepare(`UPDATE rooms_index SET status = ? WHERE room_id = ?`).bind(status, r.id).run();
    const rev = this.bumpRev();
    this.broadcast({ t: 'roomChanged', rev, visibility: r.visibility, status });
    if (status === 'disabled') for (const ws of this.ctx.getWebSockets()) ws.close(4003, 'room disabled');
  }

  // ---------- 웹소켓 ----------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const r = await this.refreshSeason();
    if (!r) return new Response('not found', { status: 404 });
    if (r.status === 'disabled') return new Response('disabled', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ready: false, ipHash: request.headers.get('X-IP-Hash') ?? '' } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (typeof data !== 'string' || size > MAX_MESSAGE_BYTES) return this.fail(ws, 'BAD_REQUEST');
    if (!this.allow(ws)) return this.fail(ws, 'RATE_LIMITED', '너무 빨리 보내고 있어요. 잠시 후 다시 해 주세요');
    let msg: C2S;
    try { msg = JSON.parse(data); } catch { return this.fail(ws, 'BAD_REQUEST'); }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.fail(ws, 'BAD_REQUEST');
    try {
      await this.handle(ws, msg);
    } catch (err) {
      console.error('room message failed', err);
      this.fail(ws, isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'BAD_REQUEST');
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.buckets.delete(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* 이미 닫힘 */ }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.buckets.delete(ws);
  }

  /** 소켓당 메시지 빈도 제한 (토큰 버킷) */
  private allow(ws: WebSocket): boolean {
    const t = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: RATE.burst, at: t };
    b.tokens = Math.min(RATE.burst, b.tokens + ((t - b.at) / 1000) * RATE.perSec);
    b.at = t;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private send(ws: WebSocket, msg: S2C) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 닫힌 소켓 */ }
  }

  private fail(ws: WebSocket, code: ErrorCode, message?: string) {
    this.send(ws, { t: 'error', code, message });
  }

  private broadcast(msg: S2C) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.ready) try { ws.send(text); } catch { /* 닫힌 소켓 */ }
    }
  }

  private async handle(ws: WebSocket, msg: C2S): Promise<void> {
    const r = await this.refreshSeason();
    if (!r) { this.send(ws, { t: 'roomDeleted', reason: 'owner' }); ws.close(4004, 'not found'); return; }
    const me = ws.deserializeAttachment() as Attachment;

    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'hello') return this.hello(ws, me, r, msg);
    if (!me.ready || !me.guestId) return this.fail(ws, 'NOT_READY');
    if (r.status !== 'active') return this.fail(ws, 'READ_ONLY', '시즌이 끝나 이제는 구경만 할 수 있어요');
    const who = { guestId: me.guestId, isOwner: !!me.isOwner };
    const theme = getTheme(r.theme_id);

    switch (msg.t) {
      case 'place': {
        const slot = this.slot(msg.treeId, msg.slotId);
        if (!slot) return this.fail(ws, 'INVALID_SLOT');
        if (!isValidItem(theme, msg.itemId)) return this.fail(ws, 'INVALID_ITEM');
        if (!accepts(slot, msg.itemId, theme))
          return this.fail(ws, 'INVALID_ITEM', slot.isTop ? '꼭대기에는 별만 달 수 있어요' : '별은 꼭대기에만 달 수 있어요');
        const memo = checkMemo(msg.memo, bannedWords(this.env));
        if (!memo.ok) return this.fail(ws, 'MEMO_REJECTED', memo.reason === 'TOO_LONG' ? '메모는 40자까지 쓸 수 있어요' : '메모에 쓸 수 없는 말이 들어 있어요');
        // Durable Object는 요청을 하나씩 처리하므로 PK 확인만으로 먼저 온 요청이 이긴다
        if (this.sql.exec(`SELECT 1 FROM placement WHERE tree_id = ? AND slot_id = ?`, msg.treeId, msg.slotId).toArray().length)
          return this.fail(ws, 'SLOT_TAKEN', '그 자리는 방금 다른 사람이 채웠어요');
        const t = now(this.env);
        this.sql.exec(`INSERT INTO placement (tree_id, slot_id, item_id, memo, author_guest_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          msg.treeId, msg.slotId, msg.itemId, memo.value, who.guestId, t);
        const completedAt = await this.updateCompletion(r);
        const rev = this.bumpRev();
        this.broadcast({
          t: 'placed', rev, completedAt, authorName: me.name ?? '',
          placement: { treeId: msg.treeId, slotId: msg.slotId, itemId: msg.itemId, memo: memo.value, authorId: who.guestId, createdAt: t },
        });
        return;
      }
      case 'remove': {
        const p = this.sql.exec<{ author_guest_id: string }>(`SELECT author_guest_id FROM placement WHERE tree_id = ? AND slot_id = ?`,
          String(msg.treeId), String(msg.slotId)).toArray()[0];
        if (!p) return this.fail(ws, 'INVALID_SLOT', '이미 떼어진 장식이에요');
        if (!canDelete(who, { authorId: p.author_guest_id })) return this.fail(ws, 'NOT_ALLOWED', '내가 단 장식만 뗄 수 있어요');
        this.sql.exec(`DELETE FROM placement WHERE tree_id = ? AND slot_id = ?`, msg.treeId, msg.slotId);
        await this.updateCompletion(r);
        const rev = this.bumpRev();
        this.broadcast({ t: 'removed', rev, treeId: msg.treeId, slotId: msg.slotId });
        return;
      }
      case 'setBand': {
        if (!who.isOwner) return this.fail(ws, 'NOT_ALLOWED', '조명은 방장만 바꿀 수 있어요');
        if (!theme.trees.some(t => t.id === msg.treeId) || !theme.bands.some(b => b.id === msg.bandId)) return this.fail(ws, 'BAD_REQUEST');
        if (msg.stringId !== null && !isValidString(theme, msg.stringId)) return this.fail(ws, 'INVALID_ITEM');
        this.sql.exec(`UPDATE band SET string_id = ? WHERE tree_id = ? AND band_id = ?`, msg.stringId, msg.treeId, msg.bandId);
        const rev = this.bumpRev();
        this.broadcast({ t: 'bandChanged', rev, treeId: msg.treeId, bandId: msg.bandId, stringId: msg.stringId });
        return;
      }
      case 'setVisibility': {
        if (!who.isOwner) return this.fail(ws, 'NOT_ALLOWED', '공개 여부는 방장만 바꿀 수 있어요');
        if (msg.visibility !== 'public' && msg.visibility !== 'private') return this.fail(ws, 'BAD_REQUEST');
        this.sql.exec(`UPDATE room SET visibility = ?`, msg.visibility);
        await this.env.DB.prepare(`UPDATE rooms_index SET visibility = ? WHERE room_id = ?`).bind(msg.visibility, r.id).run();
        const rev = this.bumpRev();
        this.broadcast({ t: 'roomChanged', rev, visibility: msg.visibility, status: r.status });
        return;
      }
      case 'setBackground': {
        if (!who.isOwner) return this.fail(ws, 'NOT_ALLOWED', '배경은 방장만 바꿀 수 있어요');
        if (!isValidBackground(theme, msg.background)) return this.fail(ws, 'INVALID_ITEM');
        this.sql.exec(`UPDATE room SET background = ?`, msg.background);
        const rev = this.bumpRev();
        this.broadcast({ t: 'backgroundChanged', rev, background: msg.background });
        return;
      }
      case 'setName': {
        const name = checkName(msg.name, bannedWords(this.env));
        if (!name.ok) return this.fail(ws, 'NAME_REJECTED', name.reason === 'TOO_LONG' ? '이름은 10자까지 쓸 수 있어요' : name.reason === 'EMPTY' ? '이름을 입력해 주세요' : '이름에 쓸 수 없는 말이 들어 있어요');
        this.sql.exec(`UPDATE guest SET display_name = ? WHERE guest_id = ?`, name.value, who.guestId);
        // 같은 게스트로 연결된 다른 탭의 소켓도 이름 갱신
        for (const s of this.ctx.getWebSockets()) {
          const a = s.deserializeAttachment() as Attachment | null;
          if (a?.guestId === who.guestId) s.serializeAttachment({ ...a, name: name.value });
        }
        const rev = this.bumpRev();
        this.broadcast({ t: 'guestChanged', rev, guestId: who.guestId, name: name.value });
        return;
      }
      case 'deleteRoom': {
        if (!who.isOwner) return this.fail(ws, 'NOT_ALLOWED', '방 삭제는 방장만 할 수 있어요');
        if (typeof msg.confirm !== 'string' || msg.confirm.trim() !== r.title) return this.fail(ws, 'NOT_ALLOWED', '방 이름이 맞지 않아요');
        await this.destroy('owner');
        return;
      }
      case 'report': {
        const target = String(msg.target);
        const m = /^placement:([^:]+):([^:]+)$/.exec(target);
        if (target !== 'room' && !(m && this.sql.exec(`SELECT 1 FROM placement WHERE tree_id = ? AND slot_id = ?`, m[1], m[2]).toArray().length))
          return this.fail(ws, 'BAD_REQUEST');
        if (who.isOwner) return this.fail(ws, 'NOT_ALLOWED', '방장은 신고 대신 장식을 뗄 수 있어요');
        const reason = typeof msg.reason === 'string' ? msg.reason.slice(0, 100) : null;
        if (this.sql.exec(`SELECT 1 FROM report WHERE reporter_guest_id = ? AND target = ?`, who.guestId, target).toArray().length)
          return this.fail(ws, 'ALREADY_REPORTED', '이미 신고했어요');
        this.sql.exec(`INSERT INTO report (reporter_guest_id, reporter_ip_hash, target, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
          who.guestId, me.ipHash, target, reason, now(this.env));
        this.send(ws, { t: 'reported' });
        // 게스트를 새로 만들어 혼자 여러 번 신고하는 것을 막기 위해 서로 다른 IP 해시 수로 센다
        const reporters = this.sql.exec<{ n: number }>(`SELECT COUNT(DISTINCT reporter_ip_hash) AS n FROM report`).one().n;
        if (reporters >= reportThreshold(this.env)) await this.setStatus('disabled');
        return;
      }
      default:
        return this.fail(ws, 'BAD_REQUEST');
    }
  }

  private async hello(ws: WebSocket, me: Attachment, r: RoomRow, msg: Extract<C2S, { t: 'hello' }>): Promise<void> {
    if (me.ready) return this.fail(ws, 'BAD_REQUEST');
    let guestId: string | undefined, isOwner = false, name = '', issuedToken: string | undefined;

    // 방장 키는 URL이 아니라 연결 후 첫 메시지 본문으로 받는다
    if (typeof msg.ownerKey === 'string' && msg.ownerKey) {
      if ((await hashOwnerKey(msg.ownerKey)) === r.owner_key_hash) { isOwner = true; guestId = r.owner_guest_id; }
    }
    if (!guestId && typeof msg.guestToken === 'string' && msg.guestToken) {
      const row = this.sql.exec<{ guest_id: string }>(`SELECT guest_id FROM guest WHERE token_hash = ?`, await hashGuestToken(msg.guestToken)).toArray()[0];
      if (row) guestId = row.guest_id;
    }
    if (!guestId) {
      guestId = newGuestId();
      name = autoName();
      if (r.status === 'active') {
        // 읽기 전용 방에서는 게스트를 저장하지 않는다 (쓰기 한도 절약)
        issuedToken = newGuestToken();
        this.sql.exec(`INSERT INTO guest (guest_id, token_hash, display_name, created_at) VALUES (?, ?, ?, ?)`,
          guestId, await hashGuestToken(issuedToken), name, now(this.env));
      }
    } else {
      name = this.sql.exec<{ display_name: string | null }>(`SELECT display_name FROM guest WHERE guest_id = ?`, guestId).toArray()[0]?.display_name ?? '';
    }

    ws.serializeAttachment({ ...me, ready: true, guestId, isOwner, name } satisfies Attachment);
    const snapshot = this.snapshot();
    snapshot.guests[guestId] = name;
    this.send(ws, { t: 'welcome', me: { guestId, isOwner, name }, guestToken: issuedToken, snapshot, rev: snapshot.rev });
  }

  // ---------- 조회 ----------

  private slot(treeId: unknown, slotId: unknown): Slot | null {
    if (typeof treeId !== 'string' || typeof slotId !== 'string') return null;
    const s = this.sql.exec<{ slot_id: string; x: number; y: number; size: number; zone: number | null; is_top: number }>(
      `SELECT * FROM slot WHERE tree_id = ? AND slot_id = ?`, treeId, slotId).toArray()[0];
    return s ? { id: s.slot_id, x: s.x, y: s.y, size: s.size, zone: s.zone, isTop: !!s.is_top } : null;
  }

  /** 모든 슬롯이 처음 채워진 시각을 기록하고, 완성 여부가 바뀔 때만 색인(D1)에 쓴다 */
  private async updateCompletion(r: RoomRow): Promise<number | null> {
    const { total, filled } = this.sql.exec<{ total: number; filled: number }>(
      `SELECT (SELECT COUNT(*) FROM slot) AS total, (SELECT COUNT(*) FROM placement) AS filled`).one();
    const complete = total > 0 && total === filled;
    if (complete !== !!r.is_complete) {
      this.sql.exec(`UPDATE room SET is_complete = ?, completed_at = COALESCE(completed_at, ?)`, complete ? 1 : 0, complete ? now(this.env) : null);
      this.cached = undefined;
      await this.env.DB.prepare(`UPDATE rooms_index SET is_complete = ? WHERE room_id = ?`).bind(complete ? 1 : 0, r.id).run();
    }
    return this.room()?.completed_at ?? null;
  }

  private snapshot(): RoomSnapshot {
    const r = this.room()!;
    const slots = this.sql.exec<{ tree_id: string; slot_id: string; x: number; y: number; size: number; zone: number | null; is_top: number }>(
      `SELECT * FROM slot`).toArray();
    const bands = this.sql.exec<{ tree_id: string; band_id: string; string_id: string | null }>(`SELECT * FROM band`).toArray();
    const trees: TreeSnapshot[] = this.sql.exec<{ tree_id: string; position: number; scale: number; name: string }>(
      `SELECT * FROM tree ORDER BY position`).toArray().map(t => ({
      id: t.tree_id, name: t.name, scale: t.scale, position: t.position,
      slots: slots.filter(s => s.tree_id === t.tree_id)
        .map(s => ({ id: s.slot_id, x: s.x, y: s.y, size: s.size, zone: s.zone, isTop: !!s.is_top }))
        .sort((a, b) => (a.isTop ? -1 : b.isTop ? 1 : Number(a.id.slice(1)) - Number(b.id.slice(1)))),
      bands: Object.fromEntries(bands.filter(b => b.tree_id === t.tree_id && b.string_id).map(b => [b.band_id, b.string_id!])),
    }));
    const placements: Placement[] = this.sql.exec<{ tree_id: string; slot_id: string; item_id: string; memo: string; author_guest_id: string; created_at: number }>(
      `SELECT * FROM placement`).toArray().map(p => ({
      treeId: p.tree_id, slotId: p.slot_id, itemId: p.item_id, memo: p.memo, authorId: p.author_guest_id, createdAt: p.created_at,
    }));
    // 이름은 장식 작성자와 방장만 (방문자가 많아도 스냅샷이 커지지 않게)
    const guests: Record<string, string> = {};
    for (const g of this.sql.exec<{ guest_id: string; display_name: string | null }>(
      `SELECT guest_id, display_name FROM guest WHERE guest_id IN (SELECT author_guest_id FROM placement) OR guest_id = ?`, r.owner_guest_id))
      guests[g.guest_id] = g.display_name ?? '';
    return {
      roomId: r.id, title: r.title, seasonId: r.season_id, themeId: r.theme_id, visibility: r.visibility, status: r.status,
      joinCode: r.join_code, background: r.background ?? getTheme(r.theme_id).defaultBackground, trees, placements, guests, ownerGuestId: r.owner_guest_id,
      createdAt: r.created_at, completedAt: r.completed_at, rev: r.rev,
    };
  }
}
