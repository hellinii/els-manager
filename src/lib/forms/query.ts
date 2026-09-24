import type { ListProductsParams } from '@/lib/db/queries/products'
import type { ListScheduleParams } from '@/lib/db/queries/schedule'
import type { KiStatus } from '@/lib/domain'
import { PATHS } from '@/lib/routes/paths'

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

// ---------------------------------------------------------------------------
// 소유자 축 — 값이 «셋»이다 (DOC-008 §5 SCR-201 ★ · §9 SQ-03, v2.6)
// ---------------------------------------------------------------------------

/**
 * **부재 = 본인 · `ALL` = 전체 · UUID = 그 사람.**
 *
 * ## 왜 `string | null`이 아닌가 — 그 형태가 이 결함을 만들었다
 *
 * 종전에는 `ownerId: string | null`이었고 **`null`이 「전체」**였다. 운영 계정이
 * 하나인 동안 「본인」과 「전체」가 같은 화면을 내므로 **두 뜻이 한 값에 겹쳐 있는
 * 것이 관측되지 않았고**, Secondary 계정이 서자마자(2026-08-07) 기본 화면이 남의
 * 상품을 섞어 보여 줬다. 축을 셋으로 가르는 것이 그 겹침을 없애는 유일한 방법이다.
 *
 * ## 왜 태그 유니온이 아니라 문자열인가
 *
 * 이 값은 **주소에 그대로 실린다.** 태그 유니온이면 인코딩·디코딩 한 쌍이 더 생기고
 * 그 쌍이 갈릴 수 있다. 대신 배타성을 **형식으로** 보장한다 — 두 상수는 UUID 형식이
 * 아니므로 사용자 id와 절대 충돌하지 않으며, `tests/app/query.test.ts`가 그것을
 * 단언한다(상수를 UUID처럼 생긴 것으로 바꾸면 빨간불이다).
 *
 * `DashboardScope`(`'MINE' | 'ALL'`)와 **같은 어휘**다 — SCR-101이 SQ-03에서 이미
 * 쓰던 말이고, 이 컷이 그 판단을 두 화면으로 넓힌 것이므로 이름도 같아야 한다.
 */
export type OwnerScope = string

/** 본인. **기본값이며 주소에 싣지 않는다** */
export const OWNER_MINE = 'MINE'
/** 전체. 사용자가 선택지에서 골라야만 되는 값이다 */
export const OWNER_ALL = 'ALL'

/** 특정 사용자로 좁힌 상태인가 — 그때만 `scope`가 UUID다 */
export function isUserScope(scope: OwnerScope): boolean {
  return scope !== OWNER_MINE && scope !== OWNER_ALL
}

/**
 * 계약에 넘길 `ownerId`. **`null`이면 소유자로 좁히지 않는다**(= 전체).
 *
 * 「본인」을 여기서 실제 id로 바꾸는 것이 요점이다 — 파서는 순수 모듈이라 로그인한
 * 사람을 모르고, 그 지식은 화면에만 있다(`getViewerId`). 그래서 **주소에는 상징이
 * 실리고 계약에는 id가 간다.**
 */
export function ownerParam(scope: OwnerScope, viewerId: string): string | null {
  if (scope === OWNER_ALL) return null
  return scope === OWNER_MINE ? viewerId : scope
}

/**
 * 주소값 → 축. **인식하지 못한 값은 기본값(본인)이다.**
 *
 * 자기 UUID는 `MINE`으로 **정규화한다** — 같은 화면을 가리키는 주소가 둘이면 공유된
 * 링크가 어느 쪽인지에 따라 달라 보이고, `<select>`의 어느 항목이 선택되는지도
 * 갈린다(`dashboardQuery`가 기본값을 싣지 않는 규약과 같은 자리).
 */
function parseOwnerScope(raw: string, viewerId: string): OwnerScope {
  if (raw === OWNER_ALL) return OWNER_ALL
  if (!isUuid(raw)) return OWNER_MINE
  return raw === viewerId ? OWNER_MINE : raw
}

