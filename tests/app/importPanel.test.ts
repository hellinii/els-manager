import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import { productDefaults } from '@/lib/forms/defaults'
import { importPanelOf } from '@/lib/forms/importPanel'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import { parseSearchBody } from '@/lib/providers/kiwoom/search-parse'
import { parseTermsHtml } from '@/lib/providers/kiwoom/terms-parse'
import type { KiwoomProductCandidate, KiwoomProductTerms } from '@/lib/providers/kiwoom/terms-types'
import type { LookupOutcome } from '@/lib/providers/types'

import { SEARCH_FIXTURES, popupHtml, searchJson, type PopupCode } from '../providers/fixtures/kiwoom-terms'

/**
 * SCR-204 등록 화면의 조립 (DOC-008 §5 SCR-204 v2.9)
 *
 * 페이지가 할 일을 전부 여기서 본다 — 페이지는 어떤 스위트의 import 그래프에도 없다(AQ-23).
 * 조회 결과는 어댑터의 실응답 픽스처를 파서 그대로 지나게 만든다.
 */

const okTerms = (code: PopupCode): LookupOutcome<KiwoomProductTerms> => {
  const parsed = parseTermsHtml(popupHtml(code), code)
  if (!('status' in parsed)) throw new Error(parsed.detail)
  return { ok: true, data: { ...parsed, listing: null, listingMiss: null } }
}

const okSearch = (
  fixture: (typeof SEARCH_FIXTURES)[keyof typeof SEARCH_FIXTURES],
): LookupOutcome<KiwoomProductCandidate[]> => {
  const parsed = parseSearchBody(searchJson(fixture))
  if (!('candidates' in parsed)) throw new Error(parsed.detail)
  return { ok: true, data: parsed.candidates, ...(parsed.truncated ? { truncated: true } : {}) }
}

const failed = <T,>(failure: 'NO_DATA' | 'CALL_FAILED'): LookupOutcome<T> => ({
  ok: false,
  failure,
  code: failure === 'NO_DATA' ? 'EMPTY' : 'NETWORK',
  detail: '테스트',
})

const LISTED: LookupOutcome<ListedAsset[]> = {
  ok: true,
  data: [
    { underlyingType: '2', stkCode: 'A005930', name: '삼성전자' },
    { underlyingType: '2', stkCode: 'A000660', name: 'SK하이닉스' },
  ],
}

const SAMSUNG: AssetOption = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: '삼성전자',
  market: 'KRX',
  currency: 'KRW',
  hasPriceProvider: true,
  providerSymbols: [{ provider: 'KIWOOM_ES040', symbol: '2:A005930' }],
}

const panel = (input: Partial<Parameters<typeof importPanelOf>[0]>) =>
  importPanelOf({
    query: { query: null, code: null },
    search: null,
    terms: null,
    listed: null,
    options: [],
    defaults: productDefaults(),
    ...input,
  })

describe('검색 단계', () => {
  it('검색 전 — 기본값 그대로, 키는 blank', () => {
    const p = panel({})
    expect(p.state).toBe('IDLE')
    expect(p.initialValues).toEqual(productDefaults())
    expect(p.formKey).toBe('blank')
  })

  it('후보 목록 · 결과가 더 있으면 알린다(100001)', () => {
    const p = panel({ query: { query: '100조', code: null }, search: okSearch(SEARCH_FIXTURES.q100jo) })
    expect(p.state).toBe('CANDIDATES')
    expect(p.candidates.length).toBe(40)
    expect(p.truncated).toBe(true)
  })

  it('결과 없음은 실패가 아니다(505065)', () => {
    expect(panel({ query: { query: '3060회', code: null }, search: okSearch(SEARCH_FIXTURES.q3060) }).state).toBe(
      'NO_RESULTS',
    )
  })

  it('검색이 실패하면 조회 실패 — 폼은 기본값 그대로 쓸 수 있다', () => {
    const p = panel({ query: { query: '4000', code: null }, search: failed('CALL_FAILED') })
    expect(p.state).toBe('LOOKUP_FAILED')
    expect(p.initialValues).toEqual(productDefaults())
  })
})

describe('상세 단계', () => {
  it('★ E04000 — 일부 채움: 삼성전자는 풀리고 SK하이닉스는 미해결로 남는다', () => {
    const p = panel({
      query: { query: '4000', code: 'E04000' },
      terms: okTerms('E04000'),
      listed: LISTED,
      options: [SAMSUNG],
    })
    expect(p.state).toBe('PARTIAL')
    expect(p.productName).toBe('키움 ELS 4000회')
    expect(p.prospectusUrl).toMatch(/BE04000\.pdf$/)
    expect(p.initialValues['underlyings[0].assetId']).toBe(SAMSUNG.id)
    expect(p.unresolved).toEqual([
      {
        name: 'SK하이닉스',
        resolution: { kind: 'NO_MAPPING', symbol: '2:A000660', listed: LISTED.ok ? LISTED.data[1] : null },
      },
    ])
    // 칸 안내는 스칼라 칸으로, 나머지는 구획 머리로 갈라진다
    expect(Object.keys(p.fieldNotes)).toEqual(['kiObservation'])
    expect(p.notes.length).toBeGreaterThan(0)
    // 기본값 위에 불러온 값 — 평가주기 기본값(6)을 불러온 값이 덮는다
    expect(p.initialValues.evaluationPeriodMonths).toBe('6')
    expect(p.initialValues['schedules[0].evaluationDate']).toBe('2026-11-30')
  })

  it('★ 자산이 풀리면 폼 키가 바뀐다 — 같은 주소에서 자산을 추가해도 폼이 새 값을 받는다', () => {
    const before = panel({ query: { query: '4000', code: 'E04000' }, terms: okTerms('E04000'), listed: LISTED })
    const after = panel({
      query: { query: '4000', code: 'E04000' },
      terms: okTerms('E04000'),
      listed: LISTED,
      options: [SAMSUNG],
    })
    expect(before.formKey).not.toBe(after.formKey)
    expect(before.formKey.startsWith('E04000:')).toBe(true)
  })

  it('기초자산 목록을 받지 못하면 채움은 하되 자산을 잇지 않고 알린다', () => {
    const p = panel({
      query: { query: '4000', code: 'E04000' },
      terms: okTerms('E04000'),
      listed: failed('CALL_FAILED'),
      options: [SAMSUNG],
    })
    expect(p.state).toBe('PARTIAL')
    expect(p.initialValues['underlyings[0].assetId']).toBe('')
    expect(p.unresolved.every((u) => u.resolution == null)).toBe(true)
    expect(p.notes.some((n) => n.includes('기초자산 목록을 받지 못해'))).toBe(true)
  })

  it('★ E03060 — 거부: 폼은 기본값 그대로, 사유와 투자설명서', () => {
    const p = panel({ query: { query: '3060', code: 'E03060' }, terms: okTerms('E03060'), listed: LISTED })
    expect(p.state).toBe('REFUSED')
    expect(p.initialValues).toEqual(productDefaults())
    expect(p.formKey).toBe('blank')
    expect(p.reasons).toHaveLength(2)
    expect(p.prospectusUrl).not.toBeNull()
  })

  it('없는 코드(빈 안내 화면)는 거부 · 호출 실패는 조회 실패', () => {
    expect(panel({ query: { query: null, code: 'E99999' }, terms: failed('NO_DATA') }).state).toBe('REFUSED')
    expect(panel({ query: { query: null, code: 'E04000' }, terms: failed('CALL_FAILED') }).state).toBe(
      'LOOKUP_FAILED',
    )
  })
})
