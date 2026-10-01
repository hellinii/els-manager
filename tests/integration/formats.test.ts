import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FX, ITG_USER_A } from './helpers/fixtures'
import {
  closeSeedConnection,
  resetFixtures,
  seedAsset,
  seedExchangeRate,
  seedPrice,
  seedProduct,
  seedRedemption,
  seedSchedule,
  seedTaxProfile,
  seedUnderlying,
} from './helpers/seed'
import {
  AS_OF,
  RATE_AS_OF,
  YEAR,
  contractsFor,
  setupScenario,
  type Scenario,
} from './helpers/scenario'
import { collect, type Coverage, type Spec } from './helpers/formats'

/**
 * Q-07 형식 적합성 — 10계약 전 필드 (DOC-011 §4.0)
 *
 * **이 파일이 따로 있는 이유가 둘이다.**
 *
 * ① 커버리지 단언(②③)은 10계약을 **누적한 뒤** 판정한다. `contracts.test.ts`의
 *    §별 `it`에 끼워 넣으면 실행 순서에 의존하게 되어 `it.only` 한 번에 거짓
 *    실패가 난다. 여기서는 수집을 `beforeAll`에서 끝낸다.
 * ② 정본 시나리오가 닿지 않는 분기(원천징수 없음, 만기상환, KI 터치 확정,
 *    발행사·메모, 시장 없음)를 메울 **파일 전용 픽스처**가 필요한데, 정본에
 *    넣으면 다른 파일의 건수 단언이 그 한 상품의 인질이 된다.
 *
 * 분류표는 헬퍼가 아니라 **여기** 둔다 — 표 자체가 단언되는 명세이므로 단언 옆에
 * 있어야 한다.
 */

const ACCOUNT_TYPES = ['GENERAL', 'TAX_FREE'] as const
const CONDITION_RESULTS = ['EARLY', 'LIZARD', 'CARRY_OVER'] as const
const KI_STATUSES = ['NO_KI', 'SAFE', 'WARNING', 'BELOW', 'TOUCHED'] as const
const INTEGRITY_ISSUES = ['UNDERLYING_MISSING', 'SCHEDULE_MISSING'] as const
const PRICE_SOURCES = ['AUTO', 'MANUAL'] as const
const REDEMPTION_TYPES = [
  'EARLY',
  'LIZARD',
  'MATURITY_GAIN',
  'MATURITY_LOSS',
] as const
const HEALTH_TYPES = ['EMPLOYEE', 'REGIONAL', 'DEPENDENT', 'NONE'] as const
const ATTENTION_REASONS = [
  'KI_NEAR',
  'KI_BELOW',
  'KI_TOUCHED',
  'EVALUATION_PASSED',
  'PRICE_MISSING',
  'UNDERLYING_MISSING',
  'SCHEDULE_MISSING',
] as const
const STATUSES = ['ACTIVE', 'REDEEMED'] as const
/** DOC-002 §4.6 — 기실현 등재의 판별 열 (P6 컷 5) */
const ENTRY_MODES = ['FULL', 'REALIZED_ONLY'] as const
const KI_OBSERVATIONS = ['CONTINUOUS', 'CLOSING'] as const
/** DOC-011 §4.0 `ProductCurrency` (P8 컷 a2) — 기초자산 통화(`assets.currency`, `TEXT`)와 다른 축이다 */
const CURRENCIES = ['KRW', 'USD'] as const
/** 지원 외화 (§4.0 `ExchangeRateBasisView.currency` · §4.11) — 원화는 환율의 대상이 아니다 */
const FOREIGN = ['USD'] as const

/**
 * `ExchangeRateBasisView`(§4.0 · P8 컷 a3) — 네 뷰가 **같은 분류**로 싣는다. 환율은 시세와 같은 6자리
 * 부류다(Q-07′ — 새 부류를 만들지 않는다). 접두사마다 펼친다 — 형식이 갈리면 같은 환율을 뷰마다 다르게
 * 직렬화한다는 뜻이고, 그러면 SCR-302와 SCR-401이 다른 숫자를 보인다(§4.11 「같은 행」).
 */
function basisSpec(prefix: string): Record<string, Spec> {
  return {
    [prefix]: 'NULL_OBJECT',
    [`${prefix}.currency`]: FOREIGN,
    [`${prefix}.rate`]: 'PRICE',
    [`${prefix}.asOfDate`]: 'DATE',
    [`${prefix}.source`]: PRICE_SOURCES,
    [`${prefix}.isStale`]: 'BOOL',
  }
}

