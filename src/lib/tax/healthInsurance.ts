import {
  dec,
  maxZero,
  truncateToUnit,
  ZERO,
  type DecimalInput,
  type DecimalValue,
} from '@/lib/decimal'
import {
  DEFAULT_ROUNDING,
  type HealthInsuranceType,
  type RoundingPolicy,
  type TaxConstants,
} from './types'

/**
 * 건강보험료 — DOC-007 §6
 *
 * 산출값은 개인의 금융소득만 반영한 **추정치**다. 지역가입자 보험료는 실제로는
 * 주민등록세대 단위로 소득·재산을 합산하여 부과되나 본 시스템은 세대와 재산을
 * 모델링하지 않는다(A-06, RD-04). 이 취지를 화면에 고지한다.
 */

export type HealthInsuranceResult = {
  /** 산정 소득 — 가입 유형별 산출식이 다르다 */
  assessmentBase: DecimalValue
  healthPremium: DecimalValue
  longTermCarePremium: DecimalValue
  total: DecimalValue
}

/**
 * 가입유형별 산정 소득 — DOC-007 §6.1
 *
 * 문턱 구조가 유형별로 다르다. 지역가입자·피부양자는 문턱 초과 시 **전액**이
 * 반영되어 문턱 부근에서 부담이 계단식으로 증가하고, 직장가입자는 초과분만
 * 반영되어 연속이다.
 */
export function insuranceBase(
  financialIncome: DecimalInput,
  subscriberType: HealthInsuranceType,
  constants: TaxConstants,
): DecimalValue {
  const F = dec(financialIncome)
  // E-02
  if (F.lte(0)) return ZERO

  switch (subscriberType) {
    case 'REGIONAL':
      return F.gt(dec(constants.regionalIncomeThreshold)) ? F : ZERO
    case 'EMPLOYEE':
      return maxZero(F.minus(dec(constants.employeeNonWageThreshold)))
    case 'DEPENDENT':
      // 문턱 초과 시 피부양자 자격을 상실하므로 전액이 부과 대상이 된다
      return F.gt(dec(constants.dependentIncomeThreshold)) ? F : ZERO
    case 'NONE':
      return ZERO
  }
}

/** 보험료 산출 — DOC-007 §6.2 */
export function calculateHealthInsurance(params: {
  financialIncome: DecimalInput
  subscriberType: HealthInsuranceType
  constants: TaxConstants
  rounding?: RoundingPolicy
}): HealthInsuranceResult {
  const {
    financialIncome,
    subscriberType,
    constants,
    rounding = DEFAULT_ROUNDING,
  } = params

  const assessmentBase = insuranceBase(
    financialIncome,
    subscriberType,
    constants,
  )

  const healthPremium = truncateToUnit(
    assessmentBase.times(dec(constants.healthInsuranceRate)),
    rounding.unit,
  )

  // 장기요양보험료는 금융소득이 아니라 **건강보험료에** 비율을 곱한 값이다
  const longTermCarePremium = truncateToUnit(
    healthPremium.times(dec(constants.longTermCareRate)),
    rounding.unit,
  )

  return {
    assessmentBase,
    healthPremium,
    longTermCarePremium,
    total: healthPremium.plus(longTermCarePremium),
  }
}
