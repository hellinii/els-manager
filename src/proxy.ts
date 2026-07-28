import { NextResponse, type NextRequest, type ProxyConfig } from 'next/server'

import {
  createCookieAccumulator,
  createSessionClient,
  responseCookieAdapter,
} from '@/lib/db/client'

/**
 * 세션 갱신 — P4 선행 조건 ②·④ (DOC-000 §3)
 *
 * ## `middleware.ts`가 아니라 `proxy.ts`인 이유
 *
 * Next 16이 파일 규약을 바꿨다. 실측(`next` 16.2.12):
 * `PROXY_FILENAME = 'proxy'`(`dist/lib/constants.js:289`), `middleware` 규약은
 * deprecated이며(`dist/build/index.js:651`) **두 파일이 함께 있으면 빌드
 * 에러**다(`:645`). 내보내기 이름도 파일명을 따른다 —
 * `handlerUserland = (isProxy ? mod.proxy : mod.middleware) || mod.default`
 * (`dist/build/templates/middleware.js`). 그래서 `export function proxy`다.
 *
 * **`export const runtime`을 쓰지 않는다.** 프록시는 항상 Node.js 런타임에서
 * 돌고, 세그먼트 설정을 두면 프로덕션 빌드가 던진다(`Route segment config is
 * not allowed in Proxy file`, `dist/build/analysis/get-page-static-info.js:587`).
 *
 * 그 강제가 위험 하나를 없앴다. 구 Edge 런타임이었다면 `lib/db/env.ts`의
 * `process.env[name]`이 **계산된 멤버 접근이라 define 플러그인이 인라인하지
 * 못해** 요청 시점에 던졌을 것이고, 프록시는 전 경로에 걸리므로 앱 전체가
 * 죽었을 것이다.
 *
 * ## 무엇을 하는가 (컷 0a 범위)
 *
 * 토큰 갱신과 그 결과(쿠키 + 캐시 금지 헤더)를 응답에 싣는 것까지다.
 * **미인증 리다이렉트는 아직 없다** — `/login`이 없는 상태에서 켜면 전 경로가
 * 404로 가고, 그것은 동작하는 상태가 아니다(R-05). 컷 0b에서 SCR-001과 함께 켠다.
 *
 * ## 왜 프록시여야 하는가
 *
 * `jwt_expiry = 3600`이므로 토큰은 한 시간 뒤 처음 갱신된다. 서버 컴포넌트의
 * 어댑터는 무연산이라(`readOnlyCookieAdapter`) 갱신분을 저장하지 못하고, 쓰기
 * 가능 어댑터는 서버 액션 경로에만 있다 — **조회만 하는 화면에서는 갱신된
 * 토큰이 영원히 저장되지 않는다.** 개발 중 한 시간 안에는 보이지 않다가 운영에서
 * 드러난다. 응답 객체를 들고 있는 곳은 여기뿐이므로 ②와 ④가 같은 파일에서 닫힌다.
 *
 * ## `getUser()`가 요청당 두 번이 된다
 *
 * 여기서 한 번, `lib/db/server.ts`의 `cache()`에서 한 번. React의 요청
 * 메모이제이션은 프록시 경계를 건너지 못한다(DOC-011 §4.0에 등재).
 *
 * **프록시의 판정을 요청 헤더로 내려보내 합치지 않는다.** 그것은 위조 가능한
 * 신뢰 채널이고, `server.ts`가 `getSession()`이 아니라 `getUser()`를 쓰는 이유가
 * 정확히 "클라이언트가 준 주장을 믿지 않는다"이다. 비용을 줄이려고 그 전제를
 * 깨면 Q-01이 형식만 남는다.
 *
 * ## 실측 (컷 0a)
 *
 * **① 환경변수가 없으면 여기서 던지고, 그러면 전 경로가 500이다.**
 * `supabaseEnv()`가 부재를 즉시 거부하므로(`lib/db/env.ts`) 프록시가 그것을
 * 전 요청으로 확대한다 — 페이지였다면 그 페이지만 죽었을 것이다. **삼키지
 * 않는다:** 결정적이고(첫 요청부터 100%) 메시지가 변수명과 고치는 법을 지목하며,
 * 삼키면 앱이 도는 것처럼 보이면서 세션이 영원히 갱신되지 않는다 — ②가 막으려던
 * 바로 그 상태다. 구성 오류를 런타임 조건처럼 다루지 않는다.
 *
 * **② 세션 없는 요청에서는 아무것도 싣지 않는다.** `next start`로 확인했다 —
 * `GET /` → 200, `set-cookie` 없음, 캐시 금지 헤더 없음. 갱신할 것이 없으면
 * 라이브러리가 `setAll`을 발화시키지 않으므로(`cookies.js:425`) 누산기가 비어
 * 있고 응답이 그대로 나간다. 갱신이 없는 요청이 대부분이므로 이것이 정상 경로다.
 *
 * **③ ④의 위험을 관측했다.** 같은 요청의 응답이
 * `Cache-Control: s-maxage=31536000`을 달고 나온다(정적 프리렌더). 지금은
 * 쿠키를 싣지 않으므로 무해하지만, **캐시 금지 헤더 없이 쿠키만 실었다면
 * 한 사용자의 `Set-Cookie`를 단 응답이 1년짜리 공유 캐시에 들어간다.** ④가
 * 가정이 아니라 이 응답에 실재하는 조건임을 보여준다.
 *
 * **미측정:** Supabase 도달 불가 시 `getUser()`가 던지는지. 쿠키가 없으면
 * 네트워크에 닿기 전에 `AuthSessionMissingError`로 끊겨 대조가 성립하지
 * 않았다 — 실세션이 생기는 컷 0b에서 측정한다.
 */