/** §4.1 대시보드 */
const DASHBOARD: Record<string, Spec> = {
  'upcomingEvaluations[].productId': 'UUID',
  'upcomingEvaluations[].productName': 'TEXT',
  'upcomingEvaluations[].ownerName': 'TEXT',
  'upcomingEvaluations[].roundNo': 'NUMBER',
  'upcomingEvaluations[].evaluationDate': 'DATE',
  'upcomingEvaluations[].dDay': 'NUMBER',
  'upcomingEvaluations[].worstOf': 'RATIO',
  'upcomingEvaluations[].barrier': 'RATIO',
  'upcomingEvaluations[].willMeet': 'BOOL',
  'totals.activeCount': 'NUMBER',
  // v4.9 — 통화별 사실. 금액 둘은 **그 행의** `currency`로 판정한다(MONEY)
  'totals.byCurrency[].currency': CURRENCIES,
  'totals.byCurrency[].activeCount': 'NUMBER',
  'totals.byCurrency[].activePrincipal': 'MONEY',
  'totals.byCurrency[].realizedPnl': 'MONEY',
  // v4.9 (P8 컷 a3) — 원화 환산 추정. 금액은 과세 축과 같은 원화 정수다(Q-07 ⓑ)
  'totals.krwEstimate': 'NULL_OBJECT',
  'totals.krwEstimate.activePrincipal': 'AMOUNT_KRW',
  ...basisSpec('totals.krwEstimate.exchangeRateBasis'),
  'currentYearTax.year': 'NUMBER',
  'currentYearTax.financialIncome': 'AMOUNT_KRW',
  'currentYearTax.isComprehensive': 'BOOL',
  'currentYearTax.additionalTax': 'AMOUNT_KRW',
  'currentYearTax.unconvertedCount': 'NUMBER',
  'currentYearTax.convertedCount': 'NUMBER',
  ...basisSpec('currentYearTax.exchangeRateBasis'),
  'attentionItems[].productId': 'UUID',
  'attentionItems[].productName': 'TEXT',
  // v2.0 — 같은 뷰의 `upcomingEvaluations[].ownerName`과 **같은 분류여야 한다.**
  // 갈리면 한 뷰가 소유자 이름을 두 형식으로 직렬화한다는 뜻이다.
  'attentionItems[].ownerName': 'TEXT',
  'attentionItems[].reason': ATTENTION_REASONS,
  // ⑤ 최근 상환 실적 (v2.0). `realizedPnl`은 **음수 가능**이므로 `MONEY` 분류가
  // 부호를 허용해야 한다 — §4.3의 `redemption.realizedPnl`과 같은 자리다.
  'recentRedemptions[].productId': 'UUID',
  'recentRedemptions[].productName': 'TEXT',
  'recentRedemptions[].ownerName': 'TEXT',
  'recentRedemptions[].redemptionType': REDEMPTION_TYPES,
  'recentRedemptions[].redemptionDate': 'DATE',
  'recentRedemptions[].currency': CURRENCIES,
  'recentRedemptions[].grossAmount': 'MONEY',
  'recentRedemptions[].realizedPnl': 'MONEY',
  'recentRedemptions[].isConfirmed': 'BOOL',
}

/** §4.2 상품 목록 */
const PRODUCT_LIST: Record<string, Spec> = {
  id: 'UUID',
  name: 'TEXT',
  ownerId: 'UUID',
  ownerName: 'TEXT',
  principal: 'MONEY',
  currency: CURRENCIES,
  accountType: ACCOUNT_TYPES,
  status: STATUSES,
  entryMode: ENTRY_MODES,
  nextEvaluation: 'NULL_OBJECT',
  'nextEvaluation.roundNo': 'NUMBER',
  'nextEvaluation.date': 'DATE',
  'nextEvaluation.dDay': 'NUMBER',
  'nextEvaluation.barrier': 'RATIO',
  worstOf: 'RATIO',
  conditionResult: CONDITION_RESULTS,
  kiStatus: KI_STATUSES,
  integrityIssue: INTEGRITY_ISSUES,
  isOwner: 'BOOL',

  /*
   * 기초자산별 관측 (v3.4) — **§4.3 `underlyings[]`의 같은 이름 필드와 같은 분류여야
   * 한다.** 두 뷰가 같은 함수(`underlyingQuotesOf`)에서 나오므로 형식이 갈리면 그
   * 함수가 아니라 **직렬화 경계**가 갈렸다는 뜻이다.
   */
  'underlyingPrices[].assetId': 'UUID',
  'underlyingPrices[].currentPrice': 'PRICE',
  'underlyingPrices[].ratio': 'RATIO',
  'underlyingPrices[].isWorst': 'BOOL',

  /*
   * 계약 조건 (v3.1) — **§4.3의 같은 이름 필드와 같은 분류여야 한다.** 형식이 갈리면
   * 목록과 상세가 같은 값을 다르게 직렬화한다는 뜻이고, 그 어긋남은 두 화면의 숫자
   * 차이로만 드러난다(`product.*` 판정 삼종에 같은 주석이 붙어 있는 이유다).
   *
   * `terms` 자신은 등재하지 않는다 — `null`이 될 수 없는 객체이므로 `walk`가 그것을
   * 잎으로 내지 않는다(`NULL_OBJECT`와 다른 점이 정확히 그것이다).
   */
  'terms.annualCouponRate': 'RATIO',
  'terms.kiBarrier': 'RATIO',
  'terms.kiObservation': KI_OBSERVATIONS,
  /** 관측과 짝짓는 키다 — 표시값이 아니지만 직렬화 경계는 똑같이 지난다 */
  'terms.underlyings[].assetId': 'UUID',
  'terms.underlyings[].assetName': 'TEXT',
  'terms.underlyings[].basePrice': 'PRICE',
  /** 스칼라 배열이다 — 잎이 원소 자신이므로 `[]`로 끝난다 */
  'terms.barriers[]': 'RATIO',
  'terms.lizards[].roundNo': 'NUMBER',
  'terms.lizards[].barrier': 'RATIO',
  'terms.lizards[].couponRate': 'RATIO',
  'terms.lizards[].requiresNoKi': 'BOOL',
}

