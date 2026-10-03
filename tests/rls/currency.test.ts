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
 * 마지막 describe는 **통화 누락 → 23502**를 영구 단언으로 둔다(DOC-002 §4.6 ★ · SB-12). W1은 배포 틈
 * 동안 통화를 보내지 않는 구 코드를 받치려고 열 기본값과 RPC `coalesce`를 두었고, 컷 a3의 M-a2c
 * (W2 · contract)가 그 둘을 뗐다 — 그 뒤로 통화 없는 쓰기는 **거부되어야** 한다. 쓰기 함수는 a2 · a3 ·
 * b2 · b4에서 네 번 교체되고 옛 본문에서 출발하면 `coalesce`가 조용히 되살아나므로, 세 함수 모두 —
 * 특히 update의 「저장값으로 떨어지는 coalesce」 — 를 교체마다 이 단언이 덮는다.
 */

const insertProduct = `insert into public.els_products
    (owner_id, name, issue_date, principal, currency, evaluation_period_months,
     annual_coupon_rate, account_type, coupon_payout)
  values ($1, '통화시험', '2026-01-02', $2, $3, 6, 0.08, 'GENERAL', 'AT_REDEMPTION')
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

  it('원금 문자열이 바뀌지 않는다 — typmod 해제가 scale을 보존한다', async () => {
    // W1의 「기존 행 원화 백필」은 운영에서 실측했다(26건 전부 KRW — DOC-013 §10.2.1 ④). M-a2c 뒤에는
    // 기본값이 없으므로 이 픽스처는 통화를 명시한다 — 여기서 보는 것은 scale 보존뿐이다
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

  it('부모가 없으면 FK가 거부한다(23503) — 부모 부재를 자릿수 라벨로 말하지 않는다 (DOC-002 v1.18)', async () => {
    // 센트를 싣는다 — 종전(a2 ~ b2-4)에는 통화가 NULL이 되어 fail-closed가 redemptions_gross_amount_scale로 거부했다.
    // 소유자 롤(BYPASSRLS)로 넣는다 — 계약 밖 쓰기의 경로다(authenticated는 INSERT 정책이 먼저 거부한다)
    await expectConstraintViolation(
      () => asOwner(insertRedemption, ['00000000-0000-4000-8000-0000000000aa', '1000.50', null]),
      '23503',
      'redemptions_els_id_fkey',
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

describe('통화 누락 → 23502 — M-a2c 뒤의 영구 단언 (DOC-002 §4.6 ★ · SB-12)', () => {
  // W1의 구 코드 payload와 같은 모양 — currency 키가 없다. **지급방식은 싣는다**(M-b2c — P8 컷 b4 뒤로 그것도 필수다):
  // 둘 다 빠지면 다른 열의 널 위반이 먼저 날 수 있어 이 단언이 통화를 가르지 못한다(실측 — update가 그랬다)
  async function legacyPayload(): Promise<Record<string, unknown>> {
    const asset = await seedAsset({})
    return {
      name: '구코드상품',
      issueDate: '2026-01-02',
      principal: '100000000',
      evaluationPeriodMonths: 6,
      annualCouponRate: '0.0800',
      accountType: 'GENERAL',
      couponPayout: 'AT_REDEMPTION',
      underlyings: [{ assetId: asset.id, basePrice: '100.000000', sequence: 1 }],
      schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' }],
    }
  }

  /** 23502이고 그 열이 `currency`다 — 다른 열의 널 위반이 대신 초록을 만들지 않게 */
  async function expectCurrencyNotNull(run: () => Promise<unknown>): Promise<void> {
    await expect(run()).rejects.toMatchObject({ code: '23502', column: 'currency' })
  }

  it('열 기본값이 없다 — 카탈로그', async () => {
    const row = await asOwner<{ has_default: boolean; not_null: boolean }>(
      `select a.atthasdef as has_default, a.attnotnull as not_null
         from pg_attribute a
        where a.attrelid = 'public.els_products'::regclass and a.attname = 'currency'`,
    )
    expect(row.rows[0]).toEqual({ has_default: false, not_null: true })
  })

  it('currency 없는 create_els_product는 23502다', async () => {
    const body = await legacyPayload()
    await expectCurrencyNotNull(() =>
      actingAs(USER_A).query('select public.create_els_product($1::jsonb) as id', [
        JSON.stringify(body),
      ]),
    )
  })

  it('★ currency 없는 update_els_product는 23502다 — 저장값으로 받치던 coalesce가 되살아나면 여기가 빨갛다', async () => {
    const body = await legacyPayload()
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_els_product($1::jsonb) as id',
      [JSON.stringify({ ...body, currency: 'USD', principal: '10000.00' })],
    )
    const id = created.rows[0].id

    await expectCurrencyNotNull(() =>
      actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
        id,
        JSON.stringify({ ...body, principal: '10000.00', name: '구코드가 고침' }),
      ]),
    )
    // 저장된 통화가 그대로다 — 거부는 트랜잭션 단위다
    const row = await asOwner<{ currency: string }>(
      'select currency::text from public.els_products where id = $1',
      [id],
    )
    expect(row.rows[0].currency).toBe('USD')
  })

  it('currency 없는 create_realized_els_product는 23502다', async () => {
    await expectCurrencyNotNull(() =>
      actingAs(USER_A).query('select public.create_realized_els_product($1::jsonb) as id', [
        JSON.stringify({
          name: '구코드 기실현',
          principal: '19390000',
          accountType: 'GENERAL',
          couponPayout: 'AT_REDEMPTION',
          redemptionType: 'EARLY',
          redemptionDate: '2025-06-02',
          grossAmount: '20000000',
          taxableIncome: '610000',
          isConfirmed: true,
        }),
      ]),
    )
  })

  it('직접 INSERT도 23502다 — 기본값이 없다', async () => {
    await expectCurrencyNotNull(() =>
      actingAs(USER_A).query(
        `insert into public.els_products
           (owner_id, name, issue_date, principal, evaluation_period_months,
            annual_coupon_rate, account_type, coupon_payout)
         values ($1, '통화 없음', '2026-01-02', 100000000, 6, 0.08, 'GENERAL', 'AT_REDEMPTION')`,
        [USER_A],
      ),
    )
  })
})
