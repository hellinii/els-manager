import type { CollectReport } from './collect'
import type { CronResult, RefreshPricesResult } from '@/lib/db/mutations/types'

/**
 * `CollectReport` → 두 계약의 반환 — **순수** — DOC-011 §7.1 · §5.8
 *
 * ## 한쪽이 다른 쪽의 부분집합이 «아니다»
 *
 * | | `CronResult` (§7.1) | `RefreshPricesResult` (§5.8) |
 * |---|---|---|
 * | `executedAt`·`targetCount` | **있다** | 없다 — 요청 자체가 시점이고 화면이 호출자다 |
 * | `assetName` | 없다 — cron 응답에는 렌더할 화면이 없다 | **있다** |
 *
 * 그래서 **공통 코어의 두 투영**이며, 구현은 하나(`collect.ts`)다. 「7장의 배치와 동일
 * 로직」(§5.8)이 반환에서도 참이 되는 것이 이 파일의 존재 이유다 — 필드 집합이 갈리면
 * 무엇이 「동일」인지 말할 수 없다.
 */

/**
 * §7.1 — `executedAt`을 **인자로 받는다.**
 *
 * 이 모듈이 `new Date()`를 부르면 순수하지 않게 되고, 무엇보다 **테스트가 값을 단언할 수
 * 없다.** 시계는 라우트가 읽는다(`lib/format`의 결정성 규칙과 같은 논거).
 */
export function toCronResult(report: CollectReport, executedAt: string): CronResult {
  return {
    executedAt,
    targetCount: report.targetCount,
    succeeded: report.succeeded,
    skipped: report.skipped,
    unmapped: report.unmapped,
    // `assetName`을 «뺀다» — 위 표
    failed: report.failed.map((f) => ({
      assetId: f.assetId,
      reason: f.reason,
      failure: f.failure,
    })),
  }
}

/** §5.8 — `assetName`을 싣고 `executedAt`·`targetCount`를 뺀다 */
export function toRefreshResult(report: CollectReport): RefreshPricesResult {
  return {
    succeeded: report.succeeded,
    skipped: report.skipped,
    unmapped: report.unmapped,
    failed: report.failed.map((f) => ({
      assetId: f.assetId,
      assetName: f.assetName,
      reason: f.reason,
      failure: f.failure,
    })),
  }
}

/**
 * `cron_runs.outcome`을 정한다 — DOC-002 §4.11의 열거값 셋만 쓴다.
 *
 * ★ **부분 실패는 `OK`다.** CR-02가 「부분 실패가 전체 배치를 중단시키지 않고 응답은 `ok`」로
 * 정했으므로, 실패가 하나 있다고 `INTERNAL`로 적으면 **기록이 응답과 갈린다.**
 * `failed[]`가 그 실패를 이미 담고 있으므로 `outcome`은 「이 실행이 성립했는가」만 말한다.
 */
export function outcomeOf(report: CollectReport): 'OK' | 'INTERNAL' {
  return reportIsUsable(report) ? 'OK' : 'INTERNAL'
}

/**
 * 「성립했는가」의 정의 — **대상이 있었고 전부 실패한 것이 아니다.**
 *
 * 대상이 0이면 성립이다(할 일이 없었다). 대상이 있는데 **하나도 성공·건너뜀·미매핑이
 * 아니면** 그것은 전면 실패이며, 그 상태를 `OK`로 적으면 `cron_runs`가 거짓을 말한다.
 */
function reportIsUsable(report: CollectReport): boolean {
  if (report.targetCount === 0) return true
  return report.succeeded + report.skipped + report.unmapped > 0
}