/** §4.3 상품 상세 */
const PRODUCT_DETAIL: Record<string, Spec> = {
  'product.id': 'UUID',
  'product.name': 'TEXT',
  'product.issuer': 'TEXT',
  'product.ownerId': 'UUID',
  'product.ownerName': 'TEXT',
  'product.isOwner': 'BOOL',
  'product.issueDate': 'DATE',
  'product.principal': 'MONEY',
  'product.currency': CURRENCIES,
  'product.evaluationPeriodMonths': 'NUMBER',
  'product.totalRounds': 'NUMBER',
  // 판정 삼종 (v1.4) — §4.2의 같은 이름 필드와 같은 분류여야 한다. 형식이 갈리면
  // 두 뷰가 같은 값을 다르게 직렬화한다는 뜻이다.
  'product.status': STATUSES,
  'product.worstOf': 'RATIO',
  'product.kiStatus': KI_STATUSES,
  'product.integrityIssue': INTEGRITY_ISSUES,
  'product.annualCouponRate': 'RATIO',
  'product.kiBarrier': 'RATIO',
  'product.kiObservation': KI_OBSERVATIONS,
  'product.kiTouchedAt': 'DATE',
  'product.accountType': ACCOUNT_TYPES,
  'product.entryMode': ENTRY_MODES,
  'product.note': 'TEXT',
  'underlyings[].assetId': 'UUID',
  'underlyings[].assetName': 'TEXT',
  'underlyings[].basePrice': 'PRICE',
  'underlyings[].currentPrice': 'PRICE',
  'underlyings[].priceAsOf': 'DATE',
  'underlyings[].priceSource': PRICE_SOURCES,
  'underlyings[].ratio': 'RATIO',
  'underlyings[].isWorst': 'BOOL',
  'schedules[].roundNo': 'NUMBER',
  'schedules[].evaluationDate': 'DATE',
  'schedules[].barrier': 'RATIO',
  'schedules[].lizardBarrier': 'RATIO',
  'schedules[].lizardCouponRate': 'RATIO',
  'schedules[].lizardRequiresNoKi': 'BOOL',
  // 형제 가지 — 조상에 통화가 없으므로 **루트의 `product.currency`**로 판정한다(§4.0 규칙 1)
  'schedules[].expectedGross': 'MONEY',
  'schedules[].conditionResult': CONDITION_RESULTS,
  'schedules[].isPast': 'BOOL',
  projection: 'NULL_OBJECT',
  'projection.appliedRoundNo': 'NUMBER',
  'projection.expectedGross': 'MONEY',
  // 과세 축 — 달러 상품에서도 원화다. `null`은 E-09(미상환 달러 · 환율 없음)
  'projection.expectedTaxableIncome': 'AMOUNT_KRW',
  ...basisSpec('projection.exchangeRateBasis'),
  'projection.attributionYear': 'NUMBER',
  redemption: 'NULL_OBJECT',
  'redemption.id': 'UUID',
  'redemption.redemptionType': REDEMPTION_TYPES,
  'redemption.roundNo': 'NUMBER',
  'redemption.redemptionDate': 'DATE',
  'redemption.grossAmount': 'MONEY',
  'redemption.taxableIncome': 'AMOUNT_KRW',
  'redemption.withholdingTax': 'AMOUNT_KRW',
  // 적용 환율(참고) — 새 부류를 만들지 않는다. 시세와 같은 6자리다(Q-07′)
  'redemption.exchangeRate': 'PRICE',
  'redemption.isConfirmed': 'BOOL',
  'redemption.realizedPnl': 'MONEY',
  'redemption.note': 'TEXT',
}

/** §4.4 평가일정 — `integrityIssue`가 한 값뿐인 것은 계약이 좁힌 것이다 */
const SCHEDULE_ITEM: Record<string, Spec> = {
  productId: 'UUID',
  productName: 'TEXT',
  // v1.8 신설 둘. `ownerId`·`status`의 분류는 §4.2의 같은 이름 필드와 **같아야
  // 한다** — 형식이 갈리면 두 뷰가 같은 값을 다르게 직렬화한다는 뜻이고, 화면은
  // 그 둘을 같은 함수(`deriveDisplay`·소유자 필터)에 넣는다.
  ownerId: 'UUID',
  ownerName: 'TEXT',
  roundNo: 'NUMBER',
  evaluationDate: 'DATE',
  dDay: 'NUMBER',
  barrier: 'RATIO',
  hasLizard: 'BOOL',
  status: STATUSES,
  worstOf: 'RATIO',
  conditionResult: CONDITION_RESULTS,
  integrityIssue: ['UNDERLYING_MISSING'],
  isPast: 'BOOL',
  // v3.3 신설 다섯. **분류가 §4.2·§4.3의 같은 이름 필드와 같아야 한다** —
  // `principal`·`accountType`은 §4.2에, `expectedGross`는 §4.3에 있고 화면은
  // 같은 포매터(`amount`·`percent`)에 넣는다. 형식이 갈리면 두 뷰가 같은 값을
  // 다르게 직렬화한다는 뜻이다.
  principal: 'MONEY',
  currency: CURRENCIES,
  annualCouponRate: 'RATIO',
  accountType: ACCOUNT_TYPES,
  totalRounds: 'NUMBER',
  // 넷 다 상품 통화다 — 달러 상품의 예상 원천징수도 **달러**다(「달러 기준 참고」 — §4.4 v4.9)
  'proceeds.expectedGross': 'MONEY',
  'proceeds.expectedWithholding': 'MONEY',
  'proceeds.expectedNet': 'MONEY',
  // `MONEY`는 부호를 허용한다(`recentRedemptions[].realizedPnl`이 이미 그 자리다).
  // 현 산식에서 음수가 나오지 않지만 분류를 좁히면 산식이 바뀌는 날 형식이 막는다.
  'proceeds.expectedPnl': 'MONEY',
  'proceeds.separateTaxationRate': 'RATIO',
  'proceeds.taxLawYear': 'NUMBER',

  // v3.4 신설 셋. `kiBarrier`·`kiObservation`은 §4.2 `terms`의 같은 이름 필드와,
  // `underlyings[]`의 다섯은 §4.3의 같은 이름 필드와 **같은 분류여야 한다** —
  // 그쪽은 계약/관측이 두 필드로 갈려 있고 여기는 합쳐져 있으므로, 형식이 갈리면
  // 「형태만 다르고 값은 같다」는 §4.4의 주장이 거짓이 된다.
  kiBarrier: 'RATIO',
  kiObservation: KI_OBSERVATIONS,
  'underlyings[].assetName': 'TEXT',
  'underlyings[].basePrice': 'PRICE',
  'underlyings[].currentPrice': 'PRICE',
  'underlyings[].ratio': 'RATIO',
  'underlyings[].isWorst': 'BOOL',
}

