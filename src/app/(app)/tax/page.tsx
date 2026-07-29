import type { Metadata } from 'next'
import { unstable_rethrow } from 'next/navigation'

import { SaveProfileForm } from '@/components/tax/SaveProfileForm'
import {
  AppliedValues,
  TaxOverrideForm,
  TaxYearForm,
} from '@/components/tax/TaxProfileForms'
import {
  ContributingSection,
  HealthSection,
  IncomeSection,
  MarginalRateSection,
  TaxSection,
} from '@/components/tax/TaxSummarySections'
import { TaxSeedRangeError } from '@/lib/db/queries/load'
import type { TaxOverride, TaxSummaryView } from '@/lib/db/queries/tax'
import { getAsOf, getQueries, getViewerId } from '@/lib/db/server'
import { currentYear } from '@/lib/db/today'
import { HEALTH_INSURANCE_TYPE_LABELS, selectableYears } from '@/lib/format'
import { TAX_KEYS, parseTaxFilter, type QueryValues } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-401 세금 계산 — P4 컷 8 (DOC-008 §5, DOC-011 §4.6·§5.6)
 *
 * ## 조정과 저장이 두 폼이다 — 그것이 이 화면의 설계다
 *
 * DOC-008 §5는 「입력값 변경이 즉시 결과에 반영되어야 시뮬레이션 도구로 기능한다」고
 * 적었고 DOC-011 §4.6은 「값을 조정해봤을 뿐인데 저장되는」 문제를 막으라고 적었다.
 * 한 폼으로는 둘 중 하나가 깨진다.
 *
 * | 폼 | 방법 | 계약 |
 * |---|---|---|
 * | 연도 | `GET` | — (그 연도로 다시 조회) |
 * | 조정 | `GET` | `getTaxSummary({ override })` |
 * | 저장 | 서버 액션 | `saveTaxProfile` (§5.6) |
 *
 * **조정이 GET인 것이 보장의 형태다** — 그 폼에는 변경 계약으로 가는 경로가 없다.
 * 이 파일도 `saveTaxProfile`을 부르지 않으며, 부르는 곳은 어댑터 하나다
 * (`actions.ts`의 export가 하나라는 사실이 그 관측 가능한 형태다).
 *
 * ## `isSaved`의 두 원인을 여기서 가른다
 *
 * 계약의 `isSaved = false`는 「저장된 프로필 없음」과 「override 적용 중」을 한
 * 거짓으로 접는다(§4.6). 두 상태의 문구가 정반대인데, **가르는 값을 계약에 묻지
 * 않는다** — `override`를 넘긴 것이 이 파일이므로 그 사실이 여기 있다.
 *
 * ## 시드 범위 밖의 연도를 오류 화면으로 보내지 않는다
 *
 * 시드보다 과거인 연도는 계약이 던진다(ADR-005의 재현성). 오래된 링크나 손으로 고친
 * 주소가 **앱을 멈추면 안 되므로** SCR-202가 비-UUID id를 404로 바꾼 것과 같은
 * 판단으로 그 예외를 잡아 화면 안의 안내로 바꾼다 — 예외 객체가 `earliestSeeded`를
 * 들고 있어 「어느 연도부터 가능한지」를 말할 수 있고 그것이 다음 행동이 된다.
 *
 * 다른 예외는 다시 던진다. `unstable_rethrow`를 먼저 부르는 이유는 `notFound()`·
 * `redirect()`의 제어 흐름을 삼키면 빈 페이지가 렌더되기 때문이다(계획 §5의 규약).
 */

export const metadata: Metadata = {
  title: '세금 계산 · 언제들어오나',
}

/**
 * 조정 폼이 제시하는 가입 유형 집합. **라벨 표가 정본이다** —
 * `Record<HealthInsuranceType, string>`이므로 열거값이 늘면 선택지와 파서가 함께
 * 늘어난다(SCR-201이 `kiStatus`에 같은 형태를 쓴 이유이며 AQ-24의 재발 방지다).
 */
const HEALTH_TYPES = Object.keys(HEALTH_INSURANCE_TYPE_LABELS)

