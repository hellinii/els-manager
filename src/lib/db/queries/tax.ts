import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import {
  attributionYear,
  grossExpected,
  nextEvaluation,
  taxableIncome,
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
import type { QueryContext } from './context'
import {
  loadProducts,
  loadTaxProfile,
  loadTaxYearContext,
  loadUsers,
  type ProductRow,
  type TaxYearContext,
} from './load'
import { amountString, bracketLabel, ratioString } from './map'

/** §4.6·§4.8 — 세금 요약·사용자별 현황 */

export type TaxOverride = {
  otherIncomeBase?: string
  otherFinancialIncome?: string
  healthInsuranceType?: HealthInsuranceType
}

export type TaxSummaryView = {
  year: number
  taxLawYear: number
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
 */
export function contributionOf(
  row: ProductRow,
  year: number,
  asOf: string,
): { amount: DecimalValue; isEstimated: boolean } | null {
  // 상환 완료 — 증권사 확정값을 쓴다(A-04). 시스템 추정으로 대체하지 않는다.
  if (row.redemptions != null) {
    const attributed = attributionYear({
      redemptionDate: row.redemptions.redemption_date,
    })
    if (attributed !== year) return null

    return {
      amount: taxableIncome({
        accountType: row.account_type,
        principal: row.principal,
        redemption: { taxableIncome: row.redemptions.taxable_income },
      }),
      isEstimated: false,
    }
  }

  // 무결성 결함 상품은 기여를 산출하지 않는다 — 일정이 0건이면 적용 차수가 없다
  if (row.redemption_schedules.length === 0) return null

  const next = nextEvaluation({
    schedules: row.redemption_schedules.map((s) => ({
      roundNo: s.round_no,
      evaluationDate: s.evaluation_date,
    })),
    asOf,
  })
  // 전 차수 경과 미상환 — DOC-007 §9.2가 적용 차수를 결정할 수 없다고 규정한다
  if (next == null) return null

  const attributed = attributionYear({ evaluationDate: next.evaluationDate })
  if (attributed !== year) return null

  const gross = grossExpected({
    principal: row.principal,
    couponRate: row.annual_coupon_rate,
    evaluationPeriodMonths: row.evaluation_period_months,
    roundNo: next.roundNo,
  })

  return {
    amount: taxableIncome({
      accountType: row.account_type,
      principal: row.principal,
      redemption: null,
      expectedGross: gross,
    }),
    isEstimated: true,
  }
}

export type OwnTaxComputation = {
  elsTaxableIncome: DecimalValue
  otherFinancialIncome: DecimalValue
  financialIncome: DecimalValue
  result: FinancialIncomeTaxResult
  brackets: TaxBracket[]
  constants: TaxConstants
  taxLawYear: number
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
      (entry): entry is { row: ProductRow; contribution: NonNullable<typeof entry.contribution> } =>
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

    const contributions = products
      .map((row) => ({ row, c: contributionOf(row, params.year, ctx.asOf) }))
      .filter((e) => e.c != null)

    return {
      year: params.year,
      taxLawYear: own.taxLawYear,
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
      contributingProducts: contributions.map((entry) => ({
        productId: entry.row.id,
        productName: entry.row.name,
        taxableIncome: amountString(entry.c!.amount),
        isEstimated: entry.c!.isEstimated,
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
    const year = Number.parseInt(ctx.asOf.slice(0, 4), 10)

    const [users, products, yearContext] = await Promise.all([
      loadUsers(ctx),
      loadProducts(ctx),
      loadTaxYearContext(ctx, year),
    ])
    // 본인 프로필만 읽힌다. 타인 것은 0행이 오며 그것이 이 계약의 전제다.
    const ownProfile = await loadTaxProfile(ctx, ctx.viewerId, year)

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
