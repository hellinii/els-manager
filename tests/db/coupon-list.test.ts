import { describe, expect, it } from 'vitest'

import { totalsByCurrency } from '@/lib/db/queries/dashboard'
import { attentionReasonsFor, judge, toProductListItem } from '@/lib/db/queries/map'
import { attentionChipLabel, couponSummaryOf, groupAttention, monthlyRateLabel } from '@/lib/format'

import { ASSET_1, OWNER, couponPayment, monthlyProductRow, priceMap, productRow, redemption } from './helpers/rows'

/**
 * §4.2 목록 · §4.1 홈의 월수익 필드 (P8 컷 b3-5, DOC-011 §4.1 · §4.2 · DOC-008 SCR-201 ⑮ · SCR-101 ② ④)
 *
 * 픽스처(`monthlyProductRow`): 원금 1억 · 월 600,000원 · 12달(평가 2026-11-16부터 매달 16일 · 지급 19일) · 배리어 60%.
 */

const PRICED = priceMap([{ assetId: ASSET_1, price: '95.000000' }])
const item = (row = monthlyProductRow(), asOf = '2027-01-20') => toProductListItem(row, PRICED, asOf, OWNER)

describe('§4.2 — couponPayout · couponProgress · terms.monthlyCoupon', () => {
  it('보유중 월지급 — 지급 1/12 · 기록 2 · 다음 평가일과 D-Day는 계약이 준다', () => {
    const v = item(
      monthlyProductRow({
        monthly_coupon_payments: [
          couponPayment(),
          couponPayment({ id: 'p-2', coupon_no: 2, outcome: 'UNPAID', payment_date: null, gross_amount: null, taxable_income: null, withholding_tax: null }),
        ],
      }),
    )
    expect(v.couponPayout).toBe('MONTHLY')
    // 미지급은 분자에 들지 않는다 — 「지급 5/36」은 받은 달 수다
    expect(v.couponProgress).toEqual({ paid: 1, recorded: 2, total: 12, nextEvaluationDate: '2027-02-16', nextDDay: 27 })
    expect(v.terms.monthlyCoupon).toEqual({ annualRate: '0.0720', barrier: '0.6000' })
  })

  it('배리어가 달마다 다르면 null · 상환 완료면 다음이 없다', () => {
    const varied = monthlyProductRow()
    varied.monthly_coupon_schedules[3] = { ...varied.monthly_coupon_schedules[3]!, coupon_barrier: '0.5000' }
    expect(item(varied).terms.monthlyCoupon?.barrier).toBeNull()
    const redeemed = item(monthlyProductRow({ redemptions: redemption({ redemption_date: '2027-01-05', gross_amount: '100000000', taxable_income: '0' }) }))
    expect(redeemed.couponProgress).toMatchObject({ nextEvaluationDate: null, nextDDay: null })
  })

  it('상환 시 지급은 둘 다 null', () => {
    const v = item(productRow())
    expect(v.couponPayout).toBe('AT_REDEMPTION')
    expect(v.couponProgress).toBeNull()
    expect(v.terms.monthlyCoupon).toBeNull()
  })

  it('★ 셋째 결함 — 진행은 억제(null) · 계약 조건은 남되 배리어는 null(고를 값이 없다)', () => {
    const v = item(monthlyProductRow({ monthly_coupon_schedules: [] }))
    expect(v.integrityIssue).toBe('COUPON_SCHEDULE_MISSING')
    expect(v.couponProgress).toBeNull()
    expect(v.terms.monthlyCoupon).toEqual({ annualRate: '0.0720', barrier: null })
    // 화면은 결함으로 가른다 — 「월수익 배리어 달마다 다름」이라는 거짓 조각을 그리지 않는다
    expect(couponSummaryOf(v)).toBeNull()
  })
})

describe('⑮ 월수익 요약 · 월 쿠폰율 표기', () => {
  it('나누어떨어지면 그대로, 아니면 반올림 + 「≈」', () => {
    expect(monthlyRateLabel('0.2424')).toBe('월 2.02%')
    expect(monthlyRateLabel('0.0720')).toBe('월 0.6%')
    expect(monthlyRateLabel('0.0730')).toBe('월 ≈0.61%')
  })

  it('조각 넷 — 「월 0.6% · 월수익 배리어 60% · 지급 0/12 · 다음 D-27」', () => {
    expect(couponSummaryOf(item())).toBe('월 0.6% · 월수익 배리어 60% · 지급 0/12 · 다음 D-27')
  })

  it('상환 시 지급은 요약이 없다', () => {
    expect(couponSummaryOf(item(productRow()))).toBeNull()
  })
})

describe('§4.1 — 받은 월수익 · 월수익을 포함한 실현손익', () => {
  const active = monthlyProductRow({ id: 'm-active', monthly_coupon_payments: [couponPayment()] })
  const redeemed = monthlyProductRow({
    id: 'm-redeemed',
    redemptions: redemption({ redemption_date: '2027-04-21', round_no: 1, gross_amount: '100000000', taxable_income: '0' }),
    monthly_coupon_payments: [couponPayment(), couponPayment({ id: 'p-2', coupon_no: 2, payment_date: '2026-12-19' })],
  })

  it('★ 보유중의 지급은 받은 월수익 · 상환된 상품의 지급은 실현손익 — 한 월수익이 두 줄에 있지 않다', () => {
    const rows = [active, redeemed]
    expect(totalsByCurrency(rows, [active], [redeemed])).toEqual([
      { currency: 'KRW', activeCount: 1, activePrincipal: '100000000', realizedPnl: '1200000', receivedCoupons: '600000' },
    ])
  })
})

describe('조치 사유 — 월수익 미기록은 결함 다음 · E-05 앞', () => {
  it('보유중 — [미기록, …]', () => {
    const j = judge(monthlyProductRow(), PRICED, '2027-01-20')
    expect(attentionReasonsFor(j, 3)).toEqual(['COUPON_UNRECORDED'])
    // 기본 0 — 종전 호출부가 그대로
    expect(attentionReasonsFor(j)).toEqual([])
  })

  it('★ 상환된 상품에서도 뜬다 — 조기 반환 앞에서 계산한다(DOC-007 §9.4)', () => {
    const j = judge(monthlyProductRow({ redemptions: redemption({ gross_amount: '100000000', taxable_income: '0' }) }), PRICED, '2027-01-20')
    expect(attentionReasonsFor(j, 2)).toEqual(['COUPON_UNRECORDED'])
  })

  it('결함이 먼저다', () => {
    const j = judge(monthlyProductRow({ els_underlyings: [] }), new Map(), '2027-01-20')
    expect(attentionReasonsFor(j, 1).slice(0, 2)).toEqual(['UNDERLYING_MISSING', 'COUPON_UNRECORDED'])
  })

  it('칩 — 「월수익 미기록 · 3개월」 · 개수 없는 사유는 그대로 · 그룹이 개수를 나른다', () => {
    expect(attentionChipLabel('월수익 미기록', 3)).toBe('월수익 미기록 · 3개월')
    expect(attentionChipLabel('KI 근접', undefined)).toBe('KI 근접')
    const [group] = groupAttention([
      { productId: 'a', productName: 'A', ownerName: 'o', reason: 'COUPON_UNRECORDED', count: 3 },
      { productId: 'a', productName: 'A', ownerName: 'o', reason: 'KI_NEAR' },
    ])
    expect(group?.counts).toEqual({ COUPON_UNRECORDED: 3 })
  })
})
