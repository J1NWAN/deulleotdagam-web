# 03. 아키텍처와 데이터 모델 (설계안)

> 아직 사용자와 세부 검토 전인 **초안**입니다. 구조를 크게 바꿔야 하면 구현 전에 사용자에게 확인하세요.

## 1. 전체 구조

```
[브라우저]  Vite + TS 정적 앱 (Cloudflare Pages)
    │  HTTPS (방 생성, 코드 조회, 목록)
    │  WSS  (방 안의 실시간 꾸미기)
    ▼
[Worker: deulleotdagam-api]  라우터 / 입력 검증 / 생성 횟수 제한
    ├──▶ [RoomDO]  방 1개 = Durable Object 1개 (SQLite)
    │        나무, 슬롯, 장식, 조명, 참여자, 신고, 자동 삭제 알람, 웹소켓
    └──▶ [D1: deulleotdagam-index]  참여 코드 → 방, 방장 키 해시 → 방,
                      공개방 목록, 지난 시즌 목록, 생성 횟수 기록
```

- 방 안의 모든 읽기/쓰기는 **RoomDO 안에서** 처리합니다. 방 상태를 보려고 D1을 조회하지 않습니다.
- D1은 "방을 찾기 위한 색인"만 가집니다. RoomDO가 **의미 있는 변화가 있을 때만** 색인을 갱신합니다 (생성, 공개 여부 변경, 완성, 삭제, 비활성 전환). 장식 하나 달 때마다 D1에 쓰지 않습니다.

## 2. 식별자 3종 (서로 반드시 분리)

| 값 | 용도 | 누가 아는가 | 저장 방식 | 형식 제안 |
|---|---|---|---|---|
| `roomId` | 내부 식별자, Durable Object 이름 | 서버, 웹소켓 URL | 원문 | 랜덤 128bit |
| `joinCode` | 참여 코드 / 공유 링크 `/r/{joinCode}` | 참여자 전원 | 원문 (UNIQUE) | 대문자+숫자 6~8자, 혼동 문자(0/O, 1/I/L) 제외 |
| `ownerKey` | 방장 재입장 | 방장만 | **SHA-256 해시만 저장** | 80bit 이상 랜덤, 4자리씩 끊어 표시 |

- 프로토타입의 `OWN-XXXX-XXXX`(8자)는 표시 예시일 뿐 **실제로는 너무 짧습니다**. 추측이 불가능한 길이로 만드세요.
- `ownerKey`는 방 생성 응답에서 **딱 한 번** 보여줍니다. 서버는 원문을 다시 알려줄 수 없습니다.
- `ownerKey`를 URL 쿼리에 넣지 마세요 (로그/히스토리에 남음). 웹소켓 연결 후 첫 메시지 본문으로 보냅니다.

### 게스트 식별
- 방에 처음 들어오면 서버가 `guestId`(공개값)와 `guestToken`(비밀값)을 발급하고, 클라이언트는 **방별로** localStorage에 `guestToken`을 보관합니다.
- 서버는 `guestToken`의 해시만 저장하고, 장식의 작성자는 `guestId`로 기록합니다.
- 브라우저 저장소를 지우면 "내 장식" 권한이 사라집니다 — 회원가입이 없는 서비스의 한계이며 허용 범위로 봅니다.
- ❓ 참여자 표시 이름(프로토타입의 "하늘", "민지")을 어떻게 정할지는 미정 → `06-open-questions.md`

## 3. RoomDO 내부 테이블 (SQLite)

