import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  amount,
  barrierGap,
  dDayLabel,
  korDate,
  korMonth,
  koreanAmount,
  koreanWon,
  monthKey,
  percent,
  percentPoint,
  priceDisplay,
  signedWon,
  withCommas,
  won,
  ymd,
} from '@/lib/format'

/**
 * 표시 형식 — DOC-005 §9 표준 표기 · §6.2 날짜·D-Day 표기
 *
 * ## 이 파일이 지키는 것은 형식이 아니라 **경계**다
 *
 * 조회 계약이 금액을 정수 문자열로, 비율을 4자리 문자열로, 시세를 6자리 문자열로
 * 준다(Q-07). 표시 계층이 그것을 숫자로 바꾸면 `numeric(15,0)` 금액은 15자리까지
 * float64로 정확하므로 **값 단언으로는 영원히 드러나지 않는다.** 그래서 린트가
 * 변환 수단 자체를 막고(컷 0d 규칙 1), 이 파일은 **float64로는 통과할 수 없는
 * 자릿수**를 함께 단언한다 — 규칙이 지워지면 여기서도 빨간불이 뜨게 만든다.
 */

describe('금액', () => {
  it('세 자리마다 쉼표', () => {
    expect(withCommas('0')).toBe('0')
    expect(withCommas('999')).toBe('999')
    expect(withCommas('1000')).toBe('1,000')
    expect(withCommas('100000000')).toBe('100,000,000')
  })

  it('float64가 표현할 수 없는 자릿수도 정확하다', () => {
    /*
     * `Number.MAX_SAFE_INTEGER`는 9,007,199,254,740,991이다. 그 위의 정수는
     * float64에서 뭉개지므로, 아래 값이 그대로 나오는 것은 **숫자를 경유하지
     * 않았다는 증거**다. `Number(v).toLocaleString()`으로 구현하면 이 케이스가
     * 실패한다 — 린트와 같은 것을 값으로 다시 지킨다.
     */
    expect(won('9007199254740993')).toBe('9,007,199,254,740,993원')
    expect(amount('123456789012345678901234567890')).toBe(
      '123,456,789,012,345,678,901,234,567,890',
    )
  })

  it('음수는 부호를 떼고 나서 자릿수를 넣는다', () => {
    // 부호를 붙인 채 `\B` 경계 규칙을 적용하면 `-1,2,34` 같은 형태가 나온다.
    expect(amount('-1234')).toBe('-1,234')
    expect(won('-100000')).toBe('-100,000원')
  })

  it('손익은 양수에 +를 붙이고 0에는 붙이지 않는다', () => {
    expect(signedWon('1234567')).toBe('+1,234,567원')
    expect(signedWon('-1234567')).toBe('-1,234,567원')
    // 0은 "손실 없음"이지 "이익 있음"이 아니다.
    expect(signedWon('0')).toBe('0원')
  })

  it('만·억 단위 — DOC-011 §4.6 구간 표시명의 부품', () => {
    // `lib/db/queries/map.ts`에서 이관했다(컷 1a). 그쪽 테스트는 합성만 본다.
    expect(koreanAmount(dec('14000000'))).toBe('1,400만')
    expect(koreanAmount(dec('50000000'))).toBe('5,000만')
    expect(koreanAmount(dec('150000000'))).toBe('1억 5,000만')
    expect(koreanAmount(dec('300000000'))).toBe('3억')
    expect(koreanAmount(dec('1000000000'))).toBe('10억')
    expect(koreanAmount(dec('0'))).toBe('0')
    // 만 단위 미만은 버린다 — 구간 하한이 만 단위이므로 표시에 나타날 수 없다.
    expect(koreanAmount(dec('9999'))).toBe('0')
  })

  it('문자열 금액도 한글 단위로 낸다', () => {
    expect(koreanWon('20000000')).toBe('2,000만원')
  })
})

