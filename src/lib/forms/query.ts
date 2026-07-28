import type { ListProductsParams } from '@/lib/db/queries/products'
import type { ListScheduleParams } from '@/lib/db/queries/schedule'
import type { KiStatus } from '@/lib/domain'

/**
 * URL 질의 문자열 → 계약 입력 — **순수**하다. `next`도 `react`도 모른다
 *
 * ## 왜 `lib/forms/`인가
 *
 * SCR-201·301의 필터·정렬은 **`<form method="GET">`**이다(계획 §6). 그러면
 * `searchParams`가 곧 그 폼의 제출값이므로, `FormData` → 계약 입력을 다루는
 * 이 디렉터리가 같은 일의 같은 자리다. 화면 안에 두면 `page.tsx`는 `server.ts`를
 * 끌어오므로 어떤 스위트의 import 그래프에도 들어가지 못한다(AQ-23) — 파싱이
 * 거기 있으면 그만큼이 영구 미검증으로 남는다.
 *
 * ## 왜 서버 폼인가 (클라이언트 상태가 아니다)
 *
 * JS 없이 동작하고 URL이 공유 가능하다. 후자가 설계상 필요하다 — DOC-008 §7.4가
 * 「SCR-501 → SCR-201 (소유자 필터 적용)」을 그렸고, SQ-01이 SCR-501을 만들지 않기로
 * 한 근거가 「소유자 필터가 사용자 현황 화면을 대체한다」이므로 **소유자 선택은
 * 주소로 표현될 수 있어야** 그 대체가 성립한다.
 *
 * ## 인식하지 못한 값은 버린다 — 오류로 만들지 않는다
 *
 * 조작된 주소(`?status=BOGUS`)에 오류 화면을 띄우면 링크 하나가 앱을 막는다.
 * 값을 버리면 그 축이 「전체」가 되고 화면의 `<select>`도 그 상태로 렌더된다 —
 * **화면과 계약이 같은 값을 본다**는 성질이 유지된다. 파싱 결과만으로 폼을
 * 되살리는 이유가 이것이다(제출된 원문을 따로 보존하지 않는다).
 */

/** `searchParams`의 형태. Next에 의존하지 않기 위해 여기서 정의한다. */
export type QueryValues = Record<string, string | string[] | undefined>

export type SortKey = NonNullable<ListProductsParams['sortBy']>

export type ProductFilter = {
  ownerId: string | null
  status: 'ACTIVE' | 'REDEEMED' | null
  kiStatus: KiStatus | null
  /** 정렬은 「없음」이 아니라 기본값을 갖는다 — 근거는 `SORT_DEFAULT`. */
  sortBy: SortKey
}

/** 필터의 질의 문자열 키. 화면의 `<select name>`이 이 값을 쓴다. */
export const FILTER_KEYS = {
  ownerId: 'ownerId',
  status: 'status',
  kiStatus: 'kiStatus',
  sortBy: 'sortBy',
} as const

/**
 * 기본 정렬 — **임박 순이다.**
 *
 * 이 화면의 목적이 「보유·상환 상품 전체 조회」이고 사용자가 가장 먼저 알고 싶은
 * 것은 다음에 무엇이 평가되는가다(SCR-101의 임박 평가일과 같은 관심). 정렬을
 * 정하지 않으면 DB가 준 순서가 되고, 그 순서는 아무 의미도 없는데 안정적이라
 * 의미가 있는 것처럼 보인다.
 */
export const SORT_DEFAULT: SortKey = 'EVALUATION_DATE'

const STATUS_VALUES = ['ACTIVE', 'REDEEMED'] as const

/**
 * **`KI_STATUS_VALUES`를 여기서 적지 않는다.** 파라미터가 `KiStatus`이므로
 * (AQ-24) 목록의 정본은 표시 라벨 표뿐이고, 화면이 `Object.keys(KI_STATUS_LABELS)`로
 * 선택지를 만든다 — 그쪽은 `Record<KiStatus, string>`이라 도메인 열거값이 늘면
 * 컴파일이 깨진다. 여기서 다시 적으면 그 강제 밖에 있는 세 번째 목록이 생긴다.
 *
 * 그래서 이 파서는 **화면이 제시한 값 집합을 인자로 받는다.** 「인식 가능한 값」의
 * 정본이 하나여야 한다는 규칙의 적용이며, `toFormState`가 `knownNames`를 받는 것과
 * 같은 형태다.
 */
