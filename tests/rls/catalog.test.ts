import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { RLS_TABLES, USER_A, USER_B } from './helpers/fixtures'
import { seedTaxProfile } from './helpers/seed'

/**
 * 하네스 자기검사 + 카탈로그 — DOC-010 §7
 *
 * **이 파일이 가장 먼저 통과해야 한다.** 사용자 가장이 조용히 실패하면
 * `auth.uid()`가 null이 되고, `owner_id = null`은 NULL로 평가되어 모든 정책이
 * 거부한다. 그러면 나머지 파일의 모든 거부 테스트가 **잘못된 이유로 통과**한다.
 *
 * 카탈로그 검사는 `force row level security`를 쓰지 않기로 한 결정의 실질적
 * 대체물이다. FORCE는 BYPASSRLS 롤에 무력하지만, 실제로 일어나는 사고는
 * "새 테이블을 추가하면서 RLS 켜는 것을 잊는 것"이고 그건 여기서 잡힌다.
 */

describe('사용자 가장이 실제로 동작한다', () => {
  it('롤이 authenticated로 바뀌고 auth.uid()가 지정 사용자다', async () => {
    const result = await actingAs(USER_A).query<{
      role: string
      uid: string | null
    }>(`select current_user as role, auth.uid()::text as uid`)

    expect(result.rows[0].role).toBe('authenticated')
    expect(result.rows[0].uid).toBe(USER_A)
  })

  it('사용자를 바꾸면 auth.uid()도 바뀐다', async () => {
    const b = await actingAs(USER_B).query<{ uid: string | null }>(
      'select auth.uid()::text as uid',
    )
    expect(b.rows[0].uid).toBe(USER_B)
  })

  it('미인증은 anon 롤이고 auth.uid()가 null이다', async () => {
    const result = await actingAs(null).query<{
      role: string
      uid: string | null
    }>(`select current_user as role, auth.uid()::text as uid`)

    expect(result.rows[0].role).toBe('anon')
    expect(result.rows[0].uid).toBeNull()
  })

  it('asOwner는 RLS를 우회한다 — 사후 확인 경로가 실제로 보이는지', async () => {
    // tax_profiles는 조회가 본인 한정이다. 소유자 권한으로는 타인 것도 보여야
    // 하며, 그래야 "0행이 권한 없음인지 행 없음인지"를 구분할 수 있다
    await seedTaxProfile({ userId: USER_B })

    const seen = await asOwner('select id from public.tax_profiles where user_id = $1', [
      USER_B,
    ])
    expect(seen.rowCount).toBe(1)

    const hidden = await actingAs(USER_A).query(
      'select id from public.tax_profiles where user_id = $1',
      [USER_B],
    )
    expect(hidden.rowCount).toBe(0)
  })

  it('가장 상태가 문장 사이에 새지 않는다', async () => {
    await actingAs(USER_A).query('select 1')
    const after = await asOwner<{ role: string }>('select current_user as role')
    expect(after.rows[0].role).toBe('postgres')
  })
})

describe('카탈로그 — 정책 누락을 구조적으로 막는다', () => {
  it('public의 모든 실테이블에 RLS가 켜져 있다', async () => {
    const disabled = await asOwner<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    expect(disabled.rows.map((r) => r.relname)).toEqual([])
  })

  it('DOC-002 §3의 12개 엔티티가 모두 존재한다', async () => {
    const present = await asOwner<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    )
    expect(present.rows.map((r) => r.relname)).toEqual([...RLS_TABLES].sort())
  })

  it('anon에게 부여된 테이블 권한이 없다 (SEC-03, SEC-06)', async () => {
    const grants = await asOwner<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`,
    )
    expect(grants.rows).toEqual([])
  })

  it('to public인 정책이 없다 — anon을 포함하게 된다', async () => {
    const loose = await asOwner<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and 'public' = any(roles)`,
    )
    expect(loose.rows).toEqual([])
  })

  it('모든 정책의 대상 롤이 authenticated 하나다', async () => {
    const wrong = await asOwner<{ policyname: string; roles: string }>(
      `select policyname, roles::text as roles from pg_policies
        where schemaname = 'public' and roles::text <> '{authenticated}'`,
    )
    expect(wrong.rows).toEqual([])
  })

  it('변경 정책이 없는 테이블은 쓰기 권한도 회수되어 있다', async () => {
    // 정책 부재만으로는 UPDATE·DELETE가 조용히 0행으로 끝난다.
    // 참조 데이터와 공급자 매핑은 권한 자체를 회수해 42501로 실패해야 한다
    const readOnly = ['tax_years', 'tax_brackets', 'tax_constants', 'asset_provider_symbols']
    const grants = await asOwner<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public'
          and table_name = any($1) and privilege_type <> 'SELECT'`,
      [readOnly],
    )
    expect(grants.rows).toEqual([])
  })
})
