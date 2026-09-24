import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { AssetInput, ProviderSymbolInput } from '@/lib/db/mutations/types'
import {
  IMPORT_ASSET_INTENT_FIELD,
  assetProposalOf,
  candidateRowsOf,
  importFormKey,
  linkChoicesOf,
  mappedElsewhereOf,
  parseImportAssetForm,
  runImportAsset,
  type ImportAssetCommand,
} from '@/lib/forms/import'
import { parseSearchBody } from '@/lib/providers/kiwoom/search-parse'
import type { KiwoomProductCandidate } from '@/lib/providers/kiwoom/terms-types'

import { SEARCH_FIXTURES, searchJson } from '../providers/fixtures/kiwoom-terms'

/**
 * SCR-204 불러오기의 배관 (DOC-008 §5 SCR-204 v2.9)
 *
 * 후보는 어댑터의 **실응답 픽스처**를 파서 그대로 지나게 한다(`search-100000-795.json` —
 * 부분 일치로 넷이 나오고 「회」·「호」가 섞인다).
 */

function candidates(fixture: (typeof SEARCH_FIXTURES)[keyof typeof SEARCH_FIXTURES]): KiwoomProductCandidate[] {
  const parsed = parseSearchBody(searchJson(fixture))
  if (!('candidates' in parsed)) throw new Error(`검색 픽스처 파싱 실패: ${parsed.detail}`)
  return parsed.candidates
}

describe('후보 목록', () => {
  it('★ 회차가 정확히 같은 것을 위로 — 부분 일치가 3795회·2795호도 낸다', () => {
    const rows = candidateRowsOf('795', candidates(SEARCH_FIXTURES.q795))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const exact = rows.filter((r) => r.exact)
    expect(exact.length).toBeGreaterThan(0)
    expect(exact.every((r) => r.candidate.roundNumber === '795')).toBe(true)
    // 정확한 것이 먼저 온다
    expect(rows.findIndex((r) => !r.exact)).toBeGreaterThan(rows.findLastIndex((r) => r.exact))
    // 「795회」라고 적어도 같다
    expect(candidateRowsOf('795회', candidates(SEARCH_FIXTURES.q795)).filter((r) => r.exact)).toHaveLength(
      exact.length,
    )
  })

  it('월지급·외화는 목록에서 사유를 말한다 — EM2048', () => {
    const [row] = candidateRowsOf('2048', candidates(SEARCH_FIXTURES.q2048))
    expect(row!.refusal).not.toBeNull()
  })

  it('보통 상품은 사유가 없다 — E04000', () => {
    const [row] = candidateRowsOf('4000', candidates(SEARCH_FIXTURES.q4000))
    expect(row!.refusal).toBeNull()
    expect(row!.exact).toBe(true)
  })
})

describe('폼 키', () => {
  it('불러오지 않으면 blank · 해결된 자산 id가 바뀌면 키도 바뀐다', () => {
    expect(importFormKey(null, {})).toBe('blank')
    const before = importFormKey('E04000', { 'underlyings[0].assetId': '', 'underlyings[1].assetId': '' })
    const after = importFormKey('E04000', { 'underlyings[0].assetId': 'a1', 'underlyings[1].assetId': '' })
    expect(before).not.toBe(after)
  })
})

