import {
  ASSET_COLUMNS,
  ELS_PRODUCT_COLUMNS,
  PRICE_COLUMNS,
  REDEMPTION_COLUMNS,
  SCHEDULE_COLUMNS,
  TAX_BRACKET_COLUMNS,
  TAX_CONSTANT_COLUMNS,
  TAX_PROFILE_COLUMNS,
  TRUNCATION_PROBE_LIMIT,
  UNDERLYING_COLUMNS,
  USER_COLUMNS,
  assertNotTruncated,
  embed,
  selectList,
  type SelectedRow,
} from '../select'
import type { QueryContext } from './context'

/**
 * 로더 — 행을 가져오는 곳. 뷰로 바꾸는 것은 `map.ts`가 한다.
 *
 * ## N+1을 만들지 않는다
 *
 * 상품 계열은 **2 왕복**이다.
 *   ① `els_products` + `users`·`els_underlyings(assets)`·`redemption_schedules`·
 *      `redemptions` 임베드 — `asActive`가 상환을, `integrityIssue`가 하위 행을
 *      요구하므로 넷 다 필요하다
 *   ② 자산별 최신 시세를 **부모별 `limit(1)`**로
 *
 * 평면 조회 후 JS에서 접는 방식을 쓰지 않는다. `max_rows`(1000)에 걸리면
 * **조용히 잘린 목록에서 "최신"을 고르게** 되고, 그때 틀리는 것은 값이 아니라
 * 날짜다 — 시세가 과거로 밀리지만 형식은 정상이라 화면에 드러나지 않는다.
 *
 * 임베드 깊이 2(`els_underlyings.assets.asset_prices`)로 1 왕복에 합치는 것도
 * 실측으로 가능함을 확인했다(smoke ④). 그렇게 하지 않는 이유는 시세 로더가
 * `listProducts`·`listSchedule`·`getDashboard`·`listAssetPrices` 네 계약에서
 * **공유**되기 때문이다 — 합치면 계약마다 임베드 모양이 달라지고 `asOf` 상한을
 * 네 곳에서 각각 지켜야 한다.
 */

// ---------------------------------------------------------------------------
// 행 타입 — 전부 `select.ts`의 열 사양에서 파생된다
// ---------------------------------------------------------------------------

export type UserRow = SelectedRow<'users', typeof USER_COLUMNS>
export type AssetRow = SelectedRow<'assets', typeof ASSET_COLUMNS>
export type PriceRow = SelectedRow<'asset_prices', typeof PRICE_COLUMNS>
export type ScheduleRow = SelectedRow<
  'redemption_schedules',
  typeof SCHEDULE_COLUMNS
>
export type RedemptionRow = SelectedRow<'redemptions', typeof REDEMPTION_COLUMNS>

export type UnderlyingRow = SelectedRow<
  'els_underlyings',
  typeof UNDERLYING_COLUMNS
> & {
  /** 자산이 지워질 수 없으므로(FK RESTRICT) 실무상 항상 있으나 방어적으로 nullable */
  assets: AssetRow | null
}

/**
 * `redemptions`·`users`가 **배열이 아니라 객체**인 것은 실측이다.
 *
 * PostgREST는 `UNIQUE(redemptions.els_id)`를 보고 to-one 관계로 판단해 객체
 * 또는 `null`을 반환한다(배열이 아니다). `users`도 `owner_id` FK라 to-one이다.
 * 배열로 가정하면 `redemptions[0]`이 항상 `undefined`가 되어 **모든 상품이
 * 보유중으로 보인다** — 상환 완료 상품의 판정이 되살아나고 실현손익이 사라진다.
 */
export type ProductRow = SelectedRow<'els_products', typeof ELS_PRODUCT_COLUMNS> & {
  users: UserRow | null
  els_underlyings: UnderlyingRow[]
  redemption_schedules: ScheduleRow[]
  redemptions: RedemptionRow | null
}