export default async function TaxPage({
  searchParams,
}: {
  // Next 16의 searchParams는 Promise다.
  searchParams: Promise<QueryValues>
}) {
  const filter = parseTaxFilter(await searchParams, HEALTH_TYPES)
  const [queries, viewerId] = await Promise.all([getQueries(), getViewerId()])
  const asOf = getAsOf()
  // 기준일의 연도가 기본값이다 — 화면이 `new Date()`를 부르지 않는다(Q-02).
  const year = filter.year ?? currentYear(asOf)

  let view: TaxSummaryView | null = null
  let outOfRange: TaxSeedRangeError | null = null
  try {
    view = await queries.getTaxSummary({
      // §4.6은 본인 전용이며 그 단언이 걸리게 하려고 인자를 남겼다 — 화면이
      // 자기 id를 넘긴다(`getViewerId`의 각주).
      ownerId: viewerId,
      year,
      // 계약의 `override`는 필드별 선택이므로 조정한 축만 넘긴다. 조정이 없으면
      // **키를 아예 두지 않는다** — `exactOptionalPropertyTypes`에서 `undefined`를
      // 넘기는 것과 키가 없는 것이 다르고, `isSaved`가 후자를 전제한다.
      ...(filter.override == null ? {} : { override: filter.override as TaxOverride }),
    })
  } catch (error) {
    unstable_rethrow(error)
    if (!(error instanceof TaxSeedRangeError)) throw error
    outOfRange = error
  }

  if (outOfRange != null) return <OutOfRange error={outOfRange} />

  const summary = view!
  const simulating = filter.override != null
  // 폴백이다 — 저장된 프로필이 없고 조정도 없다(§4.6의 두 원인 중 앞의 것).
  const notEntered = !summary.profile.isSaved && !simulating

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">세금 계산</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {summary.year}년 귀속 · 본인 기준
            {summary.taxLawYear !== summary.year && (
              // §4.6이 계약으로 요구하는 표시 — 그 연도의 세율이 아직 없다.
              <span className="ml-1 text-amber-800">
                (세율은 {summary.taxLawYear}년 기준 근사)
              </span>
            )}
          </p>
        </div>

        {/*
          연도 선택지의 산출은 **순수 모듈에 있다**(P4.5). 화면 안에 두면 어떤 스위트도
          보지 못하고(AQ-23), 실제로 그 동안 `?year=9999`가 `<option>` 7,974개를 렌더하는
          상태가 관측되지 않았다. 기준일 연도는 인자로 넘긴다 — 그 모듈이 `lib/db/today`를
          끌어오면 표시 계층이 조회 계층에 의존하게 된다.
        */}
        <TaxYearForm year={summary.year} years={selectableYears(summary, currentYear(asOf))} />
      </header>

      {/*
        상태 안내 둘이 서로 다른 것을 말한다(DOC-008 §5 v0.9의 표). 같은 문구로
        뭉치면 원인이 다른 상태에 같은 다음 행동을 제시하게 된다 — 셋째(가입 유형
        미입력)는 건강보험료 절 안에 있다.
      */}
      {simulating && (
        <div className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            <strong>시뮬레이션 중이다 — 저장되지 않았다.</strong> 아래 숫자는 조정된
            값으로 계산되었다.
          </p>
          <AppliedValues profile={summary.profile} />
        </div>
      )}

      {notEntered && (
        <div className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
          <p>
            <strong>{summary.year}년 과세 프로필이 저장되어 있지 않다.</strong> 아래는
            전부 미입력(0) 기준이므로, 금융소득 외 종합소득이 있으면{' '}
            <strong>세액이 실제보다 낮게 나온다</strong> — 종합과세 여부와 누진 구간이
            그 값에 달렸다.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">과세 프로필</h2>
        <TaxOverrideForm
          year={summary.year}
          profile={summary.profile}
          simulating={simulating}
        />
        <SaveProfileForm
          year={summary.year}
          profile={summary.profile}
          simulating={simulating}
        />
      </div>

      <IncomeSection view={summary} />
      <TaxSection view={summary} />
      <HealthSection view={summary} />
      <MarginalRateSection view={summary} />
      <ContributingSection view={summary} />

      {/* DOC-008 §5의 「표시 주의」 셋째 줄 — C-04 */}
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
        본 화면의 값은 참고용 추정이며 <strong>세무 신고 자료가 아니다.</strong> 실제
        신고는 증권사 지급명세서와 국세청 자료를 기준으로 한다.
      </p>
    </section>
  )
}

/**
 * 시드보다 과거인 연도 — 오류 화면이 아니라 안내다.
 *
 * DOC-008 §6은 이 화면의 에러를 「계산 실패」로 규정하지만 이 경우는 계산이 실패한
 * 것이 아니라 **그 연도를 계산하지 않기로 한 것**이다(ADR-005). 문구가 그 사실과
 * 다음 행동을 말한다.
 */
function OutOfRange({ error }: { error: TaxSeedRangeError }) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">세금 계산</h1>
        <p className="mt-1 text-sm text-neutral-600">{error.year}년</p>
      </header>

      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-neutral-300 px-4 py-6">
        <p className="text-sm">
          <strong>{error.year}년의 세율·요율이 없다.</strong> 세율은 연도별 데이터이며{' '}
          {error.earliestSeeded}년부터 등록되어 있다. 뒤 연도의 법으로 과거를 계산하면
          결과를 재현할 수 없으므로 근사하지 않는다.
        </p>
        {/*
          `<Link>`가 아니라 `<a>`다 — 같은 라우트의 질의만 바뀌므로 프리페치가
          의미 없고, 이 화면은 예외 경로라 클라이언트 캐시에 남을 이유도 없다.
        */}
        <a
          href={`${PATHS.tax}?${TAX_KEYS.year}=${error.earliestSeeded}`}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          {error.earliestSeeded}년으로 보기
        </a>
      </div>
    </section>
  )
}
