import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor } from './helpers/auth'
import { ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures, seedTaxProfile } from './helpers/seed'
import { YEAR, setupScenario, type Scenario } from './helpers/scenario'
import type { UserSessionClient } from '@/lib/db/client'

/**
 * `override`는 시뮬레이션 전용 — **저장하지 않는다** (§4.6)
 *
 * "값을 조정해봤을 뿐인데 저장되는" 문제를 막는다. 조회 계약이 쓰기를 하지
 * 않는다는 것은 자명해 보이지만, `getTaxSummary`는 프로필이 없을 때 폴백 값을
 * 만들어 쓰므로 **그 폴백을 저장해 두려는 유혹이 실제로 있다.** 행 수와 값이
 * 불변임을 고정해 그 경로가 생기면 즉시 드러나게 한다.
 */

let s: Scenario
let dbA: UserSessionClient

beforeAll(async () => {
  s = await setupScenario()
  dbA = await clientFor(ITG_USER_A)
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

async function profileRows(db: UserSessionClient, userId: string) {
  const { data, error } = await db
    .from('tax_profiles')
    .select('user_id, tax_year, other_income_base::text, other_financial_income::text, health_insurance_type')
    .eq('user_id', userId)

  expect(error).toBeNull()
  return data!
}

describe('프로필이 없는 사용자', () => {
  it('override로 조회해도 행이 생기지 않는다', async () => {
    const before = await profileRows(dbA, ITG_USER_A)
    expect(before).toEqual([])

    const view = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: {
        otherIncomeBase: '80000000',
        otherFinancialIncome: '15000000',
        healthInsuranceType: 'REGIONAL',
      },
    })

    // 값은 반영된다
    expect(view.profile.otherFinancialIncome).toBe('15000000')
    expect(view.profile.healthInsuranceType).toBe('REGIONAL')
    expect(view.profile.isSaved).toBe(false)

    // ★ 행이 생기지 않는다
    const after = await profileRows(dbA, ITG_USER_A)
    expect(after).toEqual([])
  })

  it('폴백 조회를 반복해도 행이 생기지 않는다', async () => {
    await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(await profileRows(dbA, ITG_USER_A)).toEqual([])
  })
})

describe('프로필이 있는 사용자', () => {
  beforeAll(async () => {
    await seedTaxProfile({
      userId: ITG_USER_A,
      taxYear: YEAR,
      otherIncomeBase: '50000000',
      otherFinancialIncome: '3000000',
      healthInsuranceType: 'EMPLOYEE',
    })
  })

  it('override 없이 조회하면 저장값을 쓰고 isSaved=true', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(view.profile.isSaved).toBe(true)
    expect(view.profile.otherIncomeBase).toBe('50000000')
    expect(view.profile.otherFinancialIncome).toBe('3000000')
    expect(view.profile.healthInsuranceType).toBe('EMPLOYEE')
  })

  it('override 후에도 행 수·값이 불변이다', async () => {
    const before = await profileRows(dbA, ITG_USER_A)
    expect(before).toHaveLength(1)

    const view = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: {
        otherIncomeBase: '120000000',
        otherFinancialIncome: '25000000',
        healthInsuranceType: 'DEPENDENT',
      },
    })

    // 조회 결과에는 override가 반영된다
    expect(view.profile.otherFinancialIncome).toBe('25000000')
    expect(view.profile.healthInsuranceType).toBe('DEPENDENT')
    // isSaved는 "저장된 프로필이 없거나 override 적용 중"을 뜻한다
    expect(view.profile.isSaved).toBe(false)

    // ★ DB는 그대로다
    const after = await profileRows(dbA, ITG_USER_A)
    expect(after).toEqual(before)
    expect(after).toHaveLength(1)
    expect(after[0].other_financial_income).toBe('3000000')
    expect(after[0].health_insurance_type).toBe('EMPLOYEE')
  })

  it('부분 override는 나머지를 저장값에서 가져온다', async () => {
    const view = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { healthInsuranceType: 'REGIONAL' },
    })

    expect(view.profile.healthInsuranceType).toBe('REGIONAL')
    expect(view.profile.otherFinancialIncome).toBe('3000000')
    expect(view.profile.otherIncomeBase).toBe('50000000')

    expect(await profileRows(dbA, ITG_USER_A)).toHaveLength(1)
  })

  it('override가 계산에 실제로 반영된다 — 값만 바꾸고 끝나지 않는다', async () => {
    const plain = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const simulated = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { otherFinancialIncome: '30000000' },
    })

    // 9,200,000 + 3,000,000 = 12,200,000 (기준금액 2천만 이하 → 분리과세 종결)
    expect(plain.income.total).toBe('12200000')
    expect(plain.income.isComprehensive).toBe(false)
    expect(plain.tax.method1).toBeNull()

    // 9,200,000 + 30,000,000 = 39,200,000 (기준금액 초과 → 비교과세)
    expect(simulated.income.total).toBe('39200000')
    expect(simulated.income.isComprehensive).toBe(true)
    expect(simulated.tax.method1).not.toBeNull()
    expect(simulated.tax.method2).not.toBeNull()
  })

  it('건강보험 유형 override가 보험료를 바꾼다', async () => {
    const employee = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { otherFinancialIncome: '30000000', healthInsuranceType: 'EMPLOYEE' },
    })
    const regional = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { otherFinancialIncome: '30000000', healthInsuranceType: 'REGIONAL' },
    })
    const none = await s.asA.getTaxSummary({
      ownerId: ITG_USER_A,
      year: YEAR,
      override: { otherFinancialIncome: '30000000', healthInsuranceType: 'NONE' },
    })

    // 직장가입자는 초과분만, 지역가입자는 문턱 초과 시 전액이 반영된다(§6.1)
    expect(employee.healthInsurance.assessmentBase).toBe('19200000')
    expect(regional.healthInsurance.assessmentBase).toBe('39200000')
    // NONE은 0을 만든다 — 화면은 계산 결과가 아니라 미입력으로 표시해야 한다
    expect(none.healthInsurance.total).toBe('0')
  })
})

describe('타인의 프로필에 쓰지 않는다', () => {
  it('B의 조회가 A의 행을 건드리지 않는다', async () => {
    const beforeA = await profileRows(dbA, ITG_USER_A)

    await s.asB.getTaxSummary({
      ownerId: ITG_USER_B,
      year: YEAR,
      override: { otherFinancialIncome: '99000000' },
    })

    expect(await profileRows(dbA, ITG_USER_A)).toEqual(beforeA)
  })
})
