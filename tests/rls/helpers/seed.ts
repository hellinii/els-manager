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
  // 상품 통화를 명시한다 — M-a2c(W2)가 열 기본값을 뗐다(SB-12). 빼면 23502다
  const result = await asOwner<{ id: string }>(
    `insert into public.els_products
       (owner_id, name, issue_date, principal, currency, evaluation_period_months,
        annual_coupon_rate, ki_barrier, ki_observation, account_type)
     values ($1, $2, '2026-01-02', 100000000, 'KRW', 6, 0.08, 0.50, 'CLOSING', 'GENERAL')
     returning id`,
    [params.ownerId ?? USER_A, params.name ?? 'A상품'],
  )
  return { id: result.rows[0].id }
}

/**
 * 기실현 등재 상품 — `entry_mode = 'REALIZED_ONLY'` (DOC-002 D-07).
 *
 * 계약 조건 두 열이 `NULL`이고 하위 행이 0건이다. **I-18을 만족하는 유일한 조합**
 * 이며(`FULL`이면 두 열이 필수다) `create_realized_els_product`가 만드는 것과 같은
 * 형태다 — 여기서 손으로 넣는 이유는 이 스위트가 `pg` 직결이라 `auth.uid()`를
 * 쓰지 않는다는 것뿐이다.
 */
export async function seedRealizedProduct(params: {
  ownerId?: string
  name?: string
}): Promise<SeededProduct> {
  const result = await asOwner<{ id: string }>(
    `insert into public.els_products
       (owner_id, name, principal, currency, account_type, entry_mode)
     values ($1, $2, 19390000, 'KRW', 'GENERAL', 'REALIZED_ONLY')
     returning id`,
    [params.ownerId ?? USER_A, params.name ?? '기실현 상품'],
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
 * `UNIQUE(els_id, round_no)`로 충돌한다.
 *
 * P3a에서 DQ-05가 닫혔다 — `total_rounds` 컬럼이 사라졌으므로 총 차수의 정본은
 * 일정 **행 수**이고, 픽스처가 두 값의 정합성을 전제할 여지 자체가 없어졌다.
 * `seedProduct`는 일정을 만들지 않으므로 그 상품의 총 차수는 0이다 — 조회 계층이
 * `integrityIssue = 'SCHEDULE_MISSING'`으로 표시하는 상태이며(DOC-011 §4.2),
 * 정책 검증에는 무해하다. I-07의 계약 계층 강제는 P3b다.
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

/**
 * 월지급식 상품 — `coupon_payout = 'MONTHLY'` (P8 컷 b2 · DOC-002 §4.6 · I-23).
 *
 * `FULL`이면 연쿠폰율 0 + 월수익 연쿠폰율 > 0이 I-23의 유일한 형태다(DQ-11 — 헤드라인 율을 연쿠폰율에 두면
 * 이중 계상). 기실현(`REALIZED_ONLY`)이면 두 율이 없다. 월수익 일정은 만들지 않는다 — 테스트가 필요한 달을
 * `seedCouponSchedule`로 넣는다(직접 INSERT는 꼬리 검사 I-25를 지나지 않는다 — 계약 경로만의 규칙이다).
 */
export async function seedMonthlyProduct(params: {
  ownerId?: string
  name?: string
  currency?: 'KRW' | 'USD'
  principal?: string
}): Promise<SeededProduct> {
  const result = await asOwner<{ id: string }>(
    `insert into public.els_products
       (owner_id, name, issue_date, principal, currency, evaluation_period_months,
        annual_coupon_rate, coupon_payout, monthly_coupon_annual_rate,
        ki_barrier, ki_observation, account_type)
     values ($1, $2, '2026-10-16', $3, $4, 6, 0, 'MONTHLY', 0.0720, 0.50, 'CLOSING', 'GENERAL')
     returning id`,
    [
      params.ownerId ?? USER_A,
      params.name ?? '월지급 상품',
      params.principal ?? (params.currency === 'USD' ? '10000.00' : '100000000'),
      params.currency ?? 'KRW',
    ],
  )
  return { id: result.rows[0].id }
}

/** 기실현 월지급식 상품 — 율도 일정도 없다(D-07 · I-23의 기실현 분기) */
export async function seedRealizedMonthlyProduct(params: {
  ownerId?: string
}): Promise<SeededProduct> {
  const result = await asOwner<{ id: string }>(
    `insert into public.els_products
       (owner_id, name, principal, currency, coupon_payout, account_type, entry_mode)
     values ($1, '기실현 월지급', 100000000, 'KRW', 'MONTHLY', 'GENERAL', 'REALIZED_ONLY')
     returning id`,
    [params.ownerId ?? USER_A],
  )
  return { id: result.rows[0].id }
}

/**
 * 월수익 일정 한 행. 기본 평가일은 `2026-10-16 + (k−1)개월` 꼴의 고정값이 아니라 **인자로 받는다** —
 * 상환일과의 비교(I-27)가 날짜에 달려 있으므로 각 케이스가 자기 날짜를 적는다. 지급일 기본값은 평가일 + 3일.
 */
export async function seedCouponSchedule(params: {
  elsId: string
  couponNo: number
  evaluationDate: string
  paymentDate?: string
  couponBarrier?: string
}): Promise<{ id: string }> {
  const result = await asOwner<{ id: string }>(
    `insert into public.monthly_coupon_schedules
       (els_id, coupon_no, evaluation_date, payment_date, coupon_barrier)
     values ($1, $2, $3::date, coalesce($4::date, $3::date + 3), $5)
     returning id`,
    [
      params.elsId,
      params.couponNo,
      params.evaluationDate,
      params.paymentDate ?? null,
      params.couponBarrier ?? '0.6000',
    ],
  )
  return { id: result.rows[0].id }
}

/**
 * 월수익 지급 기록 한 건 — 기본은 지급(PAID) 600,000원 · 과세 600,000 · 원천징수 92,400.
 * 미지급(UNPAID)은 금액 · 지급일 · 과세 · 원천징수 · 환율이 전부 NULL이다(I-26).
 */
export async function seedCouponPayment(params: {
  elsId: string
  couponNo: number | null
  outcome?: 'PAID' | 'UNPAID'
  paymentDate?: string
  grossAmount?: string
}): Promise<{ id: string }> {
  const paid = (params.outcome ?? 'PAID') === 'PAID'
  const result = await asOwner<{ id: string }>(
    `insert into public.monthly_coupon_payments
       (els_id, coupon_no, outcome, payment_date, gross_amount, taxable_income, withholding_tax, is_confirmed)
     values ($1, $2, $3, $4, $5, $6, $7, true)
     returning id`,
    [
      params.elsId,
      params.couponNo,
      params.outcome ?? 'PAID',
      paid ? (params.paymentDate ?? '2026-11-19') : null,
      paid ? (params.grossAmount ?? '600000') : null,
      paid ? '600000' : null,
      paid ? '92400' : null,
    ],
  )
  return { id: result.rows[0].id }
}