const PRODUCT_SELECT = [
  selectList(ELS_PRODUCT_COLUMNS),
  embed('users', selectList(USER_COLUMNS)),
  embed(
    'els_underlyings',
    [selectList(UNDERLYING_COLUMNS), embed('assets', selectList(ASSET_COLUMNS))].join(
      ',',
    ),
  ),
  embed('redemption_schedules', selectList(SCHEDULE_COLUMNS)),
  embed('redemptions', selectList(REDEMPTION_COLUMNS)),
].join(',')

/** PostgREST 오류를 그대로 던진다 — 조회는 결과 객체를 쓰지 않는다(§3.1) */
function fail(what: string, error: { message: string; code?: string }): never {
  throw new Error(
    `${what} 조회 실패: ${error.message}${error.code == null ? '' : ` (${error.code})`}`,
  )
}

// ---------------------------------------------------------------------------
// 상품
// ---------------------------------------------------------------------------

export async function loadProducts(
  ctx: QueryContext,
  filters: { ownerId?: string } = {},
): Promise<ProductRow[]> {
  let query = ctx.db
    .from('els_products')
    .select(PRODUCT_SELECT)
    .limit(TRUNCATION_PROBE_LIMIT)

  // Q-05 — 열 조건은 질의로 내린다. 파생값(status·kiStatus)은 조회 후에 적용한다.
  if (filters.ownerId != null) query = query.eq('owner_id', filters.ownerId)

  const { data, error } = await query.overrideTypes<ProductRow[], { merge: false }>()
  if (error != null) fail('상품 목록', error)

  assertNotTruncated(data, '상품 목록')
  return data
}

export async function loadProduct(
  ctx: QueryContext,
  id: string,
): Promise<ProductRow | null> {
  const { data, error } = await ctx.db
    .from('els_products')
    .select(PRODUCT_SELECT)
    .eq('id', id)
    .maybeSingle()
    .overrideTypes<ProductRow, { merge: false }>()

  if (error != null) fail('상품 상세', error)
  // 미존재는 null이다(§3.1). RLS가 감춘 경우와 구분되지 않지만, 조회 정책이
  // `using (true)`이므로 현재 스키마에서 그 경우는 없다.
  return data
}

/**
 * 상환 id → 부모 상품 id. **§5.5가 요구하는 유일한 새 사전 조회 경로다.**
 *
 * `updateRedemption`·`deleteRedemption`은 상품이 아니라 **상환 `id`를 받는데**
 * (§5.5), 소유자 판정도 V-10(상환일 ≥ 발행일)도 부모 상품을 읽어야 한다. 다른
 * 로더는 전부 상품 id에서 출발하므로 그 사이를 잇는 것이 없다.
 *
 * 여기서 상품까지 임베드해 한 왕복으로 줄이지 않는다 — `PRODUCT_SELECT`를 이
 * 방향으로 한 번 더 적으면 열 사양의 출처가 둘이 되고, `select.ts`가 "캐스팅과
 * 선언이 같은 상수에서 나온다"로 막아 둔 것이 그 사본에서 풀린다. 왕복 하나를
 * 더 쓰고 `loadProduct`를 그대로 재사용한다.
 */
export async function loadRedemptionRef(
  ctx: QueryContext,
  id: string,
): Promise<{ id: string; elsId: string } | null> {
  const { data, error } = await ctx.db
    .from('redemptions')
    .select('id,els_id')
    .eq('id', id)
    .maybeSingle()

  if (error != null) fail('상환', error)
  return data == null ? null : { id: data.id, elsId: data.els_id }
}

// ---------------------------------------------------------------------------
// 평가일정 — 루트가 차수다
// ---------------------------------------------------------------------------

export type ScheduleWithProductRow = ScheduleRow & { els_products: ProductRow }

