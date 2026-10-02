import { describe, expect, it } from 'vitest'

import { productDefaults } from '@/lib/forms/defaults'
import {
  IMPORT_KEEPS_STORED,
  currencyChangedBy,
  hasImportGaps,
  importOverStored,
  storedChangesOf,
} from '@/lib/forms/importMerge'

/**
 * 수정 화면의 재불러오기 — 병합 규칙 (DOC-008 §5 SCR-204 v2.12 · SQ-10)
 *
 * 실응답 픽스처를 지나는 조립은 `importPanel.test.ts`가 본다. 여기는 픽스처로 만들기 어려운 갈래다
 * (노낙인으로 바뀌는 상품 · 빈 칸의 판정).
 */

const stored = (): Record<string, string> => ({
  ...productDefaults(),
  name: '내 상품',
  principal: '5000000',
  currency: 'KRW',
  accountType: 'ISA',
  note: '메모',
  kiBarrier: '45',
  kiObservation: 'CONTINUOUS',
  totalRounds: '1',
  'schedules[0].evaluationDate': '2027-01-29',
  'schedules[0].barrier': '80',
  'underlyings[0].assetId': 'a',
  'underlyings[0].basePrice': '100.000000',
})

describe('importOverStored', () => {
  it('저장값이 남는 것은 다섯뿐이다 — 이름을 테스트에 다시 적는 이유: 이 목록이 곧 병합 규칙이다', () => {
    // 상품 통화는 P8 컷 a4에서 빠졌다 — 원천에 «있을 수도» 있는 칸이라 아래 규칙이 따로 정한다.
    // 쿠폰 지급방식은 P8 컷 b2에서 들어왔다 — 불러오기가 채우지 않는 칸이다(채움은 b5)
    expect([...IMPORT_KEEPS_STORED]).toEqual([
      'principal',
      'accountType',
      'note',
      'kiObservation',
      'couponPayout',
    ])
  })

  it('★ 쿠폰 지급방식은 저장값이 남는다 — 바닥의 빈 값이 이기면 V-25로 막힌다 (P8 컷 b2)', () => {
    const merged = importOverStored({ ...stored(), couponPayout: 'AT_REDEMPTION' }, { kiBarrier: '35' })
    expect(merged.couponPayout).toBe('AT_REDEMPTION')
  })

  it('★ 증인 없음(불러온 통화 빈칸)이면 저장값의 통화와 투자원금이 남는다 — 바닥의 빈 값이 이기면 V-22로 막힌다', () => {
    const merged = importOverStored({ ...stored(), currency: 'USD', principal: '10000.50' }, { kiBarrier: '35', currency: '' })
    expect([merged.currency, merged.principal]).toEqual(['USD', '10000.50'])
    // 불러온 값에 키가 아예 없어도 같다
    expect(importOverStored({ ...stored(), currency: 'USD' }, { kiBarrier: '35' }).currency).toBe('USD')
  })

  it('★ X-07 — 불러온 통화가 저장값과 다르면 통화는 불러온 값, 투자원금은 빈칸이다(환산하지 않는다)', () => {
    const merged = importOverStored(stored(), { kiBarrier: '35', currency: 'USD' })
    expect([merged.currency, merged.principal]).toEqual(['USD', ''])
    // 다른 저장값은 그대로다 — 비우는 것은 투자원금 하나다
    expect([merged.accountType, merged.note, merged.kiObservation]).toEqual(['ISA', '메모', 'CONTINUOUS'])
    // 반대 방향도 같다
    const back = importOverStored({ ...stored(), currency: 'USD', principal: '10000.50' }, { kiBarrier: '35', currency: 'KRW' })
    expect([back.currency, back.principal]).toEqual(['KRW', ''])
  })

  it('★ 같은 통화면 아무것도 비우지 않는다 — 같은 상품을 다시 불러와도 투자원금이 지워지지 않는다', () => {
    const merged = importOverStored(stored(), { kiBarrier: '35', currency: 'KRW' })
    expect([merged.currency, merged.principal]).toEqual(['KRW', '5000000'])
  })

  it('currencyChangedBy — 투자원금을 비우는 조건과 안내를 붙이는 조건이 같은 함수다', () => {
    expect(currencyChangedBy(stored(), { currency: 'USD' })).toBe(true)
    expect(currencyChangedBy(stored(), { currency: 'KRW' })).toBe(false)
    expect(currencyChangedBy(stored(), { currency: '' })).toBe(false)
    expect(currencyChangedBy(stored(), {})).toBe(false)
  })

  it('★ 불러온 상품이 노낙인이면 관찰방식의 저장값을 싣지 않는다 — V-16이 저장을 거부한다', () => {
    const merged = importOverStored(stored(), { kiBarrier: '', kiObservation: '' })
    expect(merged.kiObservation).toBe('')
    expect(merged.principal).toBe('5000000')
    // KI 상품이면 싣는다
    expect(importOverStored(stored(), { kiBarrier: '35', kiObservation: '' }).kiObservation).toBe('CONTINUOUS')
  })

  it('바닥은 저장값이 아니라 기본값이다 — 불러온 값에 없는 조건 칸은 저장값이 아니라 기본값이 된다', () => {
    const merged = importOverStored(stored(), { kiBarrier: '35' })
    expect(merged.name).toBe('')
    expect(merged['schedules[0].barrier']).toBeUndefined()
  })
})

