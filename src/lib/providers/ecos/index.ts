import { PROVIDER_ID, statisticSearchUrl } from './endpoints'
import { httpFailure, message } from './http'
import { parseStatisticSearch, type ParseFailure } from './parse'
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
 * 한국은행 ECOS 어댑터 — 환율 자동 수집 **주 원천**(C1) — DOC-010 ADR-010, 2026-10-06 분기 A
 *
 * 공개 `sample` 키로 게이트를 먼저 측정했고(소급 8영업일 편차 0), 개인 키 발급 뒤에도
 * 같은 경로다(측정 실행 — ADR-010). `src/lib/providers/kiwoom/`과 같은 모양 —
 * 던지지 않는다(계약 의무는 `PriceProvider`의 ①과 같다), `fetchImpl` 주입.
 */

const REQUEST_TIMEOUT_MS = 15_000

export function createEcosProvider(deps: ProviderDeps = {}): ExchangeRateProvider {
  const doFetch = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS

  return {
    id: PROVIDER_ID,

    async fetchRate(currency, asOf) {
      if (currency !== 'USD') {
        return failure(currency, 'SYMBOL_SCHEME', `ECOS는 USD만 지원한다: ${currency}`)
      }
      if (deps.apiKey == null) {
        // 배선이 맞다면 여기 도달하지 않는다 — c2가 호출 전에 CR-13으로 거른다
        return failure(currency, 'AUTH', '인증키가 주입되지 않았다')
      }

      try {
        const response = await doFetch(statisticSearchUrl(deps.apiKey, asOf), {
          // 측정 기간에 ECOS의 리다이렉트는 관측되지 않았지만, KOREAEXIM에서 실측된
          // WAF 쿠키 챌린지(302 — AQ-83)와 같은 방어를 선제적으로 든다(c1·c2 반박 검토)
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

        const parsed = parseStatisticSearch(body)
        if (isFailure(parsed)) return failure(currency, parsed.code, parsed.detail)

        // V-17과 같은 전제 — 기준일은 asOf 이하다
        if (parsed.asOfDate > asOf) {
          return failure(currency, 'BAD_DATE', `미래 날짜가 왔다: ${parsed.asOfDate}`)
        }
        return { ok: true, currency, asOfDate: parsed.asOfDate, rate: parsed.rate }
      } catch (error) {
        return failure(currency, 'NETWORK', message(error))
      }
    },
  }
}

/** 등록은 정적이고 자격증명이 없다 — `types.ts`의 `ExchangeRateProviderFactory` 각주 */
export const ECOS: ExchangeRateProviderFactory = {
  id: PROVIDER_ID,
  create: createEcosProvider,
}

/* ------------------------------------------------------------------ 내부 */

function failure(
  currency: ForeignCurrency,
  code: ProviderFailureCode,
  detail: string,
): ExchangeRateOutcome {
  // `failure`를 손으로 적지 않는다 — 전사 사상에서 파생한다
  return { ok: false, currency, failure: FAILURE_CLASS[code], code, detail }
}

const isFailure = (v: unknown): v is ParseFailure =>
  typeof v === 'object' && v !== null && 'code' in v
