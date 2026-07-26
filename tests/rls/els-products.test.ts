import { describe, expect, it } from 'vitest'
import { actingAs, anonymously, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { seedProduct } from './helpers/seed'
import {
  expectNoRowsAffected,
  expectPermissionDenied,
  expectRlsViolation,
} from './helpers/expect'

/**
 * `els_products` — DOC-010 §7 "조회: 전체 인증 사용자 / 변경: 소유자"
 * ADR-002, S-10, CLAUDE.md 절대 규칙 #6
 */

describe('조회는 전체 인증 사용자 (S-10)', () => {
  it('B는 A의 상품을 조회할 수 있다 — 가족 간 현황 공유', async () => {
    const { id } = await seedProduct({ ownerId: USER_A, name: 'A상품' })

    const seen = await actingAs(USER_B).query(
      'select id from public.els_products where id = $1',
      [id],
    )
    expect(seen.rowCount).toBe(1)
  })

  it('미인증은 조회할 수 없다 (SEC-03)', async () => {
    await seedProduct({ ownerId: USER_A })

    await expectPermissionDenied(() =>
      anonymously.query('select id from public.els_products'),
    )
  })
})

describe('생성은 본인 명의로만', () => {
  it('A는 자기 명의로 상품을 만든다', async () => {
    const created = await actingAs(USER_A).query<{ id: string }>(
      `insert into public.els_products
         (owner_id, name, issue_date, principal, evaluation_period_months,
          total_rounds, annual_coupon_rate, account_type)
       values ($1, '내 상품', '2026-01-02', 100000000, 6, 6, 0.08, 'GENERAL')
       returning id`,
      [USER_A],
    )
    expect(created.rowCount).toBe(1)
  })

  it('B는 A 명의로 상품을 만들 수 없다', async () => {
    // DOC-011 §5.1의 "owner_id는 인증 사용자로 서버에서 설정한다"를
    // 계약 계층이 아니라 DB가 강제한다
    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `insert into public.els_products
           (owner_id, name, issue_date, principal, evaluation_period_months,
            total_rounds, annual_coupon_rate, account_type)
         values ($1, 'B가 A 명의로 만든 상품', '2026-01-02', 100000000, 6, 6, 0.08, 'GENERAL')`,
        [USER_A],
      ),
    )
  })
})

describe('변경은 소유자만 — 타 사용자 수정 시도', () => {
  it('A는 자기 상품을 수정한다', async () => {
    const { id } = await seedProduct({ ownerId: USER_A, name: 'A상품' })

    const updated = await actingAs(USER_A).query(
      'update public.els_products set name = $2 where id = $1',
      [id, '이름 변경'],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('B가 A의 상품을 수정하면 0행이고 원본이 그대로다', async () => {
    const { id } = await seedProduct({ ownerId: USER_A, name: 'A상품' })

    // RLS는 USING으로 행을 감춘다. 오류가 아니라 "그런 행이 없다"로 끝난다
    const attempt = await actingAs(USER_B).query(
      'update public.els_products set name = $2 where id = $1',
      [id, '탈취'],
    )
    expectNoRowsAffected(attempt)

    // 0행이 "권한 없음"이지 "행 없음"이 아님을 소유자 권한 재조회로 확정한다
    const after = await asOwner<{ name: string }>(
      'select name from public.els_products where id = $1',
      [id],
    )
    expect(after.rows[0].name).toBe('A상품')
  })

  it('A는 자기 상품의 소유자를 B에게 넘길 수 없다', async () => {
    // 변경 후 행에 대한 검사만이 이를 막는다. with check를 (true)로 완화하면
    // 이 케이스에서만 드러난다. 소유권 이전 경로는 계약에 없다(I-09의 정신)
    const { id } = await seedProduct({ ownerId: USER_A })

    await expectRlsViolation(() =>
      actingAs(USER_A).query(
        'update public.els_products set owner_id = $2 where id = $1',
        [id, USER_B],
      ),
    )
  })
})

describe('삭제는 소유자만', () => {
  it('A는 자기 상품을 삭제한다', async () => {
    const { id } = await seedProduct({ ownerId: USER_A })

    const deleted = await actingAs(USER_A).query(
      'delete from public.els_products where id = $1',
      [id],
    )
    expect(deleted.rowCount).toBe(1)
  })

  it('B가 A의 상품을 삭제하면 0행이고 원본이 남는다', async () => {
    const { id } = await seedProduct({ ownerId: USER_A })

    const attempt = await actingAs(USER_B).query(
      'delete from public.els_products where id = $1',
      [id],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner('select id from public.els_products where id = $1', [id])
    expect(after.rowCount).toBe(1)
  })
})
