import { describe, expect, it } from 'vitest'
import { dec } from '@/lib/decimal'
import {
  aggregateFinancialIncome,
  aggregateFinancialIncomeByOwnerYear,
  netProceeds,
} from '@/lib/tax/aggregate'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { calculateHealthInsurance } from '@/lib/tax/healthInsurance'
import { aggregateRealizedPnl, taxableIncome } from '@/lib/domain/proceeds'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import {
  TC17_REDEMPTIONS,
  TC18_REDEMPTION,
  TC_OWNER,
  TC_YEAR,
} from '../fixtures/products'
import { expectAmount } from '../fixtures/assert'

/** DOC-007 §10.5~§10.6 — 손실 통산 금지, 비과세 계좌 */

const TC_KEY = { ownerId: TC_OWNER, year: TC_YEAR }

describe('손실 통산 금지 (DOC-007 §10.5)', () => {
  const items = TC17_REDEMPTIONS.map((r) => ({
    ownerId: r.ownerId,
    year: r.year,
    taxableIncome: taxableIncome({
      accountType: r.accountType,
      principal: r.principal,
      redemption: { taxableIncome: r.taxableIncome },
    }),
  }))

  it('TC-17: 포트폴리오 손익 +1,000만, 과세 금융소득 2,000만', () => {
    // 포트폴리오 손익은 손실을 음수로 반영한다 (−1,000만 + 2,000만)
    expectAmount(aggregateRealizedPnl(TC17_REDEMPTIONS), '10000000')

    // 과세 금융소득은 손실을 통산하지 않는다. 1,000만이 아니라 2,000만이다
    const income = aggregateFinancialIncome({ key: TC_KEY, items })
    expectAmount(income.financialIncome, '20000000')
    expect(income.financialIncome.toString()).not.toBe('10000000')
  })

  it('두 값이 분기한다 — 같은 데이터에서 서로 다른 결과가 나와야 한다', () => {
    const pnl = aggregateRealizedPnl(TC17_REDEMPTIONS)
    const income = aggregateFinancialIncome({ key: TC_KEY, items })
    expect(pnl.eq(income.financialIncome)).toBe(false)
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
    const income = aggregateFinancialIncome({
      key: TC_KEY,
      items: [
        {
          ownerId: TC18_REDEMPTION.ownerId,
          year: TC18_REDEMPTION.year,
          // 증권사 확정값이 3,000만이어도 비과세 계좌는 0으로 처리한다
          taxableIncome: taxableIncome({
            accountType: TC18_REDEMPTION.accountType,
            principal: TC18_REDEMPTION.principal,
            redemption: { taxableIncome: TC18_REDEMPTION.taxableIncome },
          }),
        },
      ],
    })

    expectAmount(income.financialIncome, '0')

    const tax = calculateFinancialIncomeTax({
      financialIncome: income.financialIncome,
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    expectAmount(tax.totalTax, '0')
    expectAmount(tax.additionalPayment, '0')

    // 세후 회수액이 세전 실수령액과 같다 (§7.4)
    expectAmount(
      netProceeds({
        income,
        grossTotal: TC18_REDEMPTION.grossAmount,
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
        key: TC_KEY,
        items: [
          { ...TC_KEY, taxableIncome: '15000000' },
          { ...TC_KEY, taxableIncome: '3000000' },
        ],
        otherFinancialIncome: '2000000',
      }).financialIncome,
      '20000000',
    )
  })

  it('항목이 없으면 ELS 외 금융소득만 남는다', () => {
    expectAmount(
      aggregateFinancialIncome({
        key: TC_KEY,
        items: [],
        otherFinancialIncome: '500000',
      }).financialIncome,
      '500000',
    )
    expectAmount(
      aggregateFinancialIncome({ key: TC_KEY, items: [] }).financialIncome,
      '0',
    )
  })

  it('결과가 집계 키를 동반한다 — 값만 반환하지 않는다', () => {
    const income = aggregateFinancialIncome({ key: TC_KEY, items: [] })
    expect(income.ownerId).toBe(TC_OWNER)
    expect(income.year).toBe(TC_YEAR)
  })
})

describe('절대 규칙 #7 — 사용자 간 합산 금지 (DOC-007 §7.1)', () => {
  /**
   * 타입 수준 검증은 `npm run typecheck`가 수행한다. `@ts-expect-error`가 붙은
   * 줄이 오류를 내지 않으면 tsc가 "unused directive"로 실패한다. 같은 호출이
   * 런타임에서도 거부되는지 함께 확인한다.
   */
  it('다른 소유자의 항목은 컴파일되지 않는다', () => {
    expect(() =>
      aggregateFinancialIncome({
        key: { ownerId: 'owner-a', year: 2026 },
        items: [
          { ownerId: 'owner-a', year: 2026, taxableIncome: '10000000' },
          // @ts-expect-error — 다른 소유자의 금융소득을 같은 합계에 넣을 수 없다
          { ownerId: 'owner-b', year: 2026, taxableIncome: '20000000' },
        ],
      }),
    ).toThrow(RangeError)
  })

  it('다른 귀속연도의 항목도 컴파일되지 않는다', () => {
    expect(() =>
      aggregateFinancialIncome({
        key: { ownerId: 'owner-a', year: 2026 },
        items: [
          { ownerId: 'owner-a', year: 2026, taxableIncome: '10000000' },
          // @ts-expect-error — 집계 키는 (소유자, 귀속연도)다. 연도도 넘을 수 없다
          { ownerId: 'owner-a', year: 2027, taxableIncome: '20000000' },
        ],
      }),
    ).toThrow(RangeError)
  })

  it('런타임 값에서는 실행 시점에 거부한다', () => {
    // 운영에서 ownerId는 UUID이고 귀속연도는 상환일에서 유도한 값이라 타입이
    // string·number로 넓어지고 위 방어가 무력해진다. 두 방어는 대체 관계가
    // 아니라 보완 관계다 (§7.1)
    const ownerA: string = '11111111-1111-1111-1111-111111111111'
    const ownerB: string = '22222222-2222-2222-2222-222222222222'
    const year: number = 2026
    const nextYear: number = 2027

    expect(() =>
      aggregateFinancialIncome({
        key: { ownerId: ownerA, year },
        items: [
          { ownerId: ownerA, year, taxableIncome: '10000000' },
          { ownerId: ownerB, year, taxableIncome: '20000000' },
        ],
      }),
    ).toThrow(RangeError)

    expect(() =>
      aggregateFinancialIncome({
        key: { ownerId: ownerA, year },
        items: [{ ownerId: ownerA, year: nextYear, taxableIncome: '10000000' }],
      }),
    ).toThrow(RangeError)
  })
})

describe('키별 분할 집계 (DOC-007 §7.1)', () => {
  const items = [
    { ownerId: 'owner-a', year: 2026, taxableIncome: '10000000' },
    { ownerId: 'owner-b', year: 2026, taxableIncome: '20000000' },
    { ownerId: 'owner-a', year: 2027, taxableIncome: '30000000' },
    { ownerId: 'owner-a', year: 2026, taxableIncome: '5000000' },
  ]

  it('섞인 입력을 키별로 나눈다 — 하나의 합계에 담기지 않는다', () => {
    const groups = aggregateFinancialIncomeByOwnerYear({ items })

    expect(
      groups.map((g) => [g.ownerId, g.year, g.financialIncome.toString()]),
    ).toEqual([
      ['owner-a', 2026, '15000000'],
      ['owner-b', 2026, '20000000'],
      ['owner-a', 2027, '30000000'],
    ])

    // 전체 합계(6,500만)는 어느 결과에도 나타나지 않는다
    for (const group of groups) {
      expect(group.financialIncome.toString()).not.toBe('65000000')
    }
  })

  it('ELS 외 금융소득도 키에 귀속된다', () => {
    const groups = aggregateFinancialIncomeByOwnerYear({
      items: [{ ownerId: 'owner-a', year: 2026, taxableIncome: '10000000' }],
      otherFinancialIncome: [
        { ownerId: 'owner-a', year: 2026, amount: '2000000' },
        { ownerId: 'owner-b', year: 2026, amount: '7000000' },
      ],
    })

    expect(
      groups.map((g) => [g.ownerId, g.financialIncome.toString()]),
    ).toEqual([
      ['owner-a', '12000000'],
      // ELS가 없어도 이자·배당만으로 종합과세가 성립한다
      ['owner-b', '7000000'],
    ])
  })

  it('반환 순서가 입력 순서에 흔들리지 않는다 (ADR-003)', () => {
    const forward = aggregateFinancialIncomeByOwnerYear({ items })
    const reversed = aggregateFinancialIncomeByOwnerYear({
      items: [...items].reverse(),
    })
    expect(reversed.map((g) => `${g.ownerId}/${g.year}`)).toEqual(
      forward.map((g) => `${g.ownerId}/${g.year}`),
    )
  })
})

describe('세후 회수액 (DOC-007 §7.4)', () => {
  it('부담률이 0보다 크면 감액 항이 실제로 반영된다', () => {
    // TC-05와 같은 조건. F = 1억, A = 0 → 부담률 17.864%
    const income = aggregateFinancialIncome({
      key: TC_KEY,
      items: [{ ...TC_KEY, taxableIncome: '100000000' }],
    })
    const tax = calculateFinancialIncomeTax({
      financialIncome: income.financialIncome,
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    expectAmount(tax.effectiveRate, '0.17864')

    const grossTotal = '1100000000'
    const net = netProceeds({
      income,
      grossTotal,
      effectiveRate: tax.effectiveRate,
    })

    // 1,100,000,000 − 100,000,000 × 0.17864 = 1,082,136,000
    expectAmount(net, '1082136000')

    // 감액분이 총세액과 일치한다. 항을 지우거나 부호를 뒤집으면 여기서 깨진다
    expect(net.eq(dec(grossTotal).minus(tax.totalTax))).toBe(true)
    expect(net.lt(dec(grossTotal))).toBe(true)
  })

  it('세전 실수령액이 그대로 남는 것은 부담률이 0일 때뿐이다', () => {
    const income = aggregateFinancialIncome({
      key: TC_KEY,
      items: [{ ...TC_KEY, taxableIncome: '0' }],
    })
    expectAmount(
      netProceeds({ income, grossTotal: '130000000', effectiveRate: '0' }),
      '130000000',
    )
  })
})
