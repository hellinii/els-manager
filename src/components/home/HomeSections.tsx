import Link from 'next/link'
import { Fragment } from 'react'

import { Badge, GRADE_ACCENT } from '@/components/display/Badge'
import { ExchangeRateMissingNotice } from '@/components/display/ExchangeRateMissingNotice'
import { ProductNameLink } from '@/components/display/ProductNameLink'
import { OwnerOnly } from '@/components/state/OwnerOnly'
import type { DashboardView } from '@/lib/db/queries/dashboard'
import {
  ATTENTION_REASON_GRADES,
  ATTENTION_REASON_LABELS,
  EVALUATION_VERDICT_GRADES,
  EVALUATION_VERDICT_LABELS,
  attentionChipLabel,
  MONTHLY_COUPON_ESTIMATE_NOTE,
  RECENT_VISIBLE,
  REDEMPTION_TYPE_LABELS,
  SECTION_EMPTY,
  UPCOMING_VISIBLE,
  amount,
  barrierGap,
  convertedIncludedLine,
  dDayLabel,
  evaluationVerdictSentence,
  groupAttention,
  heaviestGrade,
  koreanWon,
  krwEstimateLine,
  missingUpcomingNote,
  money,
  percent,
  signedMoney,
  takeVisible,
  won,
  ymd,
} from '@/lib/format'
import { FILTER_KEYS, type DashboardScope } from '@/lib/forms/query'
import { PATHS, REDEEM_ROUND } from '@/lib/routes/paths'

/**
 * SCR-101의 여섯 요소 — DOC-008 §5 (P4 컷 9 · ⑥은 P6 컷 7-4)
 *
 * ⑥ 상환 확인 필요(맨 위) · ① 다가오는 평가일 · ② 총 자산 요약 · ③ 올해 금융소득 · ④ 주의 상태 상품 ·
 * ⑤ 최근 상환 실적. 범위 전환은 폼이 아니라 링크이므로 `ScopeSwitch`에 있다.
 *
 * ## 절 빈 상태는 한 줄이다 (홈 피드백 컷 K4 · 피드백 #10)
 *
 * ① ④ ⑤가 비면 절 제목(h2)은 남고 그 아래 `SECTION_EMPTY`의 한 줄이다 — 점선 상자가 빈 절에 자리를 줬다. h2를
 * 남기는 것은 「그 물음에 답이 없다」도 답이기 때문이다(⑥은 알림이라 0건이면 통째로 그리지 않는다).
 *
 * ## 이 파일이 정하지 않는 것 둘
 *
 * **판정의 우선순위**와 **조치 사유의 순서**다. 앞은 `deriveDisplay()`가(§4.2), 뒤는
 * 계약이(§4.1의 「결함 우선」) 정하며 여기는 그 순서를 그대로 렌더한다. 다섯 화면 중
 * 하나가 순서를 다시 정하는 날 그 화면만 조용히 틀리는 것이 §4.2 우선순위표가
 * 존재하는 이유이고, 조치 목록에서 같은 함정이 재발하지 않게 한다.
 *
 * ## 자름은 전부 `takeVisible`을 지난다
 *
 * 계약이 기간 창을 두지 않으므로(§4.1) 자르는 것은 화면이다. 자름에 신호가 없으면
 * 6번째 항목이 어떤 방법으로도 보이지 않는데 화면에 그 사실이 없다 — AQ-22가 등재한
 * 형태이며, 그래서 두 목록 모두 「총 N건 중 …」과 전체를 보는 링크를 함께 낸다.
 */

// ---------------------------------------------------------------------------
// ⑥ 상환 확인 필요 — 맨 위 (P6 컷 7-4)
// ---------------------------------------------------------------------------