export function parseProductFilter(
  values: QueryValues,
  kiStatusValues: readonly KiStatus[],
): ProductFilter {
  return {
    // UUID 형식만 확인한다. 실재 여부는 조회 결과가 말한다 — 없는 소유자로
    // 필터하면 0건이고 그것이 「조건에 맞는 상품 없음」의 정상 경로다.
    ownerId: uuidOr(one(values[FILTER_KEYS.ownerId])),
    status: oneOf(one(values[FILTER_KEYS.status]), STATUS_VALUES),
    kiStatus: oneOf(one(values[FILTER_KEYS.kiStatus]), kiStatusValues),
    sortBy: oneOf(one(values[FILTER_KEYS.sortBy]), SORT_KEYS) ?? SORT_DEFAULT,
  }
}

const SORT_KEYS = ['EVALUATION_DATE', 'PRINCIPAL', 'D_DAY'] as const

/**
 * 계약에 넘길 형태로. **선택 필드는 키를 아예 넣지 않는다** —
 * `exactOptionalPropertyTypes`에서 `undefined`를 넘기는 것과 키가 없는 것이
 * 다르고, 계약의 `params.x != null` 분기는 후자를 전제한다.
 */
export function toListParams(filter: ProductFilter): ListProductsParams {
  const params: ListProductsParams = { sortBy: filter.sortBy }
  if (filter.ownerId != null) params.ownerId = filter.ownerId
  if (filter.status != null) params.status = filter.status
  if (filter.kiStatus != null) params.kiStatus = filter.kiStatus
  return params
}

/**
 * **좁히는 필터가 걸려 있는가** — 빈 상태 두 갈래를 가르는 값이다.
 *
 * DOC-008 §6이 SCR-201의 빈 상태를 「조건에 맞는 상품 없음 / 전체 없음(**구분**)」
 * 으로 요구하고 ST-02는 각각 다음 행동을 요구하므로, 두 상태의 다음 행동이 달라야
 * 한다(필터 해제 / 상품 등록). 화면이 `items.length === 0`만 보면 그 구분을 만들 수
 * 없다.
 *
 * **정렬은 좁히지 않는다.** 순서만 바꾸므로 0건의 원인이 될 수 없다. 여기에
 * `sortBy`를 넣으면 기본 정렬이 항상 「필터 있음」이 되어 전체 없음 상태가 영원히
 * 나타나지 않는다.
 */
export function isNarrowed(filter: ProductFilter): boolean {
  return filter.ownerId != null || filter.status != null || filter.kiStatus != null
}

/**
 * 현재 필터를 질의 문자열로 되돌린다 — 링크(소유자 칩·초기화)가 쓴다.
 *
 * `override`의 값이 `null`이면 그 축을 **지운다.** 「이 소유자만」과 「소유자 해제」가
 * 같은 함수로 표현되어야 링크가 축마다 다른 규칙을 갖지 않는다.
 */
export function filterQuery(
  filter: ProductFilter,
  override: Partial<Record<keyof ProductFilter, string | null>> = {},
): string {
  const merged: Record<string, string | null> = {
    [FILTER_KEYS.ownerId]: filter.ownerId,
    [FILTER_KEYS.status]: filter.status,
    [FILTER_KEYS.kiStatus]: filter.kiStatus,
    // 기본값은 주소에 싣지 않는다 — 아무것도 고르지 않은 상태의 URL이 깨끗해야
    // 「필터가 걸려 있다」는 인상을 주지 않는다.
    [FILTER_KEYS.sortBy]: filter.sortBy === SORT_DEFAULT ? null : filter.sortBy,
    ...Object.fromEntries(
      Object.entries(override).map(([key, value]) => [FILTER_KEYS[key as keyof ProductFilter], value ?? null]),
    ),
  }

  const pairs = Object.entries(merged).filter(
    (entry): entry is [string, string] => entry[1] != null && entry[1] !== '',
  )
  if (pairs.length === 0) return ''

  return `?${pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`
}

// ---------------------------------------------------------------------------
// SCR-101 홈 — 컷 9
// ---------------------------------------------------------------------------

