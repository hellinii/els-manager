import { Client } from 'pg'
import { maskUrl, resolveDatabaseUrl } from './helpers/env'
import { RLS_TABLES, USER_A, USER_B } from './helpers/fixtures'

/**
 * 프리플라이트 — DB가 없으면 **건너뛰지 않고 실패한다.**
 *
 * `npm run test:rls`는 "권한이 DB로 강제되는지 확인한다"는 단일 목적으로
 * 명시 호출되는 명령이다. DB가 없을 때 skip하면 아무것도 증명하지 않은 채
 * 초록색이 되고, 절대 규칙 #6이 지켜지는지 확인할 수단을 잃는다. DB 없는
 * 초록색은 이미 `npm run test`가 제공한다.
 *
 * 여기서 미리 확인하는 이유는 실패 원인을 수십 개의 혼란스러운 실패가 아니라
 * 하나의 지시문으로 만들기 위해서다.
 */
export default async function setup(): Promise<void> {
  const url = resolveDatabaseUrl()
  const client = new Client({ connectionString: url })

  try {
    await client.connect()
  } catch (cause) {
    throw new Error(
      `데이터베이스에 접속할 수 없다: ${maskUrl(url)}\n` +
        '  1) Docker Desktop을 실행한다\n' +
        '  2) npm run db:start\n' +
        '  3) npm run db:reset\n' +
        'RLS 스위트는 DB 없이 통과할 수 없다. 건너뛰지 않는다.',
      { cause },
    )
  }

  try {
    // (1) 테이블 존재
    const missing: string[] = []
    for (const table of RLS_TABLES) {
      const found = await client.query<{ oid: string | null }>(
        'select to_regclass($1)::oid as oid',
        [`public.${table}`],
      )
      if (found.rows[0].oid === null) missing.push(table)
    }
    if (missing.length > 0) {
      throw new Error(
        `테이블이 없다: ${missing.join(', ')}\n  npm run db:reset을 실행한다.`,
      )
    }

    // (2) 전 테이블 RLS 활성 — 여기서 걸리면 정책 테스트는 의미가 없다
    const disabled = await client.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    if (disabled.rowCount! > 0) {
      throw new Error(
        `RLS가 꺼진 테이블: ${disabled.rows.map((r) => r.relname).join(', ')}\n` +
          '  DOC-010 §7 위반이다.',
      )
    }

    // (3) 픽스처 사용자 — seed/00_rls_test_users.sql이 적용되었는가
    const users = await client.query(
      'select id from public.users where id = any($1::uuid[])',
      [[USER_A, USER_B]],
    )
    if (users.rowCount !== 2) {
      throw new Error(
        'RLS 테스트 사용자가 없다. supabase/seed/00_rls_test_users.sql이 적용되지 않았다.\n' +
          '  npm run db:reset을 실행한다.',
      )
    }

    // (4) 역할 전환 가능 여부 — 불가하면 모든 거부 테스트가 거짓 통과한다
    const canSwitch = await client.query<{ ok: boolean }>(
      `select pg_has_role(current_user, 'authenticated', 'member') as ok`,
    )
    if (!canSwitch.rows[0].ok) {
      throw new Error(
        '현재 롤이 authenticated로 전환할 수 없다. ' +
          '사용자 가장이 불가능하므로 스위트를 중단한다 — ' +
          '그대로 두면 모든 거부 테스트가 잘못된 이유로 통과한다.',
      )
    }
  } finally {
    await client.end()
  }
}
