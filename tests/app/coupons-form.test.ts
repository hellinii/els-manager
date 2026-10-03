import { describe, expect, it } from 'vitest'

import { toProductDetailView } from '@/lib/db/queries/map'
import { NO_ESTIMATE_RATES } from '@/lib/domain'
import {
  COUPON_ROW_COUNT_FIELD,
  couponEditValuesOf,
  couponFieldNames,
  couponFormValuesOf,
  couponRowsOf,
  findCouponRecord,
  parseCouponEditForm,
  parseCouponRecordForm,
  recordedCouponIds,
  rowName,
  toRowErrors,
} from '@/lib/forms/coupons'
import { formOfValues } from '@/lib/forms/parse'

import { ASSET_1, OWNER, couponPayment, monthlyProductRow, priceMap, productRow, redemption } from '../db/helpers/rows'

/**
 * SCR-206 월수익 기록 — 다행 폼 (P8 컷 b3, DOC-008 SCR-206 · DOC-007 §4.7 · SQ-21 ⓘ b3 개정)
 *
 * 픽스처(`monthlyProductRow`): 원금 1억 · 월 600,000원 · k번째 평가일 2026-11-16부터 매달 16일 · 지급일 19일.
 */

const PRICED = priceMap([{ assetId: ASSET_1, price: '95.000000' }])
const detail = (row = monthlyProductRow(), asOf = '2027-01-20') =>
  toProductDetailView(row, PRICED, asOf, OWNER, NO_ESTIMATE_RATES)

