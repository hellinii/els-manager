import {
  collectPrices,
  type CollectPorts,
  type CollectReport,
  type CollectTarget,
  type WriteOutcome,
} from '@/lib/cron/collect'
import { outcomeOf } from '@/lib/cron/report'
import { PRICE_PROVIDERS, type ProviderFactory } from '@/lib/providers/types'

import {
  loadAllAssetOptions,
  loadPriceDatesInWindow,
  loadProducts,
  loadProviderSymbols,
} from '../queries/load'
import { redemptionMarkOf } from '../queries/map'
import type { MutationContext } from './context'
import { toInsert } from './payload'
import { failWith, ok, type ActionResult } from './result'

/**
 * 수집 포트의 구현 — DOC-011 §5.8 · §7.1 CR-02·CR-05 (P5a 컷 3)
 *
 * `lib/cron/collect.ts`가 순수 오케스트레이션이고 이 파일이 그 I/O 절반이다. 갈라 둔
 * 이유는 CR-02(부분 실패)·CR-05(사전 확인)·DQ-02(결측은 공백)의 분기표를 **상시 스위트가
 * 전수로** 보아야 하기 때문이며(ADR-003 — DB 없이 돈다), 여기 남는 것은 **분기 없는
 * 왕복 넷**이다.
 *
 * ## 「미상환」의 정의를 두 번째로 적지 않는다
 *
 * 대상은 `loadProducts` + `redemptionMarkOf`로 고른다 — `listAssetPrices`가
 * `usedByActiveProducts`를 세는 것과 **같은 두 함수**다. 여기서 「미상환」을 다시
 * 정의하면(예: `redemptions` 유무를 직접 질의) 그 정의가 둘이 되고, 그것이
 * `els_products.status` 열이 재발명되는 방식이다(절대 규칙 #4).
 */

/**
 * CR-05 사전 확인의 창 — **직전 달 1일부터 기준일까지.**
 *
 * ## 왜 「N일」이 아니라 「달 경계」인가
 *
 * 날짜 산술을 하지 않는다. `asOf - 30일`을 계산하려면 윤년 표가 필요하고 그 표는
 * 이미 `providers/kiwoom`에 있다 — **두 벌이 되는 순간 둘이 갈릴 수 있다.**
 * 달의 1일로 내리는 것은 **문자열 조작만으로** 되고(연·월만 다룬다) 결과는 28~62일
 * 창이므로 어떤 합리적 조회 범위보다 넓다.
 *
 * ## ★ 창의 크기는 «정확성 축이 아니다»
 *
 * 창 밖의 날짜를 공급자가 주면 사전 확인이 놓치고 `INSERT`가 시도된다. 그런데 그
 * 결과는 ⓐ 행이 없었으면 성공 ⓑ 있었으면 `23505` → **`skipped`**로, **양쪽 다
 * 옳다**(`collect.ts`의 ★★). 즉 `UNIQUE(asset_id, as_of_date)`가 최종 보장이고
 * 사전 확인은 왕복 절약이다 — CR-03이 「두 겹」이라고 적은 그대로다.
 *
 * **그 사실을 적어 두는 것이 이 주석의 목적이다.** 적지 않으면 다음 사람이 창을 좁힐 때
 * 「무엇이 깨지는가」를 코드에서 알 수 없고, 반대로 넓힐 때도 근거가 없다.
 */
function windowStart(asOf: string): string {
  const year = Number.parseInt(asOf.slice(0, 4), 10)
  const month = Number.parseInt(asOf.slice(5, 7), 10)

  if (month > 1) return `${asOf.slice(0, 4)}-${String(month - 1).padStart(2, '0')}-01`
  return `${String(year - 1).padStart(4, '0')}-12-01`
}

/**
 * 포트 넷 — 조회 셋 + 쓰기 하나.
 *
 * `provider`를 인자로 받는다. 어댑터의 id를 여기서 고르면 「어느 공급자의 매핑을
 * 읽는가」와 「어느 공급자에게 묻는가」가 두 곳에서 정해져 갈릴 수 있다 — 라우트가
 * 하나의 값으로 둘을 채운다.
 */
