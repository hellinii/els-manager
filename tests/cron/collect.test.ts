import { describe, expect, it } from 'vitest'

import {
  collectPrices,
  reportIsBalanced,
  type CollectPorts,
  type CollectTarget,
  type WriteOutcome,
} from '@/lib/cron/collect'
import { outcomeOf, toCronResult, toRefreshResult } from '@/lib/cron/report'
import { dec } from '@/lib/decimal'
import type { PriceProvider, ProviderOutcome } from '@/lib/providers/types'

/**
 * 수집 오케스트레이션의 분기표 — DOC-011 §7.1 CR-02·CR-05 · DOC-002 DQ-02
 *
 * ## AQ-31 (a)를 닫는 파일이다
 *
 * 「스텁 어댑터로 부분 실패를 한 번의 실행에서 관측한다」가 그 항목이었고, 요구된 조합이
 * **성공 2 · `EMPTY` 1 · `AUTH` 1 · 미매핑 1 · 사전확인 skip 1 · `23505` skip 1**이다.
 * 아래 첫 케이스가 그 일곱을 한 번에 만든다.
 *
 * ## 왜 이것이 상시 스위트에 있는가
 *
 * `collectPrices`가 **순수**하기 때문이다(포트 주입). 원 클라이언트에 붙여 두면 이 분기표가
 * `tests/integration/`으로 밀려나고, 거기서 「`AUTH` 실패 하나 + 성공 둘」을 만들려면
 * 실제 공급자 실패를 재현해야 하므로 **비싸고 비결정적**이 된다(ADR-003).
 *
 * ## 스텁을 `PRICE_PROVIDERS`에 넣지 않는다 (ADR-004 v0.7)
 *
 * 이 파일의 스텁은 `tests/` 안에만 있다. 레지스트리에 들어가면 고정값이
 * `asset_prices`에 `source = 'AUTO'`로 저장되어 **타인 상품의 판정까지 조용히 틀린다.**
 */

const ASOF = '2026-08-05'

function target(over: Partial<CollectTarget> & { assetId: string }): CollectTarget {
  return {
    assetName: `자산-${over.assetId}`,
    symbol: `3:${over.assetId.toUpperCase()}`,
    storedDates: new Set<string>(),
    ...over,
  }
}

/** 심볼 → 결과를 표로 받는 스텁. **입력당 하나**를 지킨다(어댑터 계약 의무 ②) */
function stubProvider(
  table: Record<string, ProviderOutcome>,
  opts: { id?: string; omit?: readonly string[] } = {},
): PriceProvider & { asked: string[][] } {
  const asked: string[][] = []
  return {
    id: opts.id ?? 'STUB',
    asked,
    async fetchDailyClose(symbols) {
      asked.push([...symbols])
      return symbols
        .filter((s) => !(opts.omit ?? []).includes(s))
        .map((s) => table[s] ?? { ok: false, symbol: s, failure: 'CALL_FAILED', code: 'HTTP', detail: '표에 없다' })
    },
  }
}

function quote(symbol: string, asOfDate: string, price: string): ProviderOutcome {
  return { ok: true, symbol, asOfDate, price: dec(price) }
}

/** 쓰기 포트 — 자산별 결과를 표로 받고 호출을 기록한다 */
function stubPorts(
  targets: readonly CollectTarget[],
  writes: Record<string, WriteOutcome> = {},
): CollectPorts & { written: Array<{ assetId: string; asOfDate: string; price: string }> } {
  const written: Array<{ assetId: string; asOfDate: string; price: string }> = []
  return {
    written,
    async loadTargets() {
      return targets
    },
    async writeQuote(row) {
      written.push({
        assetId: row.assetId,
        asOfDate: row.asOfDate,
        price: row.price.toString(),
      })
      return writes[row.assetId] ?? 'WRITTEN'
    },
  }
}

