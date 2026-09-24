import type { QueryContext } from './context'
import {
  loadAllAssetOptions,
  loadAllAssetsWithLatestPrice,
  loadAssetsByName,
  loadProducts,
} from './load'
import { dec } from '@/lib/decimal'

import { isStale, priceString, redemptionMarkOf } from './map'

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
  /**
   * 이 자산의 공급자 매핑 (P5a 컷 2b — §4.5).
   *
   * ★ **빈 배열이 「미매핑」이며 그것은 실패가 아니다** — ADR-007이 수동 입력을 설계된
   * 정상 경로로 못박았다. 화면은 그 상태를 「자동 수집 안 함」으로 말한다(오류가 아니다).
   */
  providerSymbols: Array<{ provider: string; symbol: string }>
}

export type AssetOption = {
  id: string
  name: string
  market: string | null
  currency: string
  hasPriceProvider: boolean
  /**
   * 이 자산의 공급자 매핑 — `AssetPriceRow.providerSymbols`와 같은 형태 (DOC-011 §4.9 v4.3).
   *
   * 불러오기(§4.10)가 키움 기초자산을 **심볼로** 앱 자산과 잇는 데 쓴다. 이름으로 잇지 않는다 —
   * 이름은 사용자가 쓴 값이고 틀린 연결은 자동 시세가 되어 판정에 들어간다.
   */
  providerSymbols: Array<{ provider: string; symbol: string }>
}

/**
 * §4.9 — **비-빈 질의**의 결과 건수 상한. 자동완성 목록이므로 화면이 감당할 크기로
 * 자른다. 빈 질의(전량)에는 걸지 않는다 — 아래 `searchAssets` 각주.
 */
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
        latestPrice: latest == null ? null : priceString(dec(latest.price)),
        asOfDate: latest?.as_of_date ?? null,
        source: latest?.source ?? null,
        usedByActiveProducts: activeUsage.get(asset.id) ?? 0,
        isStale: isStale({ asOfDate: latest?.as_of_date ?? null, asOf: ctx.asOf }),
        /*
         * 이름을 `provider_symbol` → `symbol`로 좁힌다 — 뷰의 필드가 이미
         * `providerSymbols` 안이라 접두사가 두 번이 된다. 열 이름을 그대로 나르는 것보다
         * 읽는 쪽에서 짧은 편이 낫고, 그 매핑이 여기 한 줄로 남는다.
         */
        providerSymbols: asset.asset_provider_symbols.map((row) => ({
          provider: row.provider,
          symbol: row.provider_symbol,
        })),
      }
    })
  }

  /**
   * §4.9 — 빈 질의는 **전량**이다 (v1.5, P4 컷 4a).
   *
   * 종전에는 `[]`였고 사유가 "자동완성이 열릴 때마다 전 자산을 내려보내게 된다"였다.
   * **SCR-204에서 그 전제가 성립하지 않는다** — §1.2가 조회를 서버 액션으로 감싸지
   * 않으므로 타이핑마다 묻는 경로가 없고, 화면은 렌더 1회에 전량을 받아 클라이언트에서
   * 좁힌다. 그 상태에서 `[]`는 절약이 아니라 **자동완성을 영구히 비게 만드는 값**이었다:
   * 자산이 있어도 등록 화면에서 하나도 고를 수 없다.
   *
   * 전량 경로에 `SEARCH_LIMIT`을 물리지 않는 이유는 그 자름이 **선택 불가능한 자산**을
   * 만들기 때문이다 — 21번째 자산은 어떤 방법으로도 고를 수 없는데 화면에는 그 사실이
   * 나타나지 않는다. 대신 Q-06의 절단 감지를 쓴다(`loadAllAssetOptions`).
   */
  async function searchAssets(query: string): Promise<AssetOption[]> {
    const trimmed = query.trim()
    const rows =
      trimmed === ''
        ? await loadAllAssetOptions(ctx)
        : await loadAssetsByName(ctx, trimmed, SEARCH_LIMIT)

    return rows.map((asset) => ({
      id: asset.id,
      name: asset.name,
      market: asset.market,
      currency: asset.currency,
      // 공급자 심볼이 하나라도 있으면 자동 조회가 가능하다(ADR-004)
      hasPriceProvider: asset.asset_provider_symbols.length > 0,
      // `listAssetPrices`와 같은 이름 좁힘(`provider_symbol` → `symbol`) — 두 뷰가 한 형태다
      providerSymbols: asset.asset_provider_symbols.map((row) => ({
        provider: row.provider,
        symbol: row.provider_symbol,
      })),
    }))
  }

  return { listAssetPrices, searchAssets }
}
