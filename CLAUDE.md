# CLAUDE.md

## 프로젝트

**언제들어오나** — 개인용 ELS(주가연계증권) 포트폴리오 관리 웹 애플리케이션.
평가일정 추적, 조건 판정(워스트오브·리자드·KI), 금융소득종합과세 및 건강보험료 계산.

- 사용자 3명 내외의 폐쇄형 서비스. 대규모 확장 고려 불필요
- **포트폴리오 프로젝트**이므로 문서 산출물도 결과물에 포함된다. 설계 변경 시 문서를 함께 갱신한다

## 스택

Next.js (App Router) · TypeScript · Supabase (PostgreSQL + Auth + RLS) · Vercel

## 설계 문서

전체 설계는 `docs/`에 있다. **작업 전 해당 문서를 먼저 읽는다.** 전부 읽지 말고 필요한 것만 읽는다.

| 작업 | 읽을 문서 |
|---|---|
| 세금·건보료 계산 | `07_계산_로직_명세.md` |
| 조건 판정·평가일정 | `07_계산_로직_명세.md` §3, §4 |
| 스키마·마이그레이션 | `02_데이터_모델.md` |
| RLS·권한 | `10_아키텍처_및_기술결정.md` §7 |
| 서버 액션·조회 함수 | `11_API_계약_명세.md` |
| 화면 구현 | `08_정보구조_및_화면목록.md` |
| 네이밍·용어 | `05_용어_사전.md` |
| 범위 판단 | `01_프로젝트_개요서.md` §6 |

작업이 어느 문서에도 없으면 **구현하기 전에 물어본다.** 범위 밖 기능을 임의로 추가하지 않는다.

## 절대 규칙

위반 시 프로젝트의 핵심 전제가 깨진다.

1. **검증 케이스의 기대값을 수정하지 않는다.** `07_계산_로직_명세.md` §10의 TC-01~TC-22는 검증된 정답이다. 테스트가 실패하면 테스트가 아니라 구현을 고친다.
2. **금액·비율에 부동소수점을 쓰지 않는다.** Decimal 타입을 사용하고, 경계에서는 문자열로 전달한다. **경계는 양방향이다** — 읽기는 `select.ts`의 `::text` 캐스팅, 쓰기는 `mutations/payload.ts`의 `InsertPayload<T>`(`toInsert`/`toUpdate`)를 지난다. **생성 타입(`Insert`·`Update`)을 그대로 따르면 위반이다** — 금액 열을 `number`로 요구하며, 실측상 `99999999999.999999`가 `100000000000.000000`으로 저장된다(오류 없음, AQ-30). `.insert()`·`.upsert()`·`.update()`에 객체 리터럴을 바로 넘기는 것은 린트가 막는다.
3. **`lib/tax`·`lib/domain`은 순수 모듈이다.** `lib/db`, `lib/providers`, `app`을 import할 수 없다. 프레임워크 API를 쓰지 않는다. 상수는 인자로 주입받는다.
4. **`els_products`에 `status` 컬럼을 만들지 않는다.** 상태는 `redemptions` 레코드 존재로 유도한다.
5. **세율·요율을 코드에 하드코딩하지 않는다.** `tax_brackets`·`tax_constants`에서 조회한다.
6. **권한은 RLS로 강제한다.** 애플리케이션 검증으로 대체하지 않는다. 계약 계층 검증은 UX 목적의 보조 수단이다. **테이블을 추가하면 `enable row level security`를 함께 쓴다** — 빠뜨리면 정책·GRANT와 무관하게 전면 개방된다(fail-open). RLS는 GRANT 위에 얹히는 필터이므로 권한은 회수 후 명시 부여한다. **뷰를 추가하면 `security_invoker = true`를 함께 쓴다** — 기본값은 소유자 권한 실행이므로 RLS가 통째로 우회되며, 카탈로그 테스트는 실테이블만 열거해 이를 잡지 못한다(같은 부류의 fail-open, AQ-20). **함수를 추가하면 `revoke execute … from public`을 함께 쓰고 `security invoker`(기본값)를 유지한다** — `EXECUTE`는 테이블 권한과 달리 기본으로 `PUBLIC`에 부여되며, `security definer`는 정책을 통째로 우회한다(AQ-28). 세 경우 모두 **객체 종류가 늘어날 때 기존 카탈로그 단언이 따라오지 않는다**는 같은 함정이다. `10_아키텍처_및_기술결정.md` §7.1.
7. **사용자 간 금융소득을 합산하지 않는다.** 종합과세는 개인 단위다. 집계 키는 항상 `(owner_id, year)`.
8. **손실 상환의 과세 금융소득은 0이다.** 음수가 될 수 없다. ELS 손실은 다른 금융소득과 통산되지 않는다. DB `CHECK`가 최종 보장이며(I-08) 계약 계층 검증(V-12)은 필드별 오류 표시용이다. **이 제약에 걸리는 상환이 나오면 제약을 푸는 것이 아니라 모델을 고쳐야 한다는 신호다** — `02_데이터_모델.md` §8.
9. **용어와 식별자는 `05_용어_사전.md`를 따른다.** 동의어를 임의로 만들지 않는다.
10. **설계를 바꿔야 하면 코드보다 문서를 먼저 고친다.** 해당 문서의 변경 이력에 사유를 남긴다.

