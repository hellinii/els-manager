import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { seedTaxProfile } from './helpers/seed'
import { expectNoRowsAffected, expectRlsViolation } from './helpers/expect'

/**
 * `tax_profiles` — DOC-010 §7에서 **유일하게 조회를 제한하는 테이블**
 *
 * "금융소득 외 종합소득 과세표준은 ELS와 무관한 개인 소득 정보이므로,
 * 전체 공개 대상인 보유 현황과 성격이 다르다."
 *
 * 조회 제한은 오류가 아니라 **빈 결과**로 나타난다. 이 차이를 P3의 조회
 * 함수가 알아야 한다 — 0행이 "없음"이 아니라 "볼 수 없음"일 수 있다.
 */

describe('조회도 본인만', () => {
  it('A는 자기 과세 프로필을 조회한다', async () => {
    await seedTaxProfile({ userId: USER_A })

    const seen = await actingAs(USER_A).query(
      'select id from public.tax_profiles where user_id = $1',
      [USER_A],
    )
    expect(seen.rowCount).toBe(1)
  })

  it('B는 A의 과세 프로필을 조회할 수 없다 — 오류가 아니라 빈 결과다', async () => {
    await seedTaxProfile({ userId: USER_A })

    const hidden = await actingAs(USER_B).query(
      'select id from public.tax_profiles where user_id = $1',
      [USER_A],
    )
    expect(hidden.rowCount).toBe(0)

    // 행이 실제로 존재함을 확인해야 "0행 = 볼 수 없음"이 증명된다
    const exists = await asOwner('select id from public.tax_profiles where user_id = $1', [
      USER_A,
    ])
    expect(exists.rowCount).toBe(1)
  })

  it('전체 조회를 해도 타인의 행은 섞이지 않는다', async () => {
    await seedTaxProfile({ userId: USER_A })
    await seedTaxProfile({ userId: USER_B })

    const mine = await actingAs(USER_A).query<{ user_id: string }>(
      'select user_id from public.tax_profiles',
    )
    expect(mine.rows.map((r) => r.user_id)).toEqual([USER_A])
  })
})

describe('타 사용자의 과세 프로필 변조 시도', () => {
  it('B는 A 명의로 프로필을 만들 수 없다', async () => {
    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `insert into public.tax_profiles
           (user_id, tax_year, other_income_base, other_financial_income, health_insurance_type)
         values ($1, 2026, 0, 0, 'NONE')`,
        [USER_A],
      ),
    )
  })

  it('B가 A의 프로필을 수정하면 0행이고 원본이 그대로다', async () => {
    await seedTaxProfile({ userId: USER_A })

    const attempt = await actingAs(USER_B).query(
      'update public.tax_profiles set other_income_base = 0 where user_id = $1',
      [USER_A],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner<{ other_income_base: string }>(
      'select other_income_base from public.tax_profiles where user_id = $1',
      [USER_A],
    )
    expect(after.rows[0].other_income_base).toBe('50000000')
  })

  it('B가 A의 프로필을 삭제하면 0행이고 원본이 남는다', async () => {
    await seedTaxProfile({ userId: USER_A })

    const attempt = await actingAs(USER_B).query(
      'delete from public.tax_profiles where user_id = $1',
      [USER_A],
    )
    expectNoRowsAffected(attempt)

    const after = await asOwner('select id from public.tax_profiles where user_id = $1', [
      USER_A,
    ])
    expect(after.rowCount).toBe(1)
  })

  it('A는 자기 프로필의 소유자를 B로 바꿀 수 없다', async () => {
    const { id } = await seedTaxProfile({ userId: USER_A })

    await expectRlsViolation(() =>
      actingAs(USER_A).query('update public.tax_profiles set user_id = $2 where id = $1', [
        id,
        USER_B,
      ]),
    )
  })
})

describe('UPSERT — DOC-011 §5.6 saveTaxProfile', () => {
  it('본인 프로필의 UPSERT가 동작한다', async () => {
    await seedTaxProfile({ userId: USER_A, taxYear: 2026 })

    const upserted = await actingAs(USER_A).query(
      `insert into public.tax_profiles
         (user_id, tax_year, other_income_base, other_financial_income, health_insurance_type)
       values ($1, 2026, 70000000, 1000000, 'REGIONAL')
       on conflict (user_id, tax_year) do update
         set other_income_base = excluded.other_income_base,
             other_financial_income = excluded.other_financial_income,
             health_insurance_type = excluded.health_insurance_type`,
      [USER_A],
    )
    expect(upserted.rowCount).toBe(1)

    const after = await asOwner<{ other_income_base: string }>(
      'select other_income_base from public.tax_profiles where user_id = $1',
      [USER_A],
    )
    expect(after.rows[0].other_income_base).toBe('70000000')
  })

  it('타인의 슬롯에 UPSERT하면 정책 위반으로 실패한다', async () => {
    // ON CONFLICT DO UPDATE는 실패 형태가 다른 변경과 다르다. 충돌 대상 행에
    // UPDATE 정책의 USING이 적용되고, 통과하지 못하면 조용한 0행이 아니라
    // 42501을 던진다. P3가 추측하지 않도록 실제 형태를 여기서 못박는다
    await seedTaxProfile({ userId: USER_A, taxYear: 2026 })

    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `insert into public.tax_profiles
           (user_id, tax_year, other_income_base, other_financial_income, health_insurance_type)
         values ($1, 2026, 0, 0, 'NONE')
         on conflict (user_id, tax_year) do update
           set other_income_base = excluded.other_income_base`,
        [USER_A],
      ),
    )
  })
})
