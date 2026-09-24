import { ENDPOINTS, UNDERLYING_TYPES } from './endpoints'
import { bodyLooksBlocked, httpFailure, message } from './http'
import { parseAssetList, type ListedAsset, type ParseFailure } from './parse'
import { parseSearchBody } from './search-parse'
import {
  LOOKUP_BUDGET_MS,
  MAX_BODY_BYTES,
  PRODUCT_CODE,
  QUERY_MAX_LENGTH,
  REQUEST_TIMEOUT_MS,
  SEARCH_FORM_DEFAULTS,
  TERMS_ENDPOINTS,
} from './terms-endpoints'
import { parseTermsHtml } from './terms-parse'
import type {
  KiwoomProductCandidate,
  KiwoomProductSource,
  KiwoomProductSourceDeps,
  KiwoomProductTerms,
} from './terms-types'
import { FAILURE_CLASS } from '../failures'
import type { LookupOutcome } from '../types'

/**
 * 키움 상품 조건 원천 — **I/O는 여기만** — DOC-010 ADR-009 · DOC-011 §4.10
 *
 * ## 미배선이다
 *
 * 이 커밋에서 이 함수를 부르는 곳은 테스트뿐이다. 라우트·폼 배선은 뒤 커밋(B5~)이며, 그 전에
 * 이 원천이 할 수 있는 일은 **값을 돌려주는 것뿐**이다 — 무엇도 저장하지 않는다(X-04). 저장은
 * 사용자가 폼을 검토한 뒤 §5.1·§5.10·§5.12를 지난다.
 *
 * ## `PriceProvider`가 아니다
 *
 * 레지스트리 셋(`PRICE_PROVIDERS`·`KNOWN_PROVIDER_IDS`·`PROVIDER_CREDENTIALS`) 어디에도 없다 —
 * `terms-endpoints.ts` 머리 주석.
 *
 * ## es040과 같은 약속 셋
 *
 * - **던지지 않는다** — 모든 `await`가 `try` 안이다. 실패는 `LookupOutcome`의 값이다
 * - **쿠키를 싣지 않는다** — `credentials`를 만지지 않는 것이 이행이다(ADR-008 §2 ③)
 * - **순차다** — 조건 조회는 요청 최대 2개(팝업 → 목록), 자산 목록은 3개다. 동시에 때리지 않는다
 *
 * ## es040과 다른 셋
 *
 * - `redirect: 'manual'` — 리다이렉트가 본 사이트의 200 페이지로 끝나면 **빈 템플릿처럼 읽혀
 *   `EMPTY`**가 되고, 사용자는 맞는 코드를 고치라는 말을 듣는다. 3xx는 `HTTP`다
 * - `cache: 'no-store'` — 같은 상품을 다시 불러오면 **지금의** 팝업을 본다(X-03)
 * - 본문 상한을 **스트림으로** 센다 — `text()`는 다 읽은 뒤에야 크기를 안다
 */