/**
 * 표시 범위 — **기본은 본인이다** (DOC-008 §9 SQ-03)
 *
 * 계약 파라미터가 그대로 축이므로(§4.1 `params.scope`) 파서가 좁힐 것이 하나다.
 * 다른 화면의 필터와 달리 **`null`이 없다** — 계약이 두 값 중 하나를 요구하고
 * 「선택 안 함」에 해당하는 뜻이 없다(SCR-301의 `range`가 같은 형태다).
 *
 * 인식하지 못한 값은 기본값으로 떨어진다. 즉 `?scope=BOGUS`는 본인 보기이며
 * 그것이 이 화면의 「좁혀지지 않은」 상태가 아니다 — **본인 보기가 좁힌 상태다.**
 * 그 사실이 빈 상태의 문구를 가른다(DOC-008 §6 각주).
 */
export type DashboardScope = 'MINE' | 'ALL'

export const DASHBOARD_KEYS = { scope: 'scope' } as const

export const DASHBOARD_SCOPE_DEFAULT: DashboardScope = 'MINE'

const DASHBOARD_SCOPES = ['MINE', 'ALL'] as const

export function parseDashboardScope(values: QueryValues): DashboardScope {
  return (
    oneOf(one(values[DASHBOARD_KEYS.scope]), DASHBOARD_SCOPES) ??
    DASHBOARD_SCOPE_DEFAULT
  )
}

/**
 * 그 범위의 주소 — 전환 링크가 쓴다.
 *
 * **기본값은 주소에 싣지 않는다**(`filterQuery`와 같은 규약). 그래서 홈의 기본
 * 주소가 `/`이고, 「내 상품」을 다시 누르는 링크가 `/?scope=MINE`이 아니라 `/`다 —
 * 두 주소가 같은 화면을 렌더하면 공유된 링크가 어느 쪽인지에 따라 달라 보인다.
 */
export function dashboardQuery(scope: DashboardScope): string {
  return scope === DASHBOARD_SCOPE_DEFAULT
    ? ''
    : `?${DASHBOARD_KEYS.scope}=${encodeURIComponent(scope)}`
}

// ---------------------------------------------------------------------------
// SCR-301 평가일정 — 컷 7
// ---------------------------------------------------------------------------

/**
 * 기간 — **「전체」가 기본이다.**
 *
 * DOC-008 §5가 「과거/미래 구분」을 주요 요소로 규정하므로 기본 화면에 **둘 다**
 * 있어야 한다. 「다가오는」을 기본으로 두면 보이는 것이 한 종류이므로 구분할 것이
 * 없어지고, 그 요소는 눌러야 나타나는 기능이 된다.
 *
 * 계약 파라미터로는 `from`·`to`가 된다(Q-05 — §4.4가 「범위 조건을 조회 후로 미루면
 * Q-06의 상한에 가장 먼저 닿는다」고 적었다. 행 단위가 차수다).
 */
export type ScheduleRange = 'ALL' | 'PAST' | 'UPCOMING'

export type ScheduleFilter = {
  ownerId: string | null
  range: ScheduleRange
  /** DOC-008 §5의 「미상환만 보기」. `false`가 「전체」다 */
  activeOnly: boolean
}

/**
 * 질의 문자열 키. **`ownerId`는 SCR-201과 같은 이름이다** — 두 화면의 소유자 필터가
 * 같은 뜻이므로 주소에서도 같아야 한다(한쪽 링크를 다른 화면에 붙여도 축이 산다).
 */
export const SCHEDULE_KEYS = {
  ownerId: FILTER_KEYS.ownerId,
  range: 'range',
  activeOnly: 'activeOnly',
} as const

export const SCHEDULE_RANGE_DEFAULT: ScheduleRange = 'ALL'

const SCHEDULE_RANGES = ['ALL', 'PAST', 'UPCOMING'] as const

export function parseScheduleFilter(values: QueryValues): ScheduleFilter {
  return {
    ownerId: uuidOr(one(values[SCHEDULE_KEYS.ownerId])),
    range:
      oneOf(one(values[SCHEDULE_KEYS.range]), SCHEDULE_RANGES) ??
      SCHEDULE_RANGE_DEFAULT,
    // 체크박스는 체크될 때만 전송된다 — 부재가 곧 `false`다(`parse.ts`의 `checkbox`와
    // 같은 규약). 값은 보지 않는다: 주소를 손으로 적은 `activeOnly=0`도 「켬」이며,
    // 폼이 만들 수 없는 형태에 특별한 뜻을 주지 않는다.
    activeOnly: one(values[SCHEDULE_KEYS.activeOnly]) !== '',
  }
}

