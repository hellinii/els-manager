import type { DecimalValue } from '@/lib/decimal'
import { failureReason } from '@/lib/providers/failures'
import type { FailureClass, PriceProvider } from '@/lib/providers/types'

/**
 * 시세 수집 오케스트레이션 — **순수하다** — DOC-011 §7.1 · §5.8 · DOC-002 DQ-02
 *
 * ## 왜 순수인가
 *
 * CR-02(부분 실패) · CR-05(기준일 행 사전 확인) · DQ-02(결측은 공백) 셋이 여기서 갈리고,
 * 그 분기표를 **상시 스위트가 전수로** 보아야 한다(ADR-003 — DB 없이 돈다).
 * 원 클라이언트에 붙이면 그 로직이 `tests/integration/`으로 밀려나고, 그쪽에서 부분 실패를
 * 만들려면 실제 공급자 실패를 재현해야 하므로 **비싸고 비결정적**이 된다.
 *
 * 그래서 I/O는 **포트**로 주입받는다. `mutations/collect.ts`가 그 포트를 구현한다.
 *
 * ## 이 모듈이 «하지 않는» 것
 *
 * - 시계를 읽지 않는다 — `asOf`와 `executedAt`이 인자다
 * - 공급자를 고르지 않는다 — `provider`가 인자다
 * - 던지지 않는다… **가 아니다.** 대상 조회가 실패하면 던진다(아래 ★)
 */

/** 수집 대상 하나 — 포트가 만들어 준다 */
export type CollectTarget = {
  assetId: string
  /** §5.8이 `failed[].assetName`을 요구한다 */
  assetName: string
  /**
   * 이 공급자에서의 심볼. `null`이면 **미매핑**이며 그것은 **실패가 아니다** —
   * ADR-007이 수동 입력을 설계된 정상 경로로 못박았다.
   */
  symbol: string | null
  /**
   * 조회 창 안에 **이미 저장된** `as_of_date`들. CR-05 사전 확인의 재료이며
   * 포트가 한 번의 왕복으로 채운다(자산별로 묻지 않는다).
   */
  storedDates: ReadonlySet<string>
}

export type WriteOutcome =
  | 'WRITTEN'
  /** `23505` — 경합. **CR-05의 상태이므로 실패가 아니다**(아래 ★★) */
  | 'ALREADY_EXISTS'
  | { error: string }

export type CollectPorts = {
  /**
   * 미상환 상품이 참조하는 기초자산 + 매핑 + 창 안의 기존 날짜.
   *
   * ★ **이것이 실패하면 «던진다».** 대상을 열거하지 못한 실행에는 보고할 부분이 없으므로
   * CR-02(부분 실패)의 대상이 아니다 — 라우트가 CR-08(전면 실패 → 비2xx)로 답한다.
   */
  loadTargets(): Promise<readonly CollectTarget[]>
  /** 행 하나. 던지지 않고 값으로 답한다 */
  writeQuote(row: {
    assetId: string
    asOfDate: string
    price: DecimalValue
    providerId: string
  }): Promise<WriteOutcome>
}

export type CollectFailure = {
  assetId: string
  assetName: string
  failure: FailureClass
  reason: string
}

/**
 * 수집 한 번의 결과 — **`CronResult`와 §5.8의 공통 코어**다.
 *
 * 둘은 이것의 «투영»이며 한쪽이 다른 쪽의 부분집합이 아니다(`report.ts`).
 */
export type CollectReport = {
  targetCount: number
  succeeded: number
  skipped: number
  unmapped: number
  failed: readonly CollectFailure[]
}

/**
 * ★ **불변식** — `targetCount = succeeded + skipped + unmapped + failed.length`.
 *
 * DB는 이것을 **부등식으로만** 잡는다(I-19 — `failed`가 JSONB라 단일 행 `CHECK`에서 길이를
 * 세면 제약이 JSON 구조에 의존한다). 즉 **등식을 강제하는 층이 여기뿐**이며, 그 사실을
 * DOC-002 §8 각주가 적는다.
 */
export function reportIsBalanced(report: CollectReport): boolean {
  return (
    report.targetCount ===
    report.succeeded + report.skipped + report.unmapped + report.failed.length
  )
}

