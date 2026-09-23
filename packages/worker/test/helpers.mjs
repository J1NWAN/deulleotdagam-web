import http from 'node:http';

// 통합 테스트 도우미: 실행 중인 `wrangler dev`에 HTTP/웹소켓으로 붙는다.
export const BASE = process.env.E2E_BASE ?? 'http://localhost:8787';

let ipSeq = Math.floor(Math.random() * 200);
/** 테스트마다 다른 IP처럼 보이게 (로컬에서만 가능, 운영에서는 Cloudflare가 덮어씀) */
export const freshIp = () => `10.${Math.floor(Math.random() * 250)}.${(ipSeq++) % 250}.${Math.floor(Math.random() * 250)}`;

export async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': freshIp(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

export async function createRoom(title = '테스트 트리', visibility = 'private', ip) {
  const r = await api('POST', '/api/rooms', { title, visibility }, ip ? { 'CF-Connecting-IP': ip } : {});
  if (r.status !== 201) throw new Error('create failed ' + JSON.stringify(r));
  return r.data;
}

/** 웹소켓 클라이언트: 받은 메시지를 쌓아 두고 조건에 맞는 메시지를 기다린다 */
export function connect(roomId, { ip = freshIp(), base = BASE } = {}) {
  const ws = new WebSocket(base.replace(/^http/, 'ws') + `/api/rooms/${roomId}/ws`, { headers: { 'CF-Connecting-IP': ip } });
  const inbox = [];
  const waiters = [];
  let closed = null;
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  ws.addEventListener('close', e => { closed = { code: e.code }; for (const w of waiters.splice(0)) w.reject(new Error('closed ' + e.code)); });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
  });
  const client = {
    ws, inbox, opened,
    get closed() { return closed; },
    send: msg => ws.send(JSON.stringify(msg)),
    /** 이미 받은 메시지 중(선택) 또는 앞으로 올 메시지 중 조건에 맞는 것 */
    next(pred, { timeout = 3000, past = false } = {}) {
      const p = typeof pred === 'string' ? m => m.t === pred : pred;
      if (past) { const hit = inbox.find(p); if (hit) return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred: p, resolve, reject };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timeout waiting for ' + (typeof pred === 'string' ? pred : 'message'))); } }, timeout);
      });
    },
    async hello(opts = {}) {
      await opened;
      const wait = client.next(m => m.t === 'welcome' || m.t === 'error');
      client.send({ t: 'hello', ...opts });
      const m = await wait;
      if (m.t !== 'welcome') throw new Error('hello failed ' + JSON.stringify(m));
      return m;
    },
    /** 요청을 보내고 결과(내 요청에 해당하는 브로드캐스트 또는 오류)를 기다린다 */
    async request(msg, okType) {
      const mine = m => {
        if (m.t !== okType) return false;
        if (m.t === 'placed') return m.placement.treeId === msg.treeId && m.placement.slotId === msg.slotId;
        if (m.t === 'removed') return m.treeId === msg.treeId && m.slotId === msg.slotId;
        if (m.t === 'bandChanged') return m.treeId === msg.treeId && m.bandId === msg.bandId;
        return true;
      };
      const wait = client.next(m => mine(m) || m.t === 'error' || m.t === 'roomDeleted');
      client.send(msg);
      return wait;
    },
    close: () => { try { ws.close(); } catch {} },
  };
  return client;
}

/** 업그레이드가 거절되는 경우 상태 코드 확인용 (fetch는 Upgrade 헤더를 막으므로 node:http 사용) */
export function wsStatus(roomId) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/rooms/${roomId}/ws`, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'CF-Connecting-IP': freshIp() },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
    req.on('response', res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
}

export const bodySlots = snap => snap.trees.flatMap(t => t.slots.filter(s => !s.isTop).map(s => ({ treeId: t.id, slotId: s.id })));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