/**
 * §4.4의 루트를 `redemption_schedules`로 둔다 — **행 단위가 차수**이기 때문이다.
 *
 * ## 왜 상품을 루트로 두고 일정을 임베드하지 않는가
 *
 * 그렇게 하면 `from`·`to`를 임베드 필터로 내려야 하고, 그러면 `judge()`가
 * **잘린 일정 집합에서 `nextEvaluation`을 계산한다.** 적용 차수가 범위 밖일 때
 * 범위 안의 아무 차수가 적용 차수로 승격되어 `conditionResult`가 **엉뚱한 차수에
 * 붙는다** — 값이 비어 있지 않고 그럴싸하므로 화면에서 드러나지 않는다.
 *
 * 루트를 차수로 두면 날짜 조건이 루트 열 조건이 되어 이 화면을 위해 만들어진
 * 인덱스(`redemption_schedules_evaluation_date_idx`)를 그대로 쓰고, 임베드된
 * 부모는 **자기 일정 전체**를 다시 담으므로 판정이 온전하다.
 *
 * 실측한 세 필터 — `evaluation_date` 범위(루트), `els_products.owner_id`(부모 열),
 * `els_products.redemptions=is.null`(중첩 to-one). activeOnly는 3행 → 1행으로
 * 실제로 걸러짐을 확인했다.
 */
export async function loadScheduleRows(
  ctx: QueryContext,
  filters: {
    from?: string
    to?: string
    ownerId?: string
    activeOnly?: boolean
  } = {},
): Promise<ScheduleWithProductRow[]> {
  let query = ctx.db
    .from('redemption_schedules')
    .select(
      [
        selectList(SCHEDULE_COLUMNS),
        embed('els_products', PRODUCT_SELECT, { modifier: '!inner' }),
      ].join(','),
    )
    .order('evaluation_date', { ascending: true })
    .limit(TRUNCATION_PROBE_LIMIT)

  // Q-05 — 네 값 모두 저장된 열의 조건이므로 질의로 내린다(§4.4)
  if (filters.from != null) query = query.gte('evaluation_date', filters.from)
  if (filters.to != null) query = query.lte('evaluation_date', filters.to)
  if (filters.ownerId != null) {
    query = query.eq('els_products.owner_id', filters.ownerId)
  }
  if (filters.activeOnly === true) {
    query = query.is('els_products.redemptions', null)
  }

  const { data, error } = await query.overrideTypes<
    ScheduleWithProductRow[],
    { merge: false }
  >()
  if (error != null) fail('평가일정', error)

  // 행 단위가 차수이므로 상한에 가장 먼저 닿는다
  assertNotTruncated(data, '평가일정')
  return data
}

// ---------------------------------------------------------------------------
// 최신 시세 — D6
// ---------------------------------------------------------------------------

export type LatestPrice = {
  assetId: string
  asset: AssetRow
  price: PriceRow | null
}

type AssetWithPricesRow = AssetRow & { asset_prices: PriceRow[] }

/**
 * 자산별 최신 시세. **`as_of_date <= asOf` 상한을 반드시 건다** — D6.
 *
 * 상한이 없으면 `order desc limit 1`이 `asOf` 이후 날짜의 시세를 고르고, 그
 * 값으로 조건을 판정한다. **미래에서 온 판정이다.** V-17(미래 일자 시세 거부)은
 * 계약 계층에만 있고 DB `CHECK`로 만들 수 없다고 DOC-002 §6이 명시했으므로,
 * 이미 저장된 미래 시세가 실재할 수 있다.
 *
 * 실측 — 상한 없음: `2026-08-10`(999.000000) / 상한 있음: `2026-07-26`(110.000000).
 */
export async function loadLatestPrices(
  ctx: QueryContext,
  assetIds: readonly string[],
): Promise<Map<string, LatestPrice>> {
  if (assetIds.length === 0) return new Map()

  const { data, error } = await ctx.db
    .from('assets')
    .select(
      [selectList(ASSET_COLUMNS), embed('asset_prices', selectList(PRICE_COLUMNS))].join(
        ',',
      ),
    )
    .in('id', [...new Set(assetIds)])
    .lte('asset_prices.as_of_date', ctx.asOf)
    .order('as_of_date', { referencedTable: 'asset_prices', ascending: false })
    .limit(1, { referencedTable: 'asset_prices' })
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<AssetWithPricesRow[], { merge: false }>()

  if (error != null) fail('최신 시세', error)
  assertNotTruncated(data, '최신 시세')

  return new Map(
    data.map((row) => [
      row.id,
      {
        assetId: row.id,
        asset: { id: row.id, name: row.name, market: row.market, currency: row.currency },
        // 부모별 limit(1)이므로 0건 또는 1건이다 — 실측으로 확인했다(smoke ③)
        price: row.asset_prices[0] ?? null,
      },
    ]),
  )
}

