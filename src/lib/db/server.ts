import { cache } from 'react'

import type { CookieMethodsServer } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { signIn, signOut } from '@/lib/auth/session'

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
import type { ActionResult } from './mutations/result'

/**
 * Next 결선 — `src/lib/db/**`에서 **`next`를 import하는 유일한 파일이다**(린트로 강제).
 *
 * 저장소 전체로는 `src/proxy.ts`가 둘째다(P4 ②). 그쪽은 이 글롭 밖이며
 * `@/lib/db/client`의 어댑터만 가져다 쓴다 — 경계를 넓히는 대신 위치로 지킨다.
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
/**
 * 서버 액션용 쿠키 어댑터 — 변경 계약과 인증이 공유한다.
 *
 * 두 곳이 각자 `cookies()` + `writableCookieAdapter` + `store.set` 루프를 쓰면
 * 같은 코드가 두 벌이 되고, 한쪽만 고쳐지는 날이 온다. `DB_NEXT_BOUNDARY`가
 * 한 파일인 것도 이 결선을 여기 모으기 때문이다.
 */
async function actionCookies(): Promise<CookieMethodsServer> {
  const store = await cookies()
  return writableCookieAdapter(
    () => store.getAll(),
    // 캐시 금지 헤더(두 번째 인자)는 여기서 실을 수 없다 — 서버 액션은 응답
    // 헤더에 접근하지 못한다. 허용되는 이유는 서버 액션 응답이 POST이고 Next가
    // 캐시하지 않기 때문이다. **Route Handler에서는 반드시 실어야 한다**
    // (§7.1 배치). 프록시는 `responseCookieAdapter`로 이미 싣는다.
    (cookiesToSet) => {
      for (const { name, value, options } of cookiesToSet) {
        store.set(name, value, options)
      }
    },
  )
}

/**
 * 로그인·로그아웃의 결선 — SCR-001 (DOC-011 §8).
 *
 * `cache()`를 쓰지 않는다. 조회·변경과 달리 요청당 한 번이 아니라 **정확히 그
 * 액션이 부를 때 한 번** 실행되어야 하고, 세션을 바꾸는 것이 목적이므로 결과를
 * 메모이제이션하면 같은 요청 안에서 바뀐 세션이 보이지 않는다.
 */
export async function getAuth(): Promise<{
  signIn: (params: { email: string; password: string }) => Promise<ActionResult<void>>
  signOut: () => Promise<ActionResult<void>>
}> {
  const adapter = await actionCookies()
  return {
    signIn: (params) => signIn(params, adapter),
    signOut: () => signOut(adapter),
  }
}

const requestMutations = cache(async (): Promise<Mutations> => {
  const db = createSessionClient(await actionCookies())

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
