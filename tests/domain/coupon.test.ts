import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  COUPON_STATES,
  couponAmount,
  couponConditionOf,
  couponFlowEndOf,
  couponStateOf,
  isCouponBeforeRedemption,
  isCouponEvaluated,
  isCouponRecordable,
  isWithinCouponFlow,
  nextCoupon,
  type CouponFlowEnd,
} from '@/lib/domain'
import { asActive } from '@/lib/domain/redemption'

/**
 * 월수익의 표시 계산 — DOC-007 §3.5 · §4.7 · §7.6 · §9.4 E-10 (P8 컷 b3)
 *
 * 검산 블록 B · C · E는 검증 케이스가 아니다(TC-01~22 무변경 — 절대 규칙 #1). 여기 값은 그 블록의 산술이다.
 */

describe('couponAmount — q_k = trunc_u(P × r_m / 12) · 상품 통화', () => {
  it('검산 B-6 — 원화 1억 · 연 7% → 583,333원(원 미만 절사 — 잠정 RD-10 ①)', () => {
    expect(couponAmount({ principal: '100000000', annualRate: '0.07', currency: 'KRW' }).toString()).toBe(
      '583333',
    )
  })

  it('검산 B-1 — 원화 1억 · 연 7.2% → 600,000원(이미 보조단위라 절사가 값을 바꾸지 않는다)', () => {
    expect(couponAmount({ principal: '100000000', annualRate: '0.072', currency: 'KRW' }).toString()).toBe(
      '600000',
    )
  })

  it('검산 C — $10,000 · 연 24.24% → $202.00', () => {
    expect(couponAmount({ principal: '10000', annualRate: '0.2424', currency: 'USD' }).toFixed(2)).toBe('202.00')
  })

  it('★ 절사다 — 반올림과 갈리는 표본($3,333 × 24.24% / 12 = 67.3266…)에서 67.32', () => {
    // 반올림이면 67.33이다. 이 표본이 두 규칙을 가른다 — 202.00 같은 표본은 둘 다 같은 값을 낸다
    expect(couponAmount({ principal: '3333', annualRate: '0.2424', currency: 'USD' }).toFixed(2)).toBe('67.32')
  })

  it('원화도 절사다 — 1,000,100원 · 연 7% / 12 = 5,833.916… → 5,833원(반올림이면 5,834)', () => {
    expect(couponAmount({ principal: '1000100', annualRate: '0.07', currency: 'KRW' }).toString()).toBe('5833')
  })
})

describe('월수익 흐름 끝 — 세 갈래 · 경계 포함 (§7.6)', () => {
  it('상환일이 있으면 REDEEMED — 적용 차수보다 먼저다', () => {
    expect(couponFlowEndOf({ redemptionDate: '2027-04-20', appliedRoundEvaluationDate: '2027-10-15' })).toEqual({
      kind: 'REDEEMED',
      date: '2027-04-20',
    })
  })

  it('미상환 · 적용 차수가 있으면 ESTIMATED, 없으면 NO_ROUND', () => {
    expect(couponFlowEndOf({ redemptionDate: null, appliedRoundEvaluationDate: '2027-04-15' })).toEqual({
      kind: 'ESTIMATED',
      date: '2027-04-15',
    })
    expect(couponFlowEndOf({ redemptionDate: null, appliedRoundEvaluationDate: null })).toEqual({ kind: 'NO_ROUND' })
  })

  it('t_k ≤ T_end — 같은 날은 흐름 안이고 다음 날은 밖이다', () => {
    const end: CouponFlowEnd = { kind: 'ESTIMATED', date: '2027-04-15' }
    expect(isWithinCouponFlow('2027-04-15', end)).toBe(true)
    expect(isWithinCouponFlow('2027-04-16', end)).toBe(false)
    expect(isWithinCouponFlow('2099-12-31', { kind: 'NO_ROUND' })).toBe(true)
  })
})

