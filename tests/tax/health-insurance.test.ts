import { describe, expect, it } from 'vitest'
import {
  calculateHealthInsurance,
  insuranceBase,
} from '@/lib/tax/healthInsurance'
import type { HealthInsuranceType } from '@/lib/tax/types'
import { CONSTANTS_2026 } from '../fixtures/tax-2026'
import { expectAmount } from '../fixtures/assert'

/** DOC-007 §10.3 — 건강보험료 */

function calc(financialIncome: string, subscriberType: HealthInsuranceType) {
  return calculateHealthInsurance({
    financialIncome,
    subscriberType,
    constants: CONSTANTS_2026,
  })
}

describe('건강보험료 (DOC-007 §10.3)', () => {
  it('TC-09: F = 100,000,000, 지역가입자 → 7,190,000 (전액 반영)', () => {
    const r = calc('100000000', 'REGIONAL')
    expectAmount(r.assessmentBase, '100000000')
    expectAmount(r.healthPremium, '7190000')
  })

  it('TC-10: F = 9,000,000, 지역가입자 → 0 (문턱 미달)', () => {
    const r = calc('9000000', 'REGIONAL')
    expectAmount(r.assessmentBase, '0')
    expectAmount(r.healthPremium, '0')
  })

  it('TC-11: F = 100,000,000, 직장가입자 → 5,752,000 (초과분 8,000만만 반영)', () => {
    const r = calc('100000000', 'EMPLOYEE')
    expectAmount(r.assessmentBase, '80000000')
    expectAmount(r.healthPremium, '5752000')
  })

  it('TC-12: F = 15,000,000, 직장가입자 → 0 (문턱 미달)', () => {
    const r = calc('15000000', 'EMPLOYEE')
    expectAmount(r.assessmentBase, '0')
    expectAmount(r.healthPremium, '0')
  })

  it('TC-13: F = 100,000,000, 해당없음 → 0 (미부과)', () => {
    const r = calc('100000000', 'NONE')
    expectAmount(r.assessmentBase, '0')
    expectAmount(r.healthPremium, '0')
    expectAmount(r.longTermCarePremium, '0')
    expectAmount(r.total, '0')
  })
})

describe('가입유형별 문턱 구조 (DOC-007 §6.1)', () => {
  it('지역가입자는 문턱 초과 시 전액이 반영되어 계단식으로 증가한다', () => {
    // 1,000만원 경계. "초과"이므로 정확히 1,000만원은 미달로 처리한다
    expectAmount(insuranceBase('10000000', 'REGIONAL', CONSTANTS_2026), '0')
    expectAmount(
      insuranceBase('10000001', 'REGIONAL', CONSTANTS_2026),
      '10000001',
    )
  })

  it('직장가입자는 초과분만 반영되어 문턱에서 연속이다', () => {
    expectAmount(insuranceBase('20000000', 'EMPLOYEE', CONSTANTS_2026), '0')
    expectAmount(insuranceBase('20000001', 'EMPLOYEE', CONSTANTS_2026), '1')
  })

  it('피부양자는 문턱 초과 시 자격 상실로 전액이 반영된다', () => {
    // DOC-007 §6.1에 정의되어 있으나 §10에 검증 케이스가 없어 여기서 고정한다
    expectAmount(insuranceBase('20000000', 'DEPENDENT', CONSTANTS_2026), '0')
    expectAmount(
      insuranceBase('20000001', 'DEPENDENT', CONSTANTS_2026),
      '20000001',
    )

    const r = calc('100000000', 'DEPENDENT')
    expectAmount(r.assessmentBase, '100000000')
    expectAmount(r.healthPremium, '7190000')
  })
})

describe('장기요양보험료 (DOC-007 §6.2)', () => {
  it('금융소득이 아니라 건강보험료에 비율을 곱한다', () => {
    const r = calc('100000000', 'REGIONAL')
    // 7,190,000 × 0.1314 = 944,766
    expectAmount(r.longTermCarePremium, '944766')
    expectAmount(r.total, '8134766')

    // 금융소득에 직접 곱한 값(100,000,000 × 0.1314)이 아니어야 한다
    expect(r.longTermCarePremium.toString()).not.toBe('13140000')
  })
})
