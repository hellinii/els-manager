import type { AssetOption } from '@/lib/db/queries/prices'
import { PROVIDER_ID, UNDERLYING_TYPES } from '@/lib/providers/kiwoom/endpoints'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import { formatSymbol, parseSymbol } from '@/lib/providers/kiwoom/symbols'

/**
 * 불러온 기초자산 → 앱 자산 — **정확 일치로만 잇는다** (DOC-008 §5 SCR-204 v2.9 · DOC-005 §8.10)
 *
 * 키움 상세 페이지의 기초자산은 이름(「홍콩H지수」)과, 해외 종목이면 티커(`PLTR`)로 온다. 앱
 * 자산은 **공급자 심볼**(`asset_provider_symbols`, `1:_HK#HIDX` 형식)로 키움과 이어져 있다. 그래서
 * 길이 둘이다:
 *
 * 1. 불러온 자산 → **키움 기초자산 목록(es040)의 한 행** → `provider_symbol`
 * 2. `provider_symbol` → 그 심볼을 가진 **앱 자산**
 *
 * ## ★ 퍼지 매칭을 하지 않는다
 *
 * 틀린 연결(「삼성전자」 → 「삼성전자우」)은 형식이 정상이고 값만 거짓이다 — 그 자산의 **자동
 * 시세**가 이 상품의 워스트오브·조기상환·KI 판정에 들어가고, 화면 어디에서도 드러나지 않는다.
 * 모르면 「미해결」로 두고 사람이 고른다. 앱 자산의 **이름으로도 잇지 않는다** — 이름은 사용자가
 * 쓴 값이다(개발 시드 `[DEV] 코스피200` · 키움 `KOSPI200지수`).
 *
 * ## 이름 정규화는 기계적이다
 *
 * NFKC → 공백 제거 → 대문자 → 끝의 「지수」 제거. 마지막 규칙은 실측이 요구한다 — 팝업의
 * `S&P500`이 목록에서 `S&P500 지수`다(E03060). 언어가 다른 쌍은 정규화로 풀지 않고 **실측한
 * 별칭**으로만 푼다(아래 `ALIASES`) — 규칙을 넓혀 맞추면 그 규칙이 맞추지 말아야 할 쌍도 맞춘다.
 */

/** 불러온 자산 한 행 — 어댑터의 `KiwoomAssetTerms`와 구조가 같다(이름·티커만 쓴다) */
export type ImportedAsset = { name: string; ticker: string | null }

export type AssetResolution =
  /** 앱 자산 하나와 이어졌다 */
  | { kind: 'RESOLVED'; assetId: string; symbol: string; listed: ListedAsset }
  /** 키움 목록에는 있고 **그 심볼을 가진 앱 자산이 없다** — 자산 추가 또는 기존 자산에 연결 */
  | { kind: 'NO_MAPPING'; symbol: string; listed: ListedAsset }
  /** 키움 기초자산 목록에서 찾지 못했다 — 심볼을 만들 수 없으므로 사람이 고른다 */
  | { kind: 'NO_ES040' }
  /** 둘 이상과 맞았다 — 목록에서 둘 · 같은 심볼을 가진 앱 자산이 둘(DOC-011 AQ-73) */
  | { kind: 'AMBIGUOUS'; detail: string }

/**
 * 언어가 다른 쌍 — **실측한 것만** 둔다. 정규화한 팝업 이름 → es040 `stk_code`.
 *
 * 출처는 2026-09-24에 받은 픽스처다(`tests/providers/fixtures/kiwoom-terms/`). 쌍을 늘릴 때는
 * 그 이름이 나온 상품을 옆에 적는다 — 적을 수 없으면 추측이다. `tests/app/importAssets.test.ts`가
 * 모든 대상이 es040 목록에 실재하는지 확인한다.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  // E00795 — 목록은 「HSCEI 지수」
  홍콩H: '_HK#HIDX',
  // E00795 · E03060 — 목록은 「EuroStoxx50 지수」
  유로STOXX50: '_SX5E',
  // E03060 — 목록은 「Nikkei225 지수」
  일본니케이225: '_JP#NI225',
}

export function normalizeAssetName(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase().replace(/지수$/, '')
}

/**
 * 불러온 자산마다 해석 결과. 키는 **팝업 표의 이름**이다 — 행 번호가 아니다(사용자가 행을
 * 지우면 번호가 밀린다).
 *
 * 같은 이름이 두 번 오면(실측 없음) 뒤의 것이 앞의 것을 덮지 않도록 둘 다 `AMBIGUOUS`다.
 *
 * 던지지 않는다 — 입력이 무엇이든 표가 나온다.
 */