describe('AQ-31 (a) — 한 번의 실행에서 일곱 갈래가 함께 관측된다', () => {
  it('성공 2 · EMPTY 1 · AUTH 1 · 미매핑 1 · 사전확인 skip 1 · 23505 skip 1', async () => {
    const targets = [
      target({ assetId: 'ok1' }),
      target({ assetId: 'ok2' }),
      target({ assetId: 'empty' }),
      target({ assetId: 'auth' }),
      target({ assetId: 'unmapped', symbol: null }),
      // 사전 확인 — 공급자가 줄 날짜가 «이미» 저장돼 있다
      target({ assetId: 'stored', storedDates: new Set(['2026-08-04']) }),
      target({ assetId: 'race' }), // 사전 확인은 통과하고 INSERT가 경합한다
    ]

    const provider = stubProvider({
      '3:OK1': quote('3:OK1', '2026-08-04', '309.38'),
      '3:OK2': quote('3:OK2', '2026-08-04', '1038.59'),
      '3:EMPTY': { ok: false, symbol: '3:EMPTY', failure: 'NO_DATA', code: 'EMPTY', detail: '0행' },
      '3:AUTH': { ok: false, symbol: '3:AUTH', failure: 'CALL_FAILED', code: 'AUTH', detail: '401' },
      '3:STORED': quote('3:STORED', '2026-08-04', '99.99'),
      '3:RACE': quote('3:RACE', '2026-08-04', '55.55'),
    })

    const ports = stubPorts(targets, { race: 'ALREADY_EXISTS' })
    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(report.targetCount).toBe(7)
    expect(report.succeeded).toBe(2) // ok1 · ok2
    expect(report.skipped).toBe(2) // stored(사전 확인) · race(23505)
    expect(report.unmapped).toBe(1)
    expect(report.failed).toHaveLength(2) // empty · auth

    // ★ 불변식이 값으로 성립한다 — DB는 이것을 «부등식으로만» 잡는다(I-19)
    expect(reportIsBalanced(report)).toBe(true)

    // ★★ 미매핑은 공급자에게 «묻지 않는다» — 물으면 SYMBOL_SCHEME이 나서 정상이 실패가 된다
    expect(provider.asked).toHaveLength(1) // 한 번에 전부 — 심볼당 왕복이 아니다
    expect([...provider.asked[0]!].sort()).toEqual([
      '3:AUTH',
      '3:EMPTY',
      '3:OK1',
      '3:OK2',
      '3:RACE',
      '3:STORED',
    ])

    // ★★★ 사전 확인된 자산은 «쓰지 않는다». 경합한 자산은 시도한다(그것이 두 겹의 차이다)
    expect(ports.written.map((w) => w.assetId).sort()).toEqual(['ok1', 'ok2', 'race'])

    /*
     * 두 부류가 층을 넘어 살아남는다 — 화면이 `reason` 문구를 파싱하지 않아도
     * 「기다린다」와 「고친다」를 가를 수 있다(ADR-004 보정의 목적).
     */
    const byId = new Map(report.failed.map((f) => [f.assetId, f]))
    expect(byId.get('empty')!.failure).toBe('NO_DATA')
    expect(byId.get('auth')!.failure).toBe('CALL_FAILED')
    // 이름을 싣는다 — §5.8이 화면을 위해 요구한다
    expect(byId.get('auth')!.assetName).toBe('자산-auth')
  })
})

describe('CR-05 — 기존 행을 덮지 않는다. `source`와 무관하다', () => {
  it('공급자가 준 «그» 날짜만 본다 — 다른 날짜가 저장돼 있으면 건너뛰지 않는다', async () => {
    /*
     * ★ 이것이 창(window)의 의미를 고정한다. 「최근에 뭔가 저장돼 있다」가 아니라
     * **「그 좌표에 행이 있다」**가 판정이다. 전자로 구현하면 휴장일 다음 영업일이
     * 조용히 수집되지 않는다.
     */
    const targets = [target({ assetId: 'a', storedDates: new Set(['2026-08-03', '2026-07-31']) })]
    const provider = stubProvider({ '3:A': quote('3:A', '2026-08-04', '10') })
    const ports = stubPorts(targets)

    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(report.succeeded).toBe(1)
    expect(report.skipped).toBe(0)
    expect(ports.written).toEqual([{ assetId: 'a', asOfDate: '2026-08-04', price: '10' }])
  })

  it('`23505`는 실패가 «아니다» — 건강한 동시 실행이 고장으로 보이지 않는다', async () => {
    const targets = [target({ assetId: 'a' })]
    const provider = stubProvider({ '3:A': quote('3:A', '2026-08-04', '10') })
    const ports = stubPorts(targets, { a: 'ALREADY_EXISTS' })

    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(report.skipped).toBe(1)
    expect(report.failed).toEqual([])
    expect(outcomeOf(report)).toBe('OK') // 기록도 성립이라고 적는다
  })

  it('쓰기 오류(23505가 아닌 것)는 실패다 — 삼키지 않는다', async () => {
    const targets = [target({ assetId: 'a' })]
    const provider = stubProvider({ '3:A': quote('3:A', '2026-08-04', '10') })
    const ports = stubPorts(targets, { a: { error: '42501 permission denied' } })

    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(report.succeeded).toBe(0)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]!.failure).toBe('CALL_FAILED')
    expect(report.failed[0]!.reason).toContain('42501')
  })
})