export function makeCollectPorts(ctx: MutationContext, provider: string): CollectPorts {
  return {
    async loadTargets(): Promise<readonly CollectTarget[]> {
      /*
       * ★ **던진다 — 삼키지 않는다.** 대상을 열거하지 못한 실행에는 「부분」이 없으므로
       * CR-02의 대상이 아니고, 라우트가 CR-08(비2xx)로 답한다. 로더들이 이미 던지므로
       * (`queries/load.ts`의 `fail`) 여기서 `try`를 두지 않는 것이 그 결정의 이행이다.
       */
      const products = await loadProducts(ctx)

      const assetIds = new Set<string>()
      for (const product of products) {
        if (redemptionMarkOf(product) != null) continue // 상환 완료는 감시하지 않는다
        for (const u of product.els_underlyings) assetIds.add(u.asset_id)
      }
      if (assetIds.size === 0) return []

      /*
       * 이름이 필요한 이유는 §5.8이 `failed[].assetName`을 요구하기 때문이다 — 화면이
       * 「어느 자산이 실패했는가」를 id로 말하면 사용자는 그것을 읽을 수 없다.
       * `loadAllAssetOptions`를 쓴다(전량이지만 자산 수가 두 자릿수다). 전용 로더를
       * 만들면 `QueryName` 원장이 아니라 로더 목록이 늘고, 얻는 것이 왕복 크기뿐이다.
       */
      const [assets, symbols, stored] = await Promise.all([
        loadAllAssetOptions(ctx),
        loadProviderSymbols(ctx, provider, [...assetIds]),
        loadPriceDatesInWindow(ctx, [...assetIds], windowStart(ctx.asOf), ctx.asOf),
      ])

      const nameOf = new Map(assets.map((a) => [a.id, a.name]))

      return [...assetIds].map((assetId) => ({
        assetId,
        /*
         * 이름을 찾지 못하는 것은 FK가 있으므로 일어날 수 없다. 그래도 `??`로 id를
         * 두는 이유는 **여기서 던지면 자산 하나의 결손이 배치 전체를 죽인다**는 것이고,
         * 그것이 CR-02가 금지한 형태다. 값이 id로 보이면 그 자체가 신호다.
         */
        assetName: nameOf.get(assetId) ?? assetId,
        symbol: symbols.get(assetId) ?? null,
        storedDates: stored.get(assetId) ?? new Set<string>(),
      }))
    },

    /**
     * 행 하나. **`.insert()`이며 `.upsert()`가 아니다** — CR-05가 `source`와 무관하게
     * 기존 행을 덮지 말라고 하므로 UPSERT는 규칙 위반이다. `MANUAL`이 이긴다.
     *
     * ★ **`23505`를 «값»으로 답한다.** 던지면 `collect.ts`가 그것을 실패로 셀 수밖에
     * 없는데 경합은 정확히 CR-05의 상태다(다른 호출자가 먼저 썼다).
     *
     * ★★ **이 코드가 `asset_prices.provider` 열의 첫 쓰기다.** 수동 입력은 그 열을
     * 채우지 않는다(`source = 'MANUAL'`이면 공급자가 없다) — 즉 「값이 있으면 자동」이
     * 데이터에서 참이 되고, 그것이 SCR-302가 원천을 말할 수 있는 근거다.
     */
    async writeQuote(row): Promise<WriteOutcome> {
      const { error } = await ctx.db.from('asset_prices').insert(
        toInsert('asset_prices', {
          asset_id: row.assetId,
          as_of_date: row.asOfDate,
          /*
           * ★ `toString()`이다 — `toFixed(n)`가 아니다. 후자는 자릿수를 **여기서**
           * 정하는데 그 값이 열의 스케일(`numeric(18,6)`)과 갈릴 수 있고, 자릿수가
           * 열보다 크면 반올림이 «두 번» 일어난다(여기서 한 번, Postgres가 또 한 번).
           * `decimal.ts`가 `toExpNeg/toExpPos`를 넓혀 둔 것이 정확히 이 직렬화를 위한
           * 것이다 — 기본값에서는 작은 값이 `1e-8`로 새어 문자열 규약을 깨뜨린다.
           */
          price: row.price.toString(),
          source: 'AUTO',
          provider: row.providerId,
        }),
      )

      if (error == null) return 'WRITTEN'
      if (error.code === '23505') return 'ALREADY_EXISTS'
      return { error: `${error.code ?? '-'} ${error.message}` }
    },
  }
}

