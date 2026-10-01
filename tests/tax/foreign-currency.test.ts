import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  grossExpected,
  MINOR_UNITS,
  moneyString,
  NO_ESTIMATE_RATES,
  portfolioPnl,
  taxableIncomeKrw,
  type EstimateRates,
} from '@/lib/domain'
import { aggregateFinancialIncome } from '@/lib/tax/aggregate'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { calculateHealthInsurance } from '@/lib/tax/healthInsurance'
import { separateTaxationWithholding } from '@/lib/tax/withholding'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'

/**
 * 달러 상품의 원화 과세 — DOC-007 v1.4 §4.5 · §4.8 **검산 블록 A** (P8 컷 a2)
 *
 * ## 검증 케이스가 아니다
 *
 * 여섯의 기대값은 원금 환차익을 과세표준 밖으로 읽는 **추론**(RD-13 ⓐ)에 기댄다. 규칙 #1의
 * TC는 「검증된 정답」이므로 이 여섯은 TC-23 이후로 만들지 않는다 — 실제 달러 지급명세서와 원 단위로
 * 맞으면 한 커밋에 TC로 올린다. 그때까지 **이 파일이 산식의 관측 지점**이다(`withholding.test.ts`가
 * §4.5 원화 검산에 대해 같은 자리다).
 *
 * ## 환율을 주입한다
 *
 * `x`를 인자로 넘기므로 `exchange_rates`(컷 a3) 없이 돈다. A-3은 조회 사상에서도 단언한다
 * (`tests/db/map.test.ts`) — a2 동안에는 `x`가 늘 없으므로 E-09가 운영의 유일한 경로이고, 이 파일만
 * 초록이면 사상이 `null`을 0으로 흡수해도 보이지 않는다.
 */

const rates = (rate: string): EstimateRates => ({
  USD: { currency: 'USD', rate, asOfDate: '2026-09-28', source: 'MANUAL' },
})

/** A-1의 상품 — `P` $10,000.00 · `r = 0.12` · `m = 6` · 1차 */
const A1 = {
  principal: '10000.00',
  gross: grossExpected({
    principal: '10000.00',
    couponRate: '0.12',
    evaluationPeriodMonths: 6,
    roundNo: 1,
  }),
}

/** SCR-301의 「달러 기준 참고」 원천징수 — DOC-011 §4.4. 요율은 조회값(규칙 #5) */
const usdWithholding = (usdProfit: string) =>
  separateTaxationWithholding({
    taxableIncome: usdProfit,
    constants: CONSTANTS_2026,
    rounding: { unit: MINOR_UNITS.USD.unit, mode: 'TRUNCATE' },
  })

describe('검산 A-1 — 달러 이익을 한 번 환산한다', () => {
  it('예상 수령액 $10,600.00 · 달러 이익 $600.00', () => {
    expect(moneyString(A1.gross, 'USD')).toBe('10600.00')
  })

  it('과세 금융소득(추정) 870,000원 — (gross − P) × x', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: A1.principal,
      expectedGross: A1.gross,
      rates: rates('1450'),
    })
    expect(income?.toString()).toBe('870000')
  })

  it('틀린 경로 — 원화로 바꾼 두 금액의 차는 2,370,000원이다 (청약 1,300 가정)', () => {
    // 이 산식이 구현에 없다는 것이 요점이다. 값을 고정해 두면 누가 이 경로로 바꿨을 때 A-1이 갈린다
    const wrong = A1.gross.times(1450).minus(dec(A1.principal).times(1300))
    expect(wrong.toString()).toBe('2370000')
  })

  it('참고 원천징수 ≈ $92.40 · 세후 ≈ $10,507.60 (§4.5 「달러 기준 참고」)', () => {
    const withheld = usdWithholding(A1.gross.minus(dec(A1.principal)).toString())
    expect(moneyString(withheld, 'USD')).toBe('92.40')
    expect(moneyString(A1.gross.minus(withheld), 'USD')).toBe('10507.60')
    // 원화로 대조하면 133,980원 — 870,000 × 15.4%와 같다
    expect(withheld.times(1450).toString()).toBe('133980')
  })
})

describe('검산 A-2 — 비과세 계좌는 환율 없이 0이다', () => {
  it('x가 없어도 null이 아니라 0 — E-09로 세지 않는다', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'TAX_FREE',
      principal: A1.principal,
      expectedGross: A1.gross,
      rates: NO_ESTIMATE_RATES,
    })
    expect(income?.toString()).toBe('0')
  })

  it('달러 이익 ≤ 0도 환율 없이 0이다 — 원금상환형 리자드 · 월지급식 상환(컷 b1)', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: '10000.00',
      expectedGross: '10000.00',
      rates: NO_ESTIMATE_RATES,
    })
    expect(income?.toString()).toBe('0')
  })
})

describe('검산 A-3 — 환율이 없으면 null이다 (E-09)', () => {
  it('일반 계좌 · 달러 이익 > 0 · x 없음 → null', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: A1.principal,
      expectedGross: A1.gross,
      rates: NO_ESTIMATE_RATES,
    })
    // 1을 대입하면 600(그럴싸하게 지나간다), 0을 대입하면 빠졌다는 사실이 사라진다
    expect(income).toBeNull()
  })
})