describe('hasImportGaps', () => {
  const base = {
    'underlyings[0].assetId': 'a',
    kiBarrier: '35',
    kiObservation: 'CLOSING',
    currency: 'KRW',
    principal: '5000000',
  }
  it('★ 빈 투자원금 · 빈 상품 통화도 빈 곳이다 — X-07이 비운 렌더가 「불러옴」이 되지 않는다', () => {
    expect(hasImportGaps({ ...base, principal: '' })).toBe(true)
    expect(hasImportGaps({ ...base, currency: '' })).toBe(true)
  })

  it('빈 기초자산 · KI 상품의 빈 관찰방식이 빈 곳이다', () => {
    expect(hasImportGaps(base)).toBe(false)
    expect(hasImportGaps({ ...base, 'underlyings[1].assetId': '' })).toBe(true)
    expect(hasImportGaps({ ...base, kiObservation: '' })).toBe(true)
    // 노낙인은 관찰방식이 비어야 옳다
    expect(hasImportGaps({ ...base, kiBarrier: '', kiObservation: '' })).toBe(false)
  })
})

describe('storedChangesOf', () => {
  it('★ X-07 — 상품 통화와 투자원금이 함께 바뀐 칸이 되고 둘 다 힌트에 저장값이 붙는다', () => {
    const before = stored()
    const after = importOverStored(before, { ...before, currency: 'USD' })
    const changes = storedChangesOf(before, after)
    expect(changes.summary).toContain('상품 통화, 투자원금')
    expect(changes.fieldNotes.currency).toBe('저장값 원화')
    expect(changes.fieldNotes.principal).toBe('저장값 5000000')
    // 같은 통화면 둘 다 바뀌지 않았다
    const same = storedChangesOf(before, importOverStored(before, { ...before, currency: 'KRW' }))
    expect(same.summary).not.toContain('상품 통화')
    expect(same.summary).not.toContain('투자원금')
  })

  it('관찰방식이 노낙인 때문에 비면 그것도 바뀐 칸이다 — 힌트는 표시 문자열로', () => {
    const before = stored()
    const after = importOverStored(before, { ...before, kiBarrier: '', kiObservation: '' })
    const changes = storedChangesOf(before, after)
    expect(changes.summary).toContain('KI 배리어')
    expect(changes.summary).toContain('관찰방식')
    expect(changes.fieldNotes.kiObservation).toBe('저장값 장중 터치')
    expect(changes.fieldNotes.kiBarrier).toBe('저장값 45')
    // 총 차수는 힌트를 그릴 칸이 없다 — 요약에만 있다
    expect(storedChangesOf(before, { ...before, totalRounds: '2' }).fieldNotes).toEqual({})
  })

  it('기준가는 같은 자산끼리만 비교한다 — 값이 다르면 종 수를 센다', () => {
    const before = stored()
    expect(storedChangesOf(before, { ...before, 'underlyings[0].basePrice': '100' }).summary).toBe(
      '저장값과 같다 — 불러온 값이 바꾸는 칸이 없다.',
    )
    expect(storedChangesOf(before, { ...before, 'underlyings[0].basePrice': '101' }).summary).toContain('기준가격(1종)')
    // 비어 있던 저장값은 「없음」이다
    expect(storedChangesOf({ ...before, issuer: '' }, { ...before, issuer: '키움증권' }).fieldNotes.issuer).toBe('저장값 없음')
  })
})
