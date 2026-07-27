import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures, seedTaxProfile } from './helpers/seed'
import { YEAR, setupScenario, type Scenario } from './helpers/scenario'

/**
 * §4.8 — D3이 잡아낸 실패 모드를 회귀로 고정한다
 *
 * v0.5의 계약을 그대로 구현하면 타인의 `other_financial_income`을 **읽지 못한
 * 값을 `0`으로 두고** 계산을 끝낸다. 오류도 빈 값도 아니라 **그럴싸한 숫자**로
 * 나타나므로 화면에서 발견되지 않는다.
 *
 * 그래서 두 사람 **모두에게** 기타 금융소득 프로필을 만들어 두고 검증한다 —
 * 한쪽만 있으면 "타인 값이 0"이 정답인지 누락인지 구분되지 않는다.
 */

let s: Scenario

beforeAll(async () => {
  s = await setupScenario()

  await seedTaxProfile({
    userId: ITG_USER_A,
    taxYear: YEAR,
    otherIncomeBase: '50000000',
    otherFinancialIncome: '3000000',
    healthInsuranceType: 'EMPLOYEE',
  })
  // B에게도 큰 값을 준다. A가 이 값을 절대 반영할 수 없어야 한다.
  await seedTaxProfile({
    userId: ITG_USER_B,
    taxYear: YEAR,
    otherIncomeBase: '90000000',
    otherFinancialIncome: '40000000',
    healthInsuranceType: 'REGIONAL',
  })
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('본인 행과 타인 행이 다르게 채워진다', () => {
  it('A가 볼 때 — 본인은 완전, B는 축소 + 표식', async () => {
    const rows = await s.asA.listUserSummaries()
    const me = rows.find((r) => r.userId === ITG_USER_A)!
    const other = rows.find((r) => r.userId === ITG_USER_B)!

    // 본인 — ELS 9,200,000 + 기타 3,000,000
    expect(me.isMe).toBe(true)
    expect(me.includesOtherFinancialIncome).toBe(true)
    expect(me.currentYearFinancialIncome).toBe('12200000')
    expect(me.isComprehensive).toBe(false)

    // 타인 — ELS만. B의 40,000,000은 절대 들어오지 않는다.
    expect(other.isMe).toBe(false)
    expect(other.includesOtherFinancialIncome).toBe(false)
    expect(other.isComprehensive).toBeNull()
    expect(other.currentYearFinancialIncome).not.toContain('40000000')
  })

  it('B가 볼 때 — 역할이 뒤바뀐다', async () => {
    const rows = await s.asB.listUserSummaries()
    const me = rows.find((r) => r.userId === ITG_USER_B)!
    const other = rows.find((r) => r.userId === ITG_USER_A)!

    // B의 본인 행 = ELS 2,000,000 + 기타 40,000,000 = 42,000,000
    //   ELS: 5천만 × (1 + 0.08 × 6/12) − 5천만 (productB 1차, 2026-08-03)
    expect(me.includesOtherFinancialIncome).toBe(true)
    expect(me.currentYearFinancialIncome).toBe('42000000')
    // 42,000,000 > 기준금액 20,000,000
    expect(me.isComprehensive).toBe(true)

    expect(other.includesOtherFinancialIncome).toBe(false)
    expect(other.isComprehensive).toBeNull()
  })

  it('같은 사용자 행이 조회자에 따라 다르다 — 축소가 실재한다', async () => {
    const asB = (await s.asB.listUserSummaries()).find((r) => r.userId === ITG_USER_B)!
    const asA = (await s.asA.listUserSummaries()).find((r) => r.userId === ITG_USER_B)!

    // ★ 이 차이가 D3의 핵심이다. 값이 다르다는 사실이 곧 축소의 증거다.
    expect(asB.currentYearFinancialIncome).not.toBe(asA.currentYearFinancialIncome)
    expect(asB.includesOtherFinancialIncome).toBe(true)
    expect(asA.includesOtherFinancialIncome).toBe(false)

    // 축소된 값이 원래 값보다 작다 — 조용히 과대가 아니라 과소다
    expect(Number(asA.currentYearFinancialIncome)).toBeLessThan(
      Number(asB.currentYearFinancialIncome),
    )
  })

  it('isComprehensive가 타인에게 null인 이유가 값에서 확인된다', async () => {
    const asA = (await s.asA.listUserSummaries()).find((r) => r.userId === ITG_USER_B)!
    const asB = (await s.asB.listUserSummaries()).find((r) => r.userId === ITG_USER_B)!

    // B 본인 기준으로는 종합과세 대상이다 (42,000,000 > 20,000,000).
    expect(asB.isComprehensive).toBe(true)
    // A가 읽을 수 있는 것은 ELS 2,000,000뿐이다
    expect(asA.currentYearFinancialIncome).toBe('2000000')
    // A가 읽을 수 있는 값만으로 판정하면 **false**가 나온다 — 틀린 답이다.
    // 그래서 판정하지 않고 null을 담는다.
    expect(asA.isComprehensive).toBeNull()
  })
})

describe('보유 현황은 축소되지 않는다', () => {
  it('상품·원금은 전체 조회 대상이므로 조회자와 무관하다', async () => {
    const asA = await s.asA.listUserSummaries()
    const asB = await s.asB.listUserSummaries()

    const counts = (rows: typeof asA) =>
      rows.map((r) => `${r.userId}:${r.activeCount}:${r.activePrincipal}`).sort()

    expect(counts(asA)).toEqual(counts(asB))
  })

  it('사용자별로 분리된다 — 합산하지 않는다', async () => {
    const rows = await s.asA.listUserSummaries()
    const a = rows.find((r) => r.userId === ITG_USER_A)!
    const b = rows.find((r) => r.userId === ITG_USER_B)!

    expect(a.activeCount).toBe(3)
    expect(a.activePrincipal).toBe('150000000')
    expect(b.activeCount).toBe(1)
    expect(b.activePrincipal).toBe('50000000')
  })

  it('합계 행이 없다', async () => {
    const rows = await s.asA.listUserSummaries()
    // 사용자 수만큼만 있다 — 합계 행이 섞이면 개인 단위 원칙이 흐려진다
    expect(rows).toHaveLength(new Set(rows.map((r) => r.userId)).size)
  })
})

describe('getTaxSummary와의 경계', () => {
  it('타인 상세는 getTaxSummary로 얻을 수 없다', async () => {
    await expect(
      s.asA.getTaxSummary({ ownerId: ITG_USER_B, year: YEAR }),
    ).rejects.toThrow(/본인 전용/)
  })

  it('본인 행의 값은 두 계약에서 일치한다', async () => {
    const summary = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const row = (await s.asA.listUserSummaries()).find((r) => r.userId === ITG_USER_A)!

    // 두 계약이 갈리면 같은 화면의 두 숫자가 달라진다
    expect(row.currentYearFinancialIncome).toBe(summary.income.total)
    expect(row.isComprehensive).toBe(summary.income.isComprehensive)
  })
})
