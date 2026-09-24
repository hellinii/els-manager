import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import { importFillOf, lizardCouponPct, type ImportFill } from '@/lib/forms/importFill'
import { resolveImportAssets } from '@/lib/forms/importAssets'
import { formOfValues, parseProductForm } from '@/lib/forms/parse'
import { productDefaults } from '@/lib/forms/defaults'
import { productFieldNames, transition, INTENT_FIELD } from '@/lib/forms/productForm'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import { parseTermsHtml } from '@/lib/providers/kiwoom/terms-parse'
import type { KiwoomProductTerms } from '@/lib/providers/kiwoom/terms-types'

import { popupHtml, type PopupCode } from '../providers/fixtures/kiwoom-terms'

/**
 * 키움 조건 → SCR-204 폼 값 (DOC-008 §5 SCR-204 v2.9 · DOC-010 ADR-009)
 *
 * ## 픽스처는 어댑터의 실응답이다
 *
 * `tests/providers/fixtures/kiwoom-terms/*.html`(2026-09-24 수집)을 **어댑터의 파서 그대로** 지나게
 * 한다 — 조건 객체를 손으로 쓰면 파서가 실제로 내는 형태(`'32.10'`의 뒤 0, `null` 기준가)와 갈린다.
 * 기대값은 팝업 원문에서 옮겼다(각 케이스의 주석).
 */

function termsOf(code: PopupCode): KiwoomProductTerms {
  const parsed = parseTermsHtml(popupHtml(code), code)
  if (!('status' in parsed)) throw new Error(`${code} 파싱 실패: ${parsed.detail}`)
  return { ...parsed, listing: null, listingMiss: null }
}

const filled = (fill: ImportFill) => {
  if (fill.kind === 'REFUSED') throw new Error(`거부됐다: ${fill.reasons.join(' / ')}`)
  return fill
}

const col = (values: Record<string, string>, sub: string, n: number) =>
  Array.from({ length: n }, (_, i) => values[`schedules[${i}].${sub}`])

