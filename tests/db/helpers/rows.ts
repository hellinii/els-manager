import type { LatestPrice, ProductRow } from '@/lib/db/queries/load'

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
  return {
    id: 'product-1',
    owner_id: OWNER,
    name: '테스트 상품',
    issuer: '테스트증권',
    issue_date: '2026-01-02',
    principal: '100000000',
    evaluation_period_months: 6,
    annual_coupon_rate: '0.0800',
    ki_barrier: '0.5000',
    ki_observation: 'CLOSING',
    ki_touched_at: null,
    account_type: 'GENERAL',
    note: null,
    users: { id: OWNER, display_name: '소유자' },
    els_underlyings: [
      { asset_id: ASSET_1, base_price: '100.000000', sequence: 1, assets: asset(ASSET_1, '자산1') },
    ],
    redemption_schedules: [
      schedule({ round_no: 1, evaluation_date: '2026-07-02' }),
      schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
    ],
    redemptions: null,
    ...overrides,
  }
}

export function asset(id: string, name: string) {
  return { id, name, market: 'NASDAQ', currency: 'USD' }
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
