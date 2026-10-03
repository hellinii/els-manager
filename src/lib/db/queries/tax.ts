import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import {
  moneyString,
  sumByCurrency,
  type ContributionBasis,
  type EstimateRates,
  type ExchangeRate,
  type ProductCurrency,
} from '@/lib/domain'
import {
  aggregateFinancialIncome,
  calculateFinancialIncomeTax,
  calculateHealthInsurance,
  marginalRateTable,
  type FinancialIncomeTaxResult,
  type HealthInsuranceType,
  type TaxBracket,
  type TaxConstants,
} from '@/lib/tax'

import { toTaxConstants } from '../taxConstants'
import { currentYear } from '../today'
import type { QueryContext } from './context'
import { incomeEventsOf, type IncomeEvent } from './income'
import {
  loadEstimateRates,
  loadProducts,
  loadTaxProfile,
  loadTaxYearContext,
  loadUsers,
  type ProductRow,
  type TaxYearContext,
} from './load'
import {
  amountString,
  bracketLabel,
  exchangeRateBasisOf,
  integrityIssueOf,
  ratioString,
  type ExchangeRateBasisView,
  type IntegrityIssue,
} from './map'

/** §4.6·§4.8 — 세금 요약·사용자별 현황 */

export type TaxOverride = {
  otherIncomeBase?: string
  otherFinancialIncome?: string
  healthInsuranceType?: HealthInsuranceType
}

export type TaxSummaryView = {
  year: number
  taxLawYear: number
  /** 시드된 세율 연도 전체(오름차순) — 연도 선택기의 하한(§4.6 v1.9) */
  seededYears: number[]
  profile: {
    otherIncomeBase: string
    otherFinancialIncome: string
    healthInsuranceType: HealthInsuranceType
    isSaved: boolean
  }
  income: {
    elsTaxableIncome: string
    /** v4.16 (구현 b4) — 확정 사건(상환 기록 · PAID 기록)의 과세 합. 환율과 무관하다 */
    confirmedElsTaxableIncome: string
    /** v4.16 (구현 b4) — F에 들어간 추정 사건의 과세 합. 둘의 합이 `elsTaxableIncome`이다(빠진 사건은 어느 쪽에도 없다) */
    estimatedElsTaxableIncome: string
    otherFinancialIncome: string
    total: string
    isComprehensive: boolean
    thresholdGap: string
    /**
     * 환율이 없어 F에서 빠진 달러 추정이 있는 상품 수 — E-09 (§4.6 v4.9). **상품 단위다**(v4.16 — 한 상품의 사건 여럿이
     * 빠져도 하나) — 확정 원화
     * 과세는 환율과 무관하게 늘 들어간다. `total`·`isComprehensive`·`tax`는 뺀 뒤의 F다
     */
    unconvertedCount: number
    /**
     * 추정 환율로 환산해 F에 넣은 달러 추정이 있는 상품 수 (§4.6 v4.9 — P8 컷 a3 · 상품 단위 — v4.16). 일반계좌 · 달러 이익 > 0 ·
     * 추정 환율 있음. 비과세와 이익 ≤ 0은 환율 없이 0이라 이쪽에도 `unconvertedCount`에도 들지 않는다
     */
    convertedCount: number
    /** 환산이 한 건이라도 있었을 때의 추정 환율 — `≠ null ⇔ convertedCount > 0`. 기여 행마다 두지 않는다 */
    exchangeRateBasis: ExchangeRateBasisView | null
    /**
     * v4.29 (구현 b4) — 그 해(본인)에 귀속되는 추정 월수익 사건이 하나라도 있다(빠진 사건 포함). §4.7 표 밖 표식과
     * 같은 이름 · 같은 정의 — SCR-401의 추정 안내 줄이 월지급 가정 문장을 잇는 조건이다
     */
    monthlyCouponAssumption: boolean
  }
  tax: {
    method1: string | null
    method2: string | null
    computedTax: string
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
    isEstimate: true
  }
  marginalRates: Array<{
    bracketLabel: string
    incomeTaxRate: string
    realMarginalRate: string
  }>
  contributingProducts: Array<{
    productId: string
    productName: string
    /** 그 상품의 통화. `taxableIncome`은 **늘 원화**다(과세 축) */
    currency: ProductCurrency
    /**
     * 원화. **`null` = 환율이 없어 뺐다**(E-09). 빠진 상품도 행에 남는다 — 행을 지우면
     * 「그 상품은 올해 과세되지 않는다」로 읽힌다
     */
    taxableIncome: string | null
    /** = `basis !== 'CONFIRMED'`(v4.16 — 유지한다) */
    isEstimated: boolean
    /** v4.16 (구현 b4) — 그 해 그 상품의 사건이 전부 확정 · 전부 추정 · 둘 다 */
    basis: ContributionBasis
    /** v4.16 (구현 b4) — 사건 종류별 내역. 금액은 원화(과세 축). 그 종류의 사건이 없으면 `null` */
    breakdown: {
      redemption: { taxableIncome: string | null; isEstimated: boolean } | null
      coupons: {
        confirmedCount: number
        confirmedTaxableIncome: string
        estimatedCount: number
        estimatedTaxableIncome: string | null
      } | null
    }
    /**
     * 이 상품의 추정분이 E-09로 빠졌다. 상환 시 일괄(컷 a2)에서는 한 상품의 기여가 한 건이라
     * `exchangeRateMissing ⇔ taxableIncome = null`이었다 — 월지급식(컷 b4)이 그 동치를 깬다: 추정 달러 사건이
     * **하나라도** 빠지면 참이고, `taxableIncome`은 사건이 **전부** 빠졌을 때만 `null`이다
     */
    exchangeRateMissing: boolean
    /**
     * 결함 표식 — 금액에 영향을 주지 않는다.
     *
     * `isEstimated`와 **직교**한다. 그쪽은 "증권사 확정값이 아니라 시스템 추정"을
     * 뜻한다 — 미상환이어도 기록된 월수익뿐이면 `false`일 수 있다(v4.16 — 사건마다 판정). §4.4처럼 한 값으로 좁히지 않는 이유는
     * `contributionOf`의 주석에 있다.
     */
    integrityIssue: IntegrityIssue | null
  }>
}

