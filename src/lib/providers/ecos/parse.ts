import { dec, type DecimalValue } from '@/lib/decimal'

import { RESULT_CODE } from './endpoints'
import type { ProviderFailureCode } from '../types'

/**
 * 한국은행 ECOS 응답 파싱 — **순수하다.** `fetch`를 모른다 — DOC-010 ADR-010
 *
 * `DATA_VALUE`는 **인용된 문자열**이고 자릿수가 일정하지 않다(`"1360"` · `"1358.4"`).
 * `els/provider-values`가 `Number()`·`parseFloat`을 금지하므로 `dec()`로만 받는다.
 */

export type ParseFailure = { code: ProviderFailureCode; detail: string }
export type ParsedRate = { asOfDate: string; rate: DecimalValue }

const isFailure = (v: unknown): v is ParseFailure =>
  typeof v === 'object' && v !== null && 'code' in v

const RATE_TOKEN = /^-?\d+(\.\d+)?$/

/**
 * `StatisticSearch` 응답 하나.
 *
 * ★ **0행과 키 오류를 가르는 신호는 `RESULT.CODE`다** — 둘 다 HTTP 200이고 둘 다
 * `StatisticSearch` 블록이 없다(`RESULT` 블록만 있다). 이 신호를 놓치면 키 오류가
 * 휴장으로 위장한다(측정 설계 4 — ADR-008 §2.3과 같은 형태).
 */
export function parseStatisticSearch(body: unknown): ParsedRate | ParseFailure {
  const result = dig(body, ['RESULT'])
  if (typeof result === 'object' && result !== null) {
    const code = str((result as Record<string, unknown>).CODE)
    if (code === RESULT_CODE.NO_DATA) {
      return { code: 'EMPTY', detail: `그날 데이터가 없다 (${RESULT_CODE.NO_DATA})` }
    }
    if (code === RESULT_CODE.BAD_KEY) {
      return { code: 'AUTH', detail: `인증키가 유효하지 않다 (${RESULT_CODE.BAD_KEY})` }
    }
    return { code: 'MALFORMED', detail: `RESULT.CODE를 모른다: ${show(code ?? '')}` }
  }

  const rows = dig(body, ['StatisticSearch', 'row'])
  if (!Array.isArray(rows)) {
    return { code: 'MALFORMED', detail: 'StatisticSearch.row가 배열이 아니다 — 응답 경로가 바뀌었다' }
  }
  if (rows.length === 0) {
    return { code: 'EMPTY', detail: '행이 0건이다' }
  }

  // 단일일 조회(시작=종료=asOf)이므로 보통 한 행이다 — 여럿이면 TIME 최대를 취한다
  let best: ParsedRate | null = null
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const time = str(r.TIME)
    const value = str(r.DATA_VALUE)
    if (time == null || value == null) {
      return { code: 'MALFORMED', detail: '행에 TIME 또는 DATA_VALUE가 없다' }
    }
    if (time.length !== 8 || !/^\d{8}$/.test(time)) {
      return { code: 'BAD_DATE', detail: `TIME이 숫자 8자가 아니다: ${show(time)}` }
    }
    const asOfDate = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`
    const rate = parseRate(value)
    if (isFailure(rate)) return rate
    if (best == null || asOfDate > best.asOfDate) best = { asOfDate, rate }
  }
  if (best == null) return { code: 'MALFORMED', detail: '유효한 행이 없다' }
  return best
}

function parseRate(raw: string): DecimalValue | ParseFailure {
  const token = raw.trim()
  if (!RATE_TOKEN.test(token)) {
    return { code: 'BAD_VALUE', detail: `환율 토큰이 형식이 아니다: ${show(raw)}` }
  }
  const rate = dec(token)
  if (rate.lte(0)) return { code: 'BAD_VALUE', detail: `환율이 0 이하다: ${show(raw)}` }
  return rate
}

function dig(value: unknown, path: readonly string[]): unknown {
  let cursor = value
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function show(value: string): string {
  return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
}
