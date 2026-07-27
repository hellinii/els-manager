import type { QueryContext } from './context'
import { loadLatestPrices, loadScheduleRows } from './load'
import { toScheduleItems, type ScheduleItem } from './map'

/** §4.4 — 평가일정 */

export type ListScheduleParams = {
  from?: string
  to?: string
  ownerId?: string
  activeOnly?: boolean
}

export function makeScheduleQueries(ctx: QueryContext) {
  async function listSchedule(
    params: ListScheduleParams = {},
  ): Promise<ScheduleItem[]> {
    // ① 차수 + 부모 상품(자기 일정 전체 포함) — 네 필터 모두 질의로 내려간다
    const rows = await loadScheduleRows(ctx, params)

    // ② 자산별 최신 시세. 같은 자산이 여러 차수에 걸쳐 나오므로 중복을 제거한다
    //   (loadLatestPrices가 Set으로 접는다).
    const prices = await loadLatestPrices(
      ctx,
      rows.flatMap((row) => row.els_products.els_underlyings.map((u) => u.asset_id)),
    )

    /**
     * 부모별로 한 번만 매핑한 뒤 요청된 차수만 고른다.
     *
     * 차수마다 `toScheduleItems`를 부르면 같은 상품의 판정이 차수 수만큼 반복되고,
     * `worstOf`가 매번 다시 계산된다. 결과는 같지만 결함 상품의 `console.error`가
     * 차수만큼 반복되어 로그가 원인을 가린다.
     */
    const byProduct = new Map<string, Map<number, ScheduleItem>>()

    for (const row of rows) {
      const product = row.els_products
      if (!byProduct.has(product.id)) {
        const items = toScheduleItems(product, prices, ctx.asOf)
        byProduct.set(product.id, new Map(items.map((i) => [i.roundNo, i])))
      }
    }

    const result: ScheduleItem[] = []
    for (const row of rows) {
      const item = byProduct.get(row.els_products.id)?.get(row.round_no)
      if (item != null) result.push(item)
    }

    // 루트 정렬이 평가일 오름차순이므로 순서는 이미 맞다. 동일 평가일 안에서만
    // 차수로 안정화한다 — 정렬이 흔들리면 화면 스냅샷 테스트가 부서진다.
    return result.sort(
      (a, b) =>
        a.evaluationDate.localeCompare(b.evaluationDate) ||
        a.productName.localeCompare(b.productName) ||
        a.roundNo - b.roundNo,
    )
  }

  return { listSchedule }
}
