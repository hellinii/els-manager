import type { ListProductsParams } from '@/lib/db/queries/products'
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
