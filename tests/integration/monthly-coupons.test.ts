import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { mapDbError } from '@/lib/db/mutations/errors'
import { toInsert, toUpdate } from '@/lib/db/mutations/payload'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { CouponPaymentInput, ProductInput } from '@/lib/db/mutations/types'
import { separateTaxationWithholding } from '@/lib/tax'

import { CONSTANTS_2026 } from '../fixtures/tax-2026'
import { FX_NAME_PREFIX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures } from './helpers/seed'
import {
  contractsFor,
  countRequests,
  setupScenario,
  tallyPaths,
  type Contracts,
} from './helpers/scenario'

/**
 * 월지급식 — 계약 ↔ PostgREST (DOC-011 §5.1 · §5.2 · §5.3 · §5.4 · §5.14 · §5.15 · DOC-002 §4.13 · §4.14, P8 컷 b2)
 *
 * `tests/rls/monthly-coupons.test.ts`가 DB 층(제약 · 트리거 · 경합)을 `pg` 직결로 보고, `tests/db/coupons.test.ts`가
 * 계약의 사전 검사를 행 픽스처로 본다. 여기서만 보이는 것 —
 *
 * ① 상품 루트 임베드가 실제 PostgREST에서 월수익 두 테이블을 싣는가(FK 이름 힌트 — `!…_els_id_fkey`)
 * ② 다행 INSERT의 `ids`가 **입력 순서**인가
 * ③ 원천징수 기본값이 지급일 연도의 세율로 채워지는가(세율은 시드에서 — 절대 규칙 #5)
 * ④ RAISE 라벨이 **HTTP 경계를 넘어** 계약의 `ErrorCode` · `fields`가 되는가(`detail` 첫 줄 채널 — DOC-002 §8)
 * ⑤ 계약별 왕복 수(§5.0.1 — 다중집합)
 *
 * 기준일은 `AS_OF`(2026-06-30)다. 상품은 2026-01-02 발행 · 매월 1일 평가 · 지급은 평가일 + 3일 — 1~5번째 달이 기록
 * 가능하다(평가일 ≤ 기준일). 세율 시드는 2026년뿐이므로 원천징수를 비운 지급은 2026년 지급일이어야 한다(RD-16).
 * 고정 건수 시나리오와 섞지 않는다 — 이 파일이 만든 것은 `afterAll`의 `resetFixtures`가 지운다(기록 → 상환 → 상품 순서).
 */

const NAME = {
  monthly: `${FX_NAME_PREFIX} 월지급`,
  plain: `${FX_NAME_PREFIX} 월지급-대조(상환 시 지급)`,
  asset: `${FX_NAME_PREFIX} 월지급자산`,
} as const

/**
 * 만기까지 매월 — 평가주기 6 × 총 차수 2 = **12행**(V-26 행 수 규칙 · DOC-011 v4.37 · P8.5). 2026-02-01 · 03-01 · … ·
 * 2027-01-01이고 만기(2027-01-04) 이하다. 종전 6행 픽스처는 그 규칙 아래에서 생성부터 거부된다
 */
const MONTHS = Array.from({ length: 12 }, (_, index) => {
  const evaluationDate = new Date(Date.UTC(2026, 1 + index, 1)).toISOString().slice(0, 10)
  return { couponNo: index + 1, evaluationDate, paymentDate: `${evaluationDate.slice(0, 8)}04`, couponBarrier: '0.6000' }
})

function monthlyInput(assetId: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: NAME.monthly,
    issuer: '테스트증권',
    issueDate: '2026-01-02',
    principal: '100000000',
    currency: 'KRW',
    evaluationPeriodMonths: 6,
    totalRounds: 2,
    annualCouponRate: '0',
    couponPayout: 'MONTHLY',
    monthlyCouponAnnualRate: '0.0720',
    couponSchedules: MONTHS,
    accountType: 'GENERAL',
    underlyings: [{ assetId, basePrice: '100.000000', sequence: 1 }],
    schedules: [
      { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' },
      { roundNo: 2, evaluationDate: '2027-01-04', barrier: '0.8500' },
    ],
    ...overrides,
  }
}

