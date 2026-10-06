import {
  collectExchangeRate as collectExchangeRateCore,
  exchangeRateOutcomeOf,
  type ExchangeRatePorts,
  type ExchangeRateReport,
} from '@/lib/cron/exchangeRate'
import { ecosApiKey, koreaeximApiKey, missingProviderCredentials } from '@/lib/db/env'
import {
  EXCHANGE_RATE_PROVIDER_CREDENTIALS,
  EXCHANGE_RATE_PROVIDERS,
  type ExchangeRateProviderFactory,
} from '@/lib/providers/types'

import type { MutationContext } from './context'
import { toInsert } from './payload'

import type { ForeignCurrency } from '@/lib/domain'

/**
 * 환율 자동 수집 — `GET /api/cron/prices`의 **둘째 단계** — DOC-010 ADR-010 ·
 * DOC-011 CR-11~13 (P8 컷 c2)
 *
 * `collectAndRecord`(`mutations/collect.ts`, 시세)와 **공유 코드가 없다.** `refreshPrices`
 * (§5.8)가 이 함수를 부르면 `refreshPrices.affects`가 세금 조회를 품어야 하고
 * 「`PRICE_WIDE`에 세금이 없다」(AQ-76)가 깨진다 — 그래서 **`route.ts`에서만** 부른다.
 *
 * ★ **절대 던지지 않는다 — 함수 전체가 try/catch 안이다.** 호출부(route.ts)가 결과를
 * 무시해도 안전해야 한다(CR-11 — 환율 단계의 실패는 응답 상태를 바꾸지 않는다).
 */

/** provider id → 그 공급자의 실제 키 값을 읽는 함수. 이름은 `EXCHANGE_RATE_PROVIDER_CREDENTIALS`가 안다 */
const API_KEY_OF: Record<string, () => string | null> = {
  ECOS: ecosApiKey,
  KOREAEXIM: koreaeximApiKey,
}

export async function collectExchangeRateAndRecord(
  ctx: MutationContext,
  deps: {
    startedAt: string
    finishedAt: () => string
    /** 테스트만 넘긴다 — `collectAndRecord`의 `factories`와 같은 이유 */
    factories?: readonly ExchangeRateProviderFactory[]
  },
): Promise<void> {
  try {
    const factories = deps.factories ?? EXCHANGE_RATE_PROVIDERS

    // 분기 C(수집기 자체가 없다) — 기록할 것도 없다. 조용히 끝낸다
    if (factories.length === 0) return

    const available = factories.filter(
      (f) => missingProviderCredentials(EXCHANGE_RATE_PROVIDER_CREDENTIALS[f.id] ?? []).length === 0,
    )

    // CR-13 — 등록된 원천의 키가 전부 없으면 호출 없이 PROVIDER_UNAVAILABLE만 기록한다
    if (available.length === 0) {
      await recordExchangeRateCronRun(ctx, {
        startedAt: deps.startedAt,
        finishedAt: deps.finishedAt(),
        outcome: 'PROVIDER_UNAVAILABLE',
        report: { targetCount: 1, succeeded: 0, skipped: 0, failed: [] },
      })
      return
    }

    // 배선 순서(등록 순서)가 폴백 순서다 — ECOS가 [0](주), KOREAEXIM이 [1](폴백)
    const providers = available.map((f) => f.create({ apiKey: API_KEY_OF[f.id]?.() ?? undefined }))

    const report = await collectExchangeRateCore({
      ports: makeExchangeRatePorts(ctx),
      providers,
      currency: 'USD',
      asOf: ctx.asOf,
      log: (message) => console.error(message),
    })

    await recordExchangeRateCronRun(ctx, {
      startedAt: deps.startedAt,
      finishedAt: deps.finishedAt(),
      outcome: exchangeRateOutcomeOf(report),
      report,
    })
  } catch (error) {
    console.error(
      `[cron] 환율 단계가 예외로 끝났다(무시) — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function makeExchangeRatePorts(ctx: MutationContext): ExchangeRatePorts {
  return {
    async existingRate(currency: ForeignCurrency, asOfDate: string): Promise<boolean> {
      const { data } = await ctx.db
        .from('exchange_rates')
        .select('id')
        .eq('currency', currency)
        .eq('as_of_date', asOfDate)
        .maybeSingle()
      return data != null
    },

    /**
     * 행 하나. **`.insert()`이며 `.upsert()`가 아니다** — CR-12가 기존 행을 덮지
     * 말라고 하므로(`collect.ts`의 `writeQuote`와 같은 이유).
     *
     * ★ **`23505`를 값으로 답한다** — 레이스(사전 확인 뒤 다른 실행이 먼저 썼다)는
     * CR-12의 정상 상태이지 실패가 아니다.
     */
    async writeRate(row) {
      const { error } = await ctx.db.from('exchange_rates').insert(
        toInsert('exchange_rates', {
          currency: row.currency,
          as_of_date: row.asOfDate,
          rate: row.rate.toString(),
          source: 'AUTO',
          provider: row.providerId,
        }),
      )
      if (error == null) return 'WRITTEN' as const
      if (error.code === '23505') return 'ALREADY_EXISTS' as const
      return { error: `${error.code ?? '-'} ${error.message}` }
    },
  }
}

/**
 * `cron_runs` 한 행 — `job = 'EXCHANGE_RATE'`. `recordCronRun`(`collect.ts`)과 같은
 * 「실패를 값으로만 남긴다」 규약 — 기록 실패가 수집 결과를 바꾸지 않는다.
 */
async function recordExchangeRateCronRun(
  ctx: MutationContext,
  run: {
    startedAt: string
    finishedAt: string
    outcome: 'OK' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL'
    report: ExchangeRateReport
  },
): Promise<void> {
  const { error } = await ctx.db.from('cron_runs').insert(
    toInsert('cron_runs', {
      actor_id: ctx.viewerId,
      caller: 'BATCH',
      job: 'EXCHANGE_RATE',
      outcome: run.outcome,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      target_count: run.report.targetCount,
      succeeded: run.report.succeeded,
      skipped: run.report.skipped,
      unmapped: 0,
      failed: run.report.failed.map((f) => ({
        currency: 'USD',
        failure: f.failure,
        reason: f.reason,
      })),
    }),
  )

  if (error != null) {
    console.error(
      `[cron] 환율 실행 기록을 남기지 못했다 — 수집 결과는 유효하다: ${error.code ?? '-'} ${error.message}`,
    )
  }
}
