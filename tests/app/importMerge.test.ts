import { describe, expect, it } from 'vitest'

import { productDefaults } from '@/lib/forms/defaults'
import { IMPORT_KEEPS_STORED, hasImportGaps, importOverStored, storedChangesOf } from '@/lib/forms/importMerge'

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
  it('저장값이 남는 것은 넷뿐이다 — 이름을 테스트에 다시 적는 이유: 이 목록이 곧 병합 규칙이다', () => {
    expect([...IMPORT_KEEPS_STORED]).toEqual(['principal', 'accountType', 'note', 'kiObservation'])
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
  const base = { 'underlyings[0].assetId': 'a', kiBarrier: '35', kiObservation: 'CLOSING' }
  it('빈 기초자산 · KI 상품의 빈 관찰방식이 빈 곳이다', () => {
    expect(hasImportGaps(base)).toBe(false)
    expect(hasImportGaps({ ...base, 'underlyings[1].assetId': '' })).toBe(true)
    expect(hasImportGaps({ ...base, kiObservation: '' })).toBe(true)
    // 노낙인은 관찰방식이 비어야 옳다
    expect(hasImportGaps({ ...base, kiBarrier: '', kiObservation: '' })).toBe(false)
  })
})

describe('storedChangesOf', () => {
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
