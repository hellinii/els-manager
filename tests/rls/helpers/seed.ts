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

/**
 * 상환 실적. 기본값은 1차 조기상환이다.
 *
 * **대상 차수의 평가일정을 먼저 멱등 생성한다.** I-13의 복합 FK
 * `(els_id, round_no) → redemption_schedules`가 실재하는 차수를 요구하므로,
 * 일정 없이 `round_no`를 넣으면 `23503`으로 시드 자체가 실패한다.
 *
 * **`seedProduct`가 아니라 여기에 두는 이유.** `seedProduct`에서 1차를 자동
 * 생성하면 `seedSchedule({ roundNo: 1 })`을 직접 호출하는 케이스들과
 * `UNIQUE(els_id, round_no)`로 충돌한다. 더 근본적으로는 `total_rounds`와
 * 일정 행 수의 정합성이 미결이므로(DOC-002 DQ-05) **픽스처가 한쪽 해석을
 * 전제하면 안 된다.** P3에서 I-07을 계약 계층에서 강제할 때 함께 재검토한다.
 *
 * `round_no`를 `NULL`로 두는 상환은 이 헬퍼로 만들 수 없다 — `EARLY`는 차수를
 * 반드시 갖기 때문이다(I-14). 만기 상환이 필요한 케이스는 유형과 차수를 함께
 * 지정해야 하므로 테스트가 직접 `insert`한다.
 */
export async function seedRedemption(params: {
  elsId: string
  roundNo?: number
  taxableIncome?: string
}): Promise<{ id: string }> {
  const roundNo = params.roundNo ?? 1

  await asOwner(
    `insert into public.redemption_schedules
       (els_id, round_no, evaluation_date, barrier)
     values ($1, $2, '2026-07-02', 0.90)
     on conflict (els_id, round_no) do nothing`,
    [params.elsId, roundNo],
  )

  const result = await asOwner<{ id: string }>(
    `insert into public.redemptions
       (els_id, redemption_type, round_no, redemption_date,
        gross_amount, taxable_income, is_confirmed)
     values ($1, 'EARLY', $2, '2026-07-02', 104000000, $3, true)
     returning id`,
    [params.elsId, roundNo, params.taxableIncome ?? '4000000'],
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
