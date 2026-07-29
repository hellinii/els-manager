import { execFileSync } from 'node:child_process'

import { injectEnv, resolveAnonKey, resolveApiUrl } from '../integration/helpers/env'
import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A } from '../integration/helpers/fixtures'
import { E2E_CRON_SECRET } from './helpers/cron'
import { startServer, stopServer } from './helpers/server'

/**
 * 프리플라이트 — **건너뛰지 않고 실패한다.**
 *
 * `tests/rls/`·`tests/integration/`의 globalSetup과 같은 규율이다. 서버나 DB가
 * 없을 때 skip하면 아무것도 증명하지 않은 초록색이 된다.
 */
export default async function setup(): Promise<() => Promise<void>> {
  injectEnv()

  /*
   * 배치 비밀을 스위트가 정한다 — `tests/e2e/helpers/cron.ts`의 독블록에 근거가 있다.
   * 주입한 값이 `.env.local`을 이기므로(실측) 401·503 갈래가 기계와 무관하게 결정적이다.
   * `startServer()`가 `env: process.env`로 넘기므로 이 줄이 그보다 앞이어야 한다.
   */
  process.env.CRON_SECRET = E2E_CRON_SECRET

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
   *
   * ★ **`stdio: 'pipe'`가 로그를 버리고 있었다 (P5b 컷 1).** 빌드가 실패하면
   * `execFileSync`가 던지는데 그 오류의 `message`는 `Command failed: npx next build`
   * 뿐이고, 진짜 원인(어느 파일의 어느 줄)은 파이프 안에서 사라졌다. 그러면 **e2e 11개
   * 파일이 이유 없이 죽는다** — Route Handler가 프리렌더 수집에서 던지는 경우가 정확히
   * 그 형태다(모듈 스코프에서 환경변수를 읽는 실수). 그래서 잡아서 담는다.
   *
   * Next는 오류를 stdout에도 쓴다(빌드 요약과 같은 스트림). **둘 다 담는다** — 한쪽만
   * 담으면 빈 문자열이 나오는 경우가 생기고, 그것은 버리는 것과 같다.
   */
  try {
    execFileSync('npx', ['next', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (cause) {
    const { stdout, stderr } = cause as { stdout?: Buffer; stderr?: Buffer }
    const log = [stderr?.toString() ?? '', stdout?.toString() ?? '']
      .filter((part) => part.trim() !== '')
      .join('\n')
    throw new Error(
      `next build가 실패했다. e2e는 프로덕션 빌드를 요구한다.\n${log === '' ? '(빌드 로그가 비어 있다)' : log}`,
      { cause },
    )
  }

  await startServer()

  return async () => {
    await stopServer()
  }
}
