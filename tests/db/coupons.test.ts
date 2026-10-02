import { describe, expect, it } from 'vitest'

import { checkAgainstProduct, type Checked } from '@/lib/db/mutations/coupons'
import { couponMonthLabel, latestRecordedMonth } from '@/lib/db/mutations/couponMonths'
import { Problems } from '@/lib/db/validate/primitives'

import { couponPayment, monthlyProductRow, productRow, redemption } from './helpers/rows'

/**
 * 월수익 기록의 사전 검사 — 부모 상품을 읽어야 보이는 규칙 (DOC-011 §5.14 · §5.15 · V-27 · V-28 · V-23 · V-24 ⓐ, P8 컷 b2)
 *
 * **DB 없이 본다.** 같은 사실을 DB가 다시 막지만(I-26 · I-27 — `tests/rls/monthly-coupons.test.ts`) 그 응답은 행 키가
 * 없다(DOC-002 §8 「DB 오류의 필드 키」). 행 키(`entries[i].…`)로 어느 행을 고칠지 말하는 것은 이 층뿐이고, 그 판단은
 * 행 픽스처로 결정적으로 볼 수 있다.
 */

const ASOF = '2027-06-30'

function paid(overrides: Partial<Checked> = {}): Checked {
  return {
    couponNo: 1,
    outcome: 'PAID',
    paymentDate: '2026-11-19',
    grossAmount: '600000',
    taxableIncome: '600000',
    isConfirmed: true,
    ...overrides,
  }
}

function unpaid(couponNo: number): Checked {
  return { couponNo, outcome: 'UNPAID', isConfirmed: true }
}

function check(
  entries: Checked[],
  product = monthlyProductRow(),
  selfId: string | null = null,
  asOf = ASOF,
) {
  const p = new Problems()
  const checked = checkAgainstProduct(
    p,
    entries.map((entry, index) => ({ at: `entries[${index}].`, entry })),
    product,
    asOf,
    selfId,
  )
  return { fields: p.fields(), rules: p.rules(), checked }
}

describe('V-27 — FULL 상품의 기록 대상', () => {
  it('정상 — 지급 · 미지급을 함께 기록한다', () => {
    expect(check([paid(), unpaid(2)]).fields).toEqual({})
  })

  it('일정에 없는 순번은 거부한다 — 그 행의 순번 칸', () => {
    expect(check([paid({ couponNo: 13, paymentDate: '2027-11-19' })]).fields).toHaveProperty(['entries[0].couponNo'])
  })

  it('아직 평가되지 않은 달은 거부한다 — 평가일 > 기준일', () => {
    const { fields } = check([unpaid(9)], monthlyProductRow(), null, '2027-06-30')
    // 9번째 = 2027-07-16 평가 > 기준일
    expect(fields['entries[0].couponNo']).toContain('아직 평가되지 않은 달이다 — 9번째 · 2027-07-16')
  })

  it('이미 기록된 달 — 저장된 기록 · 같은 입력의 다른 행 둘 다', () => {
    const product = monthlyProductRow({ monthly_coupon_payments: [couponPayment()] })
    expect(check([paid({ paymentDate: '2026-11-20' })], product).fields['entries[0].couponNo']).toContain(
      '이미 기록된 달이다 — 1번째 · 2026-11-16',
    )
    expect(check([unpaid(2), unpaid(2)]).fields).toHaveProperty(['entries[1].couponNo'])
  })

  it('§5.15 — 그 기록 자신은 「이미 기록됨」에서 뺀다', () => {
    const product = monthlyProductRow({ monthly_coupon_payments: [couponPayment({ id: 'self' })] })
    expect(check([paid()], product, 'self').fields).toEqual({})
  })

  it('★ 상환이 있으면 그 달의 평가일 ≤ 상환일 — 비교 키는 평가일이다(RD-18)', () => {
    const product = monthlyProductRow({
      redemptions: redemption({ redemption_date: '2027-04-16', round_no: 1 }),
    })
    // 6번째(평가 2027-04-16) — 지급일(2027-04-19)이 상환일 뒤여도 통과한다
    expect(check([paid({ couponNo: 6, paymentDate: '2027-04-19' })], product).fields).toEqual({})
    // 7번째(평가 2027-05-16) — 지급이든 미지급이든 거부한다
    expect(check([unpaid(7)], product).fields['entries[0].couponNo']).toContain('상환일(2027-04-16) 뒤에 평가되는 달이다')
    expect(check([paid({ couponNo: 7, paymentDate: '2027-05-19' })], product).fields).toHaveProperty([
      'entries[0].couponNo',
    ])
  })

  it('순번이 없으면 「순번을 고른다」다 — FULL은 순번이 필수다', () => {
    expect(check([paid({ couponNo: null })]).fields['entries[0].couponNo']).toBe('월수익 순번을 고른다.')
  })
})

