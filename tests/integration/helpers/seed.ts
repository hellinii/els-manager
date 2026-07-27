import { Client } from 'pg'

import { resolveDatabaseUrl } from './env'
import { ALL_FIXTURE_IDS, FX_NAME_PREFIX, ITG_USER_A, ITG_USER_B } from './fixtures'

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
  /**
   * **삭제 순서가 중요하다 — 실측한 FK 규칙에 따른다.**
   *
   * | 자식 | 부모 | ON DELETE |
   * |---|---|---|
   * | `els_underlyings.els_id` | `els_products` | CASCADE |
   * | `redemption_schedules.els_id` | `els_products` | CASCADE |
   * | **`redemptions.els_id`** | `els_products` | **RESTRICT** |
   * | **`els_underlyings.asset_id`** | `assets` | **RESTRICT** |
   * | `asset_prices.asset_id` | `assets` | CASCADE |
   *
   * `redemptions`가 RESTRICT인 것은 설계다 — DOC-002 DQ-01("상환 완료 상품은
   * 삭제 불가")을 DB가 강제한다. 그래서 상품보다 **먼저** 지워야 하고, 처음에
   * "하위는 CASCADE"라고 가정했다가 `23503`으로 픽스처가 죽었다.
   *
   * `assets`는 `els_underlyings`가 RESTRICT로 참조하므로 상품(→ 기초자산 CASCADE)
   * 삭제 **뒤에** 지운다.
   */
  await sql('delete from public.redemptions where els_id = any($1::uuid[])', [
    ALL_FIXTURE_IDS,
  ])
  await sql('delete from public.els_products where id = any($1::uuid[])', [
    ALL_FIXTURE_IDS,
  ])
  // assets CASCADE로도 지워지지만 명시해 의도를 남긴다
  await sql('delete from public.asset_prices where asset_id = any($1::uuid[])', [
    ALL_FIXTURE_IDS,
  ])
  await sql(
    'delete from public.assets where id = any($1::uuid[]) or name like $2',
    [ALL_FIXTURE_IDS, `${FX_NAME_PREFIX}%`],
  )
  /**
   * 이 스위트의 **두 사용자** 프로필. 처음에 A만 지웠다가 B의 행이 남아
   * `tax_profiles_user_id_tax_year_key`로 다음 실행이 `23505`로 죽었다 —
   * 커밋하는 픽스처에서 선삭제 범위가 좁으면 실패가 다음 실행으로 미뤄진다.
   *
   * RLS 스위트의 USER_A·USER_B(`...00000a`/`...00000b`)는 **절대 건드리지 않는다.**
   * 그쪽 `tax-profiles.test.ts`가 필터 없이 조회해 `toEqual([USER_A])`를 단언하므로,
   * 여기서 그 행을 지우거나 새 행을 남기면 그 스위트가 빨간불이 된다.
   */
  await sql('delete from public.tax_profiles where user_id = any($1::uuid[])', [
    [ITG_USER_A, ITG_USER_B],
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
  /** 기본 `null`. 형식 검사(`formats.test.ts`)가 비-null 분기를 요구한다 */
  issuer?: string | null
  /** 기본 `null`. 위와 같다 */
  note?: string | null
}): Promise<void> {
  await sql(
    `insert into public.els_products
       (id, owner_id, name, issue_date, principal, evaluation_period_months,
        annual_coupon_rate, ki_barrier, ki_observation, ki_touched_at, account_type,
        issuer, note)
     values ($1, $2, $3, $4, $5, 6, 0.0800, $6, $7, $8, $9, $10, $11)`,
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
      params.issuer ?? null,
      params.note ?? null,
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
  /** 기본 `null`. 형식 검사(`formats.test.ts`)가 비-null 분기를 요구한다 */
  note?: string | null
}): Promise<void> {
  await sql(
    `insert into public.redemptions
       (els_id, redemption_type, round_no, redemption_date,
        gross_amount, taxable_income, withholding_tax, is_confirmed, note)
     values ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
    [
      params.elsId,
      params.redemptionType,
      params.roundNo,
      params.redemptionDate,
      params.grossAmount,
      params.taxableIncome,
      params.withholdingTax ?? null,
      params.note ?? null,
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