describe('비율', () => {
  it('4자리 문자열 → 퍼센트', () => {
    expect(percent('0.9000')).toBe('90%')
    expect(percent('0.8500')).toBe('85%')
    expect(percent('1.0000')).toBe('100%')
    expect(percent('0.0500')).toBe('5%')
    expect(percent('0.0000')).toBe('0%')
    expect(percent('2.0000')).toBe('200%') // V-08 상한
  })

  it('유효 숫자는 지우지 않고 뒤따르는 0만 지운다', () => {
    expect(percent('0.8850')).toBe('88.5%')
    expect(percent('0.8825')).toBe('88.25%')
    expect(percent('0.8805')).toBe('88.05%')
  })

  it('소수점 이동이므로 정밀도를 잃지 않는다', () => {
    // `Number('0.1235') * 100`은 12.350000000000001이다. 자리 이동은 정확하다.
    expect(percent('0.1235')).toBe('12.35%')
    expect(percent('0.123456')).toBe('12.3456%')
  })

  it('비율의 차이는 %p이고 부호를 명시한다', () => {
    // `-5%p`와 `+5%p`는 조기상환 여부가 갈리는 반대 상황이다.
    expect(percentPoint('0.0500')).toBe('+5%p')
    expect(percentPoint('-0.0500')).toBe('-5%p')
    expect(percentPoint('0.0000')).toBe('0%p')
  })

  describe('배리어까지의 거리 (SCR-201 · 컷 2)', () => {
    it('워스트오브 − 배리어다. 부호가 뒤집히면 임박과 미달이 바뀐다', () => {
      // 1.1000 − 0.9000 = +0.20 → 이미 조기상환 조건을 넘었다
      expect(barrierGap('1.1000', '0.9000')).toBe('+20%p')
      // 0.5500 − 0.8000 = −0.25 → 그만큼 부족하다
      expect(barrierGap('0.5500', '0.8000')).toBe('-25%p')
    })

    it('경계는 0%p다 — 부호를 붙이지 않는다', () => {
      // `+0%p`는 "조금 위"로 읽히지만 실제로는 경계 위다(조기상환 충족).
      expect(barrierGap('0.9000', '0.9000')).toBe('0%p')
    })

    it('뺄셈이 4자리에서 정확하다 — 부동소수점 구현이면 갈린다', () => {
      /*
       * ★ **어느 픽스처가 두 구현을 가르는지 실측했다.** `Number(a) - Number(b)`로
       * 짰을 때의 값이다.
       *
       * | 픽스처 | float64 차 | 그 값의 표시 |
       * |---|---|---|
       * | `1.1000 − 0.9000` | `0.20000000000000007` | `20.000000000000007%p` ← **갈린다** |
       * | `0.4667 − 0.4500` | `0.016699999999999993` | `1.6699999999999993%p` ← **갈린다** |
       * | `0.1235 − 0.1234` | `0.00010000000000000286` | `0.010000000000000286%p` ← **갈린다** |
       * | `0.5500 − 0.8000` | `-0.25` | `-25%p` (같다) |
       * | `0.9000 − 0.9000` | `0` | `0%p` (같다) |
       *
       * 뒤의 둘만 남기면 이 describe는 **부동소수점 구현에서도 전부 통과한다.**
       * 위 세 줄이 이 파일에서 실제로 무게를 지는 케이스이므로 지우지 않는다.
       */
      expect(barrierGap('0.4667', '0.4500')).toBe('+1.67%p')
      expect(barrierGap('0.1235', '0.1234')).toBe('+0.01%p')
    })
  })
})

describe('시세', () => {
  it('뒤따르는 0을 지우고 자릿수를 넣는다', () => {
    expect(priceDisplay('70000.000000')).toBe('70,000')
    expect(priceDisplay('350.120000')).toBe('350.12')
    expect(priceDisplay('1.082500')).toBe('1.0825')
    expect(priceDisplay('0.000001')).toBe('0.000001')
  })

  it('유효 숫자를 버리지 않는다 — 자산마다 필요한 자릿수가 다르다', () => {
    // 자릿수를 고정해 자르면 지수(350.12)나 환산값(1.0825) 한쪽이 반드시 망가진다.
    expect(priceDisplay('12345.678900')).toBe('12,345.6789')
    expect(priceDisplay('0.000000')).toBe('0')
  })
})

describe('날짜 · D-Day — DOC-005 §6.2', () => {
  it('표는 저장 형식 그대로', () => {
    expect(ymd('2026-07-28')).toBe('2026-07-28')
  })

  it('본문은 0을 채우지 않는다', () => {
    expect(korDate('2026-07-08')).toBe('2026년 7월 8일')
    expect(korDate('2026-12-31')).toBe('2026년 12월 31일')
    expect(korMonth('2026-07-28')).toBe('2026년 7월')
  })

  it('월 그룹 키는 정렬 가능한 형태다', () => {
    // SCR-301이 월별로 묶으므로 키가 사전순 = 시간순이어야 한다.
    expect(monthKey('2026-07-28')).toBe('2026-07')
    expect(monthKey('2026-11-01') > monthKey('2026-07-28')).toBe(true)
  })

  it('형식이 아니면 던진다 — 조용히 비우지 않는다', () => {
    // 표시 계층이 빈 문자열을 내면 화면에서 날짜가 사라지고 원인을 알 수 없다.
    expect(() => ymd('2026-7-8')).toThrow(RangeError)
    expect(() => korDate('')).toThrow(RangeError)
    expect(() => korMonth('2026/07/28')).toThrow(RangeError)
  })

  it('과거를 D+로 뒤집는다', () => {
    /*
     * `dDay`의 부호는 `기준일 → 평가일`이고 과거가 음수다(§4.1). 통용 표기는
     * 과거를 `D+`로 적으므로 뒤집음이 필요하며, 그 뒤집음이 화면마다 있으면
     * 임박과 경과가 뒤바뀐다.
     */
    expect(dDayLabel(14)).toBe('D-14')
    expect(dDayLabel(1)).toBe('D-1')
    expect(dDayLabel(0)).toBe('D-DAY')
    expect(dDayLabel(-3)).toBe('D+3')
    expect(dDayLabel(-365)).toBe('D+365')
  })
})
