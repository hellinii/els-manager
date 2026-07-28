import { execFileSync } from 'node:child_process'

import { injectEnv, resolveAnonKey, resolveApiUrl } from '../integration/helpers/env'
import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A } from '../integration/helpers/fixtures'
import { startServer, stopServer } from './helpers/server'

/**
 * 프리플라이트 — **건너뛰지 않고 실패한다.**
 *
 * `tests/rls/`·`tests/integration/`의 globalSetup과 같은 규율이다. 서버나 DB가
 * 없을 때 skip하면 아무것도 증명하지 않은 초록색이 된다.
 */
export default async function setup(): Promise<() => Promise<void>> {
  injectEnv()

  const apiUrl = resolveApiUrl()
  const anonKey = resolveAnonKey()

  // (1) Supabase 도달 — 프록시가 매 요청에서 getUser()를 부르므로 없으면 전부 죽는다
  try {
    const health = await fetch(`${apiUrl}/rest/v1/`, { headers: { apikey: anonKey } })
    if (!health.ok) throw new Error(`status ${health.status}`)
  } catch (cause) {
    throw new Error(
      `Supabase에 도달할 수 없다: ${apiUrl}\n` +
        '  1) Docker Desktop 실행  2) npm run db:start  3) npm run db:reset',
      { cause },
    )
  }

  // (2) 시드 사용자 로그인 — 인증 경로를 태우는 스위트이므로 전제가 더 직접적이다
  const token = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    }),
  })
  if (!token.ok) {
    throw new Error(
      `시드 사용자로 로그인할 수 없다: ${token.status}\n  npm run db:reset`,
    )
  }

  /*
   * (3) 프로덕션 빌드.
   *
   * `next dev`가 아니라 `next build` + `next start`인 것이 요점이다. **에러
   * 경계의 동작이 두 모드에서 다르다** — 개발 모드는 오류 오버레이를 띄우고
   * `Error`를 redact하지 않는다. 운영에서 무엇이 보이는지 확인하려면
   * 프로덕션 빌드여야 한다.
   */
  execFileSync('npx', ['next', 'build'], { stdio: 'pipe' })

  await startServer()

  return async () => {
    await stopServer()
  }
}
