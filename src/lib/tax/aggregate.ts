import { dec, sum, ZERO, type DecimalInput, type DecimalValue } from '@/lib/decimal'

/**
 * 연도별 집계 — DOC-007 §7
 *
 * **집계 키는 항상 (소유자, 귀속연도)다.** 사용자 간 합산은 어떤 경우에도
 * 수행하지 않는다(D-02, CLAUDE.md 절대 규칙 #7). 이 모듈은 이미 소유자·연도로
 * 필터링된 항목만 받으며, 필터링 책임은 호출부에 있다.
 */

/**
 * `F(owner, year)` — 해당 소유자·연도의 과세 금융소득 총액.
 *
 * ```
 * F = Σ taxableIncome(els) + tax_profiles.other_financial_income
 * ```
 *
 * 각 항목의 `taxableIncome`은 이미 계좌유형·손실 규칙이 적용된 값이다
 * (`lib/domain/proceeds`의 `taxableIncome`). 따라서 손실 상환 항목은 0으로
 * 들어오며 여기서 통산되지 않는다.
 */
export function aggregateFinancialIncome(params: {
  items: ReadonlyArray<{ taxableIncome: DecimalInput }>
  /** ELS 외 금융소득(이자·배당) */
  otherFinancialIncome?: DecimalInput | null
}): DecimalValue {
  const elsTotal = sum(params.items.map((item) => dec(item.taxableIncome)))
  const other =
    params.otherFinancialIncome == null
      ? ZERO
      : dec(params.otherFinancialIncome)

  return elsTotal.plus(other)
}

/**
 * 세후 회수액 — DOC-007 §7.4
 *
 * ```
 * netProceeds = Σ gross(els) − F × effectiveRate(F, A)
 * ```
 *
 * 비과세 계좌 상품은 `taxableIncome = 0`이므로 `F`에 기여하지 않고 `gross`가
 * 전액 반영된다.
 *
 * 건강보험료는 차감하지 않는다. §7.4의 정의가 세액만 반영하며, DOC-011
 * `ForecastRow`도 `healthInsurance`를 별 항목으로 둔다.
 */
export function netProceeds(params: {
  grossTotal: DecimalInput
  financialIncome: DecimalInput
  effectiveRate: DecimalInput
}): DecimalValue {
  return dec(params.grossTotal).minus(
    dec(params.financialIncome).times(dec(params.effectiveRate)),
  )
}