/**
 * 전체 자산 + 최신 시세. `listAssetPrices`(§4.5)는 상품이 참조하지 않는 자산도
 * 보여주므로 `assetIds` 필터가 없는 별도 경로가 필요하다.
 */
export async function loadAllAssetsWithLatestPrice(
  ctx: QueryContext,
): Promise<AssetWithPricesRow[]> {
  const { data, error } = await ctx.db
    .from('assets')
    .select(
      [selectList(ASSET_COLUMNS), embed('asset_prices', selectList(PRICE_COLUMNS))].join(
        ',',
      ),
    )
    .lte('asset_prices.as_of_date', ctx.asOf)
    .order('as_of_date', { referencedTable: 'asset_prices', ascending: false })
    .limit(1, { referencedTable: 'asset_prices' })
    .order('name')
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<AssetWithPricesRow[], { merge: false }>()

  if (error != null) fail('시세 목록', error)
  assertNotTruncated(data, '시세 목록')
  return data
}

// ---------------------------------------------------------------------------
// 세금 — 연도 컨텍스트와 프로필
// ---------------------------------------------------------------------------

export type TaxYearContext = {
  /** 실제 적용된 세율·상수의 연도. 요청 연도와 다르면 근사다 (§4.6 `taxLawYear`) */
  taxLawYear: number
  /**
   * 시드된 연도 전체(오름차순) — §4.6 `seededYears` (v1.9, P4 컷 8).
   *
   * 화면의 연도 선택기가 이 값을 쓴다. **하한이 여기밖에 없다** — 시드보다 과거인
   * 연도는 아래에서 예외가 되므로, 화면이 범위를 추측하면 그중 일부가 오류 화면으로
   * 가는 선택지가 된다. `taxLawYear`로는 유도할 수 없다(그 값은 요청 연도 또는
   * 최신 시드 연도이며 어느 경우에도 하한을 말하지 않는다).
   */
  seededYears: number[]
  brackets: Array<SelectedRow<'tax_brackets', typeof TAX_BRACKET_COLUMNS>>
  constants: Array<SelectedRow<'tax_constants', typeof TAX_CONSTANT_COLUMNS>>
}

export type TaxYearRow = {
  tax_year: number
  tax_brackets: Array<SelectedRow<'tax_brackets', typeof TAX_BRACKET_COLUMNS>>
  tax_constants: Array<SelectedRow<'tax_constants', typeof TAX_CONSTANT_COLUMNS>>
}

/**
 * 시드 범위보다 과거인 연도 — **`INTERNAL`과 갈라야 하는 예외** (§5.4 v1.7, P4 컷 6)
 *
 * `loadTaxYearContext`는 두 가지를 던진다: 그 연도가 시드보다 과거이거나, 시드가
 * **아예 없다**(마이그레이션 미적용). 둘의 화면 처리는 정반대다.
 *
 * | 무엇 | 코드 | 사용자가 할 일 |
 * |---|---|---|
 * | 이 오류 | `VALIDATION_FAILED` + `fields.withholdingTax` | 실제 징수액을 적는다(A-04상 그것이 정본이다) |
 * | 그 밖 | `INTERNAL` | 없다 — 시스템 결함이다 |
 *
 * 가르지 않으면 마이그레이션 미적용이 「징수액을 입력하라」로 보고되고 사용자는 몇
 * 번을 입력해도 같은 오류를 본다. `guardSystemAsync`가 **어떤 예외든** `INTERNAL`로
 * 접는 것이 옳은 이유와 같은 논거의 반대편이다(`guard.ts`의 머리글).
 *
 * **조회 계약은 이 타입을 보지 않는다** — 그쪽은 그대로 던진다(ADR-005). 타입을 두는
 * 이유는 문구 정규식으로 분류하지 않기 위함이며, `UnauthenticatedError`가 같은 자리에
 * 있다(그쪽 각주: 경계에서 `instanceof`를 시도하지 않는다는 경고까지 같다).
 */
