import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import {
  seedAsset,
  seedCouponPayment,
  seedCouponSchedule,
  seedMonthlyProduct,
  seedProduct,
  seedSchedule,
  seedUnderlying,
  type SeededProduct,
} from './helpers/seed'
import { expectNoRowsAffected, expectRlsViolation } from './helpers/expect'

/**
 * `els_products` 하위 — DOC-010 §7 "els_products 및 하위"
 *
 * 소유권 판정이 부모 상품을 경유하므로, 상품 자체와는 다른 실패 모드가 있다.
 * 특히 **재부모화**(자기 행의 `els_id`를 타인 상품으로 바꾸기)는 `with check`가
 * 없으면 통과하며, 그 결과 타인의 상품 구성이 변조된다.
 */

type ChildTable = {
  table: string
  /**
   * 부모 상품을 만든다 — 기본은 `seedProduct`(상환 시 지급). 월수익 지급 기록은 **월지급 부모와 그 달의 일정 행**이
   * 있어야 트리거(I-27)와 복합 FK를 지난다 — 그래야 아래 거부가 «정책»의 거부다(제약이 먼저 막으면 정책을
   * 증명하지 못한다 — 위 `redemption_schedules`의 열 선택과 같은 규율). P8 컷 b2
   */
  parent?: (params: { ownerId: string; name?: string }) => Promise<SeededProduct>
  /** 소유자가 만든 하위 행 1건 */
  seed: (elsId: string) => Promise<{ id: string }>
  /** 소유권과 무관한 값 변경 */
  mutate: string
  /** 소유자 상품에 새 행을 넣는 문장 */
  insert: string
  insertParams: (elsId: string, assetId: string) => readonly unknown[]
}

const CHILDREN: readonly ChildTable[] = [
  {
    table: 'els_underlyings',
    seed: async (elsId) => {
      const asset = await seedAsset({ name: `자산-${elsId.slice(0, 8)}` })
      return seedUnderlying({ elsId, assetId: asset.id })
    },
    mutate: 'update public.els_underlyings set base_price = 999.000000 where id = $1',
    insert: `insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
             values ($1, $2, 100.000000, 9)`,
    insertParams: (elsId, assetId) => [elsId, assetId],
  },
  {
    table: 'redemption_schedules',
    seed: (elsId) => seedSchedule({ elsId }),
    // 배리어를 낮추면 리자드 배리어(0.85)가 초과되어 I-04에 걸린다.
    // 소유권과 무관한 열을 골라 정책만 시험한다.
    //
    // evaluation_date 는 I-13(복합 FK)도 함께 피한다 — round_no 를 바꾸면
    // 그 차수를 가리키는 상환이 있을 때 23503 이 되어 정책이 아니라 제약을
    // 증명하게 된다. 이 케이스들에는 상환이 없으므로 지금은 무해하지만,
    // 열 선택이 두 제약을 동시에 피하고 있다는 사실을 남긴다
    mutate: `update public.redemption_schedules
               set evaluation_date = '2030-12-31' where id = $1`,
    insert: `insert into public.redemption_schedules
               (els_id, round_no, evaluation_date, barrier)
             values ($1, 9, '2030-01-02', 0.9000)`,
    insertParams: (elsId) => [elsId],
  },
  {
    // P8 컷 b2 — 월수익 일정(DOC-002 §4.13). 배리어는 동결 대상이 아니므로(`BEFORE UPDATE OF evaluation_date,
    // payment_date, coupon_no` — 그 열이 SET에 없으면 트리거가 아예 돌지 않는다) 정책만 시험한다
    table: 'monthly_coupon_schedules',
    parent: seedMonthlyProduct,
    seed: (elsId) => seedCouponSchedule({ elsId, couponNo: 1, evaluationDate: '2026-11-16' }),
    mutate: 'update public.monthly_coupon_schedules set coupon_barrier = 0.5500 where id = $1',
    insert: `insert into public.monthly_coupon_schedules
               (els_id, coupon_no, evaluation_date, payment_date, coupon_barrier)
             values ($1, 9, '2027-06-16', '2027-06-21', 0.6000)`,
    insertParams: (elsId) => [elsId],
  },
  {
    // P8 컷 b2 — 월수익 지급 기록(DOC-002 §4.14). 부모가 월지급이고 1번째 달의 일정이 있으므로 기록 쪽 트리거
    // (I-27)와 복합 FK를 지난다. 재부모화 케이스의 «남의» 상품도 같은 시더라 1번째 달이 있다 — 그래서 그 거부는
    // FK가 아니라 `with check`의 거부다
    table: 'monthly_coupon_payments',
    parent: async (params) => {
      const product = await seedMonthlyProduct(params)
      await seedCouponSchedule({ elsId: product.id, couponNo: 1, evaluationDate: '2026-11-16' })
      return product
    },
    seed: (elsId) => seedCouponPayment({ elsId, couponNo: 1 }),
    mutate: `update public.monthly_coupon_payments set note = '정정' where id = $1`,
    insert: `insert into public.monthly_coupon_payments (els_id, coupon_no, outcome, is_confirmed)
             values ($1, 1, 'UNPAID', true)`,
    insertParams: (elsId) => [elsId],
  },
]

