import { describe, expect, it } from 'vitest'
import { actingAs, anonymously, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { expectNoRowsAffected, expectPermissionDenied } from './helpers/expect'

/**
 * `users` — DOC-010 §7 "조회 전체 / 변경 본인 (display_name만)"
 *
 * 조회를 전체에 여는 근거는 DOC-011 §4.2·§4.3·§4.4의 `ownerName`이다.
 * 소유자 표시명을 읽을 수 없으면 "전체 조회"(S-10) 화면이 성립하지 않는다.
 *
 * 행 생성·삭제 경로는 없다. 계정은 초대(`auth.users`)로만 생기고(SEC-03)
 * 프로필 행은 트리거가 만든다(DOC-002 D-06).
 */

describe('조회는 전체 인증 사용자', () => {
  it('A는 B의 표시명을 조회한다 — ownerName 표시의 전제', async () => {
    const seen = await actingAs(USER_A).query<{ display_name: string }>(
      'select display_name from public.users where id = $1',
      [USER_B],
    )
    expect(seen.rows[0].display_name).toBe('테스트 사용자 B')
  })

  it('미인증은 조회할 수 없다', async () => {
    await expectPermissionDenied(() =>
      anonymously.query('select display_name from public.users'),
    )
  })
})

describe('변경은 본인의 표시명만', () => {
  it('A는 자기 표시명을 수정한다 (SCR-502)', async () => {
    const updated = await actingAs(USER_A).query(
      'update public.users set display_name = $2 where id = $1',
      [USER_A, '아버지'],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('B가 A의 표시명을 수정하면 0행이고 원본이 그대로다', async () => {
    const attempt = await actingAs(USER_B).query(
      'update public.users set display_name = $2 where id = $1',
      [USER_A, '탈취'],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner<{ display_name: string }>(
      'select display_name from public.users where id = $1',
      [USER_A],
    )
    expect(after.rows[0].display_name).toBe('테스트 사용자 A')
  })

  it('이메일은 수정할 수 없다 — 열 단위 권한', async () => {
    // email은 auth.users가 정본이고 트리거가 동기화한다. 여기서 바꾸면
    // 로그인 식별자와 표시값이 갈라진다
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('update public.users set email = $2 where id = $1', [
        USER_A,
        'hijack@example.test',
      ]),
    )
  })
})

describe('행 생성·삭제 경로가 없다 (SEC-03)', () => {
  it('사용자가 직접 프로필 행을 만들 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        `insert into public.users (id, email, display_name)
         values (gen_random_uuid(), 'fake@example.test', '위조')`,
      ),
    )
  })

  it('사용자가 프로필 행을 지울 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.users where id = $1', [USER_A]),
    )
  })
})

describe('Auth 연계 (DOC-002 D-06)', () => {
  it('시드 사용자의 프로필 행을 트리거가 만들었다', async () => {
    // supabase/seed/00_rls_test_users.sql은 auth.users에만 INSERT한다.
    // public.users 행이 존재한다는 것은 on_auth_user_created가 동작했다는 뜻이다
    const rows = await asOwner<{ id: string; display_name: string }>(
      'select id, display_name from public.users where id = any($1::uuid[]) order by id',
      [[USER_A, USER_B]],
    )
    expect(rows.rows.map((r) => r.display_name)).toEqual([
      '테스트 사용자 A',
      '테스트 사용자 B',
    ])
  })

  it('users.id가 auth.users.id와 같다', async () => {
    const matched = await asOwner<{ n: string }>(
      `select count(*)::text as n
         from public.users u join auth.users a on a.id = u.id
        where u.id = any($1::uuid[])`,
      [[USER_A, USER_B]],
    )
    expect(matched.rows[0].n).toBe('2')
  })
})
