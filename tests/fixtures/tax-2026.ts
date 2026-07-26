import type { TaxBracket, TaxConstants } from '@/lib/tax/types'

/**
 * 2026년 기준 세율·요율 — DOC-007 §5.1, §5.6, §10
 *
 * **이 값은 `lib/` 안에 두지 않는다**(CLAUDE.md 절대 규칙 #5). 운영에서는
 * `tax_brackets`·`tax_constants`에서 조회하며(ADR-005), 여기서는 순수 모듈에
 * 주입할 테스트 픽스처로만 쓴다.
 *
 * P2에서 이 값이 마이그레이션 시드가 된다. 그 시점에 시드와 본 픽스처가
 * 일치하는지 검증하는 테스트를 추가한다(AQ-05).
 */

/** DOC-007 §5.1 — 2026년 종합소득세 누진세율 구간 */
export const BRACKETS_2026: readonly TaxBracket[] = [
  { lowerBound: '0', rate: '0.06', progressiveDeduction: '0' },
  { lowerBound: '14000000', rate: '0.15', progressiveDeduction: '1260000' },
  { lowerBound: '50000000', rate: '0.24', progressiveDeduction: '5760000' },
  { lowerBound: '88000000', rate: '0.35', progressiveDeduction: '15440000' },
  { lowerBound: '150000000', rate: '0.38', progressiveDeduction: '19940000' },
  { lowerBound: '300000000', rate: '0.40', progressiveDeduction: '25940000' },
  { lowerBound: '500000000', rate: '0.42', progressiveDeduction: '35940000' },
  { lowerBound: '1000000000', rate: '0.45', progressiveDeduction: '65940000' },
]

/** DOC-007 §2 — 2026년 주입 상수 */
export const CONSTANTS_2026: TaxConstants = {
  separateTaxationRate: '0.154',
  separateTaxationIncomeTaxRate: '0.14',
  comprehensiveTaxationThreshold: '20000000',
  localIncomeTaxRate: '0.1',
  healthInsuranceRate: '0.0719',
  longTermCareRate: '0.1314',
  regionalIncomeThreshold: '10000000',
  employeeNonWageThreshold: '20000000',
  dependentIncomeThreshold: '20000000',
}