export type UserSummary = {
  userId: string
  displayName: string
  isMe: boolean
  activeCount: number
  /**
   * 통화별 보유중 원금 — 통화를 넘어 더하지 않는다 (§4.8 v4.9). `CURRENCY_ORDER` 순이고
   * 보유중 상품이 없으면 `[{ currency: 'KRW', activePrincipal: '0' }]`
   */
  activePrincipalByCurrency: Array<{ currency: ProductCurrency; activePrincipal: string }>
  currentYearFinancialIncome: string
  includesOtherFinancialIncome: boolean
  isComprehensive: boolean | null
}

/** 세율 구간 행 → 순수 모듈의 `TaxBracket`. 값은 이미 문자열이다(Q-08). */
export function toBrackets(ctx: TaxYearContext): TaxBracket[] {
  return ctx.brackets
    .map((row) => ({
      lowerBound: row.lower_bound,
      rate: row.rate,
      progressiveDeduction: row.progressive_deduction,
    }))
    .sort((a, b) => dec(a.lowerBound).cmp(dec(b.lowerBound)))
}

export function toConstants(ctx: TaxYearContext): TaxConstants {
  return toTaxConstants(ctx.constants, ctx.taxLawYear)
}

/**
 * 한 상품이 특정 연도에 기여하는 ELS 과세 금융소득.
 *
 * 귀속연도가 다르면 `null`이다 — 집계 키는 항상 `(owner_id, year)`이며
 * 사용자·연도를 넘어 합산하지 않는다(절대 규칙 #7).
 *
 * **미상환 상품은 추정이다.** 적용 차수(다음 도래 평가일, RD-02)의 예상 수령액에서
 * 원금을 뺀 값이며, 전 차수가 경과했으면 적용 차수가 없으므로 기여하지 않는다.
 *
 * **적용 차수를 여기서 고르지 않는다** — `./attribution`의 `attributionOf`가 낸다. 종전
 * 구현은 상환·일정 0건·전 차수 경과를 이 함수 안에서 각각 끊었고, 같은 규칙이
 * `queries/map.ts`에도 따로 있었다.
 *
 * **사건을 접는다** (P8 컷 b0 · 규칙은 b4) — 분기와 산식은 `./income`의 `incomeEventsOf`가 내고 이 함수는 그 해에
 * 귀속되는 사건을 **상품당 한 행**으로 접는다(DOC-007 §7.6 「사건을 접는 규칙」 · DOC-011 §4.6 「월지급 상품의 기여」):
 *
 * ```
 * amount      = Σ 들어간 사건의 과세                       null ⇔ 사건이 «전부» 빠졌다(E-09)
 * basis       = 전부 확정 CONFIRMED · 전부 추정 ESTIMATED · 둘 다 MIXED
 * exchangeRateMissing = 추정 달러 사건이 «하나라도» 빠졌다     a2의 동치(⇔ amount = null)가 깨진다
 * ```
 *
 * 소비자는 둘이다 — `computeOwnTax`(§4.6 · §4.1)와 `listUserSummaries`(§4.8)(설계 원자료 SB-4).
 */
