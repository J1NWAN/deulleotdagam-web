// 실행 중인 `wrangler dev`(기본 http://localhost:8787)를 대상으로 하는 API/웹소켓 통합 테스트.
// 실행: npm run dev -w @deulleotdagam/worker  →  npm run test:e2e
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { api, bodySlots, connect, createRoom, freshIp, wsStatus } from './helpers.mjs';

const clients = [];
const open = (roomId, opts) => { const c = connect(roomId, opts); clients.push(c); return c; };
after(() => clients.forEach(c => c.close()));

describe('시즌 / 방 생성 / 입장', () => {
  it('현재 시즌 정보', async () => {
    const { status, data } = await api('GET', '/api/season');
    assert.equal(status, 200);
    assert.equal(data.current.id, 'xmas-2026');
    assert.equal(data.current.subtitle, '겨울 트리 꾸미기');
  });

  it('방 생성: 참여 코드와 방장 키는 서로 다른 값', async () => {
    const r = await createRoom('우리 거실 트리', 'private');
    assert.match(r.roomId, /^[0-9a-f]{32}$/);
    assert.match(r.joinCode, /^[A-HJKMNP-Z2-9]{8}$/);
    assert.match(r.ownerKey, /^[A-HJKMNP-Z2-9]{20}$/);
    assert.notEqual(r.joinCode, r.ownerKey.slice(0, 8));
  });

  it('방 이름 검증: 빈 이름 / 21자 / 금칙어', async () => {
    for (const title of ['   ', '가'.repeat(21), '씨 발 트리']) {
      const { status, data } = await api('POST', '/api/rooms', { title });
      assert.equal(status, 400, title);
      assert.equal(data.error, 'TITLE_REJECTED');
    }
  });

  it('참여 코드로 입장: 소문자/하이픈 허용, 없는 코드는 404', async () => {
    const r = await createRoom();
    const ok = await api('GET', `/api/join/${r.joinCode.toLowerCase().replace(/(.{4})/, '$1-')}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.roomId, r.roomId);
    assert.equal(ok.data.status, 'active');
    assert.equal((await api('GET', '/api/join/AAAAAAAA')).status, 404);
    assert.equal((await api('GET', '/api/join/../../x')).status, 404);
  });

  it('방장 재입장: 4자리씩 끊은 키도 인식, 참여 코드로는 불가', async () => {
    const r = await createRoom();
    const formatted = r.ownerKey.match(/.{4}/g).join('-').toLowerCase();
    const ok = await api('POST', '/api/owner/resume', { ownerKey: formatted });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.joinCode, r.joinCode);
    assert.equal((await api('POST', '/api/owner/resume', { ownerKey: r.joinCode })).status, 404);
    assert.equal((await api('POST', '/api/owner/resume', { ownerKey: 'A'.repeat(20) })).status, 404);
  });

  it('방 생성 횟수 제한: 같은 IP는 하루 CREATE_LIMIT_PER_DAY개까지', { skip: process.env.E2E_LIMIT ? false : 'E2E_LIMIT=<한도>로 실행할 때만' }, async () => {
    const limit = Number(process.env.E2E_LIMIT);
    const ip = freshIp();
    for (let i = 0; i < limit; i++) assert.equal((await api('POST', '/api/rooms', { title: 't' }, { 'CF-Connecting-IP': ip })).status, 201);
    const over = await api('POST', '/api/rooms', { title: 't' }, { 'CF-Connecting-IP': ip });
    assert.equal(over.status, 429);
    assert.equal(over.data.error, 'RATE_LIMITED');
    assert.equal((await api('POST', '/api/rooms', { title: 't' })).status, 201, '다른 IP는 영향 없음');
  });
});

describe('웹소켓: 입장과 스냅샷', () => {
  it('없는 방 / 잘못된 roomId는 404', async () => {
    assert.equal(await wsStatus('0'.repeat(32)), 404);
    assert.equal(await wsStatus('nope'), 404);
  });

  it('게스트: 첫 입장에 토큰 발급, 같은 토큰으로 다시 오면 같은 게스트', async () => {
    const r = await createRoom();
    const a = open(r.roomId);
    const w = await a.hello();
    assert.equal(w.me.isOwner, false);
    assert.ok(w.guestToken);
    assert.ok(w.me.name, '자동 이름');
    const snap = w.snapshot;
    assert.equal(snap.trees.length, 3);
    assert.deepEqual(snap.trees.map(t => t.scale), [0.86, 1, 0.86]);
    for (const t of snap.trees) {
      assert.equal(t.slots[0].id, 'top');
      assert.ok(t.slots.length >= 11 && t.slots.length <= 15, `슬롯 ${t.slots.length}`);
    }
    assert.deepEqual(snap.trees[1].bands, { b1: 'fairy-lights', b2: 'garland-gold', b3: 'lights-string' });
    assert.equal(snap.placements.length, 0);

    const b = open(r.roomId);
    const w2 = await b.hello({ guestToken: w.guestToken });
    assert.equal(w2.me.guestId, w.me.guestId);
    assert.equal(w2.guestToken, undefined);
    assert.deepEqual(w2.snapshot.trees, snap.trees, '슬롯 좌표는 저장된 값 그대로');
  });

  it('방장: 방장 키로 인식, 틀린 키는 일반 참여자', async () => {
    const r = await createRoom();
    const o = await open(r.roomId).hello({ ownerKey: r.ownerKey });
    assert.equal(o.me.isOwner, true);
    assert.equal(o.me.guestId, o.snapshot.ownerGuestId);
    const x = await open(r.roomId).hello({ ownerKey: 'ABCDEFGHJKMNPQRSTUVW' });
    assert.equal(x.me.isOwner, false);
  });

  it('hello 전 요청 / 잘못된 JSON / ping', async () => {
    const r = await createRoom();
    const c = open(r.roomId);
    await c.opened;
    assert.equal((await c.request({ t: 'place', treeId: 'A', slotId: 's1', itemId: 'bell', memo: '' }, 'placed')).code, 'NOT_READY');
    const bad = c.next('error'); c.ws.send('{oops'); assert.equal((await bad).code, 'BAD_REQUEST');
    assert.equal((await c.request({ t: 'ping' }, 'pong')).t, 'pong');
  });
});

describe('장식 달기 / 떼기', () => {
  it('규칙 검증: 없는 장식, 별↔꼭대기, 메모 길이, 금칙어', async () => {
    const r = await createRoom();
    const c = open(r.roomId);
    await c.hello();
    const place = (o) => c.request({ t: 'place', treeId: 'A', slotId: 's1', itemId: 'bell', memo: '', ...o }, 'placed');
    assert.equal((await place({ itemId: 'ball-purple' })).code, 'INVALID_ITEM', '플랫 전용 장식');
    assert.equal((await place({ itemId: 'star-topper' })).code, 'INVALID_ITEM', '별은 꼭대기에만');
    assert.equal((await place({ slotId: 'top' })).code, 'INVALID_ITEM', '꼭대기엔 별만');
    assert.equal((await place({ slotId: 's99' })).code, 'INVALID_SLOT');
    assert.equal((await place({ treeId: 'Z' })).code, 'INVALID_SLOT');
    assert.equal((await place({ memo: '가'.repeat(41) })).code, 'MEMO_REJECTED');
    assert.equal((await place({ memo: '병 신' })).code, 'MEMO_REJECTED');
    const ok = await place({ memo: '  메리\n크리스마스  ' });
    assert.equal(ok.t, 'placed');
    assert.equal(ok.placement.memo, '메리 크리스마스');
    const star = await c.request({ t: 'place', treeId: 'B', slotId: 'top', itemId: 'star-topper', memo: '' }, 'placed');
    assert.equal(star.t, 'placed');
  });

  it('실시간: 다른 참여자에게도 전달되고 rev가 1씩 오른다', async () => {
    const r = await createRoom();
    const a = open(r.roomId), b = open(r.roomId);
    const wa = await a.hello(); await b.hello();
    const seen = b.next('placed');
    const res = await a.request({ t: 'place', treeId: 'C', slotId: 's2', itemId: 'gift', memo: '안녕' }, 'placed');
    const got = await seen;
    assert.deepEqual(got.placement, res.placement);
    assert.equal(got.authorName, wa.me.name);
    assert.equal(got.placement.authorId, wa.me.guestId);
    const res2 = await a.request({ t: 'place', treeId: 'C', slotId: 's3', itemId: 'bow', memo: '' }, 'placed');
    assert.equal(res2.rev, res.rev + 1);
  });

  it('같은 슬롯 동시 요청: 먼저 온 쪽만 성공', async () => {
    const r = await createRoom();
    const a = open(r.roomId), b = open(r.roomId);
    await a.hello(); await b.hello();
    const msg = { t: 'place', treeId: 'A', slotId: 's1', memo: '' };
    const [ra, rb] = await Promise.all([a.request({ ...msg, itemId: 'bell' }, 'placed'), b.request({ ...msg, itemId: 'heart' }, 'placed')]);
    // 각 클라이언트는 성공 브로드캐스트 1개 또는 SLOT_TAKEN 오류 1개를 받는다
    const results = [ra, rb].map(m => (m.t === 'error' ? m.code : m.placement.itemId));
    const winners = [ra, rb].filter(m => m.t === 'placed').map(m => m.placement.itemId);
    assert.ok(results.includes('SLOT_TAKEN') || new Set(winners).size === 1, JSON.stringify(results));
    const snap = (await open(r.roomId).hello()).snapshot;
    assert.equal(snap.placements.filter(p => p.treeId === 'A' && p.slotId === 's1').length, 1);
  });

  it('삭제 권한: 본인 O / 다른 참여자 X / 방장 O', async () => {
    const r = await createRoom();
    const owner = open(r.roomId), a = open(r.roomId), b = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey }); await a.hello(); await b.hello();
    await a.request({ t: 'place', treeId: 'A', slotId: 's1', itemId: 'bell', memo: '' }, 'placed');
    await a.request({ t: 'place', treeId: 'A', slotId: 's2', itemId: 'bell', memo: '' }, 'placed');
    assert.equal((await b.request({ t: 'remove', treeId: 'A', slotId: 's1' }, 'removed')).code, 'NOT_ALLOWED');
    assert.equal((await a.request({ t: 'remove', treeId: 'A', slotId: 's1' }, 'removed')).t, 'removed');
    assert.equal((await owner.request({ t: 'remove', treeId: 'A', slotId: 's2' }, 'removed')).t, 'removed');
    assert.equal((await owner.request({ t: 'remove', treeId: 'A', slotId: 's2' }, 'removed')).code, 'INVALID_SLOT');
  });

  it('게스트 토큰으로 다시 들어와도 내 장식은 뗄 수 있다', async () => {
    const r = await createRoom();
    const a = open(r.roomId);
    const w = await a.hello();
    await a.request({ t: 'place', treeId: 'B', slotId: 's1', itemId: 'bell', memo: '' }, 'placed');
    a.close();
    const again = open(r.roomId);
    await again.hello({ guestToken: w.guestToken });
    assert.equal((await again.request({ t: 'remove', treeId: 'B', slotId: 's1' }, 'removed')).t, 'removed');
  });

  it('모든 슬롯을 채우면 completedAt이 기록된다', async () => {
    const r = await createRoom();
    // 소켓당 빈도 제한이 있으므로 나무마다 다른 참여자가 채운다
    const w = await open(r.roomId).hello();
    let last;
    for (const t of w.snapshot.trees) {
      const c = open(r.roomId);
      await c.hello();
      for (const s of t.slots)
        last = await c.request({ t: 'place', treeId: t.id, slotId: s.id, itemId: s.isTop ? 'star-topper' : 'ball-red', memo: '' }, 'placed');
    }
    assert.equal(last.t, 'placed');
    assert.ok(last.completedAt > 0);
    const snap = (await open(r.roomId).hello()).snapshot;
    assert.equal(snap.completedAt, last.completedAt);
  });

  it('빈도 제한: 한꺼번에 너무 많이 보내면 RATE_LIMITED', async () => {
    const r = await createRoom();
    const c = open(r.roomId);
    await c.hello();
    const limited = c.next(m => m.t === 'error' && m.code === 'RATE_LIMITED');
    // ping은 런타임 자동 응답이라 제한에 걸리지 않으므로 다른 메시지로 확인
    for (let i = 0; i < 40; i++) c.send({ t: 'noop' });
    assert.equal((await limited).code, 'RATE_LIMITED');
  });
});

describe('방장 기능', () => {
  it('조명: 방장만, 테마에 있는 조명만, 없음(null) 가능', async () => {
    const r = await createRoom();
    const owner = open(r.roomId), g = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey }); await g.hello();
    const set = (c, o) => c.request({ t: 'setBand', treeId: 'A', bandId: 'b1', stringId: 'lights-string', ...o }, 'bandChanged');
    assert.equal((await set(g)).code, 'NOT_ALLOWED');
    assert.equal((await set(owner, { stringId: 'bell' })).code, 'INVALID_ITEM');
    assert.equal((await set(owner, { bandId: 'b9' })).code, 'BAD_REQUEST');
    const seen = g.next('bandChanged');
    assert.equal((await set(owner)).stringId, 'lights-string');
    assert.equal((await seen).treeId, 'A');
    assert.equal((await set(owner, { bandId: 'b3', stringId: null })).stringId, null);
    const snap = (await open(r.roomId).hello()).snapshot;
    assert.deepEqual(snap.trees[0].bands, { b1: 'lights-string', b2: 'bead-chain' });
  });

  it('공개 전환 → 랜덤 공개방 입장에 나온다', async () => {
    const r = await createRoom('공개 테스트', 'private');
    const owner = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey });
    const g = open(r.roomId); await g.hello();
    assert.equal((await g.request({ t: 'setVisibility', visibility: 'public' }, 'roomChanged')).code, 'NOT_ALLOWED');
    assert.equal((await owner.request({ t: 'setVisibility', visibility: 'public' }, 'roomChanged')).visibility, 'public');
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const res = await api('GET', '/api/rooms/random-public');
      assert.equal(res.status, 200);
      found = res.data.joinCode === r.joinCode;
    }
    assert.ok(found, '랜덤 입장 후보에 포함');
    const ex = await api('GET', `/api/rooms/random-public?exclude=${r.joinCode}`);
    assert.notEqual(ex.data.joinCode, r.joinCode);
  });

  it('이름 바꾸기: 검증 후 모두에게 알림', async () => {
    const r = await createRoom();
    const a = open(r.roomId), b = open(r.roomId);
    const w = await a.hello(); await b.hello();
    assert.equal((await a.request({ t: 'setName', name: '' }, 'guestChanged')).code, 'NAME_REJECTED');
    assert.equal((await a.request({ t: 'setName', name: '지랄' }, 'guestChanged')).code, 'NAME_REJECTED');
    const seen = b.next('guestChanged');
    await a.request({ t: 'setName', name: '민지' }, 'guestChanged');
    assert.deepEqual(await seen, { t: 'guestChanged', rev: (await seen).rev, guestId: w.me.guestId, name: '민지' });
  });

  it('방 삭제: 방 이름 확인 → 모두에게 알림 → 코드/방장 키/소켓 모두 404', async () => {
    const r = await createRoom('지울 방');
    const owner = open(r.roomId), g = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey }); await g.hello();
    assert.equal((await g.request({ t: 'deleteRoom', confirm: '지울 방' }, 'roomDeleted')).code, 'NOT_ALLOWED');
    assert.equal((await owner.request({ t: 'deleteRoom', confirm: '다른 이름' }, 'roomDeleted')).code, 'NOT_ALLOWED');
    const bye = g.next('roomDeleted');
    await owner.request({ t: 'deleteRoom', confirm: ' 지울 방 ' }, 'roomDeleted');
    assert.equal((await bye).reason, 'owner');
    assert.equal((await api('GET', `/api/join/${r.joinCode}`)).status, 404);
    assert.equal((await api('POST', '/api/owner/resume', { ownerKey: r.ownerKey })).status, 404);
    assert.equal(await wsStatus(r.roomId), 404);
  });

  it('방 삭제 HTTP API: 방장 키 + 방 이름', async () => {
    const r = await createRoom('HTTP 삭제');
    assert.equal((await api('POST', `/api/rooms/${r.roomId}/delete`, { ownerKey: r.ownerKey, confirm: '틀림' })).status, 403);
    assert.equal((await api('POST', `/api/rooms/${r.roomId}/delete`, { ownerKey: r.joinCode, confirm: 'HTTP 삭제' })).status, 403);
    assert.equal((await api('POST', `/api/rooms/${r.roomId}/delete`, { ownerKey: r.ownerKey, confirm: 'HTTP 삭제' })).status, 200);
    assert.equal((await api('GET', `/api/join/${r.joinCode}`)).status, 404);
    assert.equal((await api('POST', `/api/rooms/${r.roomId}/delete`, { ownerKey: r.ownerKey, confirm: 'HTTP 삭제' })).status, 404);
  });
});

describe('배경', () => {
  it('방 만들 때 배경 선택: 기본값 / 고른 값 / 목록 밖 값은 거부', async () => {
    const d = await createRoom('기본 배경');
    assert.equal((await open(d.roomId).hello()).snapshot.background, 'living-room');
    const r = await api('POST', '/api/rooms', { title: '오로라 방', background: 'aurora' });
    assert.equal(r.status, 201);
    assert.equal((await open(r.data.roomId).hello()).snapshot.background, 'aurora');
    const bad = await api('POST', '/api/rooms', { title: '이상한 배경', background: '../etc' });
    assert.equal(bad.status, 400);
  });

  it('배경 바꾸기: 방장만, 목록 안의 값만, 모두에게 알림', async () => {
    const r = await createRoom('배경 바꾸기');
    const owner = open(r.roomId), g = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey }); await g.hello();
    assert.equal((await g.request({ t: 'setBackground', background: 'village' }, 'backgroundChanged')).code, 'NOT_ALLOWED');
    assert.equal((await owner.request({ t: 'setBackground', background: 'beach' }, 'backgroundChanged')).code, 'INVALID_ITEM');
    const seen = g.next('backgroundChanged');
    assert.equal((await owner.request({ t: 'setBackground', background: 'village' }, 'backgroundChanged')).background, 'village');
    assert.equal((await seen).background, 'village');
    assert.equal((await open(r.roomId).hello()).snapshot.background, 'village');
  });
});

describe('신고 / 비활성 / 관리자', () => {
  it('서로 다른 신고자(IP) 3명이 모이면 비활성 → 입장 불가 → 관리자 복구', async () => {
    const r = await createRoom('신고 테스트');
    const owner = open(r.roomId);
    await owner.hello({ ownerKey: r.ownerKey });
    await owner.request({ t: 'place', treeId: 'A', slotId: 's1', itemId: 'bell', memo: '' }, 'placed');
    assert.equal((await owner.request({ t: 'report', target: 'room' }, 'reported')).code, 'NOT_ALLOWED', '방장은 신고 불가');

    const sameIp = freshIp();
    const g1 = open(r.roomId, { ip: sameIp }); await g1.hello();
    assert.equal((await g1.request({ t: 'report', target: 'room', reason: '광고' }, 'reported')).t, 'reported');
    assert.equal((await g1.request({ t: 'report', target: 'room' }, 'reported')).code, 'ALREADY_REPORTED');
    assert.equal((await g1.request({ t: 'report', target: 'placement:A:s9' }, 'reported')).code, 'BAD_REQUEST', '없는 장식');
    // 같은 IP에서 게스트를 새로 만들어 신고해도 1명으로 센다
    const g1b = open(r.roomId, { ip: sameIp }); await g1b.hello();
    await g1b.request({ t: 'report', target: 'placement:A:s1' }, 'reported');
    const g2 = open(r.roomId); await g2.hello();
    await g2.request({ t: 'report', target: 'room' }, 'reported');
    assert.equal((await api('GET', `/api/join/${r.joinCode}`)).status, 200, '아직 2명');

    const disabled = owner.next(m => m.t === 'roomChanged' && m.status === 'disabled');
    const g3 = open(r.roomId); await g3.hello();
    await g3.request({ t: 'report', target: 'placement:A:s1' }, 'reported');
    await disabled;
    const j = await api('GET', `/api/join/${r.joinCode}`);
    assert.equal(j.status, 403);
    assert.equal(j.data.error, 'DISABLED');
    assert.equal(await wsStatus(r.roomId), 403);

    const auth = { Authorization: 'Bearer local-admin-token' };
    assert.equal((await api('GET', '/api/admin/rooms?status=disabled')).status, 401);
    const list = await api('GET', '/api/admin/rooms?status=disabled', undefined, auth);
    assert.ok(list.data.rooms.some(x => x.room_id === r.roomId));
    assert.equal((await api('POST', `/api/admin/rooms/${r.roomId}`, { action: 'restore' }, auth)).status, 200);
    assert.equal((await api('GET', `/api/join/${r.joinCode}`)).status, 200);
    const again = open(r.roomId); await again.hello();
    assert.equal((await again.request({ t: 'report', target: 'room' }, 'reported')).t, 'reported', '복구 후 신고 누적 초기화');
    assert.equal((await api('GET', `/api/join/${r.joinCode}`)).status, 200);
  });
});

describe('지난 시즌 (시즌 진행 중)', () => {
  it('끝난 시즌이 없으면 빈 목록, 진행 중인 방 스냅샷은 볼 수 없음', async () => {
    const a = await api('GET', '/api/archive');
    assert.deepEqual(a.data, { season: null, rooms: [] });
    const r = await createRoom('진행 중', 'public');
    assert.equal((await api('GET', `/api/rooms/${r.roomId}/snapshot`)).status, 404);
  });
});