export type ProductFilter = {
  /** 소유자 축. **`null`이 없다** — 위 `OwnerScope`의 각주가 그 이유다 */
  owner: OwnerScope
  status: 'ACTIVE' | 'REDEEMED' | null
  kiStatus: KiStatus | null
  /** 정렬은 「없음」이 아니라 기본값을 갖는다 — 근거는 `SORT_DEFAULT`. */
  sortBy: SortKey
}

/**
 * 필터의 질의 문자열 키. 화면의 `<select name>`이 이 값을 쓴다.
 *
 * **소유자의 «키 이름»은 `ownerId` 그대로다** — 타입의 필드명만 `owner`로 바꿨다.
 * 뜻이 「id 또는 없음」에서 「축」으로 달라졌으므로 필드명은 따라가야 하지만,
 * 주소 키를 바꾸면 §7.4가 그린 전이로 공유된 링크가 전부 죽는다.
 */
export const FILTER_KEYS = {
  owner: 'ownerId',
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
  viewerId: string,
): ProductFilter {
  return {
    // UUID 형식만 확인한다. 실재 여부는 조회 결과가 말한다 — 없는 소유자로
    // 필터하면 0건이고 그것이 「조건에 맞는 상품 없음」의 정상 경로다.
    owner: parseOwnerScope(one(values[FILTER_KEYS.owner]), viewerId),
    status: oneOf(one(values[FILTER_KEYS.status]), STATUS_VALUES),
    kiStatus: oneOf(one(values[FILTER_KEYS.kiStatus]), kiStatusValues),
    sortBy: oneOf(one(values[FILTER_KEYS.sortBy]), SORT_KEYS) ?? SORT_DEFAULT,
  }
}

const SORT_KEYS = ['EVALUATION_DATE', 'PRINCIPAL', 'D_DAY'] as const

/**
 * 페이지 번호의 질의 키 — **`ProductFilter`에 넣지 않는다** (DOC-008 §5 v2.0)
 *
 * ★ 넣으면 `filterQuery`가 그것을 실어 나르고, 그러면 **필터를 바꿔도 페이지가 따라온다** —
 * 3페이지를 보다가 필터를 좁히면 결과가 1페이지뿐일 수 있고 그때 사용자는 상품이 있는데
 * 빈 화면을 본다(clamp가 막지만 애초에 발생하지 않는 것이 낫다).
 *
 * 그래서 축을 분리했고, 그 결과 **페이지 초기화가 규율이 아니라 구조가 된다**: 필터·정렬
 * 폼은 `<form method="GET">`이고 그 안에 `page` 칸이 **없으므로** 제출하면 주소에 `page`가
 * 실리지 않는다. 「필터를 바꿀 때 페이지를 지운다」를 코드로 기억할 필요가 없다.
 *
 * 반대 방향은 명시적이다 — 페이지 링크가 `pageQuery`로 현재 필터를 함께 싣는다.
 */
export const PAGE_KEY = 'page'

/**
 * 주소의 페이지 번호. 1-기반이며 **인식하지 못한 값은 1이다.**
 *
 * 상한을 여기서 보지 않는 이유: 전체 페이지 수는 거른 뒤의 건수에서 나오고 그것은 조회
 * 결과다. 범위 밖 값의 처분은 `paginate`가 clamp로 한다(그 함수의 각주).
 */
export function parsePage(values: QueryValues): number {
  const raw = (one(values[PAGE_KEY]) ?? '').trim()
  if (!/^\d+$/.test(raw)) return 1
  const parsed = Number.parseInt(raw, 10)
  return parsed < 1 ? 1 : parsed
}

/**
 * 그 페이지로 가는 주소 — **현재 필터를 그대로 싣는다.**
 *
 * `filterQuery`를 재사용하는 것이 요점이다. 여기서 질의 문자열을 다시 조립하면 필터의
 * 기본값 규칙(정렬 기본값은 주소에 싣지 않는다)이 두 곳에 생기고, 그 갈림은 「페이지를
 * 넘기면 정렬이 주소에 나타난다」로 드러난다.
 *
 * 1페이지는 키를 싣지 않는다 — 아무것도 고르지 않은 상태의 주소가 깨끗해야 한다는
 * `filterQuery`의 같은 규약이다.
 */
