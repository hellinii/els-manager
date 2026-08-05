import { DEFAULT_LOOKBACK_DAYS, ENDPOINTS, PROVIDER_ID } from './endpoints'
import { parseChart, parseStexCode, type ParseFailure } from './parse'
import { parseSymbol } from './symbols'
import { FAILURE_CLASS } from '../failures'
import type {
  PriceProvider,
  ProviderDeps,
  ProviderFactory,
  ProviderFailureCode,
  ProviderOutcome,
} from '../types'

/**
 * 키움 「기초자산 정보」(es040) 어댑터 — DOC-010 ADR-008
 *
 * ## 자격증명이 없다
 *
 * 미인증 공개 엔드포인트이므로 `ProviderDeps.apiKey`를 쓰지 않는다. 따라서 **CR-10
 * (자격증명 부재 → 500)이 이 공급자에는 도달하지 않는다** — 그 규칙의 대상은 `data.go.kr`
 * 대조 레그다(DOC-011 §7.1 ★★★).
 *
 * ## 쿠키를 «싣지 않는 것»이 요구사항이다
 *
 * 키움 WAF가 **쿠키 있는 POST를 400 `eversafeThreat`로 거부한다**(실측). `fetch`는 기본으로
 * 쿠키를 싣지 않으므로 **`credentials`를 만지지 않는 것이 곧 이행**이며, 그 사실을 여기
 * 적어 두는 이유는 나중에 누가 「세션을 먼저 얻자」며 페이지 GET을 앞에 붙이는 것을 막기
 * 위해서다 — 그 변경이 **정확히 이 어댑터를 죽인다.**
 *
 * ## 던지지 않는다
 *
 * 계약 의무 ①(`types.ts`)이다. 모든 실패가 값이 되어야 DOC-011 CR-02(부분 실패가 배치를
 * 중단시키지 않는다)가 성립한다. 그래서 이 파일의 모든 `await`가 `try` 안에 있다.
 */

const REQUEST_TIMEOUT_MS = 15_000

export function createKiwoomProvider(deps: ProviderDeps = {}): PriceProvider {
  const doFetch = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS

  async function post(url: string, form: Record<string, string>): Promise<unknown | ParseFailure> {
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        // 쿠키를 싣지 않는다 — 위 주석. 명시하지 «않는» 것이 기본값이며 그것이 옳다.
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) return httpFailure(response.status)

      const text = await response.text()
      try {
        return JSON.parse(text) as unknown
      } catch {
        /*
         * 본문이 JSON이 아니다. WAF 차단 페이지가 이 자리로 온다 — `MALFORMED`가 아니라
         * `BLOCKED`으로 두는 이유는 **조치가 다르기 때문**이다(스키마 변경은 코드를 고치고
         * 차단은 호출 방식을 본다).
         */
        return {
          code: bodyLooksBlocked(text) ? 'BLOCKED' : 'MALFORMED',
          detail: `본문이 JSON이 아니다 (${text.length}B)`,
        }
      }
    } catch (error) {
      return { code: 'NETWORK', detail: message(error) }
    }
  }

  async function fetchOne(symbol: string, asOf: string): Promise<ProviderOutcome> {
    const target = parseSymbol(symbol)
    if ('code' in target) return failure(symbol, target.code, target.detail)

    const detail = await post(ENDPOINTS.detail, { stkCode: target.stkCode })
    if (isFailure(detail)) return failure(symbol, detail.code, detail.detail)

    const stex = parseStexCode(detail)
    if (typeof stex !== 'string') return failure(symbol, stex.code, stex.detail)

    const chart = await post(ENDPOINTS.chart, {
      stkCode: target.stkCode,
      elsUnasTp: target.underlyingType,
      stexStkCode: stex,
      // `YYYY.MM.DD` — 이 값이 창의 «상한»이고 서버가 거기서 과거로 걷는다
      searchStartDt: asOf.replaceAll('-', '.'),
      srchCnt: String(DEFAULT_LOOKBACK_DAYS),
    })
    if (isFailure(chart)) return failure(symbol, chart.code, chart.detail)

    /*
     * ★ **상한을 `asOf`가 아니라 «`asOf` 직전»으로 둔다.**
     *
     * 실측: 조회 시점의 «당일» 행이 정착값이 아니다 — AAPL `20260805`를 2분 간격으로
     * 다시 물으면 `311.12 → 310.93`으로 움직였고, 반대로 `20260804`는 바이트 동일했으며
     * **그 값(309.38)이 다른 발행사 두 곳의 게시값과 정확히 일치했다.** 즉 당일 행은
     * 미확정(장중·시간외) 값이고 전일 행이 확정 종가다.
     *
     * 국내 자산도 같은 규칙을 쓴다 — 배치가 14:00 KST에 도는데 **KRX는 15:30에 닫으므로**
     * 그 시점의 당일 행은 장중값이다. 부류마다 다르게 두면 「어느 부류가 안전한가」를
     * 자산 종류로 추론해야 하고 그 추론이 틀리는 날 조용히 장중값이 원장에 들어간다.
     *
     * 대가는 종가가 하루 더 오래된 것뿐이며 **DOC-013 §6.2가 이미 받아들였다**
     * (「`isStale`(5일)이 상시 1~3일 뒤처진 상태로 돈다. 정상이며 결함이 아니다」).
     */
    const ceiling = previousDay(asOf)
    const quote = parseChart(chart, ceiling)
    if (!('price' in quote)) return failure(symbol, quote.code, quote.detail)

    return { ok: true, symbol, asOfDate: quote.asOfDate, price: quote.price }
  }

  return {
    id: PROVIDER_ID,

    async fetchDailyClose(symbols, asOf) {
      const out: ProviderOutcome[] = []
      /*
       * 순차다. 대상이 한 자릿수이고 이 엔드포인트는 공개 웹페이지의 것이므로 **동시에
       * 때리지 않는 것이 예의이자 차단을 피하는 길**이다. 그리고 순차면 데드라인 초과가
       * 남은 심볼에 대해 **정직한 값**이 된다 — 병렬이면 어느 것이 못 갔는지 흐려진다.
       */
      for (const symbol of symbols) {
        if (deps.deadlineAt != null && Date.now() > deps.deadlineAt) {
          out.push(
            failure(symbol, 'NETWORK', '전체 데드라인 초과 — 이 심볼은 호출하지 않았다'),
          )
          continue
        }
        out.push(await fetchOne(symbol, asOf))
      }
      return out // 입력당 정확히 하나 (계약 의무 ②)
    },
  }
}

