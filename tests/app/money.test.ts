import { describe, expect, it } from 'vitest'

import {
  amount,
  exchangeRateDisplay,
  hasKoreanWonUnit,
  isNegativeAmount,
  koreanWon,
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

describe('isNegativeAmount — 손익 색의 판정은 값이다 (홈 피드백 컷 K11)', () => {
  it.each([
    ['-1', true],
    ['-0.01', true],
    ['-1000.00', true],
    ['-123456727012345', true],
    ['0', false],
    ['0.00', false],
    ['616000', false],
    ['860.00', false],
  ])('%s → %s', (v, expected) => {
    expect(isNegativeAmount(v)).toBe(expected)
  })

  it('★ 음의 0은 음수가 아니다 — 첫 글자로 보는 구현을 잡는다', () => {
    /*
     * 종전 화면의 판정은 `startsWith('-')`였다 — 이 케이스들이 붉게 칠해졌다. 오늘 계약은 이 표기를 내지 않는다(`moneyString`의
     * `toFixed`가 음의 0에서 부호를 떨어뜨린다 — 실측). 그래도 ②의 0 숨김(`shownCurrencyRows`)이 값으로 0을 가르므로, 색도 같은
     * 축이어야 「0인데 붉은 줄」이 생기지 않는다. `signedMoney`도 이 표기를 0으로 적는다(위 `'-0.00'` → `$0.00`)
     */
    for (const zero of ['-0', '-0.00', '-0.000', '-00']) {
      expect(isNegativeAmount(zero), zero).toBe(false)
    }
  })
})

describe('hasKoreanWonUnit — 한글 금액 보조와 환산 합계 만 원 접기의 경계는 값이다 (홈 피드백 컷 K13)', () => {
  it.each([
    ['9999', false],
    ['10000', true],
    ['9999.99', false],
    ['10000.00', true],
    ['0', false],
    ['1', false],
    ['99999999', true],
    ['100000000', true],
    ['1097468000', true],
    ['-10000', false],
    ['-1000000000', false],
  ])('%s → %s', (v, expected) => {
    expect(hasKoreanWonUnit(v)).toBe(expected)
  })

  it('★ 표기가 경계를 정하지 않는다 — 앞 0 · 소수 자리가 있어도 같은 값이면 같은 답', () => {
    for (const v of ['010000', '10000.000', '00010000']) expect(hasKoreanWonUnit(v), v).toBe(true)
    for (const v of ['09999', '9999.999', '0009999']) expect(hasKoreanWonUnit(v), v).toBe(false)
  })

  it('종전 판정(`koreanWon(v) !== \'0원\'`)과 같은 답이다 — 화면의 보조 괄호가 서는 자리가 바뀌지 않는다', () => {
    /*
     * 홈 ② 원화 줄 · SCR-401 금액 칸은 종전에 표시 문자열을 비교했다. 그 둘을 값 판정으로 바꾼 것이 글자를 바꾸지 않는다는 것을
     * 이 말뭉치로 본다 — 음수는 `koreanAmount`가 양의 억 · 만만 적어 「0원」이었으므로 거짓이 같은 답이다
     */
    for (const v of ['0', '1', '9999', '10000', '10001', '99999999', '100000000', '100009999', '-1', '-10000', '-850000']) {
      expect(hasKoreanWonUnit(v), v).toBe(koreanWon(v) !== '0원')
    }
  })
})
