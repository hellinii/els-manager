import { describe, expect, it } from 'vitest'

import { toProductDetailView } from '@/lib/db/queries/map'
import { NO_ESTIMATE_RATES } from '@/lib/domain'
import { deriveDisplay } from '@/lib/format'

import {
  ASSET_1,
  OWNER,
  couponPayment,
  monthlyProductRow,
  priceMap,
  productRow,
  redemption,
} from './helpers/rows'

/**
 * §4.3 월수익 필드 — `coupons` · `unnumberedCouponRecords` · `monthlyCouponAnnualRate` · `pnlBreakdown` ·
 * 셋째 결함 `COUPON_SCHEDULE_MISSING` (P8 컷 b3-2, DOC-011 §4.3 · DOC-007 §7.6 · §9.4)
 *
 * 월지급 픽스처(`monthlyProductRow`): 발행 2026-10-16 · 원금 1억 · 월수익 연 7.2%(= 600,000원/월) · 월수익 12달 —
 * k번째 평가일 = 2026-11-16부터 매달 16일, 지급일 = 19일. 6번째 달(2027-04-16)이 1차 조기상환 평가일과 같은 날이다.
 */

const PRICED = priceMap([{ assetId: ASSET_1, price: '95.000000' }]) // 워스트오브 0.95
const view = (row = monthlyProductRow(), asOf = '2027-01-20', prices = PRICED) =>
  toProductDetailView(row, prices, asOf, OWNER, NO_ESTIMATE_RATES)