/** DOC-002 §4.11 `cron_caller` — 「배치 라우트인가 화면 버튼인가」 */
export type CronCaller = 'BATCH' | 'MANUAL_REFRESH'

/**
 * ★★★ **수집의 «유일한» 구현** — §5.8과 §7.1이 이것의 두 투영이다.
 *
 * ## 왜 §5.8 «안»이 아니라 여기인가
 *
 * §5.8의 반환에는 `targetCount`가 없고(요청 자체가 시점이므로 화면이 그것을 쓰지 않는다)
 * §7.1의 `CronResult`에는 `assetName`이 없다(cron 응답에는 렌더할 화면이 없다). 즉
 * **한쪽이 다른 쪽의 부분집합이 아니다** — §5.8의 각주가 그것을 「공통 코어의 두 투영」이라
 * 부르고, 이 함수가 그 코어다.
 *
 * 라우트가 §5.8을 그대로 부르면 `targetCount`를 얻을 수 없고, §5.8이 `CronResult`를
 * 반환하면 계약이 화면에 필요 없는 필드를 싣는다. 그래서 **구현을 하나 두고 투영을 둘**
 * 둔다(`lib/cron/report.ts`).
 *
 * ★ **이것이 종전 미러의 대체물이다.** 종전에는 라우트가 §5.8의 «판정»을 베꼈고 문구가
 * 두 곳에 살았다. 지금은 **코드가 하나**이므로 갈릴 두 벌이 없다 — 「라우트가 §5.8을
 * 호출한다」보다 정확한 서술은 **「둘이 같은 구현을 호출한다」**다.
 *
 * ## `caller`에 기본값을 두지 않는다
 *
 * 두면 라우트가 그것을 빠뜨렸을 때 배치가 `MANUAL_REFRESH`로 기록되고, 그 거짓은
 * `cron_runs`를 읽는 시점에야 보인다(그때는 과거를 고칠 수 없다). 필수 인자면
 * **컴파일이 막는다.**
 */
export async function collectAndRecord(
  ctx: MutationContext,
  caller: CronCaller,
  deps: {
    startedAt: string
    finishedAt: () => string
    /**
     * ★ **레지스트리를 «인자»로 받는다 — 기본값이 정본이다.**
     *
     * 모듈 상수를 직접 읽으면 아래 두 갈래(0개 → 503 · 둘 이상 → 500)를 **상시 스위트가
     * 볼 수 없다.** 오늘 상수는 정확히 하나이므로 그 둘은 도달 불가이고, 그것을 보려면
     * 모듈을 mock해야 하는데 그러면 `PROVIDER_CREDENTIALS`까지 함께 가짜가 된다.
     *
     * 기본값을 두므로 **호출부는 이 인자를 모른다**(레지스트리가 두 곳에서 정해질 수
     * 없다). 테스트만 넘긴다 — 포트를 주입하는 것과 같은 형태다.
     */
    factories?: readonly ProviderFactory[]
  },
): Promise<ActionResult<CollectReport>> {
  const factories = deps.factories ?? PRICE_PROVIDERS

  if (factories.length === 0) {
    return failWith({
      code: 'PROVIDER_UNAVAILABLE',
      message: '시세 공급자가 등록되어 있지 않다. 수동 입력으로 갱신한다.',
    })
  }

  /*
   * ★ **둘 이상이면 «조용히» 첫 것을 쓰지 않는다.** 계획상 두 번째 공급자는 «대조»이고
   * (주 원천만 `asset_prices`에 쓴다) 그 처리는 P5a 컷 1c가 정의한다. 지금 `[0]`만
   * 쓰면 컷 1c의 등재가 **아무 일도 하지 않으면서 초록**이 되는데, 그것이 이 저장소가
   * 반복해서 잡아 온 형태다 — 「위반자가 0인 동안 보이지 않는다」의 시간축 버전.
   */
  if (factories.length > 1) {
    console.error(
      `[수집] 공급자가 ${factories.length}개 등재되었으나 대조 원천의 처리가 ` +
        '정의되지 않았다 (P5a 컷 1c). 주 원천만 쓰는 갈래를 명시하기 전까지 수집하지 않는다.',
    )
    return failWith({ code: 'INTERNAL', message: '처리 중 오류가 발생했다.' })
  }

  const factory = factories[0]!
  const provider = factory.create({})

  const report = await collectPrices({
    ports: makeCollectPorts(ctx, factory.id),
    provider,
    asOf: ctx.asOf,
    log: (message) => console.error(message),
  })

  await recordCronRun(ctx, {
    caller,
    startedAt: deps.startedAt,
    finishedAt: deps.finishedAt(),
    report,
  })

  return ok(report)
}

