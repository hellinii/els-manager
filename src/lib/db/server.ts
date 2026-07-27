import { cache } from 'react'

import { cookies } from 'next/headers'

import {
  createSessionClient,
  readOnlyCookieAdapter,
  writableCookieAdapter,
} from './client'
import { today } from './today'
import {
  createMutations,
  createUnauthenticatedMutations,
  type Mutations,
} from './mutations/context'
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

/**
 * 변경 계약 — **미인증에서 던지지 않는다** (DOC-011 §5.0 W-03).
 *
 * 조회의 `getQueries()`와 대칭이 아닌 것이 의도다. 변경은 사용자가 입력을 들고
 * 있는 시점에 일어나므로, 예외로 전파해 에러 경계가 화면을 갈아치우면 **입력값이
 * 사라진다**(DOC-008 §6이 SCR-203·204에 "입력값 보존"을 요구한다). 대신 전 계약이
 * `UNAUTHENTICATED` 결과 객체를 주는 묶음을 돌려주고, 화면이 그 코드를 보고
 * SCR-001로 유도한다.
 *
 * 쿠키 어댑터도 조회와 다르다 — 서버 액션에서는 **쓸 수 있다**(`writableCookieAdapter`).
 */
const requestMutations = cache(async (): Promise<Mutations> => {
  const store = await cookies()
  const db = createSessionClient(
    writableCookieAdapter(
      () => store.getAll(),
      // 캐시 금지 헤더(두 번째 인자)는 여기서 실을 수 없다 — 서버 액션은 응답
      // 헤더에 접근하지 못한다. 허용되는 이유는 서버 액션 응답이 POST이고 Next가
      // 캐시하지 않기 때문이다. **Route Handler·미들웨어를 붙일 때는 반드시
      // 실어야 한다**(§7.1 배치, P4의 미들웨어 갱신).
      (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options)
        }
      },
    ),
  )

  // 조회와 같은 이유로 getSession()이 아니라 getUser()다 — 쿠키를 그대로 믿지 않는다.
  const { data, error } = await db.auth.getUser()
  if (error != null || data.user == null) return createUnauthenticatedMutations()

  // 기준일은 조회와 **같은 값**이다(W-02). `requestAsOf`를 공유하므로 한 요청 안에서
  // 조회가 본 오늘과 V-17이 거부하는 미래가 갈릴 수 없다.
  return createMutations({ db, asOf: requestAsOf(), viewerId: data.user.id })
})

/** 서버 액션에서 변경 계약을 얻는 유일한 경로. */
export function getMutations(): Promise<Mutations> {
  return requestMutations()
}
