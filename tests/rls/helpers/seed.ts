import { asOwner } from './client'
import { USER_A } from './fixtures'

/**
 * 케이스별 데이터 생성 — 소유자(`postgres`) 권한으로 만들고 트랜잭션 롤백으로
 * 사라진다.
 *
 * 정책 검증 대상은 **테스트 본문의 조작**이지 준비 과정이 아니므로, 준비는
 * RLS를 우회해 결정적으로 만든다. 각 테스트가 자기 전제를 직접 세우므로
 * 파일 간 순서 의존이 생기지 않는다.
 */

export type SeededProduct = { id: string }

export async function seedProduct(params: {
  ownerId?: string
  name?: string
}): Promise<SeededProduct> {
  const result = await asOwner<{ id: string }>(
    `insert into public.els_products
       (owner_id, name, issue_date, principal, evaluation_period_months,
        total_rounds, annual_coupon_rate, ki_barrier, ki_observation, account_type)
     values ($1, $2, '2026-01-02', 100000000, 6, 6, 0.08, 0.50, 'CLOSING', 'GENERAL')
     returning id`,
    [params.ownerId ?? USER_A, params.name ?? 'A상품'],
  )
  return { id: result.rows[0].id }
}

export async function seedAsset(params: {
  name?: string
  market?: string | null
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.assets (name, asset_type, market, currency)
     values ($1, 'STOCK', $2, 'USD')
     returning id`,
    [params.name ?? '테슬라', params.market ?? 'NASDAQ'],
  )
  return { id: result.rows[0].id }
}

export async function seedUnderlying(params: {
  elsId: string
  assetId: string
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
     values ($1, $2, 412.550000, 1)
     returning id`,
    [params.elsId, params.assetId],
  )
  return { id: result.rows[0].id }
}

export async function seedSchedule(params: {
  elsId: string
  roundNo?: number
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.redemption_schedules
       (els_id, round_no, evaluation_date, barrier, lizard_barrier, lizard_coupon_rate)
     values ($1, $2, '2026-07-02', 0.90, 0.85, 0.02)
     returning id`,
    [params.elsId, params.roundNo ?? 1],
  )
  return { id: result.rows[0].id }
}

export async function seedRedemption(params: {
  elsId: string
  taxableIncome?: string
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.redemptions
       (els_id, redemption_type, round_no, redemption_date,
        gross_amount, taxable_income, is_confirmed)
     values ($1, 'EARLY', 1, '2026-07-02', 104000000, $2, true)
     returning id`,
    [params.elsId, params.taxableIncome ?? '4000000'],
  )
  return { id: result.rows[0].id }
}

export async function seedPrice(params: {
  assetId: string
  asOfDate?: string
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.asset_prices (asset_id, as_of_date, price, source)
     values ($1, $2, 391.922500, 'MANUAL')
     returning id`,
    [params.assetId, params.asOfDate ?? '2026-07-01'],
  )
  return { id: result.rows[0].id }
}

export async function seedTaxProfile(params: {
  userId: string
  taxYear?: number
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.tax_profiles
       (user_id, tax_year, other_income_base, other_financial_income, health_insurance_type)
     values ($1, $2, 50000000, 0, 'EMPLOYEE')
     returning id`,
    [params.userId, params.taxYear ?? 2026],
  )
  return { id: result.rows[0].id }
}
