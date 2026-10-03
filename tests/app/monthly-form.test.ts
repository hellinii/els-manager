import { describe, expect, it } from 'vitest'

import { toProductDetailView } from '@/lib/db/queries/map'
import { NO_ESTIMATE_RATES, shiftBusinessDays } from '@/lib/domain'
import {
  COUPON_BARRIERS_FIELD,
  MONTHLY_RATE_FIELD,
  applyCouponBarriers,
  applyCouponDates,
  couponCell,
  couponFormulaOf,
  couponLockOf,
  couponRowCountOf,
  isFormulaCouponRow,
} from '@/lib/forms/monthly'
import { formOfValues, parseProductForm } from '@/lib/forms/parse'
import { INTENT_FIELD, productFieldNames, rowCountsOf, transition } from '@/lib/forms/productForm'
import { productValuesOf } from '@/lib/forms/values'

import { ASSET_1, OWNER, couponPayment, monthlyProductRow, priceMap, productRow } from '../db/helpers/rows'

/**
 * SCR-204 월지급 블록 (P8 컷 b3-4, DOC-008 SCR-204 「P8 월지급식」 · v2.29)
 */

const BASE = {
  issueDate: '2026-10-16',
  evaluationPeriodMonths: '6',
  totalRounds: '2',
  couponPayout: 'MONTHLY',
}

describe('영업일 가산 — 주말만 건너뛴다', () => {
  it('목 + 3 → 화 · 금 + 3 → 수 · 일요일 시작은 그날을 세지 않는다 · 0은 그대로', () => {
    expect(shiftBusinessDays('2026-10-15', 3)).toBe('2026-10-20') // 목 → 금 · 월 · 화
    expect(shiftBusinessDays('2026-10-16', 3)).toBe('2026-10-21') // 금 → 월 · 화 · 수 (DOC-007 검산 E의 지급일)
    expect(shiftBusinessDays('2026-11-15', 3)).toBe('2026-11-18') // 일 → 월 · 화 · 수
    expect(shiftBusinessDays('2026-11-15', 0)).toBe('2026-11-15')
  })

  it('음수 · 정수 아님은 거부', () => {
    expect(() => shiftBusinessDays('2026-11-15', -1)).toThrow(RangeError)
  })
})

describe('산식 — 평가일 = 발행일 + k개월 − 1일 · 지급일 = +3영업일 · K = 주기 × 총 차수', () => {
  it('EM2048 꼴 — 12행, 첫 행 2026-11-15(일) → 지급 11-18(수)', () => {
    const formula = couponFormulaOf(BASE)
    expect(formula).toHaveLength(12)
    expect(formula?.[0]).toEqual({ evaluationDate: '2026-11-15', paymentDate: '2026-11-18' })
    // 6번째 달은 1차 조기상환 평가일과 같은 산식(발행일 + 6개월 − 1일)이다
    expect(formula?.[5]?.evaluationDate).toBe('2027-04-15')
  })

  it('월말 — 월 이동 → 클램프 → 일 이동(차수 산식과 같은 순서)', () => {
    expect(couponFormulaOf({ ...BASE, issueDate: '2026-08-31' })?.[0]?.evaluationDate).toBe('2026-09-29')
  })

  it('계산할 수 없으면 null — 빈 발행일 · 60개월 초과', () => {
    expect(couponFormulaOf({ ...BASE, issueDate: '' })).toBeNull()
    expect(couponFormulaOf({ ...BASE, evaluationPeriodMonths: '12', totalRounds: '6' })).toBeNull()
  })
})

describe('채우기 둘 — 버튼만 바꾼다', () => {
  it('산식으로 채우기 — K행을 만들고 새 행은 일괄 칸의 배리어', () => {
    const { values, notice } = applyCouponDates({ ...BASE, [COUPON_BARRIERS_FIELD]: '50' })
    expect(couponRowCountOf(values)).toBe(12)
    expect(values[couponCell(11, 'couponBarrier')]).toBe('50')
    expect(notice).toContain('12행')
  })

  it('남는 행의 배리어는 그대로 · 만기가 줄면 잔재 행을 지운다', () => {
    const first = applyCouponDates({ ...BASE, [COUPON_BARRIERS_FIELD]: '50' }).values
    const edited = { ...first, [couponCell(0, 'couponBarrier')]: '55', totalRounds: '1', [COUPON_BARRIERS_FIELD]: '60' }
    const { values } = applyCouponDates(edited)
    expect(couponRowCountOf(values)).toBe(6)
    expect(values[couponCell(0, 'couponBarrier')]).toBe('55')
    expect(values[couponCell(6, 'evaluationDate')]).toBeUndefined()
  })

  it('산식이 없으면 값을 바꾸지 않고 안내만', () => {
    const before = { ...BASE, issueDate: '' }
    const { values, notice } = applyCouponDates(before)
    expect(values).toBe(before)
    expect(notice).toContain('먼저 입력한다')
  })

  it('월수익 배리어 일괄 채우기 — 모든 행 · 행 없음 · 빈 값', () => {
    const filled = applyCouponDates(BASE).values
    const { values } = applyCouponBarriers({ ...filled, [COUPON_BARRIERS_FIELD]: '65' })
    expect(values[couponCell(0, 'couponBarrier')]).toBe('65')
    expect(values[couponCell(11, 'couponBarrier')]).toBe('65')
    expect(applyCouponBarriers({ ...BASE, [COUPON_BARRIERS_FIELD]: '65' }).notice).toContain('행이 없다')
    expect(applyCouponBarriers(filled).notice).toContain('적고')
  })
})

