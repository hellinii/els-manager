import { PRICE_PROVIDERS } from '@/lib/providers/types'

import { parseManualPriceInput, parseProviderSymbolInput } from '../validate/inputs'
import { Problems } from '../validate/primitives'
import { V17_notFuture } from '../validate/rules'
import { requireAffected } from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { toInsert } from './payload'
import { failWith, okVoid, type ActionResult } from './result'
import type { ManualPriceInput, ProviderSymbolInput, RefreshPricesResult } from './types'

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

  /**
   * §5.12 — 공급자 심볼 매핑. `providerSymbol == null`이면 **해제(삭제)**다.
   *
   * ★ 계약이 하나인 근거는 §5.9 `setKiTouched`와 같다 — 좌표가 하나이고
   * (`(asset_id, provider)`) 화면의 조작도 하나다. 둘로 쪼개면 계약 수가 14가 되고
   * `MutationName`을 세는 원장이 두 번 움직인다.
   *
   * ★★ **삭제가 «필요»한 것은 `UNIQUE(asset_id, provider)` 때문이다** — 그 제약 아래에서
   * UPDATE로는 매핑을 없앨 수 없다(공급자를 바꿀 수는 있어도). 그래서 한 계약이 UPSERT와
   * DELETE를 함께 갖는 것이 규약 위반이 아니라 **좌표의 성질**이다.
   *
   * ★★★ **해제에 `requireAffected`를 쓰지 않는다.** 없는 행을 지우는 요청은 0행으로
   * 끝나는데 그것은 **성공이다** — 이미 없는 것을 없애는 요청을 거부할 이유가 없다
   * (§5.9가 노낙인 상품의 `null` 터치를 허용한 것과 같은 판단). `requireAffected`를 걸면
   * 두 번 누르는 것이 오류가 되고, 그 오류에는 사용자가 고칠 것이 없다.
   */
  async function saveProviderSymbol(input: ProviderSymbolInput): Promise<ActionResult<void>> {
    const p = new Problems()
    const parsed = parseProviderSymbolInput(p, input)
    /*
     * ★ **`parsed == null`만 보면 V-21이 조용히 사라진다** — e2e가 잡은 실제 결함이다.
     *
     * `V21_knownProvider`는 `provider`가 «있는데 소속이 틀린» 경우를 기록하므로
     * `allPresent([assetId, provider])`가 참이고 파서가 **객체를 돌려준다.** 그 상태에서
     * `parsed == null`만 검사하면 위반이 `Problems`에 남은 채 저장이 진행되어
     * **모르는 공급자의 매핑이 그대로 들어간다** — V-21이 막으려던 바로 그 상태다.
     *
     * `saveManualPrice`가 V-17에 대해 `if (!p.isEmpty)`를 따로 두는 것과 같은 형태이며,
     * 그쪽은 규칙이 파서 «밖»에 있어 눈에 보였고 이쪽은 파서 «안»이라 보이지 않았다.
     * **부류: 검증을 추가했으나 그 결과를 반환하는 줄을 빠뜨렸다 — 조용히 통과한다.**
     */
    if (parsed == null || !p.isEmpty) return failWith(p.toError())

    if (parsed.providerSymbol == null) {
      const { error } = await ctx.db
        .from('asset_provider_symbols')
        .delete()
        .eq('asset_id', parsed.assetId)
        .eq('provider', parsed.provider)
      if (error != null) return failDb(error, '공급자 매핑 해제')
      return okVoid() // 0행도 성공이다 — 위 ★★★
    }

    const { data, error } = await ctx.db
      .from('asset_provider_symbols')
      .upsert(
        toInsert('asset_provider_symbols', {
          asset_id: parsed.assetId,
          provider: parsed.provider,
          provider_symbol: parsed.providerSymbol,
        }),
        { onConflict: 'asset_id,provider' },
      )
      .select('id')
    if (error != null) return failDb(error, '공급자 매핑 저장')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  return { saveManualPrice, refreshPrices, saveProviderSymbol }
}
