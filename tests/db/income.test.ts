import { describe, expect, it } from 'vitest'

import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import { withholdingFor, withholdingInputOf } from '@/lib/db/mutations/redemptions'
import { excludedForeignCountOf, forecastItemsOf } from '@/lib/db/queries/forecast'
import { incomeEventsOf, type IncomeEvent, type IncomeEvents } from '@/lib/db/queries/income'
import type { ProductRow } from '@/lib/db/queries/load'
import { forecastYears, type ForecastYearInput } from '@/lib/tax'
import { remainingCouponsOf } from '@/lib/db/queries/map'
import { computeOwnTax, contributionOf } from '@/lib/db/queries/tax'
import { NO_ESTIMATE_RATES, type EstimateRates, type ExchangeRate } from '@/lib/domain'

import type { TaxYearContext } from '@/lib/db/queries/load'
import { TAX_CONSTANT_KEY_MAP } from '@/lib/db/taxConstants'

import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { OWNER, couponPayment, monthlyProductRow, productRow, redemption, schedule } from './helpers/rows'

/**
 * 소득 사건 — `incomeEventsOf` (P8 컷 b0 — 리팩터, 동작 불변)
 *
 * 이 컷의 **동작 불변 증명은 기존 테스트 전부**다 — `contributionOf`·`forecastItemsOf`를 지나는 기존 고정값이
 * 하나도 바뀌지 않고 초록이다(`tests/db/forecast.test.ts` · `currency-views` · `exchange-rate-views` · 통합의 고정 건수).
 * 이 파일은 새 사상 자체를 본다: 분기 넷 · 「사건 ≤1」 · 두 소비자가 같은 사건을 읽는다는 항등.
 *
 * **컷 b4 — 월수익 사건.** 「사건 ≤1」은 상환 시 지급 상품의 성질로 좁혀졌고(타입 증인은 지웠다 — 그 증인이 지키던
 * 「규칙을 정하기 전에는 넓히지 못한다」가 실제로 `contributionOf`의 컴파일을 멈췄다), 아래 「월수익 사건」 절이 DOC-007
 * 검산 B-1 · B-4 · B-7을 사상을 거쳐 단언한다.
 */

const ASOF = '2026-06-30'
const RATE: ExchangeRate = { currency: 'USD', rate: '1450', asOfDate: '2026-06-29', source: 'MANUAL' }
const WITH_RATE: EstimateRates = { USD: RATE }

const only = (events: IncomeEvents): IncomeEvent => {
  expect(events).toHaveLength(1)
  return events[0]!
}

describe('분기 넷 — 종전 `contributionOf`의 분기를 그대로 옮겼다', () => {
  it('상환 완료 → 확정 사건 하나: 상환일의 연도 · 거래내역의 원화 과세 · 원금 반환은 투자원금(저장값 문자열)', () => {
    const e = only(
      incomeEventsOf(productRow({ redemptions: redemption({ redemption_date: '2027-01-04' }) }), ASOF, NO_ESTIMATE_RATES),
    )
    expect(e).toMatchObject({ kind: 'REDEMPTION', year: 2027, currency: 'KRW', isEstimated: false, estimateRate: null })
    expect(e.gross.toString()).toBe('104000000')
    expect(e.taxableIncomeKrw?.toString()).toBe('4000000')
    expect(e.principalReturned).toBe('100000000')
  })

  it('비과세 계좌의 상환은 과세 0이다 — 확정값이 있어도(DOC-007 §4.2)', () => {
    const e = only(
      incomeEventsOf(productRow({ account_type: 'TAX_FREE', redemptions: redemption() }), ASOF, NO_ESTIMATE_RATES),
    )
    expect(e.taxableIncomeKrw?.toString()).toBe('0')
  })

  it('미상환 → 추정 사건 하나: 적용 차수(다음 도래 평가일)의 연도 · 예상 수령액 − 원금', () => {
    // 1차 2026-07-02 · 연 8% · 6개월 → 104,000,000 · 과세 4,000,000
    const e = only(incomeEventsOf(productRow(), ASOF, NO_ESTIMATE_RATES))
    expect(e).toMatchObject({ kind: 'REDEMPTION', year: 2026, isEstimated: true, estimateRate: null })
    expect([e.gross.toString(), e.taxableIncomeKrw?.toString()]).toEqual(['104000000', '4000000'])
  })

  it('적용 차수가 없으면 사건이 없다 — 일정 0건 · 전 차수 경과(E-07)', () => {
    expect(incomeEventsOf(productRow({ redemption_schedules: [] }), ASOF, NO_ESTIMATE_RATES)).toEqual([])
    const past = [schedule({ round_no: 1, evaluation_date: '2026-01-02' })]
    expect(incomeEventsOf(productRow({ redemption_schedules: past }), ASOF, NO_ESTIMATE_RATES)).toEqual([])
  })

  it('차수는 있는데 계약 조건이 없으면(연쿠폰율 없음 — AQ-14 · AQ-65) 사건이 없다 — 0원 사건으로 내지 않는다', () => {
    expect(incomeEventsOf(productRow({ annual_coupon_rate: null }), ASOF, NO_ESTIMATE_RATES)).toEqual([])
  })

  it('달러 추정 — 환율이 없으면 과세 null(E-09), 있으면 그 환율로 환산하고 환율을 싣는다', () => {
    const usd = productRow({ currency: 'USD', principal: '10000.50' })
    expect(only(incomeEventsOf(usd, ASOF, NO_ESTIMATE_RATES))).toMatchObject({ taxableIncomeKrw: null, estimateRate: null })
    const rated = only(incomeEventsOf(usd, ASOF, WITH_RATE))
    expect(rated.estimateRate).toEqual(RATE)
    expect(rated.taxableIncomeKrw).not.toBeNull()
  })
})