/** §4.5 시세 */
const ASSET_PRICE: Record<string, Spec> = {
  assetId: 'UUID',
  name: 'TEXT',
  market: 'TEXT',
  currency: 'TEXT',
  latestPrice: 'PRICE',
  asOfDate: 'DATE',
  source: PRICE_SOURCES,
  usedByActiveProducts: 'NUMBER',
  isStale: 'BOOL',
  /*
   * P5a 컷 2b. **분류와 픽스처는 «함께» 와야 한다** — 분류만 넣으면 ③(죽은 분류)이,
   * 픽스처만 넣으면 ②(미분류)가 빨간불이다. 그리고 **둘 다 없으면 조용히 통과**한다:
   * 배열이 비면 잎이 0개라 어느 단언도 걸리지 않고, 필드가 계약에 있는데 형식을
   * 아무도 보지 않는다.
   */
  'providerSymbols[].provider': 'TEXT',
  'providerSymbols[].symbol': 'TEXT',
}

/** §4.6 세금 */
const TAX_SUMMARY: Record<string, Spec> = {
  year: 'NUMBER',
  taxLawYear: 'NUMBER',
  // v1.9 — 연도 선택기의 하한. 배열이므로 잎은 `seededYears[]`로 접힌다.
  'seededYears[]': 'NUMBER',
  'profile.otherIncomeBase': 'AMOUNT_KRW',
  'profile.otherFinancialIncome': 'AMOUNT_KRW',
  'profile.healthInsuranceType': HEALTH_TYPES,
  'profile.isSaved': 'BOOL',
  'income.elsTaxableIncome': 'AMOUNT_KRW',
  'income.otherFinancialIncome': 'AMOUNT_KRW',
  'income.total': 'AMOUNT_KRW',
  'income.isComprehensive': 'BOOL',
  'income.thresholdGap': 'AMOUNT_KRW',
  'income.unconvertedCount': 'NUMBER',
  'income.convertedCount': 'NUMBER',
  ...basisSpec('income.exchangeRateBasis'),
  'tax.method1': 'AMOUNT_KRW',
  'tax.method2': 'AMOUNT_KRW',
  'tax.computedTax': 'AMOUNT_KRW',
  'tax.localTax': 'AMOUNT_KRW',
  'tax.totalTax': 'AMOUNT_KRW',
  'tax.withheld': 'AMOUNT_KRW',
  'tax.additionalPayment': 'AMOUNT_KRW',
  'tax.effectiveRate': 'RATIO',
  'healthInsurance.assessmentBase': 'AMOUNT_KRW',
  'healthInsurance.healthPremium': 'AMOUNT_KRW',
  'healthInsurance.longTermCarePremium': 'AMOUNT_KRW',
  'healthInsurance.total': 'AMOUNT_KRW',
  'healthInsurance.isEstimate': 'BOOL',
  'marginalRates[].bracketLabel': 'TEXT',
  'marginalRates[].incomeTaxRate': 'RATIO',
  'marginalRates[].realMarginalRate': 'RATIO',
  'contributingProducts[].productId': 'UUID',
  'contributingProducts[].productName': 'TEXT',
  // 한 객체에 두 부류가 산다 — 같은 객체에 `currency: 'USD'`가 있어도 이 경로는 원화다.
  // 부류는 **경로가** 정한다(DOC-011 Q-07′)
  'contributingProducts[].currency': CURRENCIES,
  'contributingProducts[].taxableIncome': 'AMOUNT_KRW',
  'contributingProducts[].isEstimated': 'BOOL',
  'contributingProducts[].exchangeRateMissing': 'BOOL',
  'contributingProducts[].integrityIssue': INTEGRITY_ISSUES,
}

/**
 * §4.7 다년도 전망 — **행 하나가 열두 열이다** (P4b 컷 7)
 *
 * `thresholdGap`이 §4.6의 같은 이름과 **다른 값**임을 여기 적어 둔다: 그쪽은 절대값이고
 * 이쪽은 부호를 남긴다(「양수면 초과」). 분류는 둘 다 `AMOUNT_KRW`이므로 형식 축에서는
 * 갈리지 않는다 — `tests/db/forecast.test.ts`가 부호를 본다.
 */
