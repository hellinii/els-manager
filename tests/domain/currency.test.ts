import { describe, expect, it } from 'vitest'

import { amountString, dec } from '@/lib/decimal'
import {
  aggregateRealizedPnl,
  hasMinorUnitScale,
  moneyString,
  NO_ESTIMATE_RATES,
  portfolioPnl,
  realizedPnl,
  sumByCurrency,
  toKrw,
  type EstimateRates,
} from '@/lib/domain'

/**
 * 상품 통화 — DOC-007 v1.4 §2 · §4.8 · §7.7, DOC-011 Q-07′ (P8 컷 a2)
 *
 * 원화 경로가 **바이트 단위로 불변**인지가 첫째다 — 기존 스위트의 모든 원화 문자열이 그 위에 있다.
 */

// 원화 문자열의 대표 집합 — 0 · 음수 · 반올림 경계 · 15자리
const KRW_CORPUS = [
  '0',
  '616000',
  '-850000',
  '104000000',
  '104000000.4',
  '104000000.5',
  '-104000000.5',
  '999999999999999',
  '0.5',
  '-0.5',
]

describe('moneyString — 상품 통화의 보조단위 고정 자릿수', () => {
  it.each(KRW_CORPUS)('원화 %s는 amountString과 바이트 단위로 같다', (v) => {
    expect(moneyString(dec(v), 'KRW')).toBe(amountString(dec(v)))
  })

  it.each([
    ['10000', '10000.00'],
    ['10000.5', '10000.50'], // DB는 「2자리 이내」만 보장한다 — 형식은 여기서 고정한다
    ['10600.505', '10600.51'], // 표시 반올림은 half-up (DOC-007 §2)
    ['92.4', '92.40'],
    ['-1000', '-1000.00'],
    ['0', '0.00'],
  ])('달러 %s → %s', (v, expected) => {
    expect(moneyString(dec(v), 'USD')).toBe(expected)
  })
})

describe('hasMinorUnitScale — V-23의 판정', () => {
  it.each([
    ['100000000', 'KRW', true],
    ['100000000.5', 'KRW', false],
    ['100.0', 'KRW', true], // 끝의 0은 decimal.js가 버린다 — 저장 전 정규화가 필요한 이유(모듈 주석)
    ['10000.50', 'USD', true],
    ['10000.505', 'USD', false],
    ['10000.500', 'USD', true],
  ] as const)('%s (%s) → %s', (v, currency, expected) => {
    expect(hasMinorUnitScale(v, currency)).toBe(expected)
  })
})

describe('toKrw — 추정 전용 원화 환산 (DOC-007 §4.8)', () => {
  const rates: EstimateRates = { USD: { currency: 'USD', rate: '1450', asOfDate: '2026-09-28' } }

  it('원화는 그대로다', () => {
    expect(toKrw({ amount: '616000', currency: 'KRW', rates: NO_ESTIMATE_RATES })?.toString()).toBe('616000')
  })

  it('달러 이익 × 추정 환율 — 검산 A-1의 과세 금융소득 870,000', () => {
    // P $10,000 · gross $10,600 → 이익 $600 × 1,450 = 870,000 (DOC-007 §4.8 A-1)
    const profit = dec('10600').minus(dec('10000'))
    expect(toKrw({ amount: profit, currency: 'USD', rates })?.toString()).toBe('870000')
  })

  it('환율이 없으면 null — 기본값을 쓰지 않는다 (E-09)', () => {
    // 1을 대입하면 600원이 되고 그 값이 그럴듯하다 — 검산 A-1의 「x = 1」 줄
    expect(toKrw({ amount: '600', currency: 'USD', rates: NO_ESTIMATE_RATES })).toBeNull()
  })

  it('반올림하지 않는다 — 집계는 반올림하지 않은 값으로 한다', () => {
    const r: EstimateRates = { USD: { currency: 'USD', rate: '1392.4', asOfDate: '2026-09-28' } }
    expect(toKrw({ amount: '202', currency: 'USD', rates: r })?.toString()).toBe('281264.8')
  })
})

describe('sumByCurrency — 통화가 다른 금액을 더하지 않는다 (DOC-007 §7.7)', () => {
  it('통화별로 가르고 원화 → 달러 순서다', () => {
    const result = sumByCurrency([
      { currency: 'USD', amount: '70000' },
      { currency: 'KRW', amount: '1000000000' },
      { currency: 'USD', amount: '0.50' },
    ])
    expect(result.map((r) => [r.currency, r.amount.toString()])).toEqual([
      ['KRW', '1000000000'],
      ['USD', '70000.5'],
    ])
  })

  it('값이 있는 통화만 담는다 — 빈 입력은 빈 배열', () => {
    expect(sumByCurrency([])).toEqual([])
    expect(sumByCurrency([{ currency: 'KRW', amount: '1' }]).map((r) => r.currency)).toEqual(['KRW'])
  })

  it('종전 합산(통화 무시)과 갈리는 자리 — 1,000,070,000「원」이 아니다', () => {
    const naive = dec('1000000000').plus(dec('70000'))
    const byCurrency = sumByCurrency([
      { currency: 'KRW', amount: '1000000000' },
      { currency: 'USD', amount: '70000' },
    ])
    expect(byCurrency).toHaveLength(2)
    expect(byCurrency[0].amount.eq(naive)).toBe(false)
  })
})

describe('portfolioPnl — 실수령액 + 받은 월수익 − 투자원금', () => {
  it('월수익이 없으면 realizedPnl과 같다 — 상환 시 지급 상품은 값이 불변', () => {
    const params = { grossAmount: '104000000', principal: '100000000' }
    expect(
      portfolioPnl({ principal: '100000000', redemptionGross: '104000000', couponGrossTotal: '0' }).eq(
        realizedPnl(params),
      ),
    ).toBe(true)
  })

  it('월수익을 더한다 — 원금 상환이어도 받은 쿠폰만큼 이익이다', () => {
    // 36회 × $202 = $7,272, 원금 그대로 상환
    expect(
      portfolioPnl({ principal: '10000', redemptionGross: '10000', couponGrossTotal: '7272' }).toString(),
    ).toBe('7272')
  })

  it('aggregateRealizedPnl의 서명은 그대로다 — TC-17이 직접 부른다', () => {
    expect(aggregateRealizedPnl([{ grossAmount: '90000000', principal: '100000000' }]).toString()).toBe(
      '-10000000',
    )
  })
})