describe('정상 상품 — 채운다', () => {
  it('★ E04000 — 실제 평가일 · 배리어 · 연쿠폰율 · KI · 기준가', () => {
    const fill = filled(importFillOf(termsOf('E04000'), {}))
    const v = fill.values
    expect(fill.kind).toBe('PARTIAL') // KI 상품 — 관찰방식이 빈다
    expect([v.name, v.issuer, v.issueDate, v.evaluationPeriodMonths, v.totalRounds]).toEqual([
      '키움 ELS 4000회',
      '키움증권',
      '2026-05-29',
      '6',
      '6',
    ])
    // 팝업의 실제 날짜 — 산식(−1일)은 11-28·05-28·…이다. 만기는 사흘 평균의 마지막 날(DQ-10)
    expect(col(v, 'evaluationDate', 6)).toEqual([
      '2026-11-30',
      '2027-05-31',
      '2027-11-29',
      '2028-05-29',
      '2028-11-29',
      '2029-05-29',
    ])
    expect(col(v, 'barrier', 6)).toEqual(['85', '85', '85', '80', '75', '70'])
    // 헤드라인 「최대 연 32.10%」 — 누적 16.05 × 12 / 6과 같다(대조는 어댑터가 했다)
    expect(v.annualCouponRate).toBe('32.1')
    expect(v.kiBarrier).toBe('35') // 110,950 / 317,000
    expect(v.kiObservation).toBe('')
    expect([v['underlyings[0].basePrice'], v['underlyings[1].basePrice']]).toEqual(['317000', '2333000'])
    expect(col(v, 'lizardBarrier', 6).every((x) => x === '')).toBe(true)
    // 불러온 날짜의 기준 — 저장 규칙이 이 날짜들을 실제 날짜로 읽는다
    expect(v.evaluationDateBasis).toBe('2026-05-29|6')
    expect(fill.notes.map((n) => n.field)).toContain('kiObservation')
  })

  it('★ EM1740 — 리자드 1배 · 금요일로 당겨진 4차 · 소수 기준가', () => {
    const fill = filled(importFillOf(termsOf('EM1740'), {}))
    const v = fill.values
    expect([v.issueDate, v.evaluationPeriodMonths, v.totalRounds, v.annualCouponRate]).toEqual([
      '2026-01-30',
      '4',
      '6',
      '21.63',
    ])
    expect(col(v, 'evaluationDate', 6)).toEqual([
      '2026-05-29',
      '2026-09-29',
      '2027-01-29',
      '2027-05-28', // 산식은 토요일 05-29다
      '2027-09-29',
      '2028-01-28',
    ])
    expect(col(v, 'barrier', 6)).toEqual(['80', '80', '75', '75', '70', '60'])
    // 3차에만 리자드 — 배리어 50, 쿠폰 연 21.63%(1배), KI 미터치 요구 켬(DQ-09)
    expect(col(v, 'lizardBarrier', 6)).toEqual(['', '', '50', '', '', ''])
    expect(col(v, 'lizardCouponRate', 6)).toEqual(['', '', '21.63', '', '', ''])
    expect(col(v, 'lizardRequiresNoKi', 6)).toEqual(['', '', 'on', '', '', ''])
    expect([v['underlyings[0].basePrice'], v['underlyings[1].basePrice']]).toEqual(['151.86', '252.18'])
    // 이미 상환된 상품 — 기실현 등재를 함께 안내한다
    expect(fill.notes.some((n) => n.text.includes('기실현 등재'))).toBe(true)
  })

  it('★ EM2046 — 리자드 2배: 쿠폰은 연 16.62 × 2 = 33.24%', () => {
    const v = filled(importFillOf(termsOf('EM2046'), {})).values
    expect(v.annualCouponRate).toBe('16.62')
    expect(v.kiBarrier).toBe('30')
    expect(col(v, 'lizardCouponRate', 6)[2]).toBe('33.24')
    expect(col(v, 'evaluationDate', 6)).toEqual([
      '2027-01-15',
      '2027-05-17',
      '2027-09-17',
      '2028-01-14',
      '2028-05-17',
      '2028-09-15',
    ])
  })

  it('EM1039 — 배수가 적혀 있지 않은 리자드는 누적 수익률에서 환산하고 안내한다', () => {
    const fill = filled(importFillOf(termsOf('EM1039'), {}))
    // 3-2 누적 21 × 12 / (4 × 3) = 21 — 헤드라인 연 21%와 같다(1배)
    expect(col(fill.values, 'lizardCouponRate', 6)[2]).toBe('21')
    expect(fill.notes.some((n) => n.text.includes('배수가 적혀 있지 않다'))).toBe(true)
    // 4자리 절사 가격(85.905)이 그대로 기준가가 된다
    expect(fill.values['underlyings[1].basePrice']).toBe('85.905')
  })

})

describe('거부 — 폼을 비운다', () => {
  it('★ E04262 청약 중 — 기준가격이 없어 저장할 수 없다(V-15) · 기준가를 지어내게 두지 않는다 (DOC-008 v2.11)', () => {
    const fill = importFillOf(termsOf('E04262'), {})
    expect(fill.kind).toBe('REFUSED')
    if (fill.kind === 'REFUSED') {
      expect(fill.reasons[0]).toBe(
        '청약 중인 상품이다 — 기준가격이 아직 정해지지 않아 저장할 수 없다. 기준가격 결정일 뒤 다시 불러온다.',
      )
    }
  })

  it('★ E03060 — 표의 1·2차 배리어(85)가 사다리(88)와 다르다', () => {
    const fill = importFillOf(termsOf('E03060'), {})
    expect(fill.kind).toBe('REFUSED')
    if (fill.kind !== 'REFUSED') return
    expect(fill.reasons).toEqual([
      '1차 배리어가 다르다 — 사다리 88% · 표 85%. 투자설명서로 확인한다.',
      '2차 배리어가 다르다 — 사다리 88% · 표 85%. 투자설명서로 확인한다.',
    ])
    // 값을 하나도 싣지 않는다 — 부분만 믿을 수 있는 값을 채우면 나머지도 믿는다
    expect('values' in fill).toBe(false)
  })

  it('EM2048 — 월지급식 · 외화', () => {
    const fill = importFillOf(termsOf('EM2048'), {})
    expect(fill.kind).toBe('REFUSED')
    if (fill.kind === 'REFUSED') {
      expect(fill.reasons.some((r) => r.startsWith('월지급식이다'))).toBe(true)
      expect(fill.reasons.some((r) => r.startsWith('외화 상품이다'))).toBe(true)
    }
  })

  it('E00795 — 사다리 없음 · 만기 구획 없음 · KI 비율 없음', () => {
    const fill = importFillOf(termsOf('E00795'), {})
    expect(fill.kind).toBe('REFUSED')
    if (fill.kind === 'REFUSED') {
      expect(fill.reasons).toHaveLength(3)
      expect(fill.reasons.some((r) => r.includes('만기상환 평가정보가'))).toBe(true)
    }
  })
})

