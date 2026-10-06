import { PROVIDER_ID, exchangeJsonUrl } from './endpoints'
import { httpFailure, message } from './http'
import { parseExchangeJson, type ParseFailure } from './parse'
import { FAILURE_CLASS } from '../failures'
import type {
  ExchangeRateOutcome,
  ExchangeRateProvider,
  ExchangeRateProviderFactory,
  ProviderDeps,
  ProviderFailureCode,
} from '../types'

import type { ForeignCurrency } from '@/lib/domain'

/**
 * 한국수출입은행 어댑터 — 환율 자동 수집 **폴백 원천**(C2) — DOC-010 ADR-010, 2026-10-06 분기 A
 *
 * ECOS가 실패할 때만 c2(`collectExchangeRate`)가 이 어댑터를 부른다 — 교차 비교·평균은
 * 하지 않는다(추정은 최신 1건 하나, ADR-010 「하지 않는 것」).
 *
 * ★ **리다이렉트를 따라가지 않는다**(`redirect: 'manual'`) — 2026-10-05 다크 웨이크 중
 * WAF 쿠키 챌린지(302)가 실측됐고 `Location`이 요청 경로를 키째로 돌려줬다. 이 어댑터는
 * 상태 코드만 보고 응답 헤더·URL을 로그에 원문으로 남기지 않는다(AQ-83).
 *
 * 던지지 않는다 — 계약 의무는 `PriceProvider`의 ①과 같다.
 */

const REQUEST_TIMEOUT_MS = 15_000

export function createKoreaeximProvider(deps: ProviderDeps = {}): ExchangeRateProvider {
  const doFetch = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS

  return {
    id: PROVIDER_ID,

    async fetchRate(currency, asOf) {
      if (currency !== 'USD') {
        return failure(currency, 'SYMBOL_SCHEME', `한국수출입은행 어댑터는 USD만 지원한다: ${currency}`)
      }
      if (deps.apiKey == null) {
        return failure(currency, 'AUTH', '인증키가 주입되지 않았다')
      }

      try {
        const response = await doFetch(exchangeJsonUrl(deps.apiKey, asOf), {
          // AQ-83 — 리다이렉트를 따라가지 않는다. Location 헤더는 어디서도 읽지 않는다
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          const f = httpFailure(response.status)
          return failure(currency, f.code, f.detail)
        }

        const text = await response.text()
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return failure(currency, 'MALFORMED', `본문이 JSON이 아니다 (${text.length}B)`)
        }

        const parsed = parseExchangeJson(body)
        if (isFailure(parsed)) return failure(currency, parsed.code, parsed.detail)

        // 응답에 날짜 필드가 없다 — 요청한 날짜가 곧 기준일이다(CR-12)
        return { ok: true, currency, asOfDate: asOf, rate: parsed.rate }
      } catch (error) {
        return failure(currency, 'NETWORK', message(error))
      }
    },
  }
}

/** 등록은 정적이고 자격증명이 없다 — `types.ts`의 `ExchangeRateProviderFactory` 각주 */
export const KOREAEXIM: ExchangeRateProviderFactory = {
  id: PROVIDER_ID,
  create: createKoreaeximProvider,
}

/* ------------------------------------------------------------------ 내부 */

function failure(
  currency: ForeignCurrency,
  code: ProviderFailureCode,
  detail: string,
): ExchangeRateOutcome {
  return { ok: false, currency, failure: FAILURE_CLASS[code], code, detail }
}

const isFailure = (v: unknown): v is ParseFailure =>
  typeof v === 'object' && v !== null && 'code' in v
