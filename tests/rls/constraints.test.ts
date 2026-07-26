import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A } from './helpers/fixtures'
import { seedProduct } from './helpers/seed'
import { expectConstraintViolation } from './helpers/expect'

/**
 * DB 제약 — DOC-002 §8 무결성 규칙
 *
 * 정책이 아니라 제약을 시험한다. 이 스위트에 두는 이유는 DB가 필요하고,
 * 무엇보다 **RLS가 제약을 가리지 않는지**를 함께 확인해야 하기 때문이다.
 * 소유자 권한으로 시도해도 제약이 걸려야 하고, 그 오류 코드가 42501이 아니라
 * 23514·23505여야 DOC-011 §3.2의 오류 매핑이 사용자에게 올바른 메시지를 준다.
 */

describe('I-08 — 손실 상환의 과세 금융소득은 0이다', () => {
  const insert = `insert into public.redemptions
      (els_id, redemption_type, round_no, redemption_date,
       gross_amount, taxable_income, is_confirmed)
    values ($1, $2, null, '2027-01-02', $3, $4, true)`

  it('MATURITY_LOSS에 과세소득이 붙으면 거부한다', async () => {
    // 절대 규칙 #8. 이 값이 통과하면 해당 연도 금융소득이 부풀고 세액이 틀린다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(insert, [
          product.id,
          'MATURITY_LOSS',
          '90000000',
          '1000000',
        ]),
      '23514',
    )
  })

  it('소유자 본인이어도 거부한다 — RLS가 제약을 가리지 않는다', async () => {
    // 42501(FORBIDDEN)이 아니라 23514여야 한다. 정책은 통과하고 제약이 막는다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(insert, [
          product.id,
          'MATURITY_LOSS',
          '90000000',
          '-5000000',
        ]),
      '23514',
    )
  })

  it('MATURITY_LOSS + 과세소득 0은 통과한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_LOSS',
      '90000000',
      '0',
    ])
    expect(created.rowCount).toBe(1)
  })

  it('다른 상환 유형은 과세소득을 가질 수 있다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_GAIN',
      '120000000',
      '20000000',
    ])
    expect(created.rowCount).toBe(1)
  })

  it('UPDATE로 우회할 수 없다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_LOSS',
      '90000000',
      '0',
    ])

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          'update public.redemptions set taxable_income = 1000000 where els_id = $1',
          [product.id],
        ),
      '23514',
    )

    const after = await asOwner<{ taxable_income: string }>(
      'select taxable_income from public.redemptions where els_id = $1',
      [product.id],
    )
    expect(after.rows[0].taxable_income).toBe('0')
  })

  it('상환 유형을 손실로 바꾸는 UPDATE도 막힌다', async () => {
    // 이익 상환으로 등록한 뒤 유형만 손실로 바꾸는 경로. 제약은 변경 후 행을
    // 검사하므로 여기서도 걸린다
    const product = await seedProduct({ ownerId: USER_A })
    await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_GAIN',
      '120000000',
      '20000000',
    ])

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.redemptions set redemption_type = 'MATURITY_LOSS' where els_id = $1`,
          [product.id],
        ),
      '23514',
    )
  })
})

describe('I-10 — 리자드 배리어가 있으면 쿠폰율은 필수', () => {
  const insert = `insert into public.redemption_schedules
      (els_id, round_no, evaluation_date, barrier, lizard_barrier, lizard_coupon_rate)
    values ($1, 1, '2026-07-02', 0.90, $2, $3)`

  it('배리어만 있고 쿠폰율이 없으면 거부한다', async () => {
    // 통과하면 그 차수의 워스트오브가 리자드 배리어를 넘는 순간
    // applicableCouponRate가 화면 렌더링 중에 던진다 (DOC-007 §4.1)
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, '0.85', null]),
      '23514',
    )
  })

  it('원금상환형 리자드는 0으로 표기하며 통과한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(insert, [product.id, '0.85', '0'])
    expect(created.rowCount).toBe(1)
  })

  it('리자드가 없는 차수는 둘 다 NULL이어도 된다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(insert, [product.id, null, null])
    expect(created.rowCount).toBe(1)
  })
})

describe('I-04 — 리자드 배리어는 조기상환 배리어 이하', () => {
  it('조기상환 배리어를 초과하면 거부한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `insert into public.redemption_schedules
             (els_id, round_no, evaluation_date, barrier, lizard_barrier, lizard_coupon_rate)
           values ($1, 1, '2026-07-02', 0.90, 0.95, 0.02)`,
          [product.id],
        ),
      '23514',
    )
  })
})