export function contributionOf(
  row: ProductRow,
  year: number,
  asOf: string,
  /** 추정 환율 — 기본값이 없다. 원화 상품과 확정값은 이 인자를 보지 않는다 */
  rates: EstimateRates,
): {
  /**
   * 과세 금융소득 — **원화**(과세 축). 들어간 사건의 합이다. `null` = 그 해의 사건이 **전부** E-09로 빠졌다.
   * 0으로 흡수하지 않는다 — 소비자가 합에서 빼고 **센다**(DOC-011 §4.0 규칙 3).
   */
  amount: DecimalValue | null
  /**
   * 세전 실수령액 — 원금 반환분을 **포함한다**(`grossExpected`의 정의). 상품 통화다.
   *
   * DOC-007 §7.4의 `netProceeds`가 `Σ gross`를 요구하고 §7.5의 `cumulativeAssets`가
   * 「한 상품은 누적과 잔여 원금 중 정확히 하나에만 들어간다」를 그 포함 관계에
   * 의존해 성립시킨다 — 원금이 빠지면 상환된 상품의 원금이 화면에서 증발한다.
   */
  gross: DecimalValue
  /** = `basis !== 'CONFIRMED'`. 상환 시 지급 상품에서는 종전 값과 같다(사건이 하나다) */
  isEstimated: boolean
  basis: ContributionBasis
  /** DOC-011 §4.6 `breakdown` — 사건 종류별 내역. 그 해에 그 종류의 사건이 없으면 `null` */
  breakdown: {
    redemption: { taxableIncome: DecimalValue | null; isEstimated: boolean } | null
    coupons: {
      confirmedCount: number
      confirmedTaxableIncome: DecimalValue
      estimatedCount: number
      /** `null` = 달러 추정인데 추정 환율이 없다 — 환율은 요청당 하나라 함께 들어가거나 함께 빠진다 */
      estimatedTaxableIncome: DecimalValue | null
    } | null
  }
  /** 확정 사건의 과세 합 — `income.confirmedElsTaxableIncome`의 몫. 환율과 무관하다 */
  confirmedAmount: DecimalValue
  /** 들어간 추정 사건의 과세 합 — `income.estimatedElsTaxableIncome`의 몫. 빠진 사건은 없다 */
  estimatedAmount: DecimalValue
  /** 추정 달러 사건이 하나라도 빠졌다 — `amount = null ⇒ exchangeRateMissing`만 남는다 */
  exchangeRateMissing: boolean
  /**
   * 이 기여를 환산한 추정 환율 (P8 컷 a3). `null` = **곱하지 않았다** — 원화 · 확정값 · 비과세 · 달러
   * 이익 ≤ 0(환율 없이 안다), 또는 곱해야 하는데 환율이 없다(그쪽은 `exchangeRateMissing`).
   *
   * `exchangeRateMissing: false`만으로는 「환산함」과 「환율 없이 0」이 갈리지 않는다 — 그 둘을 가르는
   * 것이 이 필드이며 `convertedCount`(§4.1·§4.6)가 이것을 센다(환산한 사건이 하나라도 있는 상품).
   */
  estimateRate: ExchangeRate | null
  /**
   * 그 해에 추정 월수익 사건이 하나라도 있다 — 빠진 사건도 센다(가정은 그 사건에도 걸려 있다). `income` ·
   * `currentYearTax`의 `monthlyCouponAssumption`이 이것의 OR다(DOC-011 v4.29)
   */
  hasCouponEstimate: boolean
  /**
   * 결함 표식 — **금액에 영향을 주지 않는다.** 과세 기여는 계약 조건에서만
   * 나오고 결함이 파괴한 입력(기초자산·시세)을 쓰지 않으므로 금액은 유효하다.
   *
   * **§4.4처럼 `'UNDERLYING_MISSING'` 하나로 좁히면 안 된다.** "일정 0건이면
   * 적용 차수가 없어 기여하지 않는다"는 **아래 추정 분기에서만** 참이다. 상환
   * 분기가 일정 검사보다 먼저 반환하고, I-13 FK는 `MATCH SIMPLE`이라
   * `round_no IS NULL`인 만기 상환을 검사하지 않는다 — 즉 만기 상환 상품은
   * 일정 행이 전부 지워져도 `ON DELETE RESTRICT`에 걸리지 않고, 증권사 확정값으로
   * 기여하면서 `SCHEDULE_MISSING`이다. §4.4의 좁힘은 "행 단위가 차수"라는
   * 구조적 도달 불가에서 나왔고 여기는 행 단위가 상품이라 그 논거가 옮겨가지 않는다.
   */
  integrityIssue: IntegrityIssue | null
} | null {
  // 다른 해의 사건은 값을 계산하기 전에 걸렀다(`income.ts` — 거름의 단위는 사건이다, b4)
  const events = incomeEventsOf(row, asOf, rates, { year }).filter((event) => event.year === year)

  // 사건이 없으면(적용 차수 없음 · 계약 조건 없음 · 다른 해에 귀속) 기여하지 않는다 —
  // 집계 키는 `(owner_id, year)`다(절대 규칙 #7)
  if (events.length === 0) return null

  const entered = events.flatMap((event) => (event.taxableIncomeKrw == null ? [] : [event.taxableIncomeKrw]))
  const confirmed = events.filter((event) => !event.isEstimated)
  const estimated = events.filter((event) => event.isEstimated)
  const basis: ContributionBasis =
    estimated.length === 0 ? 'CONFIRMED' : confirmed.length === 0 ? 'ESTIMATED' : 'MIXED'

  return {
    amount: entered.length === 0 ? null : sumOf(entered),
    gross: sumOf(events.map((event) => event.gross)),
    isEstimated: basis !== 'CONFIRMED',
    basis,
    breakdown: breakdownOf(events),
    confirmedAmount: sumOf(confirmed.flatMap((event) => (event.taxableIncomeKrw == null ? [] : [event.taxableIncomeKrw]))),
    estimatedAmount: sumOf(estimated.flatMap((event) => (event.taxableIncomeKrw == null ? [] : [event.taxableIncomeKrw]))),
    exchangeRateMissing: estimated.some((event) => event.taxableIncomeKrw == null),
    estimateRate: events.find((event) => event.estimateRate != null)?.estimateRate ?? null,
    hasCouponEstimate: estimated.some((event) => event.kind === 'COUPON'),
    integrityIssue: integrityIssueOf(row),
  }
}