export function pageQuery(filter: ProductFilter, page: number): string {
  const base = filterQuery(filter)
  if (page <= 1) return base
  const joiner = base === '' ? '?' : '&'
  return `${base}${joiner}${PAGE_KEY}=${page}`
}

/**
 * 계약에 넘길 형태로. **선택 필드는 키를 아예 넣지 않는다** —
 * `exactOptionalPropertyTypes`에서 `undefined`를 넘기는 것과 키가 없는 것이
 * 다르고, 계약의 `params.x != null` 분기는 후자를 전제한다.
 */
export function toListParams(
  filter: ProductFilter,
  viewerId: string,
): ListProductsParams {
  const params: ListProductsParams = { sortBy: filter.sortBy }
  const owner = ownerParam(filter.owner, viewerId)
  if (owner != null) params.ownerId = owner
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
  return (
    filter.owner !== OWNER_ALL || filter.status != null || filter.kiStatus != null
  )
}

/**
 * **소유자 축만 기본값(본인)이고 나머지는 걸리지 않은 상태인가** — 빈 상태 셋째의
 * 판정이다 (DOC-008 §5 SCR-201 ★★ ⓑ, v2.6).
 *
 * ## 이 함수가 없으면 「필터 초기화」가 자기 자신을 가리킨다
 *
 * 기본값이 좁히는 값이 되면서 **아무것도 고르지 않은 화면이 이미 좁혀진 상태**가
 * 됐다. 그때 0건이면 `isNarrowed`만 보는 화면은 「조건에 맞는 상품이 없다 → 필터
 * 초기화」를 내는데, **초기화된 주소가 곧 본인 보기이므로 눌러도 같은 화면**이다.
 * 다음 행동이 아무 일도 하지 않는 빈 상태는 ST-02 위반이다.
 *
 * ## 판정 순서가 이것 → `isNarrowed`다
 *
 * 뒤집으면 이 상태가 **영원히 나타나지 않는다** — `isNarrowed`가 이 상태를 포함하기
 * 때문이다(본인 보기도 좁힌 것이다). 화면이 두 분기를 그 순서로 쓴다.
 */
export function isMineOnly(filter: ProductFilter): boolean {
  return (
    filter.owner === OWNER_MINE && filter.status == null && filter.kiStatus == null
  )
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
    // 본인이 기본값이므로 싣지 않는다 — 아래 `sortBy`와 같은 규약이다.
    [FILTER_KEYS.owner]: filter.owner === OWNER_MINE ? null : filter.owner,
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
  /** SCR-201과 **같은 축·같은 기본값**이다 — `OwnerScope`의 각주 */
  owner: OwnerScope
  range: ScheduleRange
  /** DOC-008 §5의 「미상환만 보기」. `false`가 「전체」다 */
  activeOnly: boolean
}

/**
 * 질의 문자열 키. **`ownerId`는 SCR-201과 같은 이름이다** — 두 화면의 소유자 필터가
 * 같은 뜻이므로 주소에서도 같아야 한다(한쪽 링크를 다른 화면에 붙여도 축이 산다).
 */
export const SCHEDULE_KEYS = {
  owner: FILTER_KEYS.owner,
  range: 'range',
  activeOnly: 'activeOnly',
  /** ★ 보기 축. **`ScheduleFilter`에 들어 있지 않다** — 아래 `parseScheduleView` */
  view: 'view',
} as const

export const SCHEDULE_RANGE_DEFAULT: ScheduleRange = 'ALL'

const SCHEDULE_RANGES = ['ALL', 'PAST', 'UPCOMING'] as const

