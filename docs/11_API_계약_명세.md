# API · 계약 명세

**언제들어오나** — ELS 통합관리 시스템

| 항목 | 내용 |
|---|---|
| 문서 ID | DOC-011 |
| 버전 | 0.2 |
| 작성일 | 2026-07-26 |
| 작성자 | 민서 |
| 선행 문서 | DOC-002 데이터 모델 v0.2, DOC-007 계산 로직 명세 v0.2, DOC-008 화면 목록, DOC-010 아키텍처 |
| 상태 | 검토 중 |

### 변경 이력

| 버전 | 일자 | 작성자 | 변경 내용 |
|---|---|---|---|
| 0.1 | 2026-07-26 | 민서 | 최초 작성 |
| 0.2 | 2026-07-27 | 민서 | P1 구현 착수에 따른 정정. §4.6 `TaxSummaryView.tax.method1`·`method2`를 `string | null`로 변경. `F ≤ 종합과세 기준금액` 구간은 비교과세를 적용하지 않으므로(DOC-007 v0.2 §5.2) 두 방식 값이 존재하지 않는다 |

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
    reason: 'KI_NEAR' | 'KI_TOUCHED' | 'EVALUATION_PASSED' | 'PRICE_MISSING'
  }>
}
```

> `currentYearTax`는 **로그인 사용자 본인 기준**으로만 산출한다. `scope = 'ALL'`이어도 세금은 합산하지 않는다(DOC-002 D-02).

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
  kiStatus: 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED'
  isOwner: boolean                      // 액션 버튼 노출 판단
}
```

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
    totalRounds: number
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
  } | null                              // 상환완료 시 null
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
  isPast: boolean
}
```

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
  isStale: boolean                     // 기준일 경과 여부
}
```

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

> `override`는 시뮬레이션 전용이며 `tax_profiles`에 저장되지 않는다. 저장은 `saveTaxProfile`(5.6)로 별도 수행한다. 이 분리로 "값을 조정해봤을 뿐인데 저장되는" 문제를 방지한다.

> **`method1`·`method2`가 nullable인 이유.** `F ≤ 종합과세 기준금액`이면 분리과세로 종결되어 비교과세를 적용하지 않는다(DOC-007 §5.2). 이 구간에서 두 방식의 산식을 그대로 계산한 값을 내려보내면 화면이 무의미한 비교를 렌더링하고, 심지어 `max(①,②) − T(A)`가 실제 세액과 어긋난다(§5.2 참조). 따라서 미적용을 `null`로 표현하고 `isComprehensive = false`와 함께 해석한다.

### 4.7 다년도 전망 — SCR-402

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
  isComprehensive: boolean
}
```

> 합계 행을 제공하지 않는다. 금융소득종합과세는 개인 단위이므로 사용자 간 합산은 오해를 유발한다.

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
**제약:** 상환 완료 상품은 수정 불가 → `CONFLICT`

### 5.3 상품 삭제 — SCR-202

```ts
function deleteProduct(id: string): Promise<ActionResult<void>>
```

**권한:** 소유자
**동작:** 하위 레코드(기초자산·일정·상환)를 함께 삭제한다. 소프트 삭제 여부는 DQ-01 미결

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
| V-02 | `underlyings` | 1개 이상 (I-07) |
| V-03 | `schedules` | 길이 = `totalRounds` (I-07) |
| V-04 | `roundNo` | 1부터 연속, 중복 없음 (I-03) |
| V-05 | `lizardBarrier` | 존재 시 `barrier` 이하 (I-04) |
| V-06 | `lizardCouponRate` | `lizardBarrier` 존재 시 필수 |
| V-07 | `evaluationDate` | 차수 순으로 증가. 최초 차수 ≥ `issueDate` |
| V-08 | 비율 필드 | `0 < x ≤ 2`. 초과 시 정규화 누락 의심 (M-04) |
| V-09 | `assetId` | 상품 내 중복 불가 (I-02) |
| V-10 | `redemptionDate` | `issueDate` 이후 |
| V-11 | `taxableIncome` | 0 이상 |
| V-12 | `MATURITY_LOSS` | `taxableIncome = 0` 강제 (I-08, DOC-007 §4.4) |
| V-13 | `roundNo` (상환) | `EARLY`·`LIZARD`인 경우 필수 |
| V-14 | `LIZARD` | 해당 차수에 리자드 조건이 정의되어 있어야 함 |
| V-15 | `price` | 0보다 큼 |
| V-16 | `kiObservation` | `kiBarrier` 존재 시 필수 |

> **V-08의 의도.** 사용자가 `90`을 입력했는데 정규화되지 않고 전달되면 배리어가 9000%가 된다. 상한 검사로 이런 유입을 차단한다.

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
| SCR-402 전망 | `getForecast` | — |
| SCR-501 사용자 | `listUserSummaries` | — |
| SCR-502 설정 | — | (계정 관련, 추후) |

---

## 9. 미결정 사항

| ID | 항목 | 상태 | 비고 |
|---|---|---|---|
| AQ-06 | 자동 수집이 수동 입력값을 덮어쓸지 | 미결 | CR-05 참조 |
| AQ-07 | 상품 삭제 시 소프트 삭제 여부 | 미결 | DQ-01과 동일 |
| AQ-08 | 전망 기본 연수 | 미결 | 현재 6년 가정 |
| AQ-09 | 목록 페이지네이션 | 미결 | A-01(사용자 10명 이하) 기준 불필요 판단. 상품 수 증가 시 재검토 |
| AQ-10 | 계약 계층 입력 검증 라이브러리 | 미결 | 스키마 검증 도구 선정 |

---

*본 문서는 프로젝트 진행에 따라 갱신되며, 주요 변경은 변경 이력에 기록한다.*
