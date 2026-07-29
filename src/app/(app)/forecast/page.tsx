import type { Metadata } from 'next'

import { ForecastTable } from '@/components/forecast/ForecastTable'
import { EmptyState } from '@/components/state/EmptyState'
import { getQueries, getViewerId } from '@/lib/db/server'
import { isForecastEmpty } from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-402 다년도 전망 — P4b 컷 8 (DOC-008 §5, DOC-011 §4.7, DOC-007 §7.5)
 *
 * 자리표시를 대체한다. 이 화면이 P4가 아니라 P4b였던 이유는 마크업이 아니라 **계약이
 * 없었다**는 것이다 — RD-02와 DOC-007 §7.5가 선행 조건이었고 둘 다 컷 4에서 닫혔다.
 *
 * ## `searchParams`를 읽지 않는다 — 그것이 방어의 형태다
 *
 * 계약은 `years` 인자를 받고 기본이 6이다(AQ-08). 이 화면은 그 인자를 노출하지 않으므로
 * **`?years=9999` 벡터가 구조적으로 없다.** SCR-401의 연도 선택기가 상한 없이 주소의
 * 값을 받아 `<option>` 7,974개를 렌더한 자리가 그 반례이며, 여기서는 화면이 인자를
 * 노출하지 않는 것이 1차 방어이고 계약의 `FORECAST_MAX_YEARS`가 2차다 — 화면 하나의
 * 성질에 의존하지 않는다(§4.7).
 *
 * **적용 차수의 사용자 조정(`scenario`)은 P4c다** — DOC-008 §9 SQ-07. RD-02가 그 조정의
 * 형태(비영속 인자)를 정했으나 규칙(선택 가능한 차수 범위 · 경과한 차수 · 없는 차수)이
 * 열려 있다. 그 인자가 들어오는 날 이 화면이 `searchParams`를 읽게 되고 **그때 위 벡터가
 * 함께 열린다** — 상한이 이미 계약에 있는 것이 그 컷의 선행 조건을 하나 줄여 둔 것이다.
 *
 * ## 빈 상태 판정을 화면에서 하지 않는다
 *
 * 계약은 상품 0건에서도 `years`개 행을 반환한다(§4.7) — `[]`를 주면 상품 없이 ELS 외
 * 금융소득만 있는 사용자에게서 종합과세 여부와 보험료가 사라져 §8.1의 E 부류를
 * 재현하기 때문이다. 그래서 「전망할 데이터 없음」(DOC-008 §6)의 조건이 필요해지는데,
 * 그것을 여기 삼항으로 적으면 어떤 스위트도 보지 못한다(AQ-23). `isForecastEmpty`가
 * 그 판정이고 `tests/app/forecast.test.ts`가 그 관측 지점이다.
 */

export const metadata: Metadata = {
  title: '다년도 전망 · 언제들어오나',
}

export default async function ForecastPage() {
  const [queries, viewerId] = await Promise.all([getQueries(), getViewerId()])

  // §4.7은 본인 전용이며 그 단언이 걸리게 하려고 인자를 남겼다 — 화면이 자기 id를
  // 넘긴다(§4.6과 같은 규약이고 근거는 더 강하다: 여기는 여섯 연도가 전부 틀린다).
  const rows = await queries.getForecast({ ownerId: viewerId })
  const empty = isForecastEmpty(rows)

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">다년도 전망</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {rows[0]?.year}년부터 {rows.length}개 연도 · 본인 기준
        </p>
      </header>

      {empty ? (
        <EmptyState
          title="전망할 데이터가 없다"
          description="보유한 상품이 없고 신고할 금융소득도 없다. 상품을 등록하면 평가일정에서 회수 시점을 추정해 연도별 세금과 누적 자산을 계산한다."
          action={{ label: '상품 등록', href: PATHS.productNew }}
        />
      ) : (
        <>
          {/*
            DOC-008 §5 :525의 화면 전체 고지 — **표식의 두 축 중 화면 축이다**(§7.5).
            행 축(`hasEstimates`)과 갈라 두는 이유는 하나로 두면 행 표식의 정보량이 0이
            된다는 것이다: 미상환 상품이 하나라도 있으면 잔여 원금이 그 가정에 의존하므로
            **모든 행이 참**이 된다.
          */}
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>미상환 상품의 회수 시점은 추정이다.</strong> 다음 도래 평가일에
            조기상환된다고 가정하고 계산했으므로, 실제 상환이 뒤로 밀리면 그 원금과 세금이
            뒤 연도로 옮겨 간다.
          </p>

          <ForecastTable rows={rows} />

          <div className="flex flex-col gap-1 text-xs text-neutral-500">
            {/*
              **누적 자산이 건보료 차감 전이라는 것을 적는다.** 비준된 결정이며(§7.4가
              세액만 반영하므로 그 누계도 같은 기준이다) 「보험료 합계」가 옆 칸에 있으므로
              적지 않으면 같은 행의 두 숫자가 서로를 부정하는 것으로 보인다.
            */}
            <p>
              <strong>누적 자산은 건강보험료 차감 전이다.</strong> 보험료는 세액과 달리
              회수액에서 빠지는 값이 아니라 별 산식으로 부과되므로(DOC-007 §7.4·§6) 옆
              칸에 따로 적었다.
            </p>
            <p>
              <strong>누적 자산은 「총자산」이 아니다.</strong> 이 표의 첫 연도보다 앞서
              상환된 상품은 어느 항에도 들어가지 않으므로 전망 구간 안의 누적이다.
            </p>
            {/* DOC-001 A-06 — SCR-401의 「표시 주의」 둘째 줄과 같은 고지 */}
            <p>건강보험료는 개인 금융소득 기준 추정치이며 실제 부과액과 다를 수 있다.</p>
          </div>
        </>
      )}

      {/* DOC-008 §5 SCR-401의 「표시 주의」 셋째 줄과 같은 고지 — C-04 */}
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
        본 화면의 값은 참고용 추정이며 <strong>세무 신고 자료가 아니다.</strong> 실제
        신고는 증권사 지급명세서와 국세청 자료를 기준으로 한다.
      </p>
    </section>
  )
}