export function parseScheduleFilter(
  values: QueryValues,
  viewerId: string,
): ScheduleFilter {
  return {
    owner: parseOwnerScope(one(values[SCHEDULE_KEYS.owner]), viewerId),
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
  viewerId: string,
): ListScheduleParams {
  const params: ListScheduleParams = {}

  if (filter.range === 'UPCOMING') params.from = asOf
  if (filter.range === 'PAST') params.to = asOf
  const owner = ownerParam(filter.owner, viewerId)
  if (owner != null) params.ownerId = owner
  if (filter.activeOnly) params.activeOnly = true

  return params
}

/**
 * **좁히는 필터가 걸려 있는가** — 빈 상태 셋 중 앞의 둘을 가른다.
 *
 * SCR-201의 `isNarrowed`와 같은 자리이며 **기간도 좁힌다**(정렬과 다르다 — 순서를
 * 바꾸는 것이 아니라 행을 뺀다). ~~기본값 `ALL`이 아무것도 빼지 않으므로 기본 화면은
 * 「좁히지 않음」이고 조회가 한 번이다.~~
 *
 * ★ **그 마지막 문장이 v2.6에서 거짓이 됐다** — 소유자 기본값이 본인이므로 **기본
 * 화면이 좁혀진 상태**이고 조회가 **항상 두 번**이다(왕복 2 → 4). DOC-008 §5
 * SCR-201 ★★ ⓐ가 그 대가를 등재했다. 받아들이는 근거는 A-01 규모이고 되돌리기는
 * 기본값 한 줄이다. **깨진 성질을 각주에서 지우지 않는다** — 지우면 다음 사람이
 * 왕복 2를 여전히 성립하는 전제로 읽는다.
 */
export function isScheduleNarrowed(filter: ScheduleFilter): boolean {
  return (
    filter.owner !== OWNER_ALL ||
    filter.activeOnly ||
    filter.range !== SCHEDULE_RANGE_DEFAULT
  )
}

/**
 * **소유자 축만 기본값(본인)인가** — 빈 상태 둘째의 판정 (DOC-008 §5 SCR-301, v2.6).
 *
 * `isMineOnly`와 같은 일을 하며 근거도 같다. 판정 순서도 같다 — 이것이
 * `isScheduleNarrowed`보다 **먼저**다.
 */
export function isScheduleMineOnly(filter: ScheduleFilter): boolean {
  return (
    filter.owner === OWNER_MINE &&
    !filter.activeOnly &&
    filter.range === SCHEDULE_RANGE_DEFAULT
  )
}

/**
 * 보기 — 상품별 / 시간순 (DOC-008 §5, P6 컷 6)
 *
 * ## ★ `ScheduleFilter`에 «넣지 않는» 것이 이 절의 결정이다
 *
 * 넣으면 누군가 위 `isScheduleNarrowed`의 OR에 더한다 — 그 타입 안에 있으면
 * 필터처럼 보이기 때문이다. 그러면 **필터를 하나도 걸지 않은 화면이 「좁혀짐」으로
 * 판정되어** 두 가지가 함께 깨진다: ① 빈 상태가 첫째(「등록된 평가일정이 없다 ·
 * 등록」)에서 둘째(「조건에 맞는 평가일이 없다 · 필터 초기화」)로 바뀌어 사용자가
 * **걸지도 않은 필터를 해제하려 한다** ② 소유자 선택지를 위한 두 번째 조회가
 * **항상** 돈다 — 이 화면의 왕복 근거가 「기본이 전체 기간이라 좁히지 않는다」이므로
 * 그 전제가 함께 무너진다.
 *
 * 타입을 가르면 그 필드가 OR의 사정거리에 **들어올 수 없다.** `PAGE_KEY`가
 * `ProductFilter` 밖에 있는 것과 같은 형태이며, 다른 점은 방향이다 — 페이지는
 * 필터가 바뀔 때 **지워져야** 하고 보기는 **살아남아야** 한다(필터를 바꿔도
 * 사용자가 고른 표현은 무효가 되지 않는다). 그래서 필터 폼이 보기를 히든으로 싣고,
 * 페이지는 일부러 칸을 두지 않는다.
 */
export type ScheduleView = 'PRODUCT' | 'TIME'

export const SCHEDULE_VIEW_DEFAULT: ScheduleView = 'PRODUCT'

const SCHEDULE_VIEWS = ['PRODUCT', 'TIME'] as const

export function parseScheduleView(values: QueryValues): ScheduleView {
  return (
    oneOf(one(values[SCHEDULE_KEYS.view]), SCHEDULE_VIEWS) ?? SCHEDULE_VIEW_DEFAULT
  )
}

/**
 * 그 보기의 주소 — 전환 링크와 「필터 초기화」가 쓴다.
 *
 * **현재 필터를 함께 싣는다.** `dashboardQuery`는 축이 하나뿐이라 질의를 처음부터
 * 조립하지만 여기는 넷이므로, 싣지 않으면 보기를 바꿀 때 필터가 사라진다 —
 * `pageQuery`가 같은 자리에 있다(「페이지 링크가 현재 필터를 함께 싣는다」).
 *
 * **기본값은 주소에 싣지 않는다**(`filterQuery`·`dashboardQuery`와 같은 규약).
 *
 * ⚠️ `activeOnly`는 `'on'`으로 적는다 — 파서가 「부재 = 꺼짐」 규약이라 값을 보지
 * 않지만, `activeOnly=`(빈 문자열)로 적으면 `!== ''`가 거짓이 되어 **되읽을 때
 * 꺼진다.** 왕복이 항등이어야 전환 링크가 필터를 보존한다.
 */
export function scheduleQuery(filter: ScheduleFilter, view: ScheduleView): string {
  const pairs: Array<[string, string]> = []

  // 본인이 기본값이므로 싣지 않는다(`filterQuery`와 같은 규약).
  if (filter.owner !== OWNER_MINE) pairs.push([SCHEDULE_KEYS.owner, filter.owner])
  if (filter.range !== SCHEDULE_RANGE_DEFAULT) {
    pairs.push([SCHEDULE_KEYS.range, filter.range])
  }
  if (filter.activeOnly) pairs.push([SCHEDULE_KEYS.activeOnly, 'on'])
  if (view !== SCHEDULE_VIEW_DEFAULT) pairs.push([SCHEDULE_KEYS.view, view])

  if (pairs.length === 0) return ''
  return `?${pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}`
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

  // 금액도 **인식할 때만** 담는다 — 빈 칸이든 형식 위반이든 「조정하지 않음」이다.
  // `'0'`으로 읽으면 사용자가 적지 않은 값을 우리가 지어내는 것이 된다.
  const base = amountOr(one(values[TAX_KEYS.otherIncomeBase]))
  if (base != null) override.otherIncomeBase = base
  const other = amountOr(one(values[TAX_KEYS.otherFinancialIncome]))
  if (other != null) override.otherFinancialIncome = other

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
 * **저장 축과 같은 형식만 낸다** — `/^\d+$/`. 아니면 `null`(그 축을 조정하지 않음).
 *
 * 「받는다」가 아니라 「낸다」다. 쉼표·공백을 **먼저 지우므로** 받는 집합은 저장 축보다
 * 넓다(`1,000`·`1 000`을 받아 `1000`을 낸다). 그 넓음이 안전한 이유는 두 폼이 원시
 * 질의가 아니라 **계약의 출력**을 다시 렌더한다는 것이다 — `getTaxSummary`가
 * `profile.otherFinancialIncome`을 `amountString(dec(...))`으로 정규화해 돌려주고
 * 조정 폼의 `defaultValue`와 저장 폼의 히든이 그 값을 읽는다. 즉 사용자가 `1,000`을
 * 적어도 저장 계약에 실리는 값은 `1000`이다. **보장은 단방향(출력)이며 그것으로 충분하다.**
 *
 * ## 쉼표·공백을 먼저 지운다
 *
 * 조정 폼은 GET이므로 **직전 값이 그대로 주소에 실려 다시 입력란으로 돌아온다.**
 * 화면이 천단위 쉼표를 붙여 렌더하면(사용자가 그렇게 적기도 한다) 그 문자열이
 * 계약으로 가는데, `requireAmount`가 「정수로 입력한다」를 내고 사용자에게는 자기가
 * 적은 것이 정수다 — `parse.ts`의 `amountText`가 폼 경로에서 막는 것과 같은 함정이며
 * 주소 경로에도 있다. **값은 바뀌지 않는다**(문자열 연산이고 float64를 경유하지 않는다).
 *
 * ## 그다음 형식을 본다 — v1.1까지 이 검사가 없었다 (P4.5)
 *
 * 이 칸은 `type="text" inputMode="numeric"`이므로 **글자를 적을 수 있고**, GET이라
 * 그 문자열이 주소를 지나 조회 계약의 `dec()`에 닿는다. 검사가 없으면 「조정 적용」이
 * **오류 화면**이 됐다. 변경 계약이라면 `ActionResult`로 필드 오류를 돌려줄 수 있지만
 * 조회 계약에는 그 통로가 없으므로 **버리는 것이 유일하게 조용하지 않은 선택**이다 —
 * 같은 파일이 열거 축에 대해 이미 그 규약을 선언했다(「조작된 값은 그 축을 조정하지
 * 않은 것이 된다」).
 *
 * ## 왜 `/^\d+$/`인가 — 저장 축의 **구현**이 그 패턴이다
 *
 * §5.6 `saveTaxProfile`이 두 금액에 `requireAmount(min: 'zero', integer: true)`를 걸고
 * 그 조합의 패턴이 정확히 이것이다(`validate/primitives.ts`의 `INTEGER`). 조정 축이 더
 * 넓으면 **화면이 저장할 수 없는 숫자를 정상 결과로 렌더한다** — 사용자가 `-5000000`으로
 * 계산된 세액을 보고 저장을 눌렀다가 거부당하며 그 거부의 원인이 방금 본 화면에 없다.
 *
 * **DOC-011 §6의 V-19를 근거로 인용하지 않는다.** 그 규칙은 「문자열 필드 — 열 선언 길이
 * 이내」이고 이 형식과 다르다. 저장 축의 위반이 `V-19`로 **기록되는** 것은 §6 각주의
 * ID 재사용 규약(「셰이프 파싱은 필드가 속한 규칙의 ID를 재사용한다」) 때문이며, 그
 * 규약 자체가 「이 검사에 대응하는 §6 규칙이 없다」는 뜻이다. 즉 조정 축 형식의 정본은
 * **DOC-011 §4.6의 「`override` 각 축의 형식과 범위」**이고 두 축이 같은 값을 쓰는
 * 근거는 §6이 아니라 구현의 대칭이다.
 *
 * **`dec()`만으로는 부족하다** — 실측: `new Decimal('0x1f')`는 **31**이고
 * `new Decimal('1e999')`는 `isFinite()`가 참이라 `dec()`를 통과한다. 즉 형식 검사가
 * 없으면 「비숫자 → 오류 화면」보다 나쁜 경로가 둘 있다(틀린 값이 조용히 정상이 된다).
 * 정규식이 셋을 함께 닫는다.
 */
function amountOr(raw: string): string | null {
  const digits = raw.replace(/[,\s]/g, '')
  return /^\d+$/.test(digits) ? digits : null
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

// ---------------------------------------------------------------------------
// SCR-204 불러오기 — 회차 검색 · 상품 선택 (DOC-008 §5 SCR-204 v2.9, S-12)
// ---------------------------------------------------------------------------

/**
 * 불러오기의 주소 — **주소가 상태다.** 검색은 GET 폼(`q`), 선택은 링크(`code`)다.
 *
 * 서버 액션이 아닌 이유는 DOC-011 §1.2·§4.10에 있다 — JS 없이 동작하고, 뒤로 가기가
 * 후보 목록으로 돌아가며, 주소로 다시 열 수 있다.
 */
export const IMPORT_KEYS = { query: 'q', code: 'code' } as const

export type ImportQuery = {
  /** 회차 검색어(상품명 일부). 없거나 버려지면 `null` */
  query: string | null
  /** 키움 상품 코드(`E04000`·`EM1740`). 형식이 아니면 `null` — 네트워크에 나가지 않는다 */
  code: string | null
}

/** 검색어 상한 — 어댑터의 `QUERY_MAX_LENGTH`(30)와 같다. 더 길면 버린다 */
const IMPORT_QUERY_MAX = 30

/** 키움 상품 코드 — 어댑터의 `PRODUCT_CODE`와 같은 형식. 화면이 먼저 거른다 */
const IMPORT_CODE = /^E[0-9A-Z]{5}$/

/**
 * `?q=…&code=…` → 불러오기 상태.
 *
 * **인식하지 못한 값은 버린다**(이 파일의 규약) — 조작된 `code`에 오류를 내면 링크 하나가
 * 등록 화면을 막는다. 버리면 그 축이 「없음」이 되고 화면은 빈 폼을 그린다. 어댑터도 같은
 * 형식을 다시 검사하지만(`SYMBOL_SCHEME`) **화면이 먼저 걸러야 네트워크에 나가지 않는다.**
 *
 * 검색어는 제어 문자를 지우고 앞뒤 공백을 잘라 1~30자만 받는다.
 */
export function parseImportQuery(values: QueryValues): ImportQuery {
  const rawQuery = one(values[IMPORT_KEYS.query]).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  const rawCode = one(values[IMPORT_KEYS.code]).trim().toUpperCase()

  return {
    query: rawQuery.length >= 1 && rawQuery.length <= IMPORT_QUERY_MAX ? rawQuery : null,
    code: IMPORT_CODE.test(rawCode) ? rawCode : null,
  }
}

/**
 * 수정 화면의 불러오기 주소 — **상환 처리된 상품이면 읽지 않는다** (DOC-011 X-01 v4.6)
 *
 * 저장이 `CONFLICT`이므로 채울 이유가 없다. 주소를 버리면 키움 조회가 하나도 나가지 않는다 — 구획을
 * 숨기는 조건과 호출을 건너뛰는 조건이 페이지의 다른 줄이면 한쪽이 빠져도 화면은 같아 보이므로,
 * 호출 쪽 판단을 여기 두고 상시 스위트가 본다(DOC-010 v3.12).
 */
export function parseEditImportQuery(values: QueryValues, redeemed: boolean): ImportQuery {
  return redeemed ? { query: null, code: null } : parseImportQuery(values)
}

/**
 * 불러오기가 채우는 폼 — 등록(빈 폼 위) 또는 수정(저장값 위, DOC-008 v2.12 · SQ-10)
 *
 * 주소의 경로 부분이 여기서 나온다. 수정은 대상 id가 경로에 있으므로 종류와 id를 한 값으로 둔다 —
 * 둘을 따로 넘기면 「수정인데 id가 없는」 조합이 표현된다.
 */
export type ImportTarget = { kind: 'NEW' } | { kind: 'EDIT'; productId: string }

export const IMPORT_NEW: ImportTarget = { kind: 'NEW' }

export function importTargetPath(target: ImportTarget): string {
  return target.kind === 'NEW' ? PATHS.productNew : PATHS.productEdit(target.productId)
}

/**
 * 불러오기 주소 — 검색 폼의 대상·후보 링크·「다른 후보 보기」·「불러오기 취소」·자산 추가 뒤의 복귀가 쓴다.
 *
 * **서명이 하나다** — 부르는 곳마다 조합하면 한쪽이 `q`를 빠뜨려 「다른 후보 보기」가 빈
 * 검색으로 돌아가는 날이 온다. `null`은 주소에 싣지 않는다(`dashboardQuery`와 같은 규약).
 */
export function importHref(target: ImportTarget, state: ImportQuery): string {
  const base = importTargetPath(target)
  const params = new URLSearchParams()
  if (state.query != null) params.set(IMPORT_KEYS.query, state.query)
  if (state.code != null) params.set(IMPORT_KEYS.code, state.code)
  const query = params.toString()
  return query === '' ? base : `${base}?${query}`
}
