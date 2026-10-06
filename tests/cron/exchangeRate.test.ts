import { describe, expect, it } from 'vitest'

import {
  collectExchangeRate,
  exchangeRateOutcomeOf,
  type ExchangeRatePorts,
  type ExchangeRateReport,
  type ExchangeRateWriteOutcome,
} from '@/lib/cron/exchangeRate'
import { dec } from '@/lib/decimal'
import type { ExchangeRateOutcome, ExchangeRateProvider } from '@/lib/providers/types'

/**
 * 환율 수집 오케스트레이션의 분기표 — DOC-011 CR-11~13 (P8 컷 c2)
 *
 * `tests/cron/collect.test.ts`(시세)와 같은 이유로 상시 스위트에 있다 — `collectExchangeRate`가
 * **순수**이므로(포트 주입) CR-12 사전 확인·순차 폴백·쓰기 실패 분기를 DB 없이 전수로 본다
 * (ADR-003). `lib/cron/exchangeRate.ts`의 머리 주석이 이미 그렇게 주장하고 있었는데 — c1·c2
 * 반박 검토(2026-10-06)가 그 주장을 뒷받침하는 파일이 없다는 것을 두 관점에서 독립적으로
 * 찾아냈다. 이 파일이 그 공백을 메운다.
 */

const CURRENCY = 'USD'
const ASOF = '2026-10-06'

/** 원천 하나 — 통화마다 결과 하나를 돌려주는 스텁. 호출을 기록한다(순차 폴백 단언용) */
function stubProvider(id: string, outcome: ExchangeRateOutcome): ExchangeRateProvider & { asked: number } {
  const state = { asked: 0 }
  return {
    id,
    get asked() {
      return state.asked
    },
    async fetchRate() {
      state.asked += 1
      return outcome
    },
  }
}

function success(rate: string, asOfDate = ASOF): ExchangeRateOutcome {
  return { ok: true, currency: CURRENCY, asOfDate, rate: dec(rate) }
}

const authFailure: ExchangeRateOutcome = {
  ok: false,
  currency: CURRENCY,
  failure: 'CALL_FAILED',
  code: 'AUTH',
  detail: '인증키가 유효하지 않다',
}

const networkFailure: ExchangeRateOutcome = {
  ok: false,
  currency: CURRENCY,
  failure: 'CALL_FAILED',
  code: 'NETWORK',
  detail: '연결 실패',
}

/** 쓰기 포트 — 사전 확인·쓰기 결과를 미리 정하고 호출을 기록한다 */
function stubPorts(opts: {
  hasExisting?: boolean
  write?: ExchangeRateWriteOutcome
}): ExchangeRatePorts & { writes: Array<{ asOfDate: string; rate: string; providerId: string }> } {
  const writes: Array<{ asOfDate: string; rate: string; providerId: string }> = []
  return {
    writes,
    async existingRate() {
      return opts.hasExisting ?? false
    },
    async writeRate(row) {
      writes.push({ asOfDate: row.asOfDate, rate: row.rate.toString(), providerId: row.providerId })
      return opts.write ?? 'WRITTEN'
    },
  }
}