describe('「사건 ≤1」 — 상환 시 지급 상품의 성질이다(b4부터 월지급식은 여럿)', () => {
  const rows = [
    productRow(),
    productRow({ redemptions: redemption() }),
    productRow({ redemption_schedules: [] }),
    productRow({ annual_coupon_rate: null }),
    productRow({ currency: 'USD', principal: '10000.50' }),
    productRow({ entry_mode: 'REALIZED_ONLY', annual_coupon_rate: null, redemption_schedules: [], redemptions: redemption() }),
  ]

  it('모든 표본에서 사건이 0개 또는 1개이고, 전망 항목은 정확히 1개다', () => {
    for (const row of rows) {
      for (const rates of [NO_ESTIMATE_RATES, WITH_RATE]) {
        expect(incomeEventsOf(row, ASOF, rates).length).toBeLessThanOrEqual(1)
        expect(forecastItemsOf(row, ASOF, rates)).toHaveLength(1)
      }
    }
  })

})

describe('두 소비자가 같은 사건을 읽는다 — §4.6의 F와 §4.7의 항목', () => {
  it('★ 연도마다 Σ contributionOf.amount = Σ forecastItemsOf.taxableIncome(그 연도) — 원화 · 달러(환율 있음)', () => {
    const rows = [
      productRow({ id: 'a' }),
      productRow({ id: 'b', redemptions: redemption({ redemption_date: '2027-01-04', taxable_income: '1234567' }) }),
      productRow({ id: 'c', redemption_schedules: [schedule({ round_no: 1, evaluation_date: '2028-03-02' })] }),
      productRow({ id: 'd', currency: 'USD', principal: '10000.50' }),
      productRow({ id: 'e', account_type: 'TAX_FREE' }),
      productRow({ id: 'f', redemption_schedules: [] }),
    ]
    for (const year of [2026, 2027, 2028, 2029]) {
      const fromContribution = rows.reduce<DecimalValue>(
        (acc, row) => acc.plus(contributionOf(row, year, ASOF, WITH_RATE)?.amount ?? ZERO),
        ZERO,
      )
      const fromForecast = rows
        .flatMap((row) => forecastItemsOf(row, ASOF, WITH_RATE))
        .filter((item) => item.attributionYear === year)
        .reduce<DecimalValue>((acc, item) => acc.plus(dec(item.taxableIncome)), ZERO)
      expect(fromForecast.toString(), String(year)).toBe(fromContribution.toString())
    }
    // 항등이 공허하지 않다 — 적어도 두 해에 0이 아닌 값이 있다
    const nonZero = [2026, 2027, 2028].filter((year) =>
      rows.some((row) => !(contributionOf(row, year, ASOF, WITH_RATE)?.amount ?? ZERO).isZero()),
    )
    expect(nonZero).toEqual([2026, 2027, 2028])
  })

  it('`contributionOf`는 사건의 값을 옮긴다 — 다른 해에는 `null`이다', () => {
    const row = productRow({ redemptions: redemption({ redemption_date: '2027-01-04' }) })
    const e = only(incomeEventsOf(row, ASOF, NO_ESTIMATE_RATES))
    const c = contributionOf(row, 2027, ASOF, NO_ESTIMATE_RATES)
    expect(c).toMatchObject({ isEstimated: e.isEstimated, exchangeRateMissing: false, estimateRate: null })
    expect([c?.amount?.toString(), c?.gross.toString()]).toEqual([e.taxableIncomeKrw?.toString(), e.gross.toString()])
    expect(contributionOf(row, 2026, ASOF, NO_ESTIMATE_RATES)).toBeNull()
  })
})