function sumOf(values: readonly DecimalValue[]): DecimalValue {
  return values.reduce((acc, value) => acc.plus(value), ZERO)
}

/** §4.6 `breakdown` — 상환은 그 해에 최대 하나다(I-01) */
function breakdownOf(events: readonly IncomeEvent[]): NonNullable<ReturnType<typeof contributionOf>>['breakdown'] {
  const redemption = events.find((event) => event.kind === 'REDEMPTION') ?? null
  const coupons = events.filter((event) => event.kind === 'COUPON')
  const confirmed = coupons.filter((event) => !event.isEstimated)
  const estimated = coupons.filter((event) => event.isEstimated)
  return {
    redemption:
      redemption == null
        ? null
        : { taxableIncome: redemption.taxableIncomeKrw, isEstimated: redemption.isEstimated },
    coupons:
      coupons.length === 0
        ? null
        : {
            confirmedCount: confirmed.length,
            // 기록값은 환율과 무관해 `null`이 없다
            confirmedTaxableIncome: sumOf(confirmed.map((event) => event.taxableIncomeKrw ?? ZERO)),
            estimatedCount: estimated.length,
            estimatedTaxableIncome: estimated.some((event) => event.taxableIncomeKrw == null)
              ? null
              : sumOf(estimated.map((event) => event.taxableIncomeKrw as DecimalValue)),
          },
  }
}

export type Contribution = NonNullable<ReturnType<typeof contributionOf>>

