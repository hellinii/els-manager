import { cache } from 'react'

import { cookies } from 'next/headers'

import { createSessionClient, readOnlyCookieAdapter } from './client'
import { today } from './today'
import { createQueries, type Queries } from './queries/context'

/**
 * Next 결선 — **`next`를 import하는 유일한 파일이다**(린트로 강제).
 *
 * 이 파일이 `tests/**`의 import 그래프에 들어가면 안 된다. `server-only`는
 * Vitest에서 해석되지 않으므로 그 패키지로는 막을 수 없고, 경계는 "테스트가
 * 이 파일을 import하지 않는다"는 사실 자체로 유지된다. 조회 계약은 전부
 * `createQueries(ctx)`를 통해 컨텍스트를 주입받으므로 테스트는 이 파일 없이
 * 계약 전체를 실행할 수 있다.
 */

/**
 * 요청당 한 번만 해석한다 — DOC-011 §4.0 Q-02.
 *
 * `cache()`는 React의 요청 스코프 메모이제이션이다. 두 계약이 각자 `today()`를
 * 부르면 **자정을 걸친 렌더에서 한 화면에 두 기준일이 생긴다.** `getUser()`도
 * GoTrue 왕복이므로 SCR-204처럼 계약 2개를 호출하는 화면에서 그대로 중복된다.
 */
const requestAsOf = cache((): string => today())

const requestQueries = cache(async (): Promise<Queries> => {
  // Next 16의 cookies()는 async다.
  const store = await cookies()
  const db = createSessionClient(
    readOnlyCookieAdapter(() => store.getAll()),
  )

  // getUser()는 토큰을 GoTrue에서 검증한다. getSession()은 쿠키를 그대로 믿으므로
  // 서버에서 신뢰 판단의 근거로 쓰지 않는다.
  const { data, error } = await db.auth.getUser()
  if (error != null || data.user == null) {
    // Q-04 — 미인증에서 조회 계약은 예외를 던진다. SCR-001 유도는 화면 층(P4)이다.
    throw new Error(
      '인증되지 않은 요청이다. 조회 계약은 로그인 세션을 요구한다 (DOC-011 §4.0 Q-04).',
    )
  }

  return createQueries({ db, asOf: requestAsOf(), viewerId: data.user.id })
})

/** 서버 컴포넌트·라우트에서 조회 계약을 얻는 유일한 경로. */
export function getQueries(): Promise<Queries> {
  return requestQueries()
}