/**
 * ⑥ — **평가일이 지난 뒤 「그날 종가로 보니 상환 조건을 충족했다」를 다음 접속 때 알린다** (DOC-008 SCR-101 「P6 컷 7-0」 각주).
 *
 * - **0건이면 그리지 않는다** — 알림이다. ④처럼 늘 서서 「있는가」에 답하는 절이 아니다
 * - **자르지 않는다** — 상품당 최대 1건이고 다음 평가일이 지나면 사라진다. 순서는 계약 그대로(평가일 · 상품명)
 * - **[상환 처리]는 소유자에게만**(ST-04 · D1) — 남의 상품은 이름과 사실만. 판정 넷 모두에 단다(종가 없음이어도 증권사에서
 *   확인한 사용자가 기록하러 갈 수 있어야 한다). **「시세 입력」은 모두에게** — 종가 없음이고 주말이 아닐 때만(시세는 공용
 *   데이터 · 주말 날짜의 종가는 「관측하지 않은 관측」 — DOC-010 AQ-100)
 * - 안내 문장은 상세(SCR-202)와 같은 함수다. 지급방식은 계약에 없으므로 `null` — V-29 문장은 SCR-203이 말한다
 * - **카드는 등급 색을 바탕에 깔지 않는다** *(홈 피드백 컷 K3 · 민서 결정(2026-10-12) D1)* — 흰 바탕에 왼쪽 띠만 배지
 *   등급의 색이다(`GRADE_ACCENT` — 충족 · 만기는 `record` 파랑, 종가 없음은 `caution` 앰버). D+n은 줄의 글자색을
 *   물려받는다(중립). 종전의 빨강 바탕 · 빨강 D+n은 조건 충족을 경고로 읽게 했다(피드백 #1). 옅은 파랑 바탕도 깔지
 *   않는다 — 그 위의 neutral-500 글자가 4.36:1이다(DOC-008 §6 ST-08)
 */