export const config: ProxyConfig = {
  matcher: [
    /*
     * 정적 자산과 `api/cron`을 제외한 전 경로.
     *
     * **`api/cron` 제외는 P5 관심사가 지금 표면화한 것이다.** 컷 0b에서
     * 리다이렉트를 켜면 Vercel Cron이 `/login`으로 307을 받고 DOC-011 §7.1의
     * CR-01(토큰 불일치 시 401)이 **영원히 실행되지 않는다.** 배치가 조용히
     * 죽는 종류이므로 예외를 미리, 사유와 함께 좁게 열어 둔다 —
     * `tests/db/no-service-role.test.ts:28`이 같은 경로를 같은 이유로 이미
     * 열어 둔 선례가 있다.
     *
     * **`/login`은 제외하지 않는다.** 만료 직전 토큰을 들고 로그인 화면에 온
     * 사용자도 갱신되어야 하고, 이미 인증된 사용자를 `/`로 돌려보내는 판단은
     * 프록시만 할 수 있다(컷 0b). 매처에서 빼면 그 경우가 보이지 않는다.
     *
     * 서버 액션 POST는 페이지 URL로 가므로 이 매처에 걸린다 — 변경 경로에도
     * 갱신이 미친다.
     */
    '/((?!_next/static|_next/image|api/cron|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  /*
   * 쿠키·헤더를 바로 응답에 쓰지 않고 누산기에 모은다.
   *
   * `setAll`은 아래 `getUser()` **도중** 발화한다. 그때 만들어 둔 응답에 쓰고
   * 나서 판정 결과로 다른 응답을 만들면(컷 0b의 리다이렉트) 쿠키와 헤더가 통째로
   * 사라진다. 갱신 실패는 삭제 쿠키를 내보내므로 그것을 잃는 쪽이 더 나쁘다 —
   * 브라우저가 죽은 쿠키를 계속 보내고 매 요청이 실패할 갱신을 다시 시도한다.
   *
   * 순서를 기억하는 대신 기억할 필요가 없게 만든다. 이전 지점이 정확히 하나다.
   */
  const accumulated = createCookieAccumulator()

  const db = createSessionClient(
    responseCookieAdapter(() => request.cookies.getAll(), accumulated.sink),
  )

  // 반환값을 쓰지 않는다 — 컷 0a의 목적은 **갱신을 일으키고 그 결과를 싣는 것**
  // 뿐이다. 만료 마진(auth-js `EXPIRY_MARGIN_MS`, 90초) 안이면 이 호출이 갱신을
  // 유발하고 `setAll`이 발화한다. 판정에 쓰는 것은 컷 0b부터다.
  await db.auth.getUser()

  return accumulated.applyTo(NextResponse.next())
}
