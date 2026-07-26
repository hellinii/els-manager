import { describe, expect, it } from 'vitest'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { calculateHealthInsurance } from '@/lib/tax/healthInsurance'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { expectAmount, percent2 } from '../fixtures/assert'

/** DOC-007 §9 — 세금 관련 예외 및 경계 처리 */

function calc(financialIncome: string, otherIncomeBase: string | null = '0') {
  return calculateFinancialIncomeTax({
    financialIncome,
    otherIncomeBase,
    brackets: BRACKETS_2026,
    constants: CONSTANTS_2026,
  })
}

describe('E-02: F ≤ 0이면 모든 세액·보험료가 0', () => {
  it.each(['0', '-1', '-10000000'])('F = %s', (f) => {
    const r = calc(f)
    expectAmount(r.computedTax, '0')
    expectAmount(r.localIncomeTax, '0')
    expectAmount(r.totalTax, '0')
    expectAmount(r.withheld, '0')
    expectAmount(r.additionalPayment, '0')
    expectAmount(r.effectiveRate, '0')
    expect(r.method1).toBeNull()
    expect(r.method2).toBeNull()
    expect(r.isComprehensive).toBe(false)
  })

  it('보험료도 0이다', () => {
    for (const type of ['REGIONAL', 'EMPLOYEE', 'DEPENDENT', 'NONE'] as const) {
      const r = calculateHealthInsurance({
        financialIncome: '-5000000',
        subscriberType: type,
        constants: CONSTANTS_2026,
      })
      expectAmount(r.assessmentBase, '0')
      expectAmount(r.total, '0')
    }
  })
})

describe('E-04: 기준금액 이하면 분리과세로 종결한다', () => {
  it('비교과세식을 확장하면 틀린다 — 조기 반환이 필수다', () => {
    // 비교과세식을 그대로 적용하면 방식② − T(A) = 2,800,000이 나오지만
    // 정답은 원천징수로 종결되는 1,400,000이다 (DOC-007 §5.2)
    const r = calc('10000000')
    expectAmount(r.computedTax, '1400000')
    expect(r.computedTax.toString()).not.toBe('2800000')
    expectAmount(r.totalTax, '1540000')
    expectAmount(r.withheld, '1540000')
    expectAmount(r.additionalPayment, '0')
  })

  it('기준금액 이하 전 구간에서 추가납부가 0이다', () => {
    for (const f of ['1', '1000', '1000000', '19999999', '20000000']) {
      expectAmount(calc(f).additionalPayment, '0')
    }
  })

  it('부담률이 15.40%로 일정하다', () => {
    for (const f of ['1000000', '10000000', '19999999', '20000000']) {
      expect(percent2(calc(f).effectiveRate)).toBe('15.40%')
    }
  })

  it('원 단위 절사가 소액에서 부담률을 끌어내린다 — 규정된 동작이다', () => {
    // F = 1원의 세액은 0.154원이고 원 단위로 절사하면 0이 된다(DOC-007 §2).
    // 부담률이 15.4% 미만으로 내려가는 것은 절사의 산술적 결과이며 오류가 아니다.
    // RD-01에서 절사 단위가 커지면 이 구간도 함께 넓어진다
    const tiny = calc('1')
    expectAmount(tiny.totalTax, '0')
    expectAmount(tiny.withheld, '0')
    expectAmount(tiny.effectiveRate, '0')
  })

  it('기준금액 경계에서 세액이 연속이다', () => {
    // 20,000,000(분리과세 종결)과 20,000,001(비교과세 진입)의 세액 차이가
    // 1원 증가분에 상응해야 한다. 계단이 생기면 분기 처리가 잘못된 것이다
    const at = calc('20000000')
    const just = calc('20000001')
    const delta = just.totalTax.minus(at.totalTax)
    expect(delta.lte('1')).toBe(true)
    expect(delta.gte('0')).toBe(true)
  })
})

