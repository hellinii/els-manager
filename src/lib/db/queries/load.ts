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
  brackets: Array<SelectedRow<'tax_brackets', typeof TAX_BRACKET_COLUMNS>>
  constants: Array<SelectedRow<'tax_constants', typeof TAX_CONSTANT_COLUMNS>>
}

type TaxYearRow = {
  tax_year: number
  tax_brackets: Array<SelectedRow<'tax_brackets', typeof TAX_BRACKET_COLUMNS>>
  tax_constants: Array<SelectedRow<'tax_constants', typeof TAX_CONSTANT_COLUMNS>>
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
    .overrideTypes<TaxYearRow[], { merge: false }>()

  if (error != null) fail('세율 연도', error)

  const seeded = data.filter(
    (row) => row.tax_brackets.length > 0 && row.tax_constants.length > 0,
  )
  if (seeded.length === 0) {
    throw new Error(
      '세율·요율 시드가 없다. 마이그레이션이 적용되지 않았다 (ADR-005).',
    )
  }

  const exact = seeded.find((row) => row.tax_year === year)
  if (exact != null) {
    return {
      taxLawYear: exact.tax_year,
      brackets: exact.tax_brackets,
      constants: exact.tax_constants,
    }
  }

  const earliest = seeded[0]
  if (year < earliest.tax_year) {
    // 근사하지 않는다. 없는 값을 근사하는 것보다 없다고 말하는 것이 맞다.
    throw new Error(
      `${year}년의 세율·요율이 없다. 시드는 ${earliest.tax_year}년부터 있다. ` +
        '뒤 연도의 법으로 과거를 계산하면 재현성이 깨진다(ADR-005).',
    )
  }

  const latest = seeded[seeded.length - 1]
  return {
    taxLawYear: latest.tax_year,
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

/**
 * 자산 이름 부분일치 — §4.9.
 *
 * **입력을 필터 문법으로부터 격리한다.** postgrest-js는 필터 값을 인용하지
 * 않으므로 사용자가 넣은 `,`가 필터를 쪼개고 `%` 한 글자가 전체 목록을 반환한다.
 */
export async function loadAssetsByName(
  ctx: QueryContext,
  query: string,
  limit: number,
): Promise<Array<AssetRow & { asset_provider_symbols: Array<{ id: string }> }>> {
  const { data, error } = await ctx.db
    .from('assets')
    .select(
      [
        selectList(ASSET_COLUMNS),
        embed('asset_provider_symbols', 'id'),
      ].join(','),
    )
    .ilike('name', `%${escapeLikePattern(query)}%`)
    .order('name')
    .limit(limit)
    .overrideTypes<
      Array<AssetRow & { asset_provider_symbols: Array<{ id: string }> }>,
      { merge: false }
    >()

  if (error != null) fail('자산 검색', error)
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
