import { describe, expect, it } from 'vitest'

import { splitProductName } from '@/lib/format'

/**
 * 상품명의 회차 — `splitProductName` (홈 피드백 컷 K5 · DOC-005 「회차」)
 *
 * 화면은 이름 끝의 `{숫자}회` · `{숫자}호`만 굵게 하고 앞부분만 말줄임한다(DOC-008 SCR-101 「홈 피드백 컷 K0」 ①).
 * 픽스처는 **그럴싸한 틀린 구현을 하나씩 떨어뜨리게** 골랐다 — 이름 속 첫 숫자를 잡는 구현, 마지막 토큰을 공백으로
 * 자르는 구현, 끝을 다듬는 구현, 「차」까지 받는 구현이다. 어느 픽스처에서나 두 조각을 이으면 이름이다 — 화면의
 * 링크 텍스트가 늘 전체 상품명인 근거다.
 */

const SPLIT: readonly [name: string, lead: string, series: string, why: string][] = [
  ['키움 뉴글로벌 100조 ELS 2047회', '키움 뉴글로벌 100조 ELS ', '2047회', '앞부분 끝의 공백이 lead에 남는다'],
  ['(주) 키움 뉴글로벌100조 ELS 1740회', '(주) 키움 뉴글로벌100조 ELS ', '1740회', '★ 이름 속 첫 숫자(100)를 잡는 구현을 떨어뜨린다'],
  ['키움ELS2047회', '키움ELS', '2047회', '★ 마지막 토큰을 공백으로 자르는 구현을 떨어뜨린다 — 공백이 없다'],
  ['USD_키움 글로벌 ELS 2048회', 'USD_키움 글로벌 ELS ', '2048회', '접두가 달라도 끝만 본다'],
  ['[DEV] 표본 ELS 13호', '[DEV] 표본 ELS ', '13호', '「호」도 회차다'],
  ['[E2E] 상품홈가까움123456회', '[E2E] 상품홈가까움', '123456회', 'e2e 픽스처의 모양 — 숫자가 글자에 붙어 있다'],
]

const KEEP: readonly [name: string, why: string][] = [
  ['키움 뉴글로벌 100조 ELS 3차', '「n차」는 차수다 — 회차가 아니다(DOC-005 §8.3)'],
  ['키움 뉴글로벌 100조 ELS 2047회 ', '끝 공백 — 이름은 저장된 그대로 보이므로 다듬지 않는다'],
  ['키움 뉴글로벌 100조 ELS 2047회 (USD)', '회차가 끝이 아니다'],
  ['2047회', '이름 전체가 회차 — 굵게 할 «나머지»가 없다'],
  ['[E2E] 상품홈원거리123456', '숫자로 끝나도 「회」 · 「호」가 없다 — e2e의 회차 없는 이름'],
  ['키움 ELS 회', '숫자 없는 「회」'],
  ['', '빈 이름'],
]

describe('splitProductName — 이름 끝의 회차 (DOC-005 「회차」)', () => {
  it.each(SPLIT)('가른다 — %s', (name, lead, series) => {
    expect(splitProductName(name)).toEqual({ lead, series })
  })

  it.each(KEEP)('가르지 않는다 — %s', (name) => {
    expect(splitProductName(name)).toEqual({ lead: name, series: null })
  })

  it('★ 불변식 — 두 조각을 이으면 이름이다 (링크 텍스트가 늘 전체 상품명)', () => {
    for (const name of [...SPLIT.map(([n]) => n), ...KEEP.map(([n]) => n)]) {
      const { lead, series } = splitProductName(name)
      expect(lead + (series ?? ''), name).toBe(name)
    }
  })

  it('가른 쪽의 회차는 숫자로 시작하고 「회」 · 「호」로 끝나며 앞부분이 비지 않는다', () => {
    // 전제 — 위 표가 실제로 두 갈래를 다 담았다(한쪽이 비면 이 단언은 항진명제다)
    expect(SPLIT.length).toBeGreaterThan(0)
    for (const [name] of SPLIT) {
      const { lead, series } = splitProductName(name)
      expect(series, name).toMatch(/^\d+[회호]$/)
      expect(lead, name).not.toBe('')
      // 앞부분 끝이 숫자면 회차를 덜 잘랐다(`2047회`의 `47회`만 잡는 꼴)
      expect(lead, name).not.toMatch(/\d$/)
    }
  })
})
