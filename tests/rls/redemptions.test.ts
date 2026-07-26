import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { seedProduct, seedRedemption } from './helpers/seed'
import {
  expectConstraintViolation,
  expectNoRowsAffected,
  expectRlsViolation,
} from './helpers/expect'

/**
 * `redemptions` — DOC-010 §7 "조회: 전체 인증 사용자 / 변경: 상품 소유자"
 *
 * 다른 하위 테이블과 달리 여기에는 제약이 정책과 함께 작동한다. RLS 거부가
 * 제약 위반을 **가리지 않아야** DOC-011 §3.2의 오류 매핑이 성립한다 —
 * 42501은 FORBIDDEN, 23505는 CONFLICT다.
 */

describe('조회는 전체, 변경은 상품 소유자', () => {
  it('B는 A의 상환 실적을 조회할 수 있다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const { id } = await seedRedemption({ elsId: product.id })

    const seen = await actingAs(USER_B).query(
      'select id from public.redemptions where id = $1',
      [id],
    )
    expect(seen.rowCount).toBe(1)
  })

  it('A는 자기 상품에 상환을 등록한다 (DOC-011 §5.4)', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(
      `insert into public.redemptions
         (els_id, redemption_type, round_no, redemption_date,
          gross_amount, taxable_income, is_confirmed)
       values ($1, 'EARLY', 1, '2026-07-02', 104000000, 4000000, true)`,
      [product.id],
    )
    expect(created.rowCount).toBe(1)
  })

  it('B는 A의 상품에 상환을 등록할 수 없다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `insert into public.redemptions
           (els_id, redemption_type, round_no, redemption_date,
            gross_amount, taxable_income, is_confirmed)
         values ($1, 'EARLY', 1, '2026-07-02', 104000000, 4000000, true)`,
        [product.id],
      ),
    )
  })
})

describe('타 사용자의 과세 이력 변조 시도', () => {
  it('B가 A의 과세 금융소득을 수정하면 0행이고 원본이 그대로다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const { id } = await seedRedemption({ elsId: product.id, taxableIncome: '4000000' })

    const attempt = await actingAs(USER_B).query(
      'update public.redemptions set taxable_income = 0 where id = $1',
      [id],
    )
    expectNoRowsAffected(attempt)

    // 이 값이 바뀌면 A의 해당 연도 세액이 통째로 달라진다
    const after = await asOwner<{ taxable_income: string }>(
      'select taxable_income from public.redemptions where id = $1',
      [id],
    )
    expect(after.rows[0].taxable_income).toBe('4000000')
  })

  it('B가 A의 상환을 삭제하면 0행이고 원본이 남는다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const { id } = await seedRedemption({ elsId: product.id })

    const attempt = await actingAs(USER_B).query(
      'delete from public.redemptions where id = $1',
      [id],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner('select id from public.redemptions where id = $1', [id])
    expect(after.rowCount).toBe(1)
  })

  it('B는 자기 상환을 A의 상품에 붙일 수 없다 — 재부모화', async () => {
    // 대상은 상환 이력이 없는 A 상품이어야 한다. 이미 상환된 상품을 쓰면
    // UNIQUE(els_id)가 먼저 터져 23505가 나오고 RLS를 증명하지 못한다
    const mine = await seedProduct({ ownerId: USER_B, name: 'B상품' })
    const theirs = await seedProduct({ ownerId: USER_A, name: 'A상품(미상환)' })
    const { id } = await seedRedemption({ elsId: mine.id })

    await expectRlsViolation(() =>
      actingAs(USER_B).query('update public.redemptions set els_id = $2 where id = $1', [
        id,
        theirs.id,
      ]),
    )
  })

  it('A는 자기 상환을 수정·삭제한다 — 거부 케이스의 짝 통제', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const { id } = await seedRedemption({ elsId: product.id })

    const updated = await actingAs(USER_A).query(
      'update public.redemptions set note = $2 where id = $1',
      [id, '메모'],
    )
    expect(updated.rowCount).toBe(1)

    const deleted = await actingAs(USER_A).query(
      'delete from public.redemptions where id = $1',
      [id],
    )
    expect(deleted.rowCount).toBe(1)
  })
})

describe('제약이 정책에 가려지지 않는다', () => {
  it('I-01: 이미 상환된 상품에 또 등록하면 23505다', async () => {
    // 42501(FORBIDDEN)이 아니라 23505(CONFLICT)여야 DOC-011 §3.2의
    // 오류 매핑이 사용자에게 올바른 메시지를 준다
    const product = await seedProduct({ ownerId: USER_A })
    await seedRedemption({ elsId: product.id })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `insert into public.redemptions
             (els_id, redemption_type, redemption_date,
              gross_amount, taxable_income, is_confirmed)
           values ($1, 'MATURITY_GAIN', '2027-01-02', 110000000, 10000000, true)`,
          [product.id],
        ),
      '23505',
    )
  })

  it('상환 완료 상품은 삭제할 수 없다 — 23503 (DOC-002 §8.1)', async () => {
    // 하드 삭제를 택하되(DQ-01) 실현된 과세 이력만은 연쇄 삭제되지 않게 한다.
    // 소유자 본인이어도 상환을 먼저 취소해야 한다 (DOC-011 §5.3)
    const product = await seedProduct({ ownerId: USER_A })
    await seedRedemption({ elsId: product.id })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('delete from public.els_products where id = $1', [
          product.id,
        ]),
      '23503',
    )

    const survived = await asOwner('select id from public.redemptions where els_id = $1', [
      product.id,
    ])
    expect(survived.rowCount).toBe(1)
  })

  it('상환을 먼저 취소하면 상품이 삭제된다 — 2단계', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const { id } = await seedRedemption({ elsId: product.id })

    await actingAs(USER_A).query('delete from public.redemptions where id = $1', [id])
    const deleted = await actingAs(USER_A).query(
      'delete from public.els_products where id = $1',
      [product.id],
    )
    expect(deleted.rowCount).toBe(1)
  })
})
