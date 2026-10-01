import { describe, expect, it } from 'vitest'

import { krwEstimateOf } from '@/lib/db/queries/dashboard'
import { forecastItemOf } from '@/lib/db/queries/forecast'
import { estimateRateOf, type TaxYearContext } from '@/lib/db/queries/load'
import { exchangeRateBasisOf, toProductDetailView } from '@/lib/db/queries/map'
import { computeOwnTax, contributionOf } from '@/lib/db/queries/tax'
import { TAX_CONSTANT_KEY_MAP } from '@/lib/db/taxConstants'
import { dec } from '@/lib/decimal'
import { NO_ESTIMATE_RATES, type EstimateRates, type ExchangeRate } from '@/lib/domain'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { OWNER, priceMap, productRow, redemption } from './helpers/rows'

/**
 * 추정 환율의 조회 사상 — DOC-011 v4.9 §4.0 · §4.1 · §4.3 · §4.6 · §4.7 (P8 컷 a3)
 *
 * a2의 `currency-views.test.ts`가 「환율이 없으면 빼고 센다」를 보았다면, 이 파일은 **환율이 있을 때
 * 무엇을 말하는가**를 본다 — 근거(`ExchangeRateBasisView`)는 환산이 실제로 일어난 자리에만 붙고, 환율
 * 없이 값을 아는 자리(원화 · 비과세 · 확정값 · 이익 ≤ 0)에는 붙지 않는다(ST-05). 붙어야 할 자리에서
 * 빠지면 환산값이 확정처럼 읽히고, 붙지 않아야 할 자리에 붙으면 확정값이 추정처럼 읽힌다.
 */

const ASOF = '2026-06-30'

const RATE: ExchangeRate = {
  currency: 'USD',
  rate: '1450',
  asOfDate: '2026-06-29',
  source: 'MANUAL',
}
const WITH_RATE: EstimateRates = { USD: RATE }

/** 달러 · 미상환 · 일반 계좌 — 1차(2026-07-02)가 적용 차수. 이익 $400.02 → 580,029원 */
function usdActive(overrides: Parameters<typeof productRow>[0] = {}) {
  return productRow({ currency: 'USD', principal: '10000.50', ...overrides })
}

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

function ownTax(products: ReturnType<typeof productRow>[], rates: EstimateRates) {
  return computeOwnTax({
    products,
    ownerId: OWNER,
    year: 2026,
    asOf: ASOF,
    yearContext: YEAR_CONTEXT,
    otherFinancialIncome: dec('0'),
    otherIncomeBase: dec('0'),
    rates,
  })
}

describe('ExchangeRateBasisView — §4.0 (근거 뷰)', () => {
  it('환율은 시세와 같은 6자리 · 출처를 나른다', () => {
    expect(exchangeRateBasisOf(RATE, ASOF)).toEqual({
      currency: 'USD',
      rate: '1450.000000',
      asOfDate: '2026-06-29',
      source: 'MANUAL',
      isStale: false,
    })
  })

  it('경과는 §4.5와 같은 5일 규칙이다 — 4일은 아니고 5일은 오래됐다', () => {
    expect(exchangeRateBasisOf({ ...RATE, asOfDate: '2026-06-26' }, ASOF)?.isStale).toBe(false)
    expect(exchangeRateBasisOf({ ...RATE, asOfDate: '2026-06-25' }, ASOF)?.isStale).toBe(true)
  })

  it('환율이 없으면 근거도 없다', () => {
    expect(exchangeRateBasisOf(null, ASOF)).toBeNull()
  })

  it('행 → 추정 환율은 물은 통화를 쓰고 6자리 원문을 그대로 나른다', () => {
    expect(estimateRateOf('USD', null)).toBeNull()
    expect(
      estimateRateOf('USD', {
        currency: 'USD',
        as_of_date: '2026-06-29',
        rate: '1392.400000',
        source: 'AUTO',
        provider: 'ECOS',
      }),
    ).toEqual({ currency: 'USD', rate: '1392.400000', asOfDate: '2026-06-29', source: 'AUTO' })
  })
})

describe('§4.3 projection.exchangeRateBasis — 환산했을 때만', () => {
  it('일반계좌 · 이익 > 0 · 환율 있음 → 원화 과세와 그 환율', () => {
    const view = toProductDetailView(usdActive(), priceMap([]), ASOF, OWNER, WITH_RATE)
    expect(view.projection).toMatchObject({
      expectedTaxableIncome: '580029',
      exchangeRateBasis: exchangeRateBasisOf(RATE, ASOF),
    })
  })

  it('환율 없음 → 금액과 근거가 함께 빈다 (E-09)', () => {
    const view = toProductDetailView(usdActive(), priceMap([]), ASOF, OWNER, NO_ESTIMATE_RATES)
    expect(view.projection).toMatchObject({ expectedTaxableIncome: null, exchangeRateBasis: null })
  })

  it.each([
    ['비과세 — 환율 없이 0', usdActive({ account_type: 'TAX_FREE' })],
    ['달러 이익 0 — 곱할 이익이 없다', usdActive({ annual_coupon_rate: '0.0000' })],
  ])('환율이 있어도 근거가 없다: %s', (_what, row) => {
    const view = toProductDetailView(row, priceMap([]), ASOF, OWNER, WITH_RATE)
    expect(view.projection).toMatchObject({ expectedTaxableIncome: '0', exchangeRateBasis: null })
  })

  it('원화 상품은 환율이 있어도 근거가 없다 — 바이트 불변 (DOC-011 §4.3 표)', () => {
    const view = toProductDetailView(productRow(), priceMap([]), ASOF, OWNER, WITH_RATE)
    expect(view.projection).toMatchObject({
      expectedTaxableIncome: '4000000',
      exchangeRateBasis: null,
    })
  })
})

