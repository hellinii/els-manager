import { dec, type DecimalInput, type DecimalValue } from '@/lib/decimal'
import type { TaxBracket, TaxConstants } from './types'

/**
 * 실질 한계 부담률 — DOC-007 §5.6
 *
 * 금융소득이 1원 증가할 때의 추가 부담률. 세금과 건강보험을 합산한다.
 * 직장가입자와 지역가입자의 **한계율은 동일**하며, 차이는 부과가 시작되는
 * 문턱에 있다(§6.1).
 */

export type MarginalRateRow = {
  lowerBound: DecimalValue
  /** 소득세율 */
  incomeTaxRate: DecimalValue
  /** 세금 한계 부담률 — 지방소득세 포함 */
  taxMarginalRate: DecimalValue
  /** 건강보험료율 */
  healthInsuranceRate: DecimalValue
  /** 금융소득 대비 장기요양보험 부담률 */
  longTermCareRate: DecimalValue
  /** 실질 한계 부담률 */
  realMarginalRate: DecimalValue
}

export function realMarginalRate(
  bracketRate: DecimalInput,
  constants: TaxConstants,
): DecimalValue {
  const rate = dec(bracketRate)
  const healthRate = dec(constants.healthInsuranceRate)

  return rate
    .times(dec('1').plus(dec(constants.localIncomeTaxRate)))
    .plus(healthRate)
    .plus(healthRate.times(dec(constants.longTermCareRate)))
}

/** 구간별 실질 한계 부담률 표. 하한 오름차순으로 반환한다. */
export function marginalRateTable(
  brackets: readonly TaxBracket[],
  constants: TaxConstants,
): MarginalRateRow[] {
  const healthRate = dec(constants.healthInsuranceRate)
  const localRate = dec(constants.localIncomeTaxRate)
  const careRate = dec(constants.longTermCareRate)

  return brackets
    .map((bracket): MarginalRateRow => {
      const incomeTaxRate = dec(bracket.rate)
      return {
        lowerBound: dec(bracket.lowerBound),
        incomeTaxRate,
        taxMarginalRate: incomeTaxRate.times(dec('1').plus(localRate)),
        healthInsuranceRate: healthRate,
        longTermCareRate: healthRate.times(careRate),
        realMarginalRate: realMarginalRate(incomeTaxRate, constants),
      }
    })
    .sort((a, b) => a.lowerBound.comparedTo(b.lowerBound))
}