export async function collectPrices(input: {
  ports: CollectPorts
  provider: PriceProvider
  /** `YYYY-MM-DD`, KST. 창의 상한이며 V-17의 근거다 */
  asOf: string
  log?: (message: string) => void
}): Promise<CollectReport> {
  const { ports, provider, asOf } = input
  const log = input.log ?? (() => {})

  const targets = await ports.loadTargets() // 실패하면 던진다 — 위 ★

  const mapped = targets.filter((t) => t.symbol != null)
  const unmapped = targets.length - mapped.length

  /*
   * 심볼이 있는 것만 공급자에게 묻는다. 미매핑을 넘기면 어댑터가 `SYMBOL_SCHEME`을
   * 낼 것이고 그러면 **정상 상태가 실패로 보고된다.**
   */
  const outcomes =
    mapped.length === 0
      ? []
      : await provider.fetchDailyClose(
          mapped.map((t) => t.symbol!),
          asOf,
        )

  /*
   * 어댑터의 계약 의무 ②는 「입력당 정확히 하나」다. 그래도 **믿지 않고 확인한다** —
   * 하나라도 빠지면 그 자산이 조용히 «어느 칸에도» 세어지지 않아 불변식이 깨진다.
   */
  const bySymbol = new Map(outcomes.map((o) => [o.symbol, o]))

  let succeeded = 0
  let skipped = 0
  const failed: CollectFailure[] = []

  for (const target of mapped) {
    const outcome = bySymbol.get(target.symbol!)

    if (outcome == null) {
      failed.push({
        assetId: target.assetId,
        assetName: target.assetName,
        failure: 'CALL_FAILED',
        reason: failureReason(
          'CALL_FAILED',
          `공급자가 «${target.symbol!}»에 대한 결과를 주지 않았다 (어댑터 계약 위반)`,
        ),
      })
      continue
    }

    if (!outcome.ok) {
      failed.push({
        assetId: target.assetId,
        assetName: target.assetName,
        failure: outcome.failure,
        reason: failureReason(outcome.failure, outcome.detail),
      })
      continue
    }

    /*
     * ★★ CR-05 — 같은 `(asset_id, as_of_date)`에 행이 있으면 **`source`와 무관하게**
     * 쓰지 않는다. `MANUAL`이 이긴다.
     *
     * 사전 확인은 **왕복 절약이 아니라** 여기서는 「쓰지 않음」의 판정이다 — 날짜를
     * 공급자가 준 뒤에야 알 수 있으므로 호출을 건너뛸 수는 없다. CR-05가 적은
     * 「사전 확인으로 공급자 호출을 건너뛰어 C-03에 유리」는 **이 공급자에서 성립하지
     * 않으며** 그 사실을 DOC-011에 적었다(한도가 문제되지 않는다).
     */
    if (target.storedDates.has(outcome.asOfDate)) {
      skipped += 1
      continue
    }

    const written = await ports.writeQuote({
      assetId: target.assetId,
      asOfDate: outcome.asOfDate,
      price: outcome.price,
      providerId: provider.id,
    })

    if (written === 'WRITTEN') {
      succeeded += 1
    } else if (written === 'ALREADY_EXISTS') {
      /*
       * `23505`다. **`failed`가 아니라 `skipped`** — 경합이 정확히 CR-05의 상태이며
       * (다른 호출자가 먼저 썼다) 실패로 보고하면 **건강한 동시 실행이 고장으로 보인다.**
       * CR-03의 「두 겹」 중 둘째 겹이 값으로 오는 자리다.
       */
      skipped += 1
    } else {
      failed.push({
        assetId: target.assetId,
        assetName: target.assetName,
        failure: 'CALL_FAILED',
        reason: failureReason('CALL_FAILED', written.error),
      })
    }
  }

  /*
   * ★★★ DQ-02 — 결측은 **공백**이다. 위 어느 갈래도 「직전값을 새 날짜로 복제」하지
   * 않는다는 것이 그 결정의 전부이며, 그래서 이 함수에 그 코드가 «없다».
   * 없는 것을 테스트로 고정한다(`collect.test.ts`가 `EMPTY`에서 `writeQuote` 호출 0을 본다).
   */

  const report: CollectReport = {
    targetCount: targets.length,
    succeeded,
    skipped,
    unmapped,
    failed,
  }

  if (!reportIsBalanced(report)) {
    /*
     * 여기 닿으면 **위 루프에 빠진 갈래가 있다.** 던지지 않고 로그만 남기는 이유는
     * 부분 결과라도 보고하는 편이 낫기 때문이며(CR-02), 그래도 조용히 넘기지 않는다.
     */
    log(
      `[수집] 집계가 맞지 않는다 — target=${report.targetCount} ` +
        `succeeded=${succeeded} skipped=${skipped} unmapped=${unmapped} failed=${failed.length}`,
    )
  }

  return report
}