## 코딩 규약

- 테이블·컬럼: `snake_case` 복수형 / ENUM 값: `UPPER_SNAKE`
- UI 표시 문자열: 한글. 용어 사전의 표준 용어 사용
- 서버 액션 반환: `ActionResult<T>` (예외를 던지지 않음)
- 조회 함수: 미존재 시 `null` 반환
- 비율은 소수 정규화 (`0.9` = 90%). 입력 계층에서 변환

## 명령

```bash
npm run dev
npm run test          # TC-01~22 + AQ-05. DB 없이 돈다
npm run test:rls      # RLS 정책 검증. 로컬 스택 필요 (db:start → db:reset)
npm run test:integration  # 조회·변경 계약 ↔ PostgREST. 로컬 스택 필요
npm run test:e2e      # 프록시·에러 경계 ↔ Next 서버. 로컬 스택 필요 (next build 포함)
npm run lint          # 순수 모듈 의존 규칙 포함
npm run typecheck     # @ts-expect-error 기반 타입 수준 테스트도 여기서 검증된다

npm run db:start      # Docker 필요
npm run db:reset      # 마이그레이션 + seed/ 재적용
npm run db:types      # 스키마 → src/types/database.types.ts 재생성
npm run db:stop
npx supabase migration new <name>
```

`npm run test`는 DB에 접근하지 않는다(ADR-003). 인프라를 요구하는 스위트는 **셋**이며 각각
전용 설정을 갖는다.

| 스위트 | 접속 대상 | 여기서만 보이는 것 |
|---|---|---|
| `tests/rls/` | `pg` 직결 + 롤 가장 | 정책·GRANT·카탈로그 |
| `tests/integration/` | PostgREST + 실제 JWT | 계약 왕복, 뷰 직렬화, 세션 갱신 |
| `tests/e2e/` | `next build` + `next start` | 리다이렉트·응답 헤더·404 — **Next를 지나야 존재한다** |

셋 다 `vitest.config.ts`에서 제외되어 있다(**새 스위트를 추가할 때 가장 잊기 쉬운 줄이다** —
빠뜨리면 `npm run test`가 인프라를 요구하게 되고 ADR-003의 전제가 조용히 깨진다).
인프라가 없으면 건너뛰지 않고 **실패한다** — 아무것도 증명하지 않은 초록색을 만들지 않는다.

`tests/e2e/`는 `next dev`가 아니라 **프로덕션 빌드**를 띄운다. 에러 경계의 동작이 두 모드에서
다르기 때문이다 — 개발 모드는 오버레이를 띄우고 `Error`를 redact하지 않는다. 그래서
`app/error.tsx`에서 **오류의 종류를 판별하려 하면 안 된다**(운영에서는 `digest`만 남는다).

