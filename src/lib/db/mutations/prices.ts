import { PRICE_PROVIDERS } from '@/lib/providers/types'

import { parseManualPriceInput } from '../validate/inputs'
import { Problems } from '../validate/primitives'
import { V17_notFuture } from '../validate/rules'
import { requireAffected } from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { toInsert } from './payload'
import { failWith, okVoid, type ActionResult } from './result'
import type { ManualPriceInput, RefreshPricesResult } from './types'

/** §5.7·§5.8 — 수동 시세 입력·시세 수동 갱신 */

export function makePriceMutations(ctx: MutationContext) {
  /**
   * §5.7 — `UNIQUE(asset_id, as_of_date)` 기준 UPSERT. `source = 'MANUAL'`.
   *
   * **`.upsert()`를 그대로 쓸 수 있다.** `DO UPDATE SET`이 payload 전역
   * (`asset_id`·`as_of_date` 포함)을 실어도 **동일값 재대입**이므로 I-16 트리거를
   * 통과한다. 좌표를 *바꾸는* UPDATE만 `23514`로 거부되며, 좌표가 다른 시세는
   * 정정이 아니라 새 관측이므로 새 행으로 들어간다.
   *
   * **이 계약이 기준일을 요구하는 유일한 이유가 V-17이다**(W-02). 계약이 자기
   * 시각을 구하면 KST 00:00~09:00에 오늘 종가 입력이 "미래"로 거부된다.
   */
  async function saveManualPrice(input: ManualPriceInput): Promise<ActionResult<void>> {
    const p = new Problems()
    const parsed = parseManualPriceInput(p, input)
    if (parsed == null) return failWith(p.toError())

    V17_notFuture(p, parsed.asOfDate, ctx.asOf)
    if (!p.isEmpty) return failWith(p.toError())

    const { data, error } = await ctx.db
      .from('asset_prices')
      .upsert(
        toInsert('asset_prices', {
          asset_id: parsed.assetId,
          as_of_date: parsed.asOfDate,
          price: parsed.price,
          source: 'MANUAL',
        }),
        { onConflict: 'asset_id,as_of_date' },
      )
      .select('id')
    if (error != null) return failDb(error, '수동 시세 입력')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  /**
   * §5.8 — 등록 공급자가 0개인 동안 **`PROVIDER_UNAVAILABLE`이다.**
   *
   * `ok: true` + `succeeded: 0`이 아니다. 둘의 차이는 화면 처리다: 전자는
   * ST-03(수동 입력 폴백)으로 유도하고 후자는 "갱신했으나 대상이 없었다"로
   * 읽힌다. 공급자 선정은 ADR-007(AQ-01)로 분리되어 있고 아직 미결이다.
   *
   * 컨텍스트를 쓰지 않는 유일한 계약이지만 서명은 다른 계약과 같은 자리에 둔다 —
   * 공급자가 붙으면 대상 자산 조회에 `ctx`가 필요해진다.
   */
  async function refreshPrices(): Promise<ActionResult<RefreshPricesResult>> {
    if (PRICE_PROVIDERS.length === 0) {
      return failWith({
        code: 'PROVIDER_UNAVAILABLE',
        message: '시세 공급자가 등록되어 있지 않다. 수동 입력으로 갱신한다.',
      })
    }
    // 여기 닿았다면 공급자가 **등록되었는데 수집 로직이 없는** 상태다 — 배포
    // 결함이므로 조용히 넘기지 않는다. 스텁 값을 `asset_prices`에 넣어 "성공"을
    // 만들지 않는 것이 ADR-004 v0.7의 결정이다.
    console.error(
      `[공급자] ${PRICE_PROVIDERS.length}개가 등록되었으나 수집 로직이 구현되지 않았다 ` +
        '(DOC-011 §5.8, ADR-007 미결). 스텁 값을 저장하지 않는다.',
    )
    return failWith({
      code: 'INTERNAL',
      message: '처리 중 오류가 발생했다.',
    })
  }

  return { saveManualPrice, refreshPrices }
}
