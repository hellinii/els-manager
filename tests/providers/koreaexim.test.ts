import { describe, expect, it } from 'vitest'

import { createKoreaeximProvider, KOREAEXIM } from '@/lib/providers/koreaexim/index'
import { PROVIDER_ID } from '@/lib/providers/koreaexim/endpoints'
import { parseExchangeJson } from '@/lib/providers/koreaexim/parse'

/**
 * 한국수출입은행 어댑터 — DOC-010 ADR-010 (P8 컷 c1)
 *
 * 상시 스위트다. **네트워크에 나가지 않는다**(ADR-003) — `fetchImpl`을 주입한다.
 * 응답 형태는 게이트 실측(ADR-010 측정표 · 응답 형태 표, 2026-10-05 WAF 302 사건 포함)에서
 * 가져온 모양이다 — 합성 픽스처이며 키가 든 원문이 아니다.
 */

const ASOF = '2026-10-06'
const API_KEY = 'test-exim-key'

const route = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

const SUCCESS_BODY = [
  { result: 1, cur_unit: 'AUD', deal_bas_r: '900.0' },
  { result: 1, cur_unit: 'USD', deal_bas_r: '1,358.5', kftc_deal_bas_r: '1,358.5' },
]

const BAD_KEY_BODY = [{ result: 3, cur_unit: null, deal_bas_r: null }]

describe('parseExchangeJson — 순수 파서', () => {
  it('성공 응답에서 USD 행의 쉼표를 떼고 읽는다 — Number()·parseFloat 없이', () => {
    const parsed = parseExchangeJson(SUCCESS_BODY)
    expect('rate' in parsed).toBe(true)
    if ('rate' in parsed) expect(parsed.rate.toString()).toBe('1358.5')
  })

  it('쉼표 없는 정수 값도 읽는다', () => {
    const parsed = parseExchangeJson([{ result: 1, cur_unit: 'USD', deal_bas_r: '1,360' }])
    expect('rate' in parsed && parsed.rate.toString()).toBe('1360')
  })

  it('빈 배열 → EMPTY (휴장·게시 전 — 결함이 아니다)', () => {
    const parsed = parseExchangeJson([])
    expect(parsed).toEqual({ code: 'EMPTY', detail: expect.any(String) })
  })

  it('result=3(원소 하나 · 필드 전부 null) → AUTH — 원소 개수로 0건과 가른다', () => {
    const parsed = parseExchangeJson(BAD_KEY_BODY)
    expect(parsed).toEqual({ code: 'AUTH', detail: expect.stringContaining('3') })
  })

  it('result=4 → QUOTA (공개 문서 기준 — 게이트 기간에 실측되지 않았다)', () => {
    const parsed = parseExchangeJson([{ result: 4, cur_unit: null, deal_bas_r: null }])
    expect(parsed).toEqual({ code: 'QUOTA', detail: expect.any(String) })
  })

  it('본문이 배열이 아니면 MALFORMED다', () => {
    const parsed = parseExchangeJson({ not: 'an array' })
    expect(parsed).toEqual({ code: 'MALFORMED', detail: expect.any(String) })
  })

  it('USD 행이 있는데 deal_bas_r가 숫자 토큰이 아니면 BAD_VALUE다', () => {
    const parsed = parseExchangeJson([{ result: 1, cur_unit: 'USD', deal_bas_r: 'N/A' }])
    expect(parsed).toEqual({ code: 'BAD_VALUE', detail: expect.any(String) })
  })
})

describe('어댑터 — 던지지 않는다 (계약 의무 ①)', () => {
  it('id가 계약이 요구하는 문자열이고 varchar(30) 이내다', () => {
    expect(KOREAEXIM.id).toBe(PROVIDER_ID)
    expect(PROVIDER_ID.length).toBeLessThanOrEqual(30)
    expect(PROVIDER_ID).toMatch(/^[A-Z0-9_]+$/)
  })

  it('성공 경로가 환율을 준다 — 응답에 날짜가 없어 요청한 날짜를 기준일로 쓴다', async () => {
    const p = createKoreaeximProvider({ apiKey: API_KEY, fetchImpl: route(SUCCESS_BODY) })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.asOfDate).toBe(ASOF)
      expect(out.rate.toString()).toBe('1358.5')
    }
  })

  it('키가 주입되지 않으면 호출 없이 AUTH다', async () => {
    let calls = 0
    const counting = (async () => {
      calls += 1
      return route(SUCCESS_BODY)('http://test.invalid')
    }) as unknown as typeof fetch
    const p = createKoreaeximProvider({ fetchImpl: counting })
    const out = await p.fetchRate('USD', ASOF)
    expect(calls).toBe(0)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('AUTH')
  })

  it('fetch가 던져도 값이 된다 → NETWORK', async () => {
    const p = createKoreaeximProvider({
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
  ])('HTTP %s → %s', async (status, code) => {
    const p = createKoreaeximProvider({ apiKey: API_KEY, fetchImpl: route('x', status) })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe(code)
  })

  it('302(WAF 쿠키 챌린지) → BLOCKED — 10-05 실측 사건', async () => {
    const p = createKoreaeximProvider({ apiKey: API_KEY, fetchImpl: route('', 302) })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('BLOCKED')
      expect(out.failure).toBe('CALL_FAILED')
    }
  })

  it('리다이렉트를 따라가지 않는다 — redirect: manual을 요청에 싣는다', async () => {
    let seenRedirect: string | undefined
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => {
      seenRedirect = init?.redirect
      return route('', 302)('http://test.invalid')
    }) as unknown as typeof fetch
    await createKoreaeximProvider({ apiKey: API_KEY, fetchImpl: spy }).fetchRate('USD', ASOF)
    expect(seenRedirect).toBe('manual')
  })

  it('JSON이 아닌 본문은 MALFORMED다', async () => {
    const p = createKoreaeximProvider({ apiKey: API_KEY, fetchImpl: route('<html>') })
    const out = await p.fetchRate('USD', ASOF)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('MALFORMED')
  })
})
