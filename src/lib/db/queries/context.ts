import type { UserSessionClient } from '../client'
import { makeDashboardQueries } from './dashboard'
import { makeAssetQueries } from './prices'
import { makeProductQueries } from './products'
import { makeScheduleQueries } from './schedule'
import { makeTaxQueries } from './tax'

/**
 * 조회 컨텍스트 — DOC-011 §4.0
 *
 * §4.1~§4.9의 서명을 **문서 그대로** 유지하기 위해 컨텍스트를 인자로 노출하지
 * 않고 팩토리가 결속한다. 컨텍스트를 인자로 넘기면 화면이 계약을 호출할 때마다
 * 기준일·조회자를 직접 전달하게 되고, 그 순간 "요청당 한 번"(Q-02)이 구조가
 * 아니라 규율이 된다.
 */
export type QueryContext = {
  /** 로그인 사용자 세션. `service_role`을 쓰지 않는다 (Q-01) */
  db: UserSessionClient
  /** 기준일 `YYYY-MM-DD`, `Asia/Seoul` (Q-02) */
  asOf: string
  /** 조회자. `isOwner`·`isMe`·본인 판정의 기준 */
  viewerId: string
}

/**
 * 조회 계약 묶음 — 8개.
 *
 * §4.7 `getForecast`는 **의도적으로 없다** — `totalAssets`·`remainingPrincipal`의
 * 정의가 어느 문서에도 없다(DOC-011 §4.7). 부분 구현하면 화면이 빈 열을
 * 렌더링하게 되고, 두 값은 RD-02(기본 적용 차수, 미결)에 의존하므로 지금
 * 확정하면 그것이 닫힐 때 다시 손대게 된다. DOC-007 §7.5 신설이 선행 조건이다.
 */
export type Queries = ReturnType<typeof makeProductQueries> &
  ReturnType<typeof makeScheduleQueries> &
  ReturnType<typeof makeAssetQueries> &
  ReturnType<typeof makeTaxQueries> &
  ReturnType<typeof makeDashboardQueries>

export function createQueries(ctx: QueryContext): Queries {
  assertContext(ctx)

  return {
    ...makeProductQueries(ctx),
    ...makeScheduleQueries(ctx),
    ...makeAssetQueries(ctx),
    ...makeTaxQueries(ctx),
    ...makeDashboardQueries(ctx),
  }
}

/**
 * 미인증 예외 — Q-04.
 *
 * **`app/error.tsx`에서 이 클래스를 판별할 수 없다.** 에러 경계는 클라이언트
 * 컴포넌트이고 프로덕션에서 `Error`가 redact되어 메시지도 프로토타입도 남지
 * 않는다(`digest`만 온다). 그러니 경계에서 `instanceof`를 시도하지 않는다 —
 * 개발에서 동작하다가 운영에서 조용히 일반 오류로 격하된다.
 *
 * 그럼에도 타입을 두는 이유는 둘이다. ① 테스트가
 * `toThrow(/인증되지 않은/)` 같은 문구 정규식 대신 클래스를 단언할 수 있다
 * (P3b.5가 다른 곳에서 걷어낸 부류의 취약한 단언이다). ② 로그에서 grep된다.
 *
 * **미인증 요청은 정상적으로는 여기까지 오지 않는다** — `src/proxy.ts`가 먼저
 * `/login`으로 보낸다. 여기 도달했다면 프록시가 놓쳤다는 신호이므로(예: 갱신
 * 토큰 재사용이 렌더와 경합) 삼키지 않고 그대로 던진다.
 */
export class UnauthenticatedError extends Error {
  override readonly name = 'UnauthenticatedError'

  constructor() {
    super(
      '인증되지 않은 요청이다. 조회 계약은 로그인 세션을 요구한다 (DOC-011 §4.0 Q-04).',
    )
  }
}

/**
 * 세션 해석 결과 → 조회 계약 묶음. **`server.ts`에서 분리한 판단이다.**
 *
 * 그 파일은 `next`를 import하므로 어떤 스위트도 import할 수 없고(AQ-23), 그
 * 안에 있던 이 두 줄 — 미인증이면 던지고 아니면 결속한다 — 은 **한 번도
 * 실행되지 않았다.** 결선(쿠키 해석·`getUser()` 왕복)만 그쪽에 남기고 판단을
 * 여기로 옮기면 상시 스위트가 두 갈래를 전부 본다.
 */
export function queriesFor(
  user: { id: string } | null,
  ctx: Omit<QueryContext, 'viewerId'>,
): Queries {
  if (user == null) throw new UnauthenticatedError()
  return createQueries({ ...ctx, viewerId: user.id })
}

/**
 * 컨텍스트 자체의 전제를 확인한다.
 *
 * Q-04(미인증 시 예외)는 `server.ts`가 세션을 해석하는 지점에서 이미 걸리지만,
 * 계약을 직접 조립하는 테스트·배치 경로가 빈 `viewerId`를 넘기면 **모든
 * `isOwner`가 `false`가 되고 `getTaxSummary`가 남의 것을 본인으로 오인**할 수
 * 있다. 조용히 틀리는 대신 조립 시점에 던진다.
 */
function assertContext(ctx: QueryContext): void {
  if (ctx.viewerId.trim() === '') {
    throw new Error(
      '조회자(viewerId)가 없다. 조회 계약은 로그인 세션을 요구한다 (DOC-011 §4.0 Q-04).',
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.asOf)) {
    throw new Error(
      `기준일이 YYYY-MM-DD 형식이 아니다: ${ctx.asOf} (DOC-011 §4.0 Q-02).`,
    )
  }
}