export type OwnTaxComputation = {
  elsTaxableIncome: DecimalValue
  otherFinancialIncome: DecimalValue
  financialIncome: DecimalValue
  result: FinancialIncomeTaxResult
  brackets: TaxBracket[]
  constants: TaxConstants
  taxLawYear: number
  /**
   * 환율이 없어 합에서 뺀 추정 사건이 있는 **상품** 수(E-09). `contributions` 중 `exchangeRateMissing`인 것의 수다 —
   * ~~`amount = null`인 것의 수~~(b4 — 일부만 빠진 월지급 상품도 센다. 빼는 단위는 사건, 세는 단위는 상품)
   */
  unconvertedCount: number
  /** 추정 환율로 환산해 합에 넣은 사건이 있는 **상품** 수. `contributions` 중 `estimateRate ≠ null`인 것의 수다 */
  convertedCount: number
  /** 확정 사건의 과세 합 — §4.6 `income.confirmedElsTaxableIncome` */
  confirmedElsTaxableIncome: DecimalValue
  /** 들어간 추정 사건의 과세 합 — §4.6 `income.estimatedElsTaxableIncome` */
  estimatedElsTaxableIncome: DecimalValue
  /** 그 해에 추정 월수익 사건이 하나라도 있다 — §4.1 · §4.6 `monthlyCouponAssumption` */
  monthlyCouponAssumption: boolean
  /**
   * 환산에 쓴 추정 환율 — `convertedCount > 0`일 때만 값이다. 요청당 통화별 하나이므로(§4.0 규칙 2)
   * 어느 기여에서 읽어도 같다
   */
  estimateRate: ExchangeRate | null
  /**
   * 합계에 실제로 들어간 기여. **§4.6이 이것을 그대로 쓴다.**
   *
   * 목록을 따로 만들면 합계와 목록이 서로 다른 순회에서 나와, 한쪽의 필터가
   * 바뀌는 순간 조용히 갈린다 — 실제로 v0.7이 그 상태였다(합계는 owner_id로
   * 거르고 목록은 거르지 않았다). 같은 배열에서 둘 다 나오게 한다.
   */
  contributions: Array<{ row: ProductRow; contribution: Contribution }>
}

/**
 * 본인 기준 금융소득·세액. §4.1 `currentYearTax`와 §4.6이 공유한다.
 *
 * 두 계약이 각자 계산하면 같은 화면의 두 숫자가 갈릴 수 있다 — 특히 세율 연도
 * 근사(D7)가 한쪽에만 적용되면 홈 화면과 세금 화면이 다른 법으로 계산된다.
 */
export function computeOwnTax(params: {
  products: readonly ProductRow[]
  ownerId: string
  year: number
  asOf: string
  yearContext: TaxYearContext
  otherFinancialIncome: DecimalValue
  otherIncomeBase: DecimalValue
  rates: EstimateRates
}): OwnTaxComputation {
  const brackets = toBrackets(params.yearContext)
  const constants = toConstants(params.yearContext)

  const items = params.products
    .filter((row) => row.owner_id === params.ownerId)
    .map((row) => ({
      row,
      contribution: contributionOf(row, params.year, params.asOf, params.rates),
    }))
    .filter(
      (entry): entry is { row: ProductRow; contribution: Contribution } =>
        entry.contribution != null,
    )

  // E-09는 **사건 단위**로 뺀다 — 빠진 사건은 행(`contributions`)에는 남고 합에서만 빠진다(그 상품의 `amount`가
  // 이미 들어간 사건만의 합이다 — `contributionOf`). 사건이 전부 빠진 상품은 `amount = null`이라 여기서 빠진다
  const converted = items.flatMap((entry) =>
    entry.contribution.amount == null ? [] : [entry.contribution.amount],
  )

  // 환산해 넣은 건 — 위 `converted`(합에 든 금액 전부, 원화 · 확정 포함)와 다르다
  const rated = items.flatMap((entry) =>
    entry.contribution.estimateRate == null ? [] : [entry.contribution.estimateRate],
  )

  const aggregated = aggregateFinancialIncome({
    key: { ownerId: params.ownerId, year: params.year },
    items: converted.map((amount) => ({
      ownerId: params.ownerId,
      year: params.year,
      taxableIncome: amount,
    })),
    otherFinancialIncome: params.otherFinancialIncome,
  })

  const elsTaxableIncome = aggregated.financialIncome.minus(
    params.otherFinancialIncome,
  )

  const result = calculateFinancialIncomeTax({
    financialIncome: aggregated.financialIncome,
    otherIncomeBase: params.otherIncomeBase,
    brackets,
    constants,
  })

  return {
    elsTaxableIncome,
    otherFinancialIncome: params.otherFinancialIncome,
    financialIncome: aggregated.financialIncome,
    result,
    brackets,
    constants,
    taxLawYear: params.yearContext.taxLawYear,
    unconvertedCount: items.filter((entry) => entry.contribution.exchangeRateMissing).length,
    convertedCount: rated.length,
    confirmedElsTaxableIncome: items.reduce((acc, entry) => acc.plus(entry.contribution.confirmedAmount), ZERO),
    estimatedElsTaxableIncome: items.reduce((acc, entry) => acc.plus(entry.contribution.estimatedAmount), ZERO),
    monthlyCouponAssumption: items.some((entry) => entry.contribution.hasCouponEstimate),
    estimateRate: rated[0] ?? null,
    contributions: items,
  }
}

