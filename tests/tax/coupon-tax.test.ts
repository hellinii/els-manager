import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  couponAmount,
  couponConversionOf,
  couponTaxableIncomeKrw,
  MINOR_UNITS,
  NO_ESTIMATE_RATES,
  type EstimateRates,
} from '@/lib/domain'
import { forecastYears, type ForecastItem, type ForecastYearInput } from '@/lib/tax'
import { separateTaxationWithholding } from '@/lib/tax/withholding'

import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'

/**
 * 월수익 사건의 과세 — DOC-007 v1.5 §4.7 · §4.8 **검산 블록 C** · v1.7 §7.5 RD-19 ⓑ (P8 컷 b4)
 *
 * ## 검증 케이스가 아니다
 *
 * 검산 C의 기대값은 「월수익마다 그 지급일 환율로 따로 환산」이라는 **읽기**(RD-13 — 미확인)에 기댄다. TC-23 이후로
 * 만들지 않는다 — 실제 달러 월수익 거래내역과 원 단위로 맞으면 한 커밋에 TC로 올린다. 대조 대상은 금액이 아니라
 * **산식의 모양**(`q_k × x`, 원금 없음)이다. 사상(`incomeEventsOf` · `contributionOf`)을 거친 단언은
 * `tests/db/income.test.ts`가 한다 — 이 파일만 초록이면 사상이 `null`을 0으로 흡수해도 보이지 않는다.
 */

const rates = (rate: string): EstimateRates => ({
  USD: { currency: 'USD', rate, asOfDate: '2026-10-02', source: 'MANUAL' },
})

/** 검산 C — 달러 · `GENERAL` · `P` $10,000.00 · `r_m = 0.2424` */
const C = { principal: '10000.00', annualRate: '0.2424' }
const qC = couponAmount({ ...C, currency: 'USD' })

describe('검산 C — 달러 월수익은 q_k × x 한 번이다', () => {
  it('q_k = $202.00 · 과세(추정) 279,810.4원 — F 안에서 반올림하지 않는다', () => {
    expect(qC.toFixed(2)).toBe('202.00')
    const taxable = couponTaxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      record: null,
      amount: qC,
      rates: rates('1385.20'),
    })
    expect(taxable?.toString()).toBe('279810.4')
  })

  it('원천징수 43,090원 · 달러 기준 참고 $31.10(F에 들어가지 않는다 — §4.5 U8)', () => {
    const krw = separateTaxationWithholding({ taxableIncome: '279810.4', constants: CONSTANTS_2026 })
    expect(krw.toString()).toBe('43090')
    const usd = separateTaxationWithholding({
      taxableIncome: qC,
      constants: CONSTANTS_2026,
      rounding: { unit: MINOR_UNITS.USD.unit, mode: 'TRUNCATE' },
    })
    expect(usd.toFixed(2)).toBe('31.10')
  })

  it('음성 대조 — 상환 모양 max(0, q_k − P)는 0 · 기본 환율 1은 202원이다(둘 다 이 산식이 아니다)', () => {
    expect(dec(qC).minus(dec(C.principal)).lte(0)).toBe(true)
    const one = couponTaxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      record: null,
      amount: qC,
      rates: rates('1'),
    })
    expect(one?.toString()).toBe('202')
  })
})

describe('분기 순서 — TAX_FREE → 기록 → 원화 → × x → null', () => {
  const base = { amount: qC, rates: NO_ESTIMATE_RATES } as const

  it('비과세는 환율 없이 0 — E-09로 세지 않는다(검산 A-2와 같은 자리)', () => {
    expect(couponTaxableIncomeKrw({ ...base, currency: 'USD', accountType: 'TAX_FREE', record: null })?.toString()).toBe('0')
    expect(couponConversionOf({ currency: 'USD', accountType: 'TAX_FREE', record: null })).toBeNull()
  })

  it('기록은 거래내역의 원화 값 그대로 — 환율을 곱하지 않는다 · 비과세가 기록보다 먼저다', () => {
    const record = { taxableIncome: '279824' }
    expect(couponTaxableIncomeKrw({ ...base, currency: 'USD', accountType: 'GENERAL', record })?.toString()).toBe('279824')
    expect(couponTaxableIncomeKrw({ ...base, currency: 'USD', accountType: 'TAX_FREE', record })?.toString()).toBe('0')
    expect(couponConversionOf({ currency: 'USD', accountType: 'GENERAL', record })).toBeNull()
  })

  it('원화 추정은 q_k 전액 — 원금을 빼지 않는다', () => {
    const q = couponAmount({ principal: '100000000', annualRate: '0.0720', currency: 'KRW' })
    expect(
      couponTaxableIncomeKrw({ currency: 'KRW', accountType: 'GENERAL', record: null, amount: q, rates: NO_ESTIMATE_RATES })?.toString(),
    ).toBe('600000')
    expect(couponConversionOf({ currency: 'KRW', accountType: 'GENERAL', record: null })).toBeNull()
  })

  it('★ 달러 추정에 환율이 없으면 null(E-09) — 0으로 흡수하지 않는다. 곱하는 사건은 USD로 표시된다', () => {
    expect(couponTaxableIncomeKrw({ ...base, currency: 'USD', accountType: 'GENERAL', record: null })).toBeNull()
    expect(couponConversionOf({ currency: 'USD', accountType: 'GENERAL', record: null })).toBe('USD')
  })
})

