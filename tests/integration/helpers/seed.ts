import { Client } from 'pg'

import { resolveDatabaseUrl } from './env'
import { ALL_FIXTURE_IDS, FX_NAME_PREFIX, ITG_USER_A } from './fixtures'

/**
 * 픽스처 — **선삭제 후 삽입(멱등)**, 고정 UUID.
 *
 * "만들고 지우기"로 두지 않는 이유: 테스트가 중간에 던지면 역순 정리가 실행되지
 * 않고 다음 실행이 이전 실행의 잔재에 걸린다. 고정 UUID + 선삭제는 잔재가 남아도
 * 다음 실행이 스스로 낫는다.
 *
 * **날짜를 되읽어 비교하지 않는다.** `pg`는 `date`를 JS `Date`로 파싱하므로
 * (NUMERIC 파서를 일부러 등록하지 않은 것과 같은 주의가 필요하다) 되읽으면
 * UTC 경계에서 하루 어긋난다. 이 파일은 **쓰기 전용**이고, 검증은 전부
 * PostgREST가 반환한 문자열로 한다.
 */

let client: Client | null = null

async function db(): Promise<Client> {
  if (client == null) {
    client = new Client({ connectionString: resolveDatabaseUrl() })
    await client.connect()
  }
  return client
}

export async function closeSeedConnection(): Promise<void> {
  if (client != null) {
    await client.end()
    client = null
  }
}

export async function sql(text: string, values: unknown[] = []): Promise<void> {
  const c = await db()
  await c.query(text, values)
}

/**
 * 이 스위트가 만든 것만 지운다.
 *
 * 상품은 고정 UUID로, 자산은 고정 UUID + 예약 이름 접두사로 좁힌다 —
 * `USER_A`·`USER_B`(RLS 스위트)의 행이나 개발자가 손으로 만든 데이터를 지우면
 * 그것은 테스트가 아니라 사고다.
 */
export async function resetFixtures(): Promise<void> {
  // els_products → 하위(underlyings·schedules·redemptions)는 CASCADE
  await sql('delete from public.els_products where id = any($1::uuid[])', [
    ALL_FIXTURE_IDS,
  ])
  // asset_prices → assets CASCADE이지만 명시해 의도를 남긴다
  await sql('delete from public.asset_prices where asset_id = any($1::uuid[])', [
    ALL_FIXTURE_IDS,
  ])
  await sql(
    'delete from public.assets where id = any($1::uuid[]) or name like $2',
    [ALL_FIXTURE_IDS, `${FX_NAME_PREFIX}%`],
  )
  // 이 스위트의 사용자 프로필만. USER_A·USER_B는 절대 건드리지 않는다.
  await sql('delete from public.tax_profiles where user_id = any($1::uuid[])', [
    [ITG_USER_A],
  ])
}

export async function seedAsset(params: {
  id: string
  name: string
  market?: string | null
  currency?: string
}): Promise<void> {
  await sql(
    `insert into public.assets (id, name, asset_type, market, currency)
     values ($1, $2, 'STOCK', $3, $4)`,
    [
      params.id,
      `${FX_NAME_PREFIX} ${params.name}`,
      params.market ?? 'NASDAQ',
      params.currency ?? 'USD',
    ],
  )
}

export async function seedPrice(params: {
  assetId: string
  asOfDate: string
  price: string
  source?: 'AUTO' | 'MANUAL'
}): Promise<void> {
  await sql(
    `insert into public.asset_prices (asset_id, as_of_date, price, source)
     values ($1, $2, $3, $4)`,
    [params.assetId, params.asOfDate, params.price, params.source ?? 'MANUAL'],
  )
}

export async function seedProduct(params: {
  id: string
  ownerId: string
  name: string
  principal?: string
  kiBarrier?: string | null
  kiObservation?: 'CONTINUOUS' | 'CLOSING' | null
  kiTouchedAt?: string | null
  accountType?: 'GENERAL' | 'TAX_FREE'
  issueDate?: string
}): Promise<void> {
  await sql(
    `insert into public.els_products
       (id, owner_id, name, issue_date, principal, evaluation_period_months,
        annual_coupon_rate, ki_barrier, ki_observation, ki_touched_at, account_type)
     values ($1, $2, $3, $4, $5, 6, 0.0800, $6, $7, $8, $9)`,
    [
      params.id,
      params.ownerId,
      `${FX_NAME_PREFIX} ${params.name}`,
      params.issueDate ?? '2026-01-02',
      params.principal ?? '100000000',
      params.kiBarrier ?? null,
      params.kiObservation ?? null,
      params.kiTouchedAt ?? null,
      params.accountType ?? 'GENERAL',
    ],
  )
}

export async function seedUnderlying(params: {
  elsId: string
  assetId: string
  basePrice: string
  sequence: number
}): Promise<void> {
  await sql(
    `insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
     values ($1, $2, $3, $4)`,
    [params.elsId, params.assetId, params.basePrice, params.sequence],
  )
}

export async function seedSchedule(params: {
  elsId: string
  roundNo: number
  evaluationDate: string
  barrier: string
  lizardBarrier?: string | null
  lizardCouponRate?: string | null
  lizardRequiresNoKi?: boolean | null
}): Promise<void> {
  await sql(
    `insert into public.redemption_schedules
       (els_id, round_no, evaluation_date, barrier,
        lizard_barrier, lizard_coupon_rate, lizard_requires_no_ki)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.elsId,
      params.roundNo,
      params.evaluationDate,
      params.barrier,
      params.lizardBarrier ?? null,
      params.lizardCouponRate ?? null,
      params.lizardRequiresNoKi ?? null,
    ],
  )
}

export async function seedRedemption(params: {
  elsId: string
  roundNo: number | null
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax?: string | null
}): Promise<void> {
  await sql(
    `insert into public.redemptions
       (els_id, redemption_type, round_no, redemption_date,
        gross_amount, taxable_income, withholding_tax, is_confirmed)
     values ($1, $2, $3, $4, $5, $6, $7, true)`,
    [
      params.elsId,
      params.redemptionType,
      params.roundNo,
      params.redemptionDate,
      params.grossAmount,
      params.taxableIncome,
      params.withholdingTax ?? null,
    ],
  )
}

export async function seedTaxProfile(params: {
  userId: string
  taxYear: number
  otherIncomeBase: string
  otherFinancialIncome: string
  healthInsuranceType: 'EMPLOYEE' | 'REGIONAL' | 'DEPENDENT' | 'NONE'
}): Promise<void> {
  await sql(
    `insert into public.tax_profiles
       (user_id, tax_year, other_income_base, other_financial_income,
        health_insurance_type)
     values ($1, $2, $3, $4, $5)`,
    [
      params.userId,
      params.taxYear,
      params.otherIncomeBase,
      params.otherFinancialIncome,
      params.healthInsuranceType,
    ],
  )
}