export class TaxSeedRangeError extends Error {
  override readonly name = 'TaxSeedRangeError'

  constructor(
    readonly year: number,
    readonly earliestSeeded: number,
  ) {
    super(
      `${year}년의 세율·요율이 없다. 시드는 ${earliestSeeded}년부터 있다. ` +
        '뒤 연도의 법으로 과거를 계산하면 재현성이 깨진다(ADR-005).',
    )
  }
}

/**
 * 연도별 세율·상수를 **한 왕복**으로 읽는다 — D7.
 *
 * 셋을 따로 읽으면 `tax_constants`만 빠진 연도에서 구간은 있는데 상수가 없어
 * `calculateHealthInsurance`가 죽는다. FK가 `tax_years`를 향하므로 한 질의로 묶인다.
 *
 * ## 과거와 미래를 다르게 다룬다
 *
 * | 대상 연도 | 동작 |
 * |---|---|
 * | 시드 있음 | 그 연도 |
 * | 시드보다 미래 | **최신 시드 연도로 근사**하고 `taxLawYear`로 드러낸다 |
 * | 시드보다 과거 | **거부(예외)** — 뒤 연도의 법으로 과거를 계산하면 ADR-005의 재현성이 깨진다 |
 *
 * 이 규칙이 없으면 **2027-01-01에 홈 화면이 코드 변경 없이 죽는다** —
 * `getDashboard.currentYearTax`도 당해 연도 구간을 요구한다.
 */
export async function loadTaxYearContext(
  ctx: QueryContext,
  year: number,
): Promise<TaxYearContext> {
  return resolveTaxYear(await loadAllTaxYears(ctx), year)
}

/**
 * `tax_years` 전체 — **I/O만 한다** (AQ-22 부분 처리, P4 컷 8).
 *
 * ## Q-06 방어를 여기서 부여한다
 *
 * AQ-22가 「규약은 조회 전체를 말하는데 구현은 로더 5개에만 있다」고 적었고
 * `loadTaxYearContext`가 그 목록에 없던 하나였다. 루트가 `tax_years`이므로 현재
 * 규모에서 상한에 닿을 수 없지만, **닿았다면 AQ-09를 닫으라는 신호**라는 Q-06의
 * 목적이 이 경로에서는 작동하지 않았다 — 세 계약(§4.1·§4.6·§4.8)이 이 로더를 탄다.
 *
 * 연도 하나에 대해 `tax_brackets`·`tax_constants`가 각각 여러 행이므로 **행 수는
 * 연도 수의 몇 배**다. 임베드 안쪽은 이 상한이 세지 않는다는 것도 함께 적어 둔다 —
 * 루트 행(연도)만 센다.
 *
 * ## 판정을 함께 하지 않는다
 *
 * 근사·거부의 규칙(아래 `resolveTaxYear`)은 **시드 상태에 대한 판정**이고 순수하다.
 * 붙여 두면 그 규칙을 실행하는 유일한 방법이 DB를 세우는 것이 되고, **시드가 아예
 * 없는 분기는 통합 스위트로 관측할 수 없다**(그 상태를 만들면 다른 216건이 함께
 * 죽는다 — 컷 6이 `TaxSeedRangeError`의 분류를 순수 함수로 뗀 것과 같은 이유다).
 * 떼어 두면 상시 스위트가 세 분기를 전부 본다.
 *
 * P4b가 `getForecast`를 만들 때 **같은 함수를 여러 연도에 재사용한다** — 6개 연도의
 * 컨텍스트를 얻기 위해 왕복을 6번 하지 않는다.
 */