function paid(couponNo: number, overrides: Partial<CouponPaymentInput> = {}): CouponPaymentInput {
  return {
    couponNo,
    outcome: 'PAID',
    paymentDate: MONTHS[couponNo - 1]!.paymentDate,
    grossAmount: '600000',
    taxableIncome: '600000',
    isConfirmed: true,
    ...overrides,
  }
}

function unpaid(couponNo: number): CouponPaymentInput {
  return { couponNo, outcome: 'UNPAID', isConfirmed: true }
}

function dataOf<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`성공을 기대했으나 실패했다: ${JSON.stringify(result.error)}`)
  return result.data
}

function errorOf<T>(result: ActionResult<T>) {
  if (result.ok) throw new Error(`실패를 기대했으나 성공했다: ${JSON.stringify(result.data)}`)
  return result.error
}

let a: Contracts
let b: Contracts
let assetId: string

beforeAll(async () => {
  await setupScenario()
  ;[a, b] = await Promise.all([contractsFor(ITG_USER_A), contractsFor(ITG_USER_B)])
  assetId = dataOf(
    await a.write.createAsset({ name: NAME.asset, assetType: 'INDEX', market: 'KRX', currency: 'KRW' }),
  ).id
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

async function freshMonthly(overrides: Partial<ProductInput> = {}): Promise<string> {
  return dataOf(await a.write.createProduct(monthlyInput(assetId, overrides))).id
}

/** 이 파일의 상품을 정리한다 — 기록 → 상환 → 상품(RESTRICT 둘) */
async function cleanup(productId: string): Promise<void> {
  const payments = await a.db.from('monthly_coupon_payments').select('id').eq('els_id', productId)
  const ids = (payments.data ?? []).map((row) => row.id)
  if (ids.length > 0) dataOf(await a.write.deleteCouponPayments(productId, { ids }))
  const view = await a.read.getProduct(productId)
  if (view?.redemption != null) dataOf(await a.write.deleteRedemption(view.redemption.id))
  dataOf(await a.write.deleteProduct(productId))
}

describe('§5.1 — 월지급식 상품을 계약으로 만든다 (b2부터 계약은 MONTHLY를 받는다)', () => {
  it('지급방식 · 월수익 연쿠폰율 · 월수익 일정이 한 트랜잭션에 저장되고 상세가 지급방식을 준다', async () => {
    const id = await freshMonthly()
    const view = await a.read.getProduct(id)
    expect(view!.product.couponPayout).toBe('MONTHLY')

    const stored = await a.db
      .from('els_products')
      .select('coupon_payout,monthly_coupon_annual_rate::text,annual_coupon_rate::text')
      .eq('id', id)
      .single()
    expect(stored.data).toEqual({
      coupon_payout: 'MONTHLY',
      monthly_coupon_annual_rate: '0.0720',
      annual_coupon_rate: '0.0000',
    })
    const schedules = await a.db
      .from('monthly_coupon_schedules')
      .select('coupon_no,evaluation_date,payment_date,coupon_barrier::text')
      .eq('els_id', id)
      .order('coupon_no')
    expect(schedules.data).toHaveLength(12)
    expect(schedules.data![4]).toEqual({
      coupon_no: 5,
      evaluation_date: '2026-06-01',
      payment_date: '2026-06-04',
      coupon_barrier: '0.6000',
    })
    await cleanup(id)
  })

  it('지급방식 빈칸은 그 칸의 오류다 — V-25, 기본값 없음', async () => {
    const result = await a.write.createProduct({
      ...monthlyInput(assetId),
      couponPayout: '' as unknown as ProductInput['couponPayout'],
    })
    expect(errorOf(result).fields).toHaveProperty(['couponPayout'])
  })
})

describe('§5.14 recordCouponPayments', () => {
  it('★ 지급 · 미지급을 한 번에 — ids는 입력 순서이고 원천징수는 지급일 연도의 세율로 채운다', async () => {
    const id = await freshMonthly()
    const entries = [paid(3), unpaid(1), paid(2, { withholdingTax: '0' })]
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries }))
    expect(ids).toHaveLength(3)

    const rows = await a.db
      .from('monthly_coupon_payments')
      .select('id,coupon_no,outcome,payment_date,gross_amount::text,withholding_tax::text')
      .in('id', ids)
    const byId = new Map((rows.data ?? []).map((row) => [row.id, row]))
    // ② 입력 순서 — 다행 INSERT의 RETURNING이 값 목록 순서다
    expect(ids.map((value) => byId.get(value)!.coupon_no)).toEqual([3, 1, 2])

    // ③ 원천징수 기본값 — 세율은 시드에서(CONSTANTS_2026은 시드 대조 AQ-05가 마이그레이션과 묶는다)
    const expected = separateTaxationWithholding({ taxableIncome: '600000', constants: CONSTANTS_2026 }).toString()
    expect(byId.get(ids[0]!)!.withholding_tax).toBe(expected)
    // 입력한 원천징수는 그대로다(A-04 — 실제 징수액이 정본)
    expect(byId.get(ids[2]!)!.withholding_tax).toBe('0')
    // 미지급은 금액 · 지급일이 없다(I-26)
    expect(byId.get(ids[1]!)).toMatchObject({ outcome: 'UNPAID', payment_date: null, gross_amount: null })
    await cleanup(id)
  })

  it('행 단위 키 — 같은 달 두 번 · 아직 평가되지 않은 달 · 미래 지급일', async () => {
    const id = await freshMonthly()
    const duplicate = errorOf(await a.write.recordCouponPayments(id, { entries: [unpaid(2), unpaid(2)] }))
    expect(duplicate.code).toBe('VALIDATION_FAILED')
    expect(duplicate.fields).toHaveProperty(['entries[1].couponNo'])

    // 6번째 달은 평가일 2026-07-01 > 기준일 2026-06-30
    const future = errorOf(await a.write.recordCouponPayments(id, { entries: [unpaid(6)] }))
    expect(future.fields!['entries[0].couponNo']).toContain('6번째 · 2026-07-01')

    const late = errorOf(
      await a.write.recordCouponPayments(id, { entries: [paid(5, { paymentDate: '2026-07-01' })] }),
    )
    expect(late.fields).toHaveProperty(['entries[0].paymentDate'])

    // 아무것도 저장되지 않았다 — 전부 아니면 전무
    const left = await a.db.from('monthly_coupon_payments').select('id').eq('els_id', id)
    expect(left.data).toEqual([])
    await cleanup(id)
  })

  it('★ 행 단위 오류는 전부 — 세율 시드가 없는 해의 원천징수 두 행이 두 칸으로 온다 (§5.14 v4.21)', async () => {
    // 기실현 월지급 — 2025년 지급은 시드(2026~) 이전이라 원천징수를 비우면 그 칸의 VALIDATION_FAILED다(RD-16).
    // 종전 구현은 첫 행에서 멈춰 entries[0]만 말했다
    const id = dataOf(
      await a.write.createRealizedProduct({
        name: `${NAME.monthly}-기실현`,
        principal: '100000000',
        currency: 'KRW',
        couponPayout: 'MONTHLY',
        accountType: 'GENERAL',
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2025-12-31',
        grossAmount: '100000000',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: true,
      }),
    ).id
    const entries = ['2025-03-04', '2025-04-04'].map(
      (paymentDate): CouponPaymentInput => ({
        couponNo: null,
        outcome: 'PAID',
        paymentDate,
        grossAmount: '600000',
        taxableIncome: '600000',
        isConfirmed: true,
      }),
    )
    const error = errorOf(await a.write.recordCouponPayments(id, { entries }))
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(error.fields ?? {}).sort()).toEqual(['entries[0].withholdingTax', 'entries[1].withholdingTax'])

    // 실제 징수액을 넣으면 저장된다 — 같은 입력의 짝 통제. ids는 지급일로 짝지어 입력 순서다
    const withTax = entries.map((entry) => ({ ...entry, withholdingTax: '92400' })).reverse()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: withTax }))
    const rows = await a.db.from('monthly_coupon_payments').select('id,payment_date').in('id', ids)
    const dateOf = new Map((rows.data ?? []).map((row) => [row.id, row.payment_date]))
    expect(ids.map((value) => dateOf.get(value))).toEqual(['2025-04-04', '2025-03-04'])
    await cleanup(id)
  })

  it('상환 시 지급 상품에는 기록할 수 없다 — V-27', async () => {
    const plain = dataOf(
      await a.write.createProduct({
        ...monthlyInput(assetId),
        name: NAME.plain,
        annualCouponRate: '0.0800',
        couponPayout: 'AT_REDEMPTION',
        monthlyCouponAnnualRate: undefined,
        couponSchedules: undefined,
      }),
    ).id
    const error = errorOf(await a.write.recordCouponPayments(plain, { entries: [unpaid(1)] }))
    expect(error.fields).toHaveProperty(['entries'])
    await cleanup(plain)
  })

  it('남의 상품에는 기록할 수 없다 — FORBIDDEN', async () => {
    const id = await freshMonthly()
    expect(errorOf(await b.write.recordCouponPayments(id, { entries: [unpaid(1)] })).code).toBe('FORBIDDEN')
    await cleanup(id)
  })
})