export function RedemptionCheckSection({
  items,
  scope,
}: {
  items: DashboardView['redemptionChecks']
  scope: DashboardScope
}) {
  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-2" aria-label="상환 확인 필요">
      <h2 className="text-sm font-semibold">
        상환 확인 필요 <span className="font-normal text-neutral-500">{items.length}건</span>
      </h2>
      <p className="text-xs text-neutral-600">
        평가일 종가로 판정한 추정이다. 상환을 기록하거나 다음 평가일이 지나면 사라진다. 판정이 이월이면 올리지 않는다.
      </p>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {items.map((item) => (
          <li
            key={item.productId}
            className={`flex flex-col gap-1.5 border-l-4 px-4 py-3 ${GRADE_ACCENT[EVALUATION_VERDICT_GRADES[item.kind]]}`}
          >
            <span className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <ProductNameLink productId={item.productId} name={item.productName} />
                <span className="flex flex-wrap items-baseline gap-1.5 text-xs text-neutral-600">
                  {/* 한 텍스트 노드로 만든다 — `{roundNo}차`는 `1<!-- -->차`로 갈린다(아래 ③ 머리의 같은 부류 각주) */}
                  <span className="tabular-nums">{`${item.roundNo}차 · ${ymd(item.evaluationDate)}`}</span>
                  <span className="tabular-nums">{dDayLabel(item.dDay)}</span>
                  {scope === 'ALL' && <span className="truncate">{item.ownerName}</span>}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-2">
                <Badge grade={EVALUATION_VERDICT_GRADES[item.kind]}>{EVALUATION_VERDICT_LABELS[item.kind]}</Badge>
                {item.worstOf != null && item.barrier != null && (
                  <span className="text-xs tabular-nums text-neutral-600">
                    {`평가일 워스트오브 ${percent(item.worstOf)} · 배리어 ${percent(item.barrier)}`}
                  </span>
                )}
                {item.kind === 'CLOSE_MISSING' && !item.weekendEvaluation && (
                  <Link href={PATHS.prices} className="text-xs font-medium underline">
                    시세 입력
                  </Link>
                )}
                <OwnerOnly isOwner={item.isOwner}>
                  <Link
                    href={REDEEM_ROUND.href(item.productId, item.roundNo)}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                  >
                    상환 처리
                  </Link>
                </OwnerOnly>
              </span>
            </span>
            <p className="text-xs text-neutral-700">{evaluationVerdictSentence(item, null)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ① 다가오는 평가일
// ---------------------------------------------------------------------------

/**
 * ① — **행마다 D-Day가 있고 그 위에 표식을 덧붙이지 않는다** *(홈 피드백 컷 K4 · 민서 결정(2026-10-12) D2)*.
 *
 * ~~경계(30일) 안이면 「임박」을 덧붙였다~~ — 모든 행이 D-Day를 적으므로 표식이 행마다 같은 말을 했고(피드백 #3),
 * 계약에 창이 없어 그 경계는 강조만 정했다. 늘 켜진 강조는 정보가 0이다(DOC-008 SQ-18).
 *
 * `redemptionCheckCount`는 빈 줄의 뒷절이 가리킬 ⑥이 실재하는지다(DOC-008 SQ-28 — `missingUpcomingNote`).
 *
 * ## 데스크톱은 고정 열, 그보다 좁으면 카드다 *(홈 피드백 컷 K5 · 피드백 #8 · #9 — DOC-008 SCR-101 「홈 피드백 컷 K0」 ①)*
 *
 * 마크업은 하나이고 값은 한 번만 렌더한다 — 모바일 카드의 묶음(ⓐ ⓒ)이 `lg`에서 `contents`로 상자를 잃어 그 자식이
 * 열 일곱에 «펼쳐진다»(SCR-301 상품별 카드의 금액 칸 선례). 카드는 「평가일 · D-Day | 판정」 / 상품명 / 차수 / 수치 셋이다.
 *
 * - **판정이 없는 행도 칸을 잃지 않는다** — 워스트오브 · 여유폭 자리에 「—」(장식 — 판정 칸의 「판정 없음」이 뜻을
 *   나른다)를 둔다. 칸을 빼면 그 행의 판정 칸이 왼쪽으로 밀려 열이 무너진다
 * - **차수는 상품명과 다른 줄이다** — 회차(「…2047회」)와 차수(「1차」)가 나란히 오면 같은 「n번째」로 읽힌다(DOC-005 §8.3)
 */
export function UpcomingSection({
  items,
  scope,
  redemptionCheckCount,
}: {
  items: DashboardView['upcomingEvaluations']
  scope: DashboardScope
  /** ⑥ 「상환 확인 필요」의 항목 수 — 0이면 ⑥이 그려지지 않는다 */
  redemptionCheckCount: number
}) {
  const visible = takeVisible(items, UPCOMING_VISIBLE)

  return (
    <section className="flex flex-col gap-2">
      <SectionHead
        title="다가오는 평가일"
        visible={visible}
        moreLabel="전체 일정"
        moreHref={PATHS.schedule}
      />

      {visible.total === 0 ? (
        /*
         * **이 표의 빈 상태가 아니다**(DOC-008 §6 각주). 상품은 있는데 미상환
         * 상품의 다음 평가일이 하나도 없는 상태이며, 전 차수가 경과했거나
         * (E-07 · DOC-007 §9.2) 전부 상환완료라는 뜻이다. 그때 다음 행동은 등록이
         * 아니라 **상환 처리**이므로(P6 컷 7-4 — 무엇을 물을지는 ⑥의 평가일 판정이 정하고 이월이면 묻지 않는다) SCR-301의 셋째 빈 상태와 같은
         * 문구 부류다(DOC-010 AQ-34가 둘을 함께 다룬다). 글자는 그 둘이 한 함수다(`missingUpcomingNote` — 홈 피드백 컷 K4).
         */
        <p className="text-sm text-neutral-600">{missingUpcomingNote('HOME', redemptionCheckCount)}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          {/* 열 머리 — 데스크톱에만. `<ul>` 밖이라 줄로 세지 않는다. 숫자 칸의 머리는 값과 같이 오른쪽에 붙는다 */}
          <div
            className={`hidden ${UPCOMING_COLS} gap-x-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-600 lg:grid`}
          >
            <span>{UPCOMING_HEAD.date}</span>
            <span className="text-right">{UPCOMING_HEAD.dDay}</span>
            <span>{UPCOMING_HEAD.product}</span>
            <span className="text-right">{UPCOMING_HEAD.barrier}</span>
            <span className="text-right">{UPCOMING_HEAD.worstOf}</span>
            <span className="text-right">{UPCOMING_HEAD.gap}</span>
            <span className="text-right">{UPCOMING_HEAD.verdict}</span>
          </div>

          <ul className="divide-y divide-neutral-200">
            {visible.shown.map((item) => (
              <li
                key={`${item.productId}-${item.roundNo}`}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 lg:items-center ${UPCOMING_COLS}`}
              >
                {/* ⓐ 평가일 · D-Day — 카드의 첫 줄 왼쪽 */}
                <div className="col-start-1 row-start-1 flex items-baseline gap-2 lg:contents">
                  <span className="text-sm tabular-nums">{ymd(item.evaluationDate)}</span>
                  <span className="text-xs tabular-nums text-neutral-600 lg:text-right">{dDayLabel(item.dDay)}</span>
                </div>

                {/* ⓑ 상품명 · 차수 — 한 칸 두 줄. §7.2 — 「SCR-101 홈 ─[평가일 알림]→ SCR-202 상세」 */}
                <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.5 lg:col-span-1 lg:row-start-auto">
                  <ProductNameLink productId={item.productId} name={item.productName} />
                  <span className="flex flex-wrap items-baseline gap-1.5 text-xs text-neutral-600">
                    {/* 한 텍스트 노드로 만든다 — `{roundNo}차`는 `1<!-- -->차`로 갈린다(아래 ③ 머리의 같은 부류 각주) */}
                    <span className="tabular-nums">{`${item.roundNo}차`}</span>
                    {/*
                      범위가 전체일 때만 소유자를 적는다. 본인 보기에서는 전 행이
                      같은 값이므로 그 표시가 아무것도 구분하지 않는다(`ProductRow`가
                      「보유중」 뱃지를 달지 않는 것과 같은 판단).
                    */}
                    {scope === 'ALL' && <span className="truncate">{item.ownerName}</span>}
                  </span>
                </div>

                {/* ⓒ 수치 셋 — 카드의 마지막 줄. 모바일 라벨은 열 머리와 같은 문자열이다 */}
                <div className="col-span-2 row-start-3 flex flex-wrap items-baseline gap-x-3 text-xs lg:contents">
                  <span className="tabular-nums text-neutral-600 lg:text-right">
                    <span className="lg:hidden">{UPCOMING_HEAD.barrier} </span>
                    {percent(item.barrier)}
                  </span>
                  {item.worstOf == null ? (
                    <>
                      <span aria-hidden="true" className="hidden text-neutral-500 lg:block lg:text-right">
                        —
                      </span>
                      <span aria-hidden="true" className="hidden text-neutral-500 lg:block lg:text-right">
                        —
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums text-neutral-700 lg:text-right">
                        <span className="text-neutral-600 lg:hidden">{UPCOMING_HEAD.worstOf} </span>
                        {percent(item.worstOf)}
                      </span>
                      <span className="tabular-nums text-neutral-600 lg:text-right">
                        <span className="lg:hidden">{UPCOMING_HEAD.gap} </span>
                        {barrierGap(item.worstOf, item.barrier)}
                      </span>
                    </>
                  )}
                </div>

                {/*
                  ⓓ 판정 — 카드의 첫 줄 오른쪽. **`null`은 「미충족」이 아니다**(§4.1): 판정 결과가 없으면(시세 없음 ·
                  무결성 결함) 충족 여부를 말하지 않는다. `false`로 두면 「미충족」이라는 판정을 한 것이 되어 E-01과
                  구분되지 않으므로, 계약이 세 값을 주는 것을 화면도 세 갈래로 받는다. 칸은 어느 갈래에서도 비지 않는다.
                */}
                <div className="col-start-2 row-start-1 justify-self-end text-xs lg:col-start-auto lg:row-start-auto">
                  {item.worstOf == null ? (
                    // 이 목록은 판정 불가의 **원인**을 담지 않는다(뷰에 `integrityIssue`가 없다).
                    // 원인별 안내는 SCR-201·202의 일이므로 여기서 지어내지 않는다.
                    // 정보 글자다 — neutral-600(흰 바탕 7.81:1 · DOC-008 ST-08 · 홈 피드백 컷 K2).
                    <span className="text-neutral-600">판정 없음</span>
                  ) : item.willMeet == null ? (
                    // 워스트오브는 있는데 조건 판정이 없다(차수 입력의 결함 등) — 말하지 않되 칸은 남긴다(장식)
                    <span aria-hidden="true" className="text-neutral-500">
                      —
                    </span>
                  ) : (
                    <Badge grade={item.willMeet ? 'positive' : 'caution'}>
                      {item.willMeet ? '예상 충족' : '예상 미충족'}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * ① 열 템플릿 — **완전한 리터럴이어야 한다**(Tailwind v4는 소스 텍스트를 스캔하므로 조립한 클래스를 만들지 않는다 —
 * SCR-301 `ProductScheduleCard`의 `ROUND_COLS` 선례).
 *
 * 평가일 · D-Day · 상품명과 차수(한 칸) · 배리어 · 워스트오브 · 여유폭 · 판정. 상품명 칸만 늘고 줄며 나머지는 고정폭이라
 * 행끼리 열이 맞는다. 판정 칸 7rem은 가장 긴 배지(여유폭 단계의 근소 — 홈 피드백 컷 K6)의 자리다.
 *
 * 중단점은 `lg`다(DOC-008 §8의 1024~ 테이블). 고정폭 합이 29rem + 간격 여섯(4.5rem)이라 상품명 칸은 `max-w-5xl` 안에서
 * `sm`(640) 약 38px · `md`(768) 약 166px · `lg`(1024) 약 422px다.
 */
const UPCOMING_COLS = 'lg:grid-cols-[6rem_3.5rem_minmax(0,1fr)_3.5rem_4.5rem_4.5rem_7rem]'

/**
 * ① 열 머리 — 모바일 카드의 수치 라벨과 **같은 문자열**이다(폭과 무관하게 라벨이 값을 따라다닌다 — SCR-301 상품별 카드의
 * 「예상」 규율과 같은 기전). 「배리어」는 종전 판정 칸의 라벨을 옮긴 한 자리다(DOC-005 GQ-14 — 자리가 늘지 않는다).
 */
const UPCOMING_HEAD = {
  date: '평가일',
  dDay: 'D-Day',
  product: '상품 · 차수',
  barrier: '배리어',
  worstOf: '워스트오브',
  gap: '여유폭',
  verdict: '판정',
} as const

// ---------------------------------------------------------------------------
// ② 총 자산 요약
// ---------------------------------------------------------------------------

/**
 * ② — **실현손익은 음수가 가능하다**(§4.1). 그것이 과세 금융소득과 갈리는 지점이며
 * (절대 규칙 #8) 부호를 붙여 표시한다(`signedMoney` — 원화는 `signedWon`과 같다).
 */
export function TotalsSection({
  totals,
  scope,
}: {
  totals: DashboardView['totals']
  scope: DashboardScope
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        총 자산 요약{' '}
        <span className="font-normal text-neutral-500">
          {scope === 'MINE' ? '본인' : '전체'}
        </span>
      </h2>

      <dl className="grid gap-3 rounded-lg border border-neutral-200 px-4 py-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-neutral-500">보유 상품</dt>
          <dd className="text-base font-semibold tabular-nums">
            {totals.activeCount}건
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">투자원금 (보유중)</dt>
          <dd className="text-base font-semibold tabular-nums">
            {totals.byCurrency.map((row, index) => (
              <Fragment key={row.currency}>
                {index > 0 && ' · '}
                {row.currency === 'KRW' ? (
                  <>
                    {amount(row.activePrincipal)}원
                    {koreanWon(row.activePrincipal) !== '0원' && (
                      <span className="ml-1.5 text-xs font-normal text-neutral-500">
                        ({koreanWon(row.activePrincipal)})
                      </span>
                    )}
                  </>
                ) : (
                  money(row.activePrincipal, row.currency)
                )}
              </Fragment>
            ))}
          </dd>
          {/*
            원화 환산 합계 — **추정이며 사실 옆에 따로 선다**(DOC-011 §4.1 · DOC-008 SCR-101 ② a3). 보유중 외화가
            없으면(원화뿐) `krwEstimate`가 `null`이라 이 줄이 없다 — 원화 홈의 마크업이 바뀌지 않는다. 환율이 없으면
            두 필드가 함께 빈다(부분합 없음) — 줄을 생략하고 ST-07도 여기서는 띄우지 않는다(③이 말한다).
          */}
          {totals.krwEstimate?.activePrincipal != null &&
            totals.krwEstimate.exchangeRateBasis != null && (
              <p className="mt-0.5 text-xs text-neutral-500">
                {krwEstimateLine(
                  totals.krwEstimate.activePrincipal,
                  totals.krwEstimate.exchangeRateBasis,
                )}
              </p>
            )}
        </div>
        <div>
          <dt className="text-xs text-neutral-500">실현손익 (누적)</dt>
          {/*
            음수 색은 **통화별 값마다** 정한다 — 한 칸에 부호가 다른 둘이 올 수 있다. 한 행이면
            종전처럼 `<dd>`가 색을 갖는다(원화뿐인 홈의 마크업이 바뀌지 않는다).
          */}
          {totals.byCurrency.length === 1 ? (
            <dd
              className={`text-base font-semibold tabular-nums ${pnlColor(
                totals.byCurrency[0]!.realizedPnl,
              )}`}
            >
              {signedMoney(totals.byCurrency[0]!.realizedPnl, totals.byCurrency[0]!.currency)}
            </dd>
          ) : (
            <dd className="text-base font-semibold tabular-nums">
              {totals.byCurrency.map((row, index) => (
                <Fragment key={row.currency}>
                  {index > 0 && ' · '}
                  <span className={pnlColor(row.realizedPnl)}>
                    {signedMoney(row.realizedPnl, row.currency)}
                  </span>
                </Fragment>
              ))}
            </dd>
          )}
          {/*
            받은 월수익 — 보유중 월지급 상품이 이미 받은 월수익(DOC-008 SCR-101 ② · 민서 결정(2026-10-02) ②). **실현손익에
            넣지 않는다** — 만기에 KI 손실이 나면 원금 손실과 합쳐야 손익이 확정된다. 통화별 · 환산하지 않는다. 그 통화에
            받은 월수익이 없으면(상환 시 지급뿐) 줄이 없다 — 원화 · 상환 시 지급뿐인 홈의 마크업이 바뀌지 않는다
          */}
          {totals.byCurrency
            .filter((row) => row.receivedCoupons !== '0' && row.receivedCoupons !== '0.00')
            .map((row) => (
              <p key={row.currency} className="mt-0.5 text-xs text-neutral-500">
                받은 월수익 {signedMoney(row.receivedCoupons, row.currency)}
              </p>
            ))}
        </div>
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ③ 올해 금융소득 및 종합과세 여부
// ---------------------------------------------------------------------------

/**
 * ③ — **범위와 무관하게 본인 기준이다** (SQ-03 · D-02 · 절대 규칙 #7).
 *
 * `scope = 'ALL'`이어도 세금은 합산하지 않으므로 전체 보기는 **상단이 전원이고
 * 세금이 본인인 화면**이 된다. 제목이 그 사실을 말하지 않으면 사용자는 전체 보기의
 * 금융소득을 가족 합계로 읽는다 — 그래서 「(본인)」이 두 범위 모두에서 붙는다.
 */
export function YearTaxSection({ tax }: { tax: DashboardView['currentYearTax'] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/*
          **「(본인)」을 별 태그로 감싸지 않는다.** DOC-008 §5(SQ-03)가 요구하는 것은
          「올해 금융소득(본인)」이라는 **한 문구**이고, 태그를 끼우면 렌더된 문서에서
          그 문자열이 끊긴다 — 사용자가 보는 것과 문서에 있는 것이 달라지므로 그
          요구를 확인할 방법이 사라진다(실측으로 걸렸다). 같은 부류의 함정을
          `{item.roundNo}차` → `1<!-- -->차`가 컷 7에서 드러냈다.
        */}
        <h2 className="text-sm font-semibold">
          올해 금융소득(본인){' '}
          <span className="font-normal text-neutral-500">{tax.year}년 귀속</span>
        </h2>
        <Link href={PATHS.tax} className="text-xs text-neutral-600 underline">
          세금 계산
        </Link>
      </div>

      <div
        className={`flex flex-col gap-2 rounded-lg px-4 py-3 ${
          tax.isComprehensive ? 'bg-amber-50' : 'border border-neutral-200'
        }`}
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-neutral-500">금융소득 합계</dt>
            <dd className="text-base font-semibold tabular-nums">
              {won(tax.financialIncome)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">추가납부 (추정)</dt>
            <dd className="text-base font-semibold tabular-nums">
              {won(tax.additionalTax)}
            </dd>
          </div>
        </dl>

        <p className={`text-sm ${tax.isComprehensive ? 'text-amber-900' : 'text-neutral-700'}`}>
          {tax.isComprehensive ? (
            <>
              <strong>종합과세 대상이다.</strong> 다른 종합소득과 합산해 누진세율이
              적용된다 — 상세는 세금 계산 화면에서 본다.
            </>
          ) : (
            <>
              <strong>분리과세로 종결된다.</strong> 원천징수로 납세 의무가 끝난다.
            </>
          )}
        </p>

        {/*
          미상환 상품의 기여는 적용 차수의 **추정**이다(RD-02 · §4.6). 적지 않으면
          확정된 세액으로 읽힌다 — ST-05가 요구하는 구분이며, 이 절은 숫자가 둘뿐이라
          뱃지 대신 한 줄로 적는다.
        */}
        <p className="text-xs text-neutral-500">
          미상환 상품은 적용 차수(다음 도래 평가일)에 상환된다고 가정한 추정이며,
          과세 프로필을 저장하지 않았으면 금융소득 외 소득이 0으로 계산된다.
          {/*
            월지급 가정 (P8 컷 b4 — DOC-008 SQ-21 ⓚ (c)) — 올해 F에 추정 월수익 사건이 있을 때만(계약의
            `currentYearTax.monthlyCouponAssumption`). 문장은 SCR-401 · SCR-502와 같은 상수다
          */}
          {tax.monthlyCouponAssumption && <> {MONTHLY_COUPON_ESTIMATE_NOTE}.</>}
        </p>

        {/*
          ST-07 — 빠진 몫이 있으면 합계와 판정은 **하한**이다. 기본 환율로 채워 판정을
          «완성»하지 않는다(DOC-011 §4.6). 건수는 계약이 센다 — 화면이 세면 무엇이 추정이
          필요한 건인가(E-09)를 계약 밖에서 다시 판정하게 된다.
        */}
        {/*
          환산을 했으면 그 사실과 환율을 적는다(DOC-008 SCR-101 ③ a3). n은 계약의 `convertedCount`다 — 화면이 세지
          않는다. 올해 귀속 달러 건이 전부 확정이거나 비과세면 0이라 줄이 없다.
        */}
        {tax.convertedCount > 0 && tax.exchangeRateBasis != null && (
          <p className="text-xs text-neutral-500">
            {convertedIncludedLine(tax.convertedCount, tax.exchangeRateBasis)}
          </p>
        )}
        {tax.unconvertedCount > 0 && (
          <p className="text-xs text-amber-900">
            <ExchangeRateMissingNotice missing={{ kind: 'COUNT', count: tax.unconvertedCount }} />
          </p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ④ 주의 상태 상품
// ---------------------------------------------------------------------------

/**
 * ④ — **한 상품이 한 줄이고 사유는 여러 뱃지다** (DOC-008 §5, P4 컷 9)
 *
 * 계약은 `(상품 × 사유)` 평면 배열을 준다. 접지 않으면 결함 + KI 하회 상품이 목록에
 * 두 번 나타나고 사용자는 그것을 두 개의 상품으로 읽는다 — `groupAttention`이 그
 * 접기이고 **사유의 순서는 계약이 준 그대로**다.
 *
 * **결함이 KI 하회를 가리지 않는다는 것이 이 화면에서만 관측된다**(§4.1 v0.8).
 * 평가일정 0건 상품은 SCR-301에 행이 아예 없고 ①에서도 빠지므로(다음 평가일이 없다)
 * 그 상품의 KI 하회는 이 목록에만 나타난다. 두 뱃지가 함께 보이는 것이 그 결정의
 * 관측 지점이다.
 *
 * 자르지 않는다 — 조치 목록이 잘리면 「할 일이 없다」로 읽히고, 잘린 항목은
 * 결함 · KI 하회처럼 사용자가 고치거나 확인하기 전까지 사라지지 않는 것들이다.
 */
export function AttentionSection({
  items,
  scope,
}: {
  items: DashboardView['attentionItems']
  scope: DashboardScope
}) {
  const groups = groupAttention(items)

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        주의 상태 상품{' '}
        <span className="font-normal text-neutral-500">{groups.length}건</span>
      </h2>

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-600">{SECTION_EMPTY.attention}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {groups.map((group) => (
            <li
              key={group.productId}
              className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <ProductNameLink productId={group.productId} name={group.productName} />
                {/*
                  ★ v2.0의 `ownerName`이 여기 쓰인다. 위 사유의 조치는 전부
                  소유자만 할 수 있으므로(ST-04), 전체 보기에서 소유자를 적지 않으면
                  사용자는 자기가 할 수 없는 일이 목록에 있는 이유를 상세로 들어가서야
                  안다.
                */}
                {scope === 'ALL' && (
                  <span className="truncate text-xs text-neutral-500">
                    {group.ownerName}
                  </span>
                )}
              </span>

              <span
                className="flex flex-wrap items-center gap-1.5"
                // 줄 전체의 강조는 **가장 무거운** 사유가 정한다. 첫 사유를 쓰면
                // 「결함 우선」 순서 때문에 항상 결함 등급이 되는데, 그 순서는 조치의
                // 성격 순이지 심각도 순이 아니다.
                data-grade={heaviestGrade(group.reasons)}
              >
                {group.reasons.map((reason) => (
                  <Badge key={reason} grade={ATTENTION_REASON_GRADES[reason]}>
                    {/* 「월수익 미기록 · n개월」 — n은 계약의 `count`. 칩은 링크가 아니다(v2.31 · ST-04) */}
                    {attentionChipLabel(ATTENTION_REASON_LABELS[reason], group.counts[reason])}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ⑤ 최근 상환 실적
// ---------------------------------------------------------------------------

/**
 * ⑤ — **v2.0에서 자료원을 얻은 요소다** (DOC-011 §4.1 `recentRedemptions`).
 *
 * v1.9까지 이 요소는 DOC-008에만 있었고 계약에는 없었다. `totals.realizedPnl`은
 * 합계이므로 「무엇이 상환되었는가」를 말하지 못했다 — 그 합계와 이 목록의 합이
 * 같다는 것이 계약에 기간 창이 없다는 사실의 형태다.
 */
export function RecentRedemptionsSection({
  items,
  scope,
}: {
  items: DashboardView['recentRedemptions']
  scope: DashboardScope
}) {
  const visible = takeVisible(items, RECENT_VISIBLE)

  return (
    <section className="flex flex-col gap-2">
      <SectionHead
        title="최근 상환 실적"
        visible={visible}
        moreLabel="상환 완료 목록"
        moreHref={`${PATHS.products}?${FILTER_KEYS.status}=REDEEMED`}
      />

      {visible.total === 0 ? (
        <p className="text-sm text-neutral-600">{SECTION_EMPTY.recent}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {visible.shown.map((item) => (
            <li
              key={item.productId}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <ProductNameLink productId={item.productId} name={item.productName} />
                <span className="flex flex-wrap items-baseline gap-1.5 text-xs text-neutral-500">
                  <span className="tabular-nums">{ymd(item.redemptionDate)}</span>
                  <span>{REDEMPTION_TYPE_LABELS[item.redemptionType]}</span>
                  {scope === 'ALL' && <span className="truncate">{item.ownerName}</span>}
                  {/*
                    ST-05 — 지급명세서로 확인되지 않은 값을 확정값과 같은 모습으로
                    표시하지 않는다. 상세(SCR-202)가 같은 규약을 쓴다.
                  */}
                  {!item.isConfirmed && <Badge grade="caution">미확인</Badge>}
                </span>
              </span>

              <span className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="tabular-nums text-neutral-500">
                  수령 {money(item.grossAmount, item.currency)}
                </span>
                <span
                  className={`text-sm font-medium tabular-nums ${pnlColor(item.realizedPnl)}`}
                >
                  {signedMoney(item.realizedPnl, item.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/** 손익 색 — 음수만 붉다. 통화와 무관하다(부호가 문자열의 첫 글자다 — Q-07) */
function pnlColor(value: string): string {
  return value.startsWith('-') ? 'text-red-700' : 'text-neutral-900'
}

/**
 * 절 머리글 — **자름을 말하는 자리가 여기 하나다.**
 *
 * 두 목록이 같은 규칙으로 자르므로 문구도 한 곳에 둔다. `hidden === 0`이면 자름을
 * 말하지 않지만 전체 링크는 남긴다 — 그 링크는 자름의 안내가 아니라 §7의 화면 전이다.
 */
function SectionHead({
  title,
  visible,
  moreLabel,
  moreHref,
}: {
  title: string
  visible: { total: number; hidden: number }
  moreLabel: string
  moreHref: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">
        {title}{' '}
        <span className="font-normal text-neutral-500">
          {visible.hidden > 0
            ? `${visible.total}건 중 ${visible.total - visible.hidden}건`
            : `${visible.total}건`}
        </span>
      </h2>
      <Link href={moreHref} className="text-xs text-neutral-600 underline">
        {moreLabel}
      </Link>
    </div>
  )
}