describe('couponStateOf — E-10의 구획 (§9.4)', () => {
  const estimated: CouponFlowEnd = { kind: 'ESTIMATED', date: '2027-04-15' }
  const redeemed: CouponFlowEnd = { kind: 'REDEEMED', date: '2027-04-20' }

  it('검산 E — 평가 10-16 · 지급 10-21 · asOf 10-25 · 기록 없음 · 흐름 안 → 미기록', () => {
    expect(
      couponStateOf({
        evaluationDate: '2026-10-16',
        paymentDate: '2026-10-21',
        recordOutcome: null,
        flowEnd: estimated,
        asOf: '2026-10-25',
      }),
    ).toBe('UNRECORDED')
  })

  it('★ 지급일 당일은 「예정」이고 주의는 다음 날부터다', () => {
    const base = { evaluationDate: '2026-10-16', paymentDate: '2026-10-21', recordOutcome: null, flowEnd: estimated }
    expect(couponStateOf({ ...base, asOf: '2026-10-21' })).toBe('SCHEDULED')
    expect(couponStateOf({ ...base, asOf: '2026-10-22' })).toBe('UNRECORDED')
  })

  it('흐름 끝 뒤 — 미상환은 「조기상환 가정 밖」, 상환됨은 「상환 후 없음」(민서 결정 ③)', () => {
    const late = { evaluationDate: '2027-05-15', paymentDate: '2027-05-20', recordOutcome: null, asOf: '2026-10-25' }
    expect(couponStateOf({ ...late, flowEnd: estimated })).toBe('BEYOND_ASSUMPTION')
    expect(couponStateOf({ ...late, flowEnd: redeemed })).toBe('ENDED')
    // 적용 차수가 없으면 흐름 끝이 없다 — 늘 흐름 안
    expect(couponStateOf({ ...late, flowEnd: { kind: 'NO_ROUND' } })).toBe('SCHEDULED')
  })

  it('기록이 정본이다 — 흐름 끝과 무관하게 PAID · UNPAID', () => {
    const late = { evaluationDate: '2027-05-15', paymentDate: '2027-05-20', asOf: '2027-06-01', flowEnd: estimated }
    expect(couponStateOf({ ...late, recordOutcome: 'PAID' })).toBe('PAID')
    expect(couponStateOf({ ...late, recordOutcome: 'UNPAID' })).toBe('UNPAID')
  })

  it('여섯 상태가 전부 도달한다 — 위 케이스들이 COUPON_STATES를 덮는다', () => {
    expect([...COUPON_STATES].sort()).toEqual(
      ['BEYOND_ASSUMPTION', 'ENDED', 'PAID', 'SCHEDULED', 'UNPAID', 'UNRECORDED'].sort(),
    )
  })
})

describe('기록 가능 — V-27과 한 술어 (§4.3 recordable)', () => {
  it('평가일 당일은 평가된 달이다 · 상환일과 같은 날 평가된 달은 상환일 이내다', () => {
    expect(isCouponEvaluated({ evaluationDate: '2026-10-16', asOf: '2026-10-16' })).toBe(true)
    expect(isCouponEvaluated({ evaluationDate: '2026-10-17', asOf: '2026-10-16' })).toBe(false)
    expect(isCouponBeforeRedemption({ evaluationDate: '2027-04-15', redemptionDate: '2027-04-15' })).toBe(true)
    expect(isCouponBeforeRedemption({ evaluationDate: '2027-04-16', redemptionDate: '2027-04-15' })).toBe(false)
    expect(isCouponBeforeRedemption({ evaluationDate: '2099-01-01', redemptionDate: null })).toBe(true)
  })

  it('기록 없음 ∧ 평가됨 ∧ 상환일 이내일 때만 참이다', () => {
    const base = { evaluationDate: '2026-10-16', asOf: '2026-10-25', redemptionDate: null, recorded: false }
    expect(isCouponRecordable(base)).toBe(true)
    expect(isCouponRecordable({ ...base, recorded: true })).toBe(false)
    expect(isCouponRecordable({ ...base, asOf: '2026-10-15' })).toBe(false)
    expect(isCouponRecordable({ ...base, redemptionDate: '2026-10-15' })).toBe(false)
  })

  it('평가는 끝났고 지급일은 오지 않은 달(SCHEDULED)도 기록할 수 있다 — 지금은 미지급만 적을 수 있다(V-28)', () => {
    // 상태는 「예정」인데 기록 대상이다 — 기본 목록이 상태가 아니라 이 술어로 고르는 이유다
    const row = { evaluationDate: '2026-10-16', paymentDate: '2026-10-21', asOf: '2026-10-18' }
    expect(
      couponStateOf({ ...row, recordOutcome: null, flowEnd: { kind: 'ESTIMATED', date: '2027-04-15' } }),
    ).toBe('SCHEDULED')
    expect(isCouponRecordable({ ...row, redemptionDate: null, recorded: false })).toBe(true)
  })
})

describe('다음 월수익 · 조건 판정 (§3.5)', () => {
  const coupons = [
    { couponNo: 1, evaluationDate: '2026-10-16' },
    { couponNo: 2, evaluationDate: '2026-11-16' },
    { couponNo: 3, evaluationDate: '2026-12-16' },
  ]

  it('t_k ≥ asOf 중 최소 — 당일은 다음 행이다', () => {
    expect(nextCoupon({ coupons, asOf: '2026-11-16' })?.couponNo).toBe(2)
    expect(nextCoupon({ coupons, asOf: '2026-11-17' })?.couponNo).toBe(3)
    expect(nextCoupon({ coupons, asOf: '2027-01-01' })).toBeNull()
  })

  it('입력 순서에 기대지 않는다 — 뒤섞어도 같은 행', () => {
    expect(nextCoupon({ coupons: [...coupons].reverse(), asOf: '2026-10-01' })?.couponNo).toBe(1)
  })

  it('W ≥ β 경계 포함 · W 없음은 UNKNOWN', () => {
    expect(couponConditionOf(asActive({ worstOf: dec('0.5'), barrier: '0.5' }, null))).toBe('EXPECTED_PAID')
    expect(couponConditionOf(asActive({ worstOf: dec('0.4999'), barrier: '0.5' }, null))).toBe('EXPECTED_UNPAID')
    expect(couponConditionOf(asActive({ worstOf: null, barrier: '0.5' }, null))).toBe('UNKNOWN')
  })
})
