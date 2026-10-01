import { describe, expect, it } from 'vitest'

import { actingAs, actingAsServiceRole, anonymously, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import {
  expectConstraintViolation,
  expectNoRowsAffected,
  expectPermissionDenied,
} from './helpers/expect'

/**
 * 환율 — DOC-002 v1.10 §4.12 · I-22 · DOC-010 §7 (P8 컷 a3 · M-a3)
 *
 * `asset_prices`(I-05 · I-16)와 같은 부류의 **공용 관측 데이터**다. 그래서 케이스도 그 형판을 옮긴다 —
 * 좌표 유일 · 좌표 동결(두 채널로 이름을 싣는다 · 동일값 재대입 통과 · UPSERT 보존) · 공용 정정 ·
 * **지울 수 없다**. 다른 점은 CHECK 셋(원화 금지 · 0 이하 금지 · 출처와 공급자의 짝)이다.
 *
 * 각 케이스는 한 제약만 위반한다(`constraints.test.ts` 머리 주석의 규약).
 */

const insertRate = `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
  values ($1, $2, $3, $4, $5) returning id`

async function manualRate(asOfDate = '2026-09-28', rate = '1392.400000'): Promise<string> {
  const result = await actingAs(USER_A).query<{ id: string }>(insertRate, [
    'USD',
    asOfDate,
    rate,
    'MANUAL',
    null,
  ])
  return result.rows[0].id
}

describe('권한 — 공용 관측 · 지울 수 없다 (DOC-010 §7)', () => {
  it('로그인한 사용자는 수동 환율을 넣고, 다른 사용자도 그 행을 읽는다', async () => {
    const id = await manualRate()
    const seen = await actingAs(USER_B).query<{ rate: string }>(
      'select rate::text from public.exchange_rates where id = $1',
      [id],
    )
    expect(seen.rows).toEqual([{ rate: '1392.400000' }])
  })

  it('다른 사용자도 고칠 수 있다 — 공용 데이터의 정정은 열려 있다', async () => {
    const id = await manualRate()
    const updated = await actingAs(USER_B).query(
      'update public.exchange_rates set rate = 1393.100000 where id = $1',
      [id],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('★ 아무도 지울 수 없다 — DELETE는 권한도 정책도 없다 (두 겹)', async () => {
    const id = await manualRate()
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.exchange_rates where id = $1', [id]),
    )
  })

  it('미인증 요청은 읽을 수 없다', async () => {
    await expectPermissionDenied(() => anonymously.query('select id from public.exchange_rates'))
  })

  it('service_role은 쓰지 못한다 — 0 DML 유지 (자동 수집기의 롤은 컷 c2가 정한다)', async () => {
    await expectPermissionDenied(() =>
      actingAsServiceRole().query(insertRate, ['USD', '2026-09-28', '1392.4', 'MANUAL', null]),
    )
  })

  it('짝 통제 — 소유자(postgres)는 RLS를 우회하므로 정책이 아니라 권한이 막는다는 것을 가른다', async () => {
    // 소유자가 지우면 지워진다. 위 거부가 「행이 없어서」가 아니라 권한 때문이라는 증거다
    const id = await manualRate()
    const deleted = await asOwner('delete from public.exchange_rates where id = $1', [id])
    expect(deleted.rowCount).toBe(1)
    const none = await asOwner('delete from public.exchange_rates where id = $1', [id])
    expectNoRowsAffected(none)
  })
})

describe('I-22 — 값의 제약 (CHECK 셋)', () => {
  it('원화 환율은 거부한다 (exchange_rates_currency_check)', async () => {
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRate, ['KRW', '2026-09-28', '1', 'MANUAL', null]),
      '23514',
      'exchange_rates_currency_check',
    )
  })

  it('0 이하는 거부한다 (exchange_rates_rate_check)', async () => {
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRate, ['USD', '2026-09-28', '0', 'MANUAL', null]),
      '23514',
      'exchange_rates_rate_check',
    )
  })

  it('수동 행에 공급자가 있으면 거부한다 — 「자동」으로 읽힌다 (exchange_rates_provider_check)', async () => {
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRate, ['USD', '2026-09-28', '1392.4', 'MANUAL', 'ECOS']),
      '23514',
      'exchange_rates_provider_check',
    )
  })

  it('자동 행에 공급자가 없으면 거부한다 (exchange_rates_provider_check)', async () => {
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRate, ['USD', '2026-09-28', '1392.4', 'AUTO', null]),
      '23514',
      'exchange_rates_provider_check',
    )
  })

  it('통화·일자당 1건 (exchange_rates_currency_as_of_date_key)', async () => {
    await manualRate('2026-09-28')
    await expectConstraintViolation(
      () => manualRate('2026-09-28', '1400.000000'),
      '23505',
      'exchange_rates_currency_as_of_date_key',
    )
  })
})