describe('E-03: A 미입력은 0으로 정규화한다', () => {
  it('A가 있으면 방식②가 커져 세부담이 증가한다', () => {
    const withoutA = calc('100000000', '0')
    const withA = calc('100000000', '50000000')
    expect(withA.totalTax.gt(withoutA.totalTax)).toBe(true)

    // 귀속세액은 A가 없었을 때의 세액을 차감한 값이다 (§5.2)
    // T(130,000,000) = 130,000,000 × 0.35 − 15,440,000 = 30,060,000
    // 방식② = 2,800,000 + T(80,000,000 + 50,000,000) = 2,800,000 + 30,060,000
    expectAmount(withA.method2, '32860000')
    // 방식① = 14,000,000 + T(50,000,000) = 14,000,000 + 6,240,000
    expectAmount(withA.method1, '20240000')
    // 귀속세액 = 32,860,000 − T(50,000,000) = 32,860,000 − 6,240,000
    expectAmount(withA.computedTax, '26620000')
  })
})

describe('RD-01: 절사 단위는 주입받는다', () => {
  it('기본값은 원 단위이며 검증 케이스 결과를 바꾸지 않는다', () => {
    const withDefault = calc('100000000')
    const withExplicit = calculateFinancialIncomeTax({
      financialIncome: '100000000',
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
      rounding: { unit: '1', mode: 'TRUNCATE' },
    })
    expectAmount(withExplicit.totalTax, withDefault.totalTax.toString())
    expectAmount(withExplicit.totalTax, '17864000')
  })

  it('단위를 바꾸면 절사가 적용된다', () => {
    // 소수가 발생하는 금액으로 확인한다. F = 33,333,333
    // 방식① = 4,666,666.62 가 우위. 총세액 = 5,133,333.282 → 절사 대상
    const perWon = calculateFinancialIncomeTax({
      financialIncome: '33333333',
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
      rounding: { unit: '1', mode: 'TRUNCATE' },
    })
    const perTenWon = calculateFinancialIncomeTax({
      financialIncome: '33333333',
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
      rounding: { unit: '10', mode: 'TRUNCATE' },
    })

    expect(perWon.totalTax.mod('1').isZero()).toBe(true)
    expect(perTenWon.totalTax.mod('10').isZero()).toBe(true)
    expect(perTenWon.totalTax.lte(perWon.totalTax)).toBe(true)
  })

  it('절사 단위가 0 이하면 거부한다', () => {
    expect(() =>
      calculateFinancialIncomeTax({
        financialIncome: '100000000',
        brackets: BRACKETS_2026,
        constants: CONSTANTS_2026,
        rounding: { unit: '0', mode: 'TRUNCATE' },
      }),
    ).toThrow()
  })
})

describe('세액 내역의 정합성', () => {
  it('귀속세액 + 지방소득세 = 총세액', () => {
    for (const f of ['20000000', '77600000', '80000000', '100000000']) {
      const r = calc(f)
      expect(r.computedTax.plus(r.localIncomeTax).eq(r.totalTax)).toBe(true)
    }
  })

  it('부담률 × F = 총세액', () => {
    for (const f of ['20000000', '80000000', '100000000']) {
      const r = calc(f)
      expect(r.effectiveRate.times(f).eq(r.totalTax)).toBe(true)
    }
  })

  it('종합과세 판정은 기준금액 초과 여부다', () => {
    expect(calc('20000000').isComprehensive).toBe(false)
    expect(calc('20000001').isComprehensive).toBe(true)
  })
})

describe('주입 상수의 정합성', () => {
  it('분리과세율 = 분리과세 소득세율 × (1 + 지방소득세 부가율)', () => {
    // 두 상수가 어긋나면 TC-01~03의 "추가납부 0"이 무너진다.
    // 시드 입력 오류를 여기서 잡는다
    const { separateTaxationIncomeTaxRate, localIncomeTaxRate } = CONSTANTS_2026
    const derived = calculateFinancialIncomeTax({
      financialIncome: '20000000',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    expect(derived.withheld.eq(derived.totalTax)).toBe(true)
    expect(String(separateTaxationIncomeTaxRate)).toBe('0.14')
    expect(String(localIncomeTaxRate)).toBe('0.1')
  })

  it('구간의 하한이 0에서 시작한다 — 누락되면 과세표준을 매핑할 수 없다', () => {
    expect(String(BRACKETS_2026[0].lowerBound)).toBe('0')
  })
})
