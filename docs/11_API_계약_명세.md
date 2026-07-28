# API · 계약 명세

**언제들어오나** — ELS 통합관리 시스템

| 항목 | 내용 |
|---|---|
| 문서 ID | DOC-011 |
| 버전 | 1.3 |
| 작성일 | 2026-07-26 |
| 작성자 | 민서 |
| 선행 문서 | DOC-002 데이터 모델 v0.6, DOC-007 계산 로직 명세 v0.5, DOC-008 화면 목록 v0.3, DOC-010 아키텍처 v1.0 |
| 상태 | 검토 중 |

### 변경 이력

| 버전 | 일자 | 작성자 | 변경 내용 |
|---|---|---|---|
| 0.1 | 2026-07-26 | 민서 | 최초 작성 |
| 1.3 | 2026-07-28 | 민서 | **P4 컷 1b — §8에 무효화 실측을 기록한다.** 계획은 계약별 경로 목록을 손으로 적는 것이었고, 그 전에 네 경우를 실측하기로 게이트를 두었다(«의존하는 설계보다 실측을 앞에 둔다»). 결과가 설계를 바꿨다 — **세 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이 아홉 칸 전부 같았고**, 대조군이 초록인 것이 실험 실패가 아님을 `revalidatePath` 호출 로그로 확인했다(②는 일곱 경로, ③은 `/tax` 하나). 서버에 지울 것이 없기 때문이다. 그래서 §8에 남기는 것은 **판정 기준**(`affects` × `ROUTE_QUERIES`)이고 경로 목록은 그 곱으로 도출한다. 상세는 DOC-010 §9 AQ-02. 함께 기록한 두 반직관: 시세는 세금·전망을 낡게 하지 않고(§4.6의 추정 기여가 `grossExpected`뿐이다), 상환은 시세 화면을 낡게 한다(§4.5 `usedByActiveProducts`가 미상환 기준이다) |
| 1.2 | 2026-07-28 | 민서 | **P4 착수 전 선행 정정 (U-01) — 화면을 세우기 전에 매트릭스의 결함을 고친다.** (1) **§8에 `createAsset`을 SCR-302에도 배정** — v1.1까지 SCR-204 전용이었는데, 그러면 **SCR-302의 빈 상태가 순환한다.** DOC-008 §6의 빈 상태가 "등록된 기초자산 없음"이고 ST-02가 다음 행동을 요구하는데 자산을 만들 유일한 경로가 상품 등록이고 상품 등록은 기초자산 선택을 요구한다. 구현 0줄, 배정만 넓힌다. (2) **§8에 SCR-001 행 신설** — 종전 매트릭스는 SCR-101부터 시작해 **로그인 화면이 아예 없었다.** `signIn`·`signOut`은 §5의 열한 계약에 넣지 않는다(도메인 변경이 아니고, `src/app/actions.ts`의 "11개를 1:1로 노출한다"는 불변식을 희석한다) — `src/lib/auth/session.ts`에 두되 `ActionResult`는 재사용한다. (3) **§8 SCR-502에 표시명 변경 보류를 명기** — DB는 허용하나(`grant update (display_name)` + `users_update_self`) §5에 계약이 없다. (4) **§8 SCR-501에 SQ-01 해결 반영** — 화면을 만들지 않되 `listUserSummaries`는 남긴다. (5) **§4.0 왕복 표에 `getUser()` 2회 등재** — P4 선행 조건 ②의 프록시가 한 번 더 부르며 `cache()`가 프록시 경계를 건너지 못한다. **프록시의 답을 요청 헤더로 내려보내 합치지 않는다**(위조 가능한 신뢰 채널이며 `getSession()`이 아니라 `getUser()`를 쓰는 전제를 깬다) |
| 1.1 | 2026-07-28 | 민서 | **P3b 산출물 대조 검증(P3b.5)에 따른 정정. 감사 8건 중 문서가 정본인 것들을 먼저 고친다(U-01).** (1) **§3.2.1 제약 이름 표에 9행 추가 — 문서가 코드보다 뒤처져 있었다.** 표는 15개 이름을 열거했는데 `errors.ts`의 `BY_CONSTRAINT`는 24개였고, 빠진 것들(`redemptions_els_id_key`·`assets_name_market_key`·`tax_profiles_user_id_tax_year_key` 등)이 전부 **계약 경로에서 도달 가능한 제약**이다. 대조 단언이 `arrayContaining`이라 여분을 허용했으므로 그 뒤처짐이 어느 테스트도 실패시키지 않았다 — v1.1부터 `tests/db/docs-contract.test.ts`가 이 표를 파싱해 **양방향**으로 대조한다. `*_required` 두 개를 한 행에 합쳐 두었던 것도 갈랐다(합치면 `규칙` 열 분해가 파서에만 존재하는 특수 처리가 된다). (2) **§5.9에 `fields` 키를 명시 — V-18이 층마다 다른 칸을 가리키고 있었다.** 계약 계층은 `touchedAt`, DB 매핑(`els_products_ki_touched_check`)과 §6 V-18은 `kiTouchedAt`이었다. §3.1이 `fields` 키를 "계약 입력의 필드 이름"으로 정의했는데 이 계약의 입력은 위치 인자라 필드 이름이 없고, 그 공백에서 갈렸다. `kiTouchedAt`으로 통일한다. (3) **§6 V-20 대상에 `totalRounds` 추가**(구현은 처음부터 검사하고 있었고 목록에만 빠져 있었다. 저장되지 않는 값이라 이 검사가 유일한 방어다) **+ 규칙 ID 재사용 각주 신설** — 셰이프 파싱이 형태·열거·boolean 검사에 그 필드의 규칙 ID를 빌려 쓰는 사실과, **20개 안에서의 오태그는 어떤 단언도 잡지 못한다**는 대가를 함께 적었다. §6에 형태 규칙을 신설하지 **않는** 이유는 `RULE_IDS`가 §6에서 파생된다는 방향이 뒤집히기 때문이다. (4) **§5.4에 과거 연도 상환의 `INTERNAL`을 명시** — 시드보다 과거 연도는 조회 계층이 거부하므로(ADR-005) `withholdingTax` 미입력 시 `INTERNAL`이 된다. 그것이 옳은 코드인지는 정하지 않았고 이유(원인이 두 필드로 갈려 안내 문구가 정반대다)와 함께 P4로 미룬다. (5) **AQ-30 보완 — W-04가 구조로 걸리는 범위는 11개 중 9개다.** `.rpc()` 경유 2개는 린트 셀렉터가 보지 않고 `productPayload()`가 열 사양에서 파생되지 않는다. 새 금액 열이 생기면 빠뜨려도 아무것도 실패하지 않는다. (6) **AQ-31 신설** — `refreshPrices`의 성공 경로가 한 줄도 실행되지 않으며 ADR-007이 닫히는 순간 처음 실행된다 |
| 1.0 | 2026-07-28 | 민서 | **P3b 구현 완료 반영 — 이 버전부터 §5는 선행 명세가 아니라 구현 대조본이다.** (1) **§5.0.1 신설 — 왕복 수 실측표(계약 11개).** 테이블 다중집합으로 세며, 사전 조회가 필요한 계약만 2 이상이고 §5.5의 두 계약만 3인 이유(상품이 아니라 상환 `id`를 받는다)를 함께 적었다. **검증에서 거부되는 입력은 왕복 0**임도 실측했다. (2) **AQ-30 해결** — 생성 타입을 그대로 따르면 `99999999999.999999`가 `100000000000.000000`으로 저장된다는 것을 실측했다. **두 요청 모두 `201`이며** 거부도 경고도 없다 — 그 사실이 동시에 PostgREST가 `numeric` 열에 JSON 문자열을 그대로 받는다는 증거이므로, 어긋나는 쪽은 전송 계층이 아니라 생성 타입이다. `InsertPayload<T>`가 열 사양에서 금액 열을 파생하고 린트가 리터럴 우회를 막는다. 읽기·쓰기가 `CountingColumn` 하나를 공유하므로 두 방향이 갈릴 수 없으며 그 동치를 타입 수준에서 단언한다. (3) **AQ-27 해결** — 귀속연도 파생을 `currentYear()` 하나로 합쳤다. (4) **AQ-29 보완** — 계약과 함수 직접 호출의 차이를 실측해 등재했다(우회 시 잃는 것은 배열 인덱스와 "DB에 닿지 않음"이다). (5) §5.1·§5.2의 원자성을 **대조군과 함께** 측정했다 — 요청 3개로 나누면 기초자산 0건 상품이 실제로 남고(`UNDERLYING_MISSING`), 함수를 경유하면 상품 열·하위 행이 모두 되돌아간다 |
| 0.9 | 2026-07-27 | 민서 | P3b 변경 계약 구현 착수에 따른 선행 명세. **구현은 P3b 3단계 이후다.** (0) **§5.0 신설 — 변경 컨텍스트와 쓰기 규약 W-01~W-05.** §4.0이 조회에 대해 한 일을 변경에 대해 한다. (1) **§5.1·§5.2의 원자성 수단 확정(U-03).** "단일 트랜잭션"은 PostgREST가 요청당 1 트랜잭션이므로 요청 3개로는 만족되지 않는다 — 그대로 구현하면 부분 실패가 기초자산 0건 상태를 남기고 **§5.3의 "계약을 경유하는 어떤 조작도 0건 상태를 만들 수 없다"가 거짓이 된다.** 쓰기 함수 `create_els_product`·`update_els_product`를 경유하며, 그 함수가 I-07에 **DB 층 방어를 처음 부여**한다(DOC-010 AQ-14 부분 해소). (2) **§3.2에 오류 매핑 표 신설** — SQLSTATE는 거부의 형태이고 `ErrorCode`는 화면 처리이므로 둘은 1:1이 아니다. 제약 이름이 최종 판정자다. (3) **AQ-17 종결** — 순수 모듈의 예외는 전부 `RangeError`라 예외로는 입력 오류와 상태 결함을 구분할 수 없으므로 **호출 지점**이 코드를 부여한다. `CONFLICT`는 순수 모듈 예외에서 나오지 않는다. (4) **AQ-10 종결** — 스키마 검증 도구를 도입하지 않는다. (5) **§6 V-08을 필드별로 세분(U-03)** — `0 < x`가 DOC-007 §4.1의 원금상환형 리자드(`lizardCouponRate = 0`)를 거부하고 있었다. **V-19·V-20 신설**(문자열 길이·정수 범위) — 초과분이 `22001`·`22003`으로만 거부되어 어느 필드인지 알 수 없었다. (6) §5.4~§5.9 각 절에 산출 세부·2단계 삭제의 위치·기준일 의존·공급자 미선정 시 동작 명기. (7) **§9 AQ-26·AQ-27 처리, AQ-29 신설.** (8) **§3.2.1에 오류 본문 실측 표(P3b 2단계)** — 두 가지가 명세를 고쳤다: **plpgsql `RAISE`의 `constraint` 옵션이 HTTP 경계를 넘지 못하므로**(`pg` 직결에서는 오는데 PostgREST를 지나면 사라진다) `detail` 첫 줄에 이름을 함께 싣는 규약을 추가했고, **날짜 형식 오류는 `22P02`가 아니라 `22007`**이어서 매핑에 그 코드를 더했다 — 빠뜨리면 잘못 입력한 날짜가 `INTERNAL`이 된다 |
| 0.8 | 2026-07-27 | 민서 | P3a 산출물 대조 검증(P3a.5)에 따른 정정. (0) **§4.2에 D1의 억제 범위 신설 — 본 버전의 핵심.** v0.6이 정한 우선순위 표는 `conditionResult`·`kiStatus`만 규정했는데 구현이 그것을 **결함 상품 전체의 판정 중단**으로 해석했고, 그 결과 같은 결함 상품이 계약마다 다르게 보였다 — §4.3은 `projection`을 `null`로 두면서 §4.6은 같은 상품의 예상 과세소득을 숫자로 냈고, `SCHEDULE_MISSING` 상품은 `ratio`가 표시되는데 `isWorst`만 사라졌다. **억제는 그 결함이 파괴한 입력을 쓰는 값에만 미친다**(입력 기준)로 확정하고, `integrityIssue` 축과 E-05 축이 별개임을 함께 명기했다. (1) **§4.3 `projection`의 null 사유 재정의(U-03)** — v0.6의 "② `integrityIssue ≠ null`"을 철회한다. 이 값은 계약 조건에서만 나오고 시세를 쓰지 않으므로 `UNDERLYING_MISSING`에서도 산출된다. ②·③을 "적용 차수 없음" 하나로 합쳤다. (2) **§4.3 `isWorst` 정의 보강** — `SCHEDULE_MISSING`은 "산출 불가"에 해당하지 않는다. (3) **§4.1 `attentionItems`에 원칙 적용 + 표시 순서 고정** — 결함이 파괴하지 않은 입력에서 나오는 사유는 함께 보고한다. 일정 0건 상품은 §4.4에 행이 없고 `upcomingEvaluations`에도 없어 **이 목록이 유일한 창구**이므로, 억제하면 그 KI 하회가 시스템 어디에서도 보이지 않는다. `PRICE_MISSING`은 시세 입력이 파괴된 결함에서 내지 않는다. (4) **§4.0 Q-07에 시세 형식 분류 신설** — 시세(`numeric(18,6)`)는 금액·비율 어느 쪽도 아닌데 세 필드가 DB `::text` 원형을 그대로 통과시키고 있었다. 계약 계층에서 6자리로 정규화한다. (5) **§4.6 `contributingProducts[].integrityIssue` 신설** — 금액은 불변이고 표식만 붙는다. (6) **§4.2 `nextEvaluation` 주석 정정** — v0.6이 `projection`에만 적용한 "전 차수 경과 미상환" 정정을 전파. (7) **§4.8에 표식을 두지 않는 판단 기록.** (8) **§9 AQ-22·AQ-24~27 신설**, AQ-09·AQ-17 보완 |
| 0.7 | 2026-07-27 | 민서 | P3a 구현 완료에 따른 실측 반영. (1) **§4.0에 실측 각주 신설** — PostgREST의 `::text` 캐스팅은 postgrest-js 타입 파서가 이해하지만 **널 허용을 잃는다**(`ki_barrier::text`가 `string`으로 추론되나 런타임은 `null`을 준다). 조회 계층은 생성 타입에서 널 허용을 복원한다. 계약별 왕복 수 실측도 함께 등재. (2) **§4.4 구현 형태 명기** — 질의의 루트를 `redemption_schedules`로 둔다. 상품을 루트로 두고 날짜를 임베드 필터로 내리면 판정이 **잘린 일정 집합**에서 이루어져 `conditionResult`가 엉뚱한 차수에 붙는다. (3) **§4.6 `bracketLabel`의 최하단 구간 규칙 추가**(하한 0 → `"… 이하"`) — v0.6이 정하지 않은 경우를 구현 전에 문서에 등재. (4) **Q-06 감지 방식 구체화**(`limit(상한+1)` 후 `> 상한`). (5) **§9 AQ-18 각주** — `getForecast` 미구현 확정 |
| 0.6 | 2026-07-27 | 민서 | P3a 조회 계약 구현 착수에 따른 정정. **본 버전은 선행 명세다 — 구현은 P3a 2~8단계.** (1) **§4.0 신설** — 조회 컨텍스트(기준일·조회자)를 계약으로 등재. 기준일을 `Asia/Seoul`로 고정하고, 파생 필터의 적용 위치, 결과 절단 거부, 문자열 형식, 미인증 동작을 정한다. (2) **§4.2·§4.3·§4.4에 `integrityIssue` 신설 + §9 AQ-17의 조회 부분 철회(U-03)** — 기초자산 0건에서 §3.1의 예외 전파를 문자대로 두면 남의 결함 상품 1건이 SCR-101·201·301을 **전원에게** 죽이고(모든 SELECT가 `using (true)`), §8 매트릭스상 SCR-204도 `getProduct`를 쓰므로 유일한 복구 경로까지 막혀 UI로 고칠 수 없게 된다. (3) **§4.6·§4.8 범위 정정** — `tax_profiles` SELECT가 본인 한정이므로 타인의 `other_financial_income`을 읽을 수 없고, 그대로 구현하면 타인의 금융소득이 조용히 과소 표시된다. (4) **§4.7 미구현 명기** — `totalAssets`·`remainingPrincipal`이 어느 문서에도 정의되지 않았다. (5) **정의가 없던 필드 확정** — §4.1 창·`reason` 값, §4.3 `totalRounds`·`projection`·`expectedGross`·`isWorst`, §4.5 `isStale`, §4.6 `bracketLabel`·프로필 폴백·세율 연도. (6) **§5.3 각주 정정**, §6 V-03 재서술 |
| 0.2 | 2026-07-27 | 민서 | P1 구현 착수에 따른 정정. §4.6 `TaxSummaryView.tax.method1`·`method2`를 `string | null`로 변경. `F ≤ 종합과세 기준금액` 구간은 비교과세를 적용하지 않으므로(DOC-007 v0.2 §5.2) 두 방식 값이 존재하지 않는다 |
| 0.3 | 2026-07-27 | 민서 | DOC-007 v0.3 §9.1(E-05 반환 계약)에 맞춘 정정. §4.2 `ProductListItem.kiStatus`를 `... | null`로 변경 — 상환 완료 상품은 KI 판정을 수행하지 않으므로 등급이 존재하지 않는다. 같은 뷰의 `nextEvaluation`·`conditionResult`가 이미 `null`을 허용하는데 `kiStatus`만 값을 요구하여, 상환 완료 상품에서 계약을 만족시키려면 판정하지 않은 등급을 지어내야 했다 |
| 0.5 | 2026-07-27 | 민서 | P2 산출물 대조 검증(P2.5)에 따른 정정. (1) **§5.3에 하위 행 개별 삭제 계약의 부재를 명기** — DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓혔으므로, 기초자산·차수를 줄이는 경로가 `updateProduct`의 전체 교체 하나뿐임을 계약에 드러낸다. DB 층에는 방어가 없어 계약 한 층뿐임을 함께 기록한다. (2) **§5.2에 KI 세 필드의 동반 규칙 명기** — I-11·I-15가 DB 제약으로 승격되어 셋 중 일부만 비우는 입력이 `23514`가 된다. (3) **§5.7에 좌표 불변(I-16)과 `.upsert()` 사용 가능성 명기** — 좌표 불변을 열 단위 GRANT로 강제하면 `.upsert()`가 payload 전역을 `DO UPDATE SET`에 실어 실패하므로, 트리거로 강제해 클라이언트 도구를 그대로 쓸 수 있게 했다. (4) **§6 V-18 신설, V-02·V-03의 대상 명시, V-11·V-13·V-14·V-16에 대응 I-규칙 태그 추가.** (5) **§9 AQ-17 신설** |
| 0.4 | 2026-07-27 | 민서 | P2 스키마 결정 반영. (1) **§5.3 `deleteProduct` 동작 정정** — 상환 완료 상품은 삭제할 수 없고 `CONFLICT`를 반환한다. 종전 서술("하위 레코드(기초자산·일정·상환)를 함께 삭제한다")은 실현된 과세 이력을 조작 한 번으로 지우는 경로였고, 그 결과 해당 귀속연도의 세액이 조용히 바뀐다. 근거는 DOC-002 v0.3 §8.1. (2) **§6에 V-17 신설** — 미래 일자 시세 입력 거부. (3) §9 AQ-07을 DQ-01과 함께 해결로 갱신 |

