import { dec, type DecimalValue } from '@/lib/decimal'

import { RESULT } from './endpoints'
import type { ProviderFailureCode } from '../types'

/**
 * 한국수출입은행 응답 파싱 — **순수하다.** `fetch`를 모른다 — DOC-010 ADR-010
 *
 * `deal_bas_r`가 **쉼표 포함 문자열**로 온다(`"1,358.5"`) — 측정 설계가 경계한 형태가
 * 실측됐다(`parseFloat("1,358.5")`는 `1`이다). 쉼표를 뗀 뒤에만 `dec()`에 넣는다.
 *
 * **응답에 날짜 필드가 없다** — `as_of_date`는 호출부가 요청한 `searchdate`다(CR-12,
 * `index.ts`가 채운다). 이 함수는 환율 값만 돌려준다.
 */

export type ParseFailure = { code: ProviderFailureCode; detail: string }
export type ParsedRate = { rate: DecimalValue }

const RATE_TOKEN = /^-?\d+(\.\d+)?$/

/**
 * 성공·휴장·키 오류가 전부 **배열**로 온다(원소 개수·`result`로 가른다):
 * - 성공 — 23원소(통화마다 하나), `result: 1`
 * - 휴장·게시 전 — **빈 배열**
 * - 키 오류 — 원소 **하나**, `result: 3`, 나머지 필드 전부 `null`
 */
export function parseExchangeJson(body: unknown): ParsedRate | ParseFailure {
  if (!Array.isArray(body)) {
    return { code: 'MALFORMED', detail: '본문이 배열이 아니다' }
  }
  if (body.length === 0) {
    return { code: 'EMPTY', detail: '그날 데이터가 없다 (빈 배열)' }
  }

  const usd = body.find(
    (row) =>
      typeof row === 'object' && row !== null && (row as Record<string, unknown>).cur_unit === 'USD',
  ) as Record<string, unknown> | undefined

  if (usd == null) {
    const result = resultOf(body[0])
    if (result === RESULT.AUTH_CODE_ERROR) {
      return { code: 'AUTH', detail: `인증키가 유효하지 않다 (result=${RESULT.AUTH_CODE_ERROR})` }
    }
    if (result === RESULT.QUOTA_EXCEEDED) {
      return { code: 'QUOTA', detail: `일일 호출 한도를 넘었다 (result=${RESULT.QUOTA_EXCEEDED})` }
    }
    return { code: 'MALFORMED', detail: `USD 행이 없다 (result=${String(result)})` }
  }

  const raw = usd.deal_bas_r
  if (typeof raw !== 'string') {
    return { code: 'MALFORMED', detail: 'deal_bas_r가 문자열이 아니다' }
  }
  const token = raw.replaceAll(',', '').trim()
  if (!RATE_TOKEN.test(token)) {
    return { code: 'BAD_VALUE', detail: `환율 토큰이 형식이 아니다: ${JSON.stringify(raw)}` }
  }
  const rate = dec(token)
  if (rate.lte(0)) return { code: 'BAD_VALUE', detail: `환율이 0 이하다: ${JSON.stringify(raw)}` }
  return { rate }
}

function resultOf(row: unknown): number | null {
  if (typeof row !== 'object' || row === null) return null
  const r = (row as Record<string, unknown>).result
  return typeof r === 'number' ? r : null
}
