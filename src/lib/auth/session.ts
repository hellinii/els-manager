import type { CookieMethodsServer } from '@supabase/ssr'
import type { AuthError } from '@supabase/supabase-js'

import { createSessionClient } from '@/lib/db/client'
import { fail, okVoid, type ActionResult } from '@/lib/db/mutations/result'

/**
 * 로그인·로그아웃 — SCR-001 / SCR-502 (DOC-011 §8)
 *
 * ## §5의 열한 계약이 아니다
 *
 * Supabase Auth의 세션 조작이지 도메인 변경이 아니다. `src/app/actions.ts`는
 * "§5의 11개를 1:1로 노출한다"를 불변식으로 삼고 있으므로(그 파일의 docblock)
 * 열두 번째 export가 그것을 희석한다. 여기 두고 화면별 어댑터가 부른다.
 *
 * **그러나 `ActionResult`는 재사용한다.** §3.2가 프로젝트의 단일 오류 어휘이고,
 * 로그인 폼도 변경 계약과 같은 것을 요구한다 — 입력값 보존과 필드별 오류
 * (DOC-008 §6). 여기서 새 결과 타입을 만들면 화면이 두 어휘를 다뤄야 한다.
 *
 * ## 쿠키 어댑터를 인자로 받는다
 *
 * `lib/db/client.ts`와 같은 형태다. Next의 `cookies()`를 여기서 부르면 이 파일이
 * 프레임워크에 묶이고, 그러면 **로그인 왕복을 실제 GoTrue 대상으로 검증할 수
 * 없다** — `tests/integration/session.test.ts`가 메모리 jar로 하는 그것이다.
 * 결선은 `lib/db/server.ts`의 `getAuth()`가 맡는다.
 */

/**
 * GoTrue 오류 → `ErrorCode` (DOC-011 §3.2)
 *
 * **사용자 없음과 비밀번호 틀림에 같은 문구를 준다.** 구분하면 이메일 열거가
 * 가능해진다 — 폐쇄형 초대 서비스에서 "그 계정은 존재한다"는 확인은 그 자체로
 * 정보다(SEC-03이 공개 가입을 막은 것과 같은 축).
 */
function mapAuthError(error: AuthError): ActionResult<void> {
  // 코드가 있으면 그것이 정본이다. 없는 구버전 응답을 위해 status로 보강한다.
  const code = error.code ?? ''

  if (code === 'invalid_credentials' || error.status === 400) {
    return fail('VALIDATION_FAILED', '이메일 또는 비밀번호가 올바르지 않다.')
  }

  if (code === 'over_request_rate_limit' || error.status === 429) {
    // `[auth.rate_limit]`이 설정되어 있다(sign_in_sign_ups = 30 / 5분).
    return fail(
      'VALIDATION_FAILED',
      '로그인 시도가 너무 잦다. 잠시 후 다시 시도한다.',
    )
  }

  if (code === 'email_provider_disabled' || code === 'signup_disabled') {
    /*
     * 설정 사고다. CLAUDE.md가 경고한 함정이며 P3a에서 실측했다 —
     * `[auth.email].enable_signup = false`로 두면 GoTrue의
     * `EXTERNAL_EMAIL_ENABLED`가 꺼져 **로그인 자체가** 422로 막힌다.
     * 그래서 메시지가 설정 키를 지목한다. 일반 문구를 주면 다음 사람이
     * 비밀번호를 의심하며 시간을 버린다.
     */
    return fail(
      'INTERNAL',
      '이메일 로그인이 서버에서 비활성화되어 있다. ' +
        'supabase/config.toml의 [auth.email].enable_signup을 확인한다 ' +
        '(공개 가입 차단은 [auth].enable_signup으로 한다).',
    )
  }

  console.error(`[auth] 예상 밖의 로그인 오류: ${error.code ?? '-'} ${error.message}`)
  return fail('INTERNAL', '로그인에 실패했다. 잠시 후 다시 시도한다.')
}

export async function signIn(
  params: { email: string; password: string },
  cookies: CookieMethodsServer,
): Promise<ActionResult<void>> {
  const email = params.email.trim()

  /*
   * 빈 값을 GoTrue에 보내지 않는다. 왕복을 아끼려는 것이 아니라 **필드별 오류가
   * 여기서만 가능하기 때문**이다 — GoTrue는 어느 쪽이 비었는지 알려주지 않고
   * `invalid_credentials` 하나로 답한다.
   */
  const fields: Record<string, string> = {}
  if (email === '') fields.email = '이메일을 입력한다.'
  if (params.password === '') fields.password = '비밀번호를 입력한다.'
  if (Object.keys(fields).length > 0) {
    return fail('VALIDATION_FAILED', '입력값을 확인한다.', fields)
  }

  const db = createSessionClient(cookies)
  const { error } = await db.auth.signInWithPassword({
    email,
    password: params.password,
  })

  return error == null ? okVoid() : mapAuthError(error)
}

/**
 * 로그아웃 — **쿠키 삭제 경로의 유일한 소비자다.**
 *
 * 프록시는 갱신만 하고 서버 액션은 갱신분 저장만 하므로, `setAll`이 빈 값
 * (`value: ''`)을 싣는 경로는 여기서만 실행된다. 그 경로가 깨지면 브라우저가
 * 죽은 쿠키를 계속 보내고 **매 요청이 실패할 갱신을 다시 시도한다.**
 *
 * `scope: 'local'`이다 — 이 브라우저의 세션만 끊는다. 기본값(`global`)은 같은
 * 사용자의 다른 기기까지 로그아웃시키는데, 가족이 한 계정을 여러 기기에서 보는
 * 사용 형태(A-01)에서 그것은 놀라운 동작이다.
 */
export async function signOut(
  cookies: CookieMethodsServer,
): Promise<ActionResult<void>> {
  const db = createSessionClient(cookies)
  const { error } = await db.auth.signOut({ scope: 'local' })

  if (error != null) {
    /*
     * 실패해도 화면은 로그아웃으로 진행한다. 여기서 실패를 보고하면 사용자가
     * "로그아웃이 안 된다"는 화면에 갇히는데, 서버 세션은 이미 무효일 수 있다.
     * 남는 위험은 쿠키가 남는 것이고 그것은 다음 `getUser()`가 정리한다.
     */
    console.error(`[auth] 로그아웃 실패 — 쿠키가 남을 수 있다: ${error.message}`)
  }

  return okVoid()
}