const FORECAST_ROW: Record<string, Spec> = {
  year: 'NUMBER',
  taxLawYear: 'NUMBER',
  // `null`이면 미입력. 아래 픽스처가 **이월** 상태(`< year`)를 만들어 비-null을 관측시킨다.
  profileYear: 'NUMBER',
  grossProceeds: 'AMOUNT_KRW',
  financialIncome: 'AMOUNT_KRW',
  thresholdGap: 'AMOUNT_KRW',
  isComprehensive: 'BOOL',
  effectiveRate: 'RATIO',
  additionalTax: 'AMOUNT_KRW',
  totalInsurance: 'AMOUNT_KRW',
  netProceeds: 'AMOUNT_KRW',
  cumulativeNet: 'AMOUNT_KRW',
  remainingPrincipal: 'AMOUNT_KRW',
  cumulativeAssets: 'AMOUNT_KRW',
  hasEstimates: 'BOOL',
  excludedForeignCount: 'NUMBER',
  // 표 밖 표식 다섯째 (P8 컷 a3)
  ...basisSpec('exchangeRateBasis'),
}

/** §4.8 사용자별 현황 */
const USER_SUMMARY: Record<string, Spec> = {
  userId: 'UUID',
  displayName: 'TEXT',
  isMe: 'BOOL',
  activeCount: 'NUMBER',
  'activePrincipalByCurrency[].currency': CURRENCIES,
  'activePrincipalByCurrency[].activePrincipal': 'MONEY',
  currentYearFinancialIncome: 'AMOUNT_KRW',
  includesOtherFinancialIncome: 'BOOL',
  isComprehensive: 'BOOL',
}

/**
 * §4.11 환율 (P8 컷 a3). `latestRate`는 근거 뷰의 `rate`와 **같은 분류**다 — 같은 행이다(§4.11).
 * `provider`는 자동 수집 행에서만 비-null이다 — 아래 픽스처가 그 행을 소유자 권한으로 세운다(수집기는 c2).
 */
const EXCHANGE_RATE: Record<string, Spec> = {
  currency: FOREIGN,
  latestRate: 'PRICE',
  asOfDate: 'DATE',
  source: PRICE_SOURCES,
  provider: 'TEXT',
  isStale: 'BOOL',
  usedByActiveProducts: 'NUMBER',
  autoCollected: 'BOOL',
}

/** §4.9 자산 검색 */
const ASSET_OPTION: Record<string, Spec> = {
  id: 'UUID',
  name: 'TEXT',
  market: 'TEXT',
  currency: 'TEXT',
  // v4.5 — 불러오기의 연결 후보가 같은 유형만 본다
  assetType: ['STOCK', 'INDEX', 'ETF'],
  hasPriceProvider: 'BOOL',
  // v4.3 — 불러오기가 심볼로 잇는다(§4.10). §4.5와 같은 형태다
  'providerSymbols[].provider': 'TEXT',
  'providerSymbols[].symbol': 'TEXT',
}

let s: Scenario
const coverages: Array<{ contract: string; coverage: Coverage }> = []

