/**
 * API 좌표 해석 — `tests/rls/helpers/env.ts`와 같은 규율
 *
 * 로컬 기본값을 코드에 두는 것은 SEC-05 위반이 아니다. 이 값들은 Supabase CLI가
 * 모든 개발 머신에서 동일하게 노출하는 공개 고정값이며 루프백에서만 닿는다.
 *
 * 대신 **운영 인스턴스를 향해 테스트를 돌리는 사고**를 구조로 막는다. 이 스위트는
 * 픽스처를 **커밋**하므로(롤백이 없다) 잘못된 대상을 향하면 되돌릴 수 없다 —
 * RLS 스위트보다 오히려 더 위험하다.
 */

const LOCAL_API_URL = 'http://127.0.0.1:54321'
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function resolveApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_API_URL
  const host = new URL(url).hostname

  if (!LOOPBACK.has(host) && process.env.ITG_ALLOW_REMOTE !== '1') {
    throw new Error(
      `조회 계약 스위트가 루프백이 아닌 호스트를 향하고 있다: ${host}\n` +
        '이 스위트는 픽스처를 커밋하므로 되돌릴 수 없다. ' +
        '의도한 것이라면 ITG_ALLOW_REMOTE=1을 함께 지정한다. ' +
        '운영 인스턴스에는 실행하지 않는다.',
    )
  }
  return url
}

export function resolveAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY
}

/**
 * 픽스처 작성용 직결 접속.
 *
 * 픽스처는 `pg`로 소유자 권한으로 만들고 **읽기는 PostgREST로만** 한다 —
 * `tests/rls/helpers/seed.ts`와 같은 논거다(검증 대상은 조회 경로이지 준비
 * 과정이 아니다). 여기서 RLS를 경유해 INSERT하면 준비 실패와 검증 실패가
 * 구분되지 않는다.
 */
const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export function resolveDatabaseUrl(): string {
  const url = process.env.ITG_DATABASE_URL ?? LOCAL_DB_URL
  const host = new URL(url).hostname

  if (!LOOPBACK.has(host) && process.env.ITG_ALLOW_REMOTE !== '1') {
    throw new Error(
      `조회 계약 스위트의 픽스처가 루프백이 아닌 DB를 향하고 있다: ${host}\n` +
        '이 스위트는 픽스처를 커밋한다. 운영 인스턴스에는 실행하지 않는다.',
    )
  }
  return url
}

/**
 * `src/lib/db/env.ts`는 변수가 없으면 던진다(그것이 그 파일의 규약이다).
 * 스위트는 `.env.local` 없이도 돌아야 하므로, 해석한 값을 **주입**한 뒤
 * 프로덕션 코드가 자기 경로로 읽게 한다 — 테스트용 우회 경로를 만들지 않는다.
 */
export function injectEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = resolveApiUrl()
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = resolveAnonKey()
}
