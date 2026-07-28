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
 * ## 무엇을 하는가
 *
 * ① 토큰 갱신과 그 결과(쿠키 + 캐시 금지 헤더)를 응답에 싣는다 — 컷 0a.
 * ② 세션 유무로 `/login`과 나머지를 가른다 — 컷 0b(SCR-001이 선 뒤에 켰다.
 * 없는 상태에서 켜면 전 경로가 404로 가고 그것은 동작하는 상태가 아니다, R-05).
 *
 * ## 리다이렉트를 프록시가 하는 이유
 *
 * DOC-008 SCR-001의 진입 조건이 "미인증 상태에서 **모든 경로** 접근 시"다 —
 * 그것은 매처이지 화면별 관심사가 아니다. 그리고 갱신을 위해 `getUser()` 왕복을
 * 이미 치렀으므로 인가 판정은 공짜다.
 *
 * **에러 경계(선행 조건 ③)에 불가능한 요구를 지우지 않는다는 것이 더 큰 이유다.**
 * `app/error.tsx`는 클라이언트 컴포넌트이고 프로덕션에서 `Error`가 redact되어
 * 메시지가 사라진다(`digest`만 남는다) — 타입 클래스도 직렬화 경계를 넘지
 * 못하므로 경계에서 "이건 미인증이다"를 알아낼 방법이 **없다.** 여기서 걸러야
 * ③이 일반 시스템 오류 표면으로 축소된다. 그 뒤에도 Q-04 예외가 경계에 닿는다면
 * 그것은 **프록시가 놓쳤다는 신호**이므로 삼키지 않는다.
 *
 * `?next=` 복귀 경로는 두지 않는다 — DOC-008의 이탈은 "성공 → SCR-101"뿐이고
 * 검증 없는 복귀 파라미터는 오픈 리다이렉트다.
 *
 * **`next/navigation`의 `redirect()`를 쓰지 않는다.** 프록시에서 내비게이션
 * API는 금지되어 있고(`dist/build/templates/middleware.js`가 개발 모드에서
 * "Next.js navigation API is not allowed to be used in Proxy"로 바꿔 던진다)
 * `NextResponse.redirect()`가 그 자리다.
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
 * ## 실측 (컷 0b)
 *
 * **④ 리다이렉트 네 갈래를 실 HTTP로 확인했다.** 미인증 `GET /`·`GET /products`
 * → 307 `/login`, `GET /login` → 200, 인증 `GET /login` → 307 `/`, 인증
 * `GET /` → 200. `GET /api/cron/prices` → **404**(라우트 없음)이지 307이 아니다 —
 * 매처 예외가 실제로 동작한다.
 *
 * **⑤ Supabase 도달 불가는 던지지 않는다** (0a의 미측정 항목을 실세션으로 닫았다).
 * `getUser()`가 `AuthRetryableFetchError`를 **반환**하므로 장애가 앱을 500으로
 * 만들지 않는다. 다만 `data.user`가 `null`이라 아래 판정은 **미인증으로 본다** —
 * 장애 중에는 로그인 화면으로 간다. 페일클로즈이며 의도한 쪽이다.
 *
 * **⑥ 그리고 그 실패가 세션을 파괴하지 않는다.** 만료 마진 안 + 도달 불가로
 * 갱신을 반드시 실패시켜 측정했다 — `setAll`이 **0건**을 싣는다. 라이브러리는
 * 재시도 가능한 실패에 삭제 쿠키를 내보내지 않으므로 쿠키가 그대로 남고,
 * Supabase가 돌아오면 다음 요청이 정상 동작한다. 일시 장애가 전원을 영구
 * 로그아웃시키지 않는다는 뜻이며, 이것이 확인되지 않았다면 위의 페일클로즈
 * 판단은 성립하지 않았을 것이다.
 */

/** SCR-001. `paths.ts`(컷 1a)가 생기면 그쪽으로 옮긴다. */
const LOGIN_PATH = '/login'

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

  /*
   * 이 한 호출이 두 가지를 한다.
   *
   * ① 만료 마진(auth-js `EXPIRY_MARGIN_MS`, 90초) 안이면 갱신을 유발하고
   *    `setAll`이 발화한다.
   * ② 세션 유무를 준다. `getSession()`이 아니라 `getUser()`인 것은 쿠키의
   *    주장을 믿지 않기 위해서다 — 인가 판정의 근거로 쓰므로 더 중요하다.
   */
  const { data } = await db.auth.getUser()

  const signedIn = data.user != null
  const onLoginPage = request.nextUrl.pathname === LOGIN_PATH

  /*
   * | 세션 | 경로     | 처리          |
   * |------|----------|---------------|
   * | 없음 | /login   | 통과          |
   * | 없음 | 그 외    | 307 → /login  |
   * | 있음 | /login   | 307 → /       |
   * | 있음 | 그 외    | 통과          |
   *
   * `applyTo`가 세 갈래 **뒤**에 정확히 한 번 온다. 갈래마다 쓰면 갱신 쿠키를
   * 잃는 갈래가 생기고, 그 갈래는 갱신이 일어난 요청에서만 드러난다.
   */
  const response =
    !signedIn && !onLoginPage
      ? NextResponse.redirect(new URL(LOGIN_PATH, request.url))
      : signedIn && onLoginPage
        ? NextResponse.redirect(new URL('/', request.url))
        : NextResponse.next()

  return accumulated.applyTo(response)
}
