import { describe, expect, it } from 'vitest'
import { actingAs, actingAsServiceRole, asOwner } from './helpers/client'
import { RLS_TABLES, USER_A, USER_B } from './helpers/fixtures'
import { seedTaxProfile } from './helpers/seed'
import { expectPermissionDenied } from './helpers/expect'
import {
  COLUMN_PRIVILEGES,
  DML_PRIVILEGES,
  ROLES,
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

  it('배치 가장이 service_role로 바뀌고 auth.uid()는 null이다', async () => {
    // 권한이 0이어도 `current_user`는 읽을 수 있으므로 이 자기검사는 회수
    // 후에도 성립한다. 전환이 조용히 실패하면 `postgres`로 남는데 그 롤은
    // 전 권한을 가지므로 아래 거부 단언들이 **시끄럽게** 실패한다 —
    // fail-safe 방향이지만 원인을 여기서 먼저 읽게 한다
    const result = await actingAsServiceRole().query<{
      role: string
      uid: string | null
    }>(`select current_user as role, auth.uid()::text as uid`)

    expect(result.rows[0].role).toBe('service_role')
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
    // **정본은 아래 권한 매트릭스다.** 이 단언은 의도를 이름으로 남기는
    // 자리이며 `information_schema`를 쓰므로 `MAINTAIN`을 보지 못한다(실측 —
    // 그 뷰는 8종 중 7종만 보여준다). 여기서 초록인 것만으로 `anon`이 깨끗함이
    // 증명되지 않는다
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
 * 권한 매트릭스 — DOC-010 v2.2 §7 표 ↔ 실제 GRANT
 *
 * **열거 대상은 매트릭스의 키가 아니라 카탈로그(`pg_class`)와 `ROLES`다.**
 * 매트릭스를 순회하면 매트릭스에 없는 신규 테이블이 순회 대상에서 빠지고,
 * TRUNCATE 유입을 잡으라고 만든 검사가 정확히 그 케이스를 놓친다.
 *
 * **질의는 전부 `aclexplode`로 짠다** (P5b 컷 2). `information_schema`를 쓰지
 * 않는 이유는 실측이다 — 그 뷰는 `MAINTAIN`을 숨긴다:
 *
 * ```
 * information_schema.role_table_grants  7종  DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
 * aclexplode(relacl)                    8종  … + MAINTAIN
 * ```
 *
 * 같은 롤에 대해 결과가 갈리므로, 뷰로 대조하면 **잔여 `MAINTAIN`이 「0」으로
 * 통과한다.** 회수를 검증하는 단언이 회수되지 않은 권한을 못 보는 형태였다.
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

  it('매트릭스의 모든 셀이 ROLES 셋을 빠짐없이 덮는다', async () => {
    // 롤 차원 자체의 양방향 검사다. 한 테이블에서 롤 하나를 빠뜨리면 그 셀은
    // 아래 대조에서 `undefined`가 되어 **비교 대상에서 조용히 사라진다** —
    // `satisfies`가 잡지만, 매트릭스를 손으로 넓힐 때 여기가 먼저 말한다
    for (const [table, byRole] of Object.entries(TABLE_PRIVILEGES)) {
      expect(Object.keys(byRole).sort(), `table=${table}`).toEqual([...ROLES].sort())
    }
  })

  it('각 (롤, 테이블)의 테이블 단위 권한이 매트릭스와 정확히 일치한다', async () => {
    const grants = await asOwner<{
      relname: string
      grantee: string
      privilege_type: string
    }>(
      `select c.relname, a.grantee::regrole::text as grantee, a.privilege_type
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and a.grantee::regrole::text = any($1)`,
      [ROLES],
    )

    // 카탈로그 × ROLES 로 격자를 먼저 세운다. 권한이 0인 셀도 키가 남아야
    // "빈 배열이 맞다"가 검사된다
    const actual = new Map<string, string[]>()
    const key = (table: string, role: string) => `${table}.${role}`
    for (const table of await catalogTables()) {
      for (const role of ROLES) actual.set(key(table, role), [])
    }
    for (const row of grants.rows) {
      actual.get(key(row.relname, row.grantee))?.push(row.privilege_type)
    }

    const normalized = Object.fromEntries(
      [...actual].map(([cell, privileges]) => [cell, [...privileges].sort()]),
    )
    const expected = Object.fromEntries(
      Object.entries(TABLE_PRIVILEGES).flatMap(([table, byRole]) =>
        Object.entries(byRole).map(([role, privileges]) => [
          key(table, role),
          [...privileges].sort(),
        ]),
      ),
    )

    expect(normalized).toEqual(expected)
  })

  it('전 테이블·전 롤에서 권한이 DML 넷의 부분집합이다', async () => {
    // §7.1의 사고를 직접 겨냥한다. 위 단언이 화이트리스트라면 이것은
    // 블랙리스트다 — TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 유입을 잡는다.
    // TRUNCATE는 RLS 적용 대상이 아니므로 권한 층에서만 막힌다
    const leaked = await asOwner<{
      relname: string
      grantee: string
      privilege_type: string
    }>(
      `select c.relname, a.grantee::regrole::text as grantee, a.privilege_type
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and a.grantee::regrole::text = any($1)
          and a.privilege_type <> all($2)
        order by c.relname, grantee, a.privilege_type`,
      [ROLES, DML_PRIVILEGES],
    )
    expect(leaked.rows).toEqual([])
  })

  it('열 단위 권한이 매트릭스와 정확히 일치한다 — 권한 종류와 롤까지', async () => {
    // pg_attribute.attacl 은 명시적 열 GRANT 만 담는다.
    // information_schema.column_privileges 는 테이블 권한을 전 열로 펼쳐서
    // 보여주므로 "열 단위로만 부여됨"을 표현하지 못한다.
    //
    // **권한 종류를 하드코딩하지 않는다** (P3a 7단계). 실측한 attacl에서
    // display_name은 `{authenticated=rw/postgres}` — 한 항목에 SELECT와 UPDATE가
    // 함께 있다. 종류를 'UPDATE'로 고정하면 열 단위 SELECT를 표현할 수 없고,
    // UPDATE가 늘어난 열도 잡지 못한다.
    //
    // **롤도 고정하지 않는다** (P5b 컷 2). 종전 질의는 `grantee =
    // 'authenticated'::regrole`로 박혀 있어 `service_role`에 열 GRANT가 생기면
    // 보이지 않았다
    const granted = await asOwner<{
      relname: string
      attname: string
      grantee: string
      privilege_type: string
    }>(
      `select c.relname, at.attname, a.grantee::regrole::text as grantee,
              a.privilege_type
         from pg_attribute at
         join pg_class c on c.oid = at.attrelid
         cross join lateral aclexplode(at.attacl) a
        where c.relnamespace = 'public'::regnamespace
          and at.attacl is not null
          and a.grantee::regrole::text = any($1)
        order by c.relname, at.attname, grantee, a.privilege_type`,
      [ROLES],
    )

    const expected = Object.entries(COLUMN_PRIVILEGES)
      .flatMap(([relname, columns]) =>
        Object.entries(columns).flatMap(([attname, byRole]) =>
          Object.entries(byRole).flatMap(([grantee, privileges]) =>
            [...privileges]
              .sort()
              .map((privilege_type) => ({
                relname,
                attname,
                grantee,
                privilege_type,
              })),
          ),
        ),
      )
      .sort(
        (a, b) =>
          a.relname.localeCompare(b.relname) ||
          a.attname.localeCompare(b.attname) ||
          a.grantee.localeCompare(b.grantee) ||
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

  it('신규 객체 기본 권한에 세 롤 중 어느 것도 없다', async () => {
    // 마이그레이션의 alter default privileges 회수를 검증한다. 이 단언이
    // 없으면 플랫폼이 기본값을 재시딩할 때 TRUNCATE 구멍이 신호 없이 돌아온다.
    //
    // **`service_role`을 포함하는 것이 시퀀스 축의 유일한 방어다** (P5b 컷 2).
    // 스키마에 시퀀스가 0개이므로 카탈로그 축은 항진명제이고, 회수 전 실측값은
    //   postgres/r = {postgres=arwdDxtm/postgres, service_role=Dxtm/postgres}
    //   postgres/S = {postgres=rwU/postgres,      service_role=w/postgres}
    // 였다 — 즉 신규 테이블이 DELETE·TRUNCATE를, 신규 시퀀스가 UPDATE(=setval)를
    // 자동으로 받았다. 「0 DML」이 **미래 객체에는 거짓**이었던 자리다
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
          and a.grantee::regrole::text = any($1)
        order by d.defaclobjtype, a.grantee, a.privilege_type`,
      [ROLES],
    )
    expect(defaults.rows).toEqual([])
  })

  it('public의 시퀀스에 부여된 권한이 없다', async () => {
    // **이 단언은 지금 항진명제다** — 스키마에 시퀀스가 0개다(전부
    // gen_random_uuid()). 그 사실을 함께 단언해 축이 비어 있는 **이유**를
    // 고정한다: 시퀀스가 하나라도 생기면 아래 첫 단언이 먼저 실패하고,
    // 그때 이 검사가 실질을 갖는다.
    //
    // 시퀀스의 실제 방어는 위 기본 ACL 단언이다(신규 시퀀스가 기본 권한을
    // 받는다). 여기는 **직접 GRANT**를 막는 축이며 그 경로는 기본 권한 회수가
    // 덮지 못한다
    const sequences = await asOwner<{ relname: string }>(
      `select c.relname from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
        order by c.relname`,
    )
    expect(sequences.rows).toEqual([])

    const granted = await asOwner<{ relname: string; grantee: string }>(
      `select c.relname, a.grantee::regrole::text as grantee
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and a.grantee::regrole::text = any($1)`,
      [ROLES],
    )
    expect(granted.rows).toEqual([])
  })
})

/**
 * `service_role`의 0 DML — AQ-11, DOC-010 v2.2 §7.1
 *
 * **위 매트릭스만으로는 부족하다.** 「비었다」는 두 이유로 초록이다 — 권한이
 * 없어서, 또는 **질의 형태가 틀려서**다. 롤 이름을 오타 내거나 `regrole` 캐스팅을
 * 틀리면 0행이 나오고 매트릭스는 통과한다.
 *
 * 그래서 여기서는 방향을 뒤집는다. `has_table_privilege`로 **참이어야 하는 것과
 * 거짓이어야 하는 것을 같은 질의에서** 묻고, 마지막으로 실제 롤로 들어가 DML을
 * 시도한다.
 */
describe('service_role은 아무 권한도 갖지 않는다 (AQ-11)', () => {
  it('증명 단언 — service_role은 users를 읽을 수 없고 authenticated는 assets를 읽는다', async () => {
    // 양성 대조가 같은 행에 있어야 "질의 형태가 틀려서 f"가 배제된다.
    //
    // ★ 양성 대조에 `users`를 쓰지 않는다 — `authenticated`의 `users` 권한은
    //   **열 단위**이고 `has_table_privilege`는 테이블 전체를 묻는다. 실측으로
    //   `has_table_privilege('authenticated','public.users','SELECT')`는 **f**다.
    //   그것을 양성 대조로 쓰면 대조 자체가 무효가 된다
    const probe = await asOwner<{
      positive: boolean
      negative: boolean
      negative_write: boolean
    }>(
      `select has_table_privilege('authenticated', 'public.assets', 'SELECT') as positive,
              has_table_privilege('service_role',  'public.users',  'SELECT') as negative,
              has_table_privilege('service_role',  'public.asset_prices', 'INSERT') as negative_write`,
    )

    expect(probe.rows[0]).toEqual({
      positive: true,
      negative: false,
      negative_write: false,
    })
  })

  it('TRUNCATE·DELETE도 없다 — AQ-11이 지목한 CASCADE 경로가 닫힌다', async () => {
    // asset_prices의 DELETE 는 시세 이력 전체 소실로 이어지는 경로이며
    // (AQ-11), TRUNCATE 는 RLS 적용 대상이 아니라 권한 층에서만 막힌다.
    // service_role 은 rolbypassrls 이므로 **정책은 여기서 아무 방어도 아니다**
    const probe = await asOwner<{ table_name: string; privilege_type: string }>(
      `select c.relname as table_name, a.privilege_type
         from pg_class c
         cross join lateral aclexplode(c.relacl) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and a.grantee = 'service_role'::regrole
        order by c.relname, a.privilege_type`,
    )
    expect(probe.rows).toEqual([])
  })

  it('실제 롤로 들어가면 조회가 42501이다', async () => {
    // 카탈로그가 아니라 **실행**으로 확인한다. rolbypassrls 이므로 관측되는
    // 것은 권한 층뿐이고 거부 형태는 permission denied 하나다
    await expectPermissionDenied(() =>
      actingAsServiceRole().query('select id from public.assets'),
    )
  })

  /**
   * ★ **문장이 전부 유효해야 한다.** 처음 쓴 INSERT는 `asset_type`을 빠뜨려
   * 회수 전에 `23502`(not-null)로 죽었다 — 즉 그 케이스는 「권한이 막았다」와
   * 「내 SQL이 깨졌다」를 구별하지 못했고, 회수 후에 초록이 되는 이유가
   * **권한 검사가 제약 평가보다 앞선다는 실행 순서**일 뿐이었다.
   *
   * 유효한 행을 쓰면 통과를 막는 것이 권한 하나로 남는다. 회수 전에는
   * 「거부되어야 할 문장이 성공했다」로, 회수 후에는 `42501`로 갈린다.
   */
  it.each([
    {
      label: 'INSERT',
      sql: `insert into public.assets (name, asset_type, market, currency)
            values ('배치프로브', 'STOCK', 'KRX', 'KRW')`,
    },
    { label: 'UPDATE', sql: `update public.assets set name = '배치프로브'` },
    { label: 'DELETE', sql: `delete from public.assets` },
    { label: 'TRUNCATE', sql: `truncate public.asset_prices` },
  ])('실제 롤로 들어가면 $label이 42501이다', async ({ sql }) => {
    await expectPermissionDenied(() => actingAsServiceRole().query(sql))
  })

  it('가장 상태가 새지 않는다 — service_role도 같다', async () => {
    await expectPermissionDenied(() =>
      actingAsServiceRole().query('select id from public.assets'),
    )
    const after = await asOwner<{ role: string }>('select current_user as role')
    expect(after.rows[0].role).toBe('postgres')
  })
})