describe('자산 추가 제안 — 허용 목록', () => {
  const row = (underlyingType: string, stkCode: string, name: string) => ({ underlyingType, stkCode, name })

  it('국내 주식·국내 지수는 KRX · KRW', () => {
    expect(assetProposalOf(row('2', 'A000660', 'SK하이닉스'))).toEqual({
      ok: true,
      providerSymbol: '2:A000660',
      asset: { name: 'SK하이닉스', assetType: 'STOCK', market: 'KRX', currency: 'KRW' },
    })
    expect(assetProposalOf(row('1', '201', 'KOSPI200지수'))).toMatchObject({
      ok: true,
      asset: { assetType: 'INDEX', market: 'KRX', currency: 'KRW' },
    })
  })

  it('해외는 시장을 생략하고 통화를 목록에서 정한다', () => {
    const pltr = assetProposalOf(row('3', 'PLTR', '팔란티어 테크'))
    expect(pltr).toEqual({
      ok: true,
      providerSymbol: '3:PLTR',
      asset: { name: '팔란티어 테크', assetType: 'STOCK', currency: 'USD' },
    })
    expect(assetProposalOf(row('1', '_HK#HIDX', 'HSCEI 지수'))).toEqual({
      ok: true,
      providerSymbol: '1:_HK#HIDX',
      asset: { name: 'HSCEI 지수', assetType: 'INDEX', currency: 'HKD' },
    })
  })

  it('★ 선물·금리·모르는 지수는 거부한다 — 추측하지 않는다', () => {
    for (const code of ['_WTIF', '_BRENTF', '_CD91', '_UNKNOWN']) {
      expect(assetProposalOf(row('1', code, code)).ok, code).toBe(false)
    }
    expect(assetProposalOf(row('2', 'B000660', 'x')).ok).toBe(false)
  })
})

describe('기존 자산에 연결', () => {
  const option = (
    id: string,
    name: string,
    currency: string,
    symbols: Array<[string, string]> = [],
    assetType: AssetOption['assetType'] = 'STOCK',
  ): AssetOption => ({
    id,
    name,
    market: null,
    currency,
    assetType,
    hasPriceProvider: symbols.length > 0,
    providerSymbols: symbols.map(([provider, symbol]) => ({ provider, symbol })),
  })
  const proposal: AssetInput = { name: '팔란티어 테크', assetType: 'STOCK', currency: 'USD' }

  it('★ 키움 심볼이 이미 있는 자산은 선택지에 없다 — 고르면 그 매핑을 덮는다', () => {
    const choices = linkChoicesOf(
      [
        option('a1', '팔란티어', 'USD'),
        option('a2', '팔란티어 테크', 'USD'),
        option('a3', '테슬라', 'USD', [['KIWOOM_ES040', '3:TSLA']]),
        option('a4', '삼성전자', 'KRW'),
      ],
      proposal,
    )
    expect(choices.map((c) => c.id)).toEqual(['a1', 'a2'])
    expect(choices.find((c) => c.preselected)?.id).toBe('a2')
  })

  it('★ 같은 통화라도 유형이 다르면 선택지가 아니다 — 주식 제안에 지수를 내지 않는다 (DOC-008 v2.11)', () => {
    const choices = linkChoicesOf([option('i1', 'S&P500', 'USD', [], 'INDEX'), option('s1', '팔란티어', 'USD')], proposal)
    expect(choices.map((c) => c.id)).toEqual(['s1'])
  })

  it('이름이 같은데 다른 심볼에 연결된 자산은 따로 말한다(SCR-302로)', () => {
    const elsewhere = mappedElsewhereOf(
      [option('a1', '팔란티어 테크', 'USD', [['KIWOOM_ES040', '3:PLTX']]), option('a2', '팔란티어 테크', 'USD', [['KIWOOM_ES040', '3:PLTR']])],
      '팔란티어 테크',
      '3:PLTR',
    )
    expect(elsewhere).toEqual([{ id: 'a1', name: '팔란티어 테크', symbol: '3:PLTX' }])
  })
})