beforeAll(async () => {
  s = await setupScenario()

  /**
   * 정본 시나리오가 닿지 않는 분기를 메운다 — 자산 1 + 상품 1.
   *
   * `market` null / `issuer`·`note` 비-null / `kiTouchedAt` 비-null /
   * `withholdingTax` null / `roundNo` null(만기상환).
   */
  await seedAsset({ id: FX.assetFormat, name: '형식자산', market: null })
  await seedPrice({
    assetId: FX.assetFormat,
    asOfDate: '2026-06-29',
    price: '77.500000',
  })
  await seedProduct({
    id: FX.productFormat,
    ownerId: ITG_USER_A,
    name: '형식보강',
    principal: '10000000',
    issuer: '형식증권',
    note: '메모',
    kiBarrier: '0.5000',
    kiObservation: 'CONTINUOUS',
    kiTouchedAt: '2026-03-15',
  })
  await seedUnderlying({
    elsId: FX.productFormat,
    assetId: FX.assetFormat,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productFormat,
    roundNo: 1,
    evaluationDate: '2026-05-04',
    barrier: '0.9000',
  })
  await seedRedemption({
    elsId: FX.productFormat,
    roundNo: null,
    redemptionType: 'MATURITY_GAIN',
    redemptionDate: '2026-05-04',
    grossAmount: '10400000',
    taxableIncome: '400000',
    withholdingTax: null,
    note: '만기 확정',
  })

  /*
   * P8 컷 a2 — 달러 상품 둘. **센트를 싣는다** — 센트가 0이면 `amountString`의 반올림이 형식과
   * 값 둘 다에서 보이지 않는다(DOC-011 Q-07′의 「채워진 픽스처」). 상환 완료 쪽은 `MONEY`(USD)의
   * 상환 가지와 적용 환율(비-null)을, 미상환 쪽은 `projection.expectedTaxableIncome`의 E-09(`null`)와
   * 루트 `product.currency` 폴백(`schedules[]` · `projection`)을 관측시킨다.
   */
  await seedProduct({
    id: FX.productFormatUsdRedeemed,
    ownerId: ITG_USER_A,
    name: '형식달러상환',
    principal: '10000.50',
    currency: 'USD',
  })
  await seedSchedule({
    elsId: FX.productFormatUsdRedeemed,
    roundNo: 1,
    evaluationDate: '2026-05-04',
    barrier: '0.9000',
  })
  await seedRedemption({
    elsId: FX.productFormatUsdRedeemed,
    roundNo: 1,
    redemptionType: 'EARLY',
    redemptionDate: '2026-05-07',
    grossAmount: '10600.75',
    // 과세 축은 거래내역의 **원화** 값이다(U1) — 환율을 곱해 만든 값이 아니다
    taxableIncome: '835740',
    withholdingTax: '128700',
    exchangeRate: '1392.400000',
  })
  await seedProduct({
    id: FX.productFormatUsdActive,
    ownerId: ITG_USER_A,
    name: '형식달러보유',
    principal: '20000.25',
    currency: 'USD',
  })
  await seedUnderlying({
    elsId: FX.productFormatUsdActive,
    assetId: FX.assetFormat,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productFormatUsdActive,
    roundNo: 1,
    evaluationDate: '2026-07-02',
    barrier: '0.9000',
  })
  /*
   * P8 컷 a3 — 2차. `RATE_AS_OF`(07-06)에서는 1차가 지났으므로 이 차수가 적용 차수가 된다 — 그래야 그 기준일의
   * 추정이 같은 해(`YEAR`)에 서고 환산이 일어난다. `AS_OF`의 적용 차수는 여전히 1차라 a2 단언은 그대로다.
   */
  await seedSchedule({
    elsId: FX.productFormatUsdActive,
    roundNo: 2,
    evaluationDate: '2026-12-01',
    barrier: '0.8500',
  })

  /*
   * ★ **`profileYear`를 비-null로 관측시키는 픽스처이며, 연도가 과거인 것이 요점이다.**
   *
   * 정본 시나리오는 과세 프로필을 세우지 않으므로 전망 여섯 행의 `profileYear`가 전부
   * `null`이 되고 ③′(「비-null로 한 번 이상 관측된다」)가 죽는다 — 형식이 검증된 적 없는
   * 열이 된다.
   *
   * `YEAR`가 아니라 `YEAR - 1`에 세우는 이유가 둘이다. ① §4.7의 **이월** 상태
   * (`profileYear < year`)를 관측한다 — 세 상태 중 가장 판별하기 어려운 것이고, 이월이
   * 없으면 `.lte()` 대신 `.in()`으로 구현해도 통과한다. ② `getTaxSummary({year: YEAR})`의
   * 관측을 **한 칸도 바꾸지 않는다** — 그 계약은 그 해의 행만 읽으므로 `profile.isSaved`가
   * 여전히 거짓이다. 같은 파일의 다른 계약을 인질로 잡지 않는 것이 이 파일 전용 픽스처의 규약이다.
   */
  await seedTaxProfile({
    userId: ITG_USER_A,
    taxYear: YEAR - 1,
    otherIncomeBase: '20000000',
    otherFinancialIncome: '3000000',
    healthInsuranceType: 'REGIONAL',
  })

  const [
    products,
    detailA,
    detailRedeemed,
    detailNoUnderlying,
    detailNoSchedule,
    detailFormat,
    detailUsdRedeemed,
    detailUsdActive,
    schedule,
    prices,
    assets,
    tax,
    // F가 기준금액을 넘어야 method1·method2가 비-null이 된다. 픽스처가 아니라
    // override 한 번으로 덮는다 — 저장되지 않으므로 다른 단언에 영향이 없다.
    taxComprehensive,
    users,
    forecast,
    dashboardAll,
    dashboardMine,
  ] = await Promise.all([
    s.asA.listProducts(),
    s.asA.getProduct(FX.productA),
    s.asA.getProduct(FX.productRedeemed),
    s.asA.getProduct(FX.productNoUnderlying),
    s.asA.getProduct(FX.productNoSchedule),
    s.asA.getProduct(FX.productFormat),
    s.asA.getProduct(FX.productFormatUsdRedeemed),
    s.asA.getProduct(FX.productFormatUsdActive),
    s.asA.listSchedule(),
    s.asA.listAssetPrices(),
    s.asA.searchAssets('자산'),
    s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
    s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { otherFinancialIncome: '30000000' },
    }),
    s.asA.listUserSummaries(),
    s.asA.getForecast({ ownerId: ITG_USER_A }),
    s.asA.getDashboard({ scope: 'ALL' }),
    s.asA.getDashboard({ scope: 'MINE' }),
  ])

  const rows = <T,>(label: string, list: readonly T[]) =>
    list.map((value, i) => ({ label: `${label}[${i}]`, value }))

  /*
   * P8 컷 a3 — **환율이 보이는 기준일**(`RATE_AS_OF`)로 같은 계약을 한 번 더 읽는다. 위 수집은 `AS_OF`라
   * 추정 환율이 없고(예약 날짜가 전부 그 뒤다) 근거 필드가 전부 `null`로 온다 — 그것만으로는 ③(비-null 관측)이
   * 죽는다. 자동 수집 행을 소유자 권한으로 세우는 이유는 `provider`의 비-null 관측이다(수집기는 c2).
   */
  await seedExchangeRate({
    asOfDate: '2026-07-03',
    rate: '1392.400000',
    source: 'AUTO',
    provider: 'FIXTURE_AUTO',
  })
  const later = (await contractsFor(ITG_USER_A, RATE_AS_OF)).read
  const [
    ratesNone,
    ratesLater,
    dashboardKrwOnly,
    dashboardLater,
    detailUsdLater,
    taxLater,
    forecastLater,
  ] = await Promise.all([
    s.asA.listExchangeRates(),
    later.listExchangeRates(),
    // B는 원화 상품만 가진다 — `krwEstimate`의 `null`(원화 전용 포트폴리오) 가지를 관측한다
    s.asB.getDashboard({ scope: 'MINE' }),
    later.getDashboard({ scope: 'MINE' }),
    later.getProduct(FX.productFormatUsdActive),
    later.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
    later.getForecast({ ownerId: ITG_USER_A }),
  ])

  coverages.push(
    {
      contract: '§4.1 getDashboard',
      coverage: collect(DASHBOARD, [
        { label: 'ALL', value: dashboardAll },
        { label: 'MINE', value: dashboardMine },
        { label: 'B MINE(원화뿐)', value: dashboardKrwOnly },
        { label: 'MINE@환율', value: dashboardLater },
      ]),
    },
    {
      contract: '§4.2 listProducts',
      coverage: collect(PRODUCT_LIST, rows('listProducts', products)),
    },
    {
      contract: '§4.3 getProduct',
      coverage: collect(PRODUCT_DETAIL, [
        { label: 'A정상', value: detailA },
        { label: 'A상환완료', value: detailRedeemed },
        { label: 'A기초자산없음', value: detailNoUnderlying },
        { label: 'A일정없음', value: detailNoSchedule },
        { label: '형식보강', value: detailFormat },
        { label: '형식달러상환', value: detailUsdRedeemed },
        { label: '형식달러보유', value: detailUsdActive },
        { label: '형식달러보유@환율', value: detailUsdLater },
      ]),
    },
    {
      contract: '§4.4 listSchedule',
      coverage: collect(SCHEDULE_ITEM, rows('listSchedule', schedule)),
    },
    {
      contract: '§4.5 listAssetPrices',
      coverage: collect(ASSET_PRICE, rows('listAssetPrices', prices)),
    },
    {
      contract: '§4.6 getTaxSummary',
      coverage: collect(TAX_SUMMARY, [
        { label: '분리과세', value: tax },
        { label: '종합과세(override)', value: taxComprehensive },
        { label: '분리과세@환율', value: taxLater },
      ]),
    },
    {
      contract: '§4.7 getForecast',
      coverage: collect(FORECAST_ROW, [
        ...rows('getForecast', forecast),
        ...rows('getForecast@환율', forecastLater),
      ]),
    },
    {
      contract: '§4.8 listUserSummaries',
      coverage: collect(USER_SUMMARY, rows('listUserSummaries', users)),
    },
    {
      contract: '§4.9 searchAssets',
      coverage: collect(ASSET_OPTION, rows('searchAssets', assets)),
    },
    {
      contract: '§4.11 listExchangeRates',
      coverage: collect(EXCHANGE_RATE, [
        ...rows('환율없음', ratesNone),
        ...rows('환율@자동', ratesLater),
      ]),
    },
  )
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('Q-07 형식 적합성 — 10계약 전 필드', () => {
  it('계약 10개를 모두 수집했다', () => {
    expect(coverages.map((c) => c.contract)).toHaveLength(10)
  })

  it('① 모든 값이 자기 분류의 형식을 지킨다', () => {
    const violations = coverages.flatMap((c) =>
      c.coverage.violations.map((v) => `${c.contract} ${v}`),
    )
    expect(violations).toEqual([])
  })

  it('② 관측된 모든 잎이 분류되어 있다 — 새 필드가 생기면 여기서 죽는다', () => {
    // 손으로 나열한 "검사 대상"은 필드가 늘 때 조용히 낡는다. 관측을 기준으로
    // 표를 검사하면 미분류가 곧 실패다.
    const unclassified = coverages.flatMap((c) =>
      c.coverage.unclassified.map((p) => `${c.contract} ${p}`),
    )
    expect(unclassified).toEqual([])
  })

  it('③ 분류된 모든 경로가 관측된다 — 죽은 분류가 남지 않는다', () => {
    const unobserved = coverages.flatMap((c) =>
      c.coverage.unobserved.map((p) => `${c.contract} ${p}`),
    )
    expect(unobserved).toEqual([])
  })

  it('③′ MONEY 경로마다 원화와 달러가 둘 다 비-null로 관측된다 — 달러 분기가 판정된 적 있다', () => {
    const missing = coverages.flatMap((c) =>
      Object.entries(c.coverage.moneyCurrencies)
        .filter(([, currencies]) => currencies.join(',') !== 'KRW,USD')
        .map(([path, currencies]) => `${c.contract} ${path}: [${currencies.join(',')}]`),
    )
    expect(missing).toEqual([])
    // 0개를 세고 통과하지 않는다 — MONEY 경로가 실제로 표에 있다
    expect(coverages.flatMap((c) => Object.keys(c.coverage.moneyCurrencies)).length).toBe(16)
  })

  it('③ 모든 경로가 비-null로 한 번 이상 관측된다 — null로만 오면 형식이 검증된 적 없다', () => {
    const neverNonNull = coverages.flatMap((c) =>
      c.coverage.neverNonNull.map((p) => `${c.contract} ${p}`),
    )
    expect(neverNonNull).toEqual([])
  })
})

