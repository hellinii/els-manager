import { dec, type DecimalValue } from '@/lib/decimal'

import { gbRule, READ_FIELDS } from './endpoints'
import type { ProviderFailureCode } from '../types'

/**
 * 키움 es040 응답 파싱 — **순수하다.** `fetch`를 모른다 — DOC-010 ADR-008
 *
 * ## 절대 규칙 #2가 이 파일의 존재 이유다
 *
 * 가격이 **인용된 문자열**로 오므로(`"310.9300"`) `JSON.parse`가 수치로 만들지 않는다 —
 * 그래서 소스 토큰 리비버가 필요 없다. 그러나 **거기서 끝이 아니다:**
 * ⓐ `gb=A`는 **÷100**이 필요하고 ⓑ `gb=B`는 값에 **선행 공백**이 오며 ⓒ `gb=B`의 날짜는
 * **14자**다. 셋 다 `Number()` 없이 처리해야 하고, `els/provider-values`가 그것을 강제한다.
 *
 * 나눗셈은 `DecimalValue.div`로 한다 — 지수를 상수로 두고 10의 거듭제곱을 문자열로 만든다.
 * `10 ** n`을 쓰면 `number` 연산이 되고, 이 프로젝트에서 금액에 `number`가 등장하는 순간이
 * 곧 조용한 오차의 시작이다.
 */

export type ParseFailure = { code: ProviderFailureCode; detail: string }

export type ParsedQuote = { asOfDate: string; price: DecimalValue }

/** `numeric(18,6)`의 정수부는 12자리다. 넘으면 Postgres `22003`이고 그 코드는 열을 말하지 않는다 */
const PRICE_CEILING = dec('1000000000000')

/** 부호를 «받아서 거부»하려고 `-?`를 넣는다 — 없으면 음수가 형식 오류로 뭉개진다 */
const PRICE_TOKEN = /^-?\d+(\.\d+)?$/

const isFailure = (v: unknown): v is ParseFailure =>
  typeof v === 'object' && v !== null && 'code' in v

/* ------------------------------------------------------------------ 목록 */

export type ListedAsset = { underlyingType: string; stkCode: string; name: string }

/**
 * `getBaseAssetJson` → `result.map.g1[]`.
 *
 * 매핑 화면이 선택지를 만들 때 쓴다. 수집에는 쓰지 않는다 — 수집 대상은 `asset_provider_symbols`가
 * 정하고, 이 목록을 대상 산출에 쓰면 **매핑되지 않은 자산이 조용히 수집된다.**
 */
export function parseAssetList(body: unknown): ListedAsset[] | ParseFailure {
  const rows = dig(body, ['result', 'map', 'g1'])
  if (!Array.isArray(rows)) {
    return { code: 'MALFORMED', detail: 'result.map.g1이 배열이 아니다' }
  }
  const out: ListedAsset[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const underlyingType = str(r.els_unas_tp)
    const stkCode = str(r.stk_code)
    const name = str(r.stk_nm)
    if (underlyingType == null || stkCode == null || name == null) continue
    out.push({ underlyingType, stkCode, name })
  }
  if (out.length === 0) {
    return { code: 'MALFORMED', detail: '목록이 0건이다 — 응답 형태가 바뀌었을 수 있다' }
  }
  return out
}

/* ------------------------------------------------------------ 거래소 코드 */

/**
 * `getBaseAssetDtlJson` → `result.map.stex_stk_code`.
 *
 * 해외주식은 거래소 접두사가 붙고 **종목마다 다르다**(`AAPL → NDAAPL` · `BAC → NYBAC`, 실측).
 * 지수·국내주식은 코드와 같다. 그래서 **유도하지 않고 물어본다** — 접두사를 규칙으로 짜면
 * NYSE 상장 종목에서 조용히 틀린다.
 */
export function parseStexCode(body: unknown): string | ParseFailure {
  const value = str(dig(body, ['result', 'map', 'stex_stk_code']))
  if (value == null || value.trim() === '') {
    return { code: 'EMPTY', detail: '거래소 코드가 비어 있다 — 공급자가 모르는 코드다' }
  }
  return value.trim()
}

/* ------------------------------------------------------------------ 차트 */