describe('자산 추가·연결 제출', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    return f
  }
  const UUID = '00000000-0000-4000-8000-0000000000a1'

  it('CREATE — 입력과 복귀 주소를 읽는다', () => {
    expect(
      parseImportAssetForm(
        form({
          [IMPORT_ASSET_INTENT_FIELD]: 'CREATE',
          name: 'SK하이닉스',
          assetType: 'STOCK',
          market: 'KRX',
          currency: 'krw',
          providerSymbol: '2:A000660',
          q: '4000',
          code: 'E04000',
        }),
      ),
    ).toEqual({
      kind: 'CREATE',
      asset: { name: 'SK하이닉스', assetType: 'STOCK', market: 'KRX', currency: 'KRW' },
      providerSymbol: '2:A000660',
      back: { query: '4000', code: 'E04000' },
    })
  })

  it('★ 심볼이 형식에 맞지 않으면 쓰기 전에 거부한다 — 고아 자산을 만들지 않는다', () => {
    const cmd = parseImportAssetForm(form({ [IMPORT_ASSET_INTENT_FIELD]: 'CREATE', name: 'x', providerSymbol: 'PLTR' }))
    expect(cmd.kind).toBe('INVALID')
  })

  it('LINK는 UUID가 아니면 거부한다', () => {
    expect(
      parseImportAssetForm(form({ [IMPORT_ASSET_INTENT_FIELD]: 'LINK', assetId: 'x', providerSymbol: '3:PLTR' })).kind,
    ).toBe('INVALID')
    expect(
      parseImportAssetForm(form({ [IMPORT_ASSET_INTENT_FIELD]: 'LINK', assetId: UUID, providerSymbol: '3:PLTR' })),
    ).toMatchObject({ kind: 'LINK', assetId: UUID })
  })

  /** 부른 순서와 인자를 기록하는 가짜 계약 */
  function ports(results: { create?: ActionResult<{ id: string }>; map?: ActionResult<void> }) {
    const calls: Array<[string, unknown]> = []
    return {
      calls,
      ports: {
        async createAsset(input: AssetInput) {
          calls.push(['createAsset', input])
          return results.create ?? { ok: true as const, data: { id: UUID } }
        },
        async saveProviderSymbol(input: ProviderSymbolInput) {
          calls.push(['saveProviderSymbol', input])
          return results.map ?? { ok: true as const, data: undefined }
        },
      },
    }
  }
  const create: ImportAssetCommand = {
    kind: 'CREATE',
    asset: { name: 'SK하이닉스', assetType: 'STOCK', market: 'KRX', currency: 'KRW' },
    providerSymbol: '2:A000660',
    back: { query: '4000', code: 'E04000' },
  }

  it('★ 추가는 자산 → 매핑 순서이고 provider는 상수다', async () => {
    const p = ports({})
    expect(await runImportAsset(create, p.ports)).toEqual({ ok: true, back: create.back })
    expect(p.calls).toEqual([
      ['createAsset', create.asset],
      ['saveProviderSymbol', { assetId: UUID, provider: 'KIWOOM_ES040', providerSymbol: '2:A000660' }],
    ])
  })

  it('중복이면 연결로 안내하고 매핑을 부르지 않는다', async () => {
    const p = ports({ create: { ok: false, error: { code: 'CONFLICT', message: '중복' } } })
    const outcome = await runImportAsset(create, p.ports)
    expect(outcome).toMatchObject({ ok: false })
    if (!outcome.ok) expect(outcome.message).toContain('기존 자산에 연결')
    expect(p.calls.map((c) => c[0])).toEqual(['createAsset'])
  })

  it('★ 매핑이 실패하면 「자산은 등록됐다」를 말한다 — 중간 상태는 미매핑 자산이다(AQ-74)', async () => {
    const p = ports({ map: { ok: false, error: { code: 'INTERNAL', message: 'x' } } })
    const outcome = await runImportAsset(create, p.ports)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toContain('자산은 등록됐지만')
  })

  it('연결은 매핑 하나만 부른다', async () => {
    const p = ports({})
    await runImportAsset({ kind: 'LINK', assetId: UUID, providerSymbol: '3:PLTR', back: create.back }, p.ports)
    expect(p.calls).toEqual([['saveProviderSymbol', { assetId: UUID, provider: 'KIWOOM_ES040', providerSymbol: '3:PLTR' }]])
  })

  it('INVALID는 아무것도 부르지 않는다', async () => {
    const p = ports({})
    await runImportAsset({ kind: 'INVALID', message: 'x', back: create.back }, p.ports)
    expect(p.calls).toEqual([])
  })
})