/**
 * `cron_runs` 한 행 — AQ-51, DOC-002 §4.11.
 *
 * ## 실패를 «값으로만» 남긴다 — 이 함수는 배치를 죽이지 않는다
 *
 * 관측 기록을 쓰지 못한 것은 수집 결과를 바꾸지 않는다. 여기서 던지면 **성공한 수집이
 * 500으로 보고되고**, 그러면 다음 실행이 같은 날짜를 다시 시도한다(CR-05가 `skipped`로
 * 흡수하므로 손해는 없지만 응답이 거짓이 된다). 그래서 삼키되 **삼킨 사실은 남긴다** —
 * `writableCookieAdapter`가 같은 판단을 한다.
 *
 * ★ **`actor_id`를 인자로 «받지 않는다» — `ctx.viewerId`다.** 정책이
 * `check (actor_id = (select auth.uid()))`이므로 다른 값을 넣으면 `42501`이 되어 위조가
 * 불가능하고, 인자로 두면 **호출부가 틀릴 수 있는 자리**가 하나 생긴다(그 오류는
 * 「권한 없음」으로 보고되어 원인이 멀어진다). 즉 이 열은 「누가 썼다고 주장하는가」가
 * 아니라 **「누가 썼는가」**다.
 *
 * ★★ **그런데 운영에서 그 답이 «판별하지 못한다» — AQ-69 (ⓐ′).**
 *
 * 배치가 **민서 자신의 계정**으로 로그인하므로 `actor_id`가 모든 행에서 같다. 위조
 * 불가성은 그대로이고 **가리키는 것이 바뀌었다** — 「누가」는 여전히 참이지만 그 답이
 * 언제나 한 사람이라 「배치인가 사람인가」를 가르지 못한다. 남는 것은 `caller`이며
 * **그것은 요청이 스스로 주장하는 값**이다(정책은 `actor_id`만 검사하므로 사람 세션에서
 * 그 값을 임의로 쓸 수 있다 — `tests/rls/cron-runs.test.ts`가 그 성질을 단언한다).
 *
 * **그래서 `caller`에 기본값을 두지 않는 것이 오늘의 유일한 방어다**(위 서명). 위협은
 * 악의가 아니라 **버그**이고 — 사용자가 하나다 — 필수 인자면 새 호출부가 그 값을
 * 「고르지 않을 수」 없다. 두 번째 쓰기 경로가 생기는 날 AQ-69를 다시 본다.
 *
 * ★★★ 그리고 **cron과 손으로 쏜 진단 `curl`은 ⓐ 아래에서도 구별되지 않았다** — 둘 다
 * 같은 토큰·같은 계정이다. ⓐ′가 그 공백을 **넓힌 것**이지 만든 것이 아니다.
 */
async function recordCronRun(
  ctx: MutationContext,
  run: {
    caller: CronCaller
    startedAt: string
    finishedAt: string
    report: CollectReport
  },
): Promise<void> {
  const { error } = await ctx.db.from('cron_runs').insert(
    toInsert('cron_runs', {
      actor_id: ctx.viewerId,
      caller: run.caller,
      outcome: outcomeOf(run.report),
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      target_count: run.report.targetCount,
      succeeded: run.report.succeeded,
      skipped: run.report.skipped,
      unmapped: run.report.unmapped,
      /*
       * `failed`는 §7.1이 형태를 소유한 **보고**이며 질의 대상 엔티티가 아니다
       * (그래서 14번째 테이블이 아니라 `jsonb`다 — DOC-002 §4.11).
       * `assetName`을 함께 싣는다: 기록을 읽는 시점에 그 자산이 지워졌을 수 있다.
       */
      failed: run.report.failed.map((f) => ({
        assetId: f.assetId,
        assetName: f.assetName,
        failure: f.failure,
        reason: f.reason,
      })),
    }),
  )

  if (error != null) {
    console.error(
      `[cron] 실행 기록을 남기지 못했다 — 수집 결과는 유효하다: ${error.code ?? '-'} ${error.message}`,
    )
  }
}