/** 표의 행마다 부모를 만든다 — `parent`가 없으면 상환 시 지급 상품이다 */
function parentOf(child: ChildTable, params: { ownerId: string; name?: string }) {
  return (child.parent ?? seedProduct)(params)
}

describe.each(CHILDREN)('$table — 부모 상품의 소유자만 변경한다', (child) => {
  it('B는 A 상품의 하위 행을 조회할 수 있다', async () => {
    const product = await parentOf(child, { ownerId: USER_A })
    const row = await child.seed(product.id)

    const seen = await actingAs(USER_B).query(
      `select id from public.${child.table} where id = $1`,
      [row.id],
    )
    expect(seen.rowCount).toBe(1)
  })

  it('A는 자기 상품에 하위 행을 추가한다', async () => {
    const product = await parentOf(child, { ownerId: USER_A })
    const asset = await seedAsset({ name: `추가자산-${product.id.slice(0, 8)}` })

    const inserted = await actingAs(USER_A).query(
      child.insert,
      child.insertParams(product.id, asset.id),
    )
    expect(inserted.rowCount).toBe(1)
  })

  it('B는 A 상품에 하위 행을 추가할 수 없다', async () => {
    const product = await parentOf(child, { ownerId: USER_A })
    const asset = await seedAsset({ name: `침입자산-${product.id.slice(0, 8)}` })

    await expectRlsViolation(() =>
      actingAs(USER_B).query(child.insert, child.insertParams(product.id, asset.id)),
    )
  })

  it('B가 A 상품의 하위 행을 수정하면 0행이고 원본이 그대로다', async () => {
    const product = await parentOf(child, { ownerId: USER_A })
    const row = await child.seed(product.id)
    const before = await asOwner(`select * from public.${child.table} where id = $1`, [
      row.id,
    ])

    const attempt = await actingAs(USER_B).query(child.mutate, [row.id])
    expectNoRowsAffected(attempt)

    const after = await asOwner(`select * from public.${child.table} where id = $1`, [
      row.id,
    ])
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('B가 A 상품의 하위 행을 삭제하면 0행이고 원본이 남는다', async () => {
    // 이 상품에는 상환이 없다. redemption_schedules 행의 삭제가 정책만으로
    // 판정되는 것은 그 때문이다 — 상환이 가리키는 차수라면 I-13의 RESTRICT가
    // 먼저 23503으로 막는다(constraints.test.ts)
    const product = await parentOf(child, { ownerId: USER_A })
    const row = await child.seed(product.id)

    const attempt = await actingAs(USER_B).query(
      `delete from public.${child.table} where id = $1`,
      [row.id],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner(`select id from public.${child.table} where id = $1`, [
      row.id,
    ])
    expect(after.rowCount).toBe(1)
  })

  it('B는 자기 하위 행을 A의 상품 밑으로 옮길 수 없다 — 재부모화', async () => {
    // 재부모화를 시도하는 유일한 케이스다. 변경 전 행은 B의 소유이므로 using만
    // 보는 검사는 통과하고, 변경 후 행에 대한 검사만이 이를 막는다. with check를
    // (true)로 완화하면 다른 케이스는 전부 통과하고 여기서만 드러난다

    const mine = await parentOf(child, { ownerId: USER_B, name: 'B상품' })
    const theirs = await parentOf(child, { ownerId: USER_A, name: 'A상품' })
    const row = await child.seed(mine.id)

    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `update public.${child.table} set els_id = $2 where id = $1`,
        [row.id, theirs.id],
      ),
    )
  })

  it('A는 자기 하위 행을 수정·삭제한다 — 거부 케이스의 짝 통제', async () => {
    const product = await parentOf(child, { ownerId: USER_A })
    const row = await child.seed(product.id)

    const updated = await actingAs(USER_A).query(child.mutate, [row.id])
    expect(updated.rowCount).toBe(1)

    const deleted = await actingAs(USER_A).query(
      `delete from public.${child.table} where id = $1`,
      [row.id],
    )
    expect(deleted.rowCount).toBe(1)
  })
})