describe('상환 시 지급 상품 — 월수익 필드가 비고 상환 값은 종전과 같다', () => {
  it('coupons null · unnumbered [] · 월수익 연쿠폰율 null · 구성 null', () => {
    const v = toProductDetailView(
      productRow({ redemptions: redemption() }),
      PRICED,
      '2026-12-01',
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(v.coupons).toBeNull()
    expect(v.unnumberedCouponRecords).toEqual([])
    expect(v.product.monthlyCouponAnnualRate).toBeNull()
    expect(v.redemption?.pnlBreakdown).toBeNull()
    // 포트폴리오 손익 경로를 지나지 않는다 — 문자열이 종전 realizedPnl 그대로
    expect(v.redemption?.realizedPnl).toBe('4000000')
  })
})

describe('보유중 월지급 상품 — 상태 · 금액 · 다음 행 · 기록 가능', () => {
  it('월수익 금액은 q_k 하나다 — 600,000원(DOC-007 검산 B-1)', () => {
    const v = view()
    expect(v.product.monthlyCouponAnnualRate).toBe('0.0720')
    expect(v.coupons).toHaveLength(12)
    expect(new Set(v.coupons?.map((c) => c.expectedAmount))).toEqual(new Set(['600000']))
  })

  it('기준일 2027-01-20 — 1~2번째 달 미기록 · 3번째(지급 01-19 < 기준일) 미기록 · 4번째부터 예정', () => {
    const states = view().coupons?.map((c) => c.state)
    // 1: 11-19 지급 · 2: 12-19 · 3: 2027-01-19 — 셋 다 지급일 < 01-20
    expect(states?.slice(0, 4)).toEqual(['UNRECORDED', 'UNRECORDED', 'UNRECORDED', 'SCHEDULED'])
  })

  it('★ 흐름 끝 = 적용 차수 평가일(2027-04-16) — 6번째 달은 흐름 안, 7번째부터 「조기상환 가정 밖」', () => {
    const states = view().coupons?.map((c) => c.state)
    expect(states?.[5]).toBe('SCHEDULED') // 2027-04-16 — 경계 포함
    expect(states?.slice(6)).toEqual(Array(6).fill('BEYOND_ASSUMPTION'))
  })

  it('기록이 정본이다 — PAID · UNPAID와 기록 뷰', () => {
    const v = view(
      monthlyProductRow({
        monthly_coupon_payments: [
          couponPayment(),
          couponPayment({ id: 'payment-2', coupon_no: 2, outcome: 'UNPAID', payment_date: null, gross_amount: null, taxable_income: null, withholding_tax: null }),
        ],
      }),
    )
    expect(v.coupons?.[0]?.state).toBe('PAID')
    expect(v.coupons?.[0]?.record).toEqual({
      id: 'payment-1',
      outcome: 'PAID',
      paymentDate: '2026-11-19',
      grossAmount: '600000',
      taxableIncome: '600000',
      withholdingTax: '92400',
      exchangeRate: null,
      isConfirmed: true,
      note: null,
    })
    expect(v.coupons?.[1]?.state).toBe('UNPAID')
    expect(v.coupons?.[1]?.record?.grossAmount).toBeNull()
  })

  it('조건 판정은 다음 한 행에만 — 워스트오브 0.95 ≥ 배리어 0.60 → 예상 지급', () => {
    const results = view().coupons?.map((c) => c.conditionResult)
    // 다음 행 = 평가일 ≥ 2027-01-20 중 최소 = 4번째(2027-02-16). 3번째(01-16)는 이미 평가됐다
    expect(results?.filter((r) => r != null)).toEqual(['EXPECTED_PAID'])
    expect(results?.[3]).toBe('EXPECTED_PAID')
  })

  it('시세가 없으면(E-01) 다음 행은 UNKNOWN — 기본값을 대입하지 않는다', () => {
    const v = view(undefined, undefined, priceMap([{ assetId: ASSET_1, price: null }]))
    expect(v.coupons?.[3]?.conditionResult).toBe('UNKNOWN')
  })

  it('★ recordable은 「평가됨 ∧ 기록 없음」 — 평가가 끝났고 지급일 전인 달도 참이다', () => {
    // 기준일 2027-01-17: 3번째 달은 01-16 평가 · 01-19 지급 — 상태는 「예정」인데 기록 대상이다
    const v = view(monthlyProductRow({ monthly_coupon_payments: [couponPayment()] }), '2027-01-17')
    expect(v.coupons?.map((c) => c.recordable).slice(0, 4)).toEqual([false, true, true, false])
    expect(v.coupons?.[2]?.state).toBe('SCHEDULED')
  })
})

describe('상환된 월지급 상품 — 흐름 끝 = 상환일 · 포트폴리오 손익', () => {
  const redeemed = monthlyProductRow({
    redemptions: redemption({
      redemption_type: 'EARLY',
      round_no: 1,
      redemption_date: '2027-04-21',
      gross_amount: '100000000',
      taxable_income: '0',
      withholding_tax: '0',
    }),
    // 1~6번째 달 전부 지급 — 지급일은 일정과 같은 19일(2026-11-19 … 2027-04-19)
    monthly_coupon_payments: monthlyProductRow().monthly_coupon_schedules.slice(0, 6).map((s) =>
      couponPayment({ id: `payment-${s.coupon_no}`, coupon_no: s.coupon_no, payment_date: s.payment_date }),
    ),
  })

  it('★ 상환일 뒤에 평가되는 달은 「상환 후 없음」 — 「조기상환 가정 밖」이 아니다(민서 결정 ③)', () => {
    const states = view(redeemed, '2027-06-01').coupons?.map((c) => c.state)
    expect(states?.slice(0, 6)).toEqual(Array(6).fill('PAID'))
    expect(states?.slice(6)).toEqual(Array(6).fill('ENDED'))
  })

  it('조건 판정이 없다(E-05) · 기록할 달이 없다', () => {
    const coupons = view(redeemed, '2027-06-01').coupons
    expect(coupons?.every((c) => c.conditionResult == null)).toBe(true)
    expect(coupons?.some((c) => c.recordable)).toBe(false)
  })

  it('실현손익 = 상환 세전 + Σ PAID − 원금 = +3,600,000 · 구성 한 줄의 두 값(DOC-007 검산 B-3)', () => {
    const r = view(redeemed, '2027-06-01').redemption
    expect(r?.realizedPnl).toBe('3600000')
    expect(r?.pnlBreakdown).toEqual({ redemption: '0', coupons: '3600000' })
  })
})

describe('셋째 결함 COUPON_SCHEDULE_MISSING — 월수익만 억제한다', () => {
  const broken = monthlyProductRow({ monthly_coupon_schedules: [] })

  it('결함이고 coupons는 null이다(억제) — 차수 판정 · 워스트오브는 산다', () => {
    const v = view(broken)
    expect(v.product.integrityIssue).toBe('COUPON_SCHEDULE_MISSING')
    expect(v.coupons).toBeNull()
    expect(v.product.worstOf).toBe('0.9500')
    expect(v.projection).not.toBeNull()
    expect(deriveDisplay(v.product)).toMatchObject({ kind: 'INTEGRITY', label: '월수익 일정 없음 — 수정 필요' })
  })

  it('★ 판정은 존재 탐침을 읽는다 — 탐침이 비면 일정이 있어도 결함이다(차수 루트 흉내)', () => {
    // 상품 루트와 차수 루트가 같은 필드를 읽는다는 것의 음성 대조 — 일정 전체가 아니라 탐침이 판정 입력이다
    const v = view(monthlyProductRow({ coupon_schedule_probe: [] }))
    expect(v.product.integrityIssue).toBe('COUPON_SCHEDULE_MISSING')
  })

  it('기존 결함이 먼저다 — 기초자산 0건이면 UNDERLYING_MISSING', () => {
    const v = view(monthlyProductRow({ monthly_coupon_schedules: [], els_underlyings: [] }), undefined, new Map())
    expect(v.product.integrityIssue).toBe('UNDERLYING_MISSING')
  })

  it('시세 입력을 파괴한 결함(기초자산 0건)에서는 월수익 행이 살고 판정만 없다', () => {
    const v = view(monthlyProductRow({ els_underlyings: [] }), undefined, new Map())
    expect(v.coupons).toHaveLength(12)
    expect(v.coupons?.every((c) => c.conditionResult == null)).toBe(true)
  })
})

describe('기실현 월지급 상품 — 일정이 정의상 없다', () => {
  const realized = productRow({
    entry_mode: 'REALIZED_ONLY',
    issue_date: null,
    annual_coupon_rate: null,
    coupon_payout: 'MONTHLY',
    monthly_coupon_annual_rate: null,
    els_underlyings: [],
    redemption_schedules: [],
    redemptions: redemption({ redemption_type: 'MATURITY_LOSS', round_no: null, redemption_date: '2026-03-02', gross_amount: '70000000', taxable_income: '0', withholding_tax: '0' }),
    monthly_coupon_payments: [
      couponPayment({ id: 'p-b', coupon_no: null, payment_date: '2025-08-20' }),
      couponPayment({ id: 'p-a', coupon_no: null, payment_date: '2025-07-20' }),
    ],
  })

  it('결함이 아니다 · coupons [] · 순번 없는 기록은 지급일 순', () => {
    const v = toProductDetailView(realized, new Map(), '2026-10-03', OWNER, NO_ESTIMATE_RATES)
    expect(v.product.integrityIssue).toBeNull()
    expect(v.coupons).toEqual([])
    expect(v.unnumberedCouponRecords.map((r) => r.id)).toEqual(['p-a', 'p-b'])
  })

  it('실현손익에 순번 없는 PAID가 들어간다 — 70,000,000 + 1,200,000 − 100,000,000', () => {
    const v = toProductDetailView(realized, new Map(), '2026-10-03', OWNER, NO_ESTIMATE_RATES)
    expect(v.redemption?.realizedPnl).toBe('-28800000')
    expect(v.redemption?.pnlBreakdown).toEqual({ redemption: '-30000000', coupons: '1200000' })
  })
})

describe('달러 월지급 상품 — 금액은 상품 통화', () => {
  it('$10,000 · 연 24.24% → $202.00, 센트 고정 자릿수(Q-07)', () => {
    const v = view(monthlyProductRow({ currency: 'USD', principal: '10000.00', monthly_coupon_annual_rate: '0.2424' }))
    expect(v.coupons?.[0]?.expectedAmount).toBe('202.00')
  })
})
