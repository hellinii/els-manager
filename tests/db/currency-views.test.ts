import { describe, expect, it } from 'vitest'

import { totalsByCurrency } from '@/lib/db/queries/dashboard'
import { forecastItemOf } from '@/lib/db/queries/forecast'
import type { TaxYearContext } from '@/lib/db/queries/load'
import {
  toProductDetailView,
  toProductListItem,
  toScheduleItems,
} from '@/lib/db/queries/map'
import { sortItems } from '@/lib/db/queries/products'
import { computeOwnTax, contributionOf } from '@/lib/db/queries/tax'
import { TAX_CONSTANT_KEY_MAP } from '@/lib/db/taxConstants'
import { dec } from '@/lib/decimal'
import { NO_ESTIMATE_RATES, type EstimateRates } from '@/lib/domain'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'
import { OWNER, priceMap, productRow, redemption, schedule, taxBasis } from './helpers/rows'

/**
 * 달러 상품의 조회 사상 — DOC-011 v4.9 §4.1~§4.8 · DOC-007 §4.8 검산 A (P8 컷 a2)
 *
 * **검산 A-3을 사상에서도 단언한다**(DOC-007 §4.8 각주). 컷 a2 동안에는 추정 환율이 늘 없으므로
 * E-09가 운영의 유일한 경로이고, 순수 함수(`tests/tax/foreign-currency.test.ts`)에서만 초록이면
 * 사상이 `null`을 0으로 흡수해도 보이지 않는다. 그래서 여기서는 매퍼 넷(목록 · 상세 · 평가일정 ·
 * 세금 기여 · 전망 항목)을 **행 픽스처로** 지나간다.
 *
 * 달러 픽스처는 **센트를 싣는다**(`'10000.50'`) — 센트가 0이면 반올림이 형식과 값 둘 다에서
 * 보이지 않는다(DOC-011 Q-07′).
 */

const ASOF = '2026-06-30'

const WITH_RATE: EstimateRates = {
  USD: { currency: 'USD', rate: '1450', asOfDate: '2026-06-29' },
}

/** 달러 · 미상환 · 일반 계좌 — 1차(2026-07-02)가 적용 차수 */
function usdActive(overrides: Parameters<typeof productRow>[0] = {}) {
  return productRow({ currency: 'USD', principal: '10000.50', ...overrides })
}

/** A-1의 상품 — `P` $10,000.00 · `r = 0.12` · 6개월 */
function a1Row(overrides: Parameters<typeof productRow>[0] = {}) {
  return productRow({
    currency: 'USD',
    principal: '10000.00',
    annual_coupon_rate: '0.1200',
    ...overrides,
  })
}

describe('§4.2 목록 — 원금이 상품 통화다', () => {
  it('달러 원금은 소수 두 자리 고정이고 통화를 함께 싣는다', () => {
    const item = toProductListItem(usdActive(), priceMap([]), ASOF, OWNER)
    expect(item.currency).toBe('USD')
    expect(item.principal).toBe('10000.50')
  })

  it('저장 scale이 달라도 형식은 출력이 정한다 — `10000.5`도 `10000.50`', () => {
    const item = toProductListItem(usdActive({ principal: '10000.5' }), priceMap([]), ASOF, OWNER)
    expect(item.principal).toBe('10000.50')
  })

  it('원화 목록 항목은 종전 문자열 그대로다', () => {
    const item = toProductListItem(productRow(), priceMap([]), ASOF, OWNER)
    expect(item).toMatchObject({ currency: 'KRW', principal: '100000000' })
  })
})

