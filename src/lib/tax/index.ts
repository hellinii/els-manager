/**
 * `lib/tax` 공개 API — 세금 계산 (DOC-007 §5, §6, §7)
 *
 * 순수 모듈이다. DB·네트워크·환경변수에 접근하지 않으며 세율 등 상수는 인자로
 * 주입받는다(DOC-010 DEP-01 ~ DEP-03). 서버·클라이언트 양쪽에서 동일 결과를
 * 보장하므로 시뮬레이터는 클라이언트에서 즉시 계산하고 저장 시점에 서버에서
 * 재계산하여 검증한다(ADR-003).
 */

export {
  DEFAULT_ROUNDING,
  type HealthInsuranceType,
  type RoundingPolicy,
  type TaxBracket,
  type TaxConstants,
} from './types'

export { findBracket, progressiveTax } from './brackets'

export {
  calculateFinancialIncomeTax,
  type FinancialIncomeTaxParams,
  type FinancialIncomeTaxResult,
} from './comprehensive'

export {
  calculateHealthInsurance,
  insuranceBase,
  type HealthInsuranceResult,
} from './healthInsurance'

export {
  marginalRateTable,
  realMarginalRate,
  type MarginalRateRow,
} from './marginalRate'

export { aggregateFinancialIncome, netProceeds } from './aggregate'
