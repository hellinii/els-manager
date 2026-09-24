import { parseLadder } from './ladder'
import { isRealDate, type ParseFailure } from './parse'
import { PRODUCT_CODE, RESP_CODE } from './terms-endpoints'
import type { KiwoomProductCandidate, PctString } from './terms-types'

/**
 * es020 `getEndElsMainJson` 응답 → 후보 목록 — **순수하다** — DOC-010 ADR-009
 *
 * ## 후보는 «표시와 링크»용이다
 *
 * 정본은 상세 팝업이다(`terms-parse.ts`). 그래서 선택 필드가 이상하면 **그 칸만 `null`**로 두고
 * 행을 살린다 — 후보를 고르는 데 필요한 것은 코드와 이름뿐이다. 반대로 코드·이름이 이상한 행은
 * 버리고 **센다**(`dropped`). 전부 버려지면 형태가 바뀐 것이므로 `MALFORMED`다.
 *
 * ## 순서를 바꾸지 않는다
 *
 * 받은 순서 그대로 낸다. 「`795`를 찾았는데 `3795회`가 먼저」 같은 정확 일치 정렬은 화면의 일이고
 * 그 재료가 `roundNumber`다. 여기서 정렬하면 화면이 원래 순서를 볼 방법이 없다.
 *
 * ## `ki_yn`을 읽지 않는다
 *
 * 「KI 터치 여부」다(`terms-endpoints.ts` ⑥). 불리언으로 실으면 사상 층에서 `ki_touched_at`으로
 * 새는 길이 생긴다 — `TERMS_NOT_READ`.
 */

export type SearchParsed = {
  candidates: KiwoomProductCandidate[]
  /** 공급자가 「뒤가 더 있다」고 말했다 — 따라가지 않았다 */
  truncated: boolean
  /** 코드·이름이 형식이 아니어서 버린 행 수 */
  dropped: number
}

export function parseSearchBody(body: unknown): SearchParsed | ParseFailure {
  const map = dig(body, ['result', 'resultMap'])
  if (typeof map !== 'object' || map === null) {
    return { code: 'MALFORMED', detail: 'result.resultMap이 없다' }
  }
  const m = map as Record<string, unknown>
  const resp = str(m.resp_code)

  if (resp === RESP_CODE.NOT_FOUND) {
    // `g1`이 «아예 없다»(실측). 0건은 정상이다 — 청약 중·코드 검색·「회/호」 차이가 여기로 온다
    return { candidates: [], truncated: false, dropped: 0 }
  }
  if (resp !== RESP_CODE.OK && resp !== RESP_CODE.CONTINUED) {
    return {
      code: 'HTTP',
      detail: `검색이 앱 오류 코드를 냈다: resp_code=${show(resp ?? 'null')} resp_mesg=${show(str(m.resp_mesg) ?? '')}`,
    }
  }

  const rows = m.g1
  if (!Array.isArray(rows)) {
    return { code: 'MALFORMED', detail: `성공(${resp})인데 g1이 배열이 아니다` }
  }

  const candidates: KiwoomProductCandidate[] = []
  let dropped = 0
  for (const row of rows) {
    const c = typeof row === 'object' && row !== null ? candidateOf(row as Record<string, unknown>) : null
    if (c == null) dropped += 1
    else candidates.push(c)
  }
  if (rows.length > 0 && candidates.length === 0) {
    return { code: 'MALFORMED', detail: `${rows.length}행이 전부 형식이 아니다 — 응답 형태가 바뀌었을 수 있다` }
  }

  return {
    candidates,
    truncated: resp === RESP_CODE.CONTINUED || str(m.cont_gubn) === 'Y',
    dropped,
  }
}

function candidateOf(r: Record<string, unknown>): KiwoomProductCandidate | null {
  const productCode = str(r.stk_code)?.trim() ?? ''
  const name = str(r.stk_nm)?.trim() ?? ''
  if (!PRODUCT_CODE.test(productCode) || name === '') return null

  const ladderText = str(r.type_cntn) ?? ''
  const headlineText = str(r.expc_errt_infr)?.trim() ?? ''
  const isin = str(r.scty_code)?.trim() ?? ''
  const currency = str(r.crnc_code)?.trim() ?? ''

  return {
    productCode,
    isin: /^[A-Z]{2}[0-9A-Z]{9}\d$/.test(isin) ? isin : null,
    name,
    roundNumber: /(\d+)[회호]$/.exec(name)?.[1] ?? null,
    issueDate: compactDate(r.isu_dt),
    maturityDate: compactDate(r.expr_dt),
    subscriptionStart: compactDate(r.scr_strt_dt),
    subscriptionEnd: compactDate(r.scr_end_dt),
    ladderText,
    ladder: parseLadder(ladderText),
    headlineText,
    headlineAnnualPct: headlinePct(headlineText),
    underlyingNames: splitNames(str(r.base_aset) ?? ''),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    monthlyPay: str(r.mm_pay_frml_yn) === 'Y',
    redeemed: str(r.rpy_yn) === 'Y',
  }
}

/** `YYYYMMDD` → `YYYY-MM-DD`. 형식이 아니거나 실재하지 않으면 `null` — 후보에서는 선택 칸이다 */
function compactDate(value: unknown): string | null {
  const s = str(value)
  if (s == null || !/^\d{8}$/.test(s)) return null
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return isRealDate(iso) ? iso : null
}

/**
 * `최대 연 32.10%` · `최대 연7.60%` · `조기상환시 연 30%` → 비율 토큰. 소수 둘째 자리까지만
 * (`DISPLAY_SCALE.percent`) — 셋째 자리가 오면 `null`이다.
 */
export function headlinePct(text: string): PctString | null {
  const hits = [...text.matchAll(/연\s?(\d{1,3}(?:\.\d+)?)\s?%/g)]
  if (hits.length !== 1) return null
  const token = hits[0]![1]!
  return /^\d{1,3}(?:\.\d{1,2})?$/.test(token) ? token : null
}

/** 헤더·목록의 기초자산명 — `, ` 또는 `/`로 나뉜다(E04050 `KOSPI200/S&P500/EUROSTOXX50`) */
export function splitNames(text: string): string[] {
  return text
    .split(/\s*[,/]\s*/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
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
