import { describe, expect, it } from 'vitest'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { expectAmount } from '../fixtures/assert'

/**
 * DOC-007 §10.2 — `A` 정규화 (E-03)
 *
 * `A`가 미입력(null)인 경우와 `0`인 경우의 결과가 **완전히 동일**해야 한다.
 * 화면에서 "다른 종합소득 없음"과 "0원 입력"이 다른 세액을 내놓으면 사용자는
 * 어느 쪽을 믿어야 할지 알 수 없다.
 */

function calc(otherIncomeBase: string | null | undefined) {
  return calculateFinancialIncomeTax({
    financialIncome: '100000000',
    otherIncomeBase,
    brackets: BRACKETS_2026,
    constants: CONSTANTS_2026,
  })
}

describe('A 정규화 (DOC-007 §10.2)', () => {
  it('TC-07: F = 100,000,000, A = null → 총세액 17,864,000', () => {
    expectAmount(calc(null).totalTax, '17864000')
  })

  it('TC-08: F = 100,000,000, A = 0 → 총세액 17,864,000 (TC-07과 동일)', () => {
    expectAmount(calc('0').totalTax, '17864000')
  })

  it('A = null / 0 / 미전달의 모든 결과 필드가 일치한다', () => {
    const withNull = calc(null)
    const withZero = calc('0')
    const omitted = calc(undefined)

    const serialize = (r: ReturnType<typeof calc>) => ({
      isComprehensive: r.isComprehensive,
      method1: r.method1?.toString() ?? null,
      method2: r.method2?.toString() ?? null,
      computedTax: r.computedTax.toString(),
      localIncomeTax: r.localIncomeTax.toString(),
      totalTax: r.totalTax.toString(),
      withheld: r.withheld.toString(),
      additionalPayment: r.additionalPayment.toString(),
      effectiveRate: r.effectiveRate.toString(),
    })

    expect(serialize(withNull)).toEqual(serialize(withZero))
    expect(serialize(omitted)).toEqual(serialize(withZero))
  })
})
