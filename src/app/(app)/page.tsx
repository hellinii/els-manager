import type { Metadata } from 'next'

import {
  AttentionSection,
  RecentRedemptionsSection,
  TotalsSection,
  UpcomingSection,
  YearTaxSection,
} from '@/components/home/HomeSections'
import { ScopeSwitch } from '@/components/home/ScopeSwitch'
import { EmptyState } from '@/components/state/EmptyState'
import { getAsOf, getQueries } from '@/lib/db/server'
import { korDate } from '@/lib/format'
import { parseDashboardScope, type QueryValues } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-101 홈 · 대시보드 — P4 컷 9 (DOC-008 §5, DOC-011 §4.1)
 *
 * ## 상태 브리핑이다 — 탐색 허브가 아니다
 *
 * DOC-008 §5: 사용자가 스크롤이나 클릭 없이 세 가지를 알 수 있어야 한다 —
 * ① 곧 평가일이 오는 상품이 있는가 ② 올해 종합과세 대상인가 ③ 조치가 필요한 상품이
 * 있는가. 그래서 절의 순서가 그 세 물음을 앞에 두고, **⑤(최근 상환 실적)는 회고이므로
 * 마지막이며 표시 건수도 가장 짧다.**
 *
 * ## 계약이 넘긴 판단은 전부 `lib/format/dashboard.ts`에 있다
 *
 * §4.1은 기간 창을 두지 않는다 — 창을 계약에 박으면 창 밖의 상품이 화면에서 사라지고
 * 그 상수는 어느 문서에도 근거가 없다. 그래서 「임박」의 경계(30일)와 표시 건수(5·3)와
 * 조치 목록의 접기는 화면의 것이고, **순수 모듈에 두어 상시 스위트가 본다**(AQ-23 —
 * 이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수 없다).
 *
 * ## 한 화면에 주어가 둘이다
 *
 * `scope = 'ALL'`이어도 ③은 본인 기준이다(SQ-03 · D-02 · 절대 규칙 #7). 계약이 그렇게
 * 만들어져 있고(`computeOwnTax`가 `ctx.viewerId`로 거른다) 화면은 그 사실을 **제목으로
 * 말한다** — 「올해 금융소득(본인)」이 두 범위 모두에서 붙는다.
 *
 * ## 왕복
 *
 * 조회 1회다(= 4 왕복: 상품 · 세율 연도 · 본인 프로필 · 시세). SCR-201·301처럼 두 번
 * 부르지 않는다 — 범위 축의 선택지가 열거값 둘이므로 **좁히지 않은 조회에서 뽑을
 * 것이 없다**(그쪽은 소유자 선택지를 얻기 위해 전체를 한 번 더 읽어야 했다).
 */

export const metadata: Metadata = {
  title: '홈 · 언제들어오나',
}

export default async function HomePage({
  searchParams,
}: {
  // Next 16의 searchParams는 Promise다.
  searchParams: Promise<QueryValues>
}) {
  const scope = parseDashboardScope(await searchParams)
  const queries = await getQueries()
  // 화면과 계약이 **같은 기준일**을 본다(Q-02). 여기서는 표시용이다.
  const asOf = getAsOf()

  const view = await queries.getDashboard({ scope })

  /*
   * 상품이 아예 없는 상태 — `activeCount`와 상환 목록이 **행을 정확히 분할한다**
   * (`activeRows`는 상환 레코드가 없는 것, `redeemedRows`는 있는 것이므로 둘의 합이
   * 그 범위의 전체다). 그래서 둘이 비면 그 범위에 상품이 없다는 뜻이고, 다른 셋을
   * 함께 볼 필요가 없다 — 조치 목록이 비었다는 것은 상품이 없다는 뜻이 아니다.
   */
  const noProducts =
    view.totals.activeCount === 0 && view.recentRedemptions.length === 0

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">홈</h1>
          <p className="mt-1 text-sm text-neutral-600">기준일 {korDate(asOf)}</p>
        </div>

        <ScopeSwitch scope={scope} />
      </header>

      {noProducts ? (
        <HomeEmpty scope={scope} />
      ) : (
        <>
          {/* 세 물음의 순서 — ① 평가일 ③ 종합과세 ④ 조치 */}
          <UpcomingSection items={view.upcomingEvaluations} scope={scope} />
          <TotalsSection totals={view.totals} scope={scope} />
          <YearTaxSection tax={view.currentYearTax} />
          <AttentionSection items={view.attentionItems} scope={scope} />
          <RecentRedemptionsSection items={view.recentRedemptions} scope={scope} />
        </>
      )}
    </section>
  )
}

/**
 * 빈 상태 **둘** — 범위가 가른다 (DOC-008 §6 각주, P4 컷 9)
 *
 * 기본 범위가 본인이므로(SQ-03) 이 화면은 **처음부터 좁혀진 상태**다. 한 문구로 두면
 * 「본인 것만 없음」에 「등록된 상품이 없다」고 말하게 되고, 그것은 SCR-201이 필터에
 * 대해 거부한 형태다(사용자는 좁혀진 것을 모른 채 상품을 하나 더 만든다).
 *
 * **좁혀져 있다는 사실은 이 문구가 아니라 `ScopeSwitch`가 말한다** — 그 컨트롤이 항상
 * 머리글에 렌더되므로 여기서 「전체 보기」를 다음 행동으로 또 제시하지 않는다.
 * `EmptyState.action`이 하나인 것과 맞물려, 다음 행동은 두 경우 모두 등록이다.
 */
function HomeEmpty({ scope }: { scope: 'MINE' | 'ALL' }) {
  if (scope === 'MINE') {
    return (
      <EmptyState
        title="내 상품이 없다"
        description="위에서 「전체」로 바꾸면 다른 사용자의 상품이 보인다. 내 ELS를 등록하면 평가일정·조건 판정·세금 계산이 함께 채워진다."
        action={{ label: '+ 등록', href: PATHS.productNew }}
      />
    )
  }

  return (
    <EmptyState
      title="등록된 상품이 없다"
      description="ELS를 등록하면 임박 평가일·조치 목록·올해 금융소득이 여기에 모인다."
      action={{ label: '+ 등록', href: PATHS.productNew }}
    />
  )
}
