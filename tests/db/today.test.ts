import { describe, expect, it } from 'vitest'

import { currentYear, today } from '@/lib/db/today'

/**
 * 기준일의 KST/UTC 경계 — DOC-011 §4.0 Q-02
 *
 * **`asOf`를 가짜로 주입하는 테스트로는 이 결함을 절대 잡을 수 없다.** 결함은
 * "지금"을 날짜로 바꾸는 그 한 줄에만 있고, 나머지 계약은 전부 `asOf`를 인자로
 * 받기 때문이다. 그래서 여기서 그 한 줄을 직접 겨눈다.
 *
 * 실행 환경(Vercel·Node)은 UTC다. `toISOString().slice(0,10)`을 쓰면 매일
 * KST 00:00~09:00 동안 전날이 기준일이 된다.
 */
describe('today() — Asia/Seoul 기준', () => {
  it('UTC 14:59:59는 아직 같은 날이다 (KST 23:59:59)', () => {
    expect(today(new Date('2026-07-27T14:59:59Z'))).toBe('2026-07-27')
  })

  it('UTC 15:00:00에 날짜가 넘어간다 (KST 익일 00:00)', () => {
    // 여기가 결함이 사는 자리다. UTC 날짜를 쓰면 이 시점에도 07-27을 반환한다.
    expect(today(new Date('2026-07-27T15:00:00Z'))).toBe('2026-07-28')
  })

  it('UTC 00:00은 이미 KST 09:00이다 — 같은 날', () => {
    expect(today(new Date('2026-07-27T00:00:00Z'))).toBe('2026-07-27')
  })

  it('연말 경계 — UTC 2026-12-31 15:00은 KST 2027-01-01이다', () => {
    // 이 하루가 어긋나면 currentYearTax.year가 전년이 되어 세율 시드까지 틀린다
    expect(today(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
    expect(today(new Date('2026-12-31T14:59:59Z'))).toBe('2026-12-31')
  })

  it('월 경계 — 말일 UTC 15:00은 다음 달 1일이다', () => {
    expect(today(new Date('2026-02-28T15:00:00Z'))).toBe('2026-03-01')
    expect(today(new Date('2026-01-31T15:00:00Z'))).toBe('2026-02-01')
  })

  it('항상 YYYY-MM-DD 형식이다 — 한 자리 월·일도 0으로 채운다', () => {
    expect(today(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
    expect(today(new Date('2026-01-05T15:00:00Z'))).toBe('2026-01-06')
  })

  it('UTC로 계산한 값과 실제로 다르다 — 방어가 작동하는지 확인', () => {
    const boundary = new Date('2026-07-27T15:30:00Z')
    const naiveUtc = boundary.toISOString().slice(0, 10)

    expect(naiveUtc).toBe('2026-07-27')
    expect(today(boundary)).toBe('2026-07-28')
    // 두 값이 같아지면 KST 변환이 사라진 것이다
    expect(today(boundary)).not.toBe(naiveUtc)
  })
})

describe('currentYear() — 기준일에서 파생한다', () => {
  it('기준일의 연도를 쓴다', () => {
    expect(currentYear('2026-07-27')).toBe(2026)
    expect(currentYear('2027-01-01')).toBe(2027)
  })

  it('KST로 해가 바뀐 시점의 기준일과 일관된다', () => {
    // new Date().getFullYear()를 따로 부르면 UTC 연도가 되어 여기서 갈린다
    const asOf = today(new Date('2026-12-31T15:00:00Z'))
    expect(asOf).toBe('2027-01-01')
    expect(currentYear(asOf)).toBe(2027)
  })

  it('형식이 어긋나면 던진다', () => {
    expect(() => currentYear('26-07-27')).toThrow(/YYYY-MM-DD/)
    expect(() => currentYear('')).toThrow(/YYYY-MM-DD/)
  })
})
