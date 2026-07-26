import { describe, expect, it } from 'vitest'
import { dec } from '@/lib/decimal'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { findBracket, progressiveTax } from '@/lib/tax/brackets'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { expectAmount, percent2 } from '../fixtures/assert'

/**
 * DOC-007 §10.1 — 비교과세, 다른 종합소득 없음 (A = 0)
 *
 * 기대값은 검증된 정답이다. 실패하면 테스트가 아니라 구현을 고친다
 * (CLAUDE.md 절대 규칙 #1).
 */

function calc(financialIncome: string, otherIncomeBase: string | null = '0') {
  return calculateFinancialIncomeTax({
    financialIncome,
    otherIncomeBase,
    brackets: BRACKETS_2026,
    constants: CONSTANTS_2026,
  })
}

describe('비교과세 — 다른 종합소득 없음 (DOC-007 §10.1)', () => {
  it('TC-01: F = 20,000,000 — 기준금액 경계. 분리과세 종결', () => {
    const r = calc('20000000')

    expect(r.isComprehensive).toBe(false)
    expectAmount(r.additionalPayment, '0')
    expect(percent2(r.effectiveRate)).toBe('15.40%')

    // 분리과세로 종결되므로 비교과세를 적용하지 않는다 (DOC-011 §4.6)
    expect(r.method1).toBeNull()
    expect(r.method2).toBeNull()
    expectAmount(r.computedTax, '2800000')
    expectAmount(r.totalTax, '3080000')
  })

  it('TC-02: F = 70,000,000 — 기준금액 초과이나 방식① 우위', () => {
    const r = calc('70000000')

    expect(r.isComprehensive).toBe(true)
    expectAmount(r.additionalPayment, '0')
    expect(percent2(r.effectiveRate)).toBe('15.40%')

    // 방식① = 9,800,000 > 방식② = 9,040,000
    expectAmount(r.method1, '9800000')
    expectAmount(r.method2, '9040000')
    expectAmount(r.computedTax, '9800000')
  })

  it('TC-03: F = 77,600,000 — 분기점. 방식① = 방식②가 정확히 일치', () => {
    const r = calc('77600000')

    expectAmount(r.additionalPayment, '0')
    expect(percent2(r.effectiveRate)).toBe('15.40%')

    // DOC-007 §5.5의 유도 결과. 두 방식이 여기서 교차한다
    expectAmount(r.method1, '10864000')
    expectAmount(r.method2, '10864000')
    expect(r.method1!.eq(r.method2!)).toBe(true)

    // 이 지점까지는 원천징수액과 확정 세액이 같다
    expectAmount(r.totalTax, '11950400')
    expectAmount(r.withheld, '11950400')
  })

  it('TC-04: F = 80,000,000 — 분기점 직후. 종합과세 전환', () => {
    const r = calc('80000000')

    expectAmount(r.additionalPayment, '264000')
    expect(percent2(r.effectiveRate)).toBe('15.73%')

    expectAmount(r.method1, '11200000')
    expectAmount(r.method2, '11440000')
    expectAmount(r.computedTax, '11440000')
    expectAmount(r.totalTax, '12584000')
    expectAmount(r.withheld, '12320000')
  })

  it('TC-05: F = 100,000,000 — 대표 케이스', () => {
    const r = calc('100000000')

    expectAmount(r.additionalPayment, '2464000')
    expect(percent2(r.effectiveRate)).toBe('17.86%')

    // DOC-007 §10.1 TC-05 상세 검증
    expectAmount(r.method1, '14000000') // 100,000,000 × 0.14 + T(0)
    expectAmount(r.method2, '16240000') // 2,800,000 + T(80,000,000)
    expectAmount(r.computedTax, '16240000') // max(①,②) − T(0)
    expectAmount(r.localIncomeTax, '1624000')
    expectAmount(r.totalTax, '17864000') // × 1.1
    expectAmount(r.withheld, '15400000') // × 0.154
    expect(r.effectiveRate.toString()).toBe('0.17864')
  })

  it('TC-06: F = 0 — 하한 경계', () => {
    const r = calc('0')

    expect(r.isComprehensive).toBe(false)
    expectAmount(r.computedTax, '0')
    expectAmount(r.localIncomeTax, '0')
    expectAmount(r.totalTax, '0')
    expectAmount(r.withheld, '0')
    expectAmount(r.additionalPayment, '0')
    expect(percent2(r.effectiveRate)).toBe('0.00%')
  })
})

describe('누진 산출세액 T(x) (DOC-007 §5.1)', () => {
  it('x ≤ 0이면 0이다', () => {
    expectAmount(progressiveTax('0', BRACKETS_2026), '0')
    expectAmount(progressiveTax('-1', BRACKETS_2026), '0')
  })

  it('구간 경계에서 연속이다 — 하한 포함/초과 해석이 결과를 바꾸지 않는다', () => {
    // 누진공제 구조 덕분에 T(x)는 경계에서 연속이다. 따라서
    // tax_brackets를 "하한 이상"으로 읽든 세법의 "하한 초과"로 읽든 값이 같다.
    // 이 성질이 깨지면 누진공제액이 잘못 입력되었다는 뜻이다.
    for (const bracket of BRACKETS_2026) {
      const boundary = dec(bracket.lowerBound)
      if (boundary.lte(0)) continue

      const lower = findBracket(boundary.minus(1), BRACKETS_2026)
      const upper = findBracket(boundary, BRACKETS_2026)
      expect(upper).toBe(bracket)

      const viaUpper = boundary
        .times(dec(upper.rate))
        .minus(dec(upper.progressiveDeduction))
      const viaLower = boundary
        .times(dec(lower.rate))
        .minus(dec(lower.progressiveDeduction))

      expect(viaUpper.toString()).toBe(viaLower.toString())
    }
  })

  it('TC-02·TC-05가 의존하는 구간 값이 맞다', () => {
    expectAmount(progressiveTax('50000000', BRACKETS_2026), '6240000')
    expectAmount(progressiveTax('57600000', BRACKETS_2026), '8064000')
    expectAmount(progressiveTax('60000000', BRACKETS_2026), '8640000')
    expectAmount(progressiveTax('80000000', BRACKETS_2026), '13440000')
  })
})
