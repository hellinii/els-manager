import { describe, expect, it } from 'vitest'

import { productDefaults } from '@/lib/forms/defaults'
import {
  IMPORT_KEEPS_STORED,
  currencyChangedBy,
  hasImportGaps,
  importOverStored,
  recordedMonthChangedBy,
  recordedMonthRefusal,
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
  it('저장값이 남는 것은 넷뿐이다 — 이름을 테스트에 다시 적는 이유: 이 목록이 곧 병합 규칙이다', () => {
    // 상품 통화는 P8 컷 a4에서 빠졌다 — 원천에 «있을 수도» 있는 칸이라 아래 규칙이 따로 정한다.
    // 쿠폰 지급방식은 b2에서 들어왔다가 **b5에서 빠졌다** — 불러오기가 월지급식을 판정하게 되어 원천에 있는 칸이다(ADR-009 §8.7)
    expect([...IMPORT_KEEPS_STORED]).toEqual(['principal', 'accountType', 'note', 'kiObservation'])
  })

  it('★ 불러온 값에 지급방식이 없으면 저장값이다 — 바닥의 빈 값이 이기면 V-25로 막힌다 (b2 · b5 — 통화와 같은 규칙)', () => {
    const merged = importOverStored({ ...stored(), couponPayout: 'AT_REDEMPTION' }, { kiBarrier: '35' })
    expect(merged.couponPayout).toBe('AT_REDEMPTION')
    expect(importOverStored({ ...stored(), couponPayout: 'MONTHLY' }, { kiBarrier: '35', couponPayout: '' }).couponPayout).toBe(
      'MONTHLY',
    )
  })

  it('★ 불러온 지급방식이 저장값을 덮는다 — b5부터 원천에 있는 칸이다(기록이 있으면 X-07 뒷절반이 먼저 거부한다)', () => {
    // b2-5~b4는 반대였다(저장된 월지급식을 남겼다) — 불러오기가 월지급식을 판정하지 못해 늘 「상환 시 지급」을 실었기 때문이다
    const merged = importOverStored({ ...stored(), couponPayout: 'MONTHLY' }, { kiBarrier: '35', couponPayout: 'AT_REDEMPTION' })
    expect(merged.couponPayout).toBe('AT_REDEMPTION')
  })

  it('★ 월지급식을 불러오면 월수익 칸은 불러온 값 그대로다 — 저장값의 37번째 달이 남지 않는다(칸 단위로 합치지 않는다)', () => {
    const before = {
      ...stored(),
      couponPayout: 'MONTHLY',
      monthlyCouponAnnualRate: '24',
      'couponSchedules[0].evaluationDate': '2026-10-15',
      'couponSchedules[36].evaluationDate': '2029-10-15',
    }
    const merged = importOverStored(before, {
      kiBarrier: '35',
      couponPayout: 'MONTHLY',
      monthlyCouponAnnualRate: '24.24',
      'couponSchedules[0].evaluationDate': '2026-10-16',
    })
    expect(merged.monthlyCouponAnnualRate).toBe('24.24')
    expect(merged['couponSchedules[0].evaluationDate']).toBe('2026-10-16')
    expect(merged['couponSchedules[36].evaluationDate']).toBeUndefined()
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

  it('★ 쿠폰 지급방식 · 월수익 연쿠폰율 · 월수익 일정(n개월)도 바뀐 곳이다 (P8 컷 b5 · DOC-008 v2.38)', () => {
    const month = (index: number, evaluationDate: string, paymentDate: string, couponBarrier = '50') => ({
      [`couponSchedules[${index}].evaluationDate`]: evaluationDate,
      [`couponSchedules[${index}].paymentDate`]: paymentDate,
      [`couponSchedules[${index}].couponBarrier`]: couponBarrier,
    })
    const before = {
      ...stored(),
      couponPayout: 'MONTHLY',
      monthlyCouponAnnualRate: '24',
      ...month(0, '2026-10-16', '2026-10-21'),
      ...month(1, '2026-11-17', '2026-11-20'),
    }
    // 같으면 말하지 않는다 — 수는 값으로 비교한다(`24` · `24.00`)
    expect(storedChangesOf(before, { ...before, monthlyCouponAnnualRate: '24.00' }).summary).toBe(
      '저장값과 같다 — 불러온 값이 바꾸는 칸이 없다.',
    )
    const after = {
      ...before,
      couponPayout: 'MONTHLY',
      monthlyCouponAnnualRate: '24.24',
      // 둘째 달은 배리어만 다르다 — 그래도 한 달이다. 셋째 달은 불러온 쪽에만 있다 — 그것도 센다
      ...month(1, '2026-11-17', '2026-11-20', '55'),
      ...month(2, '2026-12-17', '2026-12-22'),
    }
    const changes = storedChangesOf(before, after)
    expect(changes.summary).toContain('월수익 연쿠폰율')
    expect(changes.summary).toContain('월수익 일정(2개월)')
    expect(changes.summary).not.toContain('쿠폰 지급방식')
    expect(changes.fieldNotes.monthlyCouponAnnualRate).toBe('저장값 24')
    // 지급방식이 바뀌면 그 칸 — 힌트는 표시 문자열(DOC-005 §6.1 `couponPayout`)
    const flipped = storedChangesOf({ ...stored(), couponPayout: 'AT_REDEMPTION' }, { ...stored(), couponPayout: 'MONTHLY' })
    expect(flipped.summary).toContain('쿠폰 지급방식')
    expect(flipped.fieldNotes.couponPayout).toBe('저장값 상환 시 지급')
  })
})

describe('X-09 — 기록된 달의 날짜가 바뀌는 불러오기 (DOC-011 §9 X-09 · P8 컷 b5)', () => {
  const values = (rows: Array<[string, string]>) =>
    Object.fromEntries(
      rows.flatMap(([evaluationDate, paymentDate], index) => [
        [`couponSchedules[${index}].evaluationDate`, evaluationDate],
        [`couponSchedules[${index}].paymentDate`, paymentDate],
        [`couponSchedules[${index}].couponBarrier`, '50'],
      ]),
    )
  const storedRows = values([
    ['2026-10-16', '2026-10-21'],
    ['2026-11-17', '2026-11-20'],
    ['2026-12-17', '2026-12-22'],
  ])

  it('기록이 없으면(잠금 없음) 묻지 않는다 · 기록된 달이 같으면 통과한다(기록 없는 달은 바뀌어도 된다)', () => {
    const imported = values([
      ['2026-10-16', '2026-10-21'],
      ['2026-11-16', '2026-11-19'],
      ['2026-12-17', '2026-12-22'],
    ])
    expect(recordedMonthChangedBy(null, storedRows, imported)).toBeNull()
    expect(recordedMonthChangedBy({ recordedCouponNos: [1, 3] }, storedRows, imported)).toBeNull()
  })

  it('★ 기록된 달의 평가일 · 지급일 중 하나라도 다르면 그 첫 달을 돌려준다 — 사유가 그 달과 칸을 적는다', () => {
    const imported = values([
      ['2026-10-16', '2026-10-21'],
      ['2026-11-17', '2026-11-19'],
      ['2026-12-16', '2026-12-21'],
    ])
    const change = recordedMonthChangedBy({ recordedCouponNos: [3, 2] }, storedRows, imported)
    // 순번 순서로 본다 — 2번째의 지급일이 먼저다
    expect(change).toEqual({ couponNo: 2, field: 'paymentDate', stored: '2026-11-20', imported: '2026-11-19' })
    expect(recordedMonthRefusal(change!)).toBe(
      '월수익 지급 기록이 있는 달의 날짜가 불러온 값과 다르다 — 불러오지 않았다(2번째 월수익 지급일 · 저장 2026-11-20 · 불러옴 2026-11-19).',
    )
  })

  it('★ 기록된 순번이 불러온 일정에 없으면(행이 모자라면) 거부다 — 「없음」으로 적는다', () => {
    const imported = values([['2026-10-16', '2026-10-21']])
    const change = recordedMonthChangedBy({ recordedCouponNos: [3] }, storedRows, imported)
    expect(change).toEqual({ couponNo: 3, field: 'evaluationDate', stored: '2026-12-17', imported: '' })
    expect(recordedMonthRefusal(change!)).toContain('불러옴 없음')
  })

  it('월수익 배리어는 보지 않는다 — 동결이 아니다', () => {
    const imported = { ...storedRows, 'couponSchedules[0].couponBarrier': '60' }
    expect(recordedMonthChangedBy({ recordedCouponNos: [1] }, storedRows, imported)).toBeNull()
  })
})