/**
 * 계약에 넘길 형태로. **기준일을 인자로 받는다** — 이 모듈은 오늘을 계산하지 않는다
 * (`lib/format/date.ts`와 같은 규약이며 린트가 막는다).
 *
 * ## `PAST`의 `to`가 기준일 그 자체인 이유
 *
 * 계약의 `to`는 포함(`lte`)이고 「경과」는 `dDay < 0`이므로(당일은 경과가 아니다)
 * `to = asOf`는 **당일 차수까지 실어 온다.** 그 한 줄을 여기서 빼려면 「기준일의
 * 하루 전」을 계산해야 하고, 그러면 경계 판정이 계약과 화면 두 곳에 생긴다.
 * 대신 목록을 `splitByPast`로 거르므로 **계약이 준 `isPast`가 경계를 정한다** —
 * 질의는 범위를 좁혀 행 수를 줄이는 일만 하고(Q-05의 목적) 판정은 하지 않는다.
 */
export function toScheduleParams(
  filter: ScheduleFilter,
  asOf: string,
): ListScheduleParams {
  const params: ListScheduleParams = {}

  if (filter.range === 'UPCOMING') params.from = asOf
  if (filter.range === 'PAST') params.to = asOf
  if (filter.ownerId != null) params.ownerId = filter.ownerId
  if (filter.activeOnly) params.activeOnly = true

  return params
}

/**
 * **좁히는 필터가 걸려 있는가** — 빈 상태 셋 중 앞의 둘을 가른다.
 *
 * SCR-201의 `isNarrowed`와 같은 자리이며 **기간도 좁힌다**(정렬과 다르다 — 순서를
 * 바꾸는 것이 아니라 행을 뺀다). 기본값 `ALL`이 아무것도 빼지 않으므로 기본 화면은
 * 「좁히지 않음」이고 조회가 한 번이다.
 */
export function isScheduleNarrowed(filter: ScheduleFilter): boolean {
  return (
    filter.ownerId != null ||
    filter.activeOnly ||
    filter.range !== SCHEDULE_RANGE_DEFAULT
  )
}

// ---------------------------------------------------------------------------
// SCR-401 세금 계산 — 컷 8
// ---------------------------------------------------------------------------

/**
 * 연도와 **시뮬레이션 값**이 주소에 있다 — 그것이 「저장되지 않는다」의 형태다
 *
 * DOC-011 §4.6이 `override`를 시뮬레이션 전용으로 정하고 저장을 §5.6으로 분리한
 * 이유가 「값을 조정해봤을 뿐인데 저장되는」 문제다. 조정을 **주소**에 두면 그
 * 분리가 구조가 된다 — 조정 폼이 `<form method="GET">`이므로 변경 계약으로 가는
 * 경로가 애초에 없다(서버 액션이 아니다).
 *
 * ## 세 값이 **함께** 있어야 `override`가 된다고 보지 않는다
 *
 * 하나만 있어도 override다. 계약의 `override`가 필드별 선택이므로(`?:`) 나머지는
 * 저장값이 그대로 쓰인다 — 부분 조정이 계약의 설계다.
 */
export type TaxOverrideValues = {
  otherIncomeBase?: string
  otherFinancialIncome?: string
  healthInsuranceType?: string
}

export type TaxFilter = {
  /** 요청 연도. `null`이면 화면이 기준일의 연도를 쓴다 */
  year: number | null
  /** 시뮬레이션 값. **키가 하나도 없으면 `null`이다** — 그 구분이 표시를 가른다 */
  override: TaxOverrideValues | null
}

export const TAX_KEYS = {
  year: 'year',
  otherIncomeBase: 'otherIncomeBase',
  otherFinancialIncome: 'otherFinancialIncome',
  healthInsuranceType: 'healthInsuranceType',
} as const

/**
 * **`override`가 `null`인지가 화면의 문구를 정한다.**
 *
 * 계약의 `isSaved = false`는 「저장된 프로필이 없다」와 「override 적용 중」을 한
 * 거짓으로 접는다(§4.6). 두 상태의 표시가 정반대이므로(미입력 경고 / 시뮬레이션
 * 안내) 가르는 값이 필요한데, **그것을 계약에 묻지 않는다** — `override`를 넘긴 것은
 * 화면 자신이고 여기가 그 사실이 만들어지는 자리다.
 *
 * `healthInsuranceType`은 **화면이 제시한 값 집합을 인자로 받는다**(`parseProductFilter`가
 * `kiStatus`에 하는 것과 같다). 라벨 표가 정본이므로 목록을 여기서 다시 적지 않는다.
 */