describe('「산식」 표식 — 지금의 산식과 칸을 비교한다(기준 필드 없음 — v2.29 (2))', () => {
  it('★ 채운 직후 참 · 발행일을 바꾸면 칸은 그대로(보류) 표식은 사라진다', () => {
    const filled = applyCouponDates(BASE).values
    expect(isFormulaCouponRow(filled, 0, couponFormulaOf(filled))).toBe(true)
    const moved: Record<string, string> = { ...filled, issueDate: '2026-10-19' }
    expect(moved[couponCell(0, 'evaluationDate')]).toBe('2026-11-15')
    expect(isFormulaCouponRow(moved, 0, couponFormulaOf(moved))).toBe(false)
  })
})

describe('전이 · 이름 · 파서', () => {
  const formOf = (values: Record<string, string>) => formOfValues(values)

  it('월지급식 제출은 연쿠폰율을 0으로 둔다 — 칸만 막으면 앞서 적은 값이 고칠 수 없는 칸에 남는다', () => {
    const next = transition(formOf({ ...BASE, annualCouponRate: '8', [INTENT_FIELD]: 'SUBMIT' }))
    expect(next.values.annualCouponRate).toBe('0')
    // 상환 시 지급은 그대로다
    expect(transition(formOf({ ...BASE, couponPayout: 'AT_REDEMPTION', annualCouponRate: '8' })).values.annualCouponRate).toBe('8')
  })

  it('「평가일 산식으로 채우기」 의도가 행을 만들고, 월지급 이름은 월지급식 렌더에만 있다', () => {
    const next = transition(formOf({ ...BASE, [INTENT_FIELD]: 'APPLY_COUPON_DATES' }))
    expect(next.counts).toMatchObject({ monthly: true, couponRows: 12 })
    expect(next.values[couponCell(11, 'paymentDate')]).not.toBe('')
    expect(productFieldNames(rowCountsOf({ couponPayout: 'AT_REDEMPTION' }))).not.toContain(MONTHLY_RATE_FIELD)
    expect(productFieldNames(next.counts)).toContain(couponCell(11, 'couponBarrier'))
  })

  it('파서 — 월지급식이면 율(비율) · 일정(순번 = 행 위치) · 상환 시 지급이면 칸이 남아도 싣지 않는다', () => {
    const filled = applyCouponBarriers({ ...applyCouponDates(BASE).values, [COUPON_BARRIERS_FIELD]: '50' }).values
    const input = parseProductForm(formOf({ ...filled, [MONTHLY_RATE_FIELD]: '7.2' }))
    expect(input.monthlyCouponAnnualRate).toBe('0.0720')
    expect(input.couponSchedules?.[0]).toEqual({
      couponNo: 1,
      evaluationDate: '2026-11-15',
      paymentDate: '2026-11-18',
      couponBarrier: '0.5000',
    })
    const plain = parseProductForm(formOf({ ...filled, couponPayout: 'AT_REDEMPTION' }))
    expect(plain.monthlyCouponAnnualRate).toBeUndefined()
    expect(plain.couponSchedules).toBeUndefined()
  })
})

describe('수정 초기값 — getProduct에서', () => {
  const PRICED = priceMap([{ assetId: ASSET_1, price: '95.000000' }])

  it('★ 왕복 — 초기값을 그대로 저장하면 율 · 일정이 저장값과 같다(b2~b3의 V-25 공백이 닫힌다)', () => {
    const view = toProductDetailView(monthlyProductRow(), PRICED, '2027-01-20', OWNER, NO_ESTIMATE_RATES)
    const values = productValuesOf(view)
    expect(values[MONTHLY_RATE_FIELD]).toBe('7.2')
    const input = parseProductForm(formOfValues(values))
    expect(input.monthlyCouponAnnualRate).toBe('0.0720')
    expect(input.couponSchedules).toHaveLength(12)
    expect(input.couponSchedules?.[5]).toEqual({
      couponNo: 6,
      evaluationDate: '2027-04-16',
      paymentDate: '2027-04-19',
      couponBarrier: '0.6000',
    })
  })

  it('상환 시 지급 상품의 초기값에는 월지급 칸이 없다 — 기존 수정 폼이 그대로', () => {
    const view = toProductDetailView(productRow(), PRICED, '2027-01-20', OWNER, NO_ESTIMATE_RATES)
    expect(productValuesOf(view)).not.toHaveProperty(MONTHLY_RATE_FIELD)
  })

  it('잠금 — 기록이 있으면 기록된 순번, 없으면 null', () => {
    const recorded = toProductDetailView(
      monthlyProductRow({ monthly_coupon_payments: [couponPayment(), couponPayment({ id: 'p-3', coupon_no: 3 })] }),
      PRICED,
      '2027-01-20',
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(couponLockOf(recorded)).toEqual({ recordedCouponNos: [1, 3] })
    expect(couponLockOf(toProductDetailView(monthlyProductRow(), PRICED, '2027-01-20', OWNER, NO_ESTIMATE_RATES))).toBeNull()
  })
})