describe('DQ-02 — 결측은 «공백»이다. 직전값을 복제하지 않는다', () => {
  it('`EMPTY` 하나뿐이면 `writeQuote`가 0번 불린다', async () => {
    /*
     * ★ **없는 코드를 테스트로 고정한다.** 「직전값을 새 날짜로 복제」하는 줄이
     * `collect.ts`에 없다는 것이 DQ-02의 전부이고, 그것을 관측하는 방법이 이것이다 —
     * 그 코드가 생기면 여기서 `written`이 비지 않는다.
     */
    const targets = [target({ assetId: 'a' })]
    const provider = stubProvider({
      '3:A': { ok: false, symbol: '3:A', failure: 'NO_DATA', code: 'EMPTY', detail: '0행' },
    })
    const ports = stubPorts(targets)

    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(ports.written).toEqual([])
    expect(report.failed).toHaveLength(1)
    expect(report.succeeded).toBe(0)
  })
})

describe('CR-02 — 부분 실패가 전체를 중단시키지 않는다', () => {
  it('첫 자산이 실패해도 나머지를 계속한다', async () => {
    const targets = [target({ assetId: 'bad' }), target({ assetId: 'good' })]
    const provider = stubProvider({
      '3:BAD': { ok: false, symbol: '3:BAD', failure: 'CALL_FAILED', code: 'NETWORK', detail: '타임아웃' },
      '3:GOOD': quote('3:GOOD', '2026-08-04', '7'),
    })
    const ports = stubPorts(targets)

    const report = await collectPrices({ ports, provider, asOf: ASOF })

    expect(report.succeeded).toBe(1)
    expect(report.failed).toHaveLength(1)
    expect(outcomeOf(report)).toBe('OK') // ★ 부분 실패는 `OK`다 — 응답과 기록이 갈리지 않는다
  })

  it('전부 실패하면 기록은 `INTERNAL`이다 — 「성립했는가」와 「전부 성공했는가」는 다르다', async () => {
    const targets = [target({ assetId: 'a' }), target({ assetId: 'b' })]
    const provider = stubProvider({
      '3:A': { ok: false, symbol: '3:A', failure: 'CALL_FAILED', code: 'BLOCKED', detail: '400' },
      '3:B': { ok: false, symbol: '3:B', failure: 'CALL_FAILED', code: 'BLOCKED', detail: '400' },
    })

    const report = await collectPrices({ ports: stubPorts(targets), provider, asOf: ASOF })

    expect(outcomeOf(report)).toBe('INTERNAL')
  })

  it('대상이 0이면 성립이다 — 할 일이 없었다', async () => {
    const provider = stubProvider({})
    const report = await collectPrices({ ports: stubPorts([]), provider, asOf: ASOF })

    expect(report).toEqual({ targetCount: 0, succeeded: 0, skipped: 0, unmapped: 0, failed: [] })
    expect(outcomeOf(report)).toBe('OK')
    // 대상이 없으면 공급자를 부르지 않는다
    expect(provider.asked).toEqual([])
  })

  it('미매핑만 있으면 공급자를 부르지 않고 그것은 실패가 아니다', async () => {
    const targets = [target({ assetId: 'a', symbol: null }), target({ assetId: 'b', symbol: null })]
    const provider = stubProvider({})

    const report = await collectPrices({ ports: stubPorts(targets), provider, asOf: ASOF })

    expect(report.unmapped).toBe(2)
    expect(report.failed).toEqual([])
    expect(provider.asked).toEqual([])
    expect(outcomeOf(report)).toBe('OK') // ADR-007 — 수동 입력은 «설계된 정상 경로»다
  })
})

