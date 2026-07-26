/**
 * 접속 문자열 해석 — SEC-05
 *
 * 로컬 기본값을 코드에 두는 것은 SEC-05("비밀값은 환경변수, 저장소에 커밋
 * 금지") 위반이 아니다. 이 값은 Supabase CLI가 모든 개발 머신에서 동일하게
 * 노출하는 공개 고정값이며 루프백에서만 닿는다. 실제 비밀은 환경변수로만
 * 들어온다.
 *
 * 대신 **운영 DB를 향해 테스트를 돌리는 사고**를 구조로 막는다. 모든 테스트가
 * 롤백된다 해도 운영 인스턴스에 커넥션을 여는 것 자체를 사고로 취급한다.
 */

const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function resolveDatabaseUrl(): string {
  const url = process.env.RLS_TEST_DATABASE_URL ?? LOCAL_DEFAULT
  const host = new URL(url).hostname

  if (!LOOPBACK.has(host) && process.env.RLS_ALLOW_REMOTE !== '1') {
    throw new Error(
      `RLS 스위트가 루프백이 아닌 호스트를 향하고 있다: ${host}\n` +
        '의도한 것이라면 RLS_ALLOW_REMOTE=1을 함께 지정한다. ' +
        '운영 인스턴스에는 실행하지 않는다.',
    )
  }
  return url
}

/** 오류 메시지에 비밀번호를 남기지 않는다 (SEC-05) */
export function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1:***@')
}