export function createKiwoomProductSource(deps: KiwoomProductSourceDeps): KiwoomProductSource {
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS

  /** 조회 하나의 데드라인. 주입이 없으면 조회를 시작한 시점부터 15초다 */
  const deadlineOf = () => deps.deadlineAt ?? Date.now() + LOOKUP_BUDGET_MS

  async function post(url: string, form: Record<string, string>, deadline: number): Promise<string | ParseFailure> {
    if (Date.now() > deadline) {
      return { code: 'NETWORK', detail: '전체 데드라인 초과 — 호출하지 않았다' }
    }
    try {
      const response = await deps.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        // 쿠키를 싣지 않는다 — `credentials`를 명시하지 «않는» 것이 기본값이며 그것이 옳다
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, deadline - Date.now()))),
      })
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        await discard(response)
        return { code: 'HTTP', detail: `리다이렉트를 따라가지 않는다 (HTTP ${response.status})` }
      }
      if (!response.ok) {
        await discard(response)
        return httpFailure(response.status)
      }
      const text = await readCapped(response, MAX_BODY_BYTES)
      if (typeof text !== 'string') return text
      if (bodyLooksBlocked(text)) {
        return { code: 'BLOCKED', detail: `WAF 차단 본문이다 (${text.length}자)` }
      }
      return text
    } catch (error) {
      return { code: 'NETWORK', detail: message(error) }
    }
  }

  /** 본문 JSON을 `{ json }`으로 감싼다 — 파싱 결과가 우연히 `{code, detail}` 모양이어도 실패로 읽히지 않게 */
  async function postJson(
    url: string,
    form: Record<string, string>,
    deadline: number,
  ): Promise<{ json: unknown } | ParseFailure> {
    const text = await post(url, form, deadline)
    if (typeof text !== 'string') return text
    try {
      return { json: JSON.parse(text) as unknown }
    } catch {
      return { code: 'MALFORMED', detail: `본문이 JSON이 아니다 (${text.length}자)` }
    }
  }

  async function search(query: string, deadline: number): Promise<LookupOutcome<KiwoomProductCandidate[]>> {
    const body = await postJson(TERMS_ENDPOINTS.search, { salFundNm: query, ...SEARCH_FORM_DEFAULTS }, deadline)
    if (!('json' in body)) return failed(body)
    const parsed = parseSearchBody(body.json)
    if (isFailure(parsed)) return failed(parsed)
    return { ok: true, data: parsed.candidates, ...(parsed.truncated ? { truncated: true } : {}) }
  }

  return {
    searchKiwoomProducts: (query) => guard(() => searchProducts(query)),
    getKiwoomProductTerms: (productCode) => guard(() => productTerms(productCode)),
    listKiwoomAssets: () => guard(listAssets),
  }

  async function searchProducts(query: string): Promise<LookupOutcome<KiwoomProductCandidate[]>> {
    const q = typeof query === 'string' ? query.trim() : ''
    // 형식이 아니면 네트워크에 나가지 않는다 — 사용자가 입력을 고친다(NO_DATA)
    if (q.length === 0 || q.length > QUERY_MAX_LENGTH || /\p{Cc}/u.test(q)) {
      return failed({ code: 'SYMBOL_SCHEME', detail: `검색어는 1~${QUERY_MAX_LENGTH}자, 제어 문자 없음` })
    }
    return search(q, deadlineOf())
  }

  async function productTerms(productCode: string): Promise<LookupOutcome<KiwoomProductTerms>> {
    const code = typeof productCode === 'string' ? productCode.trim() : ''
    if (!PRODUCT_CODE.test(code)) {
      return failed({ code: 'SYMBOL_SCHEME', detail: `상품 코드 형식이 아니다: ${JSON.stringify(code.slice(0, 20))}` })
    }
    const deadline = deadlineOf()

    const html = await post(TERMS_ENDPOINTS.popup, { salFundCd: code }, deadline)
    if (typeof html !== 'string') return failed(html)
    const parsed = parseTermsHtml(html, code)
    if (isFailure(parsed)) return failed(parsed)

    /*
     * 목록 행은 **최선 노력**이다 — 월지급·외화·ISIN을 싣지만 없어도 조건은 성립한다.
     * 검색어는 팝업의 정확한 상품명이고 사용자 입력 상한(30자) 밖이다(실측 최장 28자
     * `USD_키움 뉴글로벌 100조 ELS 2048회`). 부분 일치이므로 코드로 행을 고른다.
     */
    const listed = await search(parsed.name, deadline)
    const listing = listed.ok ? (listed.data.find((c) => c.productCode === code) ?? null) : null
    const terms: KiwoomProductTerms = {
      ...parsed,
      listing,
      listingMiss: listing != null ? null : listed.ok ? 'NOT_FOUND' : 'CALL_FAILED',
    }
    return { ok: true, data: terms }
  }

  async function listAssets(): Promise<LookupOutcome<ListedAsset[]>> {
    const deadline = deadlineOf()
    const out: ListedAsset[] = []
    // 부류 셋을 따로 묻는다 — `elsUnasTp` 없이 부르면 `999999`와 빈 목록이 온다(실측)
    for (const type of Object.values(UNDERLYING_TYPES)) {
      const body = await postJson(ENDPOINTS.list, { elsUnasTp: type }, deadline)
      if (!('json' in body)) return failed(body)
      const rows = parseAssetList(body.json)
      if (isFailure(rows)) return failed(rows)
      const stray = rows.find((r) => r.underlyingType !== type)
      if (stray != null) {
        // 부류가 섞이면 `provider_symbol`의 접두(`<els_unas_tp>:`)가 틀린다 — 차트 호출이 남의 부류로 간다
        return failed({ code: 'MALFORMED', detail: `elsUnasTp=${type} 응답에 부류 ${stray.underlyingType} 행이 있다` })
      }
      out.push(...rows)
    }
    return { ok: true, data: out }
  }
}

/**
 * ★ 마지막 그물 — 순수 파서는 던지지 않도록 짰지만(토큰을 정규식으로 거른 뒤에만 `dec()`에 넣는다)
 * 그 약속은 **코드 읽기로만** 보장된다. 계약 의무 ①(던지지 않는다)을 그 읽기에 걸지 않는다.
 */
async function guard<T>(run: () => Promise<LookupOutcome<T>>): Promise<LookupOutcome<T>> {
  try {
    return await run()
  } catch (error) {
    return failed({ code: 'MALFORMED', detail: `파서가 던졌다 — ${message(error)}` })
  }
}

/* ------------------------------------------------------------------ 내부 */

type LookupFailure = Extract<LookupOutcome<never>, { ok: false }>

function failed(f: ParseFailure): LookupFailure {
  // `failure`를 손으로 적지 않는다 — 전사 사상에서 파생한다(`failures.ts`)
  return { ok: false, failure: FAILURE_CLASS[f.code], code: f.code, detail: f.detail }
}

/** 파서의 실패 값. 성공 값(배열·조건 객체)에는 `code`·`detail` 쌍이 없다 */
function isFailure(v: unknown): v is ParseFailure {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'code' in v && 'detail' in v
}

/**
 * 본문을 **바이트로 세며** 읽는다. 상한을 넘으면 읽기를 멈추고 `MALFORMED`다 — 실측 최대는
 * 약 102KB이고 1MB는 그 열 배다. 넘는 것은 이 원천의 응답이 아니다.
 */
async function readCapped(response: Response, limit: number): Promise<string | ParseFailure> {
  if (response.body == null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return { code: 'MALFORMED', detail: `본문이 ${limit}B를 넘는다 — 읽기를 멈췄다` }
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    joined.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder('utf-8').decode(joined)
}

/** 읽지 않을 본문을 닫는다 — 열어 둔 채 두면 연결이 풀리지 않는다 */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}
