import { describe, expect, it } from 'vitest'

import { createEcosProvider, ECOS } from '@/lib/providers/ecos/index'
import { PROVIDER_ID } from '@/lib/providers/ecos/endpoints'
import { parseStatisticSearch } from '@/lib/providers/ecos/parse'

/**
 * 한국은행 ECOS 어댑터 — DOC-010 ADR-010 (P8 컷 c1)
 *
 * 상시 스위트다. **네트워크에 나가지 않는다**(ADR-003) — `fetchImpl`을 주입한다.
 * 응답 형태는 게이트 실측(ADR-010 측정표 · 응답 형태 표)에서 가져온 모양이다 — 실제
 * 원문은 저장소 밖(`~/els-manager-gate/raw/`)에 있고 여기 둔 것은 그 모양을 본뜬
 * 합성 픽스처다(키가 든 원문이 아니므로 누출 검사 대상이 아니다).
 */

const ASOF = '2026-10-06'
const API_KEY = 'test-ecos-key'

const route = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

const SUCCESS_BODY = {
  StatisticSearch: {
    row: [
      { TIME: '20261002', DATA_VALUE: '1359.6' },
      { TIME: '20261006', DATA_VALUE: '1358.5' },
    ],
  },
}

describe('parseStatisticSearch — 순수 파서', () => {
  it('성공 응답에서 최신 행(TIME 최대)을 취한다', () => {
    const parsed = parseStatisticSearch(SUCCESS_BODY)
    expect('rate' in parsed).toBe(true)
    if ('rate' in parsed) {
      expect(parsed.asOfDate).toBe('2026-10-06')
      expect(parsed.rate.toString()).toBe('1358.5')
    }
  })

  it('자릿수가 일정하지 않은 DATA_VALUE도 정확히 읽는다 — Number() 없이', () => {
    const parsed = parseStatisticSearch({
      StatisticSearch: { row: [{ TIME: '20261002', DATA_VALUE: '1360' }] },
    })
    expect('rate' in parsed && parsed.rate.toString()).toBe('1360')
  })

  it('RESULT.CODE=INFO-200 → EMPTY (그날 데이터 없음, 키 오류가 아니다)', () => {
    const parsed = parseStatisticSearch({ RESULT: { CODE: 'INFO-200', MESSAGE: '데이터가 없습니다' } })
    expect(parsed).toEqual({ code: 'EMPTY', detail: expect.stringContaining('INFO-200') })
  })

  it('RESULT.CODE=INFO-100 → AUTH (인증키 오류)', () => {
    const parsed = parseStatisticSearch({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다' } })
    expect(parsed).toEqual({ code: 'AUTH', detail: expect.stringContaining('INFO-100') })
  })

  it('행이 0건이면 EMPTY다', () => {
    const parsed = parseStatisticSearch({ StatisticSearch: { row: [] } })
    expect(parsed).toEqual({ code: 'EMPTY', detail: expect.any(String) })
  })

  it('StatisticSearch.row가 배열이 아니면 MALFORMED다 — 경로가 틀렸다와 0건을 가른다', () => {
    const parsed = parseStatisticSearch({ StatisticSearch: {} })
    expect(parsed).toEqual({ code: 'MALFORMED', detail: expect.any(String) })
  })

  it('TIME이 8자 숫자가 아니면 BAD_DATE다', () => {
    const parsed = parseStatisticSearch({
      StatisticSearch: { row: [{ TIME: '2026-10-06', DATA_VALUE: '1358.5' }] },
    })
    expect(parsed).toEqual({ code: 'BAD_DATE', detail: expect.any(String) })
  })

  it('환율 토큰이 숫자가 아니면 BAD_VALUE다', () => {
    const parsed = parseStatisticSearch({
      StatisticSearch: { row: [{ TIME: '20261006', DATA_VALUE: 'N/A' }] },
    })
    expect(parsed).toEqual({ code: 'BAD_VALUE', detail: expect.any(String) })
  })
})

describe('어댑터 — 던지지 않는다 (계약 의무 ①)', () => {
  it('id가 계약이 요구하는 문자열이고 varchar(30) 이내다', () => {
    expect(ECOS.id).toBe(PROVIDER_ID)
    expect(PROVIDER_ID.length).toBeLessThanOrEqual(30)
    expect(PROVIDER_ID).toMatch(/^[A-Z0-9_]+$/)
  })

  it('성공 경로가 환율을 준다', async () => {
    const p = createEcosProvider({ apiKey: API_KEY, fetchImpl: route(SUCCESS_BODY) })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.asOfDate).toBe('2026-10-06')
      expect(out.rate.toString()).toBe('1358.5')
      expect(out.currency).toBe('USD')
    }
  })

  it('USD 외 통화는 호출 없이 SYMBOL_SCHEME이다', async () => {
    let calls = 0
    const counting = (async () => {
      calls += 1
      return route(SUCCESS_BODY)('http://test.invalid')
    }) as unknown as typeof fetch
    const p = createEcosProvider({ apiKey: API_KEY, fetchImpl: counting })
    // @ts-expect-error — 오늘 지원 통화는 USD 하나다(v2 전)
    const out = await p.fetchRate('JPY', ASOF)
    expect(calls).toBe(0)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('SYMBOL_SCHEME')
      expect(out.failure).toBe('NO_DATA')
    }
  })

  it('키가 주입되지 않으면 호출 없이 AUTH다', async () => {
    let calls = 0
    const counting = (async () => {
      calls += 1
      return route(SUCCESS_BODY)('http://test.invalid')
    }) as unknown as typeof fetch
    const p = createEcosProvider({ fetchImpl: counting })
    const out = await p.fetchRate('USD', ASOF)
    expect(calls).toBe(0)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('AUTH')
  })

  it('fetch가 던져도 값이 된다 → NETWORK', async () => {
    const p = createEcosProvider({
      apiKey: API_KEY,
      fetchImpl: (async () => {
        throw new TypeError('연결 실패')
      }) as unknown as typeof fetch,
    })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('NETWORK')
      expect(out.failure).toBe('CALL_FAILED')
    }
  })

  it.each([
    [429, 'QUOTA'],
    [401, 'AUTH'],
    [403, 'AUTH'],
    [500, 'HTTP'],
    [503, 'HTTP'],
  ])('HTTP %s → %s', async (status, code) => {
    const p = createEcosProvider({ apiKey: API_KEY, fetchImpl: route('x', status) })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe(code)
  })

  it('JSON이 아닌 본문은 MALFORMED다', async () => {
    const p = createEcosProvider({ apiKey: API_KEY, fetchImpl: route('<html>') })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('MALFORMED')
  })

  it('미래 날짜가 오면 BAD_DATE다 — V-17과 같은 전제', async () => {
    const p = createEcosProvider({
      apiKey: API_KEY,
      fetchImpl: route({ StatisticSearch: { row: [{ TIME: '20261231', DATA_VALUE: '1300' }] } }),
    })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('BAD_DATE')
  })
})
