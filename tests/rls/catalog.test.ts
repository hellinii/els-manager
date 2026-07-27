import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { RLS_TABLES, USER_A, USER_B } from './helpers/fixtures'
import { seedTaxProfile } from './helpers/seed'
import {
  COLUMN_PRIVILEGES,
  DML_PRIVILEGES,
  TABLE_PRIVILEGES,
} from './helpers/authz-matrix'

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

/**
 * 권한 매트릭스 — DOC-010 v0.3 §7 표 ↔ 실제 GRANT
 *
 * **열거 대상은 매트릭스의 키가 아니라 카탈로그(`pg_class`)다.** 매트릭스를
 * 순회하면 매트릭스에 없는 신규 테이블이 순회 대상에서 빠지고, TRUNCATE 유입을
 * 잡으라고 만든 검사가 정확히 그 케이스를 놓친다.
 */
describe('권한 매트릭스 — §7 표가 실제 GRANT와 일치한다', () => {
  /** 카탈로그의 public 실테이블 */
  async function catalogTables(): Promise<string[]> {
    const result = await asOwner<{ relname: string }>(
      `select c.relname
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        order by c.relname`,
    )
    return result.rows.map((r) => r.relname)
  }

  it('카탈로그의 테이블 집합과 매트릭스의 키 집합이 양방향 일치한다', async () => {
    // 양방향이어야 신규 테이블 추가 시 여기서 먼저 빨간불이 뜬다.
    // 한쪽 방향만 보면 매트릭스에 없는 테이블이 조용히 검사 밖에 남는다
    expect(await catalogTables()).toEqual(Object.keys(TABLE_PRIVILEGES).sort())
  })

  it('각 테이블의 authenticated 테이블 단위 권한이 매트릭스와 정확히 일치한다', async () => {
    const grants = await asOwner<{ table_name: string; privilege_type: string }>(
      `select distinct table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public'`,
    )

    const actual = new Map<string, string[]>()
    for (const table of await catalogTables()) actual.set(table, [])
    for (const row of grants.rows) actual.get(row.table_name)?.push(row.privilege_type)

    const normalized = Object.fromEntries(
      [...actual].map(([table, privileges]) => [table, [...privileges].sort()]),
    )
    const expected = Object.fromEntries(
      Object.entries(TABLE_PRIVILEGES).map(([table, privileges]) => [
        table,
        [...privileges].sort(),
      ]),
    )

    expect(normalized).toEqual(expected)
  })

  it('전 테이블에서 authenticated 권한이 DML 넷의 부분집합이다', async () => {
    // §7.1의 사고를 직접 겨냥한다. 위 단언이 화이트리스트라면 이것은
    // 블랙리스트다 — TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 유입을 잡는다.
    // TRUNCATE는 RLS 적용 대상이 아니므로 권한 층에서만 막힌다
    const leaked = await asOwner<{ relname: string; privilege_type: string }>(
      `select c.relname, a.privilege_type
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and a.grantee = 'authenticated'::regrole
          and a.privilege_type <> all($1)
        order by c.relname, a.privilege_type`,
      [DML_PRIVILEGES],
    )
    expect(leaked.rows).toEqual([])
  })

  it('열 단위 권한이 매트릭스와 정확히 일치한다 — 권한 종류까지', async () => {
    // pg_attribute.attacl 은 명시적 열 GRANT 만 담는다.
    // information_schema.column_privileges 는 테이블 권한을 전 열로 펼쳐서
    // 보여주므로 "열 단위로만 부여됨"을 표현하지 못한다.
    //
    // **권한 종류를 하드코딩하지 않는다** (P3a 7단계). 실측한 attacl에서
    // display_name은 `{authenticated=rw/postgres}` — 한 항목에 SELECT와 UPDATE가
    // 함께 있다. 종류를 'UPDATE'로 고정하면 열 단위 SELECT를 표현할 수 없고,
    // UPDATE가 늘어난 열도 잡지 못한다.
    const granted = await asOwner<{
      relname: string
      attname: string
      privilege_type: string
    }>(
      `select c.relname, at.attname, a.privilege_type
         from pg_attribute at
         join pg_class c on c.oid = at.attrelid
         cross join lateral aclexplode(at.attacl) a
        where c.relnamespace = 'public'::regnamespace
          and at.attacl is not null
          and a.grantee = 'authenticated'::regrole
        order by c.relname, at.attname, a.privilege_type`,
    )

    const expected = Object.entries(COLUMN_PRIVILEGES)
      .flatMap(([relname, columns]) =>
        Object.entries(columns).flatMap(([attname, privileges]) =>
          [...privileges]
            .sort()
            .map((privilege_type) => ({ relname, attname, privilege_type })),
        ),
      )
      .sort(
        (a, b) =>
          a.relname.localeCompare(b.relname) ||
          a.attname.localeCompare(b.attname) ||
          a.privilege_type.localeCompare(b.privilege_type),
      )

    expect(granted.rows).toEqual(expected)
  })

  it('email에는 어떤 권한도 없다 — 계약이 쓰지 않는 열은 열지 않는다', async () => {
    // 위 단언이 양방향이라 이미 덮이지만, 이 열은 **로그인 식별자**이므로
    // 의도를 이름으로 남긴다. 회귀가 생기면 원인이 바로 읽힌다.
    const canRead = await asOwner<{ ok: boolean }>(
      `select has_column_privilege('authenticated', 'public.users', 'email', 'SELECT') as ok`,
    )
    expect(canRead.rows[0].ok).toBe(false)
  })

  it('명시 열은 읽을 수 있다 — 축소가 정상 경로를 막지 않는지', async () => {
    const readable = await asOwner<{ id: boolean; name: boolean }>(
      `select has_column_privilege('authenticated', 'public.users', 'id', 'SELECT') as id,
              has_column_privilege('authenticated', 'public.users', 'display_name', 'SELECT') as name`,
    )
    expect(readable.rows[0]).toEqual({ id: true, name: true })
  })

  it('신규 객체 기본 권한에 anon·authenticated가 없다', async () => {
    // 마이그레이션의 alter default privileges 회수를 검증한다. 이 단언이
    // 없으면 플랫폼이 기본값을 재시딩할 때 TRUNCATE 구멍이 신호 없이 돌아온다
    const defaults = await asOwner<{
      objtype: string
      grantee: string
      privilege_type: string
    }>(
      `select d.defaclobjtype as objtype,
              a.grantee::regrole::text as grantee,
              a.privilege_type
         from pg_default_acl d
         cross join lateral aclexplode(d.defaclacl) a
        where d.defaclnamespace = 'public'::regnamespace
          and d.defaclrole = 'postgres'::regrole
          and d.defaclobjtype in ('r', 'S')
          and a.grantee::regrole::text in ('anon', 'authenticated')
        order by d.defaclobjtype, a.grantee, a.privilege_type`,
    )
    expect(defaults.rows).toEqual([])
  })
})
