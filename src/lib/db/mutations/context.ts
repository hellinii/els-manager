import type { UserSessionClient } from '../client'
import { makeAssetMutations } from './assets'
import { makePriceMutations } from './prices'
import { makeProductMutations } from './products'
import { makeProfileMutations } from './profile'
import { makeRedemptionMutations } from './redemptions'
import { unauthenticated } from './result'

/**
 * 변경 컨텍스트 — DOC-011 §5.0
 *
 * 조회(§4.0)와 **같은 세 값**이며 이름도 같다. 그래서 `queries/load.ts`의 로더를
 * 그대로 재사용할 수 있다 — 사전 조회를 위해 별도 경로를 쓰면 조회 계약과 변경
 * 계약이 서로 다른 열·다른 기준일로 같은 상품을 보게 된다.
 *
 * | ID | 규약 |
 * |---|---|
 * | W-01 | 사용자 세션으로만 수행한다. `service_role`을 쓰지 않는다 |
 * | W-02 | 기준일은 조회와 같은 값 — V-17이 이것을 요구한다 |
 * | W-03 | 미인증은 예외가 아니라 `UNAUTHENTICATED` 결과 객체다 |
 * | W-04 | 금액·비율은 문자열로 보낸다 (`payload.ts`) |
 * | W-05 | 소유권은 RLS가 강제하고 계약은 사전 조회로 오류를 구분한다. 그리고 **영향 행 수를 확인한다** |
 */
export type MutationContext = {
  /** 로그인 사용자 세션. `service_role`을 쓰지 않는다 (W-01) */
  db: UserSessionClient
  /** 기준일 `YYYY-MM-DD`, `Asia/Seoul` (W-02) */
  asOf: string
  /** 변경자. `owner_id` 설정·소유자 판정의 기준 */
  viewerId: string
}

/** §5.1~§5.10의 계약 11개 (§5.5가 두 개다) */
export type Mutations = ReturnType<typeof makeProductMutations> &
  ReturnType<typeof makeRedemptionMutations> &
  ReturnType<typeof makeProfileMutations> &
  ReturnType<typeof makePriceMutations> &
  ReturnType<typeof makeAssetMutations>

export function createMutations(ctx: MutationContext): Mutations {
  assertContext(ctx)

  return {
    ...makeProductMutations(ctx),
    ...makeRedemptionMutations(ctx),
    ...makeProfileMutations(ctx),
    ...makePriceMutations(ctx),
    ...makeAssetMutations(ctx),
  }
}

/**
 * 미인증 — W-03. **던지지 않는다.**
 *
 * 조회는 미인증에서 예외를 던지지만(§4.0 Q-04) 변경은 결과 객체를 준다. 대칭이
 * 아닌 것이 의도다 — 변경은 사용자가 **입력을 들고 있는 시점**에 일어나므로,
 * 예외로 전파해 에러 경계가 화면을 갈아치우면 입력값이 사라진다(DOC-008 §6이
 * SCR-203·204에 "입력값 보존"을 요구한다). 조회에는 보존할 입력이 없다.
 *
 * **각 계약을 손으로 적는다.** `Object.fromEntries`로 만들면 반환 타입을 단언해야
 * 하고, 그 순간 계약이 하나 늘어도 여기가 조용히 낡는다 — 화면은 그 계약을
 * 호출하는데 미인증 객체에는 없어서 `undefined is not a function`이 된다.
 * 아래 형태는 키가 빠지면 **컴파일이 실패한다.**
 */
export function createUnauthenticatedMutations(): Mutations {
  return {
    createProduct: async () => unauthenticated(),
    updateProduct: async () => unauthenticated(),
    deleteProduct: async () => unauthenticated(),
    setKiTouched: async () => unauthenticated(),
    createRedemption: async () => unauthenticated(),
    updateRedemption: async () => unauthenticated(),
    deleteRedemption: async () => unauthenticated(),
    saveTaxProfile: async () => unauthenticated(),
    saveManualPrice: async () => unauthenticated(),
    refreshPrices: async () => unauthenticated(),
    createAsset: async () => unauthenticated(),
  }
}

/**
 * 컨텍스트 자체의 전제를 확인한다 — 조회의 `assertContext`와 같은 이유이며
 * 쓰기에서는 더 무겁다. 빈 `viewerId`로 조립되면 **모든 소유자 판정이 실패**해
 * 본인 상품에도 `FORBIDDEN`이 나오고, 기준일이 깨지면 V-17이 정상 시세를 거부한다.
 */
function assertContext(ctx: MutationContext): void {
  if (ctx.viewerId.trim() === '') {
    throw new Error(
      '변경자(viewerId)가 없다. 변경 계약은 로그인 세션을 요구한다 (DOC-011 §5.0 W-01). ' +
        '미인증 경로는 createUnauthenticatedMutations()다 — 이 함수를 빈 값으로 부르지 않는다.',
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.asOf)) {
    throw new Error(
      `기준일이 YYYY-MM-DD 형식이 아니다: ${ctx.asOf} (DOC-011 §5.0 W-02).`,
    )
  }
}
