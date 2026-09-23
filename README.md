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

1. 로그인: `npx wrangler login`
2. D1 만들기: `cd packages/worker && npx wrangler d1 create deulleotdagam-index`
   → 출력된 `database_id`를 `wrangler.jsonc`에 넣기
3. 원격 마이그레이션: `npm run db:migrate:remote -w @deulleotdagam/worker`
4. 비밀값: `npx wrangler secret put IP_SALT` (필수, 긴 무작위 문자열), `npx wrangler secret put ADMIN_TOKEN`
5. Worker 배포: `npm run deploy -w @deulleotdagam/worker`
6. 프론트 빌드: `VITE_API_BASE=https://deulleotdagam-api.<계정>.workers.dev npm run build`
7. Pages 배포: `npx wrangler pages deploy packages/web/dist --project-name deulleotdagam`
   (`deulleotdagam.pages.dev`가 이미 쓰이고 있으면 다른 이름으로 정하고 `ALLOWED_ORIGINS`도 맞춰 바꿀 것)
8. `wrangler.jsonc`의 `ALLOWED_ORIGINS`를 실제 Pages 주소로 맞춘 뒤 Worker 재배포
9. Cloudflare 대시보드에서 Workers/D1/Durable Objects **사용량 알림**을 켜 두기
   (무료 한도를 넘으면 요청이 실패하고, 화면에는 "오늘은 사용량이 많아 잠시 쉬어가요"가 나옵니다)

## 관리자 API (관리자 화면 대신)

```bash
# 신고 누적으로 비활성된 방 목록
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>/api/admin/rooms?status=disabled
# 복구 / 비활성 / 삭제
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"action":"restore"}' https://<worker>/api/admin/rooms/<roomId>
```
