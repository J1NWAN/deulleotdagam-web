-- 전역 색인: "방을 찾기 위한" 정보만 둔다. 방 상태 자체는 RoomDO에 있다.
CREATE TABLE rooms_index (
  room_id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL UNIQUE,
  owner_key_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  season_id TEXT NOT NULL,
  visibility TEXT NOT NULL,          -- 'private' | 'public'
  status TEXT NOT NULL,              -- 'active' | 'disabled' | 'archived'
  is_complete INTEGER NOT NULL DEFAULT 0,
  rand REAL NOT NULL,                -- 랜덤 선택용 (ORDER BY random() 금지)
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_public ON rooms_index (season_id, visibility, status, rand);
CREATE INDEX idx_archive ON rooms_index (season_id, visibility, is_complete, rand);
CREATE INDEX idx_status ON rooms_index (status);

CREATE TABLE create_limit (
  ip_hash TEXT NOT NULL,             -- 비밀 솔트(IP_SALT)로 해시한 값만 저장
  day TEXT NOT NULL,                 -- 'YYYY-MM-DD' (UTC)
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);