describe('§4.6 convertedCount · exchangeRateBasis — 환산해 넣은 건', () => {
  it('달러 추정 · 환율 있음 → F에 들어가고 한 건으로 센다', () => {
    const own = ownTax([usdActive()], WITH_RATE)
    expect(own.financialIncome.toString()).toBe('580029')
    expect(own).toMatchObject({ convertedCount: 1, unconvertedCount: 0, estimateRate: RATE })
  })

  it('원화 확정 + 달러 추정 → 둘 다 F에 있고 환산은 달러 한 건뿐이다', () => {
    const own = ownTax(
      [
        productRow({ id: 'krw-redeemed', redemptions: redemption({ taxable_income: '4000000' }) }),
        usdActive({ id: 'usd-active' }),
      ],
      WITH_RATE,
    )
    expect(own.financialIncome.toString()).toBe('4580029')
    expect(own).toMatchObject({ convertedCount: 1, unconvertedCount: 0 })
  })

  it.each([
    ['비과세', usdActive({ account_type: 'TAX_FREE' })],
    ['달러 이익 0', usdActive({ annual_coupon_rate: '0.0000' })],
    [
      '달러 확정 상환 — 거래내역의 원화',
      usdActive({ redemptions: redemption({ gross_amount: '10600.75', taxable_income: '835740' }) }),
    ],
  ])('환율 없이 값을 아는 건은 어느 건수에도 들지 않는다: %s', (_what, row) => {
    const c = contributionOf(row, 2026, ASOF, WITH_RATE)
    expect(c?.estimateRate).toBeNull()
    expect(c?.exchangeRateMissing).toBe(false)
    const own = ownTax([row], WITH_RATE)
    expect(own).toMatchObject({ convertedCount: 0, unconvertedCount: 0, estimateRate: null })
  })

  it('환율 없음 → 빠진 건으로 세고 환산 건은 0이다 — 둘 중 하나는 늘 0 (USD 하나인 동안)', () => {
    const own = ownTax([usdActive()], NO_ESTIMATE_RATES)
    expect(own).toMatchObject({ convertedCount: 0, unconvertedCount: 1, estimateRate: null })
  })
})

describe('§4.1 totals.krwEstimate — 보유중 외화 원금이 있을 때만', () => {
  const krw = productRow({ id: 'krw', principal: '100000000' })
  const usd = usdActive({ id: 'usd', principal: '70000.00' })

  it('원화뿐이면 객체가 없다 — 원화 포트폴리오의 응답이 이 필드 말고는 그대로다', () => {
    expect(krwEstimateOf([krw], WITH_RATE, ASOF)).toBeNull()
  })

  it('원화 + 달러 × 추정 환율을 원 단위로 — 100,000,000 + 70,000 × 1,450', () => {
    expect(krwEstimateOf([krw, usd], WITH_RATE, ASOF)).toEqual({
      activePrincipal: '201500000',
      exchangeRateBasis: exchangeRateBasisOf(RATE, ASOF),
    })
  })

  it('★ 외화의 환율이 없으면 부분합을 주지 않는다 — 원화 1억만 「합계」로 보이지 않게', () => {
    expect(krwEstimateOf([krw, usd], NO_ESTIMATE_RATES, ASOF)).toEqual({
      activePrincipal: null,
      exchangeRateBasis: null,
    })
  })

  it('센트는 원 단위로 접는다 — 10,000.50 × 1,392.4 = 13,924,696.2 → 13924696', () => {
    const rates: EstimateRates = { USD: { ...RATE, rate: '1392.4' } }
    expect(krwEstimateOf([usdActive()], rates, ASOF)?.activePrincipal).toBe('13924696')
  })
})

describe('§4.7 forecastItemOf.estimateRate — excludedForeign의 거울', () => {
  it('보유중 달러 · 환율 있음 → 그 환율로 환산했다', () => {
    const item = forecastItemOf(usdActive(), ASOF, WITH_RATE)
    expect(item).toMatchObject({ excludedForeign: false, estimateRate: RATE })
  })

  it('기준 연도에 상환된 달러 → 첫 행부터 원화 합에 필요하다 — 환산했다', () => {
    const row = usdActive({ redemptions: redemption({ redemption_date: '2026-05-07' }) })
    expect(forecastItemOf(row, ASOF, WITH_RATE).estimateRate).toEqual(RATE)
  })

  it('기준 연도 이전 상환 → 어느 열에도 없다 — 환율이 있어도 근거를 세우지 않는다', () => {
    const row = usdActive({ redemptions: redemption({ redemption_date: '2025-11-03' }) })
    expect(forecastItemOf(row, ASOF, WITH_RATE)).toMatchObject({
      excludedForeign: false,
      estimateRate: null,
    })
  })

  it('★ 환산과 제외는 한 항목에 동시에 서지 않는다', () => {
    const rows = [
      usdActive(),
      usdActive({ redemptions: redemption({ redemption_date: '2026-05-07' }) }),
      usdActive({ redemptions: redemption({ redemption_date: '2025-11-03' }) }),
      productRow(),
    ]
    for (const rates of [WITH_RATE, NO_ESTIMATE_RATES]) {
      for (const row of rows) {
        const item = forecastItemOf(row, ASOF, rates)
        expect(item.excludedForeign && item.estimateRate != null, row.id).toBe(false)
      }
    }
  })

  it('원화 항목은 근거가 없다', () => {
    expect(forecastItemOf(productRow(), ASOF, WITH_RATE).estimateRate).toBeNull()
  })
})
