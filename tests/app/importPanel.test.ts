import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import { productDefaults } from '@/lib/forms/defaults'
import { importPanelOf } from '@/lib/forms/importPanel'
import { EDIT_REDEEMED_NOTE, KEPT_OBSERVATION_NOTE } from '@/lib/forms/importMerge'
import { productFieldNames } from '@/lib/forms/productForm'
import { IMPORT_NEW, type ImportTarget } from '@/lib/forms/query'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import { parseSearchBody } from '@/lib/providers/kiwoom/search-parse'
import { parseTermsHtml } from '@/lib/providers/kiwoom/terms-parse'
import type { KiwoomProductCandidate, KiwoomProductTerms } from '@/lib/providers/kiwoom/terms-types'
import type { LookupOutcome } from '@/lib/providers/types'

import { SEARCH_FIXTURES, popupHtml, searchJson, type PopupCode } from '../providers/fixtures/kiwoom-terms'

/**
 * SCR-204 등록·수정 화면의 조립 (DOC-008 §5 SCR-204 v2.9 · 수정 v2.12)
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
  assetType: 'STOCK',
  hasPriceProvider: true,
  providerSymbols: [{ provider: 'KIWOOM_ES040', symbol: '2:A005930' }],
}

const panel = (input: Partial<Parameters<typeof importPanelOf>[0]>) =>
  importPanelOf({
    target: IMPORT_NEW,
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
    expect(p.unresolved).toHaveLength(1)
    expect(p.unresolved[0]).toMatchObject({
      name: 'SK하이닉스',
      resolution: { kind: 'NO_MAPPING', symbol: '2:A000660' },
      detail: null,
      offer: {
        symbol: '2:A000660',
        proposal: {
          ok: true,
          providerSymbol: '2:A000660',
          asset: { name: 'SK하이닉스', assetType: 'STOCK', market: 'KRX', currency: 'KRW' },
        },
        // 삼성전자는 이미 키움 심볼이 있어 연결 선택지가 아니다 — 고르면 그 매핑을 덮는다
        links: [],
        elsewhere: [],
      },
    })
    // 칸 안내는 스칼라 칸으로, 나머지는 구획 머리로 갈라진다
    expect(Object.keys(p.fieldNotes)).toEqual(['kiObservation'])
    expect(p.notes.length).toBeGreaterThan(0)
    // 기본값 위에 불러온 값 — 평가주기 기본값(6)을 불러온 값이 덮는다
    expect(p.initialValues.evaluationPeriodMonths).toBe('6')
    expect(p.initialValues['schedules[0].evaluationDate']).toBe('2026-11-30')
    // 조회가 전부 성공했다 — 새 키를 따른다
    expect(p.keepPreviousKey).toBe(false)
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

  it('★ 키움 심볼 없는 같은 통화 자산이 있으면 연결 선택지가 되고 이름이 같으면 미리 고른다', () => {
    const unmapped: AssetOption = {
      id: '00000000-0000-4000-8000-0000000000b2',
      name: 'SK 하이닉스',
      market: 'KRX',
      currency: 'KRW',
      assetType: 'STOCK',
      hasPriceProvider: false,
      providerSymbols: [],
    }
    const p = panel({
      query: { query: '4000', code: 'E04000' },
      terms: okTerms('E04000'),
      listed: LISTED,
      options: [SAMSUNG, unmapped],
    })
    expect(p.unresolved[0]!.offer!.links).toEqual([{ id: unmapped.id, name: 'SK 하이닉스', preselected: true }])
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
    expect(p.unresolved.every((u) => u.resolution == null && u.offer == null && u.detail != null)).toBe(true)
    expect(p.notes.some((n) => n.includes('기초자산 목록을 받지 못해'))).toBe(true)
    // ★ 해결된 id가 비어 키가 바뀐다 — 직전 키를 유지해야 앞 렌더의 해결 결과·적은 값이 남는다
    expect(p.keepPreviousKey).toBe(true)
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
    const lookupFailed = panel({ query: { query: null, code: 'E04000' }, terms: failed('CALL_FAILED') })
    expect(lookupFailed.state).toBe('LOOKUP_FAILED')
    // ★ 일시 실패가 폼을 비우지 않는다 — 직전 키 유지 (DOC-008 v2.11)
    expect(lookupFailed.keepPreviousKey).toBe(true)
    // 빈 안내 화면은 기다려도 채워지지 않는다 — 유지할 이유가 없다
    expect(panel({ query: { query: null, code: 'E99999' }, terms: failed('NO_DATA') }).keepPreviousKey).toBe(false)
  })
})

describe('수정 화면 — 저장값 위에 채운다 (DOC-008 v2.12 · SQ-10)', () => {
  const PRODUCT_ID = '00000000-0000-4000-8000-00000000e001'
  const EDIT: ImportTarget = { kind: 'EDIT', productId: PRODUCT_ID }

  const HYNIX: AssetOption = {
    id: '00000000-0000-4000-8000-0000000000a2',
    name: 'SK하이닉스',
    market: 'KRX',
    currency: 'KRW',
    assetType: 'STOCK',
    hasPriceProvider: true,
    providerSymbols: [{ provider: 'KIWOOM_ES040', symbol: '2:A000660' }],
  }
  const BOTH = [SAMSUNG, HYNIX]
  const E04000 = { query: '4000', code: 'E04000' }

  /** 등록 화면에서 불러온 E04000 — 저장값을 만드는 재료다(두 자산 다 풀림) */
  const importedNew = () =>
    panel({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH }).initialValues

  /** 수동으로 등록한 E04000 — 이름이 다르고 평가일이 산식이며, 차수·기초자산이 하나씩 더 있다 */
  const manual = (): Record<string, string> => {
    const v = { ...importedNew() }
    v.name = '내 4000회'
    v.principal = '10000000'
    v.accountType = 'GENERAL'
    v.note = '통장 A'
    v.kiObservation = 'CLOSING'
    v['schedules[0].evaluationDate'] = '2026-11-29'
    v['schedules[1].evaluationDate'] = '2027-05-29'
    // DB에서 온 저장값은 `::text`다 — 같은 기준가가 자릿수만 다르다
    v['underlyings[0].basePrice'] = `${v['underlyings[0].basePrice']}${v['underlyings[0].basePrice']!.includes('.') ? '0000' : '.000000'}`
    // 불러온 상품에 없는 7번째 차수와 셋째 기초자산
    v.totalRounds = '7'
    for (const sub of ['evaluationDate', 'barrier', 'lizardBarrier', 'lizardCouponRate', 'lizardRequiresNoKi']) {
      v[`schedules[6].${sub}`] = sub === 'evaluationDate' ? '2029-11-29' : sub === 'barrier' ? '65' : ''
    }
    v['underlyings[2].assetId'] = '00000000-0000-4000-8000-0000000000c3'
    v['underlyings[2].basePrice'] = '100'
    return v
  }

  const edit = (input: Partial<Parameters<typeof importPanelOf>[0]>) => panel({ target: EDIT, ...input })

  it('★ 원천에 없는 넷은 저장값, 나머지 조건은 불러온 값', () => {
    const stored = manual()
    const p = edit({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH, defaults: stored })
    const v = p.initialValues
    expect([v.principal, v.accountType, v.note, v.kiObservation]).toEqual(['10000000', 'GENERAL', '통장 A', 'CLOSING'])
    expect(v.name).toBe('키움 ELS 4000회')
    expect(v['schedules[0].evaluationDate']).toBe('2026-11-30')
    expect(v['schedules[1].evaluationDate']).toBe('2027-05-31')
    expect(v.totalRounds).toBe('6')
    expect(p.target).toEqual(EDIT)
  })

  it('★ 칸 단위로 합치지 않는다 — 저장값의 7번째 차수·셋째 기초자산이 남지 않는다', () => {
    const v = edit({
      query: E04000,
      terms: okTerms('E04000'),
      listed: LISTED,
      options: BOTH,
      defaults: manual(),
    }).initialValues
    expect(Object.keys(v).filter((k) => k.startsWith('schedules[6]') || k.startsWith('underlyings[2]'))).toEqual([])
    // 폼이 그릴 이름은 전부 있다 — 전체 교체(§5.2)가 비울 칸이 없다
    for (const name of productFieldNames({ underlyings: 2, rounds: 6 })) expect(v, name).toHaveProperty([name])
  })

  it('★ 저장값의 관찰방식이 「관찰방식 미정」을 메운다 — 등록에서는 일부 채움, 수정에서는 불러옴', () => {
    const input = { query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH }
    expect(panel(input).state).toBe('PARTIAL')
    const p = edit({ ...input, defaults: manual() })
    expect(p.state).toBe('FILLED')
    expect(p.fieldNotes.kiObservation).toBe(KEPT_OBSERVATION_NOTE)
    // 저장값에 관찰방식이 없으면 여전히 미정이다
    const blank = edit({ ...input, defaults: { ...manual(), kiObservation: '' } })
    expect(blank.state).toBe('PARTIAL')
    expect(blank.fieldNotes.kiObservation).not.toBe(KEPT_OBSERVATION_NOTE)
  })

  it('미해결 기초자산이 남으면 저장값의 관찰방식이 있어도 일부 채움이다', () => {
    const p = edit({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: [SAMSUNG], defaults: manual() })
    expect(p.state).toBe('PARTIAL')
    expect(p.unresolved.map((u) => u.name)).toEqual(['SK하이닉스'])
  })

  it('★ 바뀐 칸을 말한다 — 수는 값으로, 기초자산은 구성으로 비교한다', () => {
    const p = edit({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH, defaults: manual() })
    // 요약이 구획 머리의 첫 줄이다
    expect(p.notes[0]).toBe(
      '저장값과 다른 곳 — 상품명, 총 차수, 평가일(3개 차수), 배리어(1개 차수), 기초자산. 저장하기 전에는 바뀌지 않는다.',
    )
    // 기준가는 자릿수만 다르다 — 「기준가격」이 없다
    expect(p.notes[0]).not.toContain('기준가격')
    expect(p.fieldNotes.name).toBe('저장값 내 4000회')
  })

  it('저장값과 같으면 같다고 말한다 — 이미 키움 값으로 맞춘 상품', () => {
    const stored: Record<string, string> = {
      ...importedNew(),
      principal: '1',
      accountType: 'GENERAL',
      note: '',
      kiObservation: 'CLOSING',
    }
    const p = edit({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH, defaults: stored })
    expect(p.notes[0]).toBe('저장값과 같다 — 불러온 값이 바꾸는 칸이 없다.')
    expect(Object.keys(p.fieldNotes)).toEqual(['kiObservation'])
    // 기초자산의 순서만 다르면 같은 구성이다 — 워스트오브에 순서가 없다
    const swapped = {
      ...stored,
      'underlyings[0].assetId': stored['underlyings[1].assetId']!,
      'underlyings[0].basePrice': stored['underlyings[1].basePrice']!,
      'underlyings[1].assetId': stored['underlyings[0].assetId']!,
      'underlyings[1].basePrice': stored['underlyings[0].basePrice']!,
    }
    expect(
      edit({ query: E04000, terms: okTerms('E04000'), listed: LISTED, options: BOTH, defaults: swapped }).notes[0],
    ).toBe('저장값과 같다 — 불러온 값이 바꾸는 칸이 없다.')
  })

  it('★ 거부·조회 실패·검색은 저장값 그대로다 — 키는 blank(거부) 또는 직전 키(조회 실패)', () => {
    const stored = manual()
    const refused = edit({ query: { query: '3060', code: 'E03060' }, terms: okTerms('E03060'), listed: LISTED, defaults: stored })
    expect(refused.state).toBe('REFUSED')
    expect(refused.initialValues).toEqual(stored)
    expect(refused.formKey).toBe('blank')
    const lookupFailed = edit({ query: E04000, terms: failed('CALL_FAILED'), defaults: stored })
    expect(lookupFailed.initialValues).toEqual(stored)
    expect(lookupFailed.keepPreviousKey).toBe(true)
    const searching = edit({ query: { query: '4000', code: null }, search: okSearch(SEARCH_FIXTURES.q4000), defaults: stored })
    expect(searching.state).toBe('CANDIDATES')
    expect(searching.initialValues).toEqual(stored)
  })

  it('키움에서 상환된 상품이면 기실현 등재가 아니라 상환 처리로 보낸다 — 등록 화면은 그대로', () => {
    const input = { query: { query: '1740', code: 'EM1740' }, terms: okTerms('EM1740'), listed: LISTED }
    expect(panel(input).notes.some((n) => n.includes('기실현 등재'))).toBe(true)
    const p = edit({ ...input, defaults: manual() })
    expect(p.notes).toContain(EDIT_REDEEMED_NOTE)
    expect(p.notes.some((n) => n.includes('기실현 등재'))).toBe(false)
  })
})
