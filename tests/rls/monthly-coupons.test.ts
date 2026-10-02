import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actingAs, asOwner } from './helpers/client'
import { resolveDatabaseUrl } from './helpers/env'
import { expectConstraintViolation } from './helpers/expect'
import { USER_A } from './helpers/fixtures'
import {
  seedAsset,
  seedCouponPayment,
  seedCouponSchedule,
  seedMonthlyProduct,
  seedProduct,
  seedRealizedMonthlyProduct,
} from './helpers/seed'

/**
 * 월지급식 — DOC-002 v1.15 §4.6 · §4.9 · §4.13 · §4.14 · I-12 · I-21 · I-23~I-27 · DOC-010 AQ-93 (P8 컷 b2 · M-b2)
 *
 * **각 케이스는 한 규칙만 위반한다**(constraints.test.ts 머리 주석의 규약) — 이름(`constraint`)까지 단언한다.
 * BEFORE 행 트리거는 CHECK보다 먼저 돌므로(실측, P8 a2) 트리거가 거부할 값과 CHECK가 거부할 값이 한 행에 섞이지
 * 않게 고른다. 트리거는 이름순으로 발화한다 — 자릿수(`*_check_amount_scale`)가 부모(`*_check_parent` ·
 * `*_check_coupon_terms`)보다 앞이다.
 *
 * 날짜는 EM2048 꼴이다 — 발행 2026-10-16, k번째 달 평가일 = 발행일 + k개월(16일), 6번째 달(2027-04-16)이 1차
 * 조기상환 평가일과 같은 날이다(DOC-005 §8.3).
 *
 * 마지막 describe만 **커밋한다** — 동시 트랜잭션은 롤백 하네스 안에서 재현할 수 없다. 전용 이름(`AQ93-`)으로
 * 만들고 케이스마다 지운다(파일은 순차 실행이다 — `fileParallelism: false`).
 */

// ---------------------------------------------------------------------------
// I-23 — 월지급 조건의 짝 (els_products_monthly_terms_check)
// ---------------------------------------------------------------------------

const insertTerms = `insert into public.els_products
    (owner_id, name, issue_date, principal, currency, evaluation_period_months,
     annual_coupon_rate, coupon_payout, monthly_coupon_annual_rate, account_type, entry_mode)
  values ($1, '짝 시험', $2, 100000000, 'KRW', 6, $3, $4, $5, 'GENERAL', $6)
  returning id`

async function termsRow(params: {
  annual: string | null
  payout: 'AT_REDEMPTION' | 'MONTHLY'
  monthly: string | null
  mode?: 'FULL' | 'REALIZED_ONLY'
}) {
  const mode = params.mode ?? 'FULL'
  return actingAs(USER_A).query(insertTerms, [
    USER_A,
    mode === 'FULL' ? '2026-10-16' : null,
    params.annual,
    params.payout,
    params.monthly,
    mode,
  ])
}

describe('I-23 — 쿠폰 지급방식과 두 율의 짝', () => {
  it('FULL · MONTHLY는 연쿠폰율 0 + 월수익 연쿠폰율 > 0이다 (통과)', async () => {
    const inserted = await termsRow({ annual: '0', payout: 'MONTHLY', monthly: '0.0720' })
    expect(inserted.rowCount).toBe(1)
  })

  it('★ FULL · MONTHLY인데 월수익 연쿠폰율이 NULL이면 거부한다 — coalesce(…, false)가 막는 구멍', async () => {
    await expectConstraintViolation(
      () => termsRow({ annual: '0', payout: 'MONTHLY', monthly: null }),
      '23514',
      'els_products_monthly_terms_check',
    )
  })

  it('계기 — coalesce를 뗀 같은 식은 그 행에서 NULL이다(CHECK는 NULL을 통과로 본다)', async () => {
    // 위 케이스가 「식의 다른 조각 때문에」 초록이 아님을 가른다 — coalesce가 하중을 받는다
    const bare = await asOwner<{ verdict: boolean | null }>(
      `select case 'FULL'::public.product_entry_mode
                when 'FULL' then ('MONTHLY'::public.coupon_payout = 'MONTHLY' and 0::numeric = 0 and null::numeric > 0)
                              or ('MONTHLY'::public.coupon_payout = 'AT_REDEMPTION' and null::numeric is null)
              end as verdict`,
    )
    expect(bare.rows[0].verdict).toBeNull()
  })

  it('FULL · MONTHLY에 헤드라인 율을 연쿠폰율로 두면 거부한다 — 이중 계상(DQ-11)', async () => {
    await expectConstraintViolation(
      () => termsRow({ annual: '0.0720', payout: 'MONTHLY', monthly: '0.0720' }),
      '23514',
      'els_products_monthly_terms_check',
    )
  })

  it('FULL · AT_REDEMPTION에 월수익 연쿠폰율이 남으면 거부한다', async () => {
    await expectConstraintViolation(
      () => termsRow({ annual: '0.0800', payout: 'AT_REDEMPTION', monthly: '0.0500' }),
      '23514',
      'els_products_monthly_terms_check',
    )
  })

  it('기실현 월지급은 두 율이 없다 (통과) — 월수익 연쿠폰율이 있으면 거부한다', async () => {
    const ok = await termsRow({ annual: null, payout: 'MONTHLY', monthly: null, mode: 'REALIZED_ONLY' })
    expect(ok.rowCount).toBe(1)
    await expectConstraintViolation(
      () => termsRow({ annual: null, payout: 'MONTHLY', monthly: '0.0720', mode: 'REALIZED_ONLY' }),
      '23514',
      'els_products_monthly_terms_check',
    )
  })

  it('기존 행은 전부 AT_REDEMPTION · 월수익 연쿠폰율 NULL로 백필된다 — 열 기본값(W4 expand)', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const row = await asOwner<{ coupon_payout: string; monthly: string | null }>(
      `select coupon_payout::text, monthly_coupon_annual_rate::text as monthly
         from public.els_products where id = $1`,
      [product.id],
    )
    expect(row.rows[0]).toEqual({ coupon_payout: 'AT_REDEMPTION', monthly: null })
  })
})

