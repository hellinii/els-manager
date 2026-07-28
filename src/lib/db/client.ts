import {
  createServerClient,
  type CookieMethodsServer,
  type CookieOptions,
} from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database.types'

import { supabaseEnv } from './env'

/**
 * DB 클라이언트 — DOC-011 §4.0 Q-01
 *
 * **`service_role`을 만들지 않는다.** 편의로도 쓰지 않는다 — 한 번 우회 경로를
 * 만들면 RLS 정책 32개가 실제로 작동하는지 그 뒤의 어떤 초록색도 증명하지
 * 못한다. 이 파일에 그 키를 받는 인자가 없는 것이 그 규약의 이행이다.
 *
 * **Next를 import하지 않는다**(린트로 강제). `next/headers` 결선은 `server.ts`
 * 하나에만 두고, 이 파일은 쿠키 어댑터를 **주입받는다** — 그래서 조회 계층 전체가
 * 프레임워크 없이 테스트 가능하다.
 */

export type UserSessionClient = SupabaseClient<Database>

/**
 * 결과가 조회자에 의존하므로 캐싱 기본값에 맡기지 않는다.
 *
 * 모든 조회 정책이 `authenticated`를 대상으로 하되 `tax_profiles`를 제외하면
 * `using (true)`이므로, 응답 본문 자체는 사용자 간에 같을 수 있다. 그러나
 * `isOwner`·`isMe`·`getTaxSummary`처럼 **조회자에 따라 달라지는 계약**이 있고,
 * 프레임워크나 런타임의 fetch 캐싱 기본값이 바뀌면 A의 응답이 B에게 나갈 수
 * 있다. AQ-02(캐싱 전략)가 미결인 동안 당면 위험만 구조로 막는다.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' })

/**
 * 액세스 토큰을 직접 들고 조회하는 클라이언트.
 *
 * 헤더를 손으로 주입하지 않고 supabase-js의 `accessToken` 옵션을 쓴다 — 그
 * 옵션이 REST·Realtime·Storage 전부에 토큰을 일관되게 싣는 공식 경로이고,
 * `global.headers`에 `Authorization`을 박으면 라이브러리가 자체 세션을 얻는
 * 순간 두 출처가 경합한다.
 *
 * **이 클라이언트에서 `.auth`는 던진다.** `accessToken`을 주면 supabase-js가
 * `auth`를 접근 즉시 예외를 내는 Proxy로 대체한다(SupabaseClient.ts). 따라서
 * `getUser()`가 필요한 경로는 `createSessionClient`를 쓴다. 이 사실을 모르고
 * 두 용도를 겸하면 런타임에서만 드러난다.
 */
export function createTokenClient(token: string): UserSessionClient {
  const { url, anonKey } = supabaseEnv()

  if (token.trim() === '') {
    throw new Error('빈 액세스 토큰으로 클라이언트를 만들 수 없다.')
  }

  return createClient<Database>(url, anonKey, {
    accessToken: async () => token,
    global: { fetch: noStoreFetch },
  })
}

/**
 * 쿠키 기반 세션 클라이언트 (`@supabase/ssr`).
 *
 * 어댑터를 주입받는다 — Next의 `cookies()`를 여기서 부르면 이 파일이
 * 프레임워크에 묶이고, 그러면 세션 왕복을 DB만 있는 환경에서 검증할 수 없다.
 */
export function createSessionClient(
  cookies: CookieMethodsServer,
): UserSessionClient {
  const { url, anonKey } = supabaseEnv()

  return createServerClient<Database>(url, anonKey, {
    cookies,
    global: { fetch: noStoreFetch },
  })
}

/**
 * 서버 컴포넌트용 쿠키 어댑터를 만든다.
 *
 * **`setAll`이 던지는 것은 정상이다.** 서버 컴포넌트 렌더 중에는 응답 헤더가
 * 이미 확정되어 쿠키를 쓸 수 없고, Next가 예외를 던진다. 삼키지 않으면 토큰
 * 갱신이 일어나는 **첫 요청에서 전 화면이 500**이 된다 — 갱신은 `jwt_expiry`
 * (1시간) 뒤에 처음 발생하므로 개발 중에는 보이지 않다가 운영에서 드러난다.
 *
 * 그래서 무연산으로 삼키되, **삼킨 사실 자체는 남긴다** — 갱신된 토큰이
 * 저장되지 않으면 다음 요청이 다시 갱신하므로, 이 경로가 상시로 도는 것은
 * 미들웨어 갱신(P4 선행 조건)이 없다는 신호다.
 */
