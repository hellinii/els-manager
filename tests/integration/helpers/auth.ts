import { createClient } from '@supabase/supabase-js'

import { createTokenClient, type UserSessionClient } from '@/lib/db/client'

import { ITG_EMAIL, ITG_PASSWORD } from './fixtures'
import { resolveAnonKey, resolveApiUrl } from './env'

/**
 * 실제 로그인으로 토큰을 얻는다 — **가장하지 않는다.**
 *
 * `tests/rls`는 `set local role authenticated` + `set local request.jwt.claims`로
 * 사용자를 흉내낸다. 그 방식은 정책 술어를 검증하기에 충분하지만 **GoTrue와
 * PostgREST를 한 번도 지나지 않는다.** P3a 2단계에서 그 구멍이 실제로 드러났다 —
 * 시드 사용자의 로그인이 500으로 죽어 있는 동안 RLS 128개는 전부 초록색이었다
 * (DOC-010 AQ-21). 이 스위트는 그래서 진짜 JWT를 쓴다.
 */
export async function signIn(userId: keyof typeof ITG_EMAIL): Promise<string> {
  const auth = createClient(resolveApiUrl(), resolveAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await auth.auth.signInWithPassword({
    email: ITG_EMAIL[userId],
    password: ITG_PASSWORD,
  })

  if (error != null || data.session == null) {
    throw new Error(
      `로그인 실패 (${ITG_EMAIL[userId]}): ${error?.message ?? '세션 없음'}\n` +
        'supabase/seed/01_integration_users.sql이 적용되었는지 확인한다 (npm run db:reset).',
    )
  }
  return data.session.access_token
}

/** 사용자 세션 클라이언트. `service_role`을 쓰지 않는다 (Q-01) */
export async function clientFor(
  userId: keyof typeof ITG_EMAIL,
): Promise<UserSessionClient> {
  return createTokenClient(await signIn(userId))
}