describe('이 층만 하는 거부 — 합성 변형', () => {
  it('★ 산식에서 10일 넘게 벗어난 평가일은 거부한다 — 연·월을 잘못 읽은 날짜', () => {
    const terms = termsOf('E04000')
    const shifted: KiwoomProductTerms = {
      ...terms,
      rounds: terms.rounds.map((r, i) => (i === 1 ? { ...r, evaluationDate: '2027-06-15' } : r)),
    }
    const fill = importFillOf(shifted, {})
    expect(fill.kind).toBe('REFUSED')
    if (fill.kind === 'REFUSED') expect(fill.reasons.join(' ')).toContain('2차 평가일 2027-06-15')
    // 경계 — 실측 차이(E04000 +2일)는 통과한다. 10일이면 통과, 11일이면 거부
    const at = (date: string) =>
      importFillOf(
        { ...terms, rounds: terms.rounds.map((r, i) => (i === 1 ? { ...r, evaluationDate: date } : r)) },
        {},
      ).kind
    expect(at('2027-06-08')).not.toBe('REFUSED') // 산식(0일 규약) 05-29 + 10
    expect(at('2027-06-09')).toBe('REFUSED') // + 11
  })

  it('★ 배수가 적혀 있지 않은 리자드 쿠폰은 정방향으로 찾는다 — 절사된 누적을 역산하지 않는다 (ADR-009 §3 v3.9)', () => {
    const at = (headlinePct: string, periodMonths: number, round: number, cumulativePct: string) =>
      lizardCouponPct({ headlinePct, multiple: null, periodMonths, round, cumulativePct })

    // 반박 검토의 반례 — 연 24.25% · 6개월 · 1차: 정확한 누적 12.125가 12.12로 절사되어 표시된다.
    // 역산하면 12.12 × 12 / 6 = 24.24(소수 둘째 자리 안이라 종전 검사를 통과했다 — 틀린 연율이다)
    expect(at('24.25', 6, 1, '12.12')).toBe('24.25')
    // 2배 — 누적이 절사된 24.25가 된다
    expect(at('24.25', 6, 1, '24.25')).toBe('48.5')
    // EM1039 실측 — 연 21% · 4개월 · 3차 · 1배
    expect(at('21', 4, 3, '21')).toBe('21')
    // 어떤 정수 배수와도 맞지 않으면 거부
    expect(at('21', 4, 3, '21.01')).toBeNull()
    expect(at('21', 4, 2, '21')).toBeNull() // 1.5배 — 정수 배수가 아니다
    // 배수가 적혀 있으면 배수 × 헤드라인 — 누적은 어댑터가 대조했다
    expect(lizardCouponPct({ headlinePct: '16.62', multiple: 2, periodMonths: 4, round: 3, cumulativePct: '33.24' })).toBe(
      '33.24',
    )
  })

  it('예상하지 못한 입력에도 던지지 않는다 — 거부가 된다', () => {
    const terms = termsOf('E04000')
    const broken = { ...terms, rounds: null } as unknown as KiwoomProductTerms
    expect(() => importFillOf(broken, {})).not.toThrow()
    expect(importFillOf(broken, {}).kind).toBe('REFUSED')
  })
})

