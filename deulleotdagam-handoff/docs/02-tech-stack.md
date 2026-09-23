# 02. 기술 스택

## 결정
- **언어: TypeScript** (프론트/백엔드/공용 모듈 전부) — ✅ 사용자 확정
- **호스팅: Cloudflare** — 추천안 (TypeScript 결정과 함께 이 조합을 전제로 논의함)
  - 프론트: **Cloudflare Pages** (정적 빌드 결과물) — 프로젝트 이름 `deulleotdagam`
  - API: **Cloudflare Workers** — Worker 이름 `deulleotdagam-api`
  - 방 상태 + 실시간: **Durable Objects (SQLite 백엔드)** — 방 1개 = 객체 1개
  - 전역 인덱스(참여 코드 조회, 공개방 목록, 지난 시즌 목록): **D1** (`deulleotdagam-index`) 또는 별도 인덱스용 Durable Object
- **프론트 빌드: Vite + TypeScript**. 프레임워크는 필수가 아님 — 프로토타입이 순수 JS(DOM + Pointer Events)이므로 그대로 옮겨도 되고, 화면이 늘어나면 가벼운 프레임워크(Preact/Svelte 등) 도입을 사용자와 상의
- 로컬 개발: `wrangler dev`

## 이 조합을 고른 이유 (다른 후보와 비교)

사용자는 평소 Java(Spring, eGovFrame)를 주로 씁니다. 그래도 Java + 무료 호스팅을 고르지 않은 이유는 다음과 같습니다.

| 문제 | Java(Spring) + Render 무료 | TypeScript + Cloudflare 무료 |
|---|---|---|
| 서버 대기 | 15분 무활동 시 꺼지고 다시 켜지는 데 최대 1분 안팎 | 요청 시 실행, 콜드 스타트 거의 없음 |
| 메모리 | 512MB / 0.1 CPU로 JVM에 빠듯함 | 해당 없음 |
| DB 보존 | Render 무료 Postgres는 생성 30일 후 만료, 유예 14일 뒤 삭제 | Durable Objects SQLite / D1 모두 기간 제한 없음 |
| 실시간 | 서버가 잠들면 연결 끊김 | Durable Objects에서 웹소켓 사용 가능 (무료 플랜 포함) |

- Supabase 무료 플랜은 **1주일간 활동이 없으면 프로젝트가 일시정지**되어 수동 복구가 필요 → 시즌 사이 한산한 기간이 있는 이 서비스와 맞지 않음
- 차선책(참고): Java를 쓴다면 Spring Boot + Render + Neon(기간 제한 없는 무료 Postgres). 콜드 스타트 문제는 남음

## 무료 한도 (2026년 9월 기준, 구현 전 공식 문서로 재확인할 것)

| 항목 | 무료 한도 |
|---|---|
| Workers 요청 | 하루 100,000건, 요청당 CPU 10ms |
| Durable Objects 요청 | 하루 100,000건 |
| SQLite(Durable Objects / D1) 행 읽기 | 하루 5,000,000행 |
| SQLite 행 쓰기 | 하루 100,000행 |
| SQLite 저장 용량 | 총 5GB |
| 초기화 시각 | 매일 00:00 UTC (한국 시간 09:00) |

**한도를 넘으면 해당 작업이 오류로 실패합니다** (D1은 2026-09-01부터 강제 적용). 따라서:

- **폴링 금지** → 웹소켓(Hibernation API)으로 변경분만 전송. 3초 폴링이면 한 사람이 1시간에 1,200 요청을 씀
- 방 조회는 방 Durable Object 안에서 끝내기 (전역 DB를 매번 스캔하지 않기)
- 전역 테이블에는 **인덱스**를 걸고 풀 스캔 쿼리 금지
- 한도 초과 시 사용자에게 보여줄 **오류 화면/문구** 준비 ("오늘은 사용량이 많아 잠시 쉬어가요" 등)
- Cloudflare 대시보드의 사용량 알림 설정을 사용자에게 안내

## 참고 문서
- Workers 요금/한도: https://developers.cloudflare.com/workers/platform/pricing/
- Durable Objects 요금/한도: https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 무료 한도 강제 적용 공지: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
