import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FX, ITG_USER_A } from './helpers/fixtures'
import {
  closeSeedConnection,
  resetFixtures,
  seedAsset,
  seedPrice,
  seedProduct,
  seedRedemption,
  seedSchedule,
  seedTaxProfile,
  seedUnderlying,
} from './helpers/seed'
import { AS_OF, YEAR, setupScenario, type Scenario } from './helpers/scenario'
import { collect, type Coverage, type Spec } from './helpers/formats'

/**
 * Q-07 형식 적합성 — 9계약 전 필드 (DOC-011 §4.0)
 *
 * **이 파일이 따로 있는 이유가 둘이다.**
 *
 * ① 커버리지 단언(②③)은 9계약을 **누적한 뒤** 판정한다. `contracts.test.ts`의
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
const KI_OBSERVATIONS = ['CONTINUOUS', 'CLOSING'] as const

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
  'totals.activePrincipal': 'AMOUNT',
  'totals.activeCount': 'NUMBER',
  'totals.realizedPnl': 'AMOUNT',
  'currentYearTax.year': 'NUMBER',
  'currentYearTax.financialIncome': 'AMOUNT',
  'currentYearTax.isComprehensive': 'BOOL',
  'currentYearTax.additionalTax': 'AMOUNT',
  'attentionItems[].productId': 'UUID',
  'attentionItems[].productName': 'TEXT',
  // v2.0 — 같은 뷰의 `upcomingEvaluations[].ownerName`과 **같은 분류여야 한다.**
  // 갈리면 한 뷰가 소유자 이름을 두 형식으로 직렬화한다는 뜻이다.
  'attentionItems[].ownerName': 'TEXT',
  'attentionItems[].reason': ATTENTION_REASONS,
  // ⑤ 최근 상환 실적 (v2.0). `realizedPnl`은 **음수 가능**이므로 `AMOUNT` 분류가
  // 부호를 허용해야 한다 — §4.3의 `redemption.realizedPnl`과 같은 자리다.
  'recentRedemptions[].productId': 'UUID',
  'recentRedemptions[].productName': 'TEXT',
  'recentRedemptions[].ownerName': 'TEXT',
  'recentRedemptions[].redemptionType': REDEMPTION_TYPES,
  'recentRedemptions[].redemptionDate': 'DATE',
  'recentRedemptions[].grossAmount': 'AMOUNT',
  'recentRedemptions[].realizedPnl': 'AMOUNT',
  'recentRedemptions[].isConfirmed': 'BOOL',
}

/** §4.2 상품 목록 */
const PRODUCT_LIST: Record<string, Spec> = {
  id: 'UUID',
  name: 'TEXT',
  ownerId: 'UUID',
  ownerName: 'TEXT',
  principal: 'AMOUNT',
  accountType: ACCOUNT_TYPES,
  status: STATUSES,
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
  'product.principal': 'AMOUNT',
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
  'schedules[].expectedGross': 'AMOUNT',
  'schedules[].conditionResult': CONDITION_RESULTS,
  'schedules[].isPast': 'BOOL',
  projection: 'NULL_OBJECT',
  'projection.appliedRoundNo': 'NUMBER',
  'projection.expectedGross': 'AMOUNT',
  'projection.expectedTaxableIncome': 'AMOUNT',
  'projection.attributionYear': 'NUMBER',
  redemption: 'NULL_OBJECT',
  'redemption.id': 'UUID',
  'redemption.redemptionType': REDEMPTION_TYPES,
  'redemption.roundNo': 'NUMBER',
  'redemption.redemptionDate': 'DATE',
  'redemption.grossAmount': 'AMOUNT',
  'redemption.taxableIncome': 'AMOUNT',
  'redemption.withholdingTax': 'AMOUNT',
  'redemption.isConfirmed': 'BOOL',
  'redemption.realizedPnl': 'AMOUNT',
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
}

