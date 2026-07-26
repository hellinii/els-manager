import type { DecimalInput } from '@/lib/decimal'

/**
 * 세금 계산에 주입되는 값 — DOC-007 §2, DOC-010 DEP-03
 *
 * 이 모듈은 상수를 조회하지 않는다. 호출부가 `tax_brackets`·`tax_constants`에서
 * 해당 연도 값을 읽어 주입한다(ADR-005). 상수를 코드에 두면 연도별 재현성이
 * 깨지고 회귀 테스트(K-08)의 전제가 무너진다.
 */

/** `tax_brackets` 1행 — 종합소득세 누진세율 구간 */
export type TaxBracket = {
  /** 과세표준 하한 */
  lowerBound: DecimalInput
  /** 세율 (소수 정규화) */
  rate: DecimalInput
  /** 누진공제액 */
  progressiveDeduction: DecimalInput
}

/** `tax_constants` — DOC-002 §4.10의 키 목록과 1:1 대응한다 */
export type TaxConstants = {
  /** 분리과세율. 지방소득세를 포함한 원천징수 총 부담 (2026: 0.154) */
  separateTaxationRate: DecimalInput
  /** 분리과세 소득세율. 지방세를 제외한 소득세분 (2026: 0.14) */
  separateTaxationIncomeTaxRate: DecimalInput
  /** 종합과세 기준금액 (2026: 20,000,000) */
  comprehensiveTaxationThreshold: DecimalInput
  /** 지방소득세 부가율. 소득세액에 대한 비율 (2026: 0.1) */
  localIncomeTaxRate: DecimalInput
  /** 건강보험료율 (2026: 0.0719) */
  healthInsuranceRate: DecimalInput
  /** 장기요양보험 비율. 건강보험료에 대한 비율 (2026: 0.1314) */
  longTermCareRate: DecimalInput
  /** 지역가입자 금융소득 반영 기준 (2026: 10,000,000) */
  regionalIncomeThreshold: DecimalInput
  /** 직장가입자 보수외소득 기준 (2026: 20,000,000) */
  employeeNonWageThreshold: DecimalInput
  /** 피부양자 소득 기준 (2026: 20,000,000) */
  dependentIncomeThreshold: DecimalInput
}

/** 건강보험 가입 유형 — DOC-002 §4.2, DOC-005 §5 */
export type HealthInsuranceType =
  | 'EMPLOYEE'
  | 'REGIONAL'
  | 'DEPENDENT'
  | 'NONE'

/**
 * 세액·보험료 최종값의 절사 정책 — DOC-007 §2, RD-01
 *
 * RD-01(절사 단위)이 미결이므로 단위를 주입받는다. 실제 고지·원천징수 기준이
 * 확인되면 호출부의 `unit`만 교체하며 계산 로직은 변경하지 않는다.
 */
export type RoundingPolicy = {
  /** 절사 단위 (원). 기본 `'1'` = 원 단위 */
  unit: DecimalInput
  mode: 'TRUNCATE'
}

/** DOC-007 §2의 현행 규정. RD-01 확정 시 이 값이 아니라 호출부 인자를 바꾼다. */
export const DEFAULT_ROUNDING: RoundingPolicy = { unit: '1', mode: 'TRUNCATE' }