describe('`withholdingFor` — 날짜를 칸 이름과 함께 받는다 (설계 원자료 G13)', () => {
  // DB에 닿기 전에 끝나는 두 갈래만 본다 — 기본값 산출(세율 조회)은 통합 스위트의 상환 계약이 본다.
  // 컨텍스트를 건드리면 던지는 가짜로 그 사실을 고정한다
  const untouchable = new Proxy({}, {
    get() {
      throw new Error('컨텍스트에 닿았다 — 이 갈래는 DB 전에 끝나야 한다')
    },
  }) as Parameters<typeof withholdingFor>[0]

  it('원천징수세액이 있으면 그대로 돌려준다 — 날짜를 보지 않는다', async () => {
    const out = await withholdingFor(
      untouchable,
      withholdingInputOf({ redemptionDate: '2026-07-02', taxableIncome: '4000000', withholdingTax: '616000' }),
      'redemptionDate',
    )
    expect(out).toEqual({ ok: true, value: '616000' })
  })

  it('날짜 형식 오류는 종전과 같다 — 상환일 칸 · 상환일 문구 (칸이 하나뿐이라 「넘겨받은 칸」은 둘째 칸이 생기는 컷이 가른다)', async () => {
    const out = await withholdingFor(
      untouchable,
      withholdingInputOf({ redemptionDate: '2026-02-30', taxableIncome: '4000000' }),
      'redemptionDate',
    )
    expect(out).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: '상환일을 YYYY-MM-DD 형식으로 입력한다.',
        fields: { redemptionDate: '상환일을 YYYY-MM-DD 형식으로 입력한다.' },
      },
    })
  })
})

describe('사건 없는 전망 항목 — 종전 `forecastItemOf`의 두 갈래를 지킨다', () => {
  it('적용 차수 없음 → 귀속연도 null · 원금은 잔여 원금으로', () => {
    const [item] = forecastItemsOf(productRow({ redemption_schedules: [] }), ASOF, NO_ESTIMATE_RATES)
    expect(item).toMatchObject({ attributionYear: null, principal: '100000000', isEstimated: false })
    expect([dec(item!.gross).toString(), dec(item!.taxableIncome).toString()]).toEqual(['0', '0'])
  })

  it('★ 차수는 있는데 계약 조건이 없다(AQ-14 · AQ-65) → 그 차수의 연도 · 유량 0 — 종전 동작 그대로다', () => {
    // 종전 `forecastItemOf`는 귀속연도를 `attributionOf`에서 읽고 기여만 `null`이었다. 사건 모델로 옮기며
    // 「사건 없음 = 귀속연도 null」로 접으면 이 상품의 원금이 2026년 상환에서 전 연도 잔여 원금으로 옮겨 간다
    const [item] = forecastItemsOf(productRow({ annual_coupon_rate: null }), ASOF, NO_ESTIMATE_RATES)
    expect(item).toMatchObject({ attributionYear: 2026, principal: '100000000', isEstimated: false })
    expect([dec(item!.gross).toString(), dec(item!.taxableIncome).toString()]).toEqual(['0', '0'])
  })
})

/** 2026 세율 — 시드 대조(AQ-05)가 마이그레이션과 묶는 픽스처다(`exchange-rate-views.test.ts`와 같은 구성) */
const YEAR_CONTEXT = {
  taxLawYear: 2026,
  seededYears: [2026],
  brackets: BRACKETS_2026.map((b) => ({
    lower_bound: b.lowerBound,
    rate: b.rate,
    progressive_deduction: b.progressiveDeduction,
  })),
  constants: Object.entries(TAX_CONSTANT_KEY_MAP).map(([field, key]) => ({
    key,
    value: CONSTANTS_2026[field as keyof typeof CONSTANTS_2026],
  })),
} as TaxYearContext