---

## 1. 목적 및 접근 방식

본 문서는 화면과 데이터 계층 사이의 **계약**을 정의한다. 조회 계약, 변경 계약(서버 액션), 외부 엔드포인트, 에러 모델, 검증 규칙을 다룬다.

### 1.1 REST · OpenAPI를 채택하지 않은 이유

ADR-001에서 Next.js 풀스택을 채택했으므로 시스템의 실제 계약면은 다음과 같이 구성된다.

| 유형 | 실행 위치 | 호출 방식 |
|---|---|---|
| 조회 | 서버 컴포넌트 | 함수 직접 호출 |
| 변경 | 서버 액션 | 클라이언트 → 서버 자동 직렬화 |
| 외부 호출 | Route Handler | HTTP |

이 구조에서 HTTP 기반 REST 계층을 추가로 두면 **소비자가 없는 인터페이스를 유지보수하게 된다.** 화면과 서버가 동일 배포 단위 안에 있고 외부 클라이언트가 없으므로(O-06 네이티브 앱 제외), REST 계층은 코드량만 늘리고 새 가치를 만들지 않는다.

또한 OpenAPI 문서는 구현과 별도로 관리되므로 표류(drift) 위험이 있다. 반면 **타입 정의를 계약으로 삼으면 불일치가 컴파일 시점에 드러난다.**

**따라서 본 문서는 함수 시그니처를 계약으로 취급한다.** 유일한 HTTP 엔드포인트인 Cron은 7장에서 별도 정의한다.

> **향후 외부 클라이언트가 필요해질 경우**, 본 문서의 계약 함수를 그대로 재사용하는 Route Handler를 얇게 추가한다. 계약 정의는 변경되지 않는다.

### 1.2 조회를 서버 액션으로 정의하지 않는 이유

조회는 서버 컴포넌트에서 함수를 직접 호출한다. 서버 액션은 변경 작업에만 사용한다. 조회를 서버 액션으로 감싸면 캐싱·스트리밍 이점을 잃고 불필요한 왕복이 발생한다.

---

## 2. 표기 규약

```ts
// 계약 표기 예
function contractName(input: InputType): Promise<OutputType>
```

| 규약 | 내용 |
|---|---|
| 날짜 | ISO 8601 문자열 (`YYYY-MM-DD`) |
| 금액·비율 | **문자열로 전달**한다. 부동소수점 변환을 방지하기 위함 (DOC-002 M-03) |
| 비율 | 소수 정규화 값 (`"0.9"` = 90%). 입력 계층에서 변환 (M-04) |
| 식별자 | UUID 문자열 |
| 선택 필드 | `?` 표기 |
| 열거형 | DOC-005에 정의된 값만 사용 |

---

## 3. 공통 계약

### 3.1 결과 타입

모든 변경 계약은 예외를 던지지 않고 결과 객체를 반환한다. 예외 기반 흐름은 클라이언트에서 필드별 오류 표시를 어렵게 한다.

```ts
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: ActionError }

type ActionError = {
  code: ErrorCode
  message: string                        // 사용자 표시용 (한글)
  fields?: Record<string, string>        // 필드별 검증 오류
}
```

조회 계약은 결과 객체를 사용하지 않는다. 미존재는 `null`을 반환하고, 시스템 오류는 예외로 전파하여 에러 경계에서 처리한다.

> **미인증에서 두 계약면이 다르게 행동한다 (v0.9).** 조회는 예외를 던지고(§4.0 Q-04) 변경은 `UNAUTHENTICATED`를 **결과 객체로** 반환한다. 대칭이 아닌 것이 의도다 — §3.2의 에러 코드 표는 처음부터 변경 계약의 `ActionError` 표이며 `UNAUTHENTICATED`가 그 첫 줄이다. 변경은 사용자가 입력을 들고 있는 시점에 일어나므로, 예외로 전파해 에러 경계가 화면을 갈아치우면 **입력값이 사라진다**(DOC-008 §6이 SCR-203·204에 "입력값 보존"을 요구한다). 조회에는 보존할 입력이 없다.

### 3.2 에러 코드

| 코드 | HTTP 대응 | 의미 | 화면 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 미인증 | SCR-001로 이동 |
| `FORBIDDEN` | 403 | 소유자 아님 | SCR-902 |
| `NOT_FOUND` | 404 | 대상 없음 | SCR-901 |
| `VALIDATION_FAILED` | 400 | 입력 검증 실패 | 필드별 오류 표시, 입력값 보존 |
| `CONFLICT` | 409 | 상태 충돌 (예: 이미 상환됨) | 안내 후 화면 갱신 |
| `PROVIDER_UNAVAILABLE` | 503 | 시세 공급자 오류 | 폴백 안내 (ST-03) |
| `INTERNAL` | 500 | 그 외 | 일반 오류 안내 |

#### 3.2.1 DB 오류 → `ErrorCode` (v0.9 신설)

**SQLSTATE는 거부의 *형태*이고 `ErrorCode`는 *화면 처리*다.** 둘은 1:1이 아니다 — 같은 `23514`가 "입력을 고치면 되는 일"과 "상태가 충돌해 안내 후 화면을 갱신해야 하는 일" 양쪽에서 나온다. 따라서 **제약 이름이 최종 판정자**다(DOC-002 §8 명명 규약).

| SQLSTATE | 기본 `ErrorCode` | 근거 |
|---|---|---|
| `23505`(UNIQUE) · `23503`(FK) | `CONFLICT` | 다른 행의 존재가 원인이므로 입력만 고쳐서 풀리지 않는다. I-01 이중 상환, `redemptions`의 `RESTRICT`(§5.3)가 이 자리다 |
| `23514`(CHECK · 트리거) | `VALIDATION_FAILED` | 단일 행 불변식이므로 그 행의 값이 원인이다. **단 제약 이름이 상태 충돌 부류(`*_redeemed_immutable`)면 `CONFLICT`로 올린다** |
| `42501` | `FORBIDDEN` | RLS 위반과 권한 미부여를 구분하지 않는다 — 둘 다 "이 조회자는 이 조작을 할 수 없다"이고 화면 처리(SCR-902)가 같다 |
| `22001`(길이) · `22003`(자릿수) · `22007`(날짜 형식) · `22P02`(그 밖의 형식) · `23502`(널) | `VALIDATION_FAILED` | 값의 형태가 원인이다. **대부분 필드를 특정할 수 없다** — V-19·V-20이 그 앞에서 잡는 이유다. `23502`만 예외로 `message`에 열 이름이 온다 |
| 그 외 | `INTERNAL` | 원문 메시지를 사용자에게 노출하지 않고 로그에 남긴다 |

제약 이름 → `fields` 키의 사상은 다음과 같다. 대응하는 계약 계층 규칙이 정상 경로에서 먼저 잡으므로, **이 표가 쓰이는 것은 규칙이 놓친 경우**다.

| 제약 이름 | 규칙 | `fields` 키 |
|---|---|---|
| `redemptions_els_id_key` | I-01 | — |
| `els_underlyings_els_id_asset_id_key` | I-02 / V-09 | `underlyings` |
| `redemption_schedules_els_id_round_no_key` | I-03 / V-04 | `schedules` |
| `redemption_schedules_lizard_barrier_check` | I-04 / V-05 | `schedules` |
| `redemption_schedules_lizard_coupon_check` | I-10 / V-06 | `schedules` |
| `els_products_ki_pair_check` | I-11 / V-16 | `kiObservation` |
| `els_products_ki_touched_check` | I-15 / V-18 | `kiTouchedAt` |
| `redemptions_maturity_loss_check` | I-08 / V-12 | `taxableIncome` |
| `redemptions_taxable_income_check` | I-12 / V-11 | `taxableIncome` |
| `redemptions_round_no_required_check` | I-14 / V-13 | `roundNo` |
| `redemptions_els_id_round_no_fkey` | I-13 / V-14 | `roundNo` |
| `asset_prices_coordinates_immutable` | I-16 | `assetId` · `asOfDate` |
| `els_products_principal_check` | I-17 / V-01 | `principal` |
| `els_products_evaluation_period_check` | I-17 / V-20 | `evaluationPeriodMonths` |
| `redemption_schedules_barrier_check` | I-17 / V-08 | `schedules` |
| `redemptions_gross_amount_check` | I-17 | `grossAmount` |
| `els_products_underlyings_required` | I-07 / V-02 | `underlyings` |
| `els_products_schedules_required` | I-07 / V-03 | `schedules` |
| `els_products_redeemed_immutable` | 상태 충돌 → `CONFLICT` | — |
| `redemptions_els_id_fkey` | I-01 / §5.3 | — |
| `els_underlyings_asset_id_fkey` | §8.1 | `underlyings` |
| `assets_name_market_key` | §5.10 | `name` · `market` |
| `tax_profiles_user_id_tax_year_key` | I-06 | `year` |
| `asset_prices_asset_id_as_of_date_key` | I-05 | `asOfDate` |

**이 표는 `errors.ts`의 `BY_CONSTRAINT`와 양방향으로 일치한다 (v1.1).** `tests/db/docs-contract.test.ts`가 이 표를 파싱해 이름 집합·`규칙`·`fields` 키를 대조하므로, 한쪽만 늘거나 줄면 실패한다. v1.0까지 이 표는 **9행이 모자랐고**(`redemptions_els_id_key`·`assets_name_market_key` 등 계약 경로에서 도달 가능한 것들이다) 대조 단언이 `arrayContaining`이라 여분을 영원히 허용했다 — 문서가 코드보다 뒤처진 사실이 어느 테스트도 실패시키지 않는 상태였다. **한 행에 이름을 둘 싣지 않는다** — `*_required` 두 개를 합쳐 두었던 행을 v1.1에서 갈랐다. 합치면 `규칙` 열의 `I-07 / V-02 · V-03`을 이름과 짝지어 분해해야 하고, 그 특수 처리가 파서에만 존재하게 된다.

**배열 인덱스를 붙이지 않는다.** DB 오류는 몇 번째 원소가 위반했는지 말하지 않는다. 인덱스가 있는 경로(`schedules[3].lizardBarrier`)는 계약 계층 검증이 담당하고, DB까지 도달한 것은 배열 단위로 표시한다 — 없는 정보를 지어내면 사용자가 엉뚱한 행을 고친다.

**제약 이름의 출처 — 실측 (P3b 2단계).** `PostgrestError`는 `{code, message, details, hint}` 넷뿐이고 `pg`가 주는 `constraint` 필드가 **없다.** 실제 JWT로 열 형태를 위반시켜 본문을 측정했다(`tests/integration/error-shape.test.ts`가 이 표를 고정한다).

| 형태 | `code` | 이름·열의 위치 | `details` |
|---|---|---|---|
| 표준 `CHECK` | `23514` | `message`: `… violates check constraint "els_products_ki_pair_check"` | `null` |
| `UNIQUE` | `23505` | `message`: `duplicate key value violates unique constraint "assets_name_market_key"` | `null` — 키 값을 노출하지 않는다 |
| FK `RESTRICT` | `23503` | `message`: `… violates foreign key constraint "redemptions_els_id_fkey" …` | `Key is still referenced from table "redemptions".` |
| **plpgsql `RAISE`** | `23514` | **없다** — `message`는 한글 문구, `details`·`hint`는 `null` | `null` |
| RLS 정책 위반 | `42501` | 이름 없음. `message`에 `row-level security` | `null` |
| 권한 미부여 | `42501` | 이름 없음. `message`에 `permission denied` | `null` (`hint`에 `GRANT …` 문장) |
| 길이 초과 | `22001` | **열 이름 없음.** `value too long for type character varying(100)` — 타입만 말한다 | `null` |
| 자릿수 초과 | `22003` | **열 이름 없음.** `numeric field overflow` | `precision 18, scale 6 …` |
| 날짜 형식 | **`22007`** | `invalid input syntax for type date: "…"` | `null` |
| 널 위반 | `23502` | `message`에 **열 이름이 있다**: `null value in column "currency" of relation "assets" …` | `null` |

**두 가지가 명세를 고쳤다.**

① **plpgsql `RAISE`의 `constraint` 옵션은 HTTP 경계를 넘지 못한다.** I-16 트리거는 `using errcode = '23514', constraint = 'asset_prices_coordinates_immutable'`로 던지고 `tests/rls/`는 그 이름을 단언하는데, 그쪽은 `pg` **직결**이다. PostgREST를 지나면 이름을 얻을 채널이 **하나도 없다.** 그대로 두면 `saveManualPrice`의 유일한 `23514` 경로가 `fields`를 잃고, §5.7이 요구한 `assetId`·`asOfDate` 표시가 불가능해진다.

따라서 **plpgsql `RAISE`는 `detail`에도 이름을 싣는다** — 형식은 `details`의 **첫 줄**을 `constraint=<이름>`으로 고정한다. `constraint` 옵션은 `pg` 경로를 위해 **그대로 유지한다**(두 채널을 다 채우는 것이 어느 테스트도 깨지 않는 유일한 형태다). 계약 계층은 `message`의 `constraint "…"`를 먼저 보고, 없으면 `details`의 첫 줄을 본다.

② **날짜 형식 오류는 `22P02`가 아니라 `22007`이다.** `22P02`(`invalid_text_representation`)는 `uuid`·`numeric` 등에 나오고 `date`·`timestamp`는 `22007`(`invalid_datetime_format`)이다. 매핑에서 빠뜨리면 **잘못 입력한 날짜가 `INTERNAL`로 떨어진다** — 사용자가 고칠 수 있는 오류를 시스템 오류로 보고하는 형태다.

> **`22001`·`22003`이 열 이름을 주지 않는다는 것이 실측으로 확인됐다.** 이것이 V-19·V-20을 신설한 근거이며, 두 규칙 없이는 §3.2의 `VALIDATION_FAILED` 정의("필드별 오류 표시")를 만족하는 응답을 만들 수 없다. `varchar(100)`인 열이 둘 이상이면 추정조차 되지 않는다.

#### 3.2.2 순수 모듈의 예외 → `ErrorCode` (AQ-17 종결, v0.9)

`lib/domain`·`lib/tax`는 전제 위반을 `RangeError`로 거부한다(DOC-007 §3.1 등). 변경 계약은 예외를 던질 수 없으므로(§3.1) 이를 코드로 바꿔야 하는데, **예외 클래스로는 분류할 수 없다** — 같은 `RangeError`가 사용자 입력의 오류(`dec('abc')`)와 저장된 상태의 결함(`worstOf([])`) 양쪽에서 나오고, 둘의 화면 처리는 정반대다.

**따라서 예외가 아니라 호출 지점이 코드를 부여한다.** 순수 모듈을 부르는 자리마다 어느 부류인지 함께 적는다.

| 호출 지점 | 던지는 조건 | `ErrorCode` |
|---|---|---|
| `attributionYear` 등 날짜를 받는 순수 함수 (§5.4의 귀속연도) | 날짜 형식 · 존재하지 않는 날짜 | `VALIDATION_FAILED` + 해당 날짜 필드 |
| `dec()` (금액 · 비율 파싱) | 유한한 수가 아님 | `VALIDATION_FAILED` + 해당 필드 |
| `assertPositiveInteger` | 양의 정수가 아님 | `VALIDATION_FAILED` + 해당 필드 |
| `loadTaxYearContext` · `toTaxConstants` (§5.4 원천징수 산출) | 세율 시드 없음 · 상수 누락 | `INTERNAL` |
| **그 밖의 모든 `RangeError`** | — | `INTERNAL` + 로그 |

> **§6의 검증이 순수 모듈 호출보다 앞선다.** 위 표는 그 앞선 검증을 통과한 뒤에도 남는 경로를 위한 것이다 — 예컨대 V-07은 날짜를 **문자열로** 비교한다(형식이 이미 `YYYY-MM-DD`로 검증되었으므로 사전순이 곧 시간순이다). 순수 모듈에 날짜를 넘기면 그쪽의 `RangeError`를 다시 변환해야 하므로, 변환 지점을 늘리지 않는 쪽을 고른다. 남는 것은 **계약이 저장된 값을 순수 모듈에 넘기는 자리**다.

**`CONFLICT`는 순수 모듈 예외에서 나오지 않는다.** 이것이 AQ-17이 물은 "`INTERNAL`인지 `CONFLICT`인지"의 답이다. 순수 모듈은 자기가 받은 인자만 보므로 "이미 상환됨"·"기초자산 0건"을 **알 수 있는 위치에 없다.** 상태 충돌은 계약 계층의 사전 조회와 DB 오류(§3.2.1)가 판정하며, 그 둘이 이미 그 일을 하고 있다.

**기본값을 `INTERNAL`로 두는 이유.** 예상 밖의 `RangeError`가 나왔다면 그것은 §6의 검증 규칙에 구멍이 있다는 신호다. `VALIDATION_FAILED`로 내면 사용자에게 **고칠 수 없는 것을 고치라고** 요구하게 되고(어느 필드가 원인인지 우리도 모른다), 그 화면은 사용자가 몇 번을 다시 입력해도 같은 오류를 낸다. §4.0 Q-06이 절단을 삼키지 않고 던져서 AQ-09의 신호로 만든 것과 같은 형태다 — 조용히 그럴싸한 응답으로 바꾸지 않는다.

### 3.3 권한 검증

