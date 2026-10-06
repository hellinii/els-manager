import { failureReason } from '@/lib/providers/failures'
import type { ExchangeRateProvider, FailureClass } from '@/lib/providers/types'

import type { DecimalValue } from '@/lib/decimal'
import type { ForeignCurrency } from '@/lib/domain'

/**
 * 환율 자동 수집 오케스트레이션 — **순수하다** — DOC-010 ADR-010 · DOC-011 CR-11~13 (P8 컷 c2)
 *
 * `lib/cron/collect.ts`(시세)와 같은 이유로 I/O를 포트로 받는다 — CR-12(사전 확인)와
 * 폴백 순서의 분기표를 상시 스위트가 전수로 본다(ADR-003 — DB 없이 돈다).
 *
 * 시세와 다른 점: 대상이 하나(통화 하나 · 기준일 하나)이고 공급자가 **순차 폴백**이다 —
 * 교차 비교·평균은 하지 않는다(ADR-010 「하지 않는 것」). 그래서 `targetCount`는 늘 1이고
 * `unmapped` 개념이 없다(호출부가 0으로 채운다).
 */

export type ExchangeRateFailure = { failure: FailureClass; reason: string }

export type ExchangeRateReport = {
  targetCount: 1
  succeeded: number
  skipped: number
  failed: readonly ExchangeRateFailure[]
}

export type ExchangeRateWriteOutcome =
  | 'WRITTEN'
  /** `23505` — 경합. CR-12의 상태이므로 실패가 아니다(시세 CR-05와 같은 형태) */
  | 'ALREADY_EXISTS'
  | { error: string }

export type ExchangeRatePorts = {
  /** CR-12 사전 확인 — 콜 절약. 최종 보장은 `UNIQUE(currency, as_of_date)` + 좌표 동결 트리거다 */
  existingRate(currency: ForeignCurrency, asOfDate: string): Promise<boolean>
  writeRate(row: {
    currency: ForeignCurrency
    asOfDate: string
    rate: DecimalValue
    providerId: string
  }): Promise<ExchangeRateWriteOutcome>
}

export async function collectExchangeRate(input: {
  ports: ExchangeRatePorts
  /** 이미 자격증명으로 걸러진 것 — 순서가 폴백 순서다([0]이 주 원천) */
  providers: readonly ExchangeRateProvider[]
  currency: ForeignCurrency
  /** `YYYY-MM-DD`, KST. 창의 상한이자 오늘 요청할 날짜다 */
  asOf: string
  log?: (message: string) => void
}): Promise<ExchangeRateReport> {
  const { ports, providers, currency, asOf } = input
  const log = input.log ?? (() => {})

  // CR-12 사전 확인 — 이미 오늘 행이 있으면 어떤 원천도 부르지 않는다(콜 절약)
  if (await ports.existingRate(currency, asOf)) {
    return { targetCount: 1, succeeded: 0, skipped: 1, failed: [] }
  }

  const failed: ExchangeRateFailure[] = []

  for (const provider of providers) {
    const outcome = await provider.fetchRate(currency, asOf)
    if (!outcome.ok) {
      failed.push({ failure: outcome.failure, reason: failureReason(outcome.failure, outcome.detail) })
      continue // 순차 폴백 — 다음 원천으로
    }

    const written = await ports.writeRate({
      currency: outcome.currency,
      asOfDate: outcome.asOfDate,
      rate: outcome.rate,
      providerId: provider.id,
    })

    if (written === 'WRITTEN') return { targetCount: 1, succeeded: 1, skipped: 0, failed: [] }
    if (written === 'ALREADY_EXISTS') return { targetCount: 1, succeeded: 0, skipped: 1, failed: [] }

    /*
     * 쓰기 실패는 폴백하지 않는다 — 원천을 바꿔 다시 불러도 DB 쓰기 문제(네트워크·권한)는
     * 그대로다. 여기서 멈추고 실패로 보고한다.
     */
    log(`[환율] 기록 실패 — ${provider.id}: ${written.error}`)
    failed.push({ failure: 'CALL_FAILED', reason: failureReason('CALL_FAILED', written.error) })
    return { targetCount: 1, succeeded: 0, skipped: 0, failed }
  }

  // 등록된(자격증명이 있는) 원천을 전부 시도했고 전부 실패했다
  return { targetCount: 1, succeeded: 0, skipped: 0, failed }
}

/**
 * `cron_runs.outcome` — 시세의 `outcomeOf`(`lib/cron/report.ts`)와 같은 논거.
 *
 * ★ **전부 실패(성공도 건너뜀도 0)는 `INTERNAL`이다 — 부분 실패와 다르다.** 대상이
 * 하나뿐이므로 「부분 실패」는 존재하지 않는다: 성공했거나 건너뛰었으면 그 실행은
 * 성립했고(`OK`), 유일한 대상이 끝내 실패했으면 전면 실패다. 키가 아예 없는 경우
 * (CR-13)는 이 함수에 닿지 않는다 — 호출부가 `PROVIDER_UNAVAILABLE`로 먼저 끝낸다.
 */
export function exchangeRateOutcomeOf(report: ExchangeRateReport): 'OK' | 'INTERNAL' {
  return report.succeeded + report.skipped > 0 ? 'OK' : 'INTERNAL'
}
