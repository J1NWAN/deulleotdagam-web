// 시간이 걸리는 정책(방 생성 제한, 30일 자동 삭제, 시즌 종료)을 확인한다.
// 별도 포트/저장소로 `wrangler dev`를 직접 띄우고, 자동 삭제 시간과 시계를 환경변수로 조정한다.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
const CWD = new URL('..', import.meta.url).pathname;
const persist = mkdtempSync(join(tmpdir(), 'deulleotdagam-e2e-'));
process.env.E2E_BASE = BASE;
const { api, connect, createRoom, freshIp, sleep } = await import('./helpers.mjs');

const SEASON_END = Date.UTC(2026, 11, 31, 15); // xmas-2026 종료 (KST 2027-01-01 00:00)
const AUTO_DELETE_MS = 6000;
let server;

function startServer(vars) {
  const args = ['wrangler', 'dev', '--port', String(PORT), '--persist-to', persist, '--inspector-port', '0'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const proc = spawn('npx', args, { cwd: CWD, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  return new Promise((resolve, reject) => {
    const onData = d => { log += d; if (/Ready on/.test(log)) resolve(proc); };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', code => reject(new Error('wrangler exited ' + code + '\n' + log)));
    setTimeout(() => reject(new Error('wrangler start timeout\n' + log)), 60_000);
  });
}

function stopServer(proc) {
  if (!proc) return Promise.resolve();
  return new Promise(resolve => {
    proc.removeAllListeners('exit');
    proc.on('exit', () => resolve());
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { resolve(); }
    setTimeout(resolve, 5000);
  });
}

async function fill(roomId, count) {
  const w = await (() => { const c = connect(roomId); return c.hello().finally(() => c.close()); })();
  const slots = w.snapshot.trees.flatMap(t => t.slots.map(s => ({ treeId: t.id, s })));
  const target = count ?? slots.length;
  for (let i = 0; i < target; i += 15) {
    const c = connect(roomId);
    await c.hello();
    for (const { treeId, s } of slots.slice(i, Math.min(target, i + 15))) {
      const m = await c.request({ t: 'place', treeId, slotId: s.id, itemId: s.isTop ? 'star-topper' : 'bell', memo: '' }, 'placed');
      assert.equal(m.t, 'placed', JSON.stringify(m));
    }
    c.close();
  }
}

before(() => {
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'deulleotdagam-index', '--local', '--persist-to', persist], { cwd: CWD, stdio: 'ignore' });
});
after(async () => { await stopServer(server); rmSync(persist, { recursive: true, force: true }); });

const rooms = {};

describe('시즌 진행 중 (자동 삭제 대기 6초)', () => {
  before(async () => { server = await startServer({ AUTO_DELETE_AFTER_MS: AUTO_DELETE_MS, CREATE_LIMIT_PER_DAY: 5 }); });

  it('방 생성 제한: 같은 IP는 하루 5개까지', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/api/rooms', { title: 't' + i }, { 'CF-Connecting-IP': ip })).status, 201);
    const over = await api('POST', '/api/rooms', { title: 'over' }, { 'CF-Connecting-IP': ip });
    assert.equal(over.status, 429);
    assert.equal(over.data.error, 'RATE_LIMITED');
  });

  it('방 준비: 빈 방 / 장식 5개 / 완성 공개방 / 완성 비공개방', async () => {
    rooms.empty = await createRoom('빈 방', 'public');
    rooms.five = await createRoom('다섯 개', 'public');
    rooms.four = await createRoom('네 개', 'public');
    rooms.done = await createRoom('완성된 방', 'public');
    rooms.secret = await createRoom('비밀 완성', 'private');
    await fill(rooms.five.roomId, 5);
    await fill(rooms.four.roomId, 4);
    await fill(rooms.done.roomId);
    await fill(rooms.secret.roomId);
  });

  it('생성 후 기한이 지나면 장식 5개 미만인 방만 자동 삭제', async () => {
    await sleep(AUTO_DELETE_MS + 2500);
    assert.equal((await api('GET', `/api/join/${rooms.empty.joinCode}`)).status, 404, '빈 방 삭제');
    assert.equal((await api('GET', `/api/join/${rooms.four.joinCode}`)).status, 404, '4개 방 삭제');
    assert.equal((await api('POST', '/api/owner/resume', { ownerKey: rooms.four.ownerKey })).status, 404);
    for (const k of ['five', 'done', 'secret']) assert.equal((await api('GET', `/api/join/${rooms[k].joinCode}`)).status, 200, k);
  });

  after(async () => { await stopServer(server); server = null; });
});

describe('시즌 종료 후 (시계를 종료 시각 뒤로 이동)', () => {
  before(async () => { server = await startServer({ CLOCK_OFFSET_MS: SEASON_END - Date.now() + 86_400_000 }); });

  it('현재 시즌 없음 → 방 생성 불가, 랜덤 공개방 없음', async () => {
    const s = await api('GET', '/api/season');
    assert.equal(s.data.current, null);
    assert.equal(s.data.lastEnded.id, 'xmas-2026');
    const c = await api('POST', '/api/rooms', { title: '늦은 방' });
    assert.equal(c.status, 409);
    assert.equal(c.data.error, 'NO_SEASON');
    assert.equal((await api('GET', '/api/rooms/random-public')).status, 404);
  });

  it('지난 시즌 둘러보기: 완성된 공개방이 먼저, 10개 미만이면 미완성도, 비공개방은 제외', async () => {
    const { data } = await api('GET', '/api/archive');
    assert.equal(data.season.id, 'xmas-2026');
    assert.equal(data.season.roomNoun, '겨울 트리');
    const ids = data.rooms.map(r => r.roomId);
    assert.deepEqual(ids, [rooms.done.roomId, rooms.five.roomId]);
    assert.deepEqual(data.rooms.map(r => r.isComplete), [true, false]);
  });

  it('읽기 전용 스냅샷: 공개방만, 참여 코드는 숨김', async () => {
    const ok = await api('GET', `/api/rooms/${rooms.done.roomId}/snapshot`);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, 'archived');
    assert.equal(ok.data.joinCode, '');
    assert.ok(ok.data.completedAt > 0);
    assert.equal((await api('GET', `/api/rooms/${rooms.secret.roomId}/snapshot`)).status, 404);
  });

  it('지난 시즌 방은 입장은 되지만 장식을 달 수 없다', async () => {
    const j = await api('GET', `/api/join/${rooms.five.joinCode}`);
    assert.equal(j.data.status, 'archived');
    const c = connect(rooms.five.roomId);
    const w = await c.hello();
    assert.equal(w.snapshot.status, 'archived');
    assert.equal(w.guestToken, undefined, '읽기 전용 방에서는 게스트를 저장하지 않음');
    const m = await c.request({ t: 'place', treeId: 'A', slotId: 's9', itemId: 'bell', memo: '' }, 'placed');
    assert.equal(m.code, 'READ_ONLY');
    c.close();
  });
});
