import { describe, expect, it } from 'vitest'

import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import { withholdingFor, withholdingInputOf } from '@/lib/db/mutations/redemptions'
import { excludedForeignCountOf, forecastItemsOf } from '@/lib/db/queries/forecast'
import { incomeEventsOf, type IncomeEvent, type IncomeEvents } from '@/lib/db/queries/income'
import { computeOwnTax, contributionOf } from '@/lib/db/queries/tax'
import { NO_ESTIMATE_RATES, type EstimateRates, type ExchangeRate } from '@/lib/domain'

import type { TaxYearContext } from '@/lib/db/queries/load'
import { TAX_CONSTANT_KEY_MAP } from '@/lib/db/taxConstants'

import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { OWNER, productRow, redemption, schedule } from './helpers/rows'

/**
 * 소득 사건 — `incomeEventsOf` (P8 컷 b0 — 리팩터, 동작 불변)
 *
 * 이 컷의 **동작 불변 증명은 기존 테스트 전부**다 — `contributionOf`·`forecastItemsOf`를 지나는 기존 고정값이
 * 하나도 바뀌지 않고 초록이다(`tests/db/forecast.test.ts` · `currency-views` · `exchange-rate-views` · 통합의 고정 건수).
 * 이 파일은 새 사상 자체를 본다: 분기 넷 · 「사건 ≤1」 · 두 소비자가 같은 사건을 읽는다는 항등.
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

describe('「사건 ≤1」 — 이 컷의 전제이며 타입이다', () => {
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

  it('타입 — 사건 여럿은 `IncomeEvents`가 아니다(컷 b4가 넓힐 때 `contributionOf`가 컴파일에서 멈추는 근거)', () => {
    const e = only(incomeEventsOf(productRow(), ASOF, NO_ESTIMATE_RATES))
    // @ts-expect-error — 둘은 `readonly [] | readonly [IncomeEvent]`에 들지 않는다
    const many: IncomeEvents = [e, e]
    expect(many).toHaveLength(2)
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