/**
 * `getBaseAssetChartJson` → `gb` + `tao.grid.arRow[]`.
 *
 * ## ★ 경로가 `tao.grid.arRow`이고 `tao.arRow`는 «항상 null»이다 (실측)
 *
 * 이것을 틀리면 **정상 응답이 0건으로 읽힌다.** 그러면 `EMPTY` → `NO_DATA` →
 * 「매핑을 고친다」가 되는데 **매핑은 멀쩡하다** — 즉 사용자에게 틀린 조치를 지시한다.
 * 처음 이 함수를 쓸 때 실제로 그 실수를 했고, `nResult: 1`·`message: ''`(성공)와
 * `grid.hm.$NROW: '0004'`가 **응답 안에서 서로 모순**처럼 보이는 것이 그 신호였다.
 *
 * 그래서 **0건과 「경로가 틀렸다」를 구별한다** — `tao.grid`가 없으면 `MALFORMED`,
 * 있는데 행이 0이면 `EMPTY`다. 둘을 합치면 스키마 변경이 휴장으로 위장한다.
 */
export function parseChart(body: unknown, asOf: string): ParsedQuote | ParseFailure {
  const gb = str(dig(body, ['gb']))
  if (gb == null) return { code: 'MALFORMED', detail: '`gb`가 없다' }

  const rule = gbRule(gb)
  /*
   * ★ 모르는 `gb`는 추측하지 않는다. `gb=B`(해외 지수)가 초기 조사에서 빠져 있었고,
   * 그것을 `A`로 취급하면 S&P500 7736.52가 **77.3652**가 된다 — 유한하고 양수이며
   * 자릿수도 그럴싸해서 어떤 제약도 걸리지 않는다. 시끄럽게 멈추는 편이 낫다.
   */
  if (rule == null) {
    return { code: 'MALFORMED', detail: `모르는 자산 부류(gb=${show(gb)})다. 스케일을 추측하지 않는다` }
  }

  const grid = dig(body, ['tao', 'grid'])
  if (typeof grid !== 'object' || grid === null) {
    return { code: 'MALFORMED', detail: 'tao.grid가 없다 — 응답 경로가 바뀌었다' }
  }

  const colNames = (grid as Record<string, unknown>).colNames
  const rows = (grid as Record<string, unknown>).arRow
  if (!Array.isArray(rows)) {
    return { code: 'MALFORMED', detail: 'tao.grid.arRow가 배열이 아니다' }
  }
  if (rows.length === 0) {
    return { code: 'EMPTY', detail: '해당 기간에 행이 0건이다 (휴장·상장폐지·코드 오류)' }
  }

  /*
   * 열 순서를 **응답이 스스로 말한다**(`colNames`). 인덱스를 박지 않는 이유는 셋 다
   * 문자열이라 뒤바뀌어도 타입이 지켜 주지 않기 때문이다 — 다만 형식 검증이 잡는다.
   */
  const at = columnIndex(colNames)
  if (isFailure(at)) return at

  let best: ParsedQuote | null = null
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const parsed = parseRow(row, at, rule, asOf)
    if (isFailure(parsed)) return parsed // 한 행이라도 이상하면 그 자산을 실패로 둔다
    if (parsed == null) continue // asOf 상한 밖 — 조용히 건너뛴다
    if (best == null || parsed.asOfDate > best.asOfDate) best = parsed
  }

  if (best == null) {
    return {
      code: 'EMPTY',
      detail: `기준일(${asOf}) 이하의 행이 없다 — 창을 넓히거나 휴장이다`,
    }
  }
  return best
}

function columnIndex(
  colNames: unknown,
): { date: number; close: number } | ParseFailure {
  if (!Array.isArray(colNames)) {
    return { code: 'MALFORMED', detail: 'colNames가 배열이 아니다' }
  }
  const date = colNames.indexOf(READ_FIELDS.baseDate)
  const close = colNames.indexOf(READ_FIELDS.close)
  if (date < 0 || close < 0) {
    return {
      code: 'MALFORMED',
      detail: `읽을 열이 없다 — ${READ_FIELDS.baseDate}·${READ_FIELDS.close}를 기대했으나 ${JSON.stringify(colNames)}`,
    }
  }
  return { date, close }
}