describe('collectExchangeRate — CR-12 사전 확인', () => {
  it('기존 행이 있으면 어떤 원천도 부르지 않는다 — skipped:1', async () => {
    const primary = stubProvider('ECOS', success('1358.5'))
    const fallback = stubProvider('KOREAEXIM', success('1358.5'))
    const ports = stubPorts({ hasExisting: true })

    const report = await collectExchangeRate({
      ports,
      providers: [primary, fallback],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report).toEqual<ExchangeRateReport>({ targetCount: 1, succeeded: 0, skipped: 1, failed: [] })
    expect(primary.asked).toBe(0)
    expect(fallback.asked).toBe(0)
    expect(ports.writes).toHaveLength(0)
  })
})

describe('collectExchangeRate — 순차 폴백', () => {
  it('주 원천이 성공하면 폴백을 부르지 않는다', async () => {
    const primary = stubProvider('ECOS', success('1358.5'))
    const fallback = stubProvider('KOREAEXIM', success('1999.9'))
    const ports = stubPorts({})

    const report = await collectExchangeRate({
      ports,
      providers: [primary, fallback],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report).toEqual<ExchangeRateReport>({ targetCount: 1, succeeded: 1, skipped: 0, failed: [] })
    expect(fallback.asked).toBe(0)
    expect(ports.writes).toEqual([{ asOfDate: ASOF, rate: '1358.5', providerId: 'ECOS' }])
  })

  it('주 원천이 실패하면 폴백을 부른다 — 폴백이 기록한 provider id가 남는다', async () => {
    const primary = stubProvider('ECOS', authFailure)
    const fallback = stubProvider('KOREAEXIM', success('1358.5'))
    const ports = stubPorts({})

    const report = await collectExchangeRate({
      ports,
      providers: [primary, fallback],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report).toEqual<ExchangeRateReport>({ targetCount: 1, succeeded: 1, skipped: 0, failed: [] })
    expect(primary.asked).toBe(1)
    expect(fallback.asked).toBe(1)
    expect(ports.writes).toEqual([{ asOfDate: ASOF, rate: '1358.5', providerId: 'KOREAEXIM' }])
  })

  it('등록된 원천이 전부 실패하면 실패 사유를 전부 담아 보고한다 — 교차 비교·평균 없음', async () => {
    const primary = stubProvider('ECOS', authFailure)
    const fallback = stubProvider('KOREAEXIM', networkFailure)
    const ports = stubPorts({})

    const report = await collectExchangeRate({
      ports,
      providers: [primary, fallback],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.failed).toHaveLength(2)
    expect(report.failed.map((f) => f.failure)).toEqual(['CALL_FAILED', 'CALL_FAILED'])
    expect(ports.writes).toHaveLength(0)
  })
})

describe('collectExchangeRate — CR-12 쓰기 경합(23505)', () => {
  it('ALREADY_EXISTS는 실패가 아니라 skipped다', async () => {
    const primary = stubProvider('ECOS', success('1358.5'))
    const ports = stubPorts({ write: 'ALREADY_EXISTS' })

    const report = await collectExchangeRate({
      ports,
      providers: [primary],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report).toEqual<ExchangeRateReport>({ targetCount: 1, succeeded: 0, skipped: 1, failed: [] })
  })
})

describe('collectExchangeRate — 쓰기 실패는 폴백하지 않는다', () => {
  it('원천 호출이 성공한 뒤 쓰기가 실패하면 거기서 멈춘다 — 폴백을 부르지 않는다', async () => {
    const primary = stubProvider('ECOS', success('1358.5'))
    const fallback = stubProvider('KOREAEXIM', success('1358.5'))
    const ports = stubPorts({ write: { error: '42501 권한 없음' } })

    const report = await collectExchangeRate({
      ports,
      providers: [primary, fallback],
      currency: CURRENCY,
      asOf: ASOF,
    })

    expect(report.succeeded).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]!.failure).toBe('CALL_FAILED')
    expect(fallback.asked).toBe(0) // 원천을 바꿔도 DB 쓰기 문제는 그대로이므로 시도하지 않는다
  })
})

describe('exchangeRateOutcomeOf — cron_runs.outcome', () => {
  it.each<[ExchangeRateReport, 'OK' | 'INTERNAL']>([
    [{ targetCount: 1, succeeded: 1, skipped: 0, failed: [] }, 'OK'],
    [{ targetCount: 1, succeeded: 0, skipped: 1, failed: [] }, 'OK'],
    [
      { targetCount: 1, succeeded: 0, skipped: 0, failed: [{ failure: 'CALL_FAILED', reason: 'x' }] },
      'INTERNAL',
    ],
  ])('%o → %s', (report, expected) => {
    expect(exchangeRateOutcomeOf(report)).toBe(expected)
  })
})