describe('달러 픽스처의 값 — E-09가 뷰까지 온다 (P8 컷 a2 · 검산 A-3)', () => {
  /*
   * 위 형식 검사는 `null`·건수·통화별 합이 **옳은지** 보지 않는다 — `taxableIncome`을 `'0'`으로 흡수해도
   * `AMOUNT_KRW`이고, 건수를 0으로 두어도 `NUMBER`이며, 전 통화를 더해도 각 행의 형식은 정상이다
   * (반박 검토 지적). 그래서 이 파일의 달러 픽스처 둘로 **값을** 본다. a2에는 추정 환율이 없으므로 미상환
   * 달러 상품의 추정은 늘 E-09다(DOC-011 §4.0 「컷별 도달」).
   */
  it('§4.6 — 빠진 상품은 행에 남고 금액이 null · 건수 1 · 확정 원화는 그대로', async () => {
    const tax = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const rowOf = (id: string) => tax.contributingProducts.find((row) => row.productId === id)
    expect(rowOf(FX.productFormatUsdActive)).toMatchObject({
      currency: 'USD',
      taxableIncome: null,
      isEstimated: true,
      exchangeRateMissing: true,
    })
    expect(rowOf(FX.productFormatUsdRedeemed)).toMatchObject({
      currency: 'USD',
      taxableIncome: '835740',
      isEstimated: false,
      exchangeRateMissing: false,
    })
    expect(tax.income.unconvertedCount).toBe(1)
  })

  it('§4.1 — 같은 건수 · 달러 행은 달러 상품에서만 · 최근 상환은 자기 통화', async () => {
    const view = await s.asA.getDashboard({ scope: 'MINE' })
    expect(view.currentYearTax.unconvertedCount).toBe(1)
    expect(view.totals.byCurrency.find((row) => row.currency === 'USD')).toEqual({
      currency: 'USD',
      activeCount: 1,
      activePrincipal: '20000.25',
      realizedPnl: '600.25',
    })
    expect(view.recentRedemptions.find((row) => row.currency === 'USD')).toMatchObject({
      grossAmount: '10600.75',
      realizedPnl: '600.25',
    })
  })

  it('§4.3 — 예상 과세만 비고 예상 수령액은 달러로 있다', async () => {
    const view = (await s.asA.getProduct(FX.productFormatUsdActive))!
    // 20000.25 × (1 + 0.08 × 6/12) = 20800.26
    expect(view.projection).toMatchObject({ expectedGross: '20800.26', expectedTaxableIncome: null })
  })

  it('§4.7 — 모든 행이 뺀 달러 상품 둘을 센다(미상환 · Y₀ 상환)', async () => {
    const rows = await s.asA.getForecast({ ownerId: ITG_USER_A })
    expect(rows.map((row) => row.excludedForeignCount)).toEqual(rows.map(() => 2))
  })

  it('§4.8 — 달러 원금이 원화 원금과 따로 온다', async () => {
    const me = (await s.asA.listUserSummaries()).find((row) => row.userId === ITG_USER_A)!
    expect(me.activePrincipalByCurrency.find((row) => row.currency === 'USD')).toEqual({
      currency: 'USD',
      activePrincipal: '20000.25',
    })
  })
})