describe('예외 범위도 종전과 같다 — 다른 해의 사건은 값을 계산하지 않는다 (반박 검토)', () => {
  // 적용 차수 번호 0 — 계약(V-04)은 막지만 DB에는 `round_no ≥ 1` CHECK가 없어 계약 밖 경로(AQ-29)로 닿는다.
  // `grossExpected`가 던지는 입력이다. 종전 `contributionOf`는 귀속연도를 산식보다 먼저 봐서 다른 해에는 `null`이었다
  const broken = () => productRow({ redemption_schedules: [schedule({ round_no: 0, evaluation_date: '2027-01-04' })] })

  it('★ 다른 해를 물으면 null — 산식이 돌지 않는다', () => {
    expect(contributionOf(broken(), 2026, ASOF, NO_ESTIMATE_RATES)).toBeNull()
    expect(incomeEventsOf(broken(), ASOF, NO_ESTIMATE_RATES, { year: 2026 })).toEqual([])
  })

  it('제 해를 물으면 종전처럼 던진다 — 예외를 삼키지 않는다(이 컷은 그것도 바꾸지 않는다)', () => {
    expect(() => contributionOf(broken(), 2027, ASOF, NO_ESTIMATE_RATES)).toThrow(RangeError)
  })

  it('★ 그 상품이 섞여도 다른 해의 세금 계산(§4.6 · §4.1)은 선다', () => {
    const own = computeOwnTax({
      products: [broken(), productRow({ id: 'ok' })],
      ownerId: OWNER,
      year: 2026,
      asOf: ASOF,
      yearContext: YEAR_CONTEXT,
      otherFinancialIncome: ZERO,
      otherIncomeBase: ZERO,
      rates: NO_ESTIMATE_RATES,
    })
    expect(own.elsTaxableIncome.toString()).toBe('4000000')
  })
})

describe('원금 보존 — 상품마다 원금을 실은 항목이 정확히 하나다 (전망 §7.5 배타 분할의 전제)', () => {
  it('★ 원화 표본 전부에서 항목들의 원금 합 = 투자원금이고 원금을 실은 항목은 하나다', () => {
    const rows = [
      productRow(),
      productRow({ redemptions: redemption() }),
      productRow({ redemption_schedules: [] }),
      productRow({ annual_coupon_rate: null }),
      productRow({ entry_mode: 'REALIZED_ONLY', annual_coupon_rate: null, redemption_schedules: [], redemptions: redemption() }),
    ]
    for (const row of rows) {
      const items = forecastItemsOf(row, ASOF, NO_ESTIMATE_RATES)
      const carrying = items.filter((item) => !dec(item.principal).isZero())
      expect(carrying, JSON.stringify(row.redemption_schedules)).toHaveLength(1)
      expect(items.reduce<DecimalValue>((acc, item) => acc.plus(dec(item.principal)), ZERO).toString()).toBe(row.principal)
    }
  })
})

