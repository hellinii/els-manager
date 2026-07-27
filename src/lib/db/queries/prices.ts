import type { QueryContext } from './context'
import {
  loadAllAssetsWithLatestPrice,
  loadAssetsByName,
  loadProducts,
} from './load'
import { isStale, redemptionMarkOf } from './map'

/** §4.5·§4.9 — 시세 목록·자산 검색 */

export type AssetPriceView = {
  assetId: string
  name: string
  market: string | null
  currency: string
  latestPrice: string | null
  asOfDate: string | null
  source: 'AUTO' | 'MANUAL' | null
  usedByActiveProducts: number
  isStale: boolean
}

export type AssetOption = {
  id: string
  name: string
  market: string | null
  currency: string
  hasPriceProvider: boolean
}

/** §4.9 — 결과 건수 상한. 자동완성 목록이므로 화면이 감당할 크기로 자른다. */
const SEARCH_LIMIT = 20

export function makeAssetQueries(ctx: QueryContext) {
  async function listAssetPrices(): Promise<AssetPriceView[]> {
    // ① 전체 자산 + 자산별 최신 시세(asOf 상한, 부모별 limit(1))
    const assets = await loadAllAssetsWithLatestPrice(ctx)

    // ② 참조 중인 미상환 상품 수 — 상품 계열을 한 번 읽어 JS에서 센다.
    //    `count`를 자산별로 물으면 자산 수만큼 왕복이 된다(N+1).
    const products = await loadProducts(ctx)
    const activeUsage = new Map<string, number>()
    for (const product of products) {
      if (redemptionMarkOf(product) != null) continue // 상환 완료는 세지 않는다
      // 같은 상품이 같은 자산을 두 번 참조할 수는 없다(UNIQUE(els_id, asset_id))
      for (const u of product.els_underlyings) {
        activeUsage.set(u.asset_id, (activeUsage.get(u.asset_id) ?? 0) + 1)
      }
    }

    return assets.map((asset) => {
      // 부모별 limit(1)이므로 0건 또는 1건이다
      const latest = asset.asset_prices[0] ?? null
      return {
        assetId: asset.id,
        name: asset.name,
        market: asset.market,
        currency: asset.currency,
        latestPrice: latest?.price ?? null,
        asOfDate: latest?.as_of_date ?? null,
        source: latest?.source ?? null,
        usedByActiveProducts: activeUsage.get(asset.id) ?? 0,
        isStale: isStale({ asOfDate: latest?.as_of_date ?? null, asOf: ctx.asOf }),
      }
    })
  }

  async function searchAssets(query: string): Promise<AssetOption[]> {
    // 빈 검색어로 전체 목록을 반환하지 않는다 — 자동완성이 열릴 때마다
    // 전 자산을 내려보내게 된다.
    if (query.trim() === '') return []

    const rows = await loadAssetsByName(ctx, query.trim(), SEARCH_LIMIT)

    return rows.map((asset) => ({
      id: asset.id,
      name: asset.name,
      market: asset.market,
      currency: asset.currency,
      // 공급자 심볼이 하나라도 있으면 자동 조회가 가능하다(ADR-004)
      hasPriceProvider: asset.asset_provider_symbols.length > 0,
    }))
  }

  return { listAssetPrices, searchAssets }
}
