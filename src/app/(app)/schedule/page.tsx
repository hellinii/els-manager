import type { Metadata } from 'next'

import type { OwnerOption } from '@/components/products/ProductFilters'
import { ProductScheduleList } from '@/components/schedule/ProductScheduleList'
import { ScheduleFilters } from '@/components/schedule/ScheduleFilters'
import { ScheduleRow } from '@/components/schedule/ScheduleRow'
import { ViewSwitch } from '@/components/schedule/ViewSwitch'
import { EmptyState } from '@/components/state/EmptyState'
import type { ScheduleItem } from '@/lib/db/queries/map'
import { getAsOf, getQueries, getViewerId } from '@/lib/db/server'
import { groupByMonth, korDate, splitByPast, type MonthGroup } from '@/lib/format'
import {
  isScheduleMineOnly,
  isScheduleNarrowed,
  OWNER_ALL,
  OWNER_MINE,
  parseScheduleFilter,
  parseScheduleView,
  scheduleQuery,
  toScheduleParams,
  type QueryValues,
  type ScheduleFilter,
  type ScheduleView,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-301 평가일정 — P4 컷 7 (DOC-008 §5, DOC-011 §4.4)
 *
 * ## 이 화면은 SCR-201의 구조를 그대로 쓴다
 *
 * 서버 폼 필터(`searchParams` + `<form method="GET">`), 좁힐 때만 두 번째 조회,
 * 소유자 선택지는 **좁히지 않은 목록**에서. 같은 근거가 그대로 성립하므로
 * (필터가 자기 선택지를 지우면 다른 소유자로 돌아갈 길이 없다) 여기서 다시 적지
 * 않는다 — `products/page.tsx`의 머리글이 그 판단의 정본이다.
 *
 * **다른 것은 셋이다.**
 *
 * | 무엇 | SCR-201 | SCR-301 |
 * |---|---|---|
 * | 행 단위 | 상품 | **차수** — 상품 수보다 빠르게 는다(§4.4가 루트를 차수로 둔 이유) |
 * | 순서 | 고를 수 있다(정렬 축) | 하나다 — 「시간 순으로 조망」 |
 * | 구조 | 평면 목록 | **두 절 × 월별 그룹** |
 *
 * ## 기간을 질의로 내리고 구획은 계약의 판정으로 나눈다
 *
 * `from`·`to`는 Q-05대로 질의 조건이다(§4.4: 「범위 조건을 조회 후로 미루면 Q-06의
 * 상한에 가장 먼저 닿는다」 — 행 단위가 차수다). 반면 **절 나누기는 `isPast`로**
 * 한다 — 계약의 `to`가 포함이고 당일은 경과가 아니므로 「지난 평가일」로 좁힌 질의에
 * 기준일 당일이 섞이는데, 그 한 줄을 날짜 계산으로 빼면 경계 판정이 계약과 화면 두
 * 곳에 생긴다. 질의는 **행 수를 줄이는 일만** 하고 판정은 계약이 준 값이 한다.
 *
 * ## 보기 축은 필터가 «아니다» (P6 컷 6)
 *
 * `view`는 `ScheduleFilter` 밖에 있고 `isScheduleNarrowed`가 세지 않는다. 세면
 * 아무 필터도 걸지 않은 화면이 「좁혀짐」이 되어 빈 상태가 둘째로 바뀌고 두 번째
 * 조회가 항상 돈다 — 아래 왕복 문단의 전제가 무너진다(`lib/forms/query.ts`의
 * `parseScheduleView` 머리글이 그 판단의 정본이다).
 *
 * **두 보기는 동시에 렌더되지 않는다.** 같은 계약·같은 필터·같은 순수 함수
 * (`splitByPast`)를 읽고 한 번에 하나만 나오며, 그 성질이 §9 SQ-02가 캘린더를
 * 버린 근거(「그 위에 얹히는 두 번째 목록」)를 이 보기가 피하는 방법이다. 실측
 * 근거도 있다 — `tests/e2e/schedule.test.ts`의 행 세기가 **페이지 전체의 `<li>`**를
 * 잡으므로 동시 렌더는 그 파일과 `home.test.ts`의 건수 단언을 전부 두 배로 만든다.
 *
 * ## 왕복
 *
 * ~~기본 화면은 좁히지 않으므로 조회 1회(= **3 왕복**: 차수 + 시세 + 세율 연도).
 * 필터가 걸리면 2회다.
 * 기본이 「전체 기간」인 것이 그 조건을 만든다 — 기본을 「다가오는」으로 두면 첫
 * 렌더부터 좁혀진 상태이므로 소유자 선택지를 위해 **항상** 두 번 불러야 한다.~~
 *
 * ★ **v2.6에서 그 조건이 무너졌다 — 소유자 축이 기간과 «같은» 일을 한다.** 기본이
 * 「전체 기간」인 것은 그대로지만 소유자 기본값이 **본인**이 되어 첫 렌더부터 좁혀진
 * 상태이고, 그래서 위 문단이 경고한 그 상태(「소유자 선택지를 위해 **항상** 두 번」)가
 * 정확히 발생한다. **경고문이 예측한 대로 깨졌으므로 지우지 않고 남긴다.** 조회는
 * 항상 2회이며 좁히지 않은 화면은 소유자 「전체」를 고른 경우뿐이다. 대가와 그것을
 * 받아들이는 근거는 DOC-008 §5 SCR-201 ★★ ⓐ에 있다.
 */

export const metadata: Metadata = {
  title: '평가일정 · 언제들어오나',
}

export default async function SchedulePage({
  searchParams,
}: {
  // Next 16의 searchParams는 Promise다.
  searchParams: Promise<QueryValues>
}) {
  const params = await searchParams
  const [queries, viewerId] = await Promise.all([getQueries(), getViewerId()])
  const filter = parseScheduleFilter(params, viewerId)
  const view = parseScheduleView(params)
  // 화면과 계약이 **같은 기준일**을 본다(Q-02) — 기간 조건이 여기서 나온다.
  const asOf = getAsOf()

  const narrowed = isScheduleNarrowed(filter)
  const [items, pool] = await Promise.all([
    queries.listSchedule(toScheduleParams(filter, asOf, viewerId)),
    narrowed ? queries.listSchedule({}) : null,
  ])
  // 좁히지 않았으면(= 소유자 「전체」 + 기본 기간) 첫 조회가 곧 전체다.
  const all = pool ?? items

  const { past, upcoming } = splitByPast(items)

  /*
   * ★ **셋째 빈 상태의 판정은 보기와 무관하다** (DOC-008 §6). 자리만 다르다 —
   * 시간순은 「다가오는 평가일」 절의 자리, 상품별은 카드 목록 위다. 문구도 게이트도
   * 같으므로 여기서 한 번 정한다. `null`이면 그 상태가 아니거나 사용자가 미래를
   * 빼기로 한 것이다(그때 「없다」고 말하면 필터가 결함으로 읽힌다).
   */
  const missingUpcoming =
    upcoming.length === 0 && filter.range !== 'PAST'
      ? '다가오는 평가일이 없다. 경과한 차수의 상환 처리 또는 이월을 확인한다.'
      : null

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">평가일정</h1>
          <p className="mt-1 text-sm text-neutral-600">
            기준일 {korDate(asOf)} ·{' '}
            {narrowed ? `${all.length}건 중 ${items.length}건` : `${items.length}건`}
          </p>
        </div>
        <ViewSwitch filter={filter} view={view} />
      </header>

      <ScheduleFilters filter={filter} owners={ownersOf(all, viewerId)} view={view} />

      {items.length === 0 ? (
        <ScheduleEmpty
          narrowed={narrowed}
          mineOnly={isScheduleMineOnly(filter)}
          view={view}
        />
      ) : view === 'PRODUCT' ? (
        <div className="flex flex-col gap-3">
          {/*
            셋째 빈 상태가 화면 단위로 뜨면 카드는 같은 말을 반복하지 않는다 —
            두 상태는 구조적으로 배타다(모든 상품이 그 상태이면 여기가 뜬다).
          */}
          {missingUpcoming != null && <MissingUpcoming note={missingUpcoming} />}
          <ProductScheduleList
            items={items}
            noteMissingUpcoming={missingUpcoming == null}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/*
            **절의 순서가 시간 순이다** — 지난 것이 위, 다가오는 것이 아래. 뒤집으면
            두 절의 경계에서 시간이 거꾸로 흐르고 「시간 순으로 조망」이 절 안에서만
            성립한다.

            빈 절은 렌더되지 않는다. 예외가 하나 있고 그것이 §6의 「예정 평가일 없음」
            이다 — 아래 `emptyNote`.
          */}
          <Section title="지난 평가일" groups={groupByMonth(past)} count={past.length} />
          <Section
            title="다가오는 평가일"
            groups={groupByMonth(upcoming)}
            count={upcoming.length}
            /*
             * ★ **셋째 빈 상태** (DOC-008 §6 「예정 평가일 없음」). 지난 차수는 있고
             * 다가오는 것이 없는 상태이며, 전 차수가 경과한 미상환 상품만 남았다는
             * 뜻이다(E-07 · DOC-007 §9.2). 그때 다음 행동은 등록도 필터 해제도 아니라
             * **상환 처리 또는 이월 확인**이므로 문구가 따로 있어야 한다.
             *
             * 기간을 「지난 평가일」로 좁힌 경우에는 이 절을 렌더하지 않는다 —
             * 사용자가 미래를 빼기로 했는데 「없다」고 말하면 필터가 결함으로 읽힌다.
             */
            emptyNote={missingUpcoming}
          />
        </div>
      )}
    </section>
  )
}