권한은 **RLS가 1차로 강제**한다(ADR-002). 계약 계층은 사용자에게 적절한 오류를 반환하기 위해 보조 검증을 수행한다.

| 계층 | 역할 |
|---|---|
| RLS | 최종 강제. 우회 불가 |
| 계약 계층 | 사전 확인 후 `FORBIDDEN` 반환. UX 목적 |

계약 계층 검증이 누락되어도 데이터는 보호된다. 반대로 계약 계층만 검증하고 RLS가 없으면 보호되지 않는다.

---

## 4. 조회 계약

### 4.0 공통 조회 컨텍스트

본 절의 서명은 모두 **컨텍스트가 결속된 형태**다. 구현은 다음 컨텍스트를 받는 팩토리가 계약 함수를 생성하며, 서명 자체에는 컨텍스트가 나타나지 않는다.

```ts
type QueryContext = {
  db: UserSessionClient     // 로그인 사용자 세션. service_role을 쓰지 않는다
  asOf: string              // 기준일 (YYYY-MM-DD, Asia/Seoul)
  viewerId: string          // 조회자. isOwner·isMe·scope·본인 판정의 기준
}
```

| ID | 규약 | 근거 |
|---|---|---|
| Q-01 | 조회는 **사용자 세션으로만** 수행한다. `service_role`은 편의로도 쓰지 않는다 | RLS를 우회하면 정책 32개가 실제로 작동하는지 어떤 테스트도 증명하지 못한다 (ADR-002) |
| Q-02 | **기준일은 `Asia/Seoul` 기준으로 산출**하고 요청당 한 번만 해석한다 | 실행 환경(Vercel·Node)은 UTC다. UTC 날짜를 쓰면 매일 KST 00:00~09:00 동안 **전날**이 기준일이 되어 D-Day가 하루 어긋나고, "오늘"인 평가일이 미래로 분류되며, 경과 차수를 놓치고, 1월 1일 KST에는 귀속연도가 전년이 되어 세율 연도까지 어긋난다. 두 계약이 각자 오늘을 구하면 자정을 걸친 렌더에 한 화면 두 기준일이 생긴다 |
| Q-03 | 기준일은 순수 모듈과 **같은 값을 공유**한다 | DOC-007 §9.2의 `asOf`, `nextEvaluation`·`isPast`·`dDay`가 이미 기준일을 인자로 받는다 |
| Q-04 | 미인증 상태(`viewerId` 부재)에서 조회 계약은 **예외를 던진다** | §3.1대로 조회는 결과 객체를 쓰지 않는다. §3.2의 `UNAUTHENTICATED`는 변경 계약의 `ActionError` 표이므로 조회에 적용되지 않는다. SCR-001 유도는 화면 층의 책임이다 |
| Q-05 | 파생값 기반 필터·정렬은 **조회 후 적용**한다 | `status`·`kiStatus`·`conditionResult`·D-Day는 저장된 열이 아니라 판정 결과다. 반대로 `ownerId`·평가일 범위·미상환 여부는 열 조건이므로 질의로 내린다 |
| Q-06 | 결과가 서버 상한에 걸려 잘리면 **예외를 던진다.** 잘린 목록을 반환하지 않는다 | 조용히 넘기면 화면은 정상으로 보이고 목록만 짧아진다. 현재 규모(A-01)에서는 도달 불가하며, **도달했다면 AQ-09(페이지네이션)를 닫아야 한다는 신호**다. 감지는 `= 상한`이 아니라 `limit(상한 + 1)` 요청 후 `> 상한`으로 한다 — 정확히 상한 행수인 정상 결과를 오탐하지 않기 위함이다 |
| Q-07 | 금액은 정수 문자열, 비율은 **소수 4자리 고정 문자열**, 시세는 **소수 6자리 고정 문자열**로 전달한다 | §2가 형식을 정하지 않았다. 워스트오브는 나눗셈이므로 고정소수점 연산 결과를 그대로 문자열화하면 40자리가 나올 수 있고, 화면이 그것을 렌더링한다. 4자리는 저장 정밀도(`numeric(6,4)`)와 일치한다. 시세는 두 분류 어디에도 맞지 않는다 — 정수로 반올림하면 `412.55 → "413"`으로 값이 망가지고, 4자리로 접으면 저장 정밀도(`numeric(18,6)`)를 잃는다 |
| Q-08 | 금액·비율은 DB 경계에서 **문자열로 수신**한다 | 수치형으로 받으면 JSON 파싱이 부동소수점을 경유한다(M-03, 절대 규칙 #2). 15자리 이내 금액은 부동소수점으로도 값이 맞아떨어지므로 **값 단언으로는 검출되지 않는다** — 타입 층에서 막는다 |

> **컨텍스트를 서명에 넣지 않는 이유.** 본 문서는 함수 시그니처를 계약으로 취급한다(§1.1). 컨텍스트를 인자로 노출하면 화면이 계약을 호출할 때마다 기준일·조회자를 직접 전달하게 되고, 그 순간 "요청당 한 번"(Q-02)이 규율이 된다. 결속을 팩토리로 옮기면 §4.1~§4.9의 서명이 문서 그대로 유지되면서 Q-02가 구조로 보장된다.

> **Q-07의 시세 분류는 v0.8에서 추가했다.** v0.7까지 Q-07은 금액과 비율 둘만 정했고, 세 필드(§4.3 `basePrice`·`currentPrice`, §4.5 `latestPrice`)가 DB의 `::text` 원형을 그대로 통과시키고 있음을 P3a 대조 검증에서 발견해 문서에 먼저 등재했다 — 정의가 없는 필드를 구현이 임의로 정하지 않는다(U-01). §4.6 `bracketLabel`의 최하단 구간과 같은 부류의 발견이다.
>
> **DB 원형 통과가 아니라 계약 계층에서 정규화한다.** 원형을 통과시키면 형식의 주인이 열 선언이 되어, 열을 `numeric(18,4)`로 바꾸는 순간 API 출력 형식이 조용히 바뀐다. 비율이 `numeric(6,4)`인데도 `ratioString`이 DB 렌더링을 신뢰하지 않는 것과 같은 논거다. **지금 DB가 이미 6자리로 주므로 값은 변하지 않는다** — 이 규약이 막는 것은 원천이 바뀌었을 때(공급자 API가 `"95.0"`을 주는 경우) 화면 자릿수가 조용히 흔들리는 일이다.

**Q-08의 실측 (v0.7).** `::text` 캐스팅의 효과를 런타임과 타입 양쪽에서 측정했다.

| select | 런타임 | postgrest-js 추론 |
|---|---|---|
| `principal` | `123456789` (number) | `number` — float64 위험 그대로 |
| `principal::text` | `"123456789"` | `string` |
| `annual_coupon_rate` | `0.08` (number) | `number` — **저장 정밀도 `0.0800`을 잃는다** |
| `annual_coupon_rate::text` | `"0.0800"` | `string` |
| `ki_barrier::text` (열이 `NULL`) | `null` | **`string`** ← 널 허용이 사라진다 |
| `els_underlyings(base_price::text)` | `"412.550000"` | `string` — 임베드 안쪽도 이해한다 |

파서가 `any`가 아니라 `string`을 주므로 "조용한 float64"는 아니다. 그러나 **널 허용이 사라지는 것은 타입이 사실과 어긋나는 별개의 결함**이다 — 노낙인 상품의 `ki_barrier`는 실제로 `null`로 오는데 타입은 `string`이라고 말한다. 그래서 조회 계층은 행 타입을 postgrest의 추론에 맡기지 않고 **생성 타입에서 널 허용을 복원**한다. select 문자열과 행 타입을 테이블별 열 사양 하나에서 함께 파생시켜 둘이 어긋날 수 없게 하고, 금액·비율 열을 캐스팅 없이 두면 **타입 오류**가 되게 한다(값 단언으로는 검출되지 않으므로).

**계약별 왕복 수 실측 (v0.7).** REST 요청 수이며, 요청당 `getUser()` 1회가 별도로 있다(`cache()`로 중복 제거).

| 계약 | 왕복 | 구성 |
|---|---|---|
| `listProducts`·`getProduct` | 2 | 상품+하위 임베드 / 자산별 최신 시세 |
| `listSchedule` | 2 | 차수+부모 임베드 / 자산별 최신 시세 |
| `searchAssets` | 1 | 이름 부분일치 |
| `listAssetPrices` | 2 | 자산+최신 시세 / 상품(참조 수 계산) |
| `getTaxSummary` | 3 | 세율 연도 / 프로필 / 상품 |
| `listUserSummaries` | 4 | 사용자 / 상품 / 세율 연도 / 프로필 |
| `getDashboard` | 4 | 상품 / 시세 / 세율 연도 / 프로필 |

`자산별 최신 시세`는 **부모별 `limit(1)`**이다 — 자산 3건에 시세 6행이 있을 때 각 부모가 정확히 1건(시세 없는 자산은 빈 배열)을 반환함을 실측했다. 평면 조회 후 JS에서 접으면 서버 상한에 걸려 **조용히 잘린 목록에서 "최신"을 고르는** 경로가 되고, 그때 틀리는 것은 값이 아니라 날짜이므로 화면에 드러나지 않는다.

> **`getUser()`가 요청당 2회가 된다 (v1.2, P4 선행 조건 ②).** 위 표의 "요청당 `getUser()` 1회"는 `src/lib/db/server.ts`의 `cache()` 기준이다. `src/proxy.ts`가 서면 **프록시가 한 번 더 부른다** — React의 요청 메모이제이션은 프록시 경계를 건너지 못하므로 `cache()`가 이를 합치지 못한다.
>
> **프록시의 답을 요청 헤더로 내려보내 합치지 않는다.** 그것은 위조 가능한 신뢰 채널이고, `server.ts`가 `getSession()`이 아니라 `getUser()`를 쓰는 이유가 정확히 "클라이언트가 준 주장을 믿지 않는다"이다. 비용을 줄이려고 그 전제를 깨면 Q-01(세션으로만 조회한다)이 형식만 남는다. 비용을 기록하고 감수한다.

### 4.1 대시보드 — SCR-101

```ts
function getDashboard(params: {
  scope: 'MINE' | 'ALL'
}): Promise<DashboardView>

type DashboardView = {
  upcomingEvaluations: Array<{
    productId: string
    productName: string
    ownerName: string
    roundNo: number
    evaluationDate: string
    dDay: number
    worstOf: string | null            // null = 시세 없음
    barrier: string
    willMeet: boolean | null
  }>
  totals: {
    activePrincipal: string
    activeCount: number
    realizedPnl: string
  }
  currentYearTax: {
    year: number
    financialIncome: string
    isComprehensive: boolean
    additionalTax: string
  }
  attentionItems: Array<{
    productId: string
    productName: string
    reason:
      | 'KI_NEAR'              // 표시 등급 WARNING
      | 'KI_BELOW'             // 배리어 하회 관측 — 사용자 확인 필요 (D-04)
      | 'KI_TOUCHED'
      | 'EVALUATION_PASSED'
      | 'PRICE_MISSING'
      | 'UNDERLYING_MISSING'   // 무결성 결함 (§4.2)
      | 'SCHEDULE_MISSING'
  }>
}
```

> `currentYearTax`는 **로그인 사용자 본인 기준**으로만 산출한다. `scope = 'ALL'`이어도 세금은 합산하지 않는다(DOC-002 D-02).

**`upcomingEvaluations`는 기간 창을 두지 않는다.** 미상환 상품의 다음 평가일(DOC-007 §9.2 `nextEvaluation`) 전체를 `dDay` 오름차순으로 반환하며, 표시 건수는 화면이 정한다. "임박"의 경계를 계약에 박으면 그 값이 어느 문서에도 근거가 없는 상수가 되고, 창 밖의 상품은 화면에서 사라져 SCR-101의 목적("곧 평가일이 오는 상품이 있는가")이 조용히 좁아진다. 이미 경과한 차수는 이 목록이 아니라 `attentionItems`의 `EVALUATION_PASSED`가 담당한다(DOC-007 §9.2가 두 구간을 배타적으로 나눈다).

> **`KI_BELOW`를 신설한 이유 (v0.6).** 종전 열거값에는 표시 등급 `BELOW`(`W ≤ ki_barrier`, DOC-007 §3.4)와 터치 후보에 해당하는 값이 없었다. 그런데 시스템이 `ki_touched_at`을 자동 확정하지 않으므로(D-04) **이 상태가 사용자 확인이 필요한 유일한 상태**이고, 조치 목록의 존재 이유에 가장 가깝다. `KI_NEAR`(주의)로 접으면 확인 요청이 경고로 격하되고 `KI_TOUCHED`로 접으면 확정되지 않은 사실을 확정으로 표시한다.

**한 상품이 여러 사유를 올린다 — 결함은 나머지를 가리지 않는다 (v0.8).** 종전 구현은 결함이면 그것 하나만 보고했다. 그러나 조치 사유는 저마다 다른 입력에서 나오므로, **결함이 파괴하지 않은 입력에서 나오는 사유는 함께 보고한다**(§4.2의 입력 기준).

| 상황 | 결과 |
|---|---|
| `SCHEDULE_MISSING` + KI 하회 | `['SCHEDULE_MISSING', 'KI_BELOW']` |
| `UNDERLYING_MISSING` + 경과 평가일 | `['UNDERLYING_MISSING', 'EVALUATION_PASSED']` |
| `UNDERLYING_MISSING` | `PRICE_MISSING`을 **내지 않는다** |
| `SCHEDULE_MISSING` + 시세 없음 | `PRICE_MISSING`을 낸다 (진짜 E-01이다) |
| 상환 완료 + 결함 | 결함만. 상환은 결함을 해소하지 않는다 |

> **억제하면 그 상태가 시스템 어디에서도 보이지 않는다.** 일정 0건 상품은 §4.4에 **행이 생기지 않고** `upcomingEvaluations`도 `nextEvaluation = null`로 제외하므로, **이 목록이 유일한 창구다.** `KI_BELOW`는 사용자 확인이 필요한 유일한 상태인데(D-04, 위 각주), 결함으로 가리면 결함을 고치기 전까지 그 확인 요청이 사라진다. 결함 수정(SCR-204)과 KI 확인은 **다른 조치**다.
>
> **`PRICE_MISSING`은 시세 입력이 파괴된 결함에서 내지 않는다.** 그 표시는 "시세가 수집되면 해소된다"는 약속인데, 기초자산 0건에서 그것은 **영원히 오지 않을 시세를 기다리게 하는** 바로 그 상태다(DOC-007 §3.1, §4.2 순위표가 존재하는 이유). 판별은 결함 이름이 아니라 **파괴된 입력**으로 한다 — 이름으로 판별하면 시세 입력을 파괴하는 세 번째 결함이 생겼을 때 조용히 틀린다.

**배열의 순서는 결함 우선으로 고정한다 (v0.8).** 결함은 사용자가 직접 고쳐야 해소되고(SCR-204) 나머지는 시장 상황이므로 조치의 성격이 다르다. 순서를 정하지 않으면 구현이 임의로 정하고, 화면은 첫 사유를 대표값으로 읽는다. 결함 다음은 KI(`TOUCHED` → `BELOW` → `NEAR` 중 하나) → `PRICE_MISSING` → `EVALUATION_PASSED`다.

### 4.2 상품 목록 — SCR-201

```ts
function listProducts(params: {
  ownerId?: string
  status?: 'ACTIVE' | 'REDEEMED'
  kiStatus?: 'SAFE' | 'WARNING' | 'TOUCHED'
  sortBy?: 'EVALUATION_DATE' | 'PRINCIPAL' | 'D_DAY'
}): Promise<ProductListItem[]>

type ProductListItem = {
  id: string
  name: string
  ownerId: string
  ownerName: string
  principal: string
  accountType: 'GENERAL' | 'TAX_FREE'
  status: 'ACTIVE' | 'REDEEMED'        // 파생값 (D-01)
  nextEvaluation: {
    roundNo: number
    date: string
    dDay: number
    barrier: string
  } | null                              // 상환 완료 또는 전 차수 경과 미상환 시 null
  worstOf: string | null
  conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
  kiStatus: 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED' | null
  integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | null
  isOwner: boolean                      // 액션 버튼 노출 판단
}
```

**`conditionResult`·`kiStatus`의 `null`은 세 가지 원인을 갖는다.** 화면은 셋을 구분해 표시하며, **판정 순서는 아래 표의 위에서 아래다.**

| 순위 | 원인 | 조건 | 표시 |
|---|---|---|---|
| 1 | **무결성 결함 (I-07)** | `integrityIssue ≠ null` | "기초자산 없음 — 수정 필요". 시세를 기다려도 해소되지 않는다. SCR-204로 유도한다 |
| 2 | E-05 상환 완료 | `status = 'REDEEMED'` | 판정 생략 — 표시값은 상환 실적이다. 영구적이다 |
| 3 | E-01 시세 없음 | `status = 'ACTIVE'` 이고 `worstOf = null` | "시세 없음" — 시세가 수집되면 값이 생긴다 |

**순위가 필요한 이유.** 무결성 결함 상품은 `status = 'ACTIVE'`이고 `worstOf = null`이므로 3순위 조건을 **그대로 만족한다.** 순서를 정하지 않으면 화면이 "시세 없음"을 표시하며 **영원히 오지 않을 시세를 기다린다** — DOC-007 §3.1의 각주가 막으려던 바로 그 상태다. `integrityIssue`는 그 두 상태와 성질이 다르므로 `status`로 구분할 수 없고 별도 필드가 필요하다.

> **v0.5까지 별도 필드를 두지 않았던 이유와 그 철회(U-03).** v0.3은 "`status`로 두 경우가 구분되므로 별도 필드를 두지 않는다"고 적었고, 그 판단은 원인이 둘일 때는 옳았다. DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓히면서 세 번째 원인이 계약에 도달했다 — 계약을 경유하는 조작으로는 만들 수 없으나 DB에서는 여전히 도달 가능하다(DOC-010 AQ-14). 상세는 §9 AQ-17.

#### D1의 우선순위가 미치는 범위 (v0.8에서 확정)

위 표는 `conditionResult`·`kiStatus`만 규정했다. v0.7 구현은 그것을 **결함 상품 전체의 판정 중단**으로 해석했고, 그 결과 같은 결함 상품이 계약마다 다르게 보였다 — §4.3은 `projection`을 `null`로 두면서 §4.6은 **같은 상품의 같은 계산**으로 예상 과세소득을 냈고, `SCHEDULE_MISSING` 상품은 `ratio`가 표시되는데 `isWorst`만 전부 `false`가 됐다.

**억제는 그 결함이 파괴한 입력을 쓰는 값에만 미친다.** §9 AQ-17이 조회에서 정한 "멈추는 범위가 원인의 범위를 넘지 않는다"와 같은 논리다 — 거기서는 상품 1건의 결함이 목록 **전체**를 죽이지 않게 했고, 여기서는 한 **입력**의 결함이 무관한 파생값을 죽이지 않게 한다.

| 파생값 | 입력 | `UNDERLYING_MISSING` | `SCHEDULE_MISSING` |
|---|---|---|---|
| `worstOf`·`ratio`·`isWorst` | 시세 + 기초자산 | **억제** (산출 불가) | 산출 |
| `kiStatus` | 위 + KI 배리어 | **억제** | 산출 |
| `conditionResult`·`willMeet` | 위 + 적용 차수 | **억제** | 차수가 없어 `null` |
| `nextEvaluation` | 평가일정 | 산출 | 차수가 없어 `null` |
| `expectedGross` | 계약 조건 | 산출 | 해당 차수 없음 |
| `projection` | 계약 조건 + 적용 차수 | **산출** | 차수가 없어 `null` |
| §4.6 과세 기여 | 계약 조건 + 적용 차수 | **산출** (표식과 함께) | 차수가 없어 제외 |
| §4.1 조치 사유 | 사유별로 다르다 | §4.1의 표 | §4.1의 표 |

> `SCHEDULE_MISSING` 열의 `null`은 **억제가 아니라 자연 결과**다 — 차수가 0건이면 고를 적용 차수가 없다. 둘을 구분하지 않으면 차수가 생겼을 때 무엇이 되살아나야 하는지 알 수 없다.

**★ 이 표는 `integrityIssue` 축만 규정한다 — E-05는 별개 축이다.** 위 표의 "산출"은 **결함 축이 막지 않는다**는 뜻이지 값이 반드시 나온다는 뜻이 아니다. E-05(상환 완료)는 **독립적으로 적용되며**, 두 축이 겹치면 둘 다 걸리고 막는 쪽이 이긴다.

| 축 | 막는 것 | 기전 |
|---|---|---|
| `integrityIssue` | 위 표 | 파괴된 입력에 따른 판정 게이트 |
| **E-05 (상환 완료)** | `kiStatus` · `conditionResult` · `nextEvaluation` · `projection` · 결함 외 조치 사유 | `asActive`가 `null`을 준다(DOC-007 §9.1) + `status = 'REDEEMED'` 분기 |

> **구체 예 — `SCHEDULE_MISSING` + 상환 완료의 `kiStatus`는 위 표의 "산출"이 아니라 `null`이다.** 표만 읽고 구현하면 어긋난다.
>
> `worstOf`·`ratio`·`isWorst`는 **두 축 어디에도 막히지 않는다** — 위 표의 `SCHEDULE_MISSING` 열이 그렇게 정하고, E-05는 이 세 값을 규정한 적이 없다(상환 완료 상품도 `worstOf`를 표시한다). 이것은 v0.8이 바꾸는 사항이 아니라 현행 동작의 확인이다.

### 4.3 상품 상세 — SCR-202

```ts
function getProduct(id: string): Promise<ProductDetailView | null>

type ProductDetailView = {
  product: {
    id: string
    name: string
    issuer: string | null
    ownerId: string
    ownerName: string
    isOwner: boolean
    issueDate: string
    principal: string
    evaluationPeriodMonths: number
    totalRounds: number                 // 파생값 = schedules.length (DOC-002 §4.6)
    integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | null
    annualCouponRate: string
    kiBarrier: string | null
    kiObservation: 'CONTINUOUS' | 'CLOSING' | null
    kiTouchedAt: string | null
    accountType: 'GENERAL' | 'TAX_FREE'
    note: string | null
  }
  underlyings: Array<{
    assetId: string
    assetName: string
    basePrice: string
    currentPrice: string | null
    priceAsOf: string | null
    priceSource: 'AUTO' | 'MANUAL' | null
    ratio: string | null
    isWorst: boolean
  }>
  schedules: Array<{
    roundNo: number
    evaluationDate: string
    barrier: string
    lizardBarrier: string | null
    lizardCouponRate: string | null
    lizardRequiresNoKi: boolean | null
    expectedGross: string
    conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
    isPast: boolean
  }>
  projection: {
    appliedRoundNo: number
    expectedGross: string
    expectedTaxableIncome: string
    attributionYear: number
  } | null                              // 아래 두 경우에 null
  redemption: RedemptionView | null
}

type RedemptionView = {
  id: string
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo: number | null
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax: string | null
  isConfirmed: boolean
  realizedPnl: string                   // 파생값. 음수 가능
  note: string | null
}
```

**필드 정의 (v0.6에서 확정)**

| 필드 | 정의 |
|---|---|
| `product.totalRounds` | `schedules.length`. **`max(round_no)`가 아니다** — 차수 번호의 연속성(V-04)은 계약 계층에만 있어 DB는 `1, 2, 99`를 허용하므로 두 값이 갈릴 수 있다. 정본은 행 수다(DOC-002 §4.6) |
| `underlyings[].isWorst` | 최저 비율인 기초자산. **동률이면 전부 `true`**, `worstOf`를 산출할 수 없으면(어느 하나라도 시세 없음, 또는 기초자산 0건) 전부 `false`. 동률에서 하나만 고르면 그 선택이 표시 순서에 의존하는 임의값이 된다. **일정 0건(`SCHEDULE_MISSING`)은 "산출 불가"에 해당하지 않는다 (v0.8)** — 시세 입력이 온전하므로 `ratio`와 `isWorst`를 그대로 산출한다. v0.7 구현은 결함이면 `worstOf`를 통째로 죽여 `ratio`는 표시되는데 `isWorst`만 사라지는 상태를 만들었다 |
| `schedules[].expectedGross` | **판정과 무관하게 전 차수에 정의된다** — "그 차수에 조기상환된다고 가정한 세전 수령액"이며 DOC-007 §4.1의 `EARLY` 가정을 따른다. 상품의 계약 조건에서 나오는 값이므로 상환 완료 상품에서도 의미가 있다(실제 수령액은 `redemption.grossAmount`이고 둘은 다른 값이다) |
| `projection` | 다음 **두 경우**에 `null`이다. ① 상환 완료 ② **적용 차수가 없다** — 전 차수가 경과했는데 미상환이거나(DOC-007 §9.2가 이 경우 적용 차수를 결정할 수 없다고 규정한다), 평가일정이 0건(`SCHEDULE_MISSING`)인 경우다. **무결성 결함은 그 자체로 사유가 아니다 (v0.8에서 정정, U-03)** — `projection`은 계약 조건(원금·쿠폰율·평가주기·차수·계좌구분)에서만 나오고 **시세를 하나도 쓰지 않으므로** `UNDERLYING_MISSING` 상품에서도 산출한다. 바로 위 `expectedGross`가 판정과 무관하게 전 차수에 정의되는 것과 같은 이유이며, §4.6이 같은 상품의 과세 기여를 산출하는 것과도 같은 근거다. **v0.5의 주석("상환완료 시 null")은 ②를 놓쳤고, v0.6의 "② `integrityIssue ≠ null`"은 반대로 원인의 범위를 넘어 억제했다** — 같은 상품이 §4.6에서는 과세에 기여하면서 §4.3에서만 값을 잃어 두 화면이 서로 모순되게 보였다(§4.2의 입력 기준) |

### 4.4 평가일정 — SCR-301

```ts
function listSchedule(params: {
  from?: string
  to?: string
  ownerId?: string
  activeOnly?: boolean
}): Promise<ScheduleItem[]>

type ScheduleItem = {
  productId: string
  productName: string
  ownerName: string
  roundNo: number
  evaluationDate: string
  dDay: number
  barrier: string
  hasLizard: boolean
  worstOf: string | null
  conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
  integrityIssue: 'UNDERLYING_MISSING' | null
  isPast: boolean
}
```

**`integrityIssue`가 여기서는 한 값뿐인 이유.** 일정 0건인 상품은 이 목록에 **행 자체가 생기지 않으므로** `SCHEDULE_MISSING`은 도달할 수 없다. §4.2·§4.3과 같은 유니온을 주면 결코 관측되지 않는 값을 화면이 처리하게 되고, 타입이 사실과 어긋난다.

**`from`·`to`·`ownerId`·`activeOnly`는 질의 조건으로 내린다**(Q-05). 네 값 모두 저장된 열의 조건이며, 특히 평가일 범위는 이 화면을 위해 만들어진 인덱스(`redemption_schedules_evaluation_date_idx`)가 처리한다. 본 계약은 행 단위가 **차수**여서 상품 수보다 훨씬 빠르게 늘어나므로, 범위 조건을 조회 후로 미루면 Q-06의 상한에 가장 먼저 닿는다.

> **질의의 루트는 `redemption_schedules`다 (v0.7, 구현 형태 확정).** 상품을 루트로 두고 일정을 임베드하면 `from`·`to`를 **임베드 필터**로 내려야 하는데, 그러면 적용 차수 판정(`nextEvaluation`)이 **잘린 일정 집합**에서 이루어진다. 적용 차수가 범위 밖일 때 범위 안의 아무 차수가 적용 차수로 승격되어 `conditionResult`가 **엉뚱한 차수에 붙는다** — 값이 비어 있지 않고 그럴싸하므로 화면에서 드러나지 않는다.
>
> 루트를 차수로 두면 날짜 조건이 루트 열 조건이 되어 위 인덱스를 그대로 쓰고, 임베드된 부모가 **자기 일정 전체**를 다시 담으므로 판정이 온전하다. `ownerId`는 부모 열 조건(`els_products.owner_id`), `activeOnly`는 중첩 to-one 조건(`els_products.redemptions=is.null`)으로 내린다 — 셋 다 실측으로 확인했고, `activeOnly`가 3행을 1행으로 실제로 좁힌다.

### 4.5 시세 — SCR-302

```ts
function listAssetPrices(): Promise<AssetPriceView[]>

type AssetPriceView = {
  assetId: string
  name: string
  market: string | null
  currency: string
  latestPrice: string | null
  asOfDate: string | null
  source: 'AUTO' | 'MANUAL' | null
  usedByActiveProducts: number         // 참조 중인 미상환 상품 수
  isStale: boolean                     // 아래 정의
}
```

**`isStale`의 정의 (v0.6에서 확정).** `asOfDate`가 기준일보다 **5일 이상** 앞서면 `true`.

| 경우 | 값 |
|---|---|
| 시세 행이 없음 (`latestPrice = null`) | `false` — 경과 판단의 대상이 아니다. 화면은 E-01("시세 없음")로 표시하며, 그 표시가 경과 여부보다 앞선다 |
| `asOf − asOfDate < 5일` | `false` |
| `asOf − asOfDate ≥ 5일` | `true` |

> **왜 하루가 아니고 5일인가.** 수집은 일 1회이고(ADR-006) 시장은 주말·휴장일에 닫힌다. 기준을 하루로 두면 **금요일 종가가 토요일부터 경과로 표시**되어 정상값이 매주 경고가 되고 신호가 죽는다. 월요일 기준으로 금요일 종가는 3일 경과이므로 3일도 같은 이유로 부족하다. 주말 2일에 연휴 여유를 더해 5일로 둔다 — 금요일 종가가 다음 주 수요일까지 정상으로 표시된다.
>
> 이 값은 법령 상수가 아니라 **표시 임계값**이므로 `tax_constants`가 아니라 구현 모듈의 상수로 둔다. DOC-007 §3.4의 KI 주의 배수(`× 1.1`)와 같은 부류다. 영업일 기준으로 세밀화하는 것은 DOC-007 RD-03(평가일 영업일 조정)이 결정된 뒤에 함께 다룬다.

### 4.6 세금 — SCR-401

```ts
function getTaxSummary(params: {
  ownerId: string
  year: number
  override?: {                          // 시뮬레이션용. 저장하지 않음
    otherIncomeBase?: string
    otherFinancialIncome?: string
    healthInsuranceType?: HealthInsuranceType
  }
}): Promise<TaxSummaryView>

type TaxSummaryView = {
  year: number
  taxLawYear: number                    // 적용된 세율·상수의 연도. year와 다르면 근사다
  profile: {
    otherIncomeBase: string
    otherFinancialIncome: string
    healthInsuranceType: HealthInsuranceType
    isSaved: boolean                    // false = override 적용 중
  }
  income: {
    elsTaxableIncome: string
    otherFinancialIncome: string
    total: string                       // F
    isComprehensive: boolean            // F > 종합과세 기준금액
    thresholdGap: string                // 초과분 또는 여유분
  }
  tax: {
    method1: string | null              // 분리 기준 (DOC-007 §5.2). null = 비교과세 미적용
    method2: string | null              // 종합 기준. null = 비교과세 미적용
    computedTax: string                 // max(①,②) − T(A), 또는 분리과세 종결액
    localTax: string
    totalTax: string
    withheld: string
    additionalPayment: string
    effectiveRate: string
  }
  healthInsurance: {
    assessmentBase: string
    healthPremium: string
    longTermCarePremium: string
    total: string
    isEstimate: true                    // 항상 추정 (A-06)
  }
  marginalRates: Array<{
    bracketLabel: string
    incomeTaxRate: string
    realMarginalRate: string
  }>
  contributingProducts: Array<{
    productId: string
    productName: string
    taxableIncome: string
    isEstimated: boolean
    integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | null
  }>
}
```

**`contributingProducts[].integrityIssue` (v0.8 신설).** 결함 상품도 과세 기여를 낸다 — §4.2의 입력 기준대로, 예상 수령액은 계약 조건에서만 나오고 결함이 파괴한 입력(기초자산·시세)을 쓰지 않으므로 **그 금액은 유효하다.** 표식은 금액을 바꾸지 않는다.

> **표식이 없으면 두 화면이 모순으로 읽힌다.** SCR-202에서는 `integrityIssue`로 "수정 필요"가 표시되는 같은 상품이 SCR-401에는 아무 표식 없이 숫자로만 나타난다. 사용자는 그것을 데이터 오류로 읽는다.
>
> **`isEstimated`와 다른 필드로 둔다.** `isEstimated`는 "증권사 확정값이 아니라 시스템 추정"을 뜻하고 미상환 상품이면 전부 `true`다. 결함 여부는 그것과 **직교**하며, 결함 상품의 확정 상환도 존재한다(아래 표).
>
> **§4.4처럼 한 값으로 좁히지 않는다 — `SCHEDULE_MISSING`도 도달한다.** "일정 0건이면 적용 차수가 없어 기여하지 않는다"는 **추정 분기에서만** 참이다. 상환 완료 분기가 일정 검사보다 **먼저** 반환하고, I-13 FK(`redemptions(els_id, round_no)` → `redemption_schedules`)는 `MATCH SIMPLE`이라 **`round_no IS NULL`인 만기 상환은 검사하지 않는다**(DOC-002 §4.9가 의도한 상태이며 마이그레이션 주석이 명시한다). 즉 만기 상환 상품은 일정 행이 전부 지워져도 `ON DELETE RESTRICT`에 걸리지 않고, 증권사 확정값으로 기여하면서 `SCHEDULE_MISSING`이다.
>
> §4.4의 좁힘은 **구조적 도달 불가**(행 단위가 차수라 일정 0건 상품은 행 자체가 생기지 않는다)에서 나왔고, §4.6은 행 단위가 상품이라 그 논거가 옮겨가지 않는다. 좁히면 §4.4가 피하려던 오류의 **정반대 방향** — 관측되는 값을 타입이 부정하는 상태 — 가 된다.

| | `UNDERLYING_MISSING` | `SCHEDULE_MISSING` |
|---|---|---|
| `isEstimated = true` (추정) | 도달 | **불가** — 적용 차수가 없다 |
| `isEstimated = false` (확정) | 도달 | **도달** — 만기 상환 + 일정 0건 |

**본 계약은 본인 전용이다.** `ownerId ≠ 조회자`이면 예외를 던진다(§3.1의 시스템 오류, 즉 호출부의 프로그래밍 오류다).

> **RLS가 이 범위를 이미 정했다.** `tax_profiles`의 조회 정책은 본인 한정이며(DOC-010 §7), 이는 금융소득 외 종합소득이 ELS와 무관한 개인 소득 정보라는 판단에서 나왔다. 그런데 `F`의 산출에는 `other_financial_income`이 필요하므로, 타인의 `ownerId`로 호출하면 그 값을 **`0`으로 읽고 계산을 끝낸다** — 오류 없이, 실제보다 낮은 금융소득과 틀린 종합과세 판정을 반환한다. 조용히 틀리는 것을 막으려면 범위를 계약에 명시하는 수밖에 없다. `ownerId`를 인자로 남기는 것은 호출부의 의도를 드러내 이 단언이 걸리게 하기 위함이다.

**세율 연도의 취급.** 세율·상수는 연도별 데이터이며(ADR-005) 시드된 연도만 존재한다.

| 대상 연도 | 동작 |
|---|---|
| 시드가 있는 연도 | 그 연도의 값을 쓴다. `taxLawYear = year` |
| 시드보다 미래 | **최신 시드 연도로 근사**하고 `taxLawYear`에 그 연도를 담는다. 화면은 근사임을 표시한다 |
| 시드보다 과거 | **예외.** 뒤 연도의 법으로 과거를 계산하면 ADR-005가 보장하려는 재현성(K-08의 전제)이 깨진다. 없는 값을 근사하는 것보다 없다고 말하는 것이 맞다 |

> **이 규칙이 없으면 홈 화면이 날짜만으로 죽는다.** §4.1 `currentYearTax`도 당해 연도의 구간·상수를 요구하므로, 2027년 1월 1일이 되면 코드 변경 없이 SCR-101이 예외로 멈춘다. 연도 선택기가 있는 SCR-401에서는 과거 연도 선택이 같은 경로를 탄다.

**`marginalRates[].bracketLabel`의 합성 규칙.** `tax_brackets`에는 하한만 있고 표시 문자열의 원천이 없으므로 계약 계층이 합성한다 — 해당 구간의 하한과 **다음 구간의 하한**으로 `"1,400만~5,000만"` 형태를, 최상단 구간은 `"10억 초과"` 형태를 만든다. 만 단위 한글 표기를 쓰고, 1억 이상은 억 단위로 적는다(`"1억 5,000만"`, `"3억"`, `"10억"`).

> **최하단 구간(하한 0)은 `"1,400만 이하"` 형태다 (v0.7에서 추가).** v0.6은 중간 구간과 최상단만 정했고, 하한이 0인 첫 구간에 규칙을 적용하면 `"0~1,400만"`이 되어 표기가 어색하다. 구현 단계에서 발견해 문서에 먼저 등재했다 — 정의가 없는 필드를 구현이 임의로 정하지 않는다(U-01).

**`profile`의 폴백.** 해당 연도의 `tax_profiles` 행이 없으면 `otherIncomeBase = '0'`, `otherFinancialIncome = '0'`, `healthInsuranceType = 'NONE'`을 쓰고 `isSaved = false`로 표시한다. 따라서 `isSaved = false`는 **"저장된 프로필이 없거나 `override` 적용 중"**을 뜻한다(v0.5까지는 후자만 서술했다). `'NONE'`은 건강보험료를 `0`으로 만들므로, 화면은 이 상태를 계산 결과가 아니라 **미입력**으로 표시해야 한다 — DB의 `health_insurance_type`은 `NOT NULL`이고 기본값이 없어 폴백 값을 계약이 정할 수밖에 없다.

> `override`는 시뮬레이션 전용이며 `tax_profiles`에 저장되지 않는다. 저장은 `saveTaxProfile`(5.6)로 별도 수행한다. 이 분리로 "값을 조정해봤을 뿐인데 저장되는" 문제를 방지한다. **프로필 행이 없는 연도에 `override`로 조회해도 행이 생기지 않는다.**

> **`method1`·`method2`가 nullable인 이유.** `F ≤ 종합과세 기준금액`이면 분리과세로 종결되어 비교과세를 적용하지 않는다(DOC-007 §5.2). 이 구간에서 두 방식의 산식을 그대로 계산한 값을 내려보내면 화면이 무의미한 비교를 렌더링하고, 심지어 `max(①,②) − T(A)`가 실제 세액과 어긋난다(§5.2 참조). 따라서 미적용을 `null`로 표현하고 `isComprehensive = false`와 함께 해석한다.

### 4.7 다년도 전망 — SCR-402

> **미구현 (P3a). 선행 조건: DOC-007 §7.5 신설.**
>
> 아래 `totalAssets`·`remainingPrincipal`은 **어느 문서에도 정의가 없다** — DOC-007 §7(연도별 집계)에도, DOC-008 §5 SCR-402의 열 목록에도 산식이 없다. 구현 단계에서 산식을 정하면 문서가 코드를 따라가게 되어 U-01(문서 선행)의 순서가 뒤집힌다.
>
> **지금 정의할 수 없는 이유.** 두 값은 "그 연도 말에 아직 상환되지 않은 상품"의 집합에 의존하고, 그 집합은 미상환 상품의 **적용 차수**로 결정된다(DOC-007 §7.2). 적용 차수의 기본 규칙은 RD-02로 미결이며 사용자 지정 UI 여부도 함께 열려 있다. 미결 상태에서 산식을 확정하면 RD-02가 닫힐 때 두 값과 그 위에 얹힌 누적 계산을 다시 손대게 된다.
>
> 나머지 필드(`grossProceeds`·`financialIncome`·`additionalTax` 등)는 §4.6과 같은 집계·세액 경로를 쓰므로 별도 정의가 필요하지 않다. 즉 이 계약은 **정의된 부분과 정의되지 않은 부분이 섞여 있고**, 부분 구현은 화면이 빈 열을 렌더링하게 만든다. RD-02와 §7.5를 함께 닫은 뒤 P4에서 구현한다(DOC-000 §3의 P4 선행 작업에 등재).

```ts
function getForecast(params: {
  ownerId: string
  years?: number                        // 기본 6
}): Promise<ForecastRow[]>

type ForecastRow = {
  year: number
  grossProceeds: string
  financialIncome: string
  isComprehensive: boolean
  effectiveRate: string
  additionalTax: string
  healthInsurance: string
  netProceeds: string
  cumulativeNet: string
  remainingPrincipal: string
  totalAssets: string
  hasEstimates: boolean                 // 추정 포함 여부
}
```

### 4.8 사용자별 현황 — SCR-501

```ts
function listUserSummaries(): Promise<UserSummary[]>

type UserSummary = {
  userId: string
  displayName: string
  isMe: boolean
  activeCount: number
  activePrincipal: string
  currentYearFinancialIncome: string
  includesOtherFinancialIncome: boolean  // false = ELS 과세소득만. 실제보다 낮다
  isComprehensive: boolean | null        // null = 판정 불가 (타인)
}
```

> 합계 행을 제공하지 않는다. 금융소득종합과세는 개인 단위이므로 사용자 간 합산은 오해를 유발한다.

**타인 행은 ELS 과세소득만 담는다 (v0.6 정정).**

| 대상 | `currentYearFinancialIncome` | `includesOtherFinancialIncome` | `isComprehensive` |
|---|---|---|---|
| 본인 | ELS 과세소득 + `other_financial_income` | `true` | 판정값 |
| 타인 | ELS 과세소득만 | `false` | `null` |

> **RLS가 타인의 `other_financial_income`을 감춘다.** `tax_profiles`의 조회는 본인 한정이므로(DOC-010 §7) 타인의 `F`를 완전하게 산출할 방법이 없다. v0.5의 계약을 그대로 구현하면 **읽지 못한 값을 `0`으로 두고 계산이 끝나** 타인의 금융소득이 실제보다 낮게, 종합과세 여부는 틀리게 표시된다. 오류도 빈 값도 아니라 **그럴싸한 숫자**로 나타나므로 화면에서 발견되지 않는다.
>
> **축소만 하고 표식을 두지 않으면 같은 문제가 남는다.** 값을 줄이는 것으로 끝내면 화면은 그것이 완전한 금융소득인 줄 알고 렌더링한다. `includesOtherFinancialIncome`으로 불완전함을 타입에 드러내고, 판정 불가를 `null`로 표현한다 — §4.6의 `method1`·`method2`가 미적용을 `null`로 표현한 것과 같은 방식이다.
>
> **`security definer` 함수로 파생 boolean만 반환하는 대안은 채택하지 않았다.** 그 방식이 `other_financial_income` 자체를 노출하지 않으므로 누출은 더 적지만, PostgREST에 RPC 노출면과 `search_path` 관리가 새로 생긴다. 그리고 SCR-501의 존치 자체가 미결이므로(DOC-008 SQ-01, "P4 이후") 버려질 수 있는 인프라다. SQ-01이 존치로 닫히고 타인의 종합과세 여부가 실제로 필요하다고 판단되면 그때 도입한다.
>
> 이 정정은 `tests/rls/tax-profiles.test.ts`가 P3에 남긴 메모("조회 제한은 오류가 아니라 빈 결과다 — 0행이 '없음'이 아니라 '볼 수 없음'일 수 있다")를 조회 계약 쪽에서 해소한 것이다.

**결함 상품의 기여를 포함하며, 여기에는 표식을 두지 않는다 (v0.8에서 판단 기록).** `currentYearFinancialIncome`은 §4.6 `income.total`과 같은 산출 경로를 쓰므로 결함 상품의 기여를 포함하고, 두 계약의 값이 일치한다.

> **§4.6과 달리 표식을 두지 않는 이유.** `includesOtherFinancialIncome`은 *읽지 못한 값이 빠져 있다*는 뜻인데, 결함 상품의 기여에는 **빠진 값이 없다** — 금액은 완전하고 정확하다(§4.2의 입력 기준). 그리고 §4.8은 상품 단위 분해가 없는 롤업이라 표식을 걸 자리가 행 전체뿐이고, 그러면 "이 사용자의 금융소득이 불완전하다"는 **틀린 뜻**이 된다. 결함은 SCR-101의 `attentionItems`와 SCR-201에서 드러난다.
>
> 표식을 추가하게 되더라도 **반드시 별도 필드**여야 하며 `includesOtherFinancialIncome`에 접으면 안 된다 — 두 값은 다른 것을 말한다. 다음 대조 검증이 이 항목을 다시 다투지 않도록 판단을 남긴다.

### 4.9 자산 검색 — SCR-204

```ts
function searchAssets(query: string): Promise<AssetOption[]>

type AssetOption = {
  id: string
  name: string
  market: string | null
  currency: string
  hasPriceProvider: boolean            // 자동 조회 가능 여부
}
```

**입력값을 필터 문법으로부터 격리한다.** `query`는 이름 부분일치 검색에 쓰이며 그대로 필터에 실린다. 구분자(`,`)와 와일드카드(`%`·`_`·`*`)를 이스케이프하고 결과 건수에 상한을 둔다 — 이스케이프하지 않으면 사용자가 입력한 쉼표가 필터를 쪼개고, `%` 한 글자가 전체 목록을 반환한다.

---

## 5. 변경 계약 (서버 액션)

### 5.0 공통 변경 컨텍스트 (v0.9 신설)

본 절의 서명도 §4와 같이 **컨텍스트가 결속된 형태**다. 컨텍스트를 받는 팩토리가 계약 함수를 생성하며 서명 자체에는 나타나지 않는다.

```ts
type MutationContext = {
  db: UserSessionClient     // 로그인 사용자 세션. service_role을 쓰지 않는다
  asOf: string              // 기준일 (YYYY-MM-DD, Asia/Seoul)
  viewerId: string          // 변경자. owner_id 설정·소유자 판정의 기준
}
```

| ID | 규약 | 근거 |
|---|---|---|
| W-01 | 변경도 **사용자 세션으로만** 수행한다. `service_role`을 쓰지 않는다 | Q-01과 같다. 쓰기에서는 더 무겁다 — 조회의 우회는 남의 데이터를 보는 것이고 쓰기의 우회는 **남의 데이터를 바꾸는 것**이다 |
| W-02 | 기준일은 조회와 **같은 값**을 쓴다 | V-17(미래 일자 시세 거부)이 기준일을 요구한다. 변경 계약이 자기 시각을 따로 구하면 KST 00:00~09:00에 어제 날짜 시세가 "미래"로 거부되거나 그 반대가 된다(Q-02의 9시간 창) |
| W-03 | 미인증은 예외가 아니라 `UNAUTHENTICATED` **결과 객체**다 | §3.1 각주. 입력값 보존이 화면 요구사항이다(DOC-008 §6) |
| W-04 | 금액·비율은 **문자열로 보낸다.** 쓰기 함수의 `jsonb` payload도 `->>`로 꺼내 `::numeric`으로 캐스팅하며 `->`로 JSON 수치를 쓰지 않는다 | Q-08의 쓰기 방향이다. 숫자로 실으면 JS 쪽에서 이미 float64를 경유했으므로 DB가 받는 값이 무엇이든 늦다. **생성 타입이 이 규약과 어긋난다** — `Insert`·`Update`는 금액·비율 열을 `number`로 요구하므로 타입을 그대로 따르는 코드가 곧 위반이다(실측, AQ-30). 열 사양에서 파생한 `InsertPayload<T>`로 그 열들을 `string`으로 바꿔 **캐스팅을 한 곳에 모은다** — `defineColumns`가 읽기 방향에서 한 일의 대응물이다 |
| W-05 | 소유권은 RLS가 강제하고(§3.3) 계약은 **사전 조회로 `FORBIDDEN`·`NOT_FOUND`를 구분**한다. 그리고 **변경의 영향 행 수를 확인한다** | RLS의 `USING`은 UPDATE·DELETE에서 **오류 없이 0행**으로 거부한다(`tests/rls/helpers/expect.ts`의 형태 표). 그 0행을 성공으로 넘기면 사용자는 "저장됐다"는 화면을 보고 데이터는 그대로다 — 조용히 틀리는 것 중 가장 나쁜 부류다 |

> **W-05를 사전 조회 하나로 대신할 수 없다.** 사전 조회와 변경 사이에 다른 요청이 상태를 바꿀 수 있고(상환 등록·삭제), 그 창에서 RLS가 0행으로 막으면 사전 조회는 이미 통과한 상태다. 두 겹이 필요하다 — 사전 조회는 **오류를 구분**하기 위한 것이고(§3.3의 UX 목적), 영향 행 수 확인은 **성공을 주장하지 않기** 위한 것이다.

#### 5.0.1 왕복 수 — 실측 (P3b 9단계)

`tests/integration/mutations.test.ts`가 계약별로 **테이블 다중집합**을 센다. 총합만 세면 "상품 2회"와 "상품 1회 + 시세 1회"가 구분되지 않으므로 §4.0의 예산 계수와 같은 규약을 쓴다.

| 계약 | 왕복 | 구성 |
|---|---|---|
| §5.1 `createProduct` | **1** | `rpc:create_els_product` ×1 |
| §5.2 `updateProduct` | **2** | `els_products` ×1 (사전 조회) + `rpc:update_els_product` ×1 |
| §5.3 `deleteProduct` | **2** | `els_products` ×2 (사전 조회 + 삭제) |
| §5.4 `createRedemption` | **2** / 3 | `els_products` ×1 + `redemptions` ×1. 원천징수액 미입력이면 `tax_years` ×1이 붙는다 |
| §5.5 `updateRedemption` | **3** / 4 | `redemptions` ×2 (참조 + 갱신) + `els_products` ×1 (+ `tax_years` ×1) |
| §5.5 `deleteRedemption` | **3** | `redemptions` ×2 (참조 + 삭제) + `els_products` ×1 |
| §5.6 `saveTaxProfile` | **1** | `tax_profiles` ×1 |
| §5.7 `saveManualPrice` | **1** | `asset_prices` ×1 |
| §5.8 `refreshPrices` | **0** | 공급자 0개이므로 DB에 닿지 않는다 |
| §5.9 `setKiTouched` | **2** | `els_products` ×2 (사전 조회 + 갱신) |
| §5.10 `createAsset` | **1** | `assets` ×1 |

세 가지가 이 표에서 읽힌다.

① **사전 조회가 필요한 계약만 2 이상이다.** `createProduct`·`saveTaxProfile`·`saveManualPrice`·`createAsset`은 소유자를 판정할 대상이 없거나(생성) 소유자 개념이 없으므로(공용 데이터) 1이다. W-05의 비용이 어디에 붙는지가 그대로 보인다.

② **§5.5의 두 계약만 3이다.** 상품이 아니라 **상환 `id`를 받기 때문**이며, 그 하나가 부모를 얻는 왕복을 강제한다. 상품까지 임베드해 2로 줄일 수 있으나 그러려면 `PRODUCT_SELECT`를 이 방향으로 한 번 더 적어야 하고, 그 순간 열 사양의 출처가 둘이 되어 `select.ts`가 막아 둔 것(캐스팅과 선언이 같은 상수에서 나온다)이 사본에서 풀린다. **왕복 하나가 그 대가보다 싸다.**

③ **원천징수 산출이 왕복을 하나 늘린다.** 사용자가 실제 징수액을 적어 넣으면(A-04의 정본) 그 왕복이 사라진다 — 산출은 미입력 시에만 일어나므로 정상 경로가 더 싸다.

**검증에서 거부되는 입력은 왕복이 0이다.** V-02(기초자산 0건)를 실측했다. 계약 계층 검증의 값이 "필드별 오류 표시"만이 아니라는 뜻이다 — 잘못된 입력이 DB에 닿지 않는다.

### 5.1 상품 생성 — SCR-204

```ts
function createProduct(input: ProductInput): Promise<ActionResult<{ id: string }>>

type ProductInput = {
  name: string
  issuer?: string
  issueDate: string
  principal: string
  evaluationPeriodMonths: number
  totalRounds: number
  annualCouponRate: string
  kiBarrier?: string
  kiObservation?: 'CONTINUOUS' | 'CLOSING'
  accountType: 'GENERAL' | 'TAX_FREE'
  note?: string
  underlyings: Array<{
    assetId: string
    basePrice: string
    sequence: number
  }>
  schedules: Array<{
    roundNo: number
    evaluationDate: string
    barrier: string
    lizardBarrier?: string
    lizardCouponRate?: string
    lizardRequiresNoKi?: boolean
  }>
}
```

**동작**

- `owner_id`는 **인증 사용자로 서버에서 설정**한다. 입력값으로 받지 않는다
- 상품·기초자산·평가일정을 단일 트랜잭션으로 생성한다 — **쓰기 함수 `create_els_product(payload jsonb)`를 경유한다**(v0.9). 아래 참조
- 배리어 일괄 입력(`90-85-80-…`)의 파싱은 클라이언트에서 수행하며, 계약은 배열만 받는다

**권한:** 인증 사용자 누구나 (본인 소유로 생성)

> **"단일 트랜잭션"의 수단을 확정한다 (v0.9, U-03).** v0.8까지 이 줄은 수단을 정하지 않았고, 그 상태로 구현하면 **요청 3개 = 트랜잭션 3개**가 된다. PostgREST는 요청당 하나의 트랜잭션을 열고 닫으며 임베드된 관계에 쓰기를 지원하지 않으므로, `els_products` → `els_underlyings` → `redemption_schedules`가 각각 독립적으로 확정된다.
>
> 그 결과가 이 명세의 다른 문장을 깨뜨린다. 두 번째 요청이 실패하면(예: 같은 자산 중복으로 `23505`) **기초자산 0건인 상품이 남고**, 그것은 §5.3이 "계약을 경유하는 어떤 조작도 만들 수 없다"고 단언한 바로 그 상태다. 보상 삭제로 대부분 되돌릴 수 있으나 보상 자체가 실행되지 못하는 경우(타임아웃·프로세스 종료)가 남고, `updateProduct`는 **하위 행을 지운 뒤 죽으면 되돌릴 원본이 없다.**
>
> **함수를 쓰는 이유는 원자성 하나가 아니다.** ① `owner_id`를 함수가 `auth.uid()`로 박으므로 "입력값으로 받지 않는다"가 규율이 아니라 구조가 된다. ② 함수 말미에서 하위 행 수를 검사하면 **I-07이 DB 층 방어를 처음 갖는다** — DOC-002 §8이 I-07을 애플리케이션 검증으로 분류하고 DOC-010 AQ-14가 "예방이 한 층뿐"으로 남긴 항목이 여기서 두 층이 된다.
>
> **함수는 새로운 fail-open 축이다.** `EXECUTE`는 기본으로 `PUBLIC`에 부여되므로 회수 후 `authenticated`에만 명시 부여한다 — 뷰의 `security_invoker`(AQ-20)·신규 테이블의 TRUNCATE(§7.1)와 같은 부류이며, 카탈로그 테스트가 함수 축을 열거하지 않으면 어떤 단언도 이를 잡지 못한다. `SECURITY INVOKER`(기본값)를 유지하므로 함수 안의 INSERT에도 RLS가 그대로 적용된다 — `SECURITY DEFINER`로 쓰면 정책 32개를 우회하는 쓰기 경로가 생긴다. DOC-010 §7·AQ-28.

### 5.2 상품 수정 — SCR-204

```ts
function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<{ id: string }>>
```

**권한:** 소유자
**동작:** 쓰기 함수 `update_els_product(p_id uuid, payload jsonb)`를 경유한다 — 상품 열 갱신과 하위 배열 **전체 교체**(삭제 + 삽입)가 한 트랜잭션 안에서 일어난다(v0.9. 근거는 §5.1 각주).
**제약**
- 상환 완료 상품은 수정 불가 → `CONFLICT`. 계약이 사전 조회로 판정하고, 함수도 `els_products_redeemed_immutable`로 거부한다 — 사전 조회와 변경 사이의 창을 막는 두 번째 겹이다(W-05)
- `kiBarrier`·`kiObservation`은 함께 설정하거나 함께 비운다(V-16, I-11). **낙인형을 해제하면 `kiTouchedAt`도 함께 비워야 한다**(V-18, I-15) — 셋 중 일부만 비우는 입력은 DB가 `23514`로 거부한다
- 하위 배열 교체가 V-02·V-03을 만족해야 한다. 기초자산·차수를 0건으로 줄이는 수정은 거부된다 (I-07) — v0.9부터 계약 계층과 **함수 말미 검사** 두 층이 이를 막는다

> **함수의 반환 `null`은 "영향 행 0"이다 (v0.9).** 대상이 없거나 RLS의 `USING`이 감춘 경우이며, 둘을 함수가 구분하지 않는다 — 구분할 문맥은 계약 계층의 사전 조회에 있다(W-05). 함수가 `42501`을 던지게 만들면 **없는 상품도 권한 오류**가 되어 `NOT_FOUND`를 만들 수 없다.
>
> **생성 타입은 이 `null`을 말하지 않는다.** `supabase gen types`가 `update_els_product`의 `Returns`를 `string`으로 선언하므로(실측) 계약 계층은 `string | null`로 복원해서 받는다 — `::text` 캐스팅이 널 허용을 잃는 것과 같은 부류이며(§4.0 Q-08 실측), 복원하지 않으면 "0행"이 성공으로 읽힌다.

> **전체 교체가 원자적이어야 하는 이유는 `createProduct`보다 강하다.** 생성은 실패해도 "만들어지지 않은 상품"이 남을 뿐이고 보상 삭제로 지울 수 있다. 교체는 **기존 행을 지운 상태**를 경유하므로, 그 사이에 끊기면 0건 상태가 남고 원본은 이미 없다. 되돌리려면 계약이 삭제 전 행을 들고 있다가 다시 넣어야 하는데, 그 재삽입이 또 실패할 수 있으므로 규율의 층을 늘리는 것으로는 닫히지 않는다.

### 5.3 상품 삭제 — SCR-202

```ts
function deleteProduct(id: string): Promise<ActionResult<void>>
```

**권한:** 소유자
**동작:** 기초자산·평가일정을 함께 삭제한다(FK `CASCADE`).
**제약**
- **상환 완료 상품은 삭제할 수 없다** → `CONFLICT`. `redemptions.els_id`의 FK가 `RESTRICT`이므로 DB가 거부한다(DOC-002 §8.1, I-01)
- **하위 행을 개별 삭제하는 계약은 존재하지 않는다.** 기초자산·평가일정을 줄이는 유일한 경로는 §5.2 `updateProduct`의 전체 교체이며 그 입력은 V-02·V-03이 검증한다. 결과적으로 계약을 경유하는 어떤 조작도 기초자산 0건·차수 0건 상태를 만들 수 없다 (I-07)

> **상환을 먼저 취소해야 하는 이유.** 상환 실적은 증권사가 확정한 외부 값이고 시스템이 유도할 수 없다(A-04). 상품 삭제가 상환까지 연쇄 삭제하면 조작 한 번으로 실현된 과세 이력이 사라지고, 해당 귀속연도의 금융소득 합계와 세액이 **아무 경고 없이** 바뀐다. `deleteRedemption`(§5.5) → `deleteProduct`의 2단계로 두면 사용자가 과세 이력을 지운다는 사실을 명시적으로 확인한다. DQ-01(소프트 삭제)을 도입하지 않기로 한 결정의 짝이다.

> **I-07은 생성 시점 규칙이 아니다.** DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓혔다. `createProduct`만 검증하면 등록 직후에 하위 행을 지워 0건에 도달할 수 있다. `deleteUnderlying` 같은 계약을 만들지 않는 것 자체가 이 방어의 형태다 — 하위 행은 항상 상품 단위로 통째로 교체된다.
>
> **v0.5의 "상품 상세(SCR-202)가 렌더링되지 않는다"는 서술을 철회한다(v0.6, U-03).** 그 문장은 렌더링 실패를 수용된 결과로 적었으나, §8 추적 매트릭스에서 **SCR-204(수정)도 `getProduct`를 쓴다**는 사실을 놓쳤다. 상세와 수정이 함께 막히면 0건 상태를 UI로 고칠 방법이 남지 않아 수동 SQL 외에는 복구 경로가 없다. 조회 계약은 §4.2의 `integrityIssue`로 이 상태를 표시하며 렌더링을 유지한다 — 방어를 포기한 것이 아니라, 결함을 **고칠 수 있는 형태로** 드러낸다.
>
> **DB 층 방어가 절반 생겼다 (v0.9).** v0.8까지는 "방어가 계약 한 층뿐"이었다. 쓰기 함수(§5.1·§5.2)가 말미에 하위 행 수를 검사하므로 **계약을 경유하는 경로에는 두 층이 생긴다.** 그러나 RLS는 여전히 소유자의 행 단위 DELETE를 허용하므로(DOC-010 AQ-14) 마이그레이션·수동 SQL·`supabase-js` 직접 호출로는 0건 상태를 만들 수 있다 — **계약 밖 경로의 예방은 아직 없고, 탐지와 복구만 있다**(§4.2 `integrityIssue`). AQ-14는 부분 해소이며 완전 해소는 행 단위 DELETE 권한을 계약 범위로 좁힐 때다.

### 5.4 상환 처리 — SCR-203

```ts
function createRedemption(
  productId: string,
  input: RedemptionInput
): Promise<ActionResult<{ id: string }>>

type RedemptionInput = {
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo?: number
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax?: string
  isConfirmed: boolean
  note?: string
}
```

**동작**

- 단일 트랜잭션으로 `redemptions` 1건 생성. 원본 삭제·이관 없음 (K-03) — 행이 하나이므로 **요청 하나로 원자적이며 쓰기 함수가 필요하지 않다**
- `withholdingTax` 미입력 시 `taxableIncome × 분리과세율`로 산출
- 상태는 레코드 존재로 유도되므로 별도 갱신 없음 (D-01)

**권한:** 소유자
**제약:** 이미 상환된 상품 → `CONFLICT` (`UNIQUE(els_id)`, I-01)

> **원천징수액 산출의 세부 (v0.9).** 세 가지가 정해져 있지 않았다.
>
> | 항목 | 확정 |
> |---|---|
> | 어느 상수인가 | `separate_taxation_rate`(15.4%)다. `separate_taxation_income_tax_rate`(14%)가 아니다 — 원천징수액은 이미 지방소득세를 포함한 실제 징수액이다(DOC-007 §2·§5.5) |
> | 어느 연도의 상수인가 | **`year(redemptionDate)`의 상수다.** 기준일의 연도가 아니다 — 상환의 귀속연도는 상환일이 결정하며(DOC-007 §7.2), 12월 상환을 1월에 입력하면 두 값이 갈린다 |
> | 어떻게 접는가 | 원 단위 절사(DOC-007 §2 "세액·보험료 최종값", RD-01의 기본값). `gross_amount`·`withholding_tax`가 `numeric(15,0)`이므로 접지 않으면 DB가 반올림한다 — **접는 규칙을 DB에 맡기면 절사가 조용히 반올림이 된다**(AQ-16과 같은 부류) |
>
> 이 값은 **사용자가 덮어쓸 수 있는 기본값**이다. 증권사가 확정한 실제 징수액이 있으면 그것이 정본이며(A-04) 계약은 입력값을 그대로 저장한다. 산출은 미입력 시에만 일어난다.

> **시드보다 과거 연도의 상환은 산출할 수 없다 (v1.1).** 산출이 `year(redemptionDate)`의 상수를 요구하는데 조회 계층은 시드보다 과거 연도를 **거부한다** — 뒤 연도의 법으로 과거를 계산하면 재현성이 깨진다(ADR-005). 그래서 2025년 상환을 `withholdingTax` 없이 등록하면 `INTERNAL`이 된다(§3.2.2 4행: 세율 시드 없음 → `INTERNAL`). **정상 경로는 막히지 않는다** — 실제 징수액이 정본이므로 값을 적어 넣으면 그대로 저장되고 세율 조회 자체가 일어나지 않는다.
>
> **`INTERNAL`이 옳은 코드인지는 정하지 않았다.** 사용자가 고칠 수 있는 일("징수액을 직접 입력한다")인데 시스템 오류로 보고하므로 §3.2의 정의와 어긋나는 면이 있다. 그렇다고 `VALIDATION_FAILED`로 내리려면 어느 필드를 가리킬지 정해야 하는데, 원인이 `withholdingTax`가 비어 있는 것인지 `redemptionDate`가 시드 범위 밖인 것인지 갈린다 — 전자면 "값을 입력하라"이고 후자면 "그 해는 지원하지 않는다"로 안내 문구가 정반대다. 그 판단은 화면이 서는 P4에서 한다. **지금은 상태를 명시하고 테스트로 고정한다**(P3b.5) — 조용히 두면 P4에서 "왜 여기가 `INTERNAL`인가"를 처음부터 다시 조사하게 된다.

> **결함 상품에도 상환을 기록할 수 있다 (v0.9).** `integrityIssue`가 있는 상품의 상환을 막지 않는다 — 상환 실적은 증권사가 확정한 외부 사실이고(A-04) 결함은 우리 쪽 데이터의 문제이므로, 사실의 기록을 우리 결함이 막으면 과세 이력이 누락된다. 단 `EARLY`·`LIZARD`는 `round_no`가 실재해야 하므로(I-13) `SCHEDULE_MISSING` 상품에서는 DB가 `23503`으로 거부하며 `CONFLICT`가 된다 — 그때 사용자가 할 일은 상환을 포기하는 것이 아니라 **일정을 먼저 복구하는 것**이고, 그 경로가 §4.2·SCR-204로 열려 있다.

### 5.5 상환 수정 · 취소 — SCR-202

```ts
function updateRedemption(id: string, input: RedemptionInput): Promise<ActionResult<void>>
function deleteRedemption(id: string): Promise<ActionResult<void>>
```

**권한:** 상품 소유자
**제약**
- `updateRedemption`이 `roundNo`를 바꾸면 **귀속연도가 이동한다.** 아래 참조
- 두 계약 모두 상품이 아니라 상환 `id`를 받는다. 소유자 판정은 부모 상품을 경유한다(정책이 `exists (select 1 from els_products …)`로 판정하는 것과 같은 경로)

> **`deleteRedemption`은 상품을 보유중 상태로 되돌린다.** 잘못 입력한 상환을 취소하는 유일한 경로이므로 반드시 제공한다. 실행 전 확인 절차를 둔다.

> **이것이 상품 삭제 2단계의 첫 단계다 (v0.9).** §5.3이 상환 완료 상품의 삭제를 `CONFLICT`로 막으므로, 상품을 지우려는 사용자는 반드시 이 계약을 먼저 통과한다. **그 순서가 우연이 아니라 설계다** — 상품 삭제가 상환까지 연쇄 삭제하면 조작 한 번으로 실현된 과세 이력이 사라지고 해당 귀속연도의 금융소득 합계와 세액이 아무 경고 없이 바뀐다(DOC-002 §8.1). 2단계로 쪼개면 사용자가 **과세 이력을 지운다는 사실을 명시적으로 확인**하게 되고, 확인 문구도 두 단계에서 서로 다른 것을 말한다 — 첫 단계는 "이 해의 금융소득이 바뀐다", 둘째 단계는 "상품이 사라진다"다. DQ-01(소프트 삭제)을 도입하지 않기로 한 결정의 짝이다.
>
> **세액 영향은 `updateRedemption`에도 있다.** `taxableIncome`·`redemptionDate`를 고치면 §4.6의 연도별 집계가 그대로 바뀌므로, 이 계약도 "값을 고치는 일"이 아니라 "확정된 과세 이력을 고치는 일"이다. 화면은 두 계약에 같은 수준의 확인을 둔다.
>
> **`roundNo` 변경은 두 가지를 동시에 움직인다.** ① I-13의 복합 FK가 새 차수의 실재를 요구하고, 그 차수의 일정 행은 그 순간부터 `RESTRICT`로 고정된다(DOC-002 §8.1). ② 미상환 상품의 귀속연도는 적용 차수의 평가일에서 나오지만 **상환 완료 상품은 상환일에서 나오므로**(DOC-007 §7.2) 이미 상환된 건의 `roundNo` 변경은 귀속연도를 바꾸지 않는다 — 바뀌는 것은 "어느 차수에서 상환되었는가"라는 사실 기록이다. 두 값을 함께 고쳐야 하는 정정(차수와 상환일이 모두 틀림)에서 한쪽만 고치면 사실 기록과 귀속연도가 어긋나며, 계약은 그것을 막지 않는다 — 한 번의 UPDATE로 함께 보내는 것이 그 방어다.

### 5.6 과세 프로필 저장 — SCR-401

```ts
function saveTaxProfile(input: {
  year: number
  otherIncomeBase: string
  otherFinancialIncome: string
  healthInsuranceType: HealthInsuranceType
}): Promise<ActionResult<void>>
```

**권한:** 본인만 (조회도 본인 한정. DOC-010 §7)
**동작:** `UNIQUE(user_id, tax_year)` 기준 UPSERT. `user_id`는 **인증 사용자로 서버에서 설정**한다 — 입력값으로 받지 않는 것이 §5.1의 `owner_id`와 같은 이유다
**제약:** `year`는 4자리 정수이며 `smallint` 범위 안이어야 한다 (V-20)

> **`tax_years`에 시드된 연도로 제한하지 않는다 (v0.9).** `tax_profiles.tax_year`에는 FK가 없고(DOC-002 §4.2) 그것이 의도다 — 조회 계층은 시드보다 미래 연도를 **최신 시드로 근사**하고 `taxLawYear`로 드러내므로(§4.6), 2027년 프로필을 2027년 세율 마이그레이션 전에 저장하는 것은 정상 경로다. 반대로 시드보다 과거 연도는 조회가 거부하지만(재현성, ADR-005) 그 거부는 조회 시점의 판단이므로 저장을 막을 근거가 되지 않는다.

### 5.7 수동 시세 입력 — SCR-302

```ts
function saveManualPrice(input: {
  assetId: string
  asOfDate: string
  price: string
}): Promise<ActionResult<void>>
```

**권한:** 인증 사용자 전체 (시세는 공용 데이터)
**동작:** `UNIQUE(asset_id, as_of_date)` 기준 UPSERT. `source = 'MANUAL'`
**제약**
- 관측 좌표(`assetId`·`asOfDate`)는 기존 행에서 변경할 수 없다 (I-16)
- `asOfDate`는 **기준일 이후일 수 없다** (V-17). 이 계약이 §5.0 W-02(기준일)를 요구하는 유일한 이유이며, 그래서 변경 컨텍스트도 조회와 같은 기준일을 갖는다 — 계약이 자기 시각을 구하면 KST 00:00~09:00에 오늘 종가 입력이 "미래"로 거부된다

> **`.upsert()`를 그대로 쓸 수 있다.** `DO UPDATE SET`이 payload 전역(`asset_id`·`as_of_date` 포함)을 실어도 동일값 재대입이므로 I-16 트리거를 통과한다. 좌표를 **바꾸는** UPDATE만 `23514`로 거부되며, 좌표가 다른 시세는 정정이 아니라 새 관측이므로 새 행으로 넣는다. 조회한 행을 그대로 되싣는 형태도 안전하다 — `created_at`은 동결 대상이 아니므로 `timestamptz`(마이크로초)와 JavaScript `Date`(밀리초)의 정밀도 차이가 문제를 만들지 않는다(DOC-002 §8 I-16 참조).

### 5.8 시세 수동 갱신 — SCR-302

```ts
function refreshPrices(): Promise<ActionResult<{
  succeeded: number
  failed: Array<{ assetId: string; assetName: string; reason: string }>
}>>
```

**동작:** 7장의 배치와 동일 로직. 부분 실패를 허용하며 실패 목록을 반환한다

> **공급자가 선정되지 않은 동안의 동작 (v0.9).** ADR-004는 어댑터 인터페이스를 확정했으나 구체 공급자는 ADR-007로 분리되어 있고 아직 미결이다(AQ-01). 등록된 공급자가 **0개인 동안 이 계약은 `PROVIDER_UNAVAILABLE`을 반환한다** — `ok: true`에 `succeeded: 0`을 담지 않는다. 둘의 차이는 화면 처리다: 전자는 ST-03(수동 입력 폴백)으로 유도하고 후자는 "갱신했으나 대상이 없었다"로 읽힌다.
>
> **스텁 어댑터로 실제 UPSERT까지 흐르게 하지 않는다.** ADR-004가 "개발 중에는 고정값을 반환하는 스텁으로 진행 가능"이라고 적었으나, 그 값이 `asset_prices`에 `source = 'AUTO'`로 들어가면 **타인 상품의 워스트오브와 조건 판정이 조용히 틀린다** — 형식은 정상이고 값만 거짓이므로 화면에 드러나지 않으며, D6이 `asOf` 상한으로 막는 종류의 결함도 아니다. 스텁은 테스트 안에서만 쓴다.

### 5.9 KI 터치 확정 — SCR-202

```ts
function setKiTouched(
  productId: string,
  touchedAt: string | null              // null = 터치 해제
): Promise<ActionResult<void>>
```

**권한:** 소유자
**제약**
- `kiBarrier`가 없는 상품(노낙인)에는 터치를 설정할 수 없다 → `VALIDATION_FAILED` + `kiTouchedAt` (V-18, I-15). 계약이 사전 조회로 판정하며 DB `CHECK`가 최종 보장이다
- `touchedAt`은 `YYYY-MM-DD` 형식이어야 한다. `null`은 해제이며 노낙인 상품에서도 허용된다 — 이미 없는 것을 없애는 요청은 거부할 이유가 없다

> **`fields` 키는 `kiTouchedAt`이다 (v1.1).** 파라미터 이름은 `touchedAt`이지만 화면이 가리키는 것은 상품의 `kiTouchedAt` 칸이고, 같은 규칙을 DB가 잡을 때(`els_products_ki_touched_check`)도 같은 키다 — **층에 따라 다른 칸을 가리키면 안 된다.** §3.1이 `fields`의 키를 "계약 입력의 필드 이름"으로 정의했는데 이 계약의 입력은 **위치 인자**라 필드 이름이 없고, 그 공백에서 계약 계층만 `touchedAt`을 쓰고 있었다(v1.0까지의 구현). §6 V-18의 대상과 §3.2.1의 사상이 처음부터 `kiTouchedAt`이었으므로 그쪽으로 맞춘다.

> 시스템은 KI 터치를 자동 확정하지 않는다(DOC-002 D-04). 수집 시세로 하회가 관측되면 화면에 후보로 표시하고, 확정은 본 계약을 통해 사용자가 수행한다.

> **미래 일자 터치를 거부하지 않는다 (v0.9).** V-17은 시세에만 걸린다. 터치 확정일은 사용자가 증권사 통지에서 옮겨 적는 외부 사실이고, 기준일보다 앞선 날짜가 들어오는 것은 입력 오류이기 이전에 **관측일과 통지일의 시차**일 수 있다. 판정 쪽에서도 `ki_touched_at`은 존재 여부만 쓰이고 날짜 비교에 들어가지 않으므로(DOC-007 §3.4), 미래 일자가 판정을 틀리게 만드는 경로가 없다 — 시세와 다른 점이다.

### 5.10 자산 등록 — SCR-204

```ts
function createAsset(input: {
  name: string
  assetType: 'STOCK' | 'INDEX' | 'ETF'
  market?: string
  currency: string
}): Promise<ActionResult<{ id: string }>>
```

**권한:** 인증 사용자 전체
**제약**
- `UNIQUE(name, market)` 위반 시 `CONFLICT`. **`market`이 `null`인 경우도 중복으로 판정된다** — 인덱스가 `nulls not distinct`이므로(DOC-002 §4.3) 시장 정보 없는 자산도 한 번만 등록된다
- `currency`는 **정확히 3자** 대문자여야 한다 (V-19). 열이 `char(3)`이므로 짧은 값은 공백으로 채워져 `'US '`로 저장되고, 그 값은 조회에서 그대로 화면에 나오지만 어떤 통화 코드와도 일치하지 않는다
- `name`·`market`은 열 선언 길이 이내여야 한다 (V-19). 초과는 `22001`이며 그 코드로는 어느 필드인지 알 수 없다

---

## 6. 검증 규칙

`VALIDATION_FAILED` 응답의 `fields`에 필드명과 사유를 담는다.

| ID | 대상 | 규칙 |
|---|---|---|
| V-01 | `principal` | 0보다 큰 정수 |
| V-02 | `underlyings` (`createProduct`·`updateProduct`) | 1개 이상 (I-07). v0.9부터 쓰기 함수가 함께 강제한다 |
| V-03 | `schedules` (`createProduct`·`updateProduct`) | 1개 이상, 그리고 길이 = 입력의 `totalRounds` (I-07). 1개 이상은 v0.9부터 쓰기 함수가 함께 강제한다 — **`totalRounds` 대조는 계약 계층에만 있다**(저장되지 않는 값이므로 DB가 볼 수 없다) |
| V-04 | `roundNo` | 1부터 연속, 중복 없음 (I-03) |
| V-05 | `lizardBarrier` | 존재 시 `barrier` 이하 (I-04) |
| V-06 | `lizardCouponRate` | `lizardBarrier` 존재 시 필수 |
| V-07 | `evaluationDate` | 차수 순으로 증가. 최초 차수 ≥ `issueDate` |
| V-08 | 비율 필드 | 상한은 전부 `x ≤ 2`. 하한은 필드별로 다르다 — `annualCouponRate`·`barrier`·`lizardBarrier`·`kiBarrier`는 `x > 0`, **`lizardCouponRate`는 `x ≥ 0`** (아래) |
| V-09 | `assetId` | 상품 내 중복 불가 (I-02) |
| V-10 | `redemptionDate` | `issueDate` 이후 |
| V-11 | `taxableIncome` | 0 이상 (I-12) |
| V-12 | `MATURITY_LOSS` | `taxableIncome = 0` 강제 (I-08, DOC-007 §4.4) |
| V-13 | `roundNo` (상환) | `EARLY`·`LIZARD`인 경우 필수 (I-14) |
| V-14 | `LIZARD` | 해당 차수가 실재하고(I-13) 그 차수에 리자드 조건이 정의되어 있어야 함 |
| V-15 | `price` · **`basePrice`** | 0보다 큼 (v0.9에서 `basePrice` 추가 — 아래) |
| V-16 | `kiObservation` | `kiBarrier` 존재 시 필수. 부재 시 입력 불가 (I-11) |
| V-17 | `asOfDate` | 미래 일자 거부. 기준일 이후의 시세는 존재할 수 없다 |
| V-18 | `kiTouchedAt` | `kiBarrier` 부재 시 입력 불가 (I-15) |
| V-19 | 문자열 필드 | 열 선언 길이 이내. `currency`는 정확히 3자 대문자 |
| V-20 | 정수 필드 | `smallint` 범위 이내(`roundNo`·`sequence`·`evaluationPeriodMonths`·`totalRounds`·`year`). `evaluationPeriodMonths ≥ 1`, `year`는 4자리 |

> **V-20에 `totalRounds`를 추가했다 (v1.1).** 구현은 처음부터 `min: 1` + `smallint` 상한으로 검사하고 있었는데 대상 목록에만 빠져 있었다. 규칙 신설이 아니라 누락 정정이다 — `totalRounds`는 저장되지 않으므로(DQ-05) DB가 볼 수 없고, 이 검사가 유일한 방어다.

> **셰이프 파싱은 필드가 속한 규칙의 ID를 재사용한다 (v1.1).** `inputs.ts`의 형태·열거·boolean 검사는 §6에 대응 규칙이 없으므로 그 필드를 다루는 규칙 ID를 빌린다 — 예컨대 `accountType`의 열거값 검사는 `V-19`로, `redemptionType`의 열거값 검사는 `V-13`으로 기록된다. **§6에 형태 규칙을 신설하지 않는 것이 의도다.** 이 표는 도메인 검증 규칙의 정본이고, 코드 사정으로 행을 늘리면 `RULE_IDS`가 §6에서 파생된다는 방향이 뒤집힌다.
>
> 그 대가를 적어 둔다. **20개 안에서의 오태그는 어떤 단언도 잡지 못한다.** `tests/db/docs-contract.test.ts`가 "§6에 없는 ID는 존재할 수 없다"를 강제하고 `RuleId` 타입이 오타를 막지만, 둘 다 *어느* ID를 골랐는지는 보지 않는다. P3b.5 감사가 20개를 전수 확인한 결과 **오태그만으로 덮이는 규칙은 현재 없다**(모든 규칙에 자기 내용을 검사하는 케이스가 하나 이상 있다). 새 필드 검사를 쓸 때 ID는 이 표에서 고르고, 마땅한 것이 없으면 그 필드가 다루는 도메인 규칙을 먼저 찾는다.

> **V-08의 의도.** 사용자가 `90`을 입력했는데 정규화되지 않고 전달되면 배리어가 9000%가 된다. 상한 검사로 이런 유입을 차단한다.

> **V-08을 필드별로 세분했다 (v0.9, U-03).** v0.8까지 이 규칙은 "비율 필드는 `0 < x ≤ 2`"였다. 그 하한이 **DOC-007 §4.1과 충돌한다** — §4.1은 "원금만 상환되는 리자드 변형은 `'0'`으로 표기하며 `null`로 표기하지 않는다"고 규정하고 `applicableCouponRate`가 `null`을 거부하는 근거로 그 문장을 쓴다. 즉 `lizardCouponRate = 0`은 명세가 요구하는 정상 입력인데 검증이 거부하게 되어 있었고, 그 결과 원금상환형 리자드는 **어느 값으로도 저장할 수 없는 상태**가 된다(`0`은 V-08이, `null`은 V-06·I-10이 거부한다).
>
> 하한을 필드마다 따로 두는 것이 옳은 이유는 0의 의미가 다르기 때문이다. 배리어 0은 "어떤 시세에서도 충족"이라는 무의미한 조건이고 연쿠폰율 0은 수익이 없는 상품이므로 둘은 입력 오류로 보는 것이 맞다. 반면 리자드 쿠폰율 0은 **실재하는 상품 구조**다.

> **V-15에 `basePrice`를 추가했다 (v0.9, U-03).** v0.8까지 V-15의 대상은 `price` 하나였고 **기준가격에는 어떤 규칙도 없었다.** 그런데 DOC-007 §3.1의 `underlyingRatio`는 기준가격이 등락률의 분모이므로 `0` 이하를 `RangeError`로 거부한다. 즉 `basePrice = 0`인 행이 저장되면 그 상품을 읽는 **모든 조회가 던지고**, 조회 계층은 그것을 상태로 바꾸지 않는다 — `integrityIssue`는 하위 행 0건만 다루므로 이 경우는 걸러지지 않고, 모든 SELECT가 `using (true)`이므로 **남의 결함 상품 1건이 목록을 전원에게 죽인다.** AQ-17의 조회 절이 막으려던 바로 그 결과이며, 그것을 막는 유일한 층이 입력 검증이다. DQ-06의 값 범위 승격 목록에도 `base_price > 0`이 없으므로 DB 층에도 없다.

> **V-19·V-20을 신설한 이유 (v0.9).** 두 규칙이 없으면 초과 입력이 DB까지 가서 `22001`(길이)·`22003`(자릿수)로 거부되는데, **그 코드는 어느 열이 원인인지 말하지 않는다.** §3.2.1이 두 코드를 `VALIDATION_FAILED`로 매핑하면서도 "필드를 특정할 수 없는 경우가 있다"고 적은 자리가 여기다 — 필드별 오류 표시가 §3.2의 `VALIDATION_FAILED` 정의인데 그것을 채울 수 없는 응답이 나온다. `currency`는 특히 조용하다: `char(3)`이 짧은 값을 **공백으로 채워** 저장하므로 오류조차 나지 않는다.

> **V-03은 저장된 값과 대조하지 않는다 (v0.6).** DOC-002 v0.5가 `total_rounds` 컬럼을 삭제했으므로(DQ-05) `totalRounds`는 입력 안에만 존재하고, V-03은 **같은 입력의 두 필드를 서로 대조**한다. 자기 검증처럼 보이지만 의미가 있다 — 총 차수는 사용자가 직접 입력하고 배리어 스케줄(`90-85-80-…`)은 일괄 파싱되므로, 파싱 결과의 길이가 입력한 차수와 다르면 그것은 파서나 입력의 오류다. 저장 후에는 일정 행 수가 곧 총 차수이므로 대조할 대상이 없다.

> **V-17을 DB 제약으로 두지 않는 이유.** `CHECK (as_of_date <= current_date)`는 만들 수 없다 — `current_date`는 IMMUTABLE이 아니므로 CHECK 표현식에 쓸 수 없고, 넣더라도 오늘 유효했던 행이 내일 제약을 위반하는 상태가 된다. 계약 계층 검증으로 둔다. 미래 일자 시세는 워스트오브를 실제와 다르게 만들어 존재하지 않는 조기상환을 표시하게 하므로, 입력 시점에 막는 것이 유일한 방어다.

---

## 7. Route Handler

### 7.1 시세 배치 수집

```
POST /api/cron/prices
```

| 항목 | 내용 |
|---|---|
| 호출자 | Vercel Cron (일 1회) |
| 인증 | `Authorization: Bearer <CRON_SECRET>` (SEC-04) |
| 대상 | **미상환 상품이 참조하는 기초자산만** |

**응답**

```ts
type CronResult = {
  executedAt: string
  targetCount: number
  succeeded: number
  failed: Array<{ assetId: string; reason: string }>
  skipped: number                       // 당일 데이터 이미 존재
}
```

**동작 규칙**

| ID | 규칙 |
|---|---|
| CR-01 | 토큰 불일치 시 401 반환. 처리하지 않음 |
| CR-02 | 부분 실패가 전체 배치를 중단시키지 않음 |
| CR-03 | `UNIQUE(asset_id, as_of_date)` 기준 UPSERT. 중복 실행 안전 |
| CR-04 | 결과를 로깅한다. 무음 실패를 만들지 않음 |
| CR-05 | 기존 `MANUAL` 값은 자동 수집 값으로 덮어쓴다 (자동값 우선) |

> **CR-05는 검토가 필요하다.** 수동 입력이 자동값보다 정확한 경우(공급자 오류 대응)를 고려하면 반대 정책도 가능하다. AQ-06으로 남긴다.

---

## 8. 화면 – 계약 추적 매트릭스

| 화면 | 조회 계약 | 변경 계약 |
|---|---|---|
| SCR-001 로그인 | — | `signIn` (§5 밖 — `src/lib/auth/session.ts`) |
| SCR-101 홈 | `getDashboard` | — |
| SCR-201 목록 | `listProducts` | — |
| SCR-202 상세 | `getProduct` | `deleteProduct`, `deleteRedemption`, `updateRedemption`, `setKiTouched` |
| SCR-203 상환 | `getProduct` | `createRedemption` |
| SCR-204 등록·수정 | `getProduct`, `searchAssets` | `createProduct`, `updateProduct`, `createAsset` |
| SCR-301 일정 | `listSchedule` | — |
| SCR-302 시세 | `listAssetPrices` | `saveManualPrice`, `refreshPrices` (**공급자 미선정 — §5.8**), **`createAsset`** |
| SCR-401 세금 | `getTaxSummary` | `saveTaxProfile` |
| SCR-402 전망 | `getForecast` (**미구현 — §4.7**) | — |
| SCR-501 사용자 | `listUserSummaries` | — (**화면을 만들지 않는다 — DOC-008 SQ-01 해결.** 계약은 남는다) |
| SCR-502 설정 | — | `signOut` (§5 밖). **표시명 변경은 v1 보류** — DB는 허용하나 §5에 계약이 없다 |

> **무효화 — 실측이 형태를 정했다 (v1.3, P4 컷 1b).** 이 매트릭스의 코드 측 짝이 `src/lib/routes/invalidation.ts`이며, 거기에 두는 것은 **판정 기준**이다: `affects`(어느 변경이 어느 조회 계약의 값을 바꾸는가)와 `ROUTE_QUERIES`(어느 **라우트**가 무엇을 읽는가). 후자가 화면 단위가 아니라 라우트 단위인 이유는 SCR-204가 라우트 둘이고 입력이 다르기 때문이다 — `/products/new`는 `searchAssets`만, `/products/[id]/edit`은 `getProduct`도 읽는다. 화면 단위로 두면 「시세를 저장했으니 등록 화면도 낡았다」는 잘못된 합성이 나온다.
>
> **경로 목록은 손으로 적지 않는다.** 네 경우를 실측한 결과 **세 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이 전부 같았다** — 서버에 지울 것이 없다(모든 데이터 화면이 동적이고 Supabase 요청은 `cache: 'no-store'`다). 대조군이 초록인 것이 실험 실패가 아님은 `revalidatePath` 호출 로그로 확인했다(②는 일곱 경로, ③은 `/tax` 하나). 그래서 효과는 `revalidatePath('/', 'layout')` 한 줄이고, 낡는 라우트는 위 두 데이터의 곱(`staleRoutesFor()`)으로 도출한다. 전체 근거는 DOC-010 §9 AQ-02.
>
> 판정 기준의 특이한 두 자리를 기록한다. ① **시세는 세금·전망을 낡게 하지 않는다** — §4.6의 추정 기여는 `grossExpected(원금·연쿠폰율·평가주기·차수)`뿐이고 시세도 `conditionResult`도 쓰지 않는다(§4.3의 `EARLY` 가정). ② **상환은 시세 화면을 낡게 한다** — §4.5 `usedByActiveProducts`가 "참조 중인 **미상환** 상품 수"이므로 상환 등록·취소가 그 값을 바꾼다. 둘 다 직관과 반대이므로 `tests/app/invalidation.test.ts`에 케이스로 박았다.

> **`createAsset`을 SCR-302에도 배정했다 (v1.2).** v1.1까지 이 계약은 SCR-204에만 있었는데, **그러면 SCR-302의 빈 상태가 순환한다** — DOC-008 §6이 정한 빈 상태는 "등록된 기초자산 없음"이고 ST-02는 빈 상태가 **다음 행동을 제시할 것**을 요구하는데, 자산을 만들 유일한 경로가 SCR-204(상품 등록)이므로 안내가 "자산을 등록하려면 상품을 등록하세요"가 된다. 그리고 상품 등록은 기초자산 선택을 요구한다. 계약은 화면에 묶여 있지 않으므로 배정만 넓히면 되고 구현은 0줄이다.

> **SCR-001·SCR-502의 행을 신설했다 (v1.2).** 종전 매트릭스는 SCR-101부터 시작해 **로그인 화면이 아예 없었다.** `signIn`·`signOut`은 §5의 열한 계약에 속하지 않는다 — Supabase Auth의 세션 조작이지 도메인 변경이 아니고, `src/app/actions.ts`가 "§5의 11개를 1:1로 노출한다"를 불변식으로 삼고 있어 열두 번째 export가 그것을 희석한다. `src/lib/auth/session.ts`에 두고 화면별 어댑터(`src/app/(auth)/login/actions.ts`)에서 부른다. 반환 타입은 `ActionResult`를 재사용한다 — §3.2가 프로젝트의 단일 오류 어휘이고 로그인 폼도 입력값 보존과 필드별 오류가 필요하다.

---

## 9. 미결정 사항

| ID | 항목 | 상태 | 비고 |
|---|---|---|---|
| AQ-06 | 자동 수집이 수동 입력값을 덮어쓸지 | 미결 | CR-05 참조 |
| AQ-07 | 상품 삭제 시 소프트 삭제 여부 | **해결 (P2)** | 하드 삭제. 단 상환 완료 상품은 삭제 불가(§5.3). DOC-002 DQ-01과 동일 |
| AQ-08 | 전망 기본 연수 | 미결 | 현재 6년 가정 |
| AQ-09 | 목록 페이지네이션 | 미결 | A-01(사용자 10명 이하) 기준 불필요 판단. 상품 수 증가 시 재검토. **§4.0 Q-06이 판단 시점을 만든다** — 결과가 서버 상한에 걸리면 잘린 목록을 반환하지 않고 예외를 던지므로, 이 항목을 닫아야 할 시점이 조용히 지나가지 않는다. 행 단위가 차수인 §4.4가 가장 먼저 닿는다. **P3a.5 보완** — 그 판단 시점이 **모든 경로에 있지는 않다.** Q-06을 적용하지 않은 로더가 존재하므로(AQ-22) 그 경로로 상한에 닿으면 이 항목은 여전히 조용히 지나간다 |
| AQ-10 | 계약 계층 입력 검증 라이브러리 | **해결 (P3b)** | **도구를 도입하지 않는다.** 손으로 쓴 조합기를 쓰고 V-규칙 ID를 함수 이름으로 삼는다. 근거는 세 가지다. ① **강제 변환 벡터.** Q-08의 방어는 `Number()`·`parseFloat`·단항 `+`를 차단하는 **구문 수준 린트**인데, 스키마 라이브러리의 `coerce`는 라이브러리 호출이라 그 린트가 보지 못한다 — 금액·비율이 float64를 경유하는 경로가 규칙 밖에 하나 생긴다. ② **타입 정본의 이원화.** §5의 입력 타입이 정본인데 스키마에서 타입을 추론하면 정본이 둘이 되고, 문서와 어긋나도 컴파일은 통과한다. ③ **검증 대상이 대부분 교차 필드다.** V-03·V-04·V-05·V-07·V-09·V-12~V-14는 어느 라이브러리에서도 커스텀 코드로 쓰게 되므로, 도구가 줄여 주는 것은 원시 타입 검사뿐이다. 대신 **규칙 ID 전수 열거 단언**을 둔다 — V-01~V-20에 케이스가 하나라도 없으면 테스트가 실패한다 |
| AQ-17 | 순수 모듈의 예외를 변경 계약에서 어떻게 변환할지 | **해결 (P3b)** | **§3.2.2로 종결.** 예외 클래스가 아니라 **호출 지점**이 코드를 부여한다 — 순수 모듈의 거부는 전부 `RangeError`이므로 클래스로는 입력 오류와 상태 결함을 구분할 수 없다. **`CONFLICT`는 순수 모듈 예외에서 나오지 않는다**(순수 모듈은 "이미 상환됨"을 알 수 있는 위치에 없다). 기본값은 `INTERNAL`이며, 예상 밖의 `RangeError`는 §6에 구멍이 있다는 신호로 취급한다. 조회 부분의 결정·철회 기록은 아래에 남긴다 |
| AQ-18 | `listUserSummaries`의 타인 종합과세 여부를 `security definer`로 제공할지 | 미결 | §4.8이 타인 행의 `isComprehensive`를 `null`로 두었다. DOC-008 SQ-01(SCR-501 존치)이 닫히고 그 값이 실제로 필요하다고 판단되면 파생 boolean만 반환하는 함수를 도입한다. **P4 이후** |
| AQ-22 | Q-06 절단 방어의 적용 범위와 검증 | 미결 | **규약은 조회 전체를 말하는데 구현은 로더 5개에만 있다.** `loadTaxYearContext`는 상한도 감지도 없으며 `getTaxSummary`·`listUserSummaries`·`getDashboard` 세 계약이 그 경로를 탄다. 루트가 `tax_years`라 현재 규모에서는 도달 불가하지만, "도달했다면 AQ-09를 닫으라는 신호"라는 Q-06의 목적이 그 경로에서는 작동하지 않는다. `searchAssets`는 §4.9가 상한을 명시했으므로 위반은 아니나 **호출부에 절단 신호가 없다** — 두 규약이 충돌하는 지점이며 조정된 적이 없다. 검증도 반쪽이다: `assertNotTruncated`는 가짜 배열로만 단위 시험되고 PostgREST에 1000행을 실제로 태우는 테스트가 없어, `SERVER_MAX_ROWS`가 서버 설정과 어긋나도 드러나지 않는다 |
| AQ-24 | 계약 파라미터와 반환 유니온의 비대칭 | 미결 | §4.2 `listProducts`의 `kiStatus` 파라미터는 3값(`SAFE`·`WARNING`·`TOUCHED`)인데 반환 `kiStatus`는 5값이다. **`BELOW`·`NO_KI` 상품은 어떤 필터로도 뽑을 수 없다.** `BELOW`가 "사용자 확인이 필요한 유일한 상태"(§4.1)인데 목록에서 그것만 골라볼 수 없다는 점이 문제다. 파라미터를 넓힐지, 조치 목록(§4.1)이 그 역할을 전담할지 P4 화면에서 결정한다 |
| AQ-25 | `projection`의 4번째 `null` 분기 | 미결 | 구현은 §4.3이 정한 두 경우 외에 `attributionYear`가 `null`일 때도 `null`을 반환한다(방어적 분기). 그 함수가 언제 `null`을 주는지 계약에 서술이 없어 **도달 조건이 불명**이고, 따라서 죽은 코드인지 실재하는 경우인지 판별되지 않는다. DOC-007 §7.2의 귀속연도 산출을 정리할 때 함께 닫는다 |
| AQ-26 | 필터 문법 격리의 검증 범위 | **해결 (P3b 4단계)** | 이스케이프 대상 10문자 전부에 케이스를 두고, 특히 **`\`의 순서 의존성**(먼저 처리하지 않으면 자기가 넣은 백슬래시를 다시 이스케이프한다)을 단언한다. 검증 계층의 테스트와 같은 파일에 둔다 — 둘 다 "사용자 입력을 문법에서 격리한다"는 같은 일이다 |
| AQ-27 | 기준일 → 귀속연도 파생 지점의 이원화 | **해결 (P3b 10단계)** | 파생 지점을 `today.ts`의 `currentYear()` 하나로 합쳤다. `tax.ts:430`의 문자열 자르기를 그 호출로 교체했다 — Q-02가 "요청당 한 번"을 구조로 만든 것과 같은 이유로 파생 규칙도 한 곳에만 있어야 한다. **교체가 형식 검사도 함께 들여왔다** — 종전 자리에는 그것이 없어 `asOf`가 깨지면 `NaN`이 조용히 세율 조회로 흘렀다 |
| AQ-30 | 생성 타입의 쓰기 방향이 Q-08·W-04와 어긋난다 | **해결 (P3b 7단계)** | **실측이 두 번 있었다.** ① P3b 2단계 — `supabase gen types`의 `Insert`·`Update`가 금액·비율 열을 `number`로 선언한다. ② **P3b 7단계 — 그것을 따르면 값이 실제로 바뀐다.** `asset_prices.price`(`numeric(18,6)`)에 같은 값을 두 형태로 실어 `::text`로 되읽었다: 문자열 `"99999999999.999999"` → **`201`** + `99999999999.999999`(정확) / JSON 수치(생성 타입이 요구하는 형태) → **`201`** + **`100000000000.000000`**. **두 요청 모두 `201`이다** — 거부도 경고도 없이 값만 달라졌고, DB에 닿기 전에 `JSON.stringify`가 float64를 직렬화하며 자릿수를 잃었다. 첫 경우가 동시에 **PostgREST가 `numeric` 열에 JSON 문자열을 그대로 받는다**는 증거이므로 어긋나는 쪽은 전송 계층이 아니라 생성 타입이다. 그리고 `numeric(15,0)` 금액은 15자리까지 float64로 정확하므로 **값 단언으로는 영원히 드러나지 않는다.** 방어는 두 겹이다 — (a) `InsertPayload<T>`가 열 사양에서 금액 열을 파생해 `string`으로 바꾸고, 읽기 쪽 `MustCastColumn`과 **같은 `CountingColumn` 하나**를 공유하므로 두 방향이 "무엇이 금액인가"에 대해 갈릴 수 없다(`tests/db/payload.test.ts`가 6개 테이블에 대해 두 집합의 동치를 타입 수준으로 단언한다). (b) 린트 `els/db-layer`가 `.insert()`·`.upsert()`·`.update()`의 첫 인자로 **객체 리터럴을 금지**해 `toInsert()`/`toUpdate()`를 지나지 않는 경로를 막는다. 단언은 그 두 함수 안의 **두 개가 전부**다. **남는 문제:** ① `db:types` 재생성이 열 타입을 바꾸면 파생 타입이 조용히 따라간다 — 드리프트 대조는 수동 스위트에만 있다(AQ-19와 같은 자리). ② 테스트 픽스처는 `pg`로 직접 넣으므로 이 타입을 지나지 않는다. ③ **구조로 걸리는 범위는 계약 11개 중 9개다 (P3b.5 보완).** `toInsert`/`toUpdate` + 린트를 지나는 것이 6개(`createRedemption`·`updateRedemption`·`setKiTouched`·`saveTaxProfile`·`saveManualPrice`·`createAsset`), 쓰기가 없는 것이 3개(`deleteProduct`·`deleteRedemption`·`refreshPrices`), **`.rpc()` jsonb를 지나는 2개(`createProduct`·`updateProduct`)는 둘 다 아니다** — 린트 셀렉터가 `/^(insert\|upsert\|update)$/`라 `.rpc()`를 보지 않고, `productPayload()`는 열 사양에서 파생되지 않은 손으로 쓴 `Json`이다. 지금 값이 옳은 것은 `ProductInput`이 금액을 `string`으로 선언하고 쓰기 함수가 `->>`+`::numeric`으로 받으며 왕복이 실측되어 있기 때문이며(`99999999999.999999`), **방어의 종류가 다르다** — `els_products`·`els_underlyings`·`redemption_schedules`에 새 금액 열이 생기면 `.insert()` 경로는 `InsertPayload<T>`가 자동으로 따라오지만 `productPayload`와 SQL 함수는 손으로 고쳐야 하고 **빠뜨려도 아무것도 실패하지 않는다.** 닫으려면 `.rpc()`의 payload도 열 사양에서 파생시켜야 하는데, 그 payload는 테이블 하나가 아니라 세 테이블의 합성이라 `InsertPayload<T>`를 그대로 쓸 수 없다 — P4에서 화면이 붙은 뒤 형태를 정한다 |
| AQ-29 | 쓰기 함수가 계약 계층 검증을 우회하는 경로 | 미결 (P3b 9단계에서 **경계를 실측**) | **함수는 I-07(하위 행 수)과 상태 충돌만 검사하고 §6의 나머지 규칙은 보지 않는다.** 계약을 경유하면 V-01~V-20이 먼저 걸리지만, 함수는 `authenticated`에게 `EXECUTE`가 열려 있으므로 `supabase-js`나 SQL로 직접 부르면 V-04(차수 연속성)·V-07(평가일 증가)·V-09(자산 중복)를 통과하지 않은 상품이 만들어진다. **DB 제약이 있는 규칙(I-02·I-03·I-04·I-10)은 그래도 막히지만 나머지는 막히지 않는다** — 예를 들어 차수 `1, 2, 99`인 상품이 함수로 만들어질 수 있고, 그것은 DQ-05가 총 차수 정본을 `max(round_no)`가 아니라 행 수로 정한 이유와 같은 상태다. 함수 안으로 검증을 옮기는 것은 규칙을 두 언어로 두 번 쓰는 일이므로 하지 않는다. 남은 선택은 (a) 그대로 두고 계약 밖 호출을 신뢰하지 않는다 (b) 함수 시그니처를 계약 계층만 알 수 있는 형태로 좁힌다 — P4에서 화면이 붙은 뒤 실제 위험을 보고 정한다. **P3b 9단계 보완 — 두 층의 경계를 실측했다.** 같은 입력(기초자산 0건 / 자산 중복)을 계약과 함수 양쪽에 넣어 무엇이 다른지 기록한다: 계약은 `VALIDATION_FAILED` + **배열 인덱스까지 붙은** `fields`(`underlyings[1].assetId`)를 내고 **왕복 0**으로 끝나며, 함수 직접 호출은 `23514`·`23505`를 낸다. 즉 우회 경로에서 잃는 것은 "막힘" 자체가 아니라 **어느 원소가 문제인지**와 **DB에 닿지 않음**이다 — DB 제약이 없는 V-04·V-07은 그마저도 없다 |
| AQ-31 | `refreshPrices` 성공 경로의 검증 공백 | 미결 (P3b.5 신설) | **공급자 0개인 동안 §5.8은 항상 `PROVIDER_UNAVAILABLE`로 끝나므로 반환 타입 `{succeeded, failed}`를 조립하는 코드가 한 줄도 실행되지 않는다.** 부분 실패 병합, 실패 목록의 `assetId`·`assetName`·`reason` 구성, `asset_prices`의 `source = 'AUTO'` UPSERT가 전부 그 뒤에 있다. 지금 이 계약을 검증하는 것은 "공급자가 0개면 `PROVIDER_UNAVAILABLE`이고 왕복이 0이다" 둘뿐이며(`tests/db/mutations.test.ts`·`tests/integration/mutations.test.ts`), 그것은 **분기 하나만 증명한다.** ADR-007(AQ-01)이 닫히는 순간 검증 없는 코드가 처음 실행된다 — AQ-01은 "어느 공급자를 고를까"이고 이 항목은 "고른 뒤 무엇이 미검증인가"라 성격이 다르므로 번호를 따로 둔다. 공급자 도입 시 (a) 스텁 어댑터로 부분 실패 경로(일부 성공·일부 실패) (b) `source = 'AUTO'` UPSERT가 I-16 트리거를 통과하는지 (c) `PROVIDER_UNAVAILABLE`↔`INTERNAL` 분기 — 셋을 **같은 커밋에서** 세운다. §5.8이 "스텁은 테스트 안에서만 쓴다"고 한 것이 그 전제다 |

**AQ-17의 조회 부분 — 결정과 철회 기록 (v0.6, U-03)**

v0.5는 "**조회 계약은 §3.1이 이미 '시스템 오류는 예외로 전파하여 에러 경계에서 처리'로 규정했으므로 문제가 없다**"고 적었다. **이 판단을 철회한다.**

철회 사유는 예외 전파가 화면에 미치는 범위다. 모든 SELECT 정책이 `using (true)`이므로(DOC-010 §7) 결함 상품은 소유자만의 문제가 아니다.

| 경로 | 예외를 전파할 때의 결과 |
|---|---|
| `listProducts`·`listSchedule`·`getDashboard` | **남의 결함 상품 1건이 SCR-101·201·301을 전원에게 죽인다.** 자기 데이터가 멀쩡한 사용자도 목록을 볼 수 없다 |
| `getProduct` | SCR-202가 죽고, §8 추적 매트릭스상 **SCR-204(수정)도 같은 계약을 쓰므로 유일한 복구 경로까지 막힌다.** 계약으로는 0건을 만들 수 없으니 계약으로 고칠 수도 없어, 수동 SQL 외에 복구 수단이 없다 |

따라서 조회 계층은 `worstOf`에 0건을 넘기지 않고 §4.2의 `integrityIssue`로 상태를 드러낸다. **순수 모듈의 거부는 그대로 둔다** — DOC-007 §3.1은 변경되지 않으며, DB를 경유해 도달한 0건에 대한 최종 안전망으로 남는다(DOC-010 AQ-14). 조회 계층은 위반을 삼키지 않고 로그로 남긴다.

> **이것은 "시끄럽게 멈추는 것이 낫다"의 포기가 아니다.** 결함은 여전히 화면에 드러나며, 시세 없음(E-01)과 구분되고, 조치 목록(§4.1 `attentionItems`)에도 오른다. 달라진 것은 **드러나는 범위**다 — 결함 있는 한 행이 시끄럽게 표시되는 것과, 관계없는 사용자의 화면 세 개가 멈추는 것은 같은 시끄러움이 아니다.

**남은 절반을 P3b에서 닫았다 (v0.9).** AQ-17이 원래 물은 것은 "**변경 계약**이 순수 모듈의 예외를 어떤 `ErrorCode`로 바꾸는가"이며(§3.1의 `ActionResult`는 예외를 던지지 않는다), `INTERNAL`인지 `CONFLICT`인지가 화면 처리를 갈라놓는다(§3.2). 답은 **§3.2.2**에 있다 — 변환의 주체를 예외가 아니라 호출 지점으로 옮기고, `CONFLICT`는 이 경로에서 나오지 않음을 확정했다.

> **두 절반의 답이 같은 모양이다.** 조회 쪽은 "예외를 어디서 멈출 것인가"를 물었고 답은 행 단위 격리였다. 변환 쪽은 "예외를 무엇으로 바꿀 것인가"를 물었고 답은 호출 지점별 부여였다. 둘 다 **예외 자체가 담지 못하는 문맥을 예외 바깥에서 공급**한다 — `RangeError`는 자기가 어느 상품의 어느 입력에서 났는지 모르고, 그 문맥을 아는 것은 항상 부르는 쪽이다.

> **같은 원리의 두 번째 적용 (P3a.5).** 위 철회의 근거는 "**멈추는 범위가 원인의 범위를 넘으면 안 된다**"였다 — 상품 1건의 결함이 목록 전체를 죽이지 않게 했다. §4.2의 입력 기준(v0.8)은 같은 원리를 **한 단계 안쪽**에 적용한 것이다: 한 **입력**의 결함이 그 입력을 쓰지 않는 파생값까지 죽이지 않게 한다. v0.6~v0.7은 첫 번째 적용은 했으나 두 번째를 하지 않아, 결함 상품이 계약마다 다르게 보이는 상태를 남겼다.

---

*본 문서는 프로젝트 진행에 따라 갱신되며, 주요 변경은 변경 이력에 기록한다.*