```sql
CREATE TABLE room (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,          -- 예: 'xmas-2026'
  theme_id TEXT NOT NULL,           -- 현재 'pixel'만 사용 (추후 테마 추가 대비)
  visibility TEXT NOT NULL,         -- 'private' | 'public'
  status TEXT NOT NULL,             -- 'active' | 'disabled'(신고 누적) | 'archived'(시즌 종료, 읽기 전용)
  join_code TEXT NOT NULL,
  owner_key_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  completed_at INTEGER              -- 모든 슬롯이 처음 채워진 시각
);

CREATE TABLE tree (
  tree_id TEXT PRIMARY KEY,         -- 'A' | 'B' | 'C'
  position INTEGER NOT NULL,        -- 화면상 순서 0,1,2
  scale REAL NOT NULL,              -- 가운데 1.0, 양옆 0.86
  name TEXT NOT NULL                -- '첫째 나무' ...
);

CREATE TABLE slot (                 -- 방 생성 시 1회 생성 후 변경 없음
  tree_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,            -- 'top' | 's1' ... 
  x REAL NOT NULL, y REAL NOT NULL, size REAL NOT NULL,   -- 트리 좌표계 (04 문서)
  zone INTEGER,                     -- 1~4, top은 NULL
  is_top INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree_id, slot_id)
);

CREATE TABLE placement (            -- PK가 "한 슬롯에 장식 하나"를 보장 → 동시 요청 경쟁 해결
  tree_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  author_guest_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tree_id, slot_id)
);

CREATE TABLE band (                 -- 방장이 고르는 층별 조명
  tree_id TEXT NOT NULL,
  band_id TEXT NOT NULL,            -- 'b1'(2층) 'b2'(3층) 'b3'(4층)
  string_id TEXT,                   -- NULL = 없음
  PRIMARY KEY (tree_id, band_id)
);

CREATE TABLE guest (
  guest_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE report (
  id TEXT PRIMARY KEY,
  reporter_guest_id TEXT NOT NULL,
  target TEXT NOT NULL,             -- 'room' | 'placement:{tree}:{slot}'
  reason TEXT,
  created_at INTEGER NOT NULL
);
```

Durable Object 하나가 방 하나의 모든 요청을 순서대로 처리하므로, 슬롯 경쟁은 PK 충돌만 확인하면 됩니다.

## 4. D1 전역 색인

```sql
CREATE TABLE rooms_index (
  room_id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL UNIQUE,
  owner_key_hash TEXT NOT NULL UNIQUE,
  season_id TEXT NOT NULL,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL,
  is_complete INTEGER NOT NULL DEFAULT 0,
  rand REAL NOT NULL,               -- 랜덤 선택용 (아래 참고)
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_public ON rooms_index (season_id, visibility, status, rand);
CREATE INDEX idx_archive ON rooms_index (season_id, status, is_complete, rand);

CREATE TABLE create_limit (
  ip_hash TEXT NOT NULL,            -- 비밀 솔트(환경변수)로 해시한 값만 저장
  day TEXT NOT NULL,                -- 'YYYY-MM-DD'
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);
```

- **랜덤 선택**에 `ORDER BY random()`을 쓰면 전체 행을 읽어 행 읽기 한도를 크게 소모합니다. 대신 `WHERE ... AND rand >= ?(0~1 난수) ORDER BY rand LIMIT n`으로 조회하고, 결과가 부족하면 `rand < ?` 쪽에서 채웁니다.
- `create_limit`은 오래된 날짜 행을 매일 예약 작업(Cron Trigger)으로 삭제합니다.

## 5. HTTP API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/rooms` | 방 생성. 생성 횟수 제한 확인 → 슬롯 생성 → RoomDO 초기화 → 색인 기록. 응답: `roomId`, `joinCode`, `ownerKey`(1회만) |
| GET | `/api/join/:joinCode` | 참여 코드로 `roomId` 조회 |
| POST | `/api/owner/resume` | 본문의 `ownerKey`로 `roomId` 조회 (방장 재입장) |
| POST | `/api/rooms/:roomId/delete` | 본문의 `ownerKey` 해시가 일치하면 방 영구 삭제 (방장 전용) |
| GET | `/api/rooms/random-public?season=` | 공개방 하나 랜덤 |
| GET | `/api/archive?season=&limit=` | 지난 시즌 방 목록 (완성 우선, 10개 미만이면 미완성 포함) |
| GET (Upgrade) | `/api/rooms/:roomId/ws` | 웹소켓 연결 → RoomDO로 전달 |

## 6. 웹소켓 메시지 (초안)

