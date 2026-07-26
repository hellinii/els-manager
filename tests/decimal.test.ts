import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import {
  D,
  dec,
  maxZero,
  roundToUnit,
  sum,
  truncateToUnit,
  ZERO,
} from '@/lib/decimal'
import { expectAmount } from './fixtures/assert'

/** 고정소수점 산술 기반 — DOC-002 M-03, DOC-007 §2 */

describe('부동소수점 오차가 발생하지 않는다 (M-03)', () => {
  it('0.1 + 0.2 = 0.3', () => {
    // 부동소수점에서는 0.30000000000000004가 된다
    expectAmount(dec('0.1').plus(dec('0.2')), '0.3')
  })

  it('비율 누적 계산에서 오차가 쌓이지 않는다', () => {
    let acc = ZERO
    for (let i = 0; i < 10; i += 1) acc = acc.plus(dec('0.1'))
    expectAmount(acc, '1')
  })

  it('원 단위 금액에 세율을 곱해도 정확하다', () => {
    expectAmount(dec('77600000').times(dec('0.154')), '11950400')
    expectAmount(dec('100000000').times(dec('0.0719')), '7190000')
  })
})

describe('dec — 입력 정규화', () => {
  it('NaN·Infinity는 금액이 될 수 없으므로 거부한다', () => {
    expect(() => dec('NaN')).toThrow(RangeError)
    expect(() => dec('Infinity')).toThrow(RangeError)
    expect(() => dec('-Infinity')).toThrow(RangeError)
  })

  it('숫자가 아닌 문자열은 거부한다', () => {
    expect(() => dec('90%')).toThrow()
    expect(() => dec('')).toThrow()
  })

  it('Decimal을 다시 넣어도 같은 값이다', () => {
    expectAmount(dec(dec('0.9')), '0.9')
  })
})

describe('직렬화 — 경계에서 문자열로 전달한다 (DOC-011 §2)', () => {
  it('작은 비율이 지수 표기로 새지 않는다', () => {
    // 기본 설정(toExpNeg: -7)에서는 1e-8로 직렬화되어 계약 규약이 깨진다
    expectAmount(dec('0.00000001'), '0.00000001')
    expectAmount(dec('1').div(dec('100000000')), '0.00000001')
  })

  it('큰 금액이 지수 표기로 새지 않는다', () => {
    expectAmount(dec('1000000000000000000000'), '1000000000000000000000')
  })

  it('나눗셈의 유효자릿수가 충분하다', () => {
    // 1/3을 40자리로 유지한다. 부담률 계산에서 조기 절단이 없어야 한다
    expect(dec('1').div(dec('3')).toString()).toBe(
      '0.3333333333333333333333333333333333333333',
    )
  })
})

describe('truncateToUnit — 세액 절사 (DOC-007 §2, RD-01)', () => {
  it('원 단위로 절사한다', () => {
    expectAmount(truncateToUnit(dec('5133333.282'), '1'), '5133333')
    expectAmount(truncateToUnit(dec('0.154'), '1'), '0')
  })

  it('10원·100원 단위로 절사한다', () => {
    expectAmount(truncateToUnit(dec('5133333'), '10'), '5133330')
    expectAmount(truncateToUnit(dec('5133333'), '100'), '5133300')
  })

  it('이미 단위에 맞으면 값이 변하지 않는다', () => {
    expectAmount(truncateToUnit(dec('17864000'), '1'), '17864000')
    expectAmount(truncateToUnit(dec('17864000'), '10'), '17864000')
  })

  it('0을 향해 버린다', () => {
    expectAmount(truncateToUnit(dec('-1.7'), '1'), '-1')
  })

  it('단위가 0 이하면 거부한다', () => {
    expect(() => truncateToUnit(dec('100'), '0')).toThrow(RangeError)
    expect(() => truncateToUnit(dec('100'), '-1')).toThrow(RangeError)
  })
})

describe('roundToUnit — 화면 표시 금액 반올림 (DOC-007 §2)', () => {
  it('절사가 아니라 반올림한다', () => {
    expectAmount(roundToUnit(dec('1.5'), '1'), '2')
    expectAmount(roundToUnit(dec('1.4'), '1'), '1')
    expectAmount(roundToUnit(dec('5133335'), '10'), '5133340')
  })
})

describe('maxZero — 과세 금융소득의 하한 (절대 규칙 #8)', () => {
  it('음수를 0으로 만든다', () => {
    expectAmount(maxZero(dec('-10000000')), '0')
    expectAmount(maxZero(dec('-0.0001')), '0')
  })

  it('0 이상은 그대로 둔다', () => {
    expectAmount(maxZero(dec('0')), '0')
    expectAmount(maxZero(dec('20000000')), '20000000')
  })
})

describe('sum', () => {
  it('빈 배열은 0이다', () => {
    expectAmount(sum([]), '0')
  })

  it('음수를 포함해 합산한다 — 포트폴리오 손익용', () => {
    expectAmount(sum([dec('-10000000'), dec('20000000')]), '10000000')
  })
})

describe('D — 전역 Decimal 설정을 오염시키지 않는다', () => {
  it('clone에만 precision 40이 적용되고 전역은 기본값(20)을 유지한다', () => {
    expect(D.precision).toBe(40)
    expect(Decimal.precision).toBe(20)

    // 전역 Decimal의 나눗셈은 20자리에서 멈춘다 — 설정이 새지 않았다는 증거
    expect(new Decimal(1).div(3).toString()).toBe('0.33333333333333333333')
  })
})