describe('어댑터 계약 의무 ② — 「입력당 정확히 하나」를 믿지 않고 확인한다', () => {
  it('빠진 결과는 `CALL_FAILED`다 — 어느 칸에도 세어지지 않는 자산을 만들지 않는다', async () => {
    /*
     * ★ 이것을 확인하지 않으면 불변식이 조용히 깨진다 — 그 자산이 성공도 실패도
     * 건너뜀도 미매핑도 아니게 되고, `targetCount`만 하나 크다. 그 상태에서
     * `reportIsBalanced`가 거짓이 되지만 **DB의 부등식 CHECK는 통과한다**(I-19).
     */
    const targets = [target({ assetId: 'a' }), target({ assetId: 'b' })]
    const provider = stubProvider(
      { '3:A': quote('3:A', '2026-08-04', '1'), '3:B': quote('3:B', '2026-08-04', '2') },
      { omit: ['3:B'] },
    )

    const report = await collectPrices({ ports: stubPorts(targets), provider, asOf: ASOF })

    expect(reportIsBalanced(report)).toBe(true)
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0]!.assetId).toBe('b')
    expect(report.failed[0]!.failure).toBe('CALL_FAILED')
    expect(report.failed[0]!.reason).toContain('어댑터 계약 위반')
  })

  it('집계가 맞지 않으면 로그를 남긴다 — 조용히 넘기지 않는다', async () => {
    /*
     * 위 갈래가 있으므로 이 로그는 «도달하지 않는다.** 그래도 두는 이유는 루프에 갈래를
     * 더하면서 카운터를 빠뜨리는 미래의 변경을 위한 것이고, 그때 던지지 않는 이유는
     * 부분 결과라도 보고하는 편이 낫기 때문이다(CR-02).
     *
     * **도달 불가를 「테스트할 수 없다」로 두지 않고 그 사실을 여기 적는다** — 0건의
     * 로그를 단언하면 그것은 위 갈래가 살아 있다는 것의 다른 표현이다.
     */
    const logs: string[] = []
    const targets = [target({ assetId: 'a' })]
    const provider = stubProvider({ '3:A': quote('3:A', '2026-08-04', '1') })

    await collectPrices({
      ports: stubPorts(targets),
      provider,
      asOf: ASOF,
      log: (m) => logs.push(m),
    })

    expect(logs).toEqual([])
  })
})

describe('`loadTargets`가 실패하면 «던진다» — CR-02의 대상이 아니다', () => {
  it('예외가 그대로 나온다 — 부분 결과를 만들지 않는다', async () => {
    const provider = stubProvider({})
    const ports: CollectPorts = {
      async loadTargets() {
        throw new Error('상품 목록 조회 실패')
      },
      async writeQuote() {
        return 'WRITTEN'
      },
    }

    await expect(collectPrices({ ports, provider, asOf: ASOF })).rejects.toThrow(
      '상품 목록 조회 실패',
    )
  })
})

describe('두 투영 — 한쪽이 다른 쪽의 부분집합이 아니다', () => {
  it('`CronResult`는 `assetName`을 «빼고» `executedAt`·`targetCount`를 «싣는다»', async () => {
    const targets = [target({ assetId: 'a' }), target({ assetId: 'b' })]
    const provider = stubProvider({
      '3:A': quote('3:A', '2026-08-04', '1'),
      '3:B': { ok: false, symbol: '3:B', failure: 'NO_DATA', code: 'EMPTY', detail: '0행' },
    })

    const report = await collectPrices({ ports: stubPorts(targets), provider, asOf: ASOF })
    const cron = toCronResult(report, '2026-08-05T05:00:00.000Z')
    const refresh = toRefreshResult(report)

    expect(cron.executedAt).toBe('2026-08-05T05:00:00.000Z')
    expect(cron.targetCount).toBe(2)
    expect(Object.keys(cron.failed[0]!).sort()).toEqual(['assetId', 'failure', 'reason'])

    expect(Object.keys(refresh).sort()).toEqual(['failed', 'skipped', 'succeeded', 'unmapped'])
    expect(refresh.failed[0]!.assetName).toBe('자산-b')

    // 공통 코어의 값들은 «같다» — 「7장의 배치와 동일 로직」이 반환에서도 참이다
    expect(cron.succeeded).toBe(refresh.succeeded)
    expect(cron.skipped).toBe(refresh.skipped)
    expect(cron.unmapped).toBe(refresh.unmapped)
    expect(cron.failed).toHaveLength(refresh.failed.length)
  })
})