describe('§5.15 updateCouponPayment · deleteCouponPayments', () => {
  it('미지급 → 지급 정정이 전체 교체로 된다 — 순번은 그대로, 원천징수 기본값을 다시 채운다', async () => {
    const id = await freshMonthly()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: [unpaid(4)] }))
    const { couponNo: _ignored, ...corrected } = paid(4)
    dataOf(await a.write.updateCouponPayment(ids[0]!, corrected))

    const row = await a.db
      .from('monthly_coupon_payments')
      .select('coupon_no,outcome,payment_date,withholding_tax::text')
      .eq('id', ids[0]!)
      .single()
    expect(row.data).toMatchObject({ coupon_no: 4, outcome: 'PAID', payment_date: '2026-05-04' })
    expect(row.data!.withholding_tax).not.toBeNull()
    await cleanup(id)
  })

  it('지급일 중복 검사에서 그 기록 자신은 뺀다', async () => {
    const id = await freshMonthly()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: [paid(1)] }))
    const { couponNo: _ignored, ...same } = paid(1, { note: '비고만 고친다' })
    dataOf(await a.write.updateCouponPayment(ids[0]!, same))
    await cleanup(id)
  })

  it('없는 기록 · 남의 기록', async () => {
    const id = await freshMonthly()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: [unpaid(1)] }))
    const { couponNo: _ignored, ...input } = unpaid(1)
    expect(errorOf(await a.write.updateCouponPayment('00000000-0000-4000-8000-000000000999', input)).code).toBe(
      'NOT_FOUND',
    )
    expect(errorOf(await b.write.updateCouponPayment(ids[0]!, input)).code).toBe('FORBIDDEN')
    await cleanup(id)
  })

  it('삭제는 그 상품의 기록만 — 다른 상품의 id가 섞이면 지우기 전에 거부한다', async () => {
    const first = await freshMonthly()
    const second = await freshMonthly()
    const one = dataOf(await a.write.recordCouponPayments(first, { entries: [unpaid(1), unpaid(2)] })).ids
    const other = dataOf(await a.write.recordCouponPayments(second, { entries: [unpaid(1)] })).ids

    expect(errorOf(await a.write.deleteCouponPayments(first, { ids: [one[0]!, other[0]!] })).code).toBe(
      'NOT_FOUND',
    )
    // 아무것도 지워지지 않았다
    const kept = await a.db.from('monthly_coupon_payments').select('id').eq('els_id', first)
    expect(kept.data).toHaveLength(2)

    // 「전부 지우기」 — 그 상품의 기록 id 전부
    dataOf(await a.write.deleteCouponPayments(first, { ids: one }))
    const gone = await a.db.from('monthly_coupon_payments').select('id').eq('els_id', first)
    expect(gone.data).toEqual([])
    await cleanup(first)
    await cleanup(second)
  })
})

