import type { Metadata } from 'next'
import Link from 'next/link'

import { ProductFilters, type OwnerOption } from '@/components/products/ProductFilters'
import { ProductRow } from '@/components/products/ProductRow'
import { EmptyState } from '@/components/state/EmptyState'
import type { ProductListItem } from '@/lib/db/queries/map'
import { getQueries, getViewerId } from '@/lib/db/server'
import { KI_STATUS_LABELS, paginate } from '@/lib/format'
import type { KiStatus } from '@/lib/domain'
import {
  FILTER_KEYS,
  isMineOnly,
  isNarrowed,
  OWNER_ALL,
  pageQuery,
  parsePage,
  parseProductFilter,
  toListParams,
  type ProductFilter,
  type QueryValues,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-201 ELS 목록 — P4 컷 2 (DOC-008 §5, DOC-011 §4.2)
 *
 * ## 조회를 두 번 하는 이유 — 빈 상태 두 갈래가 그것을 요구한다
 *
 * DOC-008 §6은 이 화면의 빈 상태를 「조건에 맞는 상품 없음 / 전체 없음(**구분**)」
 * 으로 규정하고, ST-02는 빈 상태마다 **다음 행동**을 요구한다. 두 상태의 다음
 * 행동이 다르다 — 앞은 필터 해제이고 뒤는 상품 등록이다. `items.length === 0`만
 * 보면 둘을 가를 수 없다.
 *
 * 그리고 **소유자 선택지도 좁히지 않은 목록에서만 나온다.** 필터된 결과에서
 * 뽑으면 「아버지」로 필터한 순간 선택지에 아버지만 남아 다른 소유자로 돌아갈 길이
 * 사라지고, 결과가 0건이면 이름조차 알 수 없어 UUID가 노출된다. SQ-01이 SCR-501을
 * 만들지 않은 근거가 이 필터이므로(「소유자 필터가 사용자 현황 화면을 대체한다」)
 * 그 선택지가 자기 자신에 의해 지워지면 근거가 무너진다.
 *
 * **좁히는 필터가 없으면 두 번째 조회를 하지 않는다** — 그때는 첫 조회가 이미
 * 전체다. ~~기본 화면의 왕복은 그대로 2다(DOC-011 §4.0).~~ 필터가 걸릴 때만 4가 되고
 * `Promise.all`이므로 대기는 한 파다.
 *
 * > ★ **그 「기본 화면의 왕복 2」가 v2.6에서 깨졌다** — 소유자 기본값이 본인이 되면서
 * > 기본 화면이 **이미 좁혀진 상태**이므로 두 번째 조회가 **항상** 돈다(왕복 4).
 * > 좁히지 않은 화면은 이제 소유자 「전체」를 고른 경우뿐이다. DOC-008 §5 SCR-201
 * > ★★ ⓐ가 그 대가를 등재했고, 받아들이는 근거는 A-01 규모다(상품 12건·사용자 셋).
 * > **깨진 문장을 지우지 않고 취소선으로 둔다** — 지우면 다음 사람이 왕복 2를 여전히
 * > 성립하는 전제로 읽는다.
 *
 * 필터가 걸린 렌더에서는 **무결성 결함 로그도 두 번 찍힌다**(`judge()`가 상품마다
 * 한 번 기록한다). 계약 여럿이 한 요청에서 판정하면 이미 그런 상태이므로 새로운
 * 성질은 아니지만, 같은 계약을 두 번 부르는 것은 처음이라 적어 둔다 — 로그에서
 * 결함 건수를 세면 두 배가 된다.
 *
 * > 소유자 목록을 `listUserSummaries`로 얻지 않는다. 그쪽은 왕복 4에 전 사용자의
 * > 세금을 계산하며(§4.8) DOC-011 §8이 이 화면에 배정한 조회 계약은 `listProducts`
 * > 하나다 — 계약을 늘리는 것은 문서 선행 + 세 스위트를 끌고 오는 일이고, 필터
 * > 선택지가 그 대가를 정당화하지 않는다.
 *
 * ## 필터·정렬은 서버다
 *
 * `searchParams` + `<form method="GET">`. 파싱은 `lib/forms/query.ts`(순수)에 있고
 * 이 파일은 결선만 한다 — 이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 import
 * 그래프에도 들어갈 수 없다(AQ-23).
 */

export const metadata: Metadata = {
  title: 'ELS 목록 · 언제들어오나',
}

/**
 * `KiStatus` 값의 정본은 **라벨 표**다 — `Record<KiStatus, string>`이므로 도메인
 * 열거값이 늘면 여기서 컴파일이 깨진다. 파서에 넘겨 「인식 가능한 값」이 화면의
 * 선택지와 같은 집합임을 구조로 만든다(AQ-24가 생긴 원인이 두 목록의 갈림이었다).
 */
const KI_STATUS_VALUES = Object.keys(KI_STATUS_LABELS) as KiStatus[]

export default async function ProductsPage({
  searchParams,
}: {
  // Next 16의 searchParams는 Promise다.
  searchParams: Promise<QueryValues>
}) {
  const params = await searchParams
  const [queries, viewerId] = await Promise.all([getQueries(), getViewerId()])
  const filter = parseProductFilter(params, KI_STATUS_VALUES, viewerId)

  const narrowed = isNarrowed(filter)
  const [matched, pool] = await Promise.all([
    queries.listProducts(toListParams(filter, viewerId)),
    narrowed ? queries.listProducts({}) : null,
  ])
  // 좁히지 않았으면(= 소유자 「전체」) 첫 조회가 곧 전체다.
  const all = pool ?? matched

  /*
   * 페이지는 **거른 뒤에** 자른다. 계약이 `status`·`kiStatus`를 조회 후에 거르므로
   * (Q-05) 그 전에 자르면 페이지마다 건수가 달라진다 — `paginate`의 각주.
   * 범위 밖 페이지는 그 함수가 clamp하므로 여기서 판단하지 않는다.
   */
  const paged = paginate(matched, parsePage(params))
  const items = paged.items

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">ELS 목록</h1>
          {/*
            건수는 **거른 결과 전체**를 말한다 — 이 페이지에 보이는 수가 아니다.
            페이지가 나뉘면 「지금 몇 페이지인가」를 덧붙인다: 그것이 없으면 10건
            뒤가 잘린 것과 상품이 10건인 것이 같게 보인다(AQ-22의 형태).
          */}
          <p className="mt-1 text-sm text-neutral-600">
            {narrowed ? `${all.length}건 중 ${paged.total}건` : `${paged.total}건`}
            {paged.pageCount > 1 && ` · ${paged.page}/${paged.pageCount} 페이지`}
          </p>
        </div>

        {/*
          `OwnerOnly`로 감싸지 않는다 — DOC-008 §5는 「`+ 등록` 버튼은 **항상**
          노출(본인 소유로 생성)」이라고 규정한다. 등록은 남의 데이터에 대한 조작이
          아니므로 ST-04의 대상이 아니다.
        */}
        {/*
          기실현 등재를 나란히 둔다 — 네비게이션 탭을 늘리지 않는 이유가
          DOC-008 §3(탭 넷이 정본)이고, 이 화면이 유일한 진입점이다. 부차적인
          경로임을 형태로 말한다: 테두리만 있는 버튼이다.
        */}
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={PATHS.productRealizedNew}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
          >
            기실현 등재
          </Link>
          <Link
            href={PATHS.productNew}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            + 등록
          </Link>
        </div>
      </header>

      <ProductFilters filter={filter} owners={ownersOf(all, viewerId)} />

      {items.length === 0 ? (
        <ListEmpty narrowed={narrowed} mineOnly={isMineOnly(filter)} />
      ) : (
        <div className="flex flex-col gap-3">
          {/*
            표 머리글은 데스크톱에서만 — 그 아래에서는 카드이고 각 값이 자기
            라벨을 들고 있다(`ProductRow`의 `lg:hidden` 라벨). 열 정의를 두 곳에
            적는 대신 같은 그리드 템플릿을 공유한다.

            ★ **외곽 테두리를 두지 않는다** (v2.0). 카드마다 테두리가 있으므로
            감싸면 이중선이 되고, 그 이중선이 「어느 선이 경계인가」를 다시 모호하게
            만든다 — 정확히 이 컷이 고치는 그 결함이다. `px-4`가 카드의 안쪽 여백과
            같아서 열이 그대로 맞는다.
          */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] gap-3 px-4 text-xs font-medium text-neutral-500 lg:grid">
            <span>상품</span>
            <span className="text-right">투자원금 (원)</span>
            <span>다음 평가일</span>
            <span>워스트오브</span>
            <span>판정</span>
          </div>

          {/*
            모바일 1열 → 태블릿 2열 → 데스크톱 1열 (DOC-008 §8)

            ★ **`divide-y`를 여백으로 바꿨다** (v2.0). 구분선에 경계를 맡기면 한 상품
            안의 선(계약 조건 줄)과 상품 사이의 선이 같은 부류가 되어 소속이 모호해진다.
            여백 + 카드 테두리는 **선의 해석 없이** 소속을 정한다.
          */}
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
            {items.map((item) => (
              <ProductRow key={item.id} item={item} />
            ))}
          </ul>

          {paged.pageCount > 1 && (
            <Pagination filter={filter} page={paged.page} pageCount={paged.pageCount} />
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 빈 상태 ~~**둘**~~ **셋** — DOC-008 §6이 구분을 요구하고 ST-02가 다음 행동을 요구한다.
 *
 * `EmptyState`의 `action`이 필수 prop이므로 다음 행동 없는 빈 상태는 컴파일되지
 * 않는다. 그 타입이 여기서 실제로 세 개의 다른 행동을 강제한다 — 「조건에 맞는
 * 상품 없음」에 `+ 등록`을 붙이면 사용자는 필터가 걸린 것을 모른 채 상품을 하나 더
 * 만들고 그것도 목록에 나타나지 않는다.
 *
 * ## ★ 셋째가 v2.6에서 «필연»으로 생겼다 — 순서가 이 함수의 내용이다
 *
 * 소유자 기본값이 본인이 되면서 아무것도 고르지 않은 화면이 이미 좁혀진 상태다.
 * `mineOnly`를 **먼저** 보지 않으면 그 상태가 「조건에 맞는 상품이 없다 → 필터
 * 초기화」로 떨어지는데, **초기화된 주소(`PATHS.products`)가 곧 본인 보기이므로
 * 눌러도 같은 화면**이다. 다음 행동이 아무 일도 하지 않는 빈 상태는 ST-02 위반이며,
 * `EmptyState`의 타입은 **행동이 있는지**만 강제하고 **그 행동이 무언가를 바꾸는지**는
 * 강제하지 못한다 — 타입이 닿지 못하는 자리라 순서를 각주로 못박는다.
 *
 * `narrowed`가 `mineOnly`를 **포함하므로** 순서를 뒤집으면 셋째가 영원히 나타나지
 * 않는다. 문구·행동은 SCR-101의 `MINE`과 같은 부류다(DOC-008 §6 각주).
 */
function ListEmpty({ narrowed, mineOnly }: { narrowed: boolean; mineOnly: boolean }) {
  if (mineOnly) {
    return (
      <EmptyState
        title="내 상품이 없다"
        description="다른 사람의 상품까지 보려면 소유자를 「전체」로 바꾼다."
        action={{
          label: '전체 보기',
          href: `${PATHS.products}?${FILTER_KEYS.owner}=${OWNER_ALL}`,
        }}
      />
    )
  }

  if (narrowed) {
    return (
      <EmptyState
        title="조건에 맞는 상품이 없다"
        description="필터를 해제하면 내 상품 목록이 보인다."
        action={{ label: '필터 초기화', href: PATHS.products }}
      />
    )
  }

  return (
    <EmptyState
      title="등록된 상품이 없다"
      description="ELS를 등록하면 평가일정·조건 판정·세금 계산이 함께 채워진다."
      action={{ label: '+ 등록', href: PATHS.productNew }}
    />
  )
}

/**
 * 소유자 선택지 — 상품을 가진 사람만 나온다.
 *
 * 사용자 전체가 아니라 **소유자 전체**다. 상품이 없는 사용자를 선택지에 두면 그
 * 항목은 언제나 0건이고, 「조건에 맞는 상품 없음」이 필터의 결과인지 그 사용자의
 * 상태인지 구분되지 않는다.
 *
 * `ownerName`은 뷰가 이미 담고 있다(§4.2) — 이름을 얻기 위한 별 조회가 없다.
 *
 * ★ **보는 사람 자신은 빼고 낸다** (v2.6). 그 사람은 선택지의 **기본 항목**(「내
 * 상품」 = 주소에서 키 없음)으로 이미 있으므로, 여기서도 내면 **같은 뜻의 항목이
 * 둘**이 된다 — 사용자는 둘 중 어느 것이 지금 상태인지 알 수 없고 `<select>`는
 * 하나만 선택된 것으로 그린다. 파서가 자기 UUID를 `MINE`으로 정규화하는 것과
 * **같은 사실의 반대편**이다.
 */
function ownersOf(
  items: readonly ProductListItem[],
  viewerId: string,
): OwnerOption[] {
  const byId = new Map<string, string>()
  for (const item of items) {
    if (item.ownerId === viewerId) continue
    if (!byId.has(item.ownerId)) byId.set(item.ownerId, item.ownerName)
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 페이지 이동 — **링크다. JS가 없어도 동작한다** (DOC-008 §5 SCR-201 v2.0)
 *
 * 필터·정렬이 `<form method="GET">`인 것과 같은 축이다: 주소가 상태이므로 페이지도
 * 주소에 있고, 이동은 링크다. 버튼과 클라이언트 상태로 두면 뒤로 가기가 페이지를
 * 되돌리지 못하고 링크를 공유할 수도 없다.
 *
 * ## 번호를 전부 그리지 않는다
 *
 * 이전·다음과 「n/m」만 둔다. 번호를 나열하면 페이지가 많을 때 그 목록이 카드보다
 * 길어지고, A-01 규모에서 페이지는 한 자리 수다. 첫·끝으로 가는 링크도 두지 않는다 —
 * 두 페이지 사이를 오가는 것이 이 화면의 실제 사용이다.
 *
 * ## 필터를 함께 싣는다
 *
 * `pageQuery`가 `filterQuery`를 재사용한다 — 여기서 질의를 조립하면 정렬 기본값을
 * 주소에 싣지 않는 규칙이 두 곳에 생기고, 그 갈림은 「페이지를 넘기면 정렬이 주소에
 * 나타난다」로 드러난다.
 */
function Pagination({
  filter,
  page,
  pageCount,
}: {
  filter: ProductFilter
  page: number
  pageCount: number
}) {
  const first = page <= 1
  const last = page >= pageCount

  return (
    <nav
      aria-label="페이지 이동"
      className="flex items-center justify-center gap-2 pt-1"
    >
      <PageLink href={pageQuery(filter, page - 1)} disabled={first}>
        이전
      </PageLink>
      {/* 한 문자열로 렌더한다 — `{a}/{b}`는 사이에 빈 주석이 들어간다(실측) */}
      <span className="px-2 text-sm tabular-nums text-neutral-600">
        {`${page} / ${pageCount}`}
      </span>
      <PageLink href={pageQuery(filter, page + 1)} disabled={last}>
        다음
      </PageLink>
    </nav>
  )
}

/**
 * 양 끝에서는 **`<span>`이다 — 비활성 링크를 두지 않는다.**
 *
 * `aria-disabled`를 붙인 `<a>`는 여전히 눌리고, 눌리면 범위 밖 페이지로 가서
 * `paginate`가 clamp한 같은 화면이 다시 그려진다 — 사용자에게는 「눌렀는데 아무 일도
 * 없다」이고 그것은 결함으로 읽힌다. ST-04가 권한 없는 버튼을 **숨기는** 것과 같은
 * 판단이다: 할 수 없는 조작은 조작할 수 없는 모양이어야 한다.
 */
function PageLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: string
}) {
  const shape = 'rounded-md border px-3 py-1.5 text-sm'
  if (disabled) {
    return (
      <span className={`${shape} border-neutral-200 text-neutral-300`}>{children}</span>
    )
  }
  return (
    <Link
      href={`${PATHS.products}${href}`}
      className={`${shape} border-neutral-300 text-neutral-700 hover:bg-neutral-100`}
    >
      {children}
    </Link>
  )
}