describe('MONEY 부류가 통화를 가른다 — 계기 자신의 음성 대조 (DOC-011 Q-07′ · SB-10)', () => {
  const TABLE: Record<string, Spec> = { principal: 'MONEY', 'schedules[].expectedGross': 'MONEY' }

  it('같은 객체의 currency로 판정한다 — 달러 `10001`은 위반이다', () => {
    const coverage = collect(TABLE, [
      { label: '달러', value: { currency: 'USD', principal: '10001', schedules: [] } },
    ])
    expect(coverage.violations).toEqual([
      'principal: MONEY(USD) 형식 위반: "10001" (달러)',
    ])
  })

  it('형제 가지는 루트의 product.currency로 판정한다 (§4.3)', () => {
    const coverage = collect({ 'product.principal': 'MONEY', 'schedules[].expectedGross': 'MONEY' }, [
      {
        label: '상세',
        value: { product: { currency: 'USD', principal: '10000.50' }, schedules: [{ expectedGross: '10400' }] },
      },
    ])
    expect(coverage.violations).toEqual([
      'schedules[].expectedGross: MONEY(USD) 형식 위반: "10400" (상세)',
    ])
  })

  it('★ 통화를 어디서도 못 찾으면 원화로 떨어지지 않고 던진다', () => {
    expect(() =>
      collect(TABLE, [{ label: '통화 없음', value: { principal: '10001', schedules: [] } }]),
    ).toThrow(/MONEY 경로 principal의 통화를 알 수 없다/)
  })
})

describe('시세 분류가 실제로 다른 형식이다', () => {
  it('금액·비율·시세가 서로 다른 자릿수로 나온다', async () => {
    const view = (await s.asA.getProduct(FX.productA))!

    // 같은 상품에서 셋이 동시에 관측된다 — 분류가 이름뿐이 아니라는 증거
    expect(view.product.principal).toMatch(/^-?\d+$/) // 금액: 정수
    expect(view.product.annualCouponRate).toMatch(/^\d+\.\d{4}$/) // 비율: 4자리
    expect(view.underlyings[0].basePrice).toMatch(/^\d+\.\d{6}$/) // 시세: 6자리
  })

  it('AS_OF 이후 시세를 고르지 않는다 — D6 상한', async () => {
    // 단독자산에는 2026-12-01(500) 행이 있다. 상한이 없으면 그것이 뽑힌다.
    const view = (await s.asA.getProduct(FX.productA))!
    expect(view.underlyings[0].priceAsOf).toBe('2026-06-29')
    expect(view.underlyings[0].ratio).toBe('0.9500')
    expect(AS_OF).toBe('2026-06-30')
  })
})
