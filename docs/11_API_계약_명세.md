# API · 계약 명세

**언제들어오나** — ELS 통합관리 시스템

| 항목 | 내용 |
|---|---|
| 문서 ID | DOC-011 |
| 버전 | 0.6 |
| 작성일 | 2026-07-26 |
| 작성자 | 민서 |
| 선행 문서 | DOC-002 데이터 모델 v0.4, DOC-007 계산 로직 명세 v0.4, DOC-008 화면 목록, DOC-010 아키텍처 v0.3 |
| 상태 | 검토 중 |

### 변경 이력

| 버전 | 일자 | 작성자 | 변경 내용 |
|---|---|---|---|
| 0.1 | 2026-07-26 | 민서 | 최초 작성 |
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
| Q-06 | 결과가 서버 상한에 걸려 잘리면 **예외를 던진다.** 잘린 목록을 반환하지 않는다 | 조용히 넘기면 화면은 정상으로 보이고 목록만 짧아진다. 현재 규모(A-01)에서는 도달 불가하며, **도달했다면 AQ-09(페이지네이션)를 닫아야 한다는 신호**다 |
| Q-07 | 금액은 정수 문자열, 비율은 **소수 4자리 고정 문자열**로 전달한다 | §2가 형식을 정하지 않았다. 워스트오브는 나눗셈이므로 고정소수점 연산 결과를 그대로 문자열화하면 40자리가 나올 수 있고, 화면이 그것을 렌더링한다. 4자리는 저장 정밀도(`numeric(6,4)`)와 일치한다 |
| Q-08 | 금액·비율은 DB 경계에서 **문자열로 수신**한다 | 수치형으로 받으면 JSON 파싱이 부동소수점을 경유한다(M-03, 절대 규칙 #2). 15자리 이내 금액은 부동소수점으로도 값이 맞아떨어지므로 **값 단언으로는 검출되지 않는다** — 타입 층에서 막는다 |

> **컨텍스트를 서명에 넣지 않는 이유.** 본 문서는 함수 시그니처를 계약으로 취급한다(§1.1). 컨텍스트를 인자로 노출하면 화면이 계약을 호출할 때마다 기준일·조회자를 직접 전달하게 되고, 그 순간 "요청당 한 번"(Q-02)이 규율이 된다. 결속을 팩토리로 옮기면 §4.1~§4.9의 서명이 문서 그대로 유지되면서 Q-02가 구조로 보장된다.

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
  } | null                              // 상환완료 시 null
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
  } | null                              // 아래 세 경우에 null
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
| `underlyings[].isWorst` | 최저 비율인 기초자산. **동률이면 전부 `true`**, `worstOf`를 산출할 수 없으면(어느 하나라도 시세 없음, 또는 기초자산 0건) 전부 `false`. 동률에서 하나만 고르면 그 선택이 표시 순서에 의존하는 임의값이 된다 |
| `schedules[].expectedGross` | **판정과 무관하게 전 차수에 정의된다** — "그 차수에 조기상환된다고 가정한 세전 수령액"이며 DOC-007 §4.1의 `EARLY` 가정을 따른다. 상품의 계약 조건에서 나오는 값이므로 상환 완료 상품에서도 의미가 있다(실제 수령액은 `redemption.grossAmount`이고 둘은 다른 값이다) |
| `projection` | 다음 세 경우에 `null`이다. ① 상환 완료 ② `integrityIssue ≠ null` ③ **전 차수가 경과했는데 미상환** — DOC-007 §9.2가 이 경우 적용 차수를 결정할 수 없다고 규정하므로 귀속연도와 예상 수령액이 산출되지 않는다. v0.5의 주석("상환완료 시 null")은 ③을 놓쳤다 |

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
  }>
}
```

**본 계약은 본인 전용이다.** `ownerId ≠ 조회자`이면 예외를 던진다(§3.1의 시스템 오류, 즉 호출부의 프로그래밍 오류다).

> **RLS가 이 범위를 이미 정했다.** `tax_profiles`의 조회 정책은 본인 한정이며(DOC-010 §7), 이는 금융소득 외 종합소득이 ELS와 무관한 개인 소득 정보라는 판단에서 나왔다. 그런데 `F`의 산출에는 `other_financial_income`이 필요하므로, 타인의 `ownerId`로 호출하면 그 값을 **`0`으로 읽고 계산을 끝낸다** — 오류 없이, 실제보다 낮은 금융소득과 틀린 종합과세 판정을 반환한다. 조용히 틀리는 것을 막으려면 범위를 계약에 명시하는 수밖에 없다. `ownerId`를 인자로 남기는 것은 호출부의 의도를 드러내 이 단언이 걸리게 하기 위함이다.

**세율 연도의 취급.** 세율·상수는 연도별 데이터이며(ADR-005) 시드된 연도만 존재한다.

| 대상 연도 | 동작 |
|---|---|
| 시드가 있는 연도 | 그 연도의 값을 쓴다. `taxLawYear = year` |
| 시드보다 미래 | **최신 시드 연도로 근사**하고 `taxLawYear`에 그 연도를 담는다. 화면은 근사임을 표시한다 |
| 시드보다 과거 | **예외.** 뒤 연도의 법으로 과거를 계산하면 ADR-005가 보장하려는 재현성(K-08의 전제)이 깨진다. 없는 값을 근사하는 것보다 없다고 말하는 것이 맞다 |

> **이 규칙이 없으면 홈 화면이 날짜만으로 죽는다.** §4.1 `currentYearTax`도 당해 연도의 구간·상수를 요구하므로, 2027년 1월 1일이 되면 코드 변경 없이 SCR-101이 예외로 멈춘다. 연도 선택기가 있는 SCR-401에서는 과거 연도 선택이 같은 경로를 탄다.

**`marginalRates[].bracketLabel`의 합성 규칙.** `tax_brackets`에는 하한만 있고 표시 문자열의 원천이 없으므로 계약 계층이 합성한다 — 해당 구간의 하한과 **다음 구간의 하한**으로 `"1,400만~5,000만"` 형태를, 최상단 구간은 `"10억 초과"` 형태를 만든다. 만 단위 한글 표기를 쓰고, 1억 이상은 억 단위로 적는다.

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
- 상품·기초자산·평가일정을 단일 트랜잭션으로 생성한다
- 배리어 일괄 입력(`90-85-80-…`)의 파싱은 클라이언트에서 수행하며, 계약은 배열만 받는다

**권한:** 인증 사용자 누구나 (본인 소유로 생성)

### 5.2 상품 수정 — SCR-204

```ts
function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<{ id: string }>>
```

**권한:** 소유자
**제약**
- 상환 완료 상품은 수정 불가 → `CONFLICT`
- `kiBarrier`·`kiObservation`은 함께 설정하거나 함께 비운다(V-16, I-11). **낙인형을 해제하면 `kiTouchedAt`도 함께 비워야 한다**(V-18, I-15) — 셋 중 일부만 비우는 입력은 DB가 `23514`로 거부한다
- 하위 배열 교체가 V-02·V-03을 만족해야 한다. 기초자산·차수를 0건으로 줄이는 수정은 거부된다 (I-07)

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
> **DB 층에는 아직 이 방어가 없다.** RLS는 소유자의 행 단위 DELETE를 허용하므로(DOC-010 AQ-14) 마이그레이션·수동 SQL로는 0건 상태를 만들 수 있다. **방어가 계약 한 층뿐임을 기록한다.**

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

- 단일 트랜잭션으로 `redemptions` 1건 생성. 원본 삭제·이관 없음 (K-03)
- `withholdingTax` 미입력 시 `taxableIncome × 분리과세율`로 산출
- 상태는 레코드 존재로 유도되므로 별도 갱신 없음 (D-01)

**권한:** 소유자
**제약:** 이미 상환된 상품 → `CONFLICT` (`UNIQUE(els_id)`, I-01)

### 5.5 상환 수정 · 취소 — SCR-202

```ts
function updateRedemption(id: string, input: RedemptionInput): Promise<ActionResult<void>>
function deleteRedemption(id: string): Promise<ActionResult<void>>
```

**권한:** 상품 소유자

> **`deleteRedemption`은 상품을 보유중 상태로 되돌린다.** 잘못 입력한 상환을 취소하는 유일한 경로이므로 반드시 제공한다. 실행 전 확인 절차를 둔다.

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
**동작:** `UNIQUE(user_id, tax_year)` 기준 UPSERT

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
**제약:** 관측 좌표(`assetId`·`asOfDate`)는 기존 행에서 변경할 수 없다 (I-16)

> **`.upsert()`를 그대로 쓸 수 있다.** `DO UPDATE SET`이 payload 전역(`asset_id`·`as_of_date` 포함)을 실어도 동일값 재대입이므로 I-16 트리거를 통과한다. 좌표를 **바꾸는** UPDATE만 `23514`로 거부되며, 좌표가 다른 시세는 정정이 아니라 새 관측이므로 새 행으로 넣는다. 조회한 행을 그대로 되싣는 형태도 안전하다 — `created_at`은 동결 대상이 아니므로 `timestamptz`(마이크로초)와 JavaScript `Date`(밀리초)의 정밀도 차이가 문제를 만들지 않는다(DOC-002 §8 I-16 참조).

### 5.8 시세 수동 갱신 — SCR-302

```ts
function refreshPrices(): Promise<ActionResult<{
  succeeded: number
  failed: Array<{ assetId: string; assetName: string; reason: string }>
}>>
```

**동작:** 7장의 배치와 동일 로직. 부분 실패를 허용하며 실패 목록을 반환한다

### 5.9 KI 터치 확정 — SCR-202

```ts
function setKiTouched(
  productId: string,
  touchedAt: string | null              // null = 터치 해제
): Promise<ActionResult<void>>
```

**권한:** 소유자

> 시스템은 KI 터치를 자동 확정하지 않는다(DOC-002 D-04). 수집 시세로 하회가 관측되면 화면에 후보로 표시하고, 확정은 본 계약을 통해 사용자가 수행한다.

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
**제약:** `UNIQUE(name, market)` 위반 시 `CONFLICT`

---

## 6. 검증 규칙

`VALIDATION_FAILED` 응답의 `fields`에 필드명과 사유를 담는다.

| ID | 대상 | 규칙 |
|---|---|---|
| V-01 | `principal` | 0보다 큰 정수 |
| V-02 | `underlyings` (`createProduct`·`updateProduct`) | 1개 이상 (I-07) |
| V-03 | `schedules` (`createProduct`·`updateProduct`) | 1개 이상, 그리고 길이 = 입력의 `totalRounds` (I-07) |
| V-04 | `roundNo` | 1부터 연속, 중복 없음 (I-03) |
| V-05 | `lizardBarrier` | 존재 시 `barrier` 이하 (I-04) |
| V-06 | `lizardCouponRate` | `lizardBarrier` 존재 시 필수 |
| V-07 | `evaluationDate` | 차수 순으로 증가. 최초 차수 ≥ `issueDate` |
| V-08 | 비율 필드 | `0 < x ≤ 2`. 초과 시 정규화 누락 의심 (M-04) |
| V-09 | `assetId` | 상품 내 중복 불가 (I-02) |
| V-10 | `redemptionDate` | `issueDate` 이후 |
| V-11 | `taxableIncome` | 0 이상 (I-12) |
| V-12 | `MATURITY_LOSS` | `taxableIncome = 0` 강제 (I-08, DOC-007 §4.4) |
| V-13 | `roundNo` (상환) | `EARLY`·`LIZARD`인 경우 필수 (I-14) |
| V-14 | `LIZARD` | 해당 차수가 실재하고(I-13) 그 차수에 리자드 조건이 정의되어 있어야 함 |
| V-15 | `price` | 0보다 큼 |
| V-16 | `kiObservation` | `kiBarrier` 존재 시 필수. 부재 시 입력 불가 (I-11) |
| V-17 | `asOfDate` | 미래 일자 거부. 기준일 이후의 시세는 존재할 수 없다 |
| V-18 | `kiTouchedAt` | `kiBarrier` 부재 시 입력 불가 (I-15) |

> **V-08의 의도.** 사용자가 `90`을 입력했는데 정규화되지 않고 전달되면 배리어가 9000%가 된다. 상한 검사로 이런 유입을 차단한다.

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
| SCR-101 홈 | `getDashboard` | — |
| SCR-201 목록 | `listProducts` | — |
| SCR-202 상세 | `getProduct` | `deleteProduct`, `deleteRedemption`, `updateRedemption`, `setKiTouched` |
| SCR-203 상환 | `getProduct` | `createRedemption` |
| SCR-204 등록·수정 | `getProduct`, `searchAssets` | `createProduct`, `updateProduct`, `createAsset` |
| SCR-301 일정 | `listSchedule` | — |
| SCR-302 시세 | `listAssetPrices` | `saveManualPrice`, `refreshPrices` |
| SCR-401 세금 | `getTaxSummary` | `saveTaxProfile` |
| SCR-402 전망 | `getForecast` (**미구현 — §4.7**) | — |
| SCR-501 사용자 | `listUserSummaries` | — |
| SCR-502 설정 | — | (계정 관련, 추후) |

---

## 9. 미결정 사항

| ID | 항목 | 상태 | 비고 |
|---|---|---|---|
| AQ-06 | 자동 수집이 수동 입력값을 덮어쓸지 | 미결 | CR-05 참조 |
| AQ-07 | 상품 삭제 시 소프트 삭제 여부 | **해결 (P2)** | 하드 삭제. 단 상환 완료 상품은 삭제 불가(§5.3). DOC-002 DQ-01과 동일 |
| AQ-08 | 전망 기본 연수 | 미결 | 현재 6년 가정 |
| AQ-09 | 목록 페이지네이션 | 미결 | A-01(사용자 10명 이하) 기준 불필요 판단. 상품 수 증가 시 재검토. **§4.0 Q-06이 판단 시점을 만든다** — 결과가 서버 상한에 걸리면 잘린 목록을 반환하지 않고 예외를 던지므로, 이 항목을 닫아야 할 시점이 조용히 지나가지 않는다. 행 단위가 차수인 §4.4가 가장 먼저 닿는다 |
| AQ-10 | 계약 계층 입력 검증 라이브러리 | 미결 | 스키마 검증 도구 선정 |
| AQ-17 | 순수 모듈의 예외를 변경 계약에서 어떻게 변환할지 | **부분 해결 (P3a) — 조회는 결정, 변경은 P3b** | 아래 참조 |
| AQ-18 | `listUserSummaries`의 타인 종합과세 여부를 `security definer`로 제공할지 | 미결 | §4.8이 타인 행의 `isComprehensive`를 `null`로 두었다. DOC-008 SQ-01(SCR-501 존치)이 닫히고 그 값이 실제로 필요하다고 판단되면 파생 boolean만 반환하는 함수를 도입한다. **P4 이후** |

**AQ-17의 조회 부분 — 결정과 철회 기록 (v0.6, U-03)**

v0.5는 "**조회 계약은 §3.1이 이미 '시스템 오류는 예외로 전파하여 에러 경계에서 처리'로 규정했으므로 문제가 없다**"고 적었다. **이 판단을 철회한다.**

철회 사유는 예외 전파가 화면에 미치는 범위다. 모든 SELECT 정책이 `using (true)`이므로(DOC-010 §7) 결함 상품은 소유자만의 문제가 아니다.

| 경로 | 예외를 전파할 때의 결과 |
|---|---|
| `listProducts`·`listSchedule`·`getDashboard` | **남의 결함 상품 1건이 SCR-101·201·301을 전원에게 죽인다.** 자기 데이터가 멀쩡한 사용자도 목록을 볼 수 없다 |
| `getProduct` | SCR-202가 죽고, §8 추적 매트릭스상 **SCR-204(수정)도 같은 계약을 쓰므로 유일한 복구 경로까지 막힌다.** 계약으로는 0건을 만들 수 없으니 계약으로 고칠 수도 없어, 수동 SQL 외에 복구 수단이 없다 |

따라서 조회 계층은 `worstOf`에 0건을 넘기지 않고 §4.2의 `integrityIssue`로 상태를 드러낸다. **순수 모듈의 거부는 그대로 둔다** — DOC-007 §3.1은 변경되지 않으며, DB를 경유해 도달한 0건에 대한 최종 안전망으로 남는다(DOC-010 AQ-14). 조회 계층은 위반을 삼키지 않고 로그로 남긴다.

> **이것은 "시끄럽게 멈추는 것이 낫다"의 포기가 아니다.** 결함은 여전히 화면에 드러나며, 시세 없음(E-01)과 구분되고, 조치 목록(§4.1 `attentionItems`)에도 오른다. 달라진 것은 **드러나는 범위**다 — 결함 있는 한 행이 시끄럽게 표시되는 것과, 관계없는 사용자의 화면 세 개가 멈추는 것은 같은 시끄러움이 아니다.

**남은 절반은 P3b다.** AQ-17이 원래 물은 것은 "**변경 계약**이 순수 모듈의 예외를 어떤 `ErrorCode`로 바꾸는가"이며(§3.1의 `ActionResult`는 예외를 던지지 않는다), `INTERNAL`인지 `CONFLICT`인지가 화면 처리를 갈라놓는다(§3.2). 조회 쪽 결정이 그 질문에 답한 것은 아니다.

---

*본 문서는 프로젝트 진행에 따라 갱신되며, 주요 변경은 변경 이력에 기록한다.*