/** §4.6 세금 */
const TAX_SUMMARY: Record<string, Spec> = {
  year: 'NUMBER',
  taxLawYear: 'NUMBER',
  // v1.9 — 연도 선택기의 하한. 배열이므로 잎은 `seededYears[]`로 접힌다.
  'seededYears[]': 'NUMBER',
  'profile.otherIncomeBase': 'AMOUNT',
  'profile.otherFinancialIncome': 'AMOUNT',
  'profile.healthInsuranceType': HEALTH_TYPES,
  'profile.isSaved': 'BOOL',
  'income.elsTaxableIncome': 'AMOUNT',
  'income.otherFinancialIncome': 'AMOUNT',
  'income.total': 'AMOUNT',
  'income.isComprehensive': 'BOOL',
  'income.thresholdGap': 'AMOUNT',
  'tax.method1': 'AMOUNT',
  'tax.method2': 'AMOUNT',
  'tax.computedTax': 'AMOUNT',
  'tax.localTax': 'AMOUNT',
  'tax.totalTax': 'AMOUNT',
  'tax.withheld': 'AMOUNT',
  'tax.additionalPayment': 'AMOUNT',
  'tax.effectiveRate': 'RATIO',
  'healthInsurance.assessmentBase': 'AMOUNT',
  'healthInsurance.healthPremium': 'AMOUNT',
  'healthInsurance.longTermCarePremium': 'AMOUNT',
  'healthInsurance.total': 'AMOUNT',
  'healthInsurance.isEstimate': 'BOOL',
  'marginalRates[].bracketLabel': 'TEXT',
  'marginalRates[].incomeTaxRate': 'RATIO',
  'marginalRates[].realMarginalRate': 'RATIO',
  'contributingProducts[].productId': 'UUID',
  'contributingProducts[].productName': 'TEXT',
  'contributingProducts[].taxableIncome': 'AMOUNT',
  'contributingProducts[].isEstimated': 'BOOL',
  'contributingProducts[].integrityIssue': INTEGRITY_ISSUES,
}

/**
 * §4.7 다년도 전망 — **행 하나가 열두 열이다** (P4b 컷 7)
 *
 * `thresholdGap`이 §4.6의 같은 이름과 **다른 값**임을 여기 적어 둔다: 그쪽은 절대값이고
 * 이쪽은 부호를 남긴다(「양수면 초과」). 분류는 둘 다 `AMOUNT`이므로 형식 축에서는
 * 갈리지 않는다 — `tests/db/forecast.test.ts`가 부호를 본다.
 */
const FORECAST_ROW: Record<string, Spec> = {
  year: 'NUMBER',
  taxLawYear: 'NUMBER',
  // `null`이면 미입력. 아래 픽스처가 **이월** 상태(`< year`)를 만들어 비-null을 관측시킨다.
  profileYear: 'NUMBER',
  grossProceeds: 'AMOUNT',
  financialIncome: 'AMOUNT',
  thresholdGap: 'AMOUNT',
  isComprehensive: 'BOOL',
  effectiveRate: 'RATIO',
  additionalTax: 'AMOUNT',
  totalInsurance: 'AMOUNT',
  netProceeds: 'AMOUNT',
  cumulativeNet: 'AMOUNT',
  remainingPrincipal: 'AMOUNT',
  cumulativeAssets: 'AMOUNT',
  hasEstimates: 'BOOL',
}

/** §4.8 사용자별 현황 */
const USER_SUMMARY: Record<string, Spec> = {
  userId: 'UUID',
  displayName: 'TEXT',
  isMe: 'BOOL',
  activeCount: 'NUMBER',
  activePrincipal: 'AMOUNT',
  currentYearFinancialIncome: 'AMOUNT',
  includesOtherFinancialIncome: 'BOOL',
  isComprehensive: 'BOOL',
}

/** §4.9 자산 검색 */
const ASSET_OPTION: Record<string, Spec> = {
  id: 'UUID',
  name: 'TEXT',
  market: 'TEXT',
  currency: 'TEXT',
  hasPriceProvider: 'BOOL',
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

  coverages.push(
    {
      contract: '§4.1 getDashboard',
      coverage: collect(DASHBOARD, [
        { label: 'ALL', value: dashboardAll },
        { label: 'MINE', value: dashboardMine },
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
      ]),
    },
    {
      contract: '§4.7 getForecast',
      coverage: collect(FORECAST_ROW, rows('getForecast', forecast)),
    },
    {
      contract: '§4.8 listUserSummaries',
      coverage: collect(USER_SUMMARY, rows('listUserSummaries', users)),
    },
    {
      contract: '§4.9 searchAssets',
      coverage: collect(ASSET_OPTION, rows('searchAssets', assets)),
    },
  )
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('Q-07 형식 적합성 — 9계약 전 필드', () => {
  it('계약 9개를 모두 수집했다', () => {
    expect(coverages.map((c) => c.contract)).toHaveLength(9)
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

  it('③ 모든 경로가 비-null로 한 번 이상 관측된다 — null로만 오면 형식이 검증된 적 없다', () => {
    const neverNonNull = coverages.flatMap((c) =>
      c.coverage.neverNonNull.map((p) => `${c.contract} ${p}`),
    )
    expect(neverNonNull).toEqual([])
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