export function readOnlyCookieAdapter(
  getAll: CookieMethodsServer['getAll'],
): CookieMethodsServer {
  return {
    getAll,
    setAll() {
      // 무연산. 서버 컴포넌트에서는 쿠키를 쓸 수 없다.
    },
  }
}

/**
 * 서버 액션용 쿠키 어댑터 — **쓸 수 있다.**
 *
 * 조회의 무연산 어댑터와 다른 것이 요점이다. 서버 액션은 응답 헤더가 확정되기
 * 전에 실행되므로 Next가 쿠키 쓰기를 허용하고, 그래서 **변경 경로가 토큰 갱신을
 * 실제로 저장하는 유일한 자리**다. 조회만 무연산이면 갱신된 토큰이 어디에도
 * 남지 않아 매 요청이 다시 갱신한다(미들웨어가 없는 동안, P4 선행 조건).
 *
 * **쓰기 실패로 변경을 죽이지 않는다.** 여기까지 왔다면 DB 조작은 이미 끝났고,
 * 쿠키를 저장하지 못한 결과는 "다음 요청이 토큰을 다시 갱신한다"일 뿐이다. 그
 * 대가로 사용자의 저장을 실패로 보고하면 손해가 훨씬 크다 — 그러나 **삼킨 사실은
 * 남긴다.** 이 경로가 상시로 도는 것은 결선이 잘못됐다는 신호다.
 *
 * ## `headers`를 버리지 않고 넘긴다
 *
 * `setAll`의 두 번째 인자는 라이브러리가 요구하는 캐시 금지 헤더다
 * (`Cache-Control: private, no-store …`). **인증 쿠키를 싣는 응답이 캐시되면 한
 * 사용자의 세션 토큰이 다른 사용자에게 나갈 수 있다** — AQ-02가 미결인 동안
 * `noStoreFetch`로 막아 둔 것과 같은 부류의 위험이며, 이쪽은 우리가 보내는
 * 응답이라 더 직접적이다.
 *
 * 서버 액션에서는 응답 헤더를 `cookies()`로 설정할 수 없다. 그것이 허용되는
 * 이유는 서버 액션 응답이 POST이고 Next가 캐시하지 않기 때문이지, 헤더가
 * 불필요해서가 아니다 — **Route Handler·미들웨어에서는 반드시 실어야 한다.**
 * 그래서 어댑터는 두 인자를 그대로 전달하고, 헤더를 어떻게 할지는 주입하는
 * 쪽이 정한다. 여기서 인자를 삼키면 그 결정이 사라진다.
 */
export function writableCookieAdapter(
  getAll: CookieMethodsServer['getAll'],
  setAll: NonNullable<CookieMethodsServer['setAll']>,
): CookieMethodsServer {
  return {
    getAll,
    setAll(cookiesToSet, headers) {
      try {
        setAll(cookiesToSet, headers)
      } catch (error) {
        console.error(
          '[auth] 서버 액션에서 세션 쿠키를 저장하지 못했다 — 갱신된 토큰이 유실된다. ' +
            `변경 자체는 이미 수행되었으므로 실패로 보고하지 않는다: ${String(error)}`,
        )
      }
    },
  }
}

/**
 * 쿠키와 헤더를 받아 두는 곳. 프레임워크 무관.
 *
 * `applyTo`가 받는 응답의 최소 형태이며, `NextResponse`가 구조적으로 만족한다.
 * `next`를 import하지 않으려고 명목 타입 대신 이 형태를 쓴다.
 */
export type ResponseLike = {
  cookies: { set(name: string, value: string, options: CookieOptions): unknown }
  headers: { set(name: string, value: string): unknown }
}

export type CookieSink = {
  setCookie(name: string, value: string, options: CookieOptions): void
  setHeader(name: string, value: string): void
}

export type CookieAccumulator = {
  sink: CookieSink
  /** 모아 둔 쿠키·헤더를 응답에 옮기고 누산기를 봉인한다. 같은 응답을 돌려준다. */
  applyTo<R extends ResponseLike>(response: R): R
}

