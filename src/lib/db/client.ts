import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
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