export async function loadAllTaxYears(ctx: QueryContext): Promise<TaxYearRow[]> {
  const select = [
    'tax_year',
    embed('tax_brackets', selectList(TAX_BRACKET_COLUMNS), {
      modifier: '!inner',
    }),
    embed('tax_constants', selectList(TAX_CONSTANT_COLUMNS), {
      modifier: '!inner',
    }),
  ].join(',')

  const { data, error } = await ctx.db
    .from('tax_years')
    .select(select)
    .order('tax_year', { ascending: true })
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<TaxYearRow[], { merge: false }>()

  if (error != null) fail('세율 연도', error)

  assertNotTruncated(data, '세율 연도')
  return data
}

/**
 * 요청 연도 → 적용할 세율 연도. **순수하다** — 위 표의 세 분기가 전부 여기 있다.
 *
 * 시드로 인정하는 조건은 「구간과 상수가 **둘 다** 있다」다. 한쪽만 있는 연도를
 * 통과시키면 `calculateHealthInsurance`가 상수 부재로 죽는데, 그 실패는 세율 조회가
 * 아니라 계산에서 나타나 원인이 가려진다.
 */
export function resolveTaxYear(rows: readonly TaxYearRow[], year: number): TaxYearContext {
  const seeded = rows
    .filter((row) => row.tax_brackets.length > 0 && row.tax_constants.length > 0)
    // 순서를 여기서 보장한다 — 질의의 `order`에 기대면 이 함수가 그 성질을 잃는다.
    .sort((a, b) => a.tax_year - b.tax_year)

  if (seeded.length === 0) {
    // **`TaxSeedRangeError`가 아니다.** 사용자가 고칠 수 없는 시스템 결함이므로
    // §3.2.2의 기본값(`INTERNAL`)으로 가야 한다 — 컷 6이 두 예외를 타입으로 가른
    // 이유가 이것이고, 합치면 마이그레이션 미적용이 「징수액을 입력하라」가 된다.
    throw new Error(
      '세율·요율 시드가 없다. 마이그레이션이 적용되지 않았다 (ADR-005).',
    )
  }

  const seededYears = seeded.map((row) => row.tax_year)
  const exact = seeded.find((row) => row.tax_year === year)
  if (exact != null) {
    return {
      taxLawYear: exact.tax_year,
      seededYears,
      brackets: exact.tax_brackets,
      constants: exact.tax_constants,
    }
  }

  const earliest = seeded[0]!
  if (year < earliest.tax_year) {
    // 근사하지 않는다. 없는 값을 근사하는 것보다 없다고 말하는 것이 맞다.
    // 전용 타입인 이유는 §5.4가 이 하나만 `VALIDATION_FAILED`로 옮기기 때문이다.
    throw new TaxSeedRangeError(year, earliest.tax_year)
  }

  const latest = seeded[seeded.length - 1]!
  return {
    taxLawYear: latest.tax_year,
    seededYears,
    brackets: latest.tax_brackets,
    constants: latest.tax_constants,
  }
}

export type TaxProfileRow = SelectedRow<'tax_profiles', typeof TAX_PROFILE_COLUMNS>

/**
 * 과세 프로필. **본인 것만 읽힌다** — `tax_profiles`의 조회 정책이 본인 한정이다.
 *
 * 그래서 타인 `userId`로 부르면 오류가 아니라 **0행**이 온다. "없음"과 "볼 수
 * 없음"이 구분되지 않는다는 이 성질이 §4.6을 본인 전용으로, §4.8의 타인 행을
 * 축소 + 표식으로 만든 이유다(D3).
 */
export async function loadTaxProfile(
  ctx: QueryContext,
  userId: string,
  year: number,
): Promise<TaxProfileRow | null> {
  const { data, error } = await ctx.db
    .from('tax_profiles')
    .select(selectList(TAX_PROFILE_COLUMNS))
    .eq('user_id', userId)
    .eq('tax_year', year)
    .maybeSingle()
    .overrideTypes<TaxProfileRow, { merge: false }>()

  if (error != null) fail('과세 프로필', error)
  return data
}

