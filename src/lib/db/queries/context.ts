import type { UserSessionClient } from '../client'

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
 * 조회 계약 묶음.
 *
 * 계약은 P4 화면 순서로 하나씩 추가된다 — 각 커밋이 동작하는 상태여야 하므로
 * (CLAUDE.md 작업 방식) 여기에 선언된 것은 전부 구현되어 있다.
 *
 * §4.7 `getForecast`는 **의도적으로 없다** — `totalAssets`·`remainingPrincipal`의
 * 정의가 어느 문서에도 없어 P3a 범위 밖이다(DOC-011 §4.7, D8).
 */
export type Queries = Record<never, never>

export function createQueries(ctx: QueryContext): Queries {
  assertContext(ctx)
  return {}
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