export function resolveImportAssets(input: {
  assets: readonly ImportedAsset[]
  listed: readonly ListedAsset[]
  options: readonly AssetOption[]
}): Record<string, AssetResolution> {
  const out: Record<string, AssetResolution> = {}
  const seen = new Map<string, number>()
  for (const asset of input.assets) seen.set(asset.name, (seen.get(asset.name) ?? 0) + 1)

  for (const asset of input.assets) {
    if ((seen.get(asset.name) ?? 0) > 1) {
      out[asset.name] = { kind: 'AMBIGUOUS', detail: '같은 이름의 기초자산이 둘이다' }
      continue
    }
    out[asset.name] = resolveOne(asset, input.listed, input.options)
  }
  return out
}

function resolveOne(
  asset: ImportedAsset,
  listed: readonly ListedAsset[],
  options: readonly AssetOption[],
): AssetResolution {
  const hits = listedMatches(asset, listed)
  if (hits.length === 0) return { kind: 'NO_ES040' }
  if (hits.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      detail: `키움 기초자산 목록에서 ${hits.length}개와 맞는다 — ${hits.map((h) => h.name).join(', ')}`,
    }
  }

  const hit = hits[0]!
  const parsed = parseSymbol(`${hit.underlyingType}:${hit.stkCode}`)
  // 목록의 분류가 셋 중 하나가 아니면 심볼을 만들 수 없다 — 추측하지 않는다
  if ('code' in parsed) return { kind: 'NO_ES040' }
  const symbol = formatSymbol(parsed)

  const owners = new Set(
    options
      .filter((option) =>
        option.providerSymbols.some((row) => row.provider === PROVIDER_ID && row.symbol === symbol),
      )
      .map((option) => option.id),
  )
  if (owners.size === 0) return { kind: 'NO_MAPPING', symbol, listed: hit }
  if (owners.size > 1) {
    // `UNIQUE(provider, provider_symbol)`이 없다(DOC-011 AQ-73) — 둘 중 하나를 고르면 조용한 선택이다
    return { kind: 'AMBIGUOUS', detail: `심볼 ${symbol}을 가진 앱 자산이 ${owners.size}개다` }
  }
  return { kind: 'RESOLVED', assetId: [...owners][0]!, symbol, listed: hit }
}

/**
 * 키움 목록에서 그 자산의 행 — **티커가 있으면 티커가 정하고, 이름은 반증만 한다.**
 *
 * 해외 종목은 티커가 이름보다 정확하다(이름은 「알파벳A(구글)」처럼 꾸며져 있다). 티커가
 * 있는데 목록에 없으면 이름으로 넘어가지 않는다 — 티커와 이름이 다른 행을 가리키는 경우를
 * 이름이 조용히 덮는다.
 *
 * ★ **티커는 열 위치로 자산에 붙는다**(어댑터가 「해외기초자산 정보」 표의 열 순서를 자산 표의
 * 순서와 같다고 본다 — 그 표에는 자산명 머리글이 없다). 순서가 어긋나면 두 자산의 티커가
 * **서로 바뀐 채** 통과한다. 그래서 이름이 목록의 **다른** 행을 가리키면 둘 다 반환해 모호로
 * 만든다. 이름이 어느 행도 가리키지 않으면 반증이 없으므로 티커를 따른다 — 실측한 해외 여섯
 * (테슬라·엔비디아·팔란티어 테크·AMD·마이크론 테크놀로지·인텔)은 팝업 이름과 목록 이름이 같다.
 */
function listedMatches(asset: ImportedAsset, listed: readonly ListedAsset[]): ListedAsset[] {
  const key = normalizeAssetName(asset.name)
  const byName = listed.filter((row) => normalizeAssetName(row.name) === key)

  if (asset.ticker != null) {
    const byTicker = listed.filter(
      (row) => row.underlyingType === UNDERLYING_TYPES.OVERSEAS_STOCK && row.stkCode === asset.ticker,
    )
    // 티커가 목록에 없으면 이름으로 넘어가지 않는다 — 비어 있는 채로 돌려준다
    if (byTicker.length === 0) return []
    const contradicted = byName.some((row) => !byTicker.includes(row))
    return contradicted ? [...byTicker, ...byName.filter((row) => !byTicker.includes(row))] : byTicker
  }

  if (byName.length > 0) return byName

  const alias = ALIASES[key]
  return alias == null ? [] : listed.filter((row) => row.stkCode === alias)
}