describe('RD-19 ⓑ — hasEstimates의 둘째 절은 원금을 돌려주는 항목만 본다 (DOC-007 v1.7 §7.5)', () => {
  const year = (y: number): ForecastYearInput => ({
    year: y,
    taxLawYear: 2026,
    brackets: BRACKETS_2026,
    constants: CONSTANTS_2026,
    otherIncomeBase: '0',
    otherFinancialIncome: '0',
    subscriberType: 'REGIONAL',
    profileYear: null,
  })

  it('★ 2026에 상환이 확정되고 마지막 달만 2027에 추정으로 남은 상품 — 2026 행은 추정이 아니다', () => {
    const items: ForecastItem[] = [
      // 확정 상환(2026) — 원금을 돌려준다
      { principal: '100000000', attributionYear: 2026, gross: '100000000', taxableIncome: '0', isEstimated: false },
      // 확정 월수익(2026)
      { principal: '0', attributionYear: 2026, gross: '600000', taxableIncome: '600000', isEstimated: false },
      // 마지막 달 — 평가 2026-12-29 · 지급 2027-01-04 · 무기록(추정)
      { principal: '0', attributionYear: 2027, gross: '600000', taxableIncome: '600000', isEstimated: true },
    ]
    const rows = forecastYears({ ownerId: 'o', items, years: [year(2026), year(2027)] })
    expect(rows.map((r) => [r.year, r.hasEstimates])).toEqual([
      [2026, false],
      // 그 해에 귀속되는 추정 월수익은 첫 절이 잡는다
      [2027, true],
    ])
  })

  it('원금을 돌려주는 미상환 항목은 그대로 둘째 절에 걸린다 — 종전 성질 불변', () => {
    const items: ForecastItem[] = [
      { principal: '100000000', attributionYear: 2027, gross: '100000000', taxableIncome: '0', isEstimated: true },
    ]
    const rows = forecastYears({ ownerId: 'o', items, years: [year(2026), year(2027)] })
    expect(rows.map((r) => r.hasEstimates)).toEqual([true, true])
  })

  /*
   * v1.10 — 판정은 사건의 종류(`returnsPrincipal`)이고 원금 값이 아니다. 원금 0 · 종류 명시가 둘째 절을 가른다 —
   * 같은 항목이 플래그만 달라 행 값이 갈리지 않으면 이 대조는 판정이 플래그를 읽는다는 것을 증명하지 못한다
   */
  it('★ 원금 0이어도 원금을 돌려주는 항목이면 둘째 절에 걸린다 — 판정은 종류다 (DOC-007 v1.10)', () => {
    const unknownPrincipal = { principal: '0', attributionYear: 2027, gross: '0', taxableIncome: '0', isEstimated: true }
    const first = (item: ForecastItem) =>
      forecastYears({ ownerId: 'o', items: [item], years: [year(2026), year(2027)] })[0]!.hasEstimates
    expect(first({ ...unknownPrincipal, returnsPrincipal: true })).toBe(true)
    expect(first({ ...unknownPrincipal, returnsPrincipal: false })).toBe(false)
    // 생략하면 `principal ≠ 0` — 종전 입력의 의미
    expect(first(unknownPrincipal)).toBe(false)
    expect(first({ ...unknownPrincipal, principal: '1' })).toBe(true)
  })
})