/**
 * 쿠키·헤더를 모아 두었다가 **한 지점에서** 응답으로 옮긴다.
 *
 * ## 왜 바로 응답에 쓰지 않는가
 *
 * `@supabase/ssr`의 `setAll`은 `await getUser()` **도중** 발화한다(갱신이
 * 일어날 때). 프록시가 그때 응답 A에 쓰고 나서 판정 결과로 리다이렉트 응답 B를
 * 만들면 **A의 쿠키와 헤더가 통째로 사라진다.** 미인증 경로에서 특히 나쁘다 —
 * 갱신 실패는 삭제 쿠키(`value: ''`)를 내보내는데 그것을 잃으면 브라우저가
 * 죽은 쿠키를 계속 보내고 매 요청이 실패할 갱신을 다시 시도한다.
 *
 * 순서를 기억하는 대신 **기억할 필요가 없게** 만든다. 발화 시점에는 누산기에
 * 쌓이고, 어느 응답으로 끝날지 정해진 뒤에 `applyTo` 한 번이 옮긴다.
 *
 * ## 봉인
 *
 * `applyTo` 이후의 쓰기는 갈 곳이 없다. 조용히 버리면 이 클래스의 결함이 다시
 * "쿠키가 가끔 사라진다"로 나타나므로 **남긴다.** 응답을 이미 보낸 뒤이므로
 * 던지지는 않는다 — 던지면 이미 성공한 요청을 500으로 바꾼다.
 */
export function createCookieAccumulator(): CookieAccumulator {
  const cookies: { name: string; value: string; options: CookieOptions }[] = []
  const headers = new Map<string, string>()
  let sealed = false

  const warnIfSealed = (what: string): boolean => {
    if (!sealed) return false
    console.error(
      `[auth] applyTo() 이후에 ${what} 쓰기가 도착했다 — 응답이 이미 확정되어 유실된다. ` +
        'setAll이 발화하는 시점보다 applyTo가 앞서 불렸다는 뜻이다.',
    )
    return true
  }

  return {
    sink: {
      setCookie(name, value, options) {
        if (warnIfSealed(`쿠키 '${name}'`)) return
        cookies.push({ name, value, options })
      },
      setHeader(name, value) {
        if (warnIfSealed(`헤더 '${name}'`)) return
        headers.set(name, value)
      },
    },

    applyTo(response) {
      for (const { name, value, options } of cookies) {
        response.cookies.set(name, value, options)
      }
      for (const [name, value] of headers) {
        response.headers.set(name, value)
      }
      sealed = true
      return response
    },
  }
}

/**
 * 응답 객체를 들고 있는 곳(프록시·Route Handler)용 쿠키 어댑터.
 *
 * 세 어댑터 중 **헤더를 실제로 싣는 유일한 것**이다. 서버 컴포넌트는 응답
 * 헤더가 이미 확정되었고(`readOnlyCookieAdapter`), 서버 액션은 응답 헤더에
 * 접근하지 못한다(`writableCookieAdapter`의 주입부). 프록시만 둘 다 할 수 있고,
 * 그래서 P4 선행 조건 ②와 ④가 같은 파일에서 닫힌다(DOC-000 §3).
 *
 * **`writableCookieAdapter`에 위임한다.** 삼키고-로그하는 규약이 두 벌이 되면
 * 한쪽만 고쳐지는 날이 온다. 여기가 그 함수의 docblock이 말한 "주입하는 쪽"이며,
 * 그쪽이 넘겨준 `headers`를 버리지 않는 것이 이 함수의 존재 이유다.
 *
 * 라이브러리는 **쓸 것이 있을 때만** 발화하고(`cookies.js:425`) 그때 세 헤더를
 * 함께 준다 — `Cache-Control: private, no-cache, no-store, must-revalidate,
 * max-age=0` · `Expires: 0` · `Pragma: no-cache`. 브라우저 저장소 경로의 두
 * 호출부는 `{}`를 주므로(`:240`·`:293`) 헤더 루프가 0회 도는 것도 정상이다.
 */
export function responseCookieAdapter(
  getAll: CookieMethodsServer['getAll'],
  sink: CookieSink,
): CookieMethodsServer {
  return writableCookieAdapter(getAll, (cookiesToSet, headers) => {
    for (const { name, value, options } of cookiesToSet) {
      sink.setCookie(name, value, options)
    }
    for (const [name, value] of Object.entries(headers)) {
      sink.setHeader(name, value)
    }
  })
}
