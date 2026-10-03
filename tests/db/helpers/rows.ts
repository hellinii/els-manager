import type { LatestPrice, ProductRow } from '@/lib/db/queries/load'
import type { ScheduleTaxBasis } from '@/lib/db/queries/map'
import { CONSTANTS_2026 } from '../../fixtures/tax-2026'

/**
 * 행 픽스처 — **DB 없이** 매핑을 검증한다.
 *
 * 값은 전부 문자열이다. PostgREST가 `::text` 캐스팅으로 반환하는 형태를 그대로
 * 흉내내야 하며, 숫자를 쓰면 `DecimalInput`이 거부하지 않는 경로가 생겨
 * 테스트가 프로덕션과 다른 것을 검증하게 된다(Q-08).
 */

export const OWNER = '00000000-0000-4000-8000-0000000000a1'
export const OTHER = '00000000-0000-4000-8000-0000000000b2'
export const ASSET_1 = '00000000-0000-4000-8000-0000000000c1'
export const ASSET_2 = '00000000-0000-4000-8000-0000000000c2'

export function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
  const merged: Omit<ProductRow, 'coupon_schedule_probe'> = {
    id: 'product-1',
    owner_id: OWNER,
    name: '테스트 상품',
    issuer: '테스트증권',
    issue_date: '2026-01-02',
    principal: '100000000',
    currency: 'KRW',
    evaluation_period_months: 6,
    annual_coupon_rate: '0.0800',
    // DB 기본값과 같다(W4 expand — DOC-002 §4.6 ★). 상환 시 지급이면 월수익 연쿠폰율은 없다(I-23)
    coupon_payout: 'AT_REDEMPTION',
    monthly_coupon_annual_rate: null,
    ki_barrier: '0.5000',
    ki_observation: 'CLOSING',
    ki_touched_at: null,
    account_type: 'GENERAL',
    note: null,
    // 기본값이 `FULL`인 것이 DB 기본값과 같다(DOC-002 §4.6) — 픽스처가 스키마와
    // 다른 기본을 쓰면 기존 케이스 전부가 조용히 다른 상품을 시험하게 된다.
    entry_mode: 'FULL',
    users: { id: OWNER, display_name: '소유자' },
    els_underlyings: [
      { asset_id: ASSET_1, base_price: '100.000000', sequence: 1, assets: asset(ASSET_1, '자산1') },
    ],
    redemption_schedules: [
      schedule({ round_no: 1, evaluation_date: '2026-07-02' }),
      schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
    ],
    redemptions: null,
    // 상품 루트 로더만 싣는다(P8 컷 b2 · AQ-77). 상환 시 지급 상품은 둘 다 빈 배열이다
    monthly_coupon_schedules: [],
    monthly_coupon_payments: [],
    ...overrides,
  }
  return {
    ...merged,
    // 존재 탐침은 실제 로더처럼 일정의 첫 행 하나다(`limit 1`). 따로 주면 그것을 쓴다 — 탐침과 일정이 갈리는 행(차수
    // 루트처럼 일정 전체를 싣지 않는 경로)을 흉내낼 때
    coupon_schedule_probe:
      overrides.coupon_schedule_probe ??
      merged.monthly_coupon_schedules.slice(0, 1).map((s) => ({ coupon_no: s.coupon_no })),
  }
}

export function asset(id: string, name: string) {
  return { id, name, market: 'NASDAQ', currency: 'USD' }
}

/**
 * `toScheduleItems`의 세율 근거 — §4.4 v3.3.
 *
 * **요율을 리터럴로 적지 않는다**(절대 규칙 #5의 정신). `CONSTANTS_2026`은
 * `tests/seed/`의 시드 대조(AQ-05)가 마이그레이션과 묶어 주므로, 이 픽스처를
 * 쓰면 테스트가 프로덕션과 같은 값을 탄다.
 *
 * 기본 연도가 `ASOF`(2026)의 연도와 같다 — 근사 표식(`taxLawYear`)이 정상
 * 경로에서 켜지지 않아야 그 축의 케이스가 의미를 갖는다.
 */
export function taxBasis(overrides: Partial<ScheduleTaxBasis> = {}): ScheduleTaxBasis {
  return { constants: CONSTANTS_2026, taxLawYear: 2026, ...overrides }
}

export function schedule(
  overrides: Partial<ProductRow['redemption_schedules'][number]> = {},
): ProductRow['redemption_schedules'][number] {
  return {
    round_no: 1,
    evaluation_date: '2026-07-02',
    barrier: '0.9000',
    lizard_barrier: null,
    lizard_coupon_rate: null,
    lizard_requires_no_ki: null,
    ...overrides,
  }
}

export function redemption(
  overrides: Partial<NonNullable<ProductRow['redemptions']>> = {},
): NonNullable<ProductRow['redemptions']> {
  return {
    id: 'redemption-1',
    redemption_type: 'EARLY',
    round_no: 1,
    redemption_date: '2026-07-02',
    gross_amount: '104000000',
    taxable_income: '4000000',
    withholding_tax: '616000',
    exchange_rate: null,
    is_confirmed: true,
    note: null,
    ...overrides,
  }
}

/** 자산별 최신 시세 맵. `price: null`이면 E-01(시세 없음)이다. */
export function priceMap(
  entries: ReadonlyArray<{
    assetId: string
    name?: string
    price?: string | null
    asOfDate?: string
    source?: 'AUTO' | 'MANUAL'
  }>,
): Map<string, LatestPrice> {
  return new Map(
    entries.map((entry) => [
      entry.assetId,
      {
        assetId: entry.assetId,
        asset: asset(entry.assetId, entry.name ?? '자산'),
        price:
          entry.price == null
            ? null
            : {
                as_of_date: entry.asOfDate ?? '2026-06-30',
                price: entry.price,
                source: entry.source ?? 'MANUAL',
              },
      },
    ]),
  )
}

/**
 * 월지급식 상품 행 (P8 컷 b2) — EM2048 꼴의 날짜. 발행 2026-10-16, k번째 달 평가일 = 발행일 + k개월(16일), 지급일 =
 * 평가일 + 3일. 6번째 달(2027-04-16)이 1차 조기상환 평가일과 같은 날이다. 기록 · 상환은 인자로 준다.
 */
export function monthlyProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10 + index, 16))
    const pay = new Date(Date.UTC(2026, 10 + index, 19))
    return {
      coupon_no: index + 1,
      evaluation_date: date.toISOString().slice(0, 10),
      payment_date: pay.toISOString().slice(0, 10),
      coupon_barrier: '0.6000',
    }
  })
  return productRow({
    issue_date: '2026-10-16',
    annual_coupon_rate: '0.0000',
    coupon_payout: 'MONTHLY',
    monthly_coupon_annual_rate: '0.0720',
    redemption_schedules: [
      schedule({ round_no: 1, evaluation_date: '2027-04-16' }),
      schedule({ round_no: 2, evaluation_date: '2027-10-18' }),
    ],
    monthly_coupon_schedules: months,
    ...overrides,
  })
}

/** 월수익 지급 기록 행 — 기본은 1번째 달의 지급 600,000원 */
export function couponPayment(
  overrides: Partial<ProductRow['monthly_coupon_payments'][number]> = {},
): ProductRow['monthly_coupon_payments'][number] {
  return {
    id: 'payment-1',
    coupon_no: 1,
    outcome: 'PAID',
    payment_date: '2026-11-19',
    gross_amount: '600000',
    taxable_income: '600000',
    withholding_tax: '92400',
    exchange_rate: null,
    is_confirmed: true,
    note: null,
    ...overrides,
  }
}