describe('§5.2 · §5.3 — 기록이 상품을 고정한다 (DOC-002 DQ-14)', () => {
  it('기록된 달을 입력에서 빼면 CONFLICT — 그 달을 「5번째 · 2026-06-01」로 가리킨다', async () => {
    /*
     * 순번은 1..K 연속이고 K = 평가주기 × 총 차수이므로(V-26 — P8.5) 기록된 달이 입력에서 빠지는 실제 경로는 **만기를 줄이고
     * 그 길이로 다시 채운 입력**이다(DOC-008 SCR-204). 그래서 주기 4 · 1차수(K = 4)로 줄인다 — V-26을 지나 사전 검사에 닿는다.
     * 꼬리만 자른 입력(4행 · 12개월)은 이제 V-26이 먼저 「만기까지 이어지지 않는다」로 거부한다
     */
    const id = await freshMonthly()
    dataOf(await a.write.recordCouponPayments(id, { entries: [paid(5)] }))
    const tailOnly = errorOf(
      await a.write.updateProduct(id, monthlyInput(assetId, { couponSchedules: MONTHS.slice(0, 4) })),
    )
    expect([tailOnly.code, tailOnly.fields?.couponSchedules]).toEqual([
      'VALIDATION_FAILED',
      '월수익 일정이 만기까지 이어지지 않는다 — 12개월이어야 한다(평가주기 × 총 차수). 산식으로 채우기를 누른다.',
    ])
    const error = errorOf(
      await a.write.updateProduct(
        id,
        monthlyInput(assetId, {
          evaluationPeriodMonths: 4,
          totalRounds: 1,
          schedules: [{ roundNo: 1, evaluationDate: '2026-05-02', barrier: '0.9000' }],
          couponSchedules: MONTHS.slice(0, 4),
        }),
      ),
    )
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toContain('5번째 · 2026-06-01')

    // 가운데를 빼면 V-26이다 — 상태 충돌이 아니라 입력의 형태다
    const middle = errorOf(
      await a.write.updateProduct(id, monthlyInput(assetId, { couponSchedules: MONTHS.filter((m) => m.couponNo !== 2) })),
    )
    expect(middle.code).toBe('VALIDATION_FAILED')
    await cleanup(id)
  })

  it('기록이 있으면 지급방식 · 통화를 바꿀 수 없다 — CONFLICT', async () => {
    const id = await freshMonthly()
    dataOf(await a.write.recordCouponPayments(id, { entries: [unpaid(1)] }))
    const error = errorOf(
      await a.write.updateProduct(id, {
        ...monthlyInput(assetId),
        currency: 'USD',
        principal: '100000.00',
      }),
    )
    expect(error.code).toBe('CONFLICT')
    await cleanup(id)
  })

  it('★ 기록된 달의 같은 날짜와 배리어 수정은 저장된다 — 일정은 전체 교체가 아니다', async () => {
    const id = await freshMonthly()
    dataOf(await a.write.recordCouponPayments(id, { entries: [paid(1)] }))
    const changed = MONTHS.map((month) => ({ ...month, couponBarrier: '0.5500' }))
    dataOf(await a.write.updateProduct(id, monthlyInput(assetId, { couponSchedules: changed })))
    const rows = await a.db
      .from('monthly_coupon_schedules')
      .select('coupon_barrier::text')
      .eq('els_id', id)
      .eq('coupon_no', 1)
      .single()
    expect(rows.data!.coupon_barrier).toBe('0.5500')
    await cleanup(id)
  })

  it('기록이 있는 상품의 삭제는 CONFLICT — 월수익 기록을 먼저 지운다(3단계의 첫 단계)', async () => {
    const id = await freshMonthly()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: [unpaid(1)] }))
    const error = errorOf(await a.write.deleteProduct(id))
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toContain('월수익 기록을 먼저 지운다')
    dataOf(await a.write.deleteCouponPayments(id, { ids }))
    dataOf(await a.write.deleteProduct(id))
  })
})

