import { parseAssetInput } from '../validate/inputs'
import { Problems } from '../validate/primitives'
import { staleState } from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { toInsert } from './payload'
import { failWith, ok, type ActionResult } from './result'
import type { AssetInput } from './types'

/** §5.10 — 자산 등록 */

export function makeAssetMutations(ctx: MutationContext) {
  /**
   * **인증 사용자 전체가 등록할 수 있다.** 자산은 공용 데이터이며 정책도
   * `assets_insert_all`로 `with check (true)`다 — 소유자 개념이 없으므로 사전
   * 조회할 것이 없고, 이 계약에만 소유자 판정이 없는 이유가 그것이다.
   *
   * `market`이 `null`이어도 `UNIQUE(name, market)`가 중복으로 판정한다 —
   * 인덱스가 `nulls not distinct`이므로(DOC-002 §4.3) 시장 정보 없는 자산도
   * 한 번만 등록된다. 그 위반은 `assets_name_market_key` → `CONFLICT`다.
   */
  async function createAsset(input: AssetInput): Promise<ActionResult<{ id: string }>> {
    const p = new Problems()
    const parsed = parseAssetInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const { data, error } = await ctx.db
      .from('assets')
      .insert(
        toInsert('assets', {
          name: parsed.name,
          asset_type: parsed.assetType,
          // 생략하지 않고 `null`을 명시한다 — 위 UNIQUE가 `null`을 값으로 취급하므로
          // "안 보냄"과 "비움"이 같은 뜻이고, 그 사실이 페이로드에 드러나는 편이 낫다.
          market: parsed.market ?? null,
          currency: parsed.currency,
        }),
      )
      .select('id')
    if (error != null) return failDb(error, '자산 등록')

    const created = data?.[0]
    return created == null ? failWith(staleState()) : ok({ id: created.id })
  }

  return { createAsset }
}