/**
 * 한 절 — 월별 그룹의 묶음.
 *
 * 표 머리글이 **절마다** 반복된다. 한 번만 두면 아래 절의 열 뜻을 위로 올라가
 * 확인해야 하고, 그것은 스크롤이 있는 화면에서 사라진 머리글과 같다.
 */
function Section({
  title,
  groups,
  count,
  emptyNote = null,
}: {
  title: string
  groups: ReadonlyArray<MonthGroup<ScheduleItem>>
  count: number
  /** 비었을 때 그 자리에 남길 안내. `null`이면 절 자체를 렌더하지 않는다 */
  emptyNote?: string | null
}) {
  if (count === 0) {
    if (emptyNote == null) return null
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
          {emptyNote}
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-neutral-900">
        {title} <span className="font-normal text-neutral-500">{count}건</span>
      </h2>

      <div className="lg:overflow-hidden lg:rounded-lg lg:border lg:border-neutral-200">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.5fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
          <span>평가일</span>
          <span>상품</span>
          <span>차수</span>
          <span>배리어 · 워스트오브</span>
          <span>예상 충족</span>
        </div>

        {groups.map((group) => (
          <div key={group.key}>
            {/*
              월 머리글 — `korMonth`가 만든다. 그룹 키와 라벨을 같은 순수 함수가
              함께 내므로 「같은 달인가」와 「어떻게 적는가」가 갈릴 수 없다.
            */}
            <h3 className="bg-neutral-50 px-1 py-1.5 text-xs font-medium text-neutral-600 lg:border-b lg:border-neutral-200 lg:px-4">
              {group.label}
              <span className="ml-1.5 font-normal text-neutral-400">
                {group.items.length}건
              </span>
            </h3>
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-neutral-200">
              {group.items.map((item) => (
                <ScheduleRow key={`${item.productId}-${item.roundNo}`} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 빈 상태 ~~**둘**~~ **셋** — 넷째는 절 안에 있다(위 `missingUpcoming`).
 *
 * 여기서 갈리는 것은 「아무 평가일정도 없다」·「내 것이 없다」·「조건에 맞는 것이
 * 없다」이며 SCR-201과 같은 구조다. 다음 행동이 다르므로 한 문구로 뭉칠 수 없다 —
 * 좁힌 쪽에 「상품 등록」을 붙이면 사용자는 필터가 걸린 것을 모른 채 상품을 하나 더
 * 만들고 그것도 목록에 나타나지 않는다.
 *
 * ## ★ 순서가 `mineOnly` → `narrowed`다 (v2.6)
 *
 * `products/page.tsx`의 `ListEmpty`와 **같은 이유·같은 순서**다: 뒤의 판정이 앞을
 * 포함하므로 뒤집으면 「내 평가일정이 없다」가 영원히 나타나지 않고, 그 상태가
 * 「필터 초기화」로 떨어지면 **초기화된 주소가 곧 본인 보기라 눌러도 같은 화면**이다.
 */
function ScheduleEmpty({
  narrowed,
  mineOnly,
  view,
}: {
  narrowed: boolean
  mineOnly: boolean
  /** 초기화 링크가 보기를 보존하므로 필요하다 — 필터 자체는 되돌릴 값이 상수다 */
  view: ScheduleView
}) {
  if (mineOnly) {
    return (
      <EmptyState
        title="내 평가일정이 없다"
        description="다른 사람의 일정까지 보려면 소유자를 「전체」로 바꾼다."
        /* 전체 보기로 가되 **보기는 보존한다** — 아래 초기화와 같은 규약이다 */
        action={{
          label: '전체 보기',
          href: `${PATHS.schedule}${scheduleQuery({ ...ALL_OWNERS_FILTER }, view)}`,
        }}
      />
    )
  }

  if (narrowed) {
    return (
      <EmptyState
        title="조건에 맞는 평가일이 없다"
        description="필터를 해제하면 내 일정이 보인다."
        /*
         * ★ 초기화가 **보기를 보존한다** — 필터를 되돌리는 것과 표현을 되돌리는
         * 것은 다른 일이고, 섞으면 시간순에서 잘못 좁힌 사용자가 말없이 상품별로
         * 던져진다. `ScheduleFilters`의 초기화 링크와 같은 규약이다.
         */
        action={{
          label: '필터 초기화',
          href: `${PATHS.schedule}${scheduleQuery(DEFAULT_FILTER, view)}`,
        }}
      />
    )
  }

  return (
    <EmptyState
      title="등록된 평가일정이 없다"
      /* 기본 보기가 상품별이므로 「시간 순으로 모인다」는 화면과 어긋난다(v2.2) */
      description="ELS를 등록하면 차수별 평가일과 예상 수령액이 여기에 모인다."
      action={{ label: '+ 등록', href: PATHS.productNew }}
    />
  )
}

/**
 * 「필터 초기화」가 되돌리는 지점 — 보기는 여기 없다.
 *
 * ★ **v2.6부터 이것은 「좁히지 않은」 필터가 아니다** — 소유자가 `MINE`이므로 여전히
 * 좁혀져 있다. 초기화의 뜻이 「전부 보기」가 아니라 **「기본값으로 되돌리기」**로
 * 바뀌었고, 그 기본값이 본인이다. 이름을 `NO_FILTER`에서 바꾼 이유가 그것이다 —
 * 종전 이름은 이제 거짓을 말한다.
 */
const DEFAULT_FILTER: ScheduleFilter = {
  owner: OWNER_MINE,
  range: 'ALL',
  activeOnly: false,
}

/** 소유자만 「전체」로 연 상태 — 둘째 빈 상태의 다음 행동이 가리키는 곳 */
const ALL_OWNERS_FILTER: ScheduleFilter = { ...DEFAULT_FILTER, owner: OWNER_ALL }

/**
 * 셋째 빈 상태를 **상품별 보기의 자리**에 낸다 — 문구는 시간순과 바이트 동일하다.
 *
 * 시간순은 「다가오는 평가일」 절이 실재하므로 그 자리에 남기고(`Section`의
 * `emptyNote`), 상품별에는 그 절이 없으므로 카드 목록 위에 온다. 한 상태에 두
 * 문구를 두면 사용자가 보기를 바꿀 때 **상태가 바뀐 것으로 읽는다**(DOC-008 §6).
 */
function MissingUpcoming({ note }: { note: string }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
      {note}
    </p>
  )
}

/**
 * 소유자 선택지 — **차수가 아니라 사람의 목록이다.**
 *
 * 같은 소유자가 차수마다 나오므로 접는다(SCR-201에서는 상품마다 나왔고 접는 이유는
 * 같다). `ownerId`·`ownerName` 둘 다 뷰가 담으므로(v1.8) 사용자 목록을 얻기 위한
 * 별 조회가 없다 — **그 둘 중 앞의 것이 이 컷에서 신설되었다.** 없으면 이름을
 * UUID로 되돌릴 방법이 없어 이 함수를 쓸 수 없다.
 *
 * ★ **보는 사람 자신은 빼고 낸다** (v2.6) — 근거는 `products/page.tsx`의 같은
 * 함수와 동일하다(기본 항목 「내 일정」과 같은 뜻의 항목이 둘이 된다).
 */
function ownersOf(
  items: readonly ScheduleItem[],
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