describe('§5.4 — 상환 쪽 V-27 · V-29의 DB 겹', () => {
  it('상환일이 기록된 달의 평가일보다 앞서면 redemptionDate 칸 오류다 — 미지급 기록도 본다', async () => {
    const id = await freshMonthly()
    dataOf(await a.write.recordCouponPayments(id, { entries: [unpaid(5)] }))
    const error = errorOf(
      await a.write.createRedemption(id, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-05-15',
        grossAmount: '100000000',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: true,
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields!.redemptionDate).toContain('5번째 · 2026-06-01')
    await cleanup(id)
  })

  it('월지급식 상환에 과세가 실리면 두 칸에 붙는다 — b4부터 계약(V-29)이 먼저 답한다(DB 겹은 tests/rls · 아래 ④)', async () => {
    const id = await freshMonthly()
    const error = errorOf(
      await a.write.createRedemption(id, {
        redemptionType: 'EARLY',
        roundNo: 1,
        redemptionDate: '2026-07-02',
        grossAmount: '100600000',
        taxableIncome: '600000',
        withholdingTax: '92400',
        isConfirmed: true,
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(error.fields ?? {}).sort()).toEqual(['grossAmount', 'taxableIncome'])
    // 계약의 문구다 — DB 사상이었다면 트리거 라벨의 문구였다(b2~b4의 응답). 칸은 같다(§5.4 각주)
    expect(error.fields!.grossAmount).toContain('투자원금 이하')
    await cleanup(id)
  })
})

describe('④ RAISE 라벨이 HTTP 경계를 넘어 계약의 오류가 된다 — 직접 쓰기로 DB 그물을 친다', () => {
  it('기록 쪽 · 상환 쪽 · 동결 — 라벨이 details 첫 줄로 오고 BY_CONSTRAINT가 칸 · 코드를 정한다', async () => {
    const id = await freshMonthly()

    // after_redemption — 상환을 먼저 두고 상환일 뒤 달을 직접 INSERT한다(계약의 V-27을 지나지 않는다)
    dataOf(
      await a.write.createRedemption(id, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-04-01',
        grossAmount: '100000000',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: true,
      }),
    )
    const after = await a.db
      .from('monthly_coupon_payments')
      .insert(toInsert('monthly_coupon_payments', { els_id: id, coupon_no: 4, outcome: 'UNPAID', is_confirmed: true }))
    expect(after.error).not.toBeNull()
    expect(mapDbError(after.error!, '직접 쓰기')).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { couponNo: expect.any(String) },
    })

    // 평가일 = 상환일인 달은 통과한다 — 그 기록을 두고 동결을 친다
    const same = await a.db
      .from('monthly_coupon_payments')
      .insert(toInsert('monthly_coupon_payments', { els_id: id, coupon_no: 3, outcome: 'UNPAID', is_confirmed: true }))
    expect(same.error).toBeNull()

    const frozen = await a.db
      .from('monthly_coupon_schedules')
      .update(toUpdate('monthly_coupon_schedules', { evaluation_date: '2026-04-02' }))
      .eq('els_id', id)
      .eq('coupon_no', 3)
    expect(frozen.error).not.toBeNull()
    expect(mapDbError(frozen.error!, '직접 쓰기').code).toBe('CONFLICT')

    await cleanup(id)
  })
})