describe('§4.1 totals.byCurrency — 통화를 넘어 더하지 않는다', () => {
  /*
   * 통합 스위트의 형식 검사는 이 값들이 **자기 통화의 형식**인지만 본다 — 전 통화를 더한 값도
   * `'4400600'`·`'4400600.25'`처럼 형식은 정상이라 초록이다(반박 검토 지적). 그래서 값을 여기서 본다.
   */
  const krwActive = productRow({ id: 'krw-active', principal: '100000000' })
  const krwRedeemed = productRow({ id: 'krw-redeemed', redemptions: redemption() })
  const usdActive2 = usdActive({ id: 'usd-active', principal: '70000.00' })
  const usdRedeemed = usdActive({
    id: 'usd-redeemed',
    redemptions: redemption({ gross_amount: '10600.75', taxable_income: '835740' }),
  })
  const split = (rows: ReturnType<typeof productRow>[]) =>
    totalsByCurrency(
      rows,
      rows.filter((row) => row.redemptions == null),
      rows.filter((row) => row.redemptions != null),
    )

  it('통화마다 한 행 — 보유 건수 · 원금 · 손익이 그 통화의 상품에서만 나온다', () => {
    expect(split([krwActive, krwRedeemed, usdActive2, usdRedeemed])).toEqual([
      { currency: 'KRW', activeCount: 1, activePrincipal: '100000000', realizedPnl: '4000000' },
      { currency: 'USD', activeCount: 1, activePrincipal: '70000.00', realizedPnl: '600.25' },
    ])
  })

  it('상환만 있는 통화도 행이 선다 — 보유 상품이 없어도 손익이 갈 자리가 있어야 한다', () => {
    expect(split([krwActive, usdRedeemed])).toEqual([
      { currency: 'KRW', activeCount: 1, activePrincipal: '100000000', realizedPnl: '0' },
      { currency: 'USD', activeCount: 0, activePrincipal: '0.00', realizedPnl: '600.25' },
    ])
  })

  it('상품 0건이면 원화 0 한 행이다 — 빈 배열을 주지 않는다', () => {
    expect(split([])).toEqual([
      { currency: 'KRW', activeCount: 0, activePrincipal: '0', realizedPnl: '0' },
    ])
  })
})