/** §4.6 `breakdown` — 원화 정수 문자열(과세 축 — `amountString`, Q-07). `null`은 그대로 나른다 */
function breakdownView(breakdown: Contribution['breakdown']): TaxSummaryView['contributingProducts'][number]['breakdown'] {
  const money = (value: DecimalValue | null) => (value == null ? null : amountString(value))
  return {
    redemption:
      breakdown.redemption == null
        ? null
        : { taxableIncome: money(breakdown.redemption.taxableIncome), isEstimated: breakdown.redemption.isEstimated },
    coupons:
      breakdown.coupons == null
        ? null
        : {
            confirmedCount: breakdown.coupons.confirmedCount,
            confirmedTaxableIncome: amountString(breakdown.coupons.confirmedTaxableIncome),
            estimatedCount: breakdown.coupons.estimatedCount,
            estimatedTaxableIncome: money(breakdown.coupons.estimatedTaxableIncome),
          },
  }
}

/** §4.8 — 보유중 원금만 담으므로 §4.1 `byCurrency`와 달리 상환 완료를 세지 않는다 */
function activePrincipalByCurrency(
  active: readonly ProductRow[],
): UserSummary['activePrincipalByCurrency'] {
  const sums = sumByCurrency(
    active.map((row) => ({ currency: row.currency, amount: row.principal })),
  )
  if (sums.length === 0) return [{ currency: 'KRW', activePrincipal: '0' }]
  return sums.map((entry) => ({
    currency: entry.currency,
    activePrincipal: moneyString(entry.amount, entry.currency),
  }))
}