클라이언트 → 서버
```ts
type C2S =
  | { t: 'hello'; guestToken?: string; ownerKey?: string }
  | { t: 'place'; treeId: string; slotId: string; itemId: string; memo: string }
  | { t: 'remove'; treeId: string; slotId: string }
  | { t: 'setBand'; treeId: string; bandId: string; stringId: string | null }   // 방장
  | { t: 'setVisibility'; visibility: 'public' | 'private' }                   // 방장
  | { t: 'deleteRoom'; confirm: string }                                      // 방장, confirm = 방 이름 등 확인값
  | { t: 'report'; target: string; reason?: string };
```

서버 → 클라이언트
```ts
type S2C =
  | { t: 'welcome'; me: { guestId: string; isOwner: boolean }; guestToken?: string; snapshot: RoomSnapshot; rev: number }
  | { t: 'placed'; rev: number; placement: Placement }
  | { t: 'removed'; rev: number; treeId: string; slotId: string }
  | { t: 'bandChanged'; rev: number; treeId: string; bandId: string; stringId: string | null }
  | { t: 'roomChanged'; rev: number; visibility: string; status: string }
  | { t: 'roomDeleted' }                                                        // 받은 뒤 서버가 소켓을 닫음
  | { t: 'error'; code: 'SLOT_TAKEN' | 'NOT_ALLOWED' | 'INVALID_ITEM' | 'MEMO_REJECTED' | 'READ_ONLY' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' };
```

- `rev`(변경 번호)가 건너뛰면 클라이언트는 재연결해 스냅샷을 다시 받습니다.
- Durable Objects **WebSocket Hibernation API**(`ctx.acceptWebSocket`)를 쓰고, 소켓별 권한(guestId, isOwner)은 `serializeAttachment`로 보관합니다. `setTimeout`/`setInterval` 대신 알람을 사용하세요.

## 7. 서버에서 반드시 검증할 것
- 슬롯이 존재하고 비어 있는지 (PK로 보장)
- 장식이 그 슬롯에 허용되는지: `top` 슬롯은 `star-topper`만, 별은 `top`에만
- 장식 id가 해당 테마 목록에 있는지
- 메모 길이(40자) + 금칙어 필터
- 삭제 권한: `author_guest_id === me.guestId || me.isOwner`
- 방 상태: `archived`는 읽기 전용, `disabled`는 입장 불가(또는 안내 화면)
- 소켓당 메시지 빈도 제한

## 8. 정책 구현
- **자동 삭제**: 방 생성 시 RoomDO 알람을 `created_at + 30일`로 설정 → 알람에서 장식 수가 5개 미만이면 저장소 전체 삭제(`deleteAll`) + 색인 삭제
- **신고 누적**: 임계치(❓ 미정) 이상이면 `status='disabled'`로 바꾸고 색인 갱신, 관리자 확인 대기
- **시즌 종료**: 시즌 설정에 종료 시각을 두고, 종료 후 접속하는 방은 `archived`로 전환(또는 일괄 작업)
- **방장의 방 삭제** (✅ 확정: 방장이 직접 삭제할 때만)
  1. 권한 확인: 소켓의 `isOwner` 또는 HTTP 요청 본문의 `ownerKey` 해시 일치
  2. 확인값(`confirm`) 검증 → 실패 시 `NOT_ALLOWED`
  3. 접속 중인 모든 소켓에 `roomDeleted` 전송 후 연결 종료
  4. D1 색인에서 방 삭제 (참여 코드, 방장 키 해시로 더 이상 찾을 수 없게)
  5. RoomDO 알람 해제 + `ctx.storage.deleteAll()`
  - 색인을 먼저 지워야, 저장소 삭제 중 누군가 참여 코드로 들어와 빈 방이 다시 만들어지는 일을 막을 수 있음
  - RoomDO는 초기화되지 않은 상태에서 요청을 받으면 **방을 새로 만들지 말고 "없는 방"으로 응답**해야 함 (방 생성은 `POST /api/rooms`에서만)
  - 브라우저 종료, 장기 미접속은 삭제 사유가 아님