/**
 * `throughYear` 이하의 과세 프로필 전체 — §4.7의 이월(LOCF)이 이것을 받는다.
 *
 * ## `.in('tax_year', years)`가 아니라 `.lte()`다
 *
 * 이월을 열거로 구현할 수 없다. `profileFor(profiles, Y)`가 「`Y` 이하의 가장 최근」을
 * 고르므로 **전망 구간 밖의 과거 연도**가 후보에 들어가야 한다 — 2024년 프로필 하나만
 * 저장한 사용자의 2026~2031년 행은 전부 그 값으로 계산된다. `.in()`으로 여섯 연도만
 * 받으면 그 사용자의 여섯 행이 **전부 미입력 폴백**이 되어 「그럴싸한 숫자」가 된다
 * (§4.7이 §4.6의 폴백을 그대로 쓰지 않는 이유와 같은 결함이다).
 *
 * ## 그래서 Q-06 가드가 **여기서는 의미가 있다**
 *
 * 단수 `loadTaxProfile`은 `(user_id, tax_year)` 유일성 때문에 최대 1행이고
 * `.in()`이었다면 `years.length ≤ FORECAST_MAX_YEARS`로 구조적으로 묶였다. `.lte()`는
 * **사용자가 저장한 연도 수만큼** 늘어나므로 상한에 닿는 경로가 실재한다 — 닿으면
 * 그것이 AQ-09를 닫으라는 신호다.
 *
 * 단수 쪽을 **남긴다.** `maybeSingle()`이 그 유일성에 대한 DB 측 보장이고(§4.6은 한
 * 연도만 필요하다) 여기서 파생시키면 그 보장이 애플리케이션의 `find`로 격하된다.
 */
export async function loadTaxProfiles(
  ctx: QueryContext,
  userId: string,
  throughYear: number,
): Promise<TaxProfileRow[]> {
  const { data, error } = await ctx.db
    .from('tax_profiles')
    .select(selectList(TAX_PROFILE_COLUMNS))
    .eq('user_id', userId)
    .lte('tax_year', throughYear)
    .order('tax_year', { ascending: true })
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<TaxProfileRow[], { merge: false }>()

  if (error != null) fail('과세 프로필', error)

  assertNotTruncated(data, '과세 프로필')
  return data
}

/**
 * 이월(LOCF) — `argmax { p.tax_year | p.tax_year ≤ year }`. **순수하다.**
 *
 * `resolveTaxYear`와 같은 이유로 I/O에서 뗀다 — 세 상태(그 해의 저장값 / 이월 /
 * 미입력)를 상시 스위트가 DB 없이 전부 본다.
 *
 * `null`이면 미입력이며 §4.6의 폴백(`0`·`0`·`NONE`)을 호출부가 적용한다. 그 폴백을
 * **여기서** 적용하지 않는 이유는 `profileYear`다 — 행을 돌려주면 호출부가 연도를 읽어
 * 「2026년 프로필 적용」이라 말할 수 있고, 폴백된 값을 돌려주면 「이월」과 「미입력」이
 * 구분되지 않아 §4.6의 `isSaved`가 저지른 실수를 반복한다(§4.7).
 *
 * 질의의 `order`에 기대지 않는다 — 기대면 이 함수가 그 성질을 잃고, 다른 호출부가
 * 정렬 없이 넘기는 날 조용히 틀린 연도를 고른다.
 */
export function profileFor(
  profiles: readonly TaxProfileRow[],
  year: number,
): TaxProfileRow | null {
  let chosen: TaxProfileRow | null = null
  for (const profile of profiles) {
    if (profile.tax_year > year) continue
    if (chosen == null || profile.tax_year > chosen.tax_year) chosen = profile
  }
  return chosen
}

