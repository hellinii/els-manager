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

export type ListProductsParams = {
  ownerId?: string
  status?: 'ACTIVE' | 'REDEEMED'
  kiStatus?: 'SAFE' | 'WARNING' | 'TOUCHED'
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

const KI_FILTER_MATCH: Record<
  NonNullable<ListProductsParams['kiStatus']>,
  KiStatus
> = { SAFE: 'SAFE', WARNING: 'WARNING', TOUCHED: 'TOUCHED' }

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
      const want = KI_FILTER_MATCH[params.kiStatus]
      items = items.filter((item) => item.kiStatus === want)
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