export function makeTaxQueries(ctx: QueryContext) {
  /**
   * §4.6 — **본인 전용이다.**
   *
   * `tax_profiles`의 조회 정책이 본인 한정이므로, 타인의 `ownerId`로 부르면
   * `other_financial_income`을 **`0`으로 읽고 계산을 끝낸다** — 오류 없이 실제보다
   * 낮은 금융소득과 틀린 종합과세 판정을 반환한다. 그러므로 호출 자체를 거부한다.
   * `ownerId`를 인자로 남기는 것은 호출부의 의도를 드러내 이 단언이 걸리게 하기
   * 위함이다(§4.6).
   */
  async function getTaxSummary(params: {
    ownerId: string
    year: number
    override?: TaxOverride
  }): Promise<TaxSummaryView> {
    if (params.ownerId !== ctx.viewerId) {
      throw new Error(
        `getTaxSummary는 본인 전용이다 (요청 ${params.ownerId}, 조회자 ${ctx.viewerId}). ` +
          'tax_profiles의 조회가 본인 한정이므로 타인의 금융소득은 조용히 과소 산출된다 — ' +
          '타인 현황은 listUserSummaries를 쓴다(DOC-011 §4.6·§4.8).',
      )
    }

    // 넷 다 `ctx`에만 의존한다 — 한 물결이다(왕복 3 → 4, 추정 환율이 나란히 — §4.0 규칙 2)
    const [yearContext, profileRow, products, rates] = await Promise.all([
      loadTaxYearContext(ctx, params.year),
      loadTaxProfile(ctx, ctx.viewerId, params.year),
      loadProducts(ctx, { ownerId: ctx.viewerId }),
      loadEstimateRates(ctx),
    ])

    /**
     * 프로필 폴백 — §4.6.
     *
     * 행이 없으면 `'NONE'` + `'0'`. `isSaved`는 **"저장된 프로필이 없거나
     * override 적용 중"**을 뜻한다. `'NONE'`이 건강보험료를 0으로 만들므로
     * 화면은 이 상태를 계산 결과가 아니라 **미입력**으로 표시해야 한다.
     */
    const stored = {
      otherIncomeBase: profileRow?.other_income_base ?? '0',
      otherFinancialIncome: profileRow?.other_financial_income ?? '0',
      healthInsuranceType: profileRow?.health_insurance_type ?? 'NONE',
    }
    const effective = {
      otherIncomeBase: params.override?.otherIncomeBase ?? stored.otherIncomeBase,
      otherFinancialIncome:
        params.override?.otherFinancialIncome ?? stored.otherFinancialIncome,
      healthInsuranceType:
        params.override?.healthInsuranceType ?? stored.healthInsuranceType,
    }
    const isSaved = profileRow != null && params.override == null

    const own = computeOwnTax({
      products,
      ownerId: ctx.viewerId,
      year: params.year,
      asOf: ctx.asOf,
      yearContext,
      otherFinancialIncome: dec(effective.otherFinancialIncome),
      otherIncomeBase: dec(effective.otherIncomeBase),
      rates,
    })

    const health = calculateHealthInsurance({
      financialIncome: own.financialIncome,
      subscriberType: effective.healthInsuranceType,
      constants: own.constants,
    })

    const threshold = dec(own.constants.comprehensiveTaxationThreshold)

    return {
      year: params.year,
      taxLawYear: own.taxLawYear,
      // 화면의 연도 선택기가 쓴다 — 하한이 여기밖에 없다(§4.6 v1.9). 왕복은 늘지
      // 않는다: `loadTaxYearContext`가 이미 `tax_years` 전체를 읽어 근사를 판정한다.
      seededYears: yearContext.seededYears,
      profile: {
        otherIncomeBase: amountString(dec(effective.otherIncomeBase)),
        otherFinancialIncome: amountString(dec(effective.otherFinancialIncome)),
        healthInsuranceType: effective.healthInsuranceType,
        isSaved,
      },
      income: {
        elsTaxableIncome: amountString(own.elsTaxableIncome),
        confirmedElsTaxableIncome: amountString(own.confirmedElsTaxableIncome),
        estimatedElsTaxableIncome: amountString(own.estimatedElsTaxableIncome),
        otherFinancialIncome: amountString(own.otherFinancialIncome),
        total: amountString(own.financialIncome),
        isComprehensive: own.result.isComprehensive,
        // 초과분 또는 여유분. 부호로 두 뜻을 구분하지 않고 절대값을 담는다 —
        // isComprehensive가 어느 쪽인지 이미 말한다.
        thresholdGap: amountString(own.financialIncome.minus(threshold).abs()),
        unconvertedCount: own.unconvertedCount,
        convertedCount: own.convertedCount,
        exchangeRateBasis: exchangeRateBasisOf(own.estimateRate, ctx.asOf),
        monthlyCouponAssumption: own.monthlyCouponAssumption,
      },
      tax: {
        method1: own.result.method1 == null ? null : amountString(own.result.method1),
        method2: own.result.method2 == null ? null : amountString(own.result.method2),
        computedTax: amountString(own.result.computedTax),
        localTax: amountString(own.result.localIncomeTax),
        totalTax: amountString(own.result.totalTax),
        withheld: amountString(own.result.withheld),
        additionalPayment: amountString(own.result.additionalPayment),
        effectiveRate: ratioString(own.result.effectiveRate),
      },
      healthInsurance: {
        assessmentBase: amountString(health.assessmentBase),
        healthPremium: amountString(health.healthPremium),
        longTermCarePremium: amountString(health.longTermCarePremium),
        total: amountString(health.total),
        isEstimate: true,
      },
      marginalRates: marginalRateTable(own.brackets, own.constants).map(
        (bracketRow, index, all) => ({
          // `tax_brackets`에는 하한만 있으므로 다음 구간의 하한으로 합성한다(§4.6)
          bracketLabel: bracketLabel({
            lowerBound: bracketRow.lowerBound,
            nextLowerBound: all[index + 1]?.lowerBound ?? null,
          }),
          incomeTaxRate: ratioString(bracketRow.incomeTaxRate),
          realMarginalRate: ratioString(bracketRow.realMarginalRate),
        }),
      ),
      // 합계(`income.total`)와 **같은 배열**에서 나온다. 따로 순회하면 한쪽의
      // 필터가 바뀔 때 두 값이 조용히 갈린다.
      contributingProducts: own.contributions.map((entry) => ({
        productId: entry.row.id,
        productName: entry.row.name,
        currency: entry.row.currency,
        taxableIncome:
          entry.contribution.amount == null ? null : amountString(entry.contribution.amount),
        isEstimated: entry.contribution.isEstimated,
        basis: entry.contribution.basis,
        breakdown: breakdownView(entry.contribution.breakdown),
        exchangeRateMissing: entry.contribution.exchangeRateMissing,
        // 금액은 바꾸지 않고 표식만 붙인다. 표식이 없으면 SCR-202에서 "수정 필요"로
        // 표시되는 같은 상품이 SCR-401에는 숫자로만 나타나 모순으로 읽힌다.
        integrityIssue: entry.contribution.integrityIssue,
      })),
    }
  }

  /**
   * §4.8 — **타인 행은 ELS 과세소득만 담는다.**
   *
   * `tax_profiles`의 조회가 본인 한정이므로 타인의 `F`를 완전하게 산출할 방법이
   * 없다. 값을 줄이는 것으로 끝내면 화면은 그것이 완전한 금융소득인 줄 알고
   * 렌더링하므로, `includesOtherFinancialIncome`으로 불완전함을 타입에 드러내고
   * 판정 불가를 `null`로 표현한다.
   *
   * **합계 행을 제공하지 않는다** — 종합과세는 개인 단위다(절대 규칙 #7).
   */
  async function listUserSummaries(): Promise<UserSummary[]> {
    // AQ-27 — 귀속연도 파생은 `currentYear()` 하나다. 여기 있던 문자열 자르기는
    // 같은 일을 두 번째로 적은 것이었고, 그쪽에는 형식 검사가 없었다(`asOf`가
    // 깨지면 `NaN`이 되어 세율 조회가 엉뚱한 오류를 낸다). Q-02가 "요청당 한 번"을
    // 구조로 만든 것과 같은 이유로 파생 규칙도 한 곳에만 둔다.
    const year = currentYear(ctx.asOf)

    // 다섯 다 ctx.asOf·ctx.viewerId만으로 출발하고 서로 의존하지 않는다 —
    // **한 물결**이다. 대기는 1파이고 왕복은 5다(추정 환율이 나란히 — §4.0 규칙 2, 4 → 5).
    const [users, products, yearContext, ownProfile, rates] = await Promise.all([
      loadUsers(ctx),
      loadProducts(ctx),
      loadTaxYearContext(ctx, year),
      // 본인 프로필만 읽힌다. 타인 것은 0행이 오며 그것이 이 계약의 전제다(D3) —
      // 사용자 목록에 임베드할 수 없어 별도 요청이며 그것이 4번째 왕복의 정체다.
      loadTaxProfile(ctx, ctx.viewerId, year),
      loadEstimateRates(ctx),
    ])

    const brackets = toBrackets(yearContext)
    const constants = toConstants(yearContext)

    return users.map((user) => {
      const isMe = user.id === ctx.viewerId
      const owned = products.filter((row) => row.owner_id === user.id)
      const active = owned.filter((row) => row.redemptions == null)

      // §4.6과 같은 E-09 — 환율이 없는 달러 추정 건은 빠진다. 표식은 두지 않는다(§4.8 v4.9 —
      // 화면이 없고, 두게 되면 `includesOtherFinancialIncome`에 접지 않는 별도 필드다)
      const elsIncome = owned.reduce<DecimalValue>((acc, row) => {
        // §4.6과 같은 추정 환율 — 같은 요청의 `getTaxSummary`·`getForecast`와 F가 같다(항등)
        const c = contributionOf(row, year, ctx.asOf, rates)
        return c?.amount == null ? acc : acc.plus(c.amount)
      }, ZERO)

      const other =
        isMe && ownProfile != null
          ? dec(ownProfile.other_financial_income)
          : ZERO

      const financialIncome = elsIncome.plus(other)

      return {
        userId: user.id,
        displayName: user.display_name,
        isMe,
        activeCount: active.length,
        activePrincipalByCurrency: activePrincipalByCurrency(active),
        currentYearFinancialIncome: amountString(financialIncome),
        includesOtherFinancialIncome: isMe,
        // 타인은 판정 불가 — 읽지 못한 값을 0으로 두고 판정하면 그럴싸한 오답이 된다
        isComprehensive: isMe
          ? calculateFinancialIncomeTax({
              financialIncome,
              otherIncomeBase: ownProfile?.other_income_base ?? '0',
              brackets,
              constants,
            }).isComprehensive
          : null,
      }
    })
  }

  return { getTaxSummary, listUserSummaries }
}