describe('불변식', () => {
  it('★ 투자원금·계좌유형·비고를 절대 채우지 않는다', () => {
    for (const code of ['E04000', 'EM1740', 'EM2046', 'EM1039'] as const) {
      const v = filled(importFillOf(termsOf(code), {})).values
      for (const key of ['principal', 'accountType', 'note']) expect(key in v, `${code} ${key}`).toBe(false)
    }
  })

  it('★ 채운 이름이 전부 폼의 이름이다 — 폼에 없는 이름은 값 좁힘에서 조용히 사라진다', () => {
    for (const code of ['E04000', 'EM1740', 'EM2046'] as const) {
      const v = filled(importFillOf(termsOf(code), {})).values
      const names = new Set(productFieldNames({ underlyings: 2, rounds: Number.parseInt(v.totalRounds!, 10) }))
      for (const key of Object.keys(v)) expect(names, `${code} ${key}`).toContain(key)
    }
  })

  it('★ 왕복 — 불러온 값 + 사용자 입력 셋이 저장 제출을 지나 계약 입력이 된다(날짜는 그대로)', () => {
    const v = filled(importFillOf(termsOf('EM1740'), {})).values
    const next = transition(
      formOfValues({
        ...productDefaults(),
        ...v,
        principal: '19,390,000',
        accountType: 'GENERAL',
        kiObservation: 'CLOSING',
        [INTENT_FIELD]: 'SUBMIT',
      }),
    )
    expect(next.saveHeld).toBe(false)
    const input = parseProductForm(formOfValues(next.values))
    expect(input.annualCouponRate).toBe('0.2163')
    expect(input.kiBarrier).toBe('0.3500')
    expect(input.schedules.map((s) => s.evaluationDate)).toEqual(col(v, 'evaluationDate', 6))
    expect(input.schedules[2]).toMatchObject({
      barrier: '0.7500',
      lizardBarrier: '0.5000',
      lizardCouponRate: '0.2163',
      lizardRequiresNoKi: true,
    })
    expect(input.principal).toBe('19390000')
  })
})

describe('기초자산 — 해석 결과를 따른다', () => {
  const LISTED: ListedAsset[] = [
    { underlyingType: '2', stkCode: 'A005930', name: '삼성전자' },
    { underlyingType: '2', stkCode: 'A000660', name: 'SK하이닉스' },
  ]
  const option = (id: string, symbol: string): AssetOption => ({
    id,
    name: id,
    market: 'KRX',
    currency: 'KRW',
    hasPriceProvider: true,
    providerSymbols: [{ provider: 'KIWOOM_ES040', symbol }],
  })

  it('풀린 자산은 id를 채우고 풀리지 않은 것은 비우고 이름을 넘긴다', () => {
    const terms = termsOf('E04000')
    const resolutions = resolveImportAssets({
      assets: terms.assets,
      listed: LISTED,
      options: [option('a-samsung', '2:A005930')],
    })
    const fill = filled(importFillOf(terms, resolutions))
    expect(fill.values['underlyings[0].assetId']).toBe('a-samsung')
    expect(fill.values['underlyings[1].assetId']).toBe('')
    expect(fill.unresolved).toEqual(['SK하이닉스'])
  })

  it('같은 앱 자산으로 풀린 둘째 행은 비운다 — V-09가 거부한다', () => {
    const terms = termsOf('E04000')
    const fill = filled(
      importFillOf(terms, {
        삼성전자: { kind: 'RESOLVED', assetId: 'same', symbol: '2:A005930', listed: LISTED[0]! },
        SK하이닉스: { kind: 'RESOLVED', assetId: 'same', symbol: '2:A000660', listed: LISTED[1]! },
      }),
    )
    expect([fill.values['underlyings[0].assetId'], fill.values['underlyings[1].assetId']]).toEqual(['same', ''])
    expect(fill.kind).toBe('PARTIAL')
  })
})