/** `null` = `asOf` 상한 밖(정상적으로 건너뛴다) · `ParseFailure` = 값이 이상하다 */
function parseRow(
  row: readonly unknown[],
  at: { date: number; close: number },
  rule: { divideByPowerOfTen: number; dateLength: 8 | 14 },
  asOf: string,
): ParsedQuote | null | ParseFailure {
  const rawDate = str(row[at.date])
  const rawPrice = str(row[at.close])
  if (rawDate == null || rawPrice == null) {
    return { code: 'MALFORMED', detail: '행에 날짜 또는 가격이 없다' }
  }

  const asOfDate = parseDate(rawDate, rule.dateLength)
  if (isFailure(asOfDate)) return asOfDate

  // V-17 — 기준일 이후는 존재할 수 없다. 상한이 없으면 미래 행이 「최신」이 된다
  if (asOfDate > asOf) return null

  const price = parsePrice(rawPrice, rule.divideByPowerOfTen)
  if (isFailure(price)) return price

  return { asOfDate, price }
}

/**
 * `YYYYMMDD` 또는 `YYYYMMDDhhmmss` → `YYYY-MM-DD`.
 *
 * ★ **길이를 `gb`가 정하고 그것을 단언한다.** `gb=B`만 14자이며, 길이가 기대와 다르면
 * 잘라 쓰지 않고 실패한다 — 8자를 기대하는 자리에 14자가 오면 앞 8자가 **우연히 유효한
 * 날짜**라서 조용히 통과한다(`20260804000000` → `20260804`). 그 우연에 기대지 않는다.
 */
function parseDate(raw: string, expected: 8 | 14): string | ParseFailure {
  if (raw.length !== expected) {
    return {
      code: 'BAD_DATE',
      detail: `기준일 길이가 ${expected}자가 아니다: ${show(raw)}`,
    }
  }
  const ymd = raw.slice(0, 8)
  if (!/^\d{8}$/.test(ymd)) {
    return { code: 'BAD_DATE', detail: `기준일이 숫자 8자가 아니다: ${show(raw)}` }
  }
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  /*
   * **실재하는 날짜인지 본다** — `20260230`은 형식이 맞고 값이 없다. `Date`를 쓰지 않고
   * 왕복 비교로 확인한다(`Date`는 UTC 이동이 있고 `lib/db/today.ts`가 그것 때문에 있다).
   */
  if (!isRealDate(iso)) {
    return { code: 'BAD_DATE', detail: `실재하지 않는 날짜다: ${show(raw)}` }
  }
  return iso
}

/**
 * `YYYY-MM-DD`가 실재하는 날짜인가. **`Date`를 쓰지 않는다** — 위 `parseDate` 각주.
 *
 * 조건 원천(ADR-009)의 팝업 날짜(`YYYY.MM.DD`)·검색 날짜(`YYYYMMDD`)도 이것으로 본다 —
 * 윤년 규칙을 두 벌 두면 한쪽만 고쳐지는 날이 온다.
 */
export function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-')
  const year = Number.parseInt(y!, 10)
  const month = Number.parseInt(m!, 10)
  const day = Number.parseInt(d!, 10)
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= lengths[month - 1]!
}

/**
 * 가격 토큰 → `DecimalValue`.
 *
 * `gb=B`는 값에 **선행 공백**이 온다(`" 7736.52"`) — 고정폭 우측 정렬의 흔적이다.
 * `trim()`으로 벗기고, 그 뒤로는 정규식이 통과시킨 것만 `dec()`에 넣는다.
 * **`dec()`는 문자열만 받고 그것이 이 경계의 유일한 입구다.**
 */
function parsePrice(raw: string, divideByPowerOfTen: number): DecimalValue | ParseFailure {
  const token = raw.trim()
  if (!PRICE_TOKEN.test(token)) {
    return { code: 'BAD_VALUE', detail: `종가 토큰이 형식이 아니다: ${show(raw)}` }
  }

  let price = dec(token)
  if (divideByPowerOfTen > 0) {
    // 10의 거듭제곱을 «문자열»로 만든다 — `10 ** n`은 number 연산이다
    price = price.div(dec(`1${'0'.repeat(divideByPowerOfTen)}`))
  }

  // V-15 — DB에 `price > 0` CHECK가 «없으므로» 이 층이 유일한 방어다
  if (price.lte(0)) {
    return { code: 'BAD_VALUE', detail: `종가가 0 이하다: ${show(raw)}` }
  }
  if (price.gte(PRICE_CEILING)) {
    return { code: 'BAD_VALUE', detail: `종가가 numeric(18,6) 범위를 넘는다: ${show(raw)}` }
  }
  return price
}

/* ------------------------------------------------------------------ 유틸 */

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
