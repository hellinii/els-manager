import { describe, expect, it } from 'vitest'
import { aggregateFinancialIncome, netProceeds } from '@/lib/tax/aggregate'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { calculateHealthInsurance } from '@/lib/tax/healthInsurance'
import { aggregateRealizedPnl, taxableIncome } from '@/lib/domain/proceeds'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { TC17_REDEMPTIONS, TC18_REDEMPTION } from '../fixtures/products'
import { expectAmount } from '../fixtures/assert'

/** DOC-007 §10.5~§10.6 — 손실 통산 금지, 비과세 계좌 */

describe('손실 통산 금지 (DOC-007 §10.5)', () => {
  it('TC-17: 포트폴리오 손익 +1,000만, 과세 금융소득 2,000만', () => {
    const items = TC17_REDEMPTIONS.map((r) => ({
      taxableIncome: taxableIncome({
        accountType: r.accountType,
        principal: r.principal,
        redemption: { taxableIncome: r.taxableIncome },
      }),
    }))

    // 포트폴리오 손익은 손실을 음수로 반영한다 (−1,000만 + 2,000만)
    expectAmount(aggregateRealizedPnl(TC17_REDEMPTIONS), '10000000')

    // 과세 금융소득은 손실을 통산하지 않는다. 1,000만이 아니라 2,000만이다
    const financialIncome = aggregateFinancialIncome({ items })
    expectAmount(financialIncome, '20000000')
    expect(financialIncome.toString()).not.toBe('10000000')
  })

  it('두 값이 분기한다 — 같은 데이터에서 서로 다른 결과가 나와야 한다', () => {
    const pnl = aggregateRealizedPnl(TC17_REDEMPTIONS)
    const items = TC17_REDEMPTIONS.map((r) => ({
      taxableIncome: taxableIncome({
        accountType: r.accountType,
        principal: r.principal,
        redemption: { taxableIncome: r.taxableIncome },
      }),
    }))
    expect(pnl.eq(aggregateFinancialIncome({ items }))).toBe(false)
  })

  it('개별 손실 상환의 과세 금융소득은 0이며 음수가 되지 않는다', () => {
    const loss = TC17_REDEMPTIONS[0]
    expectAmount(
      taxableIncome({
        accountType: loss.accountType,
        principal: loss.principal,
        redemption: { taxableIncome: loss.taxableIncome },
      }),
      '0',
    )
  })
})

describe('비과세 계좌 (DOC-007 §10.6)', () => {
  it('TC-18: TAX_FREE 이익 3,000만 → 과세 금융소득 0, 세액 0, 세후 = 세전', () => {
    const income = taxableIncome({
      accountType: TC18_REDEMPTION.accountType,
      principal: TC18_REDEMPTION.principal,
      redemption: { taxableIncome: TC18_REDEMPTION.taxableIncome },
    })

    // 증권사 확정값이 3,000만이어도 비과세 계좌는 0으로 처리한다
    expectAmount(income, '0')

    const financialIncome = aggregateFinancialIncome({
      items: [{ taxableIncome: income }],
    })
    expectAmount(financialIncome, '0')

    const tax = calculateFinancialIncomeTax({
      financialIncome,
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    expectAmount(tax.totalTax, '0')
    expectAmount(tax.additionalPayment, '0')

    // 세후 회수액이 세전 실수령액과 같다 (§7.4)
    expectAmount(
      netProceeds({
        grossTotal: TC18_REDEMPTION.grossAmount,
        financialIncome,
        effectiveRate: tax.effectiveRate,
      }),
      '130000000',
    )
  })

  it('비과세 계좌는 건강보험료도 발생시키지 않는다', () => {
    const r = calculateHealthInsurance({
      financialIncome: '0',
      subscriberType: 'REGIONAL',
      constants: CONSTANTS_2026,
    })
    expectAmount(r.total, '0')
  })
})

describe('연도별 금융소득 집계 (DOC-007 §7.3)', () => {
  it('ELS 외 금융소득을 합산한다', () => {
    expectAmount(
      aggregateFinancialIncome({
        items: [{ taxableIncome: '15000000' }, { taxableIncome: '3000000' }],
        otherFinancialIncome: '2000000',
      }),
      '20000000',
    )
  })

  it('항목이 없으면 ELS 외 금융소득만 남는다', () => {
    expectAmount(
      aggregateFinancialIncome({ items: [], otherFinancialIncome: '500000' }),
      '500000',
    )
    expectAmount(aggregateFinancialIncome({ items: [] }), '0')
  })
})
