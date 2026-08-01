import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import { grossExpected, taxableIncome } from '@/lib/domain'
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
import { attributionOf } from './attribution'
import type { QueryContext } from './context'
import {
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
  integrityIssueOf,
  ratioString,
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
    otherFinancialIncome: string
    total: string
    isComprehensive: boolean
    thresholdGap: string
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
    taxableIncome: string
    isEstimated: boolean
    /**
     * 결함 표식 — 금액에 영향을 주지 않는다.
     *
     * `isEstimated`와 **직교**한다. 그쪽은 "증권사 확정값이 아니라 시스템 추정"을
     * 뜻하고 미상환이면 전부 `true`다. §4.4처럼 한 값으로 좁히지 않는 이유는
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
  activePrincipal: string
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
 */
export function contributionOf(
  row: ProductRow,
  year: number,
  asOf: string,
): {
  amount: DecimalValue
  /**
   * 세전 실수령액 — 원금 반환분을 **포함한다**(`grossExpected`의 정의).
   *
   * DOC-007 §7.4의 `netProceeds`가 `Σ gross`를 요구하고 §7.5의 `cumulativeAssets`가
   * 「한 상품은 누적과 잔여 원금 중 정확히 하나에만 들어간다」를 그 포함 관계에
   * 의존해 성립시킨다 — 원금이 빠지면 상환된 상품의 원금이 화면에서 증발한다.
   */
  gross: DecimalValue
  isEstimated: boolean
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
  const integrityIssue = integrityIssueOf(row)
  const attribution = attributionOf(row, asOf)

  // 적용 차수를 정할 수 없으면 어느 연도에도 기여하지 않는다 — E-07(전 차수 경과)과
  // 일정 0건이 그 하나로 묶인다(`attribution.ts`의 각주).
  if (attribution.kind === 'NO_ROUND') return null
  if (attribution.year !== year) return null

  // 상환 완료 — 증권사 확정값을 쓴다(A-04). 시스템 추정으로 대체하지 않는다.
  if (attribution.kind === 'REDEEMED') {
    return {
      amount: taxableIncome({
        accountType: row.account_type,
        principal: row.principal,
        redemption: { taxableIncome: attribution.redemption.taxable_income },
      }),
      gross: dec(attribution.redemption.gross_amount),
      isEstimated: false,
      integrityIssue,
    }
  }

  // 계약 조건이 없으면 추정할 수 없다 — 기실현 등재는 연쿠폰율이 없다(D-07).
  // **`NO_ROUND`와 같은 답을 준다**(기여하지 않는다): 「추정할 수 없다」와
  // 「기여가 0이다」를 같은 값으로 내면 그 상품의 원금이 §7.5에서 증발한다.
  // 그 상품은 항상 상환 완료이므로 위 분기가 먼저 반환한다 — 여기 오는 유일한
  // 길은 계약 밖에서 차수를 넣은 경우다(AQ-14·AQ-65).
  if (row.annual_coupon_rate == null) return null

  const gross = grossExpected({
    principal: row.principal,
    couponRate: row.annual_coupon_rate,
    evaluationPeriodMonths: row.evaluation_period_months,
    roundNo: attribution.round.round_no,
  })

  return {
    amount: taxableIncome({
      accountType: row.account_type,
      principal: row.principal,
      redemption: null,
      expectedGross: gross,
    }),
    gross,
    isEstimated: true,
    integrityIssue,
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
}): OwnTaxComputation {
  const brackets = toBrackets(params.yearContext)
  const constants = toConstants(params.yearContext)

  const items = params.products
    .filter((row) => row.owner_id === params.ownerId)
    .map((row) => ({ row, contribution: contributionOf(row, params.year, params.asOf) }))
    .filter(
      (entry): entry is { row: ProductRow; contribution: Contribution } =>
        entry.contribution != null,
    )

  const aggregated = aggregateFinancialIncome({
    key: { ownerId: params.ownerId, year: params.year },
    items: items.map((entry) => ({
      ownerId: params.ownerId,
      year: params.year,
      taxableIncome: entry.contribution.amount,
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
    contributions: items,
  }
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

    const [yearContext, profileRow, products] = await Promise.all([
      loadTaxYearContext(ctx, params.year),
      loadTaxProfile(ctx, ctx.viewerId, params.year),
      loadProducts(ctx, { ownerId: ctx.viewerId }),
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
        otherFinancialIncome: amountString(own.otherFinancialIncome),
        total: amountString(own.financialIncome),
        isComprehensive: own.result.isComprehensive,
        // 초과분 또는 여유분. 부호로 두 뜻을 구분하지 않고 절대값을 담는다 —
        // isComprehensive가 어느 쪽인지 이미 말한다.
        thresholdGap: amountString(own.financialIncome.minus(threshold).abs()),
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
        taxableIncome: amountString(entry.contribution.amount),
        isEstimated: entry.contribution.isEstimated,
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

    // 넷 다 ctx.asOf·ctx.viewerId만으로 출발하고 서로 의존하지 않는다 —
    // **한 물결**이다. 왕복은 4로 같고(§4.0 예산 불변) 대기만 2파 → 1파로 준다.
    const [users, products, yearContext, ownProfile] = await Promise.all([
      loadUsers(ctx),
      loadProducts(ctx),
      loadTaxYearContext(ctx, year),
      // 본인 프로필만 읽힌다. 타인 것은 0행이 오며 그것이 이 계약의 전제다(D3) —
      // 사용자 목록에 임베드할 수 없어 별도 요청이며 그것이 4번째 왕복의 정체다.
      loadTaxProfile(ctx, ctx.viewerId, year),
    ])

    const brackets = toBrackets(yearContext)
    const constants = toConstants(yearContext)

    return users.map((user) => {
      const isMe = user.id === ctx.viewerId
      const owned = products.filter((row) => row.owner_id === user.id)
      const active = owned.filter((row) => row.redemptions == null)

      const elsIncome = owned.reduce<DecimalValue>((acc, row) => {
        const c = contributionOf(row, year, ctx.asOf)
        return c == null ? acc : acc.plus(c.amount)
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
        activePrincipal: amountString(
          active.reduce<DecimalValue>((acc, row) => acc.plus(dec(row.principal)), ZERO),
        ),
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