describe('`excludedForeignCountOf` — 외화 상품 수다, 항목 수가 아니다 (DOC-011 §4.7 · 반박 검토)', () => {
  const item = (excludedForeign: boolean) => ({ ...forecastItemsOf(productRow(), ASOF, NO_ESTIMATE_RATES)[0]!, excludedForeign })

  it('★ 한 상품의 항목 여럿이 빠져도 한 번 센다 — 컷 b4의 월수익 상품', () => {
    expect(excludedForeignCountOf([[item(true), item(true)], [item(false)], [item(true)]])).toBe(2)
    expect(excludedForeignCountOf([[item(false), item(true)]])).toBe(1)
    expect(excludedForeignCountOf([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 월수익 사건 — DOC-007 §7.6 · 검산 B (P8 컷 b4)
// ---------------------------------------------------------------------------

/**
 * 검산 B-1의 상품 — 원화 · `GENERAL` · `P` 100,000,000 · `r_m = 0.072`(q = 600,000) · 월수익 여섯 달
 * (평가 2026-08-19 · 09-18 · 10-19 · 11-19 · 12-18 · 2027-01-19 / 지급 08-24 · 09-23 · 10-22 · 11-24 · 12-23 · 2027-01-22).
 * 적용 차수(흐름 끝) 평가일 2027-01-19 · 기준일 2026-07-28 · 기록 없음.
 */
const B1_ASOF = '2026-07-28'
const B1_MONTHS: Array<[string, string]> = [
  ['2026-08-19', '2026-08-24'],
  ['2026-09-18', '2026-09-23'],
  ['2026-10-19', '2026-10-22'],
  ['2026-11-19', '2026-11-24'],
  ['2026-12-18', '2026-12-23'],
  ['2027-01-19', '2027-01-22'],
]
function b1Row(overrides: Partial<ProductRow> = {}): ProductRow {
  return monthlyProductRow({
    id: 'b1',
    issue_date: '2026-07-19',
    redemption_schedules: [
      schedule({ round_no: 1, evaluation_date: '2027-01-19' }),
      schedule({ round_no: 2, evaluation_date: '2027-07-19' }),
    ],
    monthly_coupon_schedules: B1_MONTHS.map(([evaluation, payment], index) => ({
      coupon_no: index + 1,
      evaluation_date: evaluation,
      payment_date: payment,
      coupon_barrier: '0.6000',
    })),
    ...overrides,
  })
}

const yearInput = (year: number): ForecastYearInput => ({
  year,
  taxLawYear: 2026,
  brackets: BRACKETS_2026,
  constants: CONSTANTS_2026,
  otherIncomeBase: '0',
  otherFinancialIncome: '0',
  subscriberType: 'NONE',
  profileYear: null,
})

describe('검산 B — 월수익 사건은 지급일의 해에 귀속되고 원금을 돌려주지 않는다', () => {
  it('★ B-1 — contributionOf(only.year): F(2026) = 3,000,000(k=1~5) · F(2027) = 600,000(k=6 경계 포함) + 상환 과세 0', () => {
    const y2026 = contributionOf(b1Row(), 2026, B1_ASOF, NO_ESTIMATE_RATES)
    const y2027 = contributionOf(b1Row(), 2027, B1_ASOF, NO_ESTIMATE_RATES)
    expect(y2026?.amount?.toString()).toBe('3000000')
    expect(y2027?.amount?.toString()).toBe('600000')
    // 2026은 월수익만(상환은 2027) · 2027은 상환(과세 0 — r = 0 ⇒ 세전 = P) + 6번째 달
    expect(y2026?.breakdown).toEqual({
      redemption: null,
      coupons: { confirmedCount: 0, confirmedTaxableIncome: ZERO, estimatedCount: 5, estimatedTaxableIncome: dec('3000000') },
    })
    expect(y2027?.breakdown.redemption).toEqual({ taxableIncome: ZERO, isEstimated: true })
    expect(y2027?.breakdown.coupons?.estimatedCount).toBe(1)
    expect([y2026?.basis, y2027?.basis]).toEqual(['ESTIMATED', 'ESTIMATED'])
    // 세전은 원금 반환분을 포함한다 — 2027 = 상환 P + 6번째 달
    expect(y2027?.gross.toString()).toBe('100600000')
    expect([y2026?.hasCouponEstimate, y2027?.hasCouponEstimate]).toEqual([true, true])
  })

  it('★ B-4 — 평가 2026-12-29 · 지급 2027-01-04는 2027 귀속이다(매퍼를 거친다)', () => {
    const row = b1Row({
      monthly_coupon_schedules: [{ coupon_no: 1, evaluation_date: '2026-12-29', payment_date: '2027-01-04', coupon_barrier: '0.6000' }],
    })
    const coupons = incomeEventsOf(row, B1_ASOF, NO_ESTIMATE_RATES).filter((e) => e.kind === 'COUPON')
    expect(coupons.map((e) => [e.year, e.isEstimated, e.principalReturned])).toEqual([[2027, true, '0']])
  })

  it('★ B-7 — 전망: 2026 세전 3,000,000 · 세후 2,538,000 · 잔여 원금 1억 · 누적 102,538,000 / 2027 세전 100,600,000 · 세후 100,507,600 · 잔여 0 · 누적 103,045,600', () => {
    const items = forecastItemsOf(b1Row(), B1_ASOF, NO_ESTIMATE_RATES)
    const rows = forecastYears({ ownerId: OWNER, items, years: [yearInput(2026), yearInput(2027)] })
    expect(
      rows.map((r) => [
        r.year,
        r.grossProceeds.toString(),
        r.netProceeds.toString(),
        r.remainingPrincipal.toString(),
        r.cumulativeAssets.toString(),
      ]),
    ).toEqual([
      [2026, '3000000', '2538000', '100000000', '102538000'],
      [2027, '100600000', '100507600', '0', '103045600'],
    ])
    // 월수익 항목은 원금을 싣지 않는다 — 실으면 2026 잔여 원금 200,000,000(이중 계상)
    expect(items.filter((item) => !dec(item.principal).isZero())).toHaveLength(1)
    expect(items.filter((item) => item.couponEstimate)).toHaveLength(6)
  })
})

describe('월수익 사건의 갈래 — 기록 · 흐름 끝 · 조기 반환의 범위', () => {
  it('PAID 기록은 확정(그 지급일의 해 · 기록의 원화 값) · UNPAID는 사건이 아니다 · 기록된 달은 추정에서 빠진다', () => {
    const row = b1Row({
      monthly_coupon_payments: [
        couponPayment({ coupon_no: 1, payment_date: '2026-08-24', taxable_income: '600000' }),
        couponPayment({ id: 'p2', coupon_no: 2, outcome: 'UNPAID', payment_date: null, gross_amount: null, taxable_income: null, withholding_tax: null }),
      ],
    })
    const c = contributionOf(row, 2026, B1_ASOF, NO_ESTIMATE_RATES)
    // 확정 1 · 미지급 1(빠짐) · 추정 3(k=3~5)
    expect(c?.breakdown.coupons).toEqual({
      confirmedCount: 1,
      confirmedTaxableIncome: dec('600000'),
      estimatedCount: 3,
      estimatedTaxableIncome: dec('1800000'),
    })
    expect(c?.basis).toBe('MIXED')
    expect(c?.isEstimated).toBe(true)
    expect([c?.confirmedAmount.toString(), c?.estimatedAmount.toString(), c?.amount?.toString()]).toEqual([
      '600000',
      '1800000',
      '2400000',
    ])
  })

  it('★ 적용 차수 없음(NO_ROUND)이어도 월수익은 남는다 — 흐름 끝이 무한이라 일정 전부가 추정 사건(b0 조기 반환이 버리던 것)', () => {
    const row = b1Row({ redemption_schedules: [] })
    const events = incomeEventsOf(row, B1_ASOF, NO_ESTIMATE_RATES)
    expect(events.map((e) => e.kind)).toEqual(Array(6).fill('COUPON'))
    // 원금은 사건 없는 원금 항목이 잔여 원금으로 나른다
    const items = forecastItemsOf(row, B1_ASOF, NO_ESTIMATE_RATES)
    expect(items.filter((item) => !dec(item.principal).isZero()).map((item) => item.attributionYear)).toEqual([null])
  })

  it('흐름 끝 뒤의 무기록 달은 사건이 아니다 — 미상환(가정 밖) · 상환됨(상환 후 없음)', () => {
    // 적용 차수 2026-10-19로 당기면 k=4~6이 가정 밖이다
    const early = b1Row({ redemption_schedules: [schedule({ round_no: 1, evaluation_date: '2026-10-19' })] })
    expect(incomeEventsOf(early, B1_ASOF, NO_ESTIMATE_RATES).filter((e) => e.kind === 'COUPON')).toHaveLength(3)
    // 2026-09-21에 상환 — k=1 · k=2가 흐름 안(평가 08-19 · 09-18 ≤ 상환일), k=3부터 상환 후 없음 · 상환은 확정 사건
    const redeemed = b1Row({
      redemptions: redemption({ redemption_date: '2026-09-21', round_no: null, gross_amount: '100000000', taxable_income: '0' }),
    })
    const events = incomeEventsOf(redeemed, B1_ASOF, NO_ESTIMATE_RATES)
    expect(events.map((e) => [e.kind, e.isEstimated])).toEqual([
      ['REDEMPTION', false],
      ['COUPON', true],
      ['COUPON', true],
    ])
  })

  it('기실현 월지급(순번 없는 PAID 기록)은 확정 사건 · 셋째 결함은 월수익 사건 없음 · 상환 시 지급 아래 잔재 일정은 읽지 않는다', () => {
    const realized = productRow({
      entry_mode: 'REALIZED_ONLY',
      coupon_payout: 'MONTHLY',
      annual_coupon_rate: null,
      monthly_coupon_annual_rate: null,
      redemption_schedules: [],
      redemptions: redemption({ redemption_date: '2026-03-02', round_no: null, gross_amount: '70000000', taxable_income: '0' }),
      monthly_coupon_payments: [couponPayment({ coupon_no: null, payment_date: '2025-08-20', taxable_income: '600000' })],
    })
    expect(incomeEventsOf(realized, B1_ASOF, NO_ESTIMATE_RATES).map((e) => [e.kind, e.year, e.isEstimated])).toEqual([
      ['REDEMPTION', 2026, false],
      ['COUPON', 2025, false],
    ])
    const broken = b1Row({ monthly_coupon_schedules: [] })
    expect(incomeEventsOf(broken, B1_ASOF, NO_ESTIMATE_RATES).map((e) => e.kind)).toEqual(['REDEMPTION'])
    expect(contributionOf(broken, 2027, B1_ASOF, NO_ESTIMATE_RATES)?.breakdown.coupons).toBeNull()
    const stray = productRow({ monthly_coupon_schedules: b1Row().monthly_coupon_schedules })
    expect(incomeEventsOf(stray, B1_ASOF, NO_ESTIMATE_RATES).map((e) => e.kind)).toEqual(['REDEMPTION'])
  })

  it('★ 달러 · 일부만 빠짐 — 확정 월수익은 남고 추정만 빠진다: amount = 확정분 · exchangeRateMissing · MIXED · 상품 수로 센다', () => {
    const usd = b1Row({
      currency: 'USD',
      principal: '10000.50',
      monthly_coupon_annual_rate: '0.2424',
      monthly_coupon_payments: [
        couponPayment({ coupon_no: 1, payment_date: '2026-08-24', gross_amount: '202.01', taxable_income: '279824', exchange_rate: '1385.200000' }),
      ],
    })
    const c = contributionOf(usd, 2026, B1_ASOF, NO_ESTIMATE_RATES)
    expect(c?.amount?.toString()).toBe('279824')
    expect(c).toMatchObject({ exchangeRateMissing: true, basis: 'MIXED', estimateRate: null })
    expect(c?.breakdown.coupons).toMatchObject({ confirmedCount: 1, estimatedCount: 4, estimatedTaxableIncome: null })
    const own = computeOwnTax({
      products: [usd],
      ownerId: OWNER,
      year: 2026,
      asOf: B1_ASOF,
      yearContext: YEAR_CONTEXT,
      otherFinancialIncome: ZERO,
      otherIncomeBase: ZERO,
      rates: NO_ESTIMATE_RATES,
    })
    expect([own.unconvertedCount, own.convertedCount, own.elsTaxableIncome.toString()]).toEqual([1, 0, '279824'])
    expect([own.confirmedElsTaxableIncome.toString(), own.estimatedElsTaxableIncome.toString()]).toEqual(['279824', '0'])
    expect(own.monthlyCouponAssumption).toBe(true)
    // 환율이 있으면 추정분도 들어간다 — 202.01 × 1450 × 4달, 환산한 상품 하나
    const rated = contributionOf(usd, 2026, B1_ASOF, WITH_RATE)
    expect(rated?.amount?.toString()).toBe(dec('279824').plus(dec('202.01').times(1450).times(4)).toString())
    expect(rated).toMatchObject({ exchangeRateMissing: false, estimateRate: RATE })
  })

  it('비과세 월지급은 환율 없이 0 — E-09로 세지 않는다', () => {
    const c = contributionOf(b1Row({ currency: 'USD', principal: '10000.50', account_type: 'TAX_FREE' }), 2026, B1_ASOF, NO_ESTIMATE_RATES)
    expect(c?.amount?.toString()).toBe('0')
    expect(c?.exchangeRateMissing).toBe(false)
  })
})

describe('두 소비자 항등 · 원금 보존 — 월지급 표본을 넣는다 (DOC-007 검산 B 각주 · b4 테스트 목록)', () => {
  const monthlyRows = [
    b1Row({ id: 'm1' }),
    b1Row({ id: 'm2', redemption_schedules: [] }), // NO_ROUND
    b1Row({
      id: 'm3',
      monthly_coupon_payments: [couponPayment({ coupon_no: 1, payment_date: '2026-08-24', taxable_income: '600000' })],
    }),
    b1Row({ id: 'm4', currency: 'USD', principal: '10000.50', monthly_coupon_annual_rate: '0.2424' }),
    b1Row({
      id: 'm5',
      redemptions: redemption({ redemption_date: '2026-09-21', round_no: null, gross_amount: '100000000', taxable_income: '0' }),
    }),
  ]

  it('★ 연도마다 Σ contributionOf.amount = Σ forecastItemsOf.taxableIncome(그 연도) — 월지급 · NO_ROUND 포함', () => {
    for (const year of [2026, 2027, 2028]) {
      const fromContribution = monthlyRows.reduce<DecimalValue>(
        (acc, row) => acc.plus(contributionOf(row, year, B1_ASOF, WITH_RATE)?.amount ?? ZERO),
        ZERO,
      )
      const fromForecast = monthlyRows
        .flatMap((row) => forecastItemsOf(row, B1_ASOF, WITH_RATE))
        .filter((item) => item.attributionYear === year)
        .reduce<DecimalValue>((acc, item) => acc.plus(dec(item.taxableIncome)), ZERO)
      expect(fromForecast.toString(), String(year)).toBe(fromContribution.toString())
    }
    // 공허하지 않다 — 2026 · 2027 둘 다 0이 아니다
    for (const year of [2026, 2027]) {
      expect(monthlyRows.some((row) => !(contributionOf(row, year, B1_ASOF, WITH_RATE)?.amount ?? ZERO).isZero())).toBe(true)
    }
  })

  it('★ 원화 월지급 표본마다 원금을 실은 항목이 정확히 하나 · 원금 합 = 투자원금', () => {
    for (const row of monthlyRows.filter((r) => r.currency === 'KRW')) {
      const items = forecastItemsOf(row, B1_ASOF, NO_ESTIMATE_RATES)
      expect(items.filter((item) => !dec(item.principal).isZero()), row.id).toHaveLength(1)
      expect(items.reduce<DecimalValue>((acc, item) => acc.plus(dec(item.principal)), ZERO).toString()).toBe(row.principal)
    }
  })
})

describe('§4.3 잔여 월수익 — §4.6과 같은 사건 집합 (DOC-011 §4.3 검산 B-1)', () => {
  it('★ B-1: { byYear: [2026 · 5 · 3,000,000 · 3,000,000], [2027 · 1 · 600,000 · 600,000] }, 환율 기준 없음', () => {
    expect(remainingCouponsOf(b1Row(), B1_ASOF, NO_ESTIMATE_RATES)).toEqual({
      byYear: [
        { year: 2026, count: 5, grossAmount: '3000000', taxableIncome: '3000000' },
        { year: 2027, count: 1, grossAmount: '600000', taxableIncome: '600000' },
      ],
      exchangeRateBasis: null,
    })
  })

  it('★ 연도마다 byYear.taxableIncome = contributionOf의 breakdown.coupons.estimatedTaxableIncome — 달러 · 환율 있음/없음', () => {
    const usd = b1Row({ currency: 'USD', principal: '10000.50', monthly_coupon_annual_rate: '0.2424' })
    for (const rates of [NO_ESTIMATE_RATES, WITH_RATE]) {
      const remaining = remainingCouponsOf(usd, B1_ASOF, rates)
      for (const entry of remaining.byYear) {
        const estimated = contributionOf(usd, entry.year, B1_ASOF, rates)?.breakdown.coupons?.estimatedTaxableIncome
        expect(entry.taxableIncome).toBe(estimated == null ? null : estimated.toFixed(0))
      }
      // 환율이 없으면 금액은 null이고 건수 · 세전은 남는다
      expect(remaining.byYear.map((e) => [e.count, e.grossAmount])).toEqual([
        [5, '1010.05'],
        [1, '202.01'],
      ])
    }
    expect(remainingCouponsOf(usd, B1_ASOF, WITH_RATE).exchangeRateBasis?.rate).toBe('1450.000000')
  })

  it('상환된 상품 · NO_ROUND에서도 남는다(projection은 null) · 전부 기록되면 빈 배열', () => {
    const redeemed = b1Row({
      redemptions: redemption({ redemption_date: '2026-09-21', round_no: null, gross_amount: '100000000', taxable_income: '0' }),
    })
    expect(remainingCouponsOf(redeemed, B1_ASOF, NO_ESTIMATE_RATES).byYear.map((e) => [e.year, e.count])).toEqual([[2026, 2]])
    expect(remainingCouponsOf(b1Row({ redemption_schedules: [] }), B1_ASOF, NO_ESTIMATE_RATES).byYear).toHaveLength(2)
    const all = b1Row({
      monthly_coupon_payments: B1_MONTHS.map(([, payment], index) =>
        couponPayment({ id: `p${index}`, coupon_no: index + 1, payment_date: payment }),
      ),
    })
    expect(remainingCouponsOf(all, B1_ASOF, NO_ESTIMATE_RATES).byYear).toEqual([])
  })
})
