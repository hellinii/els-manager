/**
 * 환경변수 해석 — DOC-010 §7.2, SEC-05·SEC-06
 *
 * **`process.env`를 읽는 유일한 파일이다.** 린트가 `src/lib/db/**`의 나머지
 * 전부에서 `process`를 금지하므로, "조회 경로는 `service_role`을 쓰지 않는다"를
 * 이 파일 하나만 읽어서 감사할 수 있다. 규율이 아니라 경계다.
 *
 * 여기서 읽는 두 변수는 **비밀이 아니다** — 브라우저 번들에 실린다. 공개 키로
 * 얻는 것은 `anon` 롤이고 `anon`에는 어떤 테이블 권한도 없다(DOC-010 §7).
 * `authenticated`가 되려면 세션이 필요하고, 세션은 초대된 사용자의 로그인으로만
 * 생긴다(SEC-03).
 */

/** DOC-010 §7.2에 등재된 변수명. 이 목록 밖의 변수는 이 계층에서 읽지 않는다. */
const SUPABASE_URL = 'NEXT_PUBLIC_SUPABASE_URL'
const SUPABASE_ANON_KEY = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

export type SupabaseEnv = {
  url: string
  anonKey: string
}

/**
 * 부재 시 즉시 던진다. **빈 문자열도 부재로 취급한다** — 미설정 변수가 `''`로
 * 들어오면 "URL이 빈 클라이언트"가 만들어져 실패가 첫 조회까지 미뤄지고,
 * 그때의 오류 메시지는 원인을 가리키지 않는다.
 *
 * `tests/rls/helpers/env.ts`가 접속 문자열에 적용한 규율과 같다 — 잘못된 대상을
 * 향한 실행을 사고로 취급하고 구조로 막는다.
 */
function require_(name: string): string {
  const value = process.env[name]
  if (value == null || value.trim() === '') {
    throw new Error(
      `환경변수 ${name}가 설정되지 않았다. .env.example을 참고해 .env.local을 만든다. ` +
        '로컬 값은 `npm run db:status`가 출력한다.',
    )
  }
  return value
}

export function supabaseEnv(): SupabaseEnv {
  return {
    url: require_(SUPABASE_URL),
    anonKey: require_(SUPABASE_ANON_KEY),
  }
}