`tests/integration/`의 픽스처는 **커밋한다**(HTTP 클라이언트가 다른 커넥션이라 롤백 전제로는
보이지 않는다). 자기 사용자·이름 대역을 쓰지만, 실행 후에는 `db:reset`으로 정리하는 편이 안전하다.

**마이그레이션 절차**

```bash
npx supabase migration new <name>   # 작성
npm run db:reset                    # 적용
npm run db:types                    # ★ 타입 재생성 — 빠뜨리면 조용히 낡는다
npm run test:rls && npm run typecheck
```

`db:types`를 빠뜨리면 타입만 예전 스키마를 가리키는데 `typecheck`는 통과한다. 그 상태에서
**금액을 문자열로 다루는 방어가 양방향 모두 조용히 멈춘다** — 읽기의 `::text`(DOC-011
§4.0 Q-08)와 쓰기의 `InsertPayload<T>`(§5.0 W-04) 둘 다 생성 타입에서 파생되기 때문이다.
드리프트 대조 검사는 `test:integration`에만 있어 상시 실행되지 않으므로, 절차로 지킨다
(DOC-010 AQ-19).

**표본 데이터를 `supabase/seed/`에 두지 않는다.** `sql_paths = ["./seed/*.sql"]`가 **글롭**이므로
새 파일이 자동으로 `db:reset`에 실리고, `tests/integration/`에는 **필터 없는 전역 건수 단언**이
있다(모든 SELECT 정책이 `using (true)`라 남의 상품도 센다). 즉 시드에 상품을 하나 넣으면
성장 불변 테스트가 **잘못된 이유로** 빨간불이 된다. 개발용 표본은 `supabase/dev/`(글롭 밖)에 두고
`psql -f`로 수동 적용한다 — `db:reset`이 지우므로 격리가 규율이 아니라 구조다. 1차 입력 경로는
**화면**이다(P4 컷 1b부터).

`supabase/config.toml`의 `[auth]`를 바꾸면 `db:reset`으로는 반영되지 않는다 —
`db:stop && db:start`가 필요하다.

**공개 가입은 `[auth].enable_signup = false`로만 끈다.** `[auth.email].enable_signup`을
끄면 GoTrue의 `EXTERNAL_EMAIL_ENABLED`가 꺼져 **이메일 로그인 자체가** 막힌다
(`422 email_provider_disabled`). 실측으로 확인했다 — DOC-010 §7 SEC-03 각주.

**`db:reset` 직후 GoTrue가 `502`를 낼 수 있다.** 리셋이 컨테이너를 재시작하는데
Kong이 낡은 업스트림을 잡고 있어서다 — 컨테이너는 전부 `healthy`인데 인증만 죽어
있으므로 스위트 결함으로 오해하기 쉽다(`tests/e2e/global-setup.ts`가 "시드 사용자로
로그인할 수 없다: 502"로 실패한다). `docker restart supabase_kong_<프로젝트>` 후
8초면 200이 된다.

`auth.users`에 사용자를 직접 넣을 때는 **토큰 열 8개를 `''`로 명시한다.** 4개는
컬럼 기본값이 없어 `NULL`이 되고, GoTrue가 그것을 널 불가 `string`으로 스캔해
로그인이 `500`으로 죽는다. `supabase/seed/00_rls_test_users.sql`의 주석 참조.

## 작업 방식

- 변경 후 `npm run test`와 `npm run typecheck`를 실행한다
- 세금·판정 로직을 건드리면 반드시 전체 테스트를 돌린다
- 커밋은 기능 단위로 쪼갠다. 학기 중 중단 가능성이 있어 각 커밋은 동작하는 상태여야 한다
- 미결정 사항(각 문서 말미)에 해당하는 판단이 필요하면 임의로 정하지 말고 물어본다