describe('기본 목록 — recordable로 고른다', () => {
  it('기록 없는 평가된 달만 — 1번째(지급 기록) 빼고 2 · 3번째', () => {
    const rows = couponRowsOf(detail(monthlyProductRow({ monthly_coupon_payments: [couponPayment()] })))
    expect(rows.map((r) => r.couponNo)).toEqual([2, 3])
    expect(rows[0]?.label).toBe('2번째 · 2026-12-16')
    expect(rows[0]?.scheduledPaymentDate).toBe('2026-12-19')
  })

  it('★ 상환된 상품의 상환 후 달은 목록에 없다 — 흐름 끝(상환일)과 같은 키', () => {
    const row = monthlyProductRow({
      redemptions: redemption({ round_no: 1, redemption_date: '2027-01-01', gross_amount: '100000000', taxable_income: '0' }),
    })
    // 기준일 2027-06-01 — 평가된 달은 1~7번째인데 상환일(01-01) 이전 평가는 1 · 2번째뿐
    expect(couponRowsOf(detail(row, '2027-06-01')).map((r) => r.couponNo)).toEqual([1, 2])
  })

  it('기실현 월지급은 순번 없는 빈 행 — 최소 1', () => {
    const realized = toProductDetailView(
      productRow({
        entry_mode: 'REALIZED_ONLY',
        issue_date: null,
        annual_coupon_rate: null,
        coupon_payout: 'MONTHLY',
        els_underlyings: [],
        redemption_schedules: [],
        redemptions: redemption({ redemption_type: 'MATURITY_LOSS', round_no: null }),
      }),
      new Map(),
      '2026-10-03',
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(couponRowsOf(realized)).toHaveLength(1)
    expect(couponRowsOf(realized, 3)).toHaveLength(3)
    expect(couponRowsOf(realized, 0)).toHaveLength(1)
    expect(couponRowsOf(realized)[0]).toMatchObject({ couponNo: null, label: null })
  })
})

describe('기본값 — DOC-007 §4.7 표', () => {
  it('원화 일반계좌 — 결과 빈칸 · 지급일 = 일정 · 세전 = q_k · 과세 = 세전 · 원천징수 빈칸 · 확정 끔', () => {
    expect(couponRowsOf(detail())[0]?.defaults).toEqual({
      outcome: '',
      paymentDate: '2026-11-19',
      grossAmount: '600000',
      taxableIncome: '600000',
      withholdingTax: '',
      exchangeRate: '',
      isConfirmed: '',
      note: '',
    })
  })

  it('비과세 계좌는 과세 0 · 달러는 과세 빈칸(U1)', () => {
    expect(couponRowsOf(detail(monthlyProductRow({ account_type: 'TAX_FREE' })))[0]?.defaults.taxableIncome).toBe('0')
    const usd = detail(monthlyProductRow({ currency: 'USD', principal: '10000.00', monthly_coupon_annual_rate: '0.2424' }))
    expect(couponRowsOf(usd)[0]?.defaults).toMatchObject({ grossAmount: '202.00', taxableIncome: '' })
  })

  it('폼 값은 rows[r].… 이름 · 순번 · 행 수를 싣는다', () => {
    const values = couponFormValuesOf(couponRowsOf(detail()))
    expect(values[COUPON_ROW_COUNT_FIELD]).toBe('3')
    expect(values['rows[0].couponNo']).toBe('1')
    expect(values['rows[2].grossAmount']).toBe('600000')
    expect(couponFieldNames(2)).toContain('rows[1].note')
  })
})

describe('파싱 — 결과를 고른 행만 · 미지급은 금액을 버린다', () => {
  const base = couponFormValuesOf(couponRowsOf(detail()))

  it('결과 빈칸 행은 건너뛰고 실은 순서의 행 번호를 낸다', () => {
    const form = formOfValues({ ...base, [rowName(1, 'outcome')]: 'PAID', [rowName(2, 'outcome')]: 'UNPAID' })
    const { entries, rowOf } = parseCouponRecordForm(form, 3)
    expect(rowOf).toEqual([1, 2])
    expect(entries.map((e) => [e.couponNo, e.outcome])).toEqual([
      [2, 'PAID'],
      [3, 'UNPAID'],
    ])
  })

  it('★ 미지급 행 — 미리 채운 지급일 · 세전 · 과세가 남아 있어도 싣지 않는다(V-28이 거부할 값)', () => {
    const form = formOfValues({ ...base, [rowName(0, 'outcome')]: 'UNPAID', [rowName(0, 'exchangeRate')]: '1385.2' })
    const [entry] = parseCouponRecordForm(form, 3).entries
    expect(entry).toEqual({ couponNo: 1, outcome: 'UNPAID', isConfirmed: false })
  })

  it('지급 행 — 쉼표를 지우고, 빈 원천징수는 보내지 않는다(서버가 채운다)', () => {
    const form = formOfValues({
      ...base,
      [rowName(0, 'outcome')]: 'PAID',
      [rowName(0, 'grossAmount')]: '600,000',
      [rowName(0, 'isConfirmed')]: 'on',
      [rowName(0, 'note')]: '거래내역',
    })
    const [entry] = parseCouponRecordForm(form, 3).entries
    expect(entry).toEqual({
      couponNo: 1,
      outcome: 'PAID',
      paymentDate: '2026-11-19',
      grossAmount: '600000',
      taxableIncome: '600000',
      isConfirmed: true,
      note: '거래내역',
    })
  })

  it('기실현 행은 순번이 null이다', () => {
    const form = formOfValues({ [rowName(0, 'couponNo')]: '', [rowName(0, 'outcome')]: 'PAID', [rowName(0, 'paymentDate')]: '2025-07-20' })
    expect(parseCouponRecordForm(form, 1).entries[0]?.couponNo).toBeNull()
  })
})

describe('오류의 자리 — entries[i] → rows[rowOf[i]] · 색인 없는 키는 그대로', () => {
  it('행 단위 키는 화면 행으로, DB 제약의 색인 없는 키 · 범위 밖 색인은 상단 요약으로', () => {
    const result = toRowErrors(
      {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '입력값을 확인한다.',
          fields: {
            'entries[1].paymentDate': '지급일 오류',
            'entries[0].withholdingTax': '원천징수 오류',
            paymentDate: '같은 지급일의 기록이 이미 있다',
            'entries[9].grossAmount': '사라진 행',
          },
        },
      },
      [2, 5],
    )
    expect(result.ok ? null : result.error.fields).toEqual({
      'rows[5].paymentDate': '지급일 오류',
      'rows[2].withholdingTax': '원천징수 오류',
      paymentDate: '같은 지급일의 기록이 이미 있다',
      'entries[9].grossAmount': '사라진 행',
    })
  })
})

describe('수정 · 삭제 — 기록 id', () => {
  const view = detail(
    monthlyProductRow({
      monthly_coupon_payments: [couponPayment(), couponPayment({ id: 'payment-2', coupon_no: 2, outcome: 'UNPAID', payment_date: null, gross_amount: null, taxable_income: null, withholding_tax: null })],
    }),
  )

  it('수정 폼의 초기값은 저장값이고 다시 파싱하면 같은 입력이다 — 원천징수세액을 비우지 않는다', () => {
    const found = findCouponRecord(view, 'payment-1')
    expect(found?.coupon?.couponNo).toBe(1)
    const values = couponEditValuesOf(found!.record)
    expect(values[rowName(0, 'withholdingTax')]).toBe('92400')
    expect(parseCouponEditForm(formOfValues(values))).toEqual({
      outcome: 'PAID',
      paymentDate: '2026-11-19',
      grossAmount: '600000',
      taxableIncome: '600000',
      withholdingTax: '92400',
      isConfirmed: true,
    })
  })

  it('없는 id는 null · 전부 지우기는 기록 id 전부', () => {
    expect(findCouponRecord(view, 'nope')).toBeNull()
    expect(recordedCouponIds(view)).toEqual(['payment-1', 'payment-2'])
  })
})
