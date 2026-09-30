import { describe, expect, it } from 'vitest'
import { actingAs, asOwner } from './helpers/client'
import { USER_A } from './helpers/fixtures'
import { seedAsset, seedProduct } from './helpers/seed'
import { expectConstraintViolation } from './helpers/expect'

/**
 * 상품 통화와 금액 자릿수 — DOC-002 v1.10 §4.6 · §4.9 · I-21 · I-22(적용 환율) · P8 컷 a2
 *
 * **각 케이스는 한 제약만 위반한다**(constraints.test.ts 머리 주석과 같은 규약). 원화 상품의
 * 센트는 `els_products_principal_scale_check` 하나에만, 원화 부모 아래의 센트 실수령액은 트리거
 * 하나에만 걸리도록 값을 고른다 — 정수부·소수 2자리 한도 안에 두면 digits CHECK가 끼지 않는다.
 *
 * 마지막 describe는 **배포 틈**을 본다. W1 마이그레이션이 운영에 먼저 올라가고 코드가 뒤따르므로
 * 그 사이에 도는 구 코드는 payload에 `currency`를 보내지 않는다. 그 요청이 오늘처럼 성공해야 하고,
 * 수정은 저장된 통화를 **지키지** 원화로 되돌리지 않아야 한다(DOC-013 §10.2.1). 이 둘은 컷 a3의
 * M-a2c(default·coalesce 제거) 이후 반대가 된다 — 그때 「통화 누락 → 23502」 단언으로 바뀐다.
 */

const insertProduct = `insert into public.els_products
    (owner_id, name, issue_date, principal, currency, evaluation_period_months,
     annual_coupon_rate, account_type)
  values ($1, '통화시험', '2026-01-02', $2, $3, 6, 0.08, 'GENERAL')
  returning id`

async function productIn(currency: 'KRW' | 'USD', principal = '100000000'): Promise<string> {
  const result = await actingAs(USER_A).query<{ id: string }>(insertProduct, [
    USER_A,
    principal,
    currency,
  ])
  return result.rows[0].id
}

const insertRedemption = `insert into public.redemptions
    (els_id, redemption_type, round_no, redemption_date,
     gross_amount, taxable_income, exchange_rate, is_confirmed)
  values ($1, 'MATURITY_GAIN', null, '2027-01-04', $2, 0, $3, true)`

describe('상품 통화 — enum', () => {
  it('지원하지 않는 통화는 형식 오류다 (22P02)', async () => {
    await expect(productIn('EUR' as 'USD')).rejects.toMatchObject({ code: '22P02' })
  })

  it('기존 행은 원화로 백필되고 원금 문자열이 바뀌지 않는다 — typmod 해제가 scale을 보존한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const row = await asOwner<{ currency: string; principal: string }>(
      'select currency::text, principal::text from public.els_products where id = $1',
      [product.id],
    )
    // numeric(17,2)로 넓혔다면 '100000000.00'이 되어 배포 중인 구 코드의 V-01(정수)이 깨진다
    expect(row.rows[0]).toEqual({ currency: 'KRW', principal: '100000000' })
  })
})

describe('I-21 — 투자원금의 자릿수 (els_products_principal_scale_check)', () => {
  it('원화 상품의 센트는 거부한다', async () => {
    await expectConstraintViolation(
      () => productIn('KRW', '100000000.5'),
      '23514',
      'els_products_principal_scale_check',
    )
  })

  it('달러 상품은 센트까지 받는다', async () => {
    const id = await productIn('USD', '10000.50')
    const row = await asOwner<{ principal: string }>(
      'select principal::text from public.els_products where id = $1',
      [id],
    )
    expect(row.rows[0].principal).toBe('10000.50')
  })

  it('달러 상품의 소수 3자리는 거부한다', async () => {
    await expectConstraintViolation(
      () => productIn('USD', '10000.505'),
      '23514',
      'els_products_principal_scale_check',
    )
  })

  it('정수부 16자리는 거부한다 — 종전 numeric(15,0)의 천장을 이름 있는 제약이 이어받는다', async () => {
    // typmod를 떼면 22003(열 이름 없음)이던 거부가 이름 있는 23514가 된다
    await expectConstraintViolation(
      () => productIn('KRW', '1000000000000000'),
      '23514',
      'els_products_principal_scale_check',
    )
  })
})