describe('§4.3 상세 — 한 상품 안에서 금액이 두 통화다', () => {
  it('상품 통화 금액은 달러, 예상 과세는 E-09(`null`) — 추정 환율이 없다 (검산 A-3)', () => {
    const view = toProductDetailView(usdActive(), priceMap([]), ASOF, OWNER, NO_ESTIMATE_RATES)
    expect(view.product).toMatchObject({ currency: 'USD', principal: '10000.50' })
    // 10000.50 × (1 + 0.08 × 6/12) = 10400.52
    expect(view.schedules[0]!.expectedGross).toBe('10400.52')
    expect(view.projection).toMatchObject({
      appliedRoundNo: 1,
      expectedGross: '10400.52',
      // 「0」이 아니다 — 0은 계산한 값으로 읽힌다. `1`을 대입하면 400이다
      expectedTaxableIncome: null,
      attributionYear: 2026,
    })
  })

  it('추정 환율이 있으면 달러 이익을 한 번 곱한다 — 400.02 × 1,450 = 580,029원', () => {
    const view = toProductDetailView(usdActive(), priceMap([]), ASOF, OWNER, WITH_RATE)
    expect(view.projection?.expectedTaxableIncome).toBe('580029')
  })

  it('비과세 계좌는 환율 없이 `0` — E-09가 아니다 (검산 A-2)', () => {
    const view = toProductDetailView(
      usdActive({ account_type: 'TAX_FREE' }),
      priceMap([]),
      ASOF,
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(view.projection?.expectedTaxableIncome).toBe('0')
  })

  it('원화 상품은 환율이 있어도 곱하지 않는다 — 종전 값 그대로', () => {
    const view = toProductDetailView(productRow(), priceMap([]), ASOF, OWNER, WITH_RATE)
    expect(view.projection?.expectedTaxableIncome).toBe('4000000')
    expect(view.product.currency).toBe('KRW')
  })

  it('상환 실적 — 실수령액 · 손익은 달러, 과세 둘은 거래내역의 원화, 적용 환율은 6자리', () => {
    const view = toProductDetailView(
      usdActive({
        redemptions: redemption({
          gross_amount: '10600.75',
          taxable_income: '835740',
          withholding_tax: '128700',
          exchange_rate: '1392.4',
        }),
      }),
      priceMap([]),
      ASOF,
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(view.redemption).toMatchObject({
      grossAmount: '10600.75',
      realizedPnl: '600.25',
      taxableIncome: '835740',
      withholdingTax: '128700',
      exchangeRate: '1392.400000',
    })
    expect(view.projection).toBeNull()
  })

  it('원화 상환의 적용 환율은 `null`이다', () => {
    const view = toProductDetailView(
      productRow({ redemptions: redemption() }),
      priceMap([]),
      ASOF,
      OWNER,
      NO_ESTIMATE_RATES,
    )
    expect(view.redemption?.exchangeRate).toBeNull()
    expect(view.redemption?.grossAmount).toBe('104000000')
  })
})

describe('§4.4 평가일정 — 「달러 기준 참고」 (U8 · 검산 A-1)', () => {
  it('A-1: 세전 $10,600.00 · 원천징수 ≈ $92.40 · 세후 ≈ $10,507.60 · 손익 +$600.00', () => {
    const [first] = toScheduleItems(a1Row(), priceMap([]), ASOF, taxBasis())
    expect(first).toMatchObject({ currency: 'USD', principal: '10000.00' })
    expect(first!.proceeds).toMatchObject({
      expectedGross: '10600.00',
      expectedWithholding: '92.40',
      expectedNet: '10507.60',
      expectedPnl: '600.00',
    })
  })

  it('센트 아래는 절사한다 — 400.02 × 15.4% = 61.60308 → $61.60', () => {
    const [first] = toScheduleItems(usdActive(), priceMap([]), ASOF, taxBasis())
    expect(first!.proceeds).toMatchObject({
      expectedGross: '10400.52',
      expectedWithholding: '61.60',
      expectedNet: '10338.92',
      expectedPnl: '400.02',
    })
  })

  it('★ 원천징수는 **절사**다 — 이익 $400.05 × 15.4% = 61.6077 → $61.60 (반올림이면 61.61)', () => {
    // 세전 10001.26 × 1.04 = 10401.3104 → 센트로 접어 10401.31 (원 단위로 접으면 10401).
    // 위 두 케이스는 세율 곱의 셋째 자리가 5 미만이라 절사와 반올림을 가르지 못했다(반박 검토)
    const [first] = toScheduleItems(
      usdActive({ principal: '10001.26' }),
      priceMap([]),
      ASOF,
      taxBasis(),
    )
    expect(first!.proceeds).toMatchObject({
      expectedGross: '10401.31',
      expectedWithholding: '61.60',
      expectedNet: '10339.71',
      expectedPnl: '400.05',
    })
  })

  it('★ 세전을 **먼저** 센트로 접는다 — 원천징수 · 세후 · 손익이 그 한 값에서 나온다', () => {
    // 원금 9999.90 × 1.04 = 10399.896 → 10399.90. 접은 값에서: 이익 400.00 → 61.60 · 세후 10338.30.
    // 접지 않고 계산하면 이익 399.996 → 61.59 · 세후 10338.31 — 화면에서 세후 + 원천징수 ≠ 세전이 된다.
    // 위 케이스들은 세전이 센트에 딱 맞아 이 둘을 가르지 못했다(반박 검토)
    const [first] = toScheduleItems(usdActive({ principal: '9999.90' }), priceMap([]), ASOF, taxBasis())
    expect(first!.proceeds).toMatchObject({
      expectedGross: '10399.90',
      expectedWithholding: '61.60',
      expectedNet: '10338.30',
      expectedPnl: '400.00',
    })
  })

  it('★ 세후 + 원천징수 = 세전이 달러에서도 선다 — 세 값이 한 반올림값에서 나온다', () => {
    for (const item of toScheduleItems(usdActive(), priceMap([]), ASOF, taxBasis())) {
      const p = item.proceeds!
      expect(dec(p.expectedNet).plus(dec(p.expectedWithholding)).toFixed(2)).toBe(p.expectedGross)
    }
  })

  it('원화 차수는 종전 값 그대로다 — 616,000 · 103,384,000', () => {
    const [first] = toScheduleItems(productRow(), priceMap([]), ASOF, taxBasis())
    expect(first!.proceeds).toMatchObject({
      expectedGross: '104000000',
      expectedWithholding: '616000',
      expectedNet: '103384000',
      expectedPnl: '4000000',
    })
  })
})

describe('§4.6 세금 기여 — E-09는 건 단위다', () => {
  it('달러 추정 · 환율 없음 → 금액 `null` · `exchangeRateMissing` (검산 A-3)', () => {
    const c = contributionOf(usdActive(), 2026, ASOF, NO_ESTIMATE_RATES)
    expect(c).toMatchObject({ amount: null, exchangeRateMissing: true, isEstimated: true })
    // gross는 상품 통화 그대로다 — 전망(§4.7)이 같은 x로 바꾼다
    expect(c?.gross.toFixed(2)).toBe('10400.52')
  })

  it('달러 확정 상환 → 거래내역의 원화 과세 그대로 · 빠지지 않는다', () => {
    const c = contributionOf(
      usdActive({
        redemptions: redemption({ gross_amount: '10600.75', taxable_income: '835740' }),
      }),
      2026,
      ASOF,
      NO_ESTIMATE_RATES,
    )
    expect(c).toMatchObject({ exchangeRateMissing: false, isEstimated: false })
    expect(c?.amount?.toString()).toBe('835740')
  })

  it('computeOwnTax — 원화 확정은 늘 들어가고 달러 추정만 빠진다 · 기여 행은 남는다', () => {
    const yearContext: TaxYearContext = {
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

    const own = computeOwnTax({
      products: [
        productRow({ id: 'krw-redeemed', redemptions: redemption({ taxable_income: '4000000' }) }),
        usdActive({ id: 'usd-active' }),
      ],
      ownerId: OWNER,
      year: 2026,
      asOf: ASOF,
      yearContext,
      otherFinancialIncome: dec('0'),
      otherIncomeBase: dec('0'),
      rates: NO_ESTIMATE_RATES,
    })

    expect(own.financialIncome.toString()).toBe('4000000')
    expect(own.unconvertedCount).toBe(1)
    expect(own.contributions.map((c) => [c.row.id, c.contribution.amount?.toString() ?? null])).toEqual([
      ['krw-redeemed', '4000000'],
      ['usd-active', null],
    ])
  })
})

describe('§4.7 전망 항목 — 원화 합에서 빼고 센다', () => {
  it('달러 미상환 · 환율 없음 → 원금 · 수령액 0 · `excludedForeign`', () => {
    const item = forecastItemOf(usdActive(), ASOF, NO_ESTIMATE_RATES)
    expect(item.excludedForeign).toBe(true)
    expect(dec(item.principal).isZero()).toBe(true)
    expect(dec(item.gross).isZero()).toBe(true)
    // 항목은 남는다 — 귀속연도가 그대로다
    expect(item.attributionYear).toBe(2026)
  })

  it('★ 달러 확정 상환 · 환율 없음 → 원화 과세는 F에 남는다 (§4.6의 표 첫 줄)', () => {
    const item = forecastItemOf(
      usdActive({ redemptions: redemption({ redemption_date: '2026-05-07', taxable_income: '835740' }) }),
      ASOF,
      NO_ESTIMATE_RATES,
    )
    expect(dec(item.taxableIncome).toString()).toBe('835740')
    // Y₀에 상환됐으므로 첫 행부터 원화 합에 필요하다 — 센다
    expect(item.excludedForeign).toBe(true)
  })

  it('기준 연도 이전에 상환된 달러 상품은 어느 열에도 없으므로 세지 않는다', () => {
    const item = forecastItemOf(
      usdActive({ redemptions: redemption({ redemption_date: '2025-11-03' }) }),
      ASOF,
      NO_ESTIMATE_RATES,
    )
    expect(item.excludedForeign).toBe(false)
  })

  it('추정 환율이 있으면 원금과 수령액을 **같은 x로** 바꾼다 · 추정이다', () => {
    const item = forecastItemOf(usdActive(), ASOF, WITH_RATE)
    expect(item.excludedForeign).toBe(false)
    expect(item.isEstimated).toBe(true)
    expect(dec(item.principal).toString()).toBe('14500725')
    expect(dec(item.gross).toString()).toBe('15080754')
    expect(dec(item.taxableIncome).toString()).toBe('580029')
  })

  it('원화 항목은 종전 그대로다', () => {
    const item = forecastItemOf(productRow(), ASOF, WITH_RATE)
    expect(item).toMatchObject({ principal: '100000000', excludedForeign: false })
  })
})

describe('§4.2 원금 정렬 — 통화로 먼저 묶는다 (DOC-008 SQ-15)', () => {
  it('원화 전부(큰 순) → 달러 전부(큰 순) — 숫자로 섞지 않는다', () => {
    const items = [
      // 숫자만 보면 달러 70,000이 이 5만 원보다 크다 — 묶지 않으면 순서가 섞인다(음성 대조가 서는 입력)
      productRow({ id: 'krw-small', principal: '50000' }),
      productRow({ id: 'usd-big', currency: 'USD', principal: '70000.00' }),
      productRow({ id: 'krw-big', principal: '1000000000' }),
      productRow({ id: 'usd-small', currency: 'USD', principal: '9999.99' }),
    ].map((row) => toProductListItem(row, priceMap([]), ASOF, OWNER))

    expect(sortItems(items, 'PRINCIPAL').map((item) => item.id)).toEqual([
      'krw-big',
      'krw-small',
      'usd-big',
      'usd-small',
    ])
  })
})

describe('schedule 픽스처 확인', () => {
  it('기본 픽스처의 1차가 적용 차수다 — 위 케이스의 전제', () => {
    expect(productRow().redemption_schedules[0]).toEqual(schedule({ round_no: 1 }))
  })
})
