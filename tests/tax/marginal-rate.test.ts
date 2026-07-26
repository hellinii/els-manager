import { describe, expect, it } from 'vitest'
import { marginalRateTable, realMarginalRate } from '@/lib/tax/marginalRate'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { percent2 } from '../fixtures/assert'

/** DOC-007 §10.4 — 실질 한계 부담률 */

const rate = (bracketRate: string) =>
  percent2(realMarginalRate(bracketRate, CONSTANTS_2026))

describe('실질 한계 부담률 (DOC-007 §10.4)', () => {
  it('TC-14: 소득세율 6% → 14.73%', () => {
    expect(rate('0.06')).toBe('14.73%')
  })

  it('TC-15: 소득세율 24% → 34.53%', () => {
    expect(rate('0.24')).toBe('34.53%')
  })

  it('TC-16: 소득세율 45% → 57.63%', () => {
    expect(rate('0.45')).toBe('57.63%')
  })
})

describe('§5.6 구간별 실질 한계 부담률 표 전체', () => {
  const expected: ReadonlyArray<readonly [string, string, string]> = [
    // [소득세율, 세금 한계(지방세 포함), 실질 한계]
    ['0.06', '6.60%', '14.73%'],
    ['0.15', '16.50%', '24.63%'],
    ['0.24', '26.40%', '34.53%'],
    ['0.35', '38.50%', '46.63%'],
    ['0.38', '41.80%', '49.93%'],
    ['0.40', '44.00%', '52.13%'],
    ['0.42', '46.20%', '54.33%'],
    ['0.45', '49.50%', '57.63%'],
  ]

  it('8개 구간 모두 문서의 표와 일치한다', () => {
    const table = marginalRateTable(BRACKETS_2026, CONSTANTS_2026)
    expect(table).toHaveLength(expected.length)

    table.forEach((row, i) => {
      const [incomeTaxRate, taxMarginal, real] = expected[i]
      expect(row.incomeTaxRate.eq(incomeTaxRate)).toBe(true)
      expect(percent2(row.taxMarginalRate)).toBe(taxMarginal)
      expect(percent2(row.realMarginalRate)).toBe(real)
    })
  })

  it('건강보험·장기요양 부담은 구간과 무관하게 일정하다', () => {
    const table = marginalRateTable(BRACKETS_2026, CONSTANTS_2026)
    for (const row of table) {
      expect(percent2(row.healthInsuranceRate)).toBe('7.19%')
      expect(percent2(row.longTermCareRate)).toBe('0.94%')
    }
  })

  it('구간은 하한 오름차순으로 정렬된다', () => {
    const table = marginalRateTable(BRACKETS_2026, CONSTANTS_2026)
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i].lowerBound.gt(table[i - 1].lowerBound)).toBe(true)
    }
  })
})
