import type { Metadata } from 'next'
import Link from 'next/link'

import { ProductFilters, type OwnerOption } from '@/components/products/ProductFilters'
import { ProductRow } from '@/components/products/ProductRow'
import { EmptyState } from '@/components/state/EmptyState'
import type { ProductListItem } from '@/lib/db/queries/map'
import { getQueries } from '@/lib/db/server'
import { KI_STATUS_LABELS } from '@/lib/format'
import type { KiStatus } from '@/lib/domain'
import {
  isNarrowed,
  parseProductFilter,
  toListParams,
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
 * 전체다. 기본 화면의 왕복은 그대로 2다(DOC-011 §4.0). 필터가 걸릴 때만 4가 되고
 * `Promise.all`이므로 대기는 한 파다.
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
  const filter = parseProductFilter(await searchParams, KI_STATUS_VALUES)
  const queries = await getQueries()

  const narrowed = isNarrowed(filter)
  const [items, pool] = await Promise.all([
    queries.listProducts(toListParams(filter)),
    narrowed ? queries.listProducts({}) : null,
  ])
  // 좁히지 않았으면 첫 조회가 곧 전체다.
  const all = pool ?? items

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">ELS 목록</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {narrowed ? `${all.length}건 중 ${items.length}건` : `${items.length}건`}
          </p>
        </div>

        {/*
          `OwnerOnly`로 감싸지 않는다 — DOC-008 §5는 「`+ 등록` 버튼은 **항상**
          노출(본인 소유로 생성)」이라고 규정한다. 등록은 남의 데이터에 대한 조작이
          아니므로 ST-04의 대상이 아니다.
        */}
        <Link
          href={PATHS.productNew}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          + 등록
        </Link>
      </header>

      <ProductFilters filter={filter} owners={ownersOf(all)} />

      {items.length === 0 ? (
        <ListEmpty narrowed={narrowed} />
      ) : (
        <div className="lg:overflow-hidden lg:rounded-lg lg:border lg:border-neutral-200">
          {/*
            표 머리글은 데스크톱에서만 — 그 아래에서는 카드이고 각 값이 자기
            라벨을 들고 있다(`ProductRow`의 `lg:hidden` 라벨). 열 정의를 두 곳에
            적는 대신 같은 그리드 템플릿을 공유한다.
          */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
            <span>상품</span>
            <span className="text-right">투자원금 (원)</span>
            <span>다음 평가일</span>
            <span>워스트오브</span>
            <span>판정</span>
          </div>

          {/* 모바일 1열 → 태블릿 2열 → 데스크톱 표 (DOC-008 §8) */}
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-neutral-200">
            {items.map((item) => (
              <ProductRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * 빈 상태 **둘** — DOC-008 §6이 구분을 요구하고 ST-02가 다음 행동을 요구한다.
 *
 * `EmptyState`의 `action`이 필수 prop이므로 다음 행동 없는 빈 상태는 컴파일되지
 * 않는다. 그 타입이 여기서 실제로 두 개의 다른 행동을 강제한다 — 「조건에 맞는
 * 상품 없음」에 `+ 등록`을 붙이면 사용자는 필터가 걸린 것을 모른 채 상품을 하나 더
 * 만들고 그것도 목록에 나타나지 않는다.
 */
function ListEmpty({ narrowed }: { narrowed: boolean }) {
  if (narrowed) {
    return (
      <EmptyState
        title="조건에 맞는 상품이 없다"
        description="필터를 해제하면 전체 목록이 보인다."
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
 */
function ownersOf(items: readonly ProductListItem[]): OwnerOption[] {
  const byId = new Map<string, string>()
  for (const item of items) {
    if (!byId.has(item.ownerId)) byId.set(item.ownerId, item.ownerName)
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
