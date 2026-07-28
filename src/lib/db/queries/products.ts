import { dec } from '@/lib/decimal'
import type { KiStatus } from '@/lib/domain'

import type { QueryContext } from './context'
import { loadLatestPrices, loadProduct, loadProducts, type ProductRow } from './load'
import {
  toProductDetailView,
  toProductListItem,
  type ProductDetailView,
  type ProductListItem,
} from './map'

/** §4.2·§4.3 — 상품 목록·상세 */

/**
 * ## `kiStatus`가 `KiStatus`다 — AQ-24 해결 (P4 컷 2)
 *
 * v1.3까지 파라미터는 3값(`SAFE`·`WARNING`·`TOUCHED`)이고 반환은 5값이었다.
 * 그래서 **`BELOW`·`NO_KI` 상품은 어떤 필터로도 뽑을 수 없었고**, 그중 `BELOW`는
 * §4.1이 「사용자 확인이 필요한 유일한 상태」라고 규정한 값이다 — 목록에서 그것만
 * 골라볼 수 없다는 것은 설계가 아니라 결함이었다.
 *
 * **리터럴 유니온을 다시 적지 않고 `KiStatus`를 색인한다.** 다시 적으면 두 목록이
 * 갈릴 수 있고 AQ-24는 정확히 그 갈림이었다. 도메인 열거값이 여섯째로 늘면
 * 파라미터가 함께 늘고, `KI_STATUS_LABELS`(`Record<KiStatus, string>`)와
 * `KI_STATUS_GRADES`도 함께 컴파일이 깨진다 — 비대칭이 규율이 아니라 타입으로
 * 막힌다.
 *
 * `status`는 그대로 리터럴이다. 그쪽은 파생 유니온(`ProductListItem['status']`)이
 * 두 값뿐이고 도메인 열거형이 아니다.
 *
 * > **`kiStatus`가 `null`인 상품은 여전히 어떤 값으로도 뽑히지 않는다.** 그것은
 * > 남은 결함이 아니라 정의다 — `null`은 상태가 아니라 **판정의 부재**이고 원인이
 * > 셋이다(§4.2 우선순위표: 무결성 결함 / 상환 완료 / 시세 없음). 셋을 한 필터
 * > 값으로 묶으면 성격이 다른 상태 셋을 하나로 표시하게 되고, 그중 상환 완료는
 * > 이미 `status` 필터가 가른다. 화면은 `deriveDisplay()`로 셋을 구분해 표시한다.
 */
export type ListProductsParams = {
  ownerId?: string
  status?: 'ACTIVE' | 'REDEEMED'
  kiStatus?: KiStatus
  sortBy?: 'EVALUATION_DATE' | 'PRINCIPAL' | 'D_DAY'
}

export function assetIdsOf(rows: readonly ProductRow[]): string[] {
  return rows.flatMap((row) => row.els_underlyings.map((u) => u.asset_id))
}

/**
 * 파생값 기반 정렬 — Q-05.
 *
 * **`PRINCIPAL`도 조회 후에 적용한다.** 열 조건이므로 질의로 내릴 수 있지만,
 * 그러면 정렬이 두 계층으로 쪼개져 "이 정렬은 어디서 일어나는가"를 매번 확인해야
 * 한다. 현재 규모(A-01)에서 얻는 것이 없다. 금액 비교는 문자열이 아니라
 * Decimal로 한다 — `'1000000' < '900000'`이 문자열 비교에서는 참이다.
 */
function sortItems(
  items: ProductListItem[],
  sortBy: ListProductsParams['sortBy'],
): ProductListItem[] {
  const sorted = [...items]

  switch (sortBy) {
    case 'PRINCIPAL':
      return sorted.sort((a, b) => dec(b.principal).cmp(dec(a.principal)))

    case 'D_DAY':
    case 'EVALUATION_DATE':
      // 두 정렬은 같은 순서를 만든다(D-Day는 평가일의 단조 함수다). 상환 완료
      // 상품은 다음 평가일이 없으므로 항상 뒤로 보낸다 — null을 0으로 두면
      // 상환된 상품이 임박 상품 사이에 끼어든다.
      return sorted.sort((a, b) => {
        const x = a.nextEvaluation
        const y = b.nextEvaluation
        if (x == null && y == null) return a.name.localeCompare(b.name)
        if (x == null) return 1
        if (y == null) return -1
        return x.dDay - y.dDay || a.name.localeCompare(b.name)
      })

    default:
      return sorted
  }
}

/*
 * 파라미터를 `KiStatus`로 넓히면서 `KI_FILTER_MATCH`(3값 → `KiStatus` 사상)를
 * 지웠다. 항등 사상이 되므로 남기면 **아무 변환도 하지 않는데 변환처럼 보이는
 * 표**가 된다 — `paths.ts`의 홈 예외 분기를 지운 것과 같은 판단이다.
 */

export function makeProductQueries(ctx: QueryContext) {
  async function listProducts(
    params: ListProductsParams = {},
  ): Promise<ProductListItem[]> {
    // ① 상품 + 하위 전부 (1 왕복)
    const rows = await loadProducts(ctx, { ownerId: params.ownerId })
    // ② 자산별 최신 시세 (1 왕복, 부모별 limit(1) + asOf 상한)
    const prices = await loadLatestPrices(ctx, assetIdsOf(rows))

    let items = rows.map((row) =>
      toProductListItem(row, prices, ctx.asOf, ctx.viewerId),
    )

    // Q-05 — status·kiStatus는 판정 결과이므로 조회 후에 적용한다
    if (params.status != null) {
      items = items.filter((item) => item.status === params.status)
    }
    if (params.kiStatus != null) {
      items = items.filter((item) => item.kiStatus === params.kiStatus)
    }

    return sortItems(items, params.sortBy)
  }

  async function getProduct(id: string): Promise<ProductDetailView | null> {
    const row = await loadProduct(ctx, id)
    // 미존재는 null이다(§3.1). 예외를 던지지 않는다.
    if (row == null) return null

    const prices = await loadLatestPrices(ctx, assetIdsOf([row]))
    return toProductDetailView(row, prices, ctx.asOf, ctx.viewerId)
  }

  return { listProducts, getProduct }
}
