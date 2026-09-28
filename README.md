# 들렀다감 (deulleotdagam)

회원가입 없이 링크(참여 코드)만으로 친구 방에 들러 트리에 장식을 달고 메모를 남기는 웹 서비스입니다.
지금은 **겨울 트리 꾸미기** 시즌(픽셀아트, 나무 3그루)이 구현되어 있습니다.

- 기획/설계 문서: [`deulleotdagam-handoff/docs/`](deulleotdagam-handoff/docs)
- 이번 작업 정리: [`WORK_SUMMARY.md`](WORK_SUMMARY.md)

## 구성

```
packages/
  shared/   @deulleotdagam/shared  슬롯 생성, 권한/검증 규칙, 식별자, 시즌, 메시지 타입 (서버·클라이언트 공용)
  worker/   @deulleotdagam/worker  Cloudflare Worker(deulleotdagam-api) + RoomDO(Durable Object) + D1 색인
  web/      @deulleotdagam/web     Vite + TypeScript 정적 앱 (Cloudflare Pages)
scripts/
  dev.mjs                 로컬 개발 서버 한 번에 띄우기
  extract-tree-rows.mjs   tree.svg에서 줄별 나무 윤곽 다시 뽑기
```

## 로컬 개발

Node 20 이상이 필요합니다.

```bash
npm install
npm run dev          # D1 마이그레이션 적용 → Worker(8787) + Vite(5173)
```

브라우저에서 http://localhost:5173 을 엽니다. Vite가 `/api`(웹소켓 포함)를 Worker로 넘깁니다.
`packages/worker/.dev.vars`가 없으면 `.dev.vars.example`을 복사해 만듭니다.

## 테스트

```bash
npm test                  # 공용 모듈 단위 테스트 (슬롯 생성 3,000개 시드 검증 등)
npm run typecheck         # 세 패키지 타입 검사

# 통합 테스트: Worker를 먼저 띄운 뒤 실행 (방 생성 제한에 걸리지 않게 한도를 올려서)
npm run dev -w @deulleotdagam/worker -- --var CREATE_LIMIT_PER_DAY:1000
npm run test:e2e          # API/웹소켓 + 정책(자동 삭제, 시즌 종료, 생성 제한) 테스트
```

`test/lifecycle.test.mjs`는 별도 포트(8790)와 임시 저장소로 `wrangler dev`를 직접 띄워
자동 삭제 대기 시간(`AUTO_DELETE_AFTER_MS`)과 시계(`CLOCK_OFFSET_MS`)를 바꿔 가며 확인합니다.

## 배포 (Cloudflare 무료 플랜)

현재 배포 주소
- 서비스: https://deulleotdagam.jinwan.workers.dev
- API: https://deulleotdagam-api.jinwan.workers.dev

프론트는 Pages 대신 Cloudflare가 새 프로젝트에 권장하는 **Workers 정적 자산**(`packages/web/wrangler.jsonc`)으로 배포합니다.

### 다시 배포하기

```bash
npx wrangler login                              # 처음 한 번
npm run deploy -w @deulleotdagam/worker         # API
npm run build && npm run deploy -w @deulleotdagam/web   # 화면 (.env.production의 API 주소로 빌드)
```

DB 구조를 바꿨다면 먼저 `npm run db:migrate:remote -w @deulleotdagam/worker`.

### 처음 구성할 때 한 일 (참고)
1. Cloudflare 계정 이메일 인증, workers.dev 하위 도메인 `jinwan` 등록
2. `npx wrangler d1 create deulleotdagam-index` → id를 `packages/worker/wrangler.jsonc`에 기록 → 원격 마이그레이션
3. 비밀값 등록: `npx wrangler secret put IP_SALT`(긴 무작위 문자열), `npx wrangler secret put ADMIN_TOKEN`
4. API Worker 배포 → 프론트 Worker 배포
5. 무료 한도 초과 시 요청이 실패하므로 대시보드에서 **사용량 알림**을 켜 두는 것을 권장

### 직접 도메인 연결하기
1. 도메인을 Cloudflare에 등록(네임서버 변경)
2. 대시보드 → Workers & Pages → `deulleotdagam` → 설정 → 도메인 및 경로 → **사용자 지정 도메인** 추가 (예: `deulleotdagam.com`)
3. API도 바꾸려면 `deulleotdagam-api`에 `api.deulleotdagam.com` 등을 추가하고 `packages/web/.env.production`의 `VITE_API_BASE`를 바꾼 뒤 화면 다시 배포
4. `packages/worker/wrangler.jsonc`의 `ALLOWED_ORIGINS`에 새 화면 주소를 쉼표로 추가하고 API 다시 배포 (빠뜨리면 화면에서 API 호출이 막힘)

## 금칙어 관리

금칙어는 [`packages/shared/src/banned-words.json`](packages/shared/src/banned-words.json)의 `words` 배열 한 곳에서 관리합니다.
방 이름, 장식 메모, 닉네임에 적용되며 서버 검증과 화면 미리 확인이 같은 목록을 씁니다.

- 대소문자, 공백, 숫자, 특수문자를 무시하고 비교하므로 `시 1 발`처럼 끼워 넣어도 걸립니다.
- `보지 마`, `새끼 고양이` 같은 흔한 표현이 막히지 않도록 너무 짧거나 일반적인 단어는 넣지 마세요.
- 수정 후 `npm test`로 확인하고 **API와 화면을 모두 다시 배포**해야 반영됩니다.

## 관리자 API

신고가 쌓여도 방은 자동으로 닫히지 않습니다. 관리자가 신고 내용을 보고 직접 조치합니다.
추후 관리자 홈페이지는 이 API를 호출하면 됩니다. 모든 요청에 `Authorization: Bearer $ADMIN_TOKEN`이 필요합니다.

| 요청 | 설명 |
|---|---|
| `GET /api/admin/rooms?reported=1` | 신고된 방 목록 (서로 다른 신고자 수 `report_count` 많은 순) |
| `GET /api/admin/rooms?status=disabled` | 상태별 방 목록 (`active` / `disabled` / `archived`) |
| `GET /api/admin/rooms/:roomId/reports` | 신고 내용 (사유, 시각, 신고된 장식의 메모·작성자) |
| `POST /api/admin/rooms/:roomId` `{"action": ...}` | `disable` 방 닫기 · `restore` 다시 열고 신고 정리 · `dismiss` 신고만 정리 · `delete` 영구 삭제 |

```bash
A=https://deulleotdagam-api.jinwan.workers.dev
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$A/api/admin/rooms?reported=1"
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$A/api/admin/rooms/<roomId>/reports"
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"action":"disable"}' "$A/api/admin/rooms/<roomId>"
```