export function parseTaxFilter(
  values: QueryValues,
  healthTypes: readonly string[],
): TaxFilter {
  const override: TaxOverrideValues = {}

  // 금액은 **비어 있지 않을 때만** 담는다. 빈 칸은 「조정하지 않음」이고 `'0'`이
  // 아니다 — `'0'`으로 읽으면 사용자가 적지 않은 값을 우리가 지어내는 것이 된다.
  const base = one(values[TAX_KEYS.otherIncomeBase])
  if (base !== '') override.otherIncomeBase = amountDigits(base)
  const other = one(values[TAX_KEYS.otherFinancialIncome])
  if (other !== '') override.otherFinancialIncome = amountDigits(other)

  // 열거값은 인식할 때만 담는다. 조작된 값은 그 축을 조정하지 않은 것이 된다.
  const health = oneOf(one(values[TAX_KEYS.healthInsuranceType]), healthTypes)
  if (health != null) override.healthInsuranceType = health

  return {
    year: yearOr(one(values[TAX_KEYS.year])),
    override: Object.keys(override).length === 0 ? null : override,
  }
}

/**
 * 4자리 연도만 받는다. **범위는 보지 않는다** — 어느 연도가 유효한지는 세율 시드가
 * 정하고(§4.6 `seededYears`) 그 지식은 조회 결과에 있다. 여기서 범위를 정하면
 * 시드가 늘 때 두 곳을 고쳐야 한다.
 */
function yearOr(raw: string): number | null {
  return /^\d{4}$/.test(raw) ? Number.parseInt(raw, 10) : null
}

/**
 * 주소에 실린 금액에서 쉼표·공백을 지운다.
 *
 * 조정 폼은 GET이므로 **직전 값이 그대로 주소에 실려 다시 입력란으로 돌아온다.**
 * 화면이 천단위 쉼표를 붙여 렌더하면(사용자가 그렇게 적기도 한다) 그 문자열이
 * 계약으로 가는데, `requireAmount`가 「정수로 입력한다」를 내고 사용자에게는 자기가
 * 적은 것이 정수다 — `parse.ts`의 `amountText`가 폼 경로에서 막는 것과 같은 함정이며
 * 주소 경로에도 있다. **값은 바뀌지 않는다**(문자열 연산이고 float64를 경유하지 않는다).
 */
function amountDigits(raw: string): string {
  return raw.replace(/[,\s]/g, '')
}

// ---------------------------------------------------------------------------
// 원시값 좁히기
// ---------------------------------------------------------------------------

/**
 * `?status=A&status=B`는 배열로 온다. **첫 값을 쓰지 않고 버린다** — 어느 쪽을
 * 골라도 사용자가 고르지 않은 하나를 우리가 고르는 것이고, 폼이 만들 수 없는
 * 형태이므로 조작된 주소다.
 */
function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function oneOf<T extends string>(raw: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * **라우트 파라미터도 이 검사를 지난다** — SCR-202 (컷 3).
 *
 * `getProduct('abc')`는 `null`이 아니라 **예외**다. PostgREST가 `uuid` 열에 대한
 * 비-UUID 비교를 `22P02`로 거부하고 조회 계층이 그것을 던진다(실측). 그러면
 * 주소를 손으로 고쳐 들어온 사용자가 404 대신 일반 오류 화면을 보게 되는데,
 * DOC-008 §6은 그 화면의 에러를 「미존재 → SCR-901」로 규정한다.
 *
 * 형식 검사는 계약의 일이 아니다 — 계약의 입력은 `string`이고, 그 문자열이 라우트
 * 파라미터라는 사실은 화면만 안다. 그리고 필터의 `ownerId`가 같은 검사를 쓰므로
 * (`uuidOr`) 두 곳이 같은 정규식을 본다.
 */
export function isUuid(raw: string): boolean {
  return UUID.test(raw.trim())
}

function uuidOr(raw: string): string | null {
  return isUuid(raw) ? raw : null
}
