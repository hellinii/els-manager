import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A } from './helpers/fixtures'
import { seedAsset, seedPrice, seedProduct, seedSchedule } from './helpers/seed'
import { expectConstraintViolation } from './helpers/expect'

/**
 * DB 제약 — DOC-002 §8 무결성 규칙
 *
 * 정책이 아니라 제약을 시험한다. 이 스위트에 두는 이유는 DB가 필요하고,
 * 무엇보다 **RLS가 제약을 가리지 않는지**를 함께 확인해야 하기 때문이다.
 * 소유자 권한으로 시도해도 제약이 걸려야 하고, 그 오류 코드가 42501이 아니라
 * 23514·23505여야 DOC-011 §3.2의 오류 매핑이 사용자에게 올바른 메시지를 준다.
 *
 * **이 파일의 모든 `expectConstraintViolation`은 제약 이름까지 단언한다.**
 * SQLSTATE만 보면 한 행이 두 제약을 동시에 위반할 때 어느 쪽이 보고되는지
 * 알 수 없고, 그 순서는 제약 이름 알파벳순이라는 PostgreSQL 구현 세부사항에
 * 의존한다. 나아가 **각 케이스가 한 번에 한 제약만 위반하도록** 데이터를
 * 구성한다 — 그러면 평가 순서와 무관하게 결과가 같다.
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
      'redemptions_maturity_loss_check',
    )
  })

  it('소유자 본인이어도 거부한다 — RLS가 제약을 가리지 않는다', async () => {
    // 42501(FORBIDDEN)이 아니라 23514여야 한다. 정책은 통과하고 제약이 막는다.
    //
    // 값이 **양수**인 것이 의도다. 음수를 쓰면 I-12(taxable_income >= 0)에도
    // 동시에 걸려 어느 제약이 보고되는지가 이름 알파벳순에 의존하게 된다.
    // 이 케이스는 I-08만 겨냥한다 — 음수는 I-12 describe에서 다룬다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(insert, [
          product.id,
          'MATURITY_LOSS',
          '90000000',
          '5000000',
        ]),
      '23514',
      'redemptions_maturity_loss_check',
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
      'redemptions_maturity_loss_check',
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
      'redemptions_maturity_loss_check',
    )
  })
})

describe('I-12 — 과세 금융소득은 0 이상이다', () => {
  const insert = `insert into public.redemptions
      (els_id, redemption_type, round_no, redemption_date,
       gross_amount, taxable_income, is_confirmed)
    values ($1, 'MATURITY_GAIN', null, '2027-01-02', $2, $3, true)`

  it('MATURITY_GAIN에 음수 과세소득이 붙으면 거부한다', async () => {
    // I-08은 MATURITY_LOSS만 덮는다. 이 경로가 열려 있으면 음수가 DOC-007
    // §7.3의 연도별 합계를 줄여 세액이 조용히 낮아진다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, '120000000', '-5000000']),
      '23514',
      'redemptions_taxable_income_check',
    )
  })

  it('0과 양수는 통과한다', async () => {
    const zero = await seedProduct({ ownerId: USER_A, name: '0원' })
    const positive = await seedProduct({ ownerId: USER_A, name: '양수' })

    expect(
      (await actingAs(USER_A).query(insert, [zero.id, '100000000', '0'])).rowCount,
    ).toBe(1)
    expect(
      (await actingAs(USER_A).query(insert, [positive.id, '120000000', '20000000']))
        .rowCount,
    ).toBe(1)
  })

  it('UPDATE로 음수화할 수 없고 원본이 그대로다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    await actingAs(USER_A).query(insert, [product.id, '120000000', '20000000'])

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          'update public.redemptions set taxable_income = -1 where els_id = $1',
          [product.id],
        ),
      '23514',
      'redemptions_taxable_income_check',
    )

    const after = await asOwner<{ taxable_income: string }>(
      'select taxable_income from public.redemptions where els_id = $1',
      [product.id],
    )
    expect(after.rows[0].taxable_income).toBe('20000000')
  })
})

describe('I-14 — 조기·리자드 상환은 차수를 갖는다', () => {
  const insert = `insert into public.redemptions
      (els_id, redemption_type, round_no, redemption_date,
       gross_amount, taxable_income, is_confirmed)
    values ($1, $2, $3, '2026-07-02', 104000000, 4000000, true)`

  it('EARLY인데 round_no가 없으면 거부한다', async () => {
    // I-13의 복합 FK는 MATCH SIMPLE이라 round_no IS NULL을 검사하지 않는다.
    // 거부하려던 바로 그 불량 행이 FK만으로는 통과하므로 이 제약이 필요하다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, 'EARLY', null]),
      '23514',
      'redemptions_round_no_required_check',
    )
  })

  it('LIZARD인데 round_no가 없으면 거부한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, 'LIZARD', null]),
      '23514',
      'redemptions_round_no_required_check',
    )
  })

  it('만기 상환은 round_no가 없어도 된다', async () => {
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_GAIN',
      null,
    ])
    expect(created.rowCount).toBe(1)
  })

  it('만기 상환에 차수를 기록하는 것은 금지하지 않는다 — 단방향 제약', async () => {
    // 쌍조건으로 쓰면 이 케이스가 막힌다. DOC-002 §4.9는 그것을 금지한 적이 없다
    const product = await seedProduct({ ownerId: USER_A })
    await seedSchedule({ elsId: product.id, roundNo: 6 })

    const created = await actingAs(USER_A).query(insert, [
      product.id,
      'MATURITY_GAIN',
      6,
    ])
    expect(created.rowCount).toBe(1)
  })
})

describe('I-13 — 상환의 차수는 실재해야 한다', () => {
  const insert = `insert into public.redemptions
      (els_id, redemption_type, round_no, redemption_date,
       gross_amount, taxable_income, is_confirmed)
    values ($1, 'EARLY', $2, '2026-07-02', 104000000, 4000000, true)`

  it('평가일정이 없는 상품에 1차 상환을 넣을 수 없다', async () => {
    // seedProduct는 일정을 만들지 않는다(DQ-05). 그래서 이 상태가 기본이다
    const product = await seedProduct({ ownerId: USER_A })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, 1]),
      '23503',
      'redemptions_els_id_round_no_fkey',
    )
  })

  it('실재하지 않는 차수를 가리킬 수 없다', async () => {
    // DOC-007 §7.2의 귀속연도가 이 차수의 evaluation_date로 결정된다.
    // 허수 차수는 세금 계산의 귀속연도를 결정 불가로 만든다
    const product = await seedProduct({ ownerId: USER_A })
    await seedSchedule({ elsId: product.id, roundNo: 1 })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, 99]),
      '23503',
      'redemptions_els_id_round_no_fkey',
    )
  })

  it('실재하는 차수는 통과한다 — 짝 통제', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    await seedSchedule({ elsId: product.id, roundNo: 3 })

    const created = await actingAs(USER_A).query(insert, [product.id, 3])
    expect(created.rowCount).toBe(1)
  })

  it('타 상품의 차수를 가리킬 수 없다 — els_id가 함께 검사된다', async () => {
    const mine = await seedProduct({ ownerId: USER_A, name: '내 상품' })
    const other = await seedProduct({ ownerId: USER_A, name: '다른 상품' })
    await seedSchedule({ elsId: other.id, roundNo: 4 })

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [mine.id, 4]),
      '23503',
      'redemptions_els_id_round_no_fkey',
    )
  })

  it('상환이 가리키는 일정 행은 삭제할 수 없다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const schedule = await seedSchedule({ elsId: product.id, roundNo: 1 })
    await actingAs(USER_A).query(insert, [product.id, 1])

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('delete from public.redemption_schedules where id = $1', [
          schedule.id,
        ]),
      '23503',
      'redemptions_els_id_round_no_fkey',
    )
  })

  it('상환이 가리키는 일정의 차수 번호는 바꿀 수 없다', async () => {
    // 상환의 귀속 차수가 사후에 다른 차수를 가리키게 되는 경로를 없앤다
    const product = await seedProduct({ ownerId: USER_A })
    const schedule = await seedSchedule({ elsId: product.id, roundNo: 1 })
    await actingAs(USER_A).query(insert, [product.id, 1])

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          'update public.redemption_schedules set round_no = 2 where id = $1',
          [schedule.id],
        ),
      '23503',
      'redemptions_els_id_round_no_fkey',
    )
  })

  it('round_no가 NULL이면 검사하지 않는다 — MATCH SIMPLE', async () => {
    // MATCH FULL로 잘못 쓰면 여기서만 드러난다. 만기 상환이 표현 불가가 된다
    const product = await seedProduct({ ownerId: USER_A })

    const created = await actingAs(USER_A).query(
      `insert into public.redemptions
         (els_id, redemption_type, round_no, redemption_date,
          gross_amount, taxable_income, is_confirmed)
       values ($1, 'MATURITY_GAIN', null, '2027-01-02', 110000000, 10000000, true)`,
      [product.id],
    )
    expect(created.rowCount).toBe(1)
  })
})

describe('I-11 — KI 배리어와 관찰 방식은 짝을 이룬다', () => {
  const insert = `insert into public.els_products
      (owner_id, name, issue_date, principal, evaluation_period_months,
       annual_coupon_rate, ki_barrier, ki_observation,
       ki_touched_at, account_type)
    values ($1, 'KI 짝 검증', '2026-01-02', 100000000, 6, 0.08, $2, $3, $4, 'GENERAL')`

  it('배리어만 있고 관찰 방식이 없으면 거부한다', async () => {
    // DOC-007 §3.4 보조 판정이 CONTINUOUS와 CLOSING 중 무엇으로 관측할지
    // 결정할 수 없다. 두 방식은 요구하는 데이터가 다르다(D-04)
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [USER_A, '0.50', null, null]),
      '23514',
      'els_products_ki_pair_check',
    )
  })

  it('관찰 방식만 있고 배리어가 없으면 거부한다', async () => {
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [USER_A, null, 'CLOSING', null]),
      '23514',
      'els_products_ki_pair_check',
    )
  })

  it('둘 다 있거나 둘 다 없으면 통과한다', async () => {
    expect(
      (await actingAs(USER_A).query(insert, [USER_A, '0.50', 'CLOSING', null])).rowCount,
    ).toBe(1)
    // 둘 다 NULL = 노낙인 상품
    expect(
      (await actingAs(USER_A).query(insert, [USER_A, null, null, null])).rowCount,
    ).toBe(1)
  })
})

describe('I-15 — 노낙인 상품에 터치 이력이 붙을 수 없다', () => {
  const insert = `insert into public.els_products
      (owner_id, name, issue_date, principal, evaluation_period_months,
       annual_coupon_rate, ki_barrier, ki_observation,
       ki_touched_at, account_type)
    values ($1, 'KI 터치 검증', '2026-01-02', 100000000, 6, 0.08, $2, $3, $4, 'GENERAL')`

  it('배리어 없이 터치 이력만 있으면 거부한다', async () => {
    // 통과하면 DOC-007 E-06이 그 이력을 무시한다. lizard_requires_no_ki인
    // 차수가 KI 터치됐는데도 리자드 충족으로 판정되고 수령액이 틀린다.
    //
    // ki_observation도 NULL이므로 I-11에는 걸리지 않는다 — 이 케이스는
    // I-15만 겨냥한다
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [USER_A, null, null, '2026-03-15']),
      '23514',
      'els_products_ki_touched_check',
    )
  })

  it('배리어가 있으면 터치 이력을 가질 수 있다', async () => {
    const created = await actingAs(USER_A).query(insert, [
      USER_A,
      '0.50',
      'CLOSING',
      '2026-03-15',
    ])
    expect(created.rowCount).toBe(1)
  })

  it('UPDATE로 배리어만 비울 수 없다 — 낙인형 해제 시 터치 이력도 함께', async () => {
    // DOC-011 §5.2가 계약 계층에 같은 규칙을 둔다(V-16·V-18)
    const created = await actingAs(USER_A).query<{ id: string }>(
      `${insert} returning id`,
      [USER_A, '0.50', 'CLOSING', '2026-03-15'],
    )
    const id = created.rows[0].id

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.els_products
              set ki_barrier = null, ki_observation = null
            where id = $1`,
          [id],
        ),
      '23514',
      'els_products_ki_touched_check',
    )

    // 셋을 함께 비우면 통과한다
    const cleared = await actingAs(USER_A).query(
      `update public.els_products
          set ki_barrier = null, ki_observation = null, ki_touched_at = null
        where id = $1`,
      [id],
    )
    expect(cleared.rowCount).toBe(1)
  })
})

describe('I-16 — 시세 관측의 좌표는 불변이다', () => {
  it('asset_id를 바꿀 수 없다', async () => {
    // 통과하면 시세가 타인 자산으로 재부모화되어 그 자산을 쓰는 상품의
    // 워스트오브가 조용히 바뀐다. 시세 삭제와 달리 E-01로 드러나지도 않는다
    const from = await seedAsset({ name: '원래자산' })
    const to = await seedAsset({ name: '표적자산' })
    const price = await seedPrice({ assetId: from.id })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('update public.asset_prices set asset_id = $2 where id = $1', [
          price.id,
          to.id,
        ]),
      '23514',
      'asset_prices_coordinates_immutable',
    )
  })

  it('as_of_date를 바꿀 수 없다', async () => {
    // DOC-007 §3.1의 "최신가"는 as_of_date가 가장 큰 행이다. 재날짜화는
    // 어느 값이 현재가인지를 이동시킨다
    const asset = await seedAsset({ name: '테슬라' })
    const price = await seedPrice({ assetId: asset.id, asOfDate: '2026-07-01' })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.asset_prices set as_of_date = '2026-07-09' where id = $1`,
          [price.id],
        ),
      '23514',
      'asset_prices_coordinates_immutable',
    )
  })

  it('관측값(price·source·provider)은 수정할 수 있다 — 짝 통제', async () => {
    const asset = await seedAsset({ name: '테슬라' })
    const price = await seedPrice({ assetId: asset.id })

    const updated = await actingAs(USER_A).query(
      `update public.asset_prices
          set price = 400.000000, source = 'AUTO', provider = 'stub'
        where id = $1`,
      [price.id],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('created_at은 동결 대상이 아니다', async () => {
    // 좌표가 아니고 어떤 판정도 읽지 않는다. 동결하면 timestamptz(μs) ↔
    // JS Date(ms) 정밀도 차이로 되싣기 UPSERT가 깨진다
    const asset = await seedAsset({ name: '테슬라' })
    const price = await seedPrice({ assetId: asset.id })

    const updated = await actingAs(USER_A).query(
      'update public.asset_prices set created_at = now() where id = $1',
      [price.id],
    )
    expect(updated.rowCount).toBe(1)
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
      'redemption_schedules_lizard_coupon_check',
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
      'redemption_schedules_lizard_barrier_check',
    )
  })
})

describe('assets — UNIQUE NULLS NOT DISTINCT (name, market)', () => {
  // 스키마 주석이 가장 긴 논거를 붙인 결정인데 회귀 감지 수단이 없었다.
  // nulls not distinct 가 빠지면 한 자산이 두 asset_id 와 두 개의 독립된
  // 시세 계열로 갈라지고, §4.3의 "동일 기초자산 중복 해소"가 시장 정보 없는
  // 자산에 대해서만 조용히 깨진다. supabase db diff 재생성으로 사라질 수 있다
  const insert = `insert into public.assets (name, asset_type, market, currency)
    values ($1, 'INDEX', $2, 'USD')`

  it('market이 NULL인 동일 이름 자산을 두 번 넣을 수 없다', async () => {
    await actingAs(USER_A).query(insert, ['S&P 500', null])

    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, ['S&P 500', null]),
      '23505',
      'assets_name_market_key',
    )
  })

  it('market이 다르면 같은 이름이 허용된다', async () => {
    await actingAs(USER_A).query(insert, ['동일이름', 'NASDAQ'])

    const created = await actingAs(USER_A).query(insert, ['동일이름', 'NYSE'])
    expect(created.rowCount).toBe(1)
  })
})
