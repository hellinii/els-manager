import { Client } from 'pg'

import { injectEnv, resolveApiUrl, resolveAnonKey, resolveDatabaseUrl } from './helpers/env'
import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'

/**
 * 프리플라이트 — **건너뛰지 않고 실패한다.**
 *
 * `tests/rls/global-setup.ts`와 같은 규율이다. DB가 없을 때 skip하면 아무것도
 * 증명하지 않은 초록색이 되고, PostgREST 경로가 실제로 도는지 확인할 수단을
 * 잃는다. DB 없는 초록색은 이미 `npm run test`가 제공한다.
 *
 * 여기서 확인하는 네 가지는 각각 **다른 실패 모드**에 대응한다.
 */
export default async function setup(): Promise<void> {
  injectEnv()

  const apiUrl = resolveApiUrl()
  const anonKey = resolveAnonKey()

  // (1) API 도달 — Docker·스택이 떠 있는가
  let health: Response
  try {
    health = await fetch(`${apiUrl}/rest/v1/`, { headers: { apikey: anonKey } })
  } catch (cause) {
    throw new Error(
      `PostgREST에 도달할 수 없다: ${apiUrl}\n` +
        '  1) Docker Desktop을 실행한다\n' +
        '  2) npm run db:start\n' +
        '  3) npm run db:reset\n' +
        '조회 계약 스위트는 API 없이 통과할 수 없다. 건너뛰지 않는다.',
      { cause },
    )
  }
  if (!health.ok) {
    throw new Error(`PostgREST가 ${health.status}를 반환했다: ${apiUrl}`)
  }

  // (2) 시드 사용자 로그인 — **가장이 아니라 실제 GoTrue 왕복이다.**
  //     P3a 2단계에서 이 경로가 500으로 죽어 있었는데 RLS 128개는 초록색이었다
  //     (DOC-010 AQ-21). 그 회귀를 여기서 상시 막는다.
  for (const userId of [ITG_USER_A, ITG_USER_B] as const) {
    const res = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ITG_EMAIL[userId], password: ITG_PASSWORD }),
    })
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      throw new Error(
        `조회 계약 시드 사용자로 로그인할 수 없다 (${ITG_EMAIL[userId]}): ` +
          `${res.status} ${JSON.stringify(body)}\n` +
          '  supabase/seed/01_integration_users.sql이 적용되었는가? npm run db:reset\n' +
          '  auth.users의 토큰 열이 NULL이면 GoTrue가 500을 낸다 — 시드 파일 주석 참조.',
      )
    }
  }

  // (3) 공개 가입 비활성 — SEC-03. 정책 32개가 전제하는 것이 이것이다.
  //     RLS·GRANT 테스트는 authenticated 롤 **안에서의** 분리만 보므로
  //     누가 그 롤에 들어올 수 있는지는 이 단언만 본다.
  const signup = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `itg-signup-probe-${Date.now()}@example.test`,
      password: 'probe-password-123',
    }),
  })
  if (signup.ok) {
    throw new Error(
      '공개 가입이 열려 있다 (SEC-03 위반).\n' +
        '  공개 키를 가진 누구나 authenticated 세션을 얻고, tax_profiles를 제외한\n' +
        '  전 테이블을 조회할 수 있다 — 정책 32개의 전제가 무너진다.\n' +
        '  supabase/config.toml의 [auth].enable_signup = false 로 두고\n' +
        '  npm run db:stop && npm run db:start (db:reset으로는 반영되지 않는다).',
    )
  }

  // (4) 생성 타입의 신선도 — AQ-19. 타입이 낡으면 Q-08의 타입 방어가 조용히 멈춘다.
  const client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  try {
    const dropped = await client.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'els_products'
          and column_name = 'total_rounds'`,
    )
    if (dropped.rowCount !== 0) {
      throw new Error(
        'els_products.total_rounds가 아직 있다. 마이그레이션이 적용되지 않았다.\n' +
          '  npm run db:reset && npm run db:types',
      )
    }
  } finally {
    await client.end()
  }
}