describe('I-21 — 실수령액의 자릿수 (digits CHECK + 통화 트리거)', () => {
  it('원화 부모 아래의 센트는 트리거가 거부한다 (redemptions_gross_amount_scale)', async () => {
    const krw = await productIn('KRW')
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRedemption, [krw, '104000000.5', null]),
      '23514',
      'redemptions_gross_amount_scale',
    )
  })

  it('달러 부모 아래의 센트는 받는다', async () => {
    const usd = await productIn('USD', '10000.00')
    await actingAs(USER_A).query(insertRedemption, [usd, '10600.50', '1392.400000'])
    const row = await asOwner<{ gross_amount: string; exchange_rate: string }>(
      'select gross_amount::text, exchange_rate::text from public.redemptions where els_id = $1',
      [usd],
    )
    expect(row.rows[0]).toEqual({ gross_amount: '10600.50', exchange_rate: '1392.400000' })
  })

  it('소수 3자리는 통화와 무관하게 CHECK가 거부한다 (redemptions_gross_amount_digits_check)', async () => {
    // 달러 부모이므로 트리거(2자리 허용)는 막지 않는다 — 막는 것은 CHECK 하나다
    const usd = await productIn('USD', '10000.00')
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRedemption, [usd, '10600.505', null]),
      '23514',
      'redemptions_gross_amount_digits_check',
    )
  })

  it('수정으로 원화 상환에 센트를 넣어도 트리거가 거부한다 — UPDATE도 본다', async () => {
    const krw = await productIn('KRW')
    await actingAs(USER_A).query(insertRedemption, [krw, '104000000', null])
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          'update public.redemptions set gross_amount = 104000000.5 where els_id = $1',
          [krw],
        ),
      '23514',
      'redemptions_gross_amount_scale',
    )
  })
})

describe('I-22 — 적용 환율 (redemptions_exchange_rate_check)', () => {
  it('0 이하는 거부한다', async () => {
    const usd = await productIn('USD', '10000.00')
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insertRedemption, [usd, '10600.00', '0']),
      '23514',
      'redemptions_exchange_rate_check',
    )
  })
})

describe('배포 틈 — W1 스키마 위의 구 코드 (expand 호환)', () => {
  // 오늘의 ProductPayload와 같은 모양 — currency 키가 없다
  async function legacyPayload(): Promise<Record<string, unknown>> {
    const asset = await seedAsset({})
    return {
      name: '구코드상품',
      issueDate: '2026-01-02',
      principal: '100000000',
      evaluationPeriodMonths: 6,
      annualCouponRate: '0.0800',
      accountType: 'GENERAL',
      underlyings: [{ assetId: asset.id, basePrice: '100.000000', sequence: 1 }],
      schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' }],
    }
  }

  it('currency 없는 create_els_product가 성공하고 원화로 저장된다', async () => {
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_els_product($1::jsonb) as id',
      [JSON.stringify(await legacyPayload())],
    )
    const row = await asOwner<{ currency: string }>(
      'select currency::text from public.els_products where id = $1',
      [created.rows[0].id],
    )
    expect(row.rows[0].currency).toBe('KRW')
  })

  it('currency 없는 update_els_product는 저장된 통화를 지킨다 — 원화로 뒤집지 않는다', async () => {
    const body = await legacyPayload()
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_els_product($1::jsonb) as id',
      [JSON.stringify({ ...body, currency: 'USD', principal: '10000.00' })],
    )
    const id = created.rows[0].id

    await actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
      id,
      JSON.stringify({ ...body, principal: '10000.00', name: '구코드가 고침' }),
    ])

    const row = await asOwner<{ currency: string; name: string }>(
      'select currency::text, name from public.els_products where id = $1',
      [id],
    )
    expect(row.rows[0]).toEqual({ currency: 'USD', name: '구코드가 고침' })
  })

  it('currency 없는 create_realized_els_product가 성공하고 원화로 저장된다', async () => {
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_realized_els_product($1::jsonb) as id',
      [
        JSON.stringify({
          name: '구코드 기실현',
          principal: '19390000',
          accountType: 'GENERAL',
          redemptionType: 'EARLY',
          redemptionDate: '2025-06-02',
          grossAmount: '20000000',
          taxableIncome: '610000',
          isConfirmed: true,
        }),
      ],
    )
    const row = await asOwner<{ currency: string; exchange_rate: string | null }>(
      `select p.currency::text, r.exchange_rate::text
         from public.els_products p join public.redemptions r on r.els_id = p.id
        where p.id = $1`,
      [created.rows[0].id],
    )
    expect(row.rows[0]).toEqual({ currency: 'KRW', exchange_rate: null })
  })
})