export async function loadUsers(ctx: QueryContext): Promise<UserRow[]> {
  const { data, error } = await ctx.db
    .from('users')
    .select(selectList(USER_COLUMNS))
    .order('display_name')
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<UserRow[], { merge: false }>()

  if (error != null) fail('사용자 목록', error)
  assertNotTruncated(data, '사용자 목록')
  return data
}

/** §4.9의 두 경로가 함께 읽는 열 — 공급자 심볼은 존재 여부만 쓴다(`hasPriceProvider`) */
type AssetOptionRow = AssetRow & { asset_provider_symbols: Array<{ id: string }> }

const ASSET_OPTION_SELECT = [
  selectList(ASSET_COLUMNS),
  embed('asset_provider_symbols', 'id'),
].join(',')

/**
 * 자산 이름 부분일치 — §4.9의 **비-빈 질의** 경로.
 *
 * **입력을 필터 문법으로부터 격리한다.** postgrest-js는 필터 값을 인용하지
 * 않으므로 사용자가 넣은 `,`가 필터를 쪼개고 `%` 한 글자가 전체 목록을 반환한다.
 *
 * 상한은 **의도된 자름**이므로 절단 감지를 걸지 않는다 — 넘치면 사용자가 더 좁게
 * 적으면 된다. 감지가 필요한 것은 아래 전량 경로다(§4.9 v1.5의 표).
 */
export async function loadAssetsByName(
  ctx: QueryContext,
  query: string,
  limit: number,
): Promise<AssetOptionRow[]> {
  const { data, error } = await ctx.db
    .from('assets')
    .select(ASSET_OPTION_SELECT)
    .ilike('name', `%${escapeLikePattern(query)}%`)
    .order('name')
    .limit(limit)
    .overrideTypes<AssetOptionRow[], { merge: false }>()

  if (error != null) fail('자산 검색', error)
  return data
}

/**
 * 자산 전량 — §4.9의 **빈 질의** 경로 (P4 컷 4a).
 *
 * 위 함수에 `limit`만 바꿔 넘기지 않고 따로 두는 이유는 **자름의 성질이 반대**라는
 * 것이다. 검색의 상한 20은 의도된 자름이고 여기의 상한은 **감지용**이다 —
 * 자동완성이 전량을 한 번 받으므로 조용히 잘리면 21번째 자산이 어떤 방법으로도
 * 선택되지 않는다(AQ-22가 지적한 "호출부에 절단 신호가 없다"의 실현 형태).
 * 한 함수에 두 뜻을 담으면 그 구분이 호출부의 인자값에만 남는다.
 *
 * `listAssetPrices`로 대신하지 않는다 — 그쪽은 `usedByActiveProducts` 때문에 상품
 * 계열을 한 번 더 읽고(왕복 2), 등록 화면이 쓰지 않는 값을 위해 그 화면의 무효화
 * 축이 상품 변경 전체로 넓어진다(`listAssetPrices`가 `PRODUCT_WIDE`에 있다).
 */
export async function loadAllAssetOptions(ctx: QueryContext): Promise<AssetOptionRow[]> {
  const { data, error } = await ctx.db
    .from('assets')
    .select(ASSET_OPTION_SELECT)
    .order('name')
    .limit(TRUNCATION_PROBE_LIMIT)
    .overrideTypes<AssetOptionRow[], { merge: false }>()

  if (error != null) fail('자산 목록', error)
  assertNotTruncated(data, '자산 목록')
  return data
}

/**
 * `ilike` 패턴과 PostgREST 필터 문법에서 모두 안전하게 만든다.
 *
 * - `\`를 먼저 이스케이프한다(나중에 하면 자기가 넣은 백슬래시를 다시 이스케이프한다)
 * - `%`·`_`는 LIKE 와일드카드다
 * - `,`·`.`·`(`·`)`·`"`는 PostgREST가 필터를 쪼개는 구분자다 → 값을 인용부호로 감싼다
 * - `*`는 PostgREST가 `%`로 번역하는 문자다
 */
export function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/[,().:"]/g, (ch) => `\\${ch}`)
}