describe('I-22 — 관측 좌표 동결 (I-16의 형태)', () => {
  it('기준일을 바꾸면 거부한다 — 좌표가 다른 환율은 새 관측이다', async () => {
    const id = await manualRate('2026-09-28')
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.exchange_rates set as_of_date = '2026-09-29' where id = $1`,
          [id],
        ),
      '23514',
      'exchange_rates_coordinates_immutable',
    )
  })

  it('통화를 바꾸면 트리거가 먼저 거부한다 — CHECK보다 앞선다(BEFORE 행 트리거)', async () => {
    // 지원 외화가 USD 하나라 바꿀 곳이 KRW뿐이고 그 값은 CHECK에도 걸린다 — 먼저 도는 것이 트리거다(a2 실측)
    const id = await manualRate()
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(`update public.exchange_rates set currency = 'KRW' where id = $1`, [
          id,
        ]),
      '23514',
      'exchange_rates_coordinates_immutable',
    )
  })

  it('detail의 첫 줄에도 이름이 온다 — PostgREST 경로의 유일한 채널', async () => {
    const id = await manualRate('2026-09-28')
    let detail: string | undefined
    try {
      await actingAs(USER_A).query(
        `update public.exchange_rates set as_of_date = '2026-09-30' where id = $1`,
        [id],
      )
    } catch (error) {
      detail = (error as { detail?: string }).detail
    }
    expect(detail).toBe('constraint=exchange_rates_coordinates_immutable')
  })

  it('관측값(rate · source · provider)의 정정과 동일값 재대입은 통과한다', async () => {
    const id = await manualRate('2026-09-28')
    const updated = await actingAs(USER_A).query(
      `update public.exchange_rates
          set currency = 'USD', as_of_date = '2026-09-28', rate = 1391.670000
        where id = $1`,
      [id],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('UPSERT(do update)가 좌표를 동일값으로 재대입해도 통과한다 — §5.13의 형태', async () => {
    await manualRate('2026-09-28', '1392.400000')
    await actingAs(USER_A).query(
      `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
       values ('USD', '2026-09-28', 1395.000000, 'MANUAL', null)
       on conflict (currency, as_of_date) do update
         set currency = excluded.currency, as_of_date = excluded.as_of_date,
             rate = excluded.rate, source = excluded.source, provider = excluded.provider`,
    )
    const row = await asOwner<{ rate: string; n: number }>(
      `select max(rate)::text as rate, count(*)::int as n
         from public.exchange_rates where currency = 'USD' and as_of_date = '2026-09-28'`,
    )
    expect(row.rows[0]).toEqual({ rate: '1395.000000', n: 1 })
  })

  it('★ 자동 행을 수동으로 정정하면 공급자가 null이 된다 — provider를 명시해야 하는 이유 (§5.13 ★)', async () => {
    // 수집기의 행을 소유자 권한으로 먼저 넣는다(수집기는 컷 c2다)
    await asOwner(
      `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
       values ('USD', '2026-09-28', 1392.400000, 'AUTO', 'ECOS')`,
    )
    // 수동 정정 — provider = null을 **명시해** 싣는다. 빼면 AUTO의 공급자가 남아 provider_check에 걸린다
    await actingAs(USER_A).query(
      `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
       values ('USD', '2026-09-28', 1391.000000, 'MANUAL', null)
       on conflict (currency, as_of_date) do update
         set rate = excluded.rate, source = excluded.source, provider = excluded.provider`,
    )
    const row = await asOwner<{ source: string; provider: string | null; rate: string }>(
      `select source::text, provider, rate::text
         from public.exchange_rates where currency = 'USD' and as_of_date = '2026-09-28'`,
    )
    expect(row.rows[0]).toEqual({ source: 'MANUAL', provider: null, rate: '1391.000000' })
  })

  it('짝 통제 — 수동 정정에서 provider를 빼면 provider_check에 걸린다', async () => {
    await asOwner(
      `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
       values ('USD', '2026-09-28', 1392.400000, 'AUTO', 'ECOS')`,
    )
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `insert into public.exchange_rates (currency, as_of_date, rate, source)
           values ('USD', '2026-09-28', 1391.000000, 'MANUAL')
           on conflict (currency, as_of_date) do update
             set rate = excluded.rate, source = excluded.source`,
        ),
      '23514',
      'exchange_rates_provider_check',
    )
  })
})
