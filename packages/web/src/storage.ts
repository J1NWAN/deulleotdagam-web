// 브라우저 저장소. 비공개 창 등에서 막혀 있어도 화면은 동작해야 하므로 모든 접근을 감싼다.

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function set(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 저장 불가 */ }
}

/** 방별 게스트 토큰 (서버는 해시만 가진다) */
export const guestToken = {
  get: (roomId: string) => get(`dd:guest:${roomId}`),
  set: (roomId: string, token: string) => set(`dd:guest:${roomId}`, token),
};

/** 방장 키: 이 브라우저에서 방장으로 다시 들어오기 위해 보관 */
export const ownerKey = {
  get: (roomId: string) => get(`dd:owner:${roomId}`),
  set: (roomId: string, key: string | null) => set(`dd:owner:${roomId}`, key),
};

/** 방을 만든 직후 안내 팝업을 한 번 보여주기 위한 표시 */
export const justCreated = {
  get: (roomId: string) => { try { return sessionStorage.getItem(`dd:new:${roomId}`) === '1'; } catch { return false; } },
  set: (roomId: string, on: boolean) => { try { on ? sessionStorage.setItem(`dd:new:${roomId}`, '1') : sessionStorage.removeItem(`dd:new:${roomId}`); } catch { /* */ } },
};

// TODO(open-question #12): 반짝임 끄기를 사용자 설정으로 남김 (임시안)
export const twinkle = {
  get: () => get('dd:twinkle') !== 'off',
  set: (on: boolean) => set('dd:twinkle', on ? null : 'off'),
};

export interface RecentRoom { joinCode: string; title: string; owner: boolean; at: number }
export const recentRooms = {
  list(): RecentRoom[] {
    try { return (JSON.parse(get('dd:recent') ?? '[]') as RecentRoom[]).slice(0, 6); } catch { return []; }
  },
  add(r: Omit<RecentRoom, 'at'>) {
    const rest = recentRooms.list().filter(x => x.joinCode !== r.joinCode);
    set('dd:recent', JSON.stringify([{ ...r, at: Date.now() }, ...rest].slice(0, 6)));
  },
  remove(joinCode: string) {
    set('dd:recent', JSON.stringify(recentRooms.list().filter(x => x.joinCode !== joinCode)));
  },
};