describe('V-27 — 기실현 상품의 기록 대상', () => {
  const realized = () =>
    productRow({
      entry_mode: 'REALIZED_ONLY',
      issue_date: null,
      annual_coupon_rate: null,
      coupon_payout: 'MONTHLY',
      redemption_schedules: [],
      els_underlyings: [],
      redemptions: redemption({ round_no: null, redemption_date: '2026-04-16' }),
    })

  it('순번 없는 지급만 받는다 — 상환일 비교 밖이다', () => {
    expect(check([paid({ couponNo: null, paymentDate: '2026-05-19' })], realized()).fields).toEqual({})
  })

  it('순번이 있으면 · 미지급이면 거부한다 — 적을 달이 없다', () => {
    expect(check([paid({ couponNo: 1 })], realized()).fields).toHaveProperty(['entries[0].couponNo'])
    expect(check([{ couponNo: null, outcome: 'UNPAID', isConfirmed: true }], realized()).fields).toHaveProperty([
      'entries[0].outcome',
    ])
  })

  it('상품당 60건 이하 — 저장된 기록과 합쳐 센다', () => {
    const stored = Array.from({ length: 59 }, (_, index) =>
      couponPayment({ id: `p${index}`, coupon_no: null, payment_date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}` }),
    )
    const product = { ...realized(), monthly_coupon_payments: stored }
    const two = [paid({ couponNo: null, paymentDate: '2026-02-01' }), paid({ couponNo: null, paymentDate: '2026-03-01' })]
    expect(check(two, product).fields.entries).toContain('60건까지')
    expect(check([two[0]!], product).fields).toEqual({})
  })
})

describe('V-28 — 지급의 형태 중 부모 · 기준일이 필요한 것', () => {
  it('아직 오지 않은 지급은 기록하지 않는다 — 지급일 > 기준일', () => {
    expect(check([paid({ paymentDate: '2027-07-01' })]).fields['entries[0].paymentDate']).toContain('아직 오지 않은 지급')
  })

  it('FULL이면 지급일 ≥ 그 달 평가일', () => {
    expect(check([paid({ paymentDate: '2026-11-15' })]).fields['entries[0].paymentDate']).toContain('2026-11-16')
  })

  it('지급일 중복 — 저장된 다른 지급 · 같은 입력의 다른 행. 미지급 기록은 지급일이 없어 세지 않는다', () => {
    const product = monthlyProductRow({ monthly_coupon_payments: [couponPayment()] })
    expect(check([paid({ couponNo: 2, paymentDate: '2026-11-19' })], product).fields).toHaveProperty([
      'entries[0].paymentDate',
    ])
    expect(
      check([paid({ couponNo: 2, paymentDate: '2026-12-21' }), paid({ couponNo: 3, paymentDate: '2026-12-21' })]).fields,
    ).toHaveProperty(['entries[1].paymentDate'])
  })
})

describe('V-23 · V-24 ⓐ — 부모의 통화', () => {
  it('원화 부모의 센트 세전은 거부한다 · 적용 환율은 외화 상품에만', () => {
    expect(check([paid({ grossAmount: '600000.5' })]).fields).toHaveProperty(['entries[0].grossAmount'])
    expect(check([paid({ exchangeRate: '1385.2' })]).fields).toHaveProperty(['entries[0].exchangeRate'])
  })

  it('달러 부모는 센트까지 받고 고정 자릿수로 정규화한다', () => {
    const usd = monthlyProductRow({ currency: 'USD', principal: '10000.00' })
    const { fields, checked } = check([paid({ grossAmount: '202.0', taxableIncome: '279810', exchangeRate: '1385.2' })], usd)
    expect(fields).toEqual({})
    expect(checked[0]!.grossAmount).toBe('202.00')
  })
})

describe('기록된 달의 최댓값 — 상환 쪽 V-27의 기준 (§5.4 · §5.5)', () => {
  it('지급 · 미지급 모두 센다 — 순번 없는 기록은 평가일이 없어 세지 않는다', () => {
    const product = monthlyProductRow({
      monthly_coupon_payments: [
        couponPayment({ id: 'a', coupon_no: 3, payment_date: '2027-01-19' }),
        couponPayment({ id: 'b', coupon_no: 6, outcome: 'UNPAID', payment_date: null, gross_amount: null, taxable_income: null, withholding_tax: null }),
        couponPayment({ id: 'c', coupon_no: null, payment_date: '2028-01-01' }),
      ],
    })
    expect(latestRecordedMonth(product)).toEqual({ couponNo: 6, evaluationDate: '2027-04-16' })
  })

  it('기록이 없으면 없다', () => {
    expect(latestRecordedMonth(monthlyProductRow())).toBeNull()
  })

  it('표기는 「5번째 · 2027-02-16」이다 (GQ-04)', () => {
    expect(couponMonthLabel(5, '2027-02-16')).toBe('5번째 · 2027-02-16')
  })
})