/** 등록은 정적이고 자격증명이 없다 — `types.ts`의 `ProviderFactory` 각주 */
export const KIWOOM_ES040: ProviderFactory = {
  id: PROVIDER_ID,
  create: createKiwoomProvider,
}

/* ------------------------------------------------------------------ 내부 */

function failure(
  symbol: string,
  code: ProviderFailureCode,
  detail: string,
): ProviderOutcome {
  // `failure`를 손으로 적지 않는다 — 전사 사상에서 파생한다
  return { ok: false, symbol, failure: FAILURE_CLASS[code], code, detail }
}

const isFailure = (v: unknown): v is ParseFailure =>
  typeof v === 'object' && v !== null && 'code' in v

/**
 * 상태 코드를 부류로 가른다. **429·401·403을 `HTTP`로 뭉개지 않는다** — 조치가 다르다
 * (한도는 기다리고, 인증은 사람이 보고, 그 밖은 스키마·경로를 본다).
 */
function httpFailure(status: number): ParseFailure {
  if (status === 429) return { code: 'QUOTA', detail: `한도 초과 (HTTP ${status})` }
  if (status === 401 || status === 403) {
    return { code: 'AUTH', detail: `접근이 거부됐다 (HTTP ${status})` }
  }
  /*
   * ★ 400은 이 공급자에서 **WAF 차단의 표식**이다(쿠키를 싣거나 헤더가 어긋나면 400
   * `{"eversafeThreat":true}`가 온다 — 실측). 일반적인 「잘못된 요청」으로 읽으면
   * 원인에서 먼 곳을 보게 된다.
   */
  if (status === 400) {
    return { code: 'BLOCKED', detail: `요청이 차단됐다 (HTTP 400 — WAF일 수 있다)` }
  }
  return { code: 'HTTP', detail: `비2xx 응답 (HTTP ${status})` }
}

function bodyLooksBlocked(text: string): boolean {
  return text.includes('eversafeThreat') || text.includes('EvCrypto')
}

function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * `YYYY-MM-DD`의 전일. **`Date`를 쓰지 않는다** — UTC 이동이 있고 `lib/db/today.ts`가
 * 존재하는 이유가 그것이다. 문자열 산술로 처리한다.
 */
export function previousDay(iso: string): string {
  const year = Number.parseInt(iso.slice(0, 4), 10)
  const month = Number.parseInt(iso.slice(5, 7), 10)
  const day = Number.parseInt(iso.slice(8, 10), 10)

  if (day > 1) return format(year, month, day - 1)
  if (month > 1) return format(year, month - 1, lastDay(year, month - 1))
  return format(year - 1, 12, 31)
}

function lastDay(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}

function format(year: number, month: number, day: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}