describe('검산 A-4 — 원화 확정 + 달러 추정이 종합과세 경계를 넘는다', () => {
  // 운영의 `ownerId`처럼 `string`으로 넓힌다 — 리터럴이면 키 타입이 좁아져 항목 리터럴과 어긋난다
  const OWNER: string = 'owner-a'
  const YEAR: number = 2026
  const krwConfirmed = taxableIncomeKrw({
    currency: 'KRW',
    accountType: 'GENERAL',
    principal: '100000000',
    redemption: { taxableIncome: '15000000' },
    rates: NO_ESTIMATE_RATES,
  })
  const usdEstimate = taxableIncomeKrw({
    currency: 'USD',
    accountType: 'GENERAL',
    principal: '100000.00',
    expectedGross: '104000.00',
    rates: rates('1350'),
  })

  function summarize(items: Array<string | null>) {
    // E-09는 건 단위다 — 빠진 건만 빼고 나머지는 합친다(null을 0으로 흡수하지 않고 거른다)
    const kept = items.filter((v): v is string => v != null)
    const { financialIncome } = aggregateFinancialIncome({
      key: { ownerId: OWNER, year: YEAR },
      items: kept.map((taxableIncome) => ({ ownerId: OWNER, year: YEAR, taxableIncome })),
    })
    const tax = calculateFinancialIncomeTax({
      financialIncome,
      otherIncomeBase: '0',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    const insurance = calculateHealthInsurance({
      financialIncome,
      subscriberType: 'DEPENDENT',
      constants: CONSTANTS_2026,
    })
    return { financialIncome, tax, insurance, unconverted: items.length - kept.length }
  }

  it('환산 5,400,000 · F 20,400,000 → 종합과세 · 보험료 1,659,492', () => {
    expect(usdEstimate?.toString()).toBe('5400000')
    const r = summarize([krwConfirmed!.toString(), usdEstimate!.toString()])
    expect(r.financialIncome.toString()).toBe('20400000')
    expect(r.tax.isComprehensive).toBe(true)
    expect(r.tax.method1?.toString()).toBe('2856000')
    expect(r.tax.method2?.toString()).toBe('2824000')
    expect(r.tax.computedTax.toString()).toBe('2856000')
    expect(r.tax.localIncomeTax.toString()).toBe('285600')
    expect(r.tax.totalTax.toString()).toBe('3141600')
    expect(r.tax.withheld.toString()).toBe('3141600')
    expect(r.tax.additionalPayment.toString()).toBe('0')
    expect(r.insurance.healthPremium.toString()).toBe('1466760')
    expect(r.insurance.longTermCarePremium.toString()).toBe('192732')
    expect(r.insurance.total.toString()).toBe('1659492')
  })

  it('틀린 경로 — 달러를 원으로 읽으면 F 15,004,000 · 보험료 0', () => {
    const r = summarize([krwConfirmed!.toString(), '4000'])
    expect(r.financialIncome.toString()).toBe('15004000')
    expect(r.tax.isComprehensive).toBe(false)
    expect(r.insurance.total.toString()).toBe('0')
  })

  it('환율이 없으면 달러 건만 빠지고 원화 확정은 남는다 — 그래서 건수 표시가 필수다', () => {
    const missing = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: '100000.00',
      expectedGross: '104000.00',
      rates: NO_ESTIMATE_RATES,
    })
    const r = summarize([krwConfirmed!.toString(), missing?.toString() ?? null])
    expect(r.financialIncome.toString()).toBe('15000000')
    expect(r.insurance.total.toString()).toBe('0')
    expect(r.unconverted).toBe(1)
  })
})

describe('검산 A-5·A-6 — 산식의 정의역 끝 (확정 상환의 힌트 자리)', () => {
  // 추정의 grossExpected는 P 이상이므로 두 입력은 추정에서 나오지 않는다. SCR-203이 실수령액에
  // 이 산식을 적용해 과세 칸의 힌트를 보일 때 만나는 값이다 — 그래서 expectedGross로 넘긴다
  it('A-5 달러 이익 · 원화 손해 — 과세 650,000원 · 손익 +$500.00', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: '10000.00',
      expectedGross: '10500.00',
      rates: rates('1300'),
    })
    expect(income?.toString()).toBe('650000')
    const pnl = portfolioPnl({
      principal: '10000.00',
      redemptionGross: '10500.00',
      couponGrossTotal: '0',
    })
    expect(moneyString(pnl, 'USD')).toBe('500.00')
  })

  it('A-6 달러 손실 — 과세 0 (I-08 · 음수가 아니다) · 손익 −$1,000.00', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: '10000.00',
      expectedGross: '9000.00',
      rates: rates('1500'),
    })
    expect(income?.toString()).toBe('0')
    const pnl = portfolioPnl({
      principal: '10000.00',
      redemptionGross: '9000.00',
      couponGrossTotal: '0',
    })
    expect(moneyString(pnl, 'USD')).toBe('-1000.00')
  })
})

describe('확정값은 환산하지 않는다 (A-04 · U1)', () => {
  it('상환 완료 달러 상품은 거래내역의 원화 값을 그대로 쓴다 — 환율이 없어도', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'GENERAL',
      principal: '10000.00',
      redemption: { taxableIncome: '870000' },
      rates: NO_ESTIMATE_RATES,
    })
    expect(income?.toString()).toBe('870000')
  })

  it('비과세 계좌는 확정값이 있어도 0이다 — 원화 경로와 같은 규칙', () => {
    const income = taxableIncomeKrw({
      currency: 'USD',
      accountType: 'TAX_FREE',
      principal: '10000.00',
      redemption: { taxableIncome: '870000' },
      rates: rates('1450'),
    })
    expect(income?.toString()).toBe('0')
  })

  it('원화 상품은 환율을 보지 않는다 — 환율이 있어도 x를 곱하지 않는다', () => {
    const income = taxableIncomeKrw({
      currency: 'KRW',
      accountType: 'GENERAL',
      principal: '50000000',
      expectedGross: '54305000',
      rates: rates('1450'),
    })
    expect(income?.toString()).toBe('4305000')
  })
})
