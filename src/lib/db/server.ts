import { cache } from 'react'

import type { CookieMethodsServer } from '@supabase/ssr'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { signIn, signOut } from '@/lib/auth/session'

import {
  createSessionClient,
  readOnlyCookieAdapter,
  writableCookieAdapter,
} from './client'
import { today } from './today'
import { mutationsFor, type Mutations } from './mutations/context'
import { queriesFor, type Queries } from './queries/context'
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

  // 판단은 `queriesFor`에 있다 — 이 파일은 테스트 그래프 밖이므로(AQ-23) 여기에
  // 분기를 두면 그것만 미검증으로 남는다. 남는 것은 결선뿐이다.
  return queriesFor(error != null ? null : data.user, { db, asOf: requestAsOf() })
})

/** 서버 컴포넌트·라우트에서 조회 계약을 얻는 유일한 경로. */
export function getQueries(): Promise<Queries> {
  return requestQueries()
}

/**
 * 기준일 — 화면이 읽는다 (P4 컷 1b).
 *
 * **계약이 아니라 프레임워크 배선이다.** DOC-011은 변경되지 않는다 — `asOf`는
 * 이미 두 컨텍스트에 있고(§4.0 Q-02, §5.0 W-02) 여기서 내보내는 것은 같은
 * `cache()`의 값이다. 화면에 필요한 이유가 검증 규칙에 있다: V-17이
 * `asOfDate ≤ 기준일`을 요구하므로 시세 입력의 `max`와 기본값이 **계약이 보는
 * 것과 같은 날**이어야 하고, SCR-203의 상환일 기본값도 오늘이다.
 *
 * 화면이 `today()`를 직접 부르면 요청당 한 번이라는 규약이 깨진다 — KST
 * 00:00~09:00에 화면이 내놓은 기본값이 계약에 거부되는 창이 생긴다(Q-02의 9시간).
 */
export function getAsOf(): string {
  return requestAsOf()
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

  // 기준일은 조회와 **같은 값**이다(W-02). `requestAsOf`를 공유하므로 한 요청 안에서
  // 조회가 본 오늘과 V-17이 거부하는 미래가 갈릴 수 없다.
  return withInvalidation(
    mutationsFor(error != null ? null : data.user, {
      db,
      asOf: requestAsOf(),
    }),
  )
})

/** 서버 액션에서 변경 계약을 얻는 유일한 경로. */
export function getMutations(): Promise<Mutations> {
  return requestMutations()
}

/**
 * 무효화 — **묶음을 감싼다. 계약마다 부르지 않는다** (계획 §8)
 *
 * 대안은 화면별 어댑터가 성공 뒤에 `revalidatePath`를 부르는 것인데, 그러면 호출
 * 지점이 열한 곳으로 흩어지고 **빠뜨려도 아무것도 실패하지 않는다** — 증상은
 * "저장했는데 화면이 그대로"이고 원인이 계약인지 캐시인지 구분되지 않는다.
 * 여기서 감싸면 `getMutations()`를 지나는 모든 경로가 자동으로 지나며,
 * `src/app/actions.ts`는 문자 그대로 위임만 남는다.
 *
 * **실패에는 무효화하지 않는다.** 검증 거부는 왕복이 0이므로(§5.0.1 실측) 바뀐
 * 것이 없고, 지워야 할 것도 없다.
 */
function withInvalidation(mutations: Mutations): Mutations {
  const wrapped = Object.fromEntries(
    Object.entries(mutations).map(([name, fn]) => [
      name,
      async (...args: unknown[]) => {
        const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args)
        // `ActionResult`는 전 계약의 반환 형태다(§3.1). `ok`가 참일 때만 지운다.
        if ((result as { ok?: boolean }).ok === true) invalidate()
        return result
      },
    ]),
  )

  // 키 집합과 인자·반환은 그대로이므로 형태가 같다. `Object.entries`가 그 사실을
  // 타입으로 보이지 못하는 것뿐이며, 키 전수는 `INVALIDATION`의 `Record`가 잡는다.
  return wrapped as unknown as Mutations
}

/**
 * **한 줄이다. 실측이 그렇게 정했다** (컷 1b — `lib/routes/invalidation.ts`의 표)
 *
 * 계획은 계약별 경로 목록을 여기서 순회하는 것이었다. 네 경우를 실측하니 **세
 * 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이 전부 같았다** — 액션
 * 응답도, 새 문서 GET도, RSC 페이로드도 늘 최신이다. 서버에 지울 것이 없기
 * 때문이다(모든 데이터 화면이 `cookies()`를 지나 동적이고 Supabase 요청은
 * `cache: 'no-store'`다).
 *
 * 대조군이 초록인 것이 실험 실패가 아님을 로그로 확인했다 — 정확한 설정은 일곱
 * 경로를, 대조군은 `/tax` 하나를 실제로 불렀다. 인자는 달랐고 관측은 같았다.
 *
 * 남는 소비자는 **클라이언트 라우터 캐시**이고 그것은 브라우저 안이라 우리가 가진
 * 어느 층도 보지 못한다(AQ-32). 세분화의 유일한 위험은 **부족하게 지우는 것**이며,
 * 정확성을 확인할 방법이 없는 손으로 적은 목록에 그것을 의존하는 대신 구조적으로
 * 부족할 수 없는 형태를 고른다 — 루트 레이아웃 하나면 그 아래 전부가 지워진다.
 *
 * 「무엇이 왜 낡는가」는 사라지지 않았다. `INVALIDATION.affects`와 `ROUTE_QUERIES`가
 * 그 지식을 데이터로 들고 있고 상시 스위트가 문서와 대조한다. 어느 라우트가
 * 캐시 가능해지는 날(`'use cache'`·정적 렌더) `staleRoutesFor()`가 그 입력이 된다.
 */
function invalidate(): void {
  revalidatePath('/', 'layout')
}
