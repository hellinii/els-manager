import { describe, expect, it } from 'vitest'

import {
  amount,
  exchangeRateDisplay,
  money,
  moneyAmount,
  signedMoney,
  signedWon,
  won,
} from '@/lib/format'

/**
 * 통화 표시 — DOC-005 v1.6 §9 (GQ-05), P8 컷 a2
 *
 * **원화 경로는 바이트 단위로 불변이다** — `money(v,'KRW')`가 `won(v)`를 그대로 부른다.
 * e2e가 화면 문자열(`'616,000원'`)을 고정하므로 여기가 갈리면 그쪽이 먼저 빨갛게 된다.
 */

const KRW_CORPUS = ['0', '616000', '-850000', '104000000', '999999999999999', '-1']

describe('원화 — won·signedWon·amount와 같다', () => {
  it.each(KRW_CORPUS)('%s', (v) => {
    expect(money(v, 'KRW')).toBe(won(v))
    expect(signedMoney(v, 'KRW')).toBe(signedWon(v))
    expect(moneyAmount(v, 'KRW')).toBe(amount(v))
  })

  it('기존 화면 문자열 그대로 — 616,000원', () => {
    expect(money('616000', 'KRW')).toBe('616,000원')
  })
})

describe('달러 — $1,234.56', () => {
  it.each([
    ['10600.00', '$10,600.00'],
    ['1234567.89', '$1,234,567.89'],
    ['-92.40', '-$92.40'],
    ['0.00', '$0.00'],
    ['5', '$5.00'], // 계약 밖에서 온 값도 두 자리로 보인다
  ])('money(%s) → %s', (v, expected) => {
    expect(money(v, 'USD')).toBe(expected)
  })

  it.each([
    ['860.00', '+$860.00'],
    ['-1000.00', '-$1,000.00'],
    ['0.00', '$0.00'], // 0은 「이익 있음」이 아니다 — signedWon과 같은 규칙
    ['-0.00', '$0.00'],
  ])('signedMoney(%s) → %s', (v, expected) => {
    expect(signedMoney(v, 'USD')).toBe(expected)
  })

  it('단위 없는 형태 — 열 머리글에 통화가 있을 때', () => {
    expect(moneyAmount('10600.00', 'USD')).toBe('10,600.00')
  })
})

describe('환율 — 1,392.40원/달러', () => {
  it.each([
    ['1392.400000', '1,392.40원/달러'],
    ['1358.4', '1,358.40원/달러'],
    ['1360', '1,360.00원/달러'],
    ['1385.205000', '1,385.21원/달러'], // 표시만 두 자리 반올림(half-up) — 저장은 여섯 자리
    ['999.994999', '999.99원/달러'],
  ])('%s → %s', (v, expected) => {
    expect(exchangeRateDisplay(v)).toBe(expected)
  })

  it('여섯 자리 저장값을 그대로 쉼표 처리하지 않는다 — 반올림이 먼저다', () => {
    // withCommas는 소수부 네 자리 이상에서 틀린다('1,392.123,456'). 반올림을 빼면 이 단언이 빨갛다
    expect(exchangeRateDisplay('1392.123456')).toBe('1,392.12원/달러')
  })
})