describe('⑤ 계약별 왕복 수 (§5.0.1 — 테이블 다중집합)', () => {
  async function measure(run: () => Promise<unknown>): Promise<Record<string, number>> {
    const counter = countRequests()
    try {
      await run()
      return tallyPaths(counter.paths())
    } finally {
      counter.restore()
    }
  }

  it('§5.14 — 사전 조회 1 + INSERT 1, 원천징수를 비운 지급이 있으면 지급일 연도마다 tax_years 1', async () => {
    const id = await freshMonthly()
    const given = await measure(() =>
      a.write.recordCouponPayments(id, { entries: [paid(1, { withholdingTax: '0' }), unpaid(2)] }),
    )
    expect(given).toEqual({ els_products: 1, monthly_coupon_payments: 1 })

    // 같은 해(2026)의 지급 둘 — 세율은 한 번만 읽는다
    const derived = await measure(() => a.write.recordCouponPayments(id, { entries: [paid(3), paid(4)] }))
    expect(derived).toEqual({ els_products: 1, tax_years: 1, monthly_coupon_payments: 1 })
    await cleanup(id)
  })

  it('§5.15 updateCouponPayment — 기록 참조 1 + 상품 1 + 갱신 1 · deleteCouponPayments — 상품 1 + 삭제 1', async () => {
    const id = await freshMonthly()
    const { ids } = dataOf(await a.write.recordCouponPayments(id, { entries: [paid(1, { withholdingTax: '0' })] }))
    const { couponNo: _ignored, ...input } = paid(1, { withholdingTax: '0', note: '왕복' })
    const updated = await measure(() => a.write.updateCouponPayment(ids[0]!, input))
    expect(updated).toEqual({ monthly_coupon_payments: 2, els_products: 1 })

    const deleted = await measure(() => a.write.deleteCouponPayments(id, { ids }))
    expect(deleted).toEqual({ els_products: 1, monthly_coupon_payments: 1 })
    await cleanup(id)
  })
})