// ---------------------------------------------------------------------------
// I-24 — 월수익 일정 행
// ---------------------------------------------------------------------------

describe('I-24 — 월수익 일정의 값', () => {
  it('같은 상품의 순번은 중복될 수 없다', async () => {
    const product = await seedMonthlyProduct({})
    await seedCouponSchedule({ elsId: product.id, couponNo: 1, evaluationDate: '2026-11-16' })
    await expectConstraintViolation(
      () => seedCouponSchedule({ elsId: product.id, couponNo: 1, evaluationDate: '2026-12-16' }),
      '23505',
      'monthly_coupon_schedules_els_id_coupon_no_key',
    )
  })

  it('순번은 1 이상이다 — round_no에 없던 하한(AQ-92)을 되풀이하지 않는다', async () => {
    const product = await seedMonthlyProduct({})
    await expectConstraintViolation(
      () => seedCouponSchedule({ elsId: product.id, couponNo: 0, evaluationDate: '2026-11-16' }),
      '23514',
      'monthly_coupon_schedules_coupon_no_check',
    )
  })

  it('지급일은 평가일보다 앞설 수 없다 — 같은 날은 통과', async () => {
    const product = await seedMonthlyProduct({})
    await seedCouponSchedule({
      elsId: product.id,
      couponNo: 1,
      evaluationDate: '2026-11-16',
      paymentDate: '2026-11-16',
    })
    await expectConstraintViolation(
      () =>
        seedCouponSchedule({
          elsId: product.id,
          couponNo: 2,
          evaluationDate: '2026-12-16',
          paymentDate: '2026-12-15',
        }),
      '23514',
      'monthly_coupon_schedules_payment_date_check',
    )
  })

  it('월수익 배리어는 0보다 크다', async () => {
    const product = await seedMonthlyProduct({})
    await expectConstraintViolation(
      () =>
        seedCouponSchedule({
          elsId: product.id,
          couponNo: 1,
          evaluationDate: '2026-11-16',
          couponBarrier: '0',
        }),
      '23514',
      'monthly_coupon_schedules_coupon_barrier_check',
    )
  })
})

// ---------------------------------------------------------------------------
// I-21 · I-26 — 월수익 지급 기록의 형태
// ---------------------------------------------------------------------------

const insertPayment = `insert into public.monthly_coupon_payments
    (els_id, coupon_no, outcome, payment_date, gross_amount, taxable_income, withholding_tax,
     exchange_rate, is_confirmed)
  values ($1, $2, $3, $4, $5, $6, $7, $8, true)`

type PaymentValues = {
  couponNo?: number | null
  outcome?: 'PAID' | 'UNPAID'
  paymentDate?: string | null
  grossAmount?: string | null
  taxableIncome?: string | null
  withholdingTax?: string | null
  exchangeRate?: string | null
}

function payment(elsId: string, values: PaymentValues = {}) {
  return actingAs(USER_A).query(insertPayment, [
    elsId,
    values.couponNo === undefined ? 1 : values.couponNo,
    values.outcome ?? 'PAID',
    values.paymentDate === undefined ? '2026-11-19' : values.paymentDate,
    values.grossAmount === undefined ? '600000' : values.grossAmount,
    values.taxableIncome === undefined ? '600000' : values.taxableIncome,
    values.withholdingTax === undefined ? '92400' : values.withholdingTax,
    values.exchangeRate === undefined ? null : values.exchangeRate,
  ])
}

const UNPAID: PaymentValues = {
  outcome: 'UNPAID',
  paymentDate: null,
  grossAmount: null,
  taxableIncome: null,
  withholdingTax: null,
}

/** 월지급 원화 상품 + 1번째 달(2026-11-16 평가) */
async function monthlyWithFirstMonth(currency: 'KRW' | 'USD' = 'KRW'): Promise<string> {
  const product = await seedMonthlyProduct({ currency })
  await seedCouponSchedule({ elsId: product.id, couponNo: 1, evaluationDate: '2026-11-16' })
  return product.id
}

describe('I-26 — 기록의 형태 (monthly_coupon_payments_outcome_check)', () => {
  it('지급과 미지급의 정상 형태는 통과한다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await seedCouponSchedule({ elsId, couponNo: 2, evaluationDate: '2026-12-16' })
    expect((await payment(elsId)).rowCount).toBe(1)
    expect((await payment(elsId, { ...UNPAID, couponNo: 2 })).rowCount).toBe(1)
  })

  it('지급인데 지급일이 없으면 거부한다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { paymentDate: null }),
      '23514',
      'monthly_coupon_payments_outcome_check',
    )
  })

  it('지급의 세전은 0보다 크다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { grossAmount: '0' }),
      '23514',
      'monthly_coupon_payments_outcome_check',
    )
  })

  it('미지급에 금액이 남으면 거부한다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { ...UNPAID, grossAmount: '600000' }),
      '23514',
      'monthly_coupon_payments_outcome_check',
    )
  })

  it('★ 순번 없는 미지급은 트리거를 끄면(데이터 전용 복원의 상태) CHECK가 거부한다 — 복원에서도 재검증되는 층', async () => {
    // 평소에는 기록 쪽 트리거(`*_coupon_no_required`)가 먼저 막으므로 CHECK의 그 조각은 보이지 않는다.
    // 복원(session_replication_role = replica)은 트리거만 끄고 CHECK는 남긴다 — 그 상태를 재현한다(롤백된다)
    const realized = await seedRealizedMonthlyProduct({})
    await asOwner('alter table public.monthly_coupon_payments disable trigger user')
    await expectConstraintViolation(
      () =>
        asOwner(insertPayment, [realized.id, null, 'UNPAID', null, null, null, null, null]),
      '23514',
      'monthly_coupon_payments_outcome_check',
    )
  })

  it('순번은 1 이상이다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { couponNo: 0 }),
      '23514',
      'monthly_coupon_payments_coupon_no_check',
    )
  })

  it('값 범위 — 과세 · 원천징수는 0 이상, 적용 환율은 0보다 크다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { taxableIncome: '-1' }),
      '23514',
      'monthly_coupon_payments_taxable_income_check',
    )
    await expectConstraintViolation(
      () => payment(elsId, { withholdingTax: '-1' }),
      '23514',
      'monthly_coupon_payments_withholding_tax_check',
    )
    await expectConstraintViolation(
      () => payment(elsId, { exchangeRate: '0' }),
      '23514',
      'monthly_coupon_payments_exchange_rate_check',
    )
  })

  it('같은 달은 한 번만 기록한다 · 기실현 기록은 지급일이 중복될 수 없다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await payment(elsId)
    await expectConstraintViolation(
      () => payment(elsId, { paymentDate: '2026-11-20' }),
      '23505',
      'monthly_coupon_payments_els_id_coupon_no_key',
    )

    const realized = await seedRealizedMonthlyProduct({})
    await payment(realized.id, { couponNo: null })
    await expectConstraintViolation(
      () => payment(realized.id, { couponNo: null }),
      '23505',
      'monthly_coupon_payments_els_id_payment_date_key',
    )
  })
})

describe('I-21 — 월수익(세전)의 자릿수 두 층', () => {
  it('원화 부모의 센트는 트리거 라벨로 거부한다', async () => {
    const elsId = await monthlyWithFirstMonth('KRW')
    await expectConstraintViolation(
      () => payment(elsId, { grossAmount: '600000.5' }),
      '23514',
      'monthly_coupon_payments_gross_amount_scale',
    )
  })

  it('달러 부모는 센트까지 통과하고 셋째 자리는 CHECK가 거부한다(트리거가 가로채지 않는다)', async () => {
    const elsId = await monthlyWithFirstMonth('USD')
    expect((await payment(elsId, { grossAmount: '202.00', exchangeRate: '1385.200000' })).rowCount).toBe(1)
    await seedCouponSchedule({ elsId, couponNo: 2, evaluationDate: '2026-12-16' })
    await expectConstraintViolation(
      () => payment(elsId, { couponNo: 2, paymentDate: '2026-12-21', grossAmount: '202.001' }),
      '23514',
      'monthly_coupon_payments_gross_amount_digits_check',
    )
  })

  it('정수부 15자리를 넘으면 CHECK가 거부한다', async () => {
    const elsId = await monthlyWithFirstMonth('KRW')
    await expectConstraintViolation(
      () => payment(elsId, { grossAmount: '1000000000000000' }),
      '23514',
      'monthly_coupon_payments_gross_amount_digits_check',
    )
  })

  it('미지급의 NULL 금액은 두 층을 모두 지난다', async () => {
    const elsId = await monthlyWithFirstMonth('KRW')
    expect((await payment(elsId, UNPAID)).rowCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I-27 — 기록의 부모 (기록 쪽 트리거 셋 + 복합 FK)
// ---------------------------------------------------------------------------

describe('I-27 기록 쪽 — 부모 트리거 셋', () => {
  it('상환 시 지급 상품에는 기록할 수 없다 (monthly_required)', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    await expectConstraintViolation(
      () => payment(product.id, { couponNo: null }),
      '23514',
      'monthly_coupon_payments_monthly_required',
    )
  })

  it('FULL 부모의 기록은 순번이 있어야 한다 (coupon_no_required)', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { couponNo: null }),
      '23514',
      'monthly_coupon_payments_coupon_no_required',
    )
  })

  it('기실현 부모의 기록은 순번 없는 지급뿐이다 — 순번 · 미지급은 거부', async () => {
    const realized = await seedRealizedMonthlyProduct({})
    expect((await payment(realized.id, { couponNo: null })).rowCount).toBe(1)
    await expectConstraintViolation(
      () => payment(realized.id, { couponNo: 1, paymentDate: '2026-12-21' }),
      '23514',
      'monthly_coupon_payments_coupon_no_required',
    )
    await expectConstraintViolation(
      () => payment(realized.id, { ...UNPAID, couponNo: 1 }),
      '23514',
      'monthly_coupon_payments_coupon_no_required',
    )
  })

  it('순번은 그 상품의 일정에 실재해야 한다 (복합 FK)', async () => {
    const elsId = await monthlyWithFirstMonth()
    await expectConstraintViolation(
      () => payment(elsId, { couponNo: 2 }),
      '23503',
      'monthly_coupon_payments_els_id_coupon_no_fkey',
    )
  })
})

const insertRedemption = `insert into public.redemptions
    (els_id, redemption_type, round_no, redemption_date, gross_amount, taxable_income, is_confirmed)
  values ($1, 'MATURITY_GAIN', null, $2, $3, $4, true)
  returning id`

function redeem(elsId: string, date: string, gross = '100000000', taxable = '0') {
  return actingAs(USER_A).query<{ id: string }>(insertRedemption, [elsId, date, gross, taxable])
}

/** 월지급 원화 상품 + 6번째 달(2027-04-16 평가 · 2027-04-21 지급)과 7번째 달(2027-05-16) */
async function monthlyWithSixAndSeven(): Promise<string> {
  const product = await seedMonthlyProduct({})
  await seedCouponSchedule({
    elsId: product.id,
    couponNo: 6,
    evaluationDate: '2027-04-16',
    paymentDate: '2027-04-21',
  })
  await seedCouponSchedule({ elsId: product.id, couponNo: 7, evaluationDate: '2027-05-16' })
  return product.id
}

describe('I-27 ② — 상환 뒤 달은 양방향으로 막는다 (비교 키 = 그 달의 월수익 평가일)', () => {
  it('상환이 먼저면 그 뒤에 평가된 달의 기록은 지급이든 미지급이든 거부한다', async () => {
    const elsId = await monthlyWithSixAndSeven()
    await redeem(elsId, '2027-04-16')
    await expectConstraintViolation(
      () => payment(elsId, { couponNo: 7, paymentDate: '2027-05-19' }),
      '23514',
      'monthly_coupon_payments_after_redemption',
    )
    await expectConstraintViolation(
      () => payment(elsId, { ...UNPAID, couponNo: 7 }),
      '23514',
      'monthly_coupon_payments_after_redemption',
    )
  })

  it('★ 상환일과 같은 날 평가된 달은 기록할 수 있다 — 지급일이 상환일 뒤여도(RD-18)', async () => {
    const elsId = await monthlyWithSixAndSeven()
    await redeem(elsId, '2027-04-16')
    // 지급일(2027-04-21) > 상환일(2027-04-16)이지만 평가일(2027-04-16) ≤ 상환일이다 — 지급일로 비교했다면 거부된다
    expect((await payment(elsId, { couponNo: 6, paymentDate: '2027-04-21' })).rowCount).toBe(1)
  })

  it('기록이 먼저면 그 달 평가일보다 이른 상환일은 거부한다 — 미지급 기록도 본다(대칭)', async () => {
    const paid = await monthlyWithSixAndSeven()
    await seedCouponPayment({ elsId: paid, couponNo: 6, paymentDate: '2027-04-21' })
    await expectConstraintViolation(
      () => redeem(paid, '2027-03-20'),
      '23514',
      'redemptions_before_coupon_payment',
    )

    const unpaid = await monthlyWithSixAndSeven()
    await seedCouponPayment({ elsId: unpaid, couponNo: 6, outcome: 'UNPAID' })
    await expectConstraintViolation(
      () => redeem(unpaid, '2027-03-20'),
      '23514',
      'redemptions_before_coupon_payment',
    )
  })

  it('상환일 = 기록된 달의 최대 평가일은 통과하고, 상환일을 앞당기는 수정은 거부한다', async () => {
    const elsId = await monthlyWithSixAndSeven()
    await seedCouponPayment({ elsId, couponNo: 6, paymentDate: '2027-04-21' })
    const created = await redeem(elsId, '2027-04-16')
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.redemptions set redemption_date = '2027-04-15' where id = $1`,
          [created.rows[0].id],
        ),
      '23514',
      'redemptions_before_coupon_payment',
    )
  })

  it('순번 없는 기실현 기록은 평가일이 없어 검사 밖이다', async () => {
    const realized = await seedRealizedMonthlyProduct({})
    await payment(realized.id, { couponNo: null, paymentDate: '2027-06-01' })
    expect((await redeem(realized.id, '2027-01-04')).rowCount).toBe(1)
  })
})

describe('I-27 ⑤ — 월지급식 상품의 상환은 원금만이다 (redemptions_monthly_principal_only)', () => {
  it('세전이 원금을 넘으면 거부한다 — 같은 날 월수익을 합쳐 적은 경우(검산 B-3)', async () => {
    const elsId = await monthlyWithSixAndSeven()
    await expectConstraintViolation(
      () => redeem(elsId, '2027-04-16', '100600000', '0'),
      '23514',
      'redemptions_monthly_principal_only',
    )
  })

  it('과세가 0이 아니면 거부한다', async () => {
    const elsId = await monthlyWithSixAndSeven()
    await expectConstraintViolation(
      () => redeem(elsId, '2027-04-16', '100000000', '1'),
      '23514',
      'redemptions_monthly_principal_only',
    )
  })

  it('원금 · 과세 0은 통과하고 손실 상환(원금 미만)도 통과한다', async () => {
    expect((await redeem(await monthlyWithSixAndSeven(), '2027-04-16')).rowCount).toBe(1)
    expect((await redeem(await monthlyWithSixAndSeven(), '2027-04-16', '78000000', '0')).rowCount).toBe(1)
  })

  it('상환 시 지급 상품은 그대로다 — 원금을 넘는 상환이 정상이다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    expect((await redeem(product.id, '2027-01-04', '104000000', '4000000')).rowCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 기록 뒤 동결 둘 (DQ-14 · AQ-79) — 값이 바뀔 때만
// ---------------------------------------------------------------------------

describe('기록 뒤 동결 — 상품 통화 · 쿠폰 지급방식 (els_products_coupon_recorded_immutable)', () => {
  it('기록이 있으면 통화를 바꿀 수 없다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await seedCouponPayment({ elsId, couponNo: 1 })
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.els_products set currency = 'USD', principal = 100000 where id = $1`,
          [elsId],
        ),
      '23514',
      'els_products_coupon_recorded_immutable',
    )
  })

  it('기록이 있으면 지급방식을 바꿀 수 없다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await seedCouponPayment({ elsId, couponNo: 1 })
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.els_products
              set coupon_payout = 'AT_REDEMPTION', monthly_coupon_annual_rate = null, annual_coupon_rate = 0.08
            where id = $1`,
          [elsId],
        ),
      '23514',
      'els_products_coupon_recorded_immutable',
    )
  })

  it('★ 동일값 재대입은 통과한다 — 원금 · 월수익 연쿠폰율은 기록이 있어도 고칠 수 있다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await seedCouponPayment({ elsId, couponNo: 1 })
    const updated = await actingAs(USER_A).query(
      `update public.els_products
          set currency = currency, coupon_payout = coupon_payout,
              principal = 90000000, monthly_coupon_annual_rate = 0.0800
        where id = $1`,
      [elsId],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('기록이 없으면 지급방식을 바꿀 수 있다 — 짝 통제', async () => {
    const elsId = await monthlyWithFirstMonth()
    const updated = await actingAs(USER_A).query(
      `update public.els_products
          set coupon_payout = 'AT_REDEMPTION', monthly_coupon_annual_rate = null, annual_coupon_rate = 0.08
        where id = $1`,
      [elsId],
    )
    expect(updated.rowCount).toBe(1)
  })
})

describe('기록 뒤 동결 — 기록된 달의 일정 (monthly_coupon_schedules_recorded_immutable)', () => {
  async function recordedFirstMonth(): Promise<{ elsId: string; scheduleId: string }> {
    const product = await seedMonthlyProduct({})
    const schedule = await seedCouponSchedule({
      elsId: product.id,
      couponNo: 1,
      evaluationDate: '2026-11-16',
    })
    await seedCouponPayment({ elsId: product.id, couponNo: 1 })
    return { elsId: product.id, scheduleId: schedule.id }
  }

  it.each([
    ['평가일', `evaluation_date = '2026-11-17'`],
    ['지급일', `payment_date = '2026-11-20'`],
    ['순번', 'coupon_no = 2'],
  ])('기록된 달의 %s을 바꿀 수 없다', async (_label, assignment) => {
    const { scheduleId } = await recordedFirstMonth()
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query(
          `update public.monthly_coupon_schedules set ${assignment} where id = $1`,
          [scheduleId],
        ),
      '23514',
      'monthly_coupon_schedules_recorded_immutable',
    )
  })

  it('★ 동일값 재대입과 배리어 수정은 통과한다 — 수정 저장의 upsert가 그 형태다', async () => {
    const { scheduleId } = await recordedFirstMonth()
    const updated = await actingAs(USER_A).query(
      `update public.monthly_coupon_schedules
          set evaluation_date = evaluation_date, payment_date = payment_date,
              coupon_no = coupon_no, coupon_barrier = 0.5500
        where id = $1`,
      [scheduleId],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('기록 없는 달은 고칠 수 있다 — 짝 통제', async () => {
    const { elsId } = await recordedFirstMonth()
    const second = await seedCouponSchedule({ elsId, couponNo: 2, evaluationDate: '2026-12-16' })
    const updated = await actingAs(USER_A).query(
      `update public.monthly_coupon_schedules set evaluation_date = '2026-12-17' where id = $1`,
      [second.id],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('기록된 달의 일정 행은 지울 수 없다 (복합 FK RESTRICT)', async () => {
    const { scheduleId } = await recordedFirstMonth()
    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('delete from public.monthly_coupon_schedules where id = $1', [
          scheduleId,
        ]),
      '23503',
      'monthly_coupon_payments_els_id_coupon_no_fkey',
    )
  })
})

describe('§8.1 삭제 전파 — 일정은 CASCADE, 기록은 RESTRICT', () => {
  it('기록이 있는 상품은 지울 수 없다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await seedCouponPayment({ elsId, couponNo: 1 })
    await expectConstraintViolation(
      () => actingAs(USER_A).query('delete from public.els_products where id = $1', [elsId]),
      '23503',
      'monthly_coupon_payments_els_id_fkey',
    )
  })

  it('기록이 없으면 상품과 함께 일정이 사라진다', async () => {
    const elsId = await monthlyWithFirstMonth()
    await actingAs(USER_A).query('delete from public.els_products where id = $1', [elsId])
    const left = await asOwner('select 1 from public.monthly_coupon_schedules where els_id = $1', [
      elsId,
    ])
    expect(left.rowCount).toBe(0)
  })
})

describe('I-12 확장 — 상환의 원천징수세액 ≥ 0 (DQ-17 ④)', () => {
  it('음수 원천징수세액은 거부한다 · 0은 통과한다', async () => {
    const product = await seedProduct({ ownerId: USER_A })
    const insert = `insert into public.redemptions
        (els_id, redemption_type, round_no, redemption_date, gross_amount, taxable_income,
         withholding_tax, is_confirmed)
      values ($1, 'MATURITY_LOSS', null, '2027-01-04', 78000000, 0, $2, true)`
    await expectConstraintViolation(
      () => actingAs(USER_A).query(insert, [product.id, '-1']),
      '23514',
      'redemptions_withholding_tax_check',
    )
    expect((await actingAs(USER_A).query(insert, [product.id, '0'])).rowCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 쓰기 함수 셋 — 지급방식 coalesce · 월수익 일정 · 꼬리 검사 (I-25)
// ---------------------------------------------------------------------------

type Payload = Record<string, unknown>

function productPayload(assetId: string, overrides: Payload = {}): Payload {
  return {
    name: '쓰기 함수 시험',
    issuer: null,
    issueDate: '2026-10-16',
    principal: '100000000',
    currency: 'KRW',
    evaluationPeriodMonths: 6,
    annualCouponRate: '0.0800',
    kiBarrier: null,
    kiObservation: null,
    accountType: 'GENERAL',
    note: null,
    underlyings: [{ assetId, basePrice: '100.000000', sequence: 1 }],
    schedules: [{ roundNo: 1, evaluationDate: '2027-04-16', barrier: '0.90' }],
    ...overrides,
  }
}

const MONTHLY_TERMS: Payload = {
  couponPayout: 'MONTHLY',
  annualCouponRate: '0',
  monthlyCouponAnnualRate: '0.0720',
  couponSchedules: [
    { couponNo: 1, evaluationDate: '2026-11-16', paymentDate: '2026-11-19', couponBarrier: '0.60' },
    { couponNo: 2, evaluationDate: '2026-12-16', paymentDate: '2026-12-21', couponBarrier: '0.60' },
  ],
}

async function create(payload: Payload): Promise<string> {
  const result = await actingAs(USER_A).query<{ id: string }>(
    'select public.create_els_product($1::jsonb) as id',
    [JSON.stringify(payload)],
  )
  return result.rows[0].id
}

function update(id: string, payload: Payload) {
  return actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb) as id', [
    id,
    JSON.stringify(payload),
  ])
}

async function scheduleRows(elsId: string) {
  const rows = await asOwner<{ coupon_no: number; evaluation_date: string; coupon_barrier: string }>(
    `select coupon_no, evaluation_date::text, coupon_barrier::text
       from public.monthly_coupon_schedules where els_id = $1 order by coupon_no`,
    [elsId],
  )
  return rows.rows
}

describe('쓰기 함수 — 지급방식 (W4 expand의 coalesce)', () => {
  it('지급방식을 싣지 않은 생성은 상환 시 지급이다 — 배포 중인 구 코드의 경로', async () => {
    const asset = await seedAsset({ name: 'expand 생성' })
    const id = await create(productPayload(asset.id))
    const row = await asOwner<{ coupon_payout: string }>(
      'select coupon_payout::text from public.els_products where id = $1',
      [id],
    )
    expect(row.rows[0].coupon_payout).toBe('AT_REDEMPTION')
  })

  it('월지급식 생성은 지급방식 · 율 · 월수익 일정을 함께 저장한다', async () => {
    const asset = await seedAsset({ name: '월지급 생성' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    const row = await asOwner<{ coupon_payout: string; monthly: string }>(
      `select coupon_payout::text, monthly_coupon_annual_rate::text as monthly
         from public.els_products where id = $1`,
      [id],
    )
    expect(row.rows[0]).toEqual({ coupon_payout: 'MONTHLY', monthly: '0.0720' })
    expect((await scheduleRows(id)).map((r) => r.coupon_no)).toEqual([1, 2])
  })

  it('★ 지급방식을 싣지 않은 수정은 «저장값»을 지킨다 — AT_REDEMPTION으로 떨어지지 않는다', async () => {
    const asset = await seedAsset({ name: 'expand 수정' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    const { couponPayout: _dropped, ...withoutPayout } = MONTHLY_TERMS
    await update(id, productPayload(asset.id, withoutPayout))
    const row = await asOwner<{ coupon_payout: string }>(
      'select coupon_payout::text from public.els_products where id = $1',
      [id],
    )
    expect(row.rows[0].coupon_payout).toBe('MONTHLY')
  })
})

describe('쓰기 함수 — 꼬리 검사 셋 (I-25, 계약 경로만)', () => {
  it('월지급식인데 월수익 일정이 없으면 거부한다', async () => {
    const asset = await seedAsset({ name: '꼬리 required' })
    await expectConstraintViolation(
      () => create(productPayload(asset.id, { ...MONTHLY_TERMS, couponSchedules: [] })),
      '23514',
      'els_products_monthly_schedules_required',
    )
  })

  it('상환 시 지급인데 월수익 일정이 있으면 거부한다', async () => {
    const asset = await seedAsset({ name: '꼬리 forbidden' })
    await expectConstraintViolation(
      () =>
        create(
          productPayload(asset.id, { couponSchedules: MONTHLY_TERMS.couponSchedules }),
        ),
      '23514',
      'els_products_monthly_schedules_forbidden',
    )
  })

  it('월지급식에 리자드 차수가 있으면 거부한다 — 월지급 + 리자드는 v2', async () => {
    const asset = await seedAsset({ name: '꼬리 lizard' })
    await expectConstraintViolation(
      () =>
        create(
          productPayload(asset.id, {
            ...MONTHLY_TERMS,
            schedules: [
              {
                roundNo: 1,
                evaluationDate: '2027-04-16',
                barrier: '0.90',
                lizardBarrier: '0.80',
                lizardCouponRate: '0.02',
                lizardRequiresNoKi: true,
              },
            ],
          }),
        ),
      '23514',
      'els_products_monthly_lizard_forbidden',
    )
  })

  it('수정이 월수익 일정을 비우면 거부한다 — 값을 줄이는 경로에도 건다', async () => {
    const asset = await seedAsset({ name: '꼬리 update' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    await expectConstraintViolation(
      () => update(id, productPayload(asset.id, { ...MONTHLY_TERMS, couponSchedules: [] })),
      '23514',
      'els_products_monthly_schedules_required',
    )
  })
})

describe('쓰기 함수 — 월수익 일정은 전체 교체가 아니다 (입력에 없는 순번 delete + coupon_no upsert)', () => {
  it('입력에 없는 달은 지우고, 있는 달은 고치고, 새 달은 더한다', async () => {
    const asset = await seedAsset({ name: 'upsert' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    await update(
      id,
      productPayload(asset.id, {
        ...MONTHLY_TERMS,
        couponSchedules: [
          { couponNo: 2, evaluationDate: '2026-12-17', paymentDate: '2026-12-22', couponBarrier: '0.55' },
          { couponNo: 3, evaluationDate: '2027-01-18', paymentDate: '2027-01-21', couponBarrier: '0.60' },
        ],
      }),
    )
    expect(await scheduleRows(id)).toEqual([
      { coupon_no: 2, evaluation_date: '2026-12-17', coupon_barrier: '0.5500' },
      { coupon_no: 3, evaluation_date: '2027-01-18', coupon_barrier: '0.6000' },
    ])
  })

  it('★ 기록된 달의 같은 날짜 재대입은 통과하고 배리어만 바뀐다', async () => {
    const asset = await seedAsset({ name: 'upsert 기록'})
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    await seedCouponPayment({ elsId: id, couponNo: 1 })
    const schedules = MONTHLY_TERMS.couponSchedules as Payload[]
    await update(
      id,
      productPayload(asset.id, {
        ...MONTHLY_TERMS,
        couponSchedules: [{ ...schedules[0], couponBarrier: '0.50' }, schedules[1]],
      }),
    )
    expect((await scheduleRows(id))[0]).toEqual({
      coupon_no: 1,
      evaluation_date: '2026-11-16',
      coupon_barrier: '0.5000',
    })
  })

  it('기록된 달을 입력에서 빼면 복합 FK가 막는다 — 계약 사전 검사 뒤의 마지막 그물', async () => {
    const asset = await seedAsset({ name: 'upsert 삭제' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    await seedCouponPayment({ elsId: id, couponNo: 1 })
    const schedules = MONTHLY_TERMS.couponSchedules as Payload[]
    await expectConstraintViolation(
      () => update(id, productPayload(asset.id, { ...MONTHLY_TERMS, couponSchedules: [schedules[1]] })),
      '23503',
      'monthly_coupon_payments_els_id_coupon_no_fkey',
    )
  })

  it('기록된 달의 평가일을 바꾸면 동결 트리거가 막는다', async () => {
    const asset = await seedAsset({ name: 'upsert 동결' })
    const id = await create(productPayload(asset.id, MONTHLY_TERMS))
    await seedCouponPayment({ elsId: id, couponNo: 1 })
    const schedules = MONTHLY_TERMS.couponSchedules as Payload[]
    await expectConstraintViolation(
      () =>
        update(
          id,
          productPayload(asset.id, {
            ...MONTHLY_TERMS,
            couponSchedules: [{ ...schedules[0], evaluationDate: '2026-11-17' }, schedules[1]],
          }),
        ),
      '23514',
      'monthly_coupon_schedules_recorded_immutable',
    )
  })
})

describe('쓰기 함수 — 기실현 등재', () => {
  const realizedPayload = (overrides: Payload = {}) => ({
    name: '기실현 월지급',
    issuer: null,
    principal: '100000000',
    currency: 'KRW',
    accountType: 'GENERAL',
    redemptionType: 'MATURITY_GAIN',
    redemptionDate: '2026-04-16',
    grossAmount: '100000000',
    taxableIncome: '0',
    withholdingTax: '0',
    exchangeRate: null,
    isConfirmed: true,
    note: null,
    ...overrides,
  })

  it('지급방식을 받고, 월지급식이면 상환은 원금만이다(V-29 — §5.11도 같다)', async () => {
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_realized_els_product($1::jsonb) as id',
      [JSON.stringify(realizedPayload({ couponPayout: 'MONTHLY' }))],
    )
    const row = await asOwner<{ coupon_payout: string }>(
      'select coupon_payout::text from public.els_products where id = $1',
      [created.rows[0].id],
    )
    expect(row.rows[0].coupon_payout).toBe('MONTHLY')

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.create_realized_els_product($1::jsonb)', [
          JSON.stringify(
            realizedPayload({ couponPayout: 'MONTHLY', grossAmount: '103600000', taxableIncome: '3600000' }),
          ),
        ]),
      '23514',
      'redemptions_monthly_principal_only',
    )
  })

  it('지급방식을 싣지 않으면 상환 시 지급이다 — W4 expand', async () => {
    const created = await actingAs(USER_A).query<{ id: string }>(
      'select public.create_realized_els_product($1::jsonb) as id',
      [JSON.stringify(realizedPayload({ grossAmount: '103600000', taxableIncome: '3600000' }))],
    )
    const row = await asOwner<{ coupon_payout: string }>(
      'select coupon_payout::text from public.els_products where id = $1',
      [created.rows[0].id],
    )
    expect(row.rows[0].coupon_payout).toBe('AT_REDEMPTION')
  })
})

// ---------------------------------------------------------------------------
// AQ-93 — 동시 트랜잭션 (부모 행 잠금). 이 describe만 커밋한다
// ---------------------------------------------------------------------------

const AQ93 = 'AQ93-경합'

/** 사용자 세션 하나를 흉내 낸 «별도» 연결 — 트랜잭션을 열고 롤 · claims를 세운다(헬퍼 `actingAs`와 같은 두 절반) */
async function sessionAs(userId: string): Promise<{ client: Client; pid: number }> {
  const client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  await client.query('begin')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' }),
  ])
  await client.query('set local role authenticated')
  const pid = await client.query<{ pid: number }>('select pg_backend_pid() as pid')
  return { client, pid: pid.rows[0].pid }
}

/** 소유자 권한의 «커밋하는» 연결 — 준비 · 관측 · 정리 전용 */
async function ownerConnection(): Promise<Client> {
  const client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
  return client
}

async function cleanupAq93(owner: Client): Promise<void> {
  const ids = `(select id from public.els_products where name like '${AQ93}%')`
  await owner.query(`delete from public.monthly_coupon_payments where els_id in ${ids}`)
  await owner.query(`delete from public.redemptions where els_id in ${ids}`)
  await owner.query(`delete from public.els_products where name like '${AQ93}%'`)
  await owner.query(`delete from public.assets where name like '${AQ93}%'`)
}

/**
 * 둘째 연결이 **잠금을 기다리는 중**인지 카탈로그로 확인한다 — 시간으로 짐작하지 않는다.
 * 기다리지 않고 끝났다면(잠금이 없다) 그 사실을 그대로 돌려준다 — 음성 대조가 여기서 갈린다.
 */
async function waitsOnLock(
  owner: Client,
  pid: number,
  pending: { settled: boolean },
): Promise<boolean> {
  for (let i = 0; i < 50; i += 1) {
    if (pending.settled) return false
    const row = await owner.query<{ wait_event_type: string | null }>(
      'select wait_event_type from pg_stat_activity where pid = $1',
      [pid],
    )
    if (row.rows[0]?.wait_event_type === 'Lock') return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false }
  const settled = promise.then(
    (value) => {
      state.settled = true
      return { ok: true as const, value }
    },
    (error: { code?: string; constraint?: string }) => {
      state.settled = true
      return { ok: false as const, error }
    },
  )
  return { state, settled }
}

describe('AQ-93 — 교차 테이블 트리거는 부모 상품 행 잠금으로 직렬화된다 (두 연결 · 커밋)', () => {
  let owner: Client
  let elsId: string
  let assetId: string

  beforeAll(async () => {
    owner = await ownerConnection()
    await cleanupAq93(owner)
  })

  afterAll(async () => {
    await cleanupAq93(owner)
    await owner.end()
  })

  /** 커밋된 월지급 상품 + 6번째 달(2027-04-16 평가) — 케이스마다 새로 만든다 */
  async function committedMonthly(): Promise<void> {
    await cleanupAq93(owner)
    const asset = await owner.query<{ id: string }>(
      `insert into public.assets (name, asset_type, market, currency)
       values ('${AQ93}-자산', 'STOCK', 'NASDAQ', 'USD') returning id`,
    )
    assetId = asset.rows[0].id
    const product = await owner.query<{ id: string }>(
      `insert into public.els_products
         (owner_id, name, issue_date, principal, currency, evaluation_period_months,
          annual_coupon_rate, coupon_payout, monthly_coupon_annual_rate, account_type)
       values ($1, '${AQ93}', '2026-10-16', 100000000, 'KRW', 6, 0, 'MONTHLY', 0.0720, 'GENERAL')
       returning id`,
      [USER_A],
    )
    elsId = product.rows[0].id
    await owner.query(
      `insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
       values ($1, $2, 100, 1)`,
      [elsId, assetId],
    )
    await owner.query(
      `insert into public.redemption_schedules (els_id, round_no, evaluation_date, barrier)
       values ($1, 1, '2027-04-16', 0.90)`,
      [elsId],
    )
    await owner.query(
      `insert into public.monthly_coupon_schedules (els_id, coupon_no, evaluation_date, payment_date, coupon_barrier)
       values ($1, 6, '2027-04-16', '2027-04-21', 0.60)`,
      [elsId],
    )
  }

  const recordSixth = `insert into public.monthly_coupon_payments
      (els_id, coupon_no, outcome, payment_date, gross_amount, taxable_income, withholding_tax, is_confirmed)
    values ($1, 6, 'PAID', '2027-04-21', 600000, 600000, 92400, true)`

  it('① 기록(미커밋) ↔ 더 이른 상환일의 상환 — 상환이 기다린 뒤 redemptions_before_coupon_payment로 거부된다', async () => {
    await committedMonthly()
    const first = await sessionAs(USER_A)
    const second = await sessionAs(USER_A)
    try {
      await first.client.query(recordSixth, [elsId])
      const attempt = track(
        second.client.query(
          `insert into public.redemptions
             (els_id, redemption_type, round_no, redemption_date, gross_amount, taxable_income, is_confirmed)
           values ($1, 'MATURITY_GAIN', null, '2027-03-20', 100000000, 0, true)`,
          [elsId],
        ),
      )
      expect(await waitsOnLock(owner, second.pid, attempt.state), '둘째가 잠금을 기다리지 않았다').toBe(true)
      await first.client.query('commit')
      const outcome = await attempt.settled
      expect(outcome.ok).toBe(false)
      expect(!outcome.ok && outcome.error.constraint).toBe('redemptions_before_coupon_payment')
    } finally {
      await second.client.query('rollback').catch(() => undefined)
      await first.client.end()
      await second.client.end()
    }
    const counts = await owner.query<{ payments: number; redemptions: number }>(
      `select (select count(*) from public.monthly_coupon_payments where els_id = $1)::int as payments,
              (select count(*) from public.redemptions where els_id = $1)::int as redemptions`,
      [elsId],
    )
    expect(counts.rows[0]).toEqual({ payments: 1, redemptions: 0 })
  })

  it('② 기록(미커밋) ↔ 지급방식 수정 — 수정이 기다린 뒤 els_products_coupon_recorded_immutable로 거부된다', async () => {
    await committedMonthly()
    const first = await sessionAs(USER_A)
    const second = await sessionAs(USER_A)
    try {
      await first.client.query(recordSixth, [elsId])
      const attempt = track(
        second.client.query(
          `update public.els_products
              set coupon_payout = 'AT_REDEMPTION', monthly_coupon_annual_rate = null, annual_coupon_rate = 0.08
            where id = $1`,
          [elsId],
        ),
      )
      expect(await waitsOnLock(owner, second.pid, attempt.state), '둘째가 잠금을 기다리지 않았다').toBe(true)
      await first.client.query('commit')
      const outcome = await attempt.settled
      expect(!outcome.ok && outcome.error.constraint).toBe('els_products_coupon_recorded_immutable')
    } finally {
      await second.client.query('rollback').catch(() => undefined)
      await first.client.end()
      await second.client.end()
    }
  })

  it('③ 지급방식 수정(미커밋) ↔ 기록 — 기록이 기다린 뒤 monthly_coupon_payments_monthly_required로 거부된다', async () => {
    await committedMonthly()
    const first = await sessionAs(USER_A)
    const second = await sessionAs(USER_A)
    try {
      await first.client.query(
        `update public.els_products
            set coupon_payout = 'AT_REDEMPTION', monthly_coupon_annual_rate = null, annual_coupon_rate = 0.08
          where id = $1`,
        [elsId],
      )
      const attempt = track(second.client.query(recordSixth, [elsId]))
      expect(await waitsOnLock(owner, second.pid, attempt.state), '둘째가 잠금을 기다리지 않았다').toBe(true)
      await first.client.query('commit')
      const outcome = await attempt.settled
      expect(!outcome.ok && outcome.error.constraint).toBe('monthly_coupon_payments_monthly_required')
    } finally {
      await second.client.query('rollback').catch(() => undefined)
      await first.client.end()
      await second.client.end()
    }
  })

  it('④ 상환(미커밋) ↔ update_els_product — 수정이 기다린 뒤 els_products_redeemed_immutable로 거부된다(기존 check-then-act)', async () => {
    await committedMonthly()
    const first = await sessionAs(USER_A)
    const second = await sessionAs(USER_A)
    try {
      await first.client.query(
        `insert into public.redemptions
           (els_id, redemption_type, round_no, redemption_date, gross_amount, taxable_income, is_confirmed)
         values ($1, 'MATURITY_GAIN', null, '2027-10-18', 100000000, 0, true)`,
        [elsId],
      )
      const attempt = track(
        second.client.query('select public.update_els_product($1, $2::jsonb)', [
          elsId,
          JSON.stringify({
            ...productPayload(assetId, MONTHLY_TERMS),
            couponSchedules: [
              { couponNo: 6, evaluationDate: '2027-04-16', paymentDate: '2027-04-21', couponBarrier: '0.60' },
            ],
          }),
        ]),
      )
      expect(await waitsOnLock(owner, second.pid, attempt.state), '둘째가 잠금을 기다리지 않았다').toBe(true)
      await first.client.query('commit')
      const outcome = await attempt.settled
      expect(!outcome.ok && outcome.error.constraint).toBe('els_products_redeemed_immutable')
    } finally {
      await second.client.query('rollback').catch(() => undefined)
      await first.client.end()
      await second.client.end()
    }
  })
})
