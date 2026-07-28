import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { DashboardView } from '@/lib/db/queries/dashboard'
import {
  ATTENTION_REASON_GRADES,
  ATTENTION_REASON_LABELS,
  IMMINENT_LABEL,
  RECENT_VISIBLE,
  REDEMPTION_TYPE_LABELS,
  UPCOMING_VISIBLE,
  amount,
  barrierGap,
  dDayLabel,
  groupAttention,
  heaviestGrade,
  isImminent,
  koreanWon,
  percent,
  signedWon,
  takeVisible,
  won,
  ymd,
} from '@/lib/format'
import { FILTER_KEYS, type DashboardScope } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-101의 다섯 요소 — DOC-008 §5 (P4 컷 9)
 *
 * ① 임박 평가일 · ② 총 자산 요약 · ③ 올해 금융소득 · ④ 주의 상태 상품 ·
 * ⑤ 최근 상환 실적. 범위 전환은 폼이 아니라 링크이므로 `ScopeSwitch`에 있다.
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
// ① 임박 평가일 알림
// ---------------------------------------------------------------------------

/**
 * ① — **행마다 D-Day가 있고 「임박」은 그 위에 덧붙는다.**
 *
 * 경계(30일)가 나중에 틀린 값으로 판명되어도 사용자가 잃는 것은 강조뿐이다
 * (`IMMINENT_DAYS`의 각주). 그래서 이 절에서 표식을 지워도 정보는 남는다.
 */
export function UpcomingSection({
  items,
  scope,
}: {
  items: DashboardView['upcomingEvaluations']
  scope: DashboardScope
}) {
  const visible = takeVisible(items, UPCOMING_VISIBLE)

  return (
    <section className="flex flex-col gap-2">
      <SectionHead
        title="임박 평가일"
        visible={visible}
        moreLabel="전체 일정"
        moreHref={PATHS.schedule}
      />

      {visible.total === 0 ? (
        /*
         * **이 표의 빈 상태가 아니다**(DOC-008 §6 각주). 상품은 있는데 미상환
         * 상품의 다음 평가일이 하나도 없는 상태이며, 전 차수가 경과했거나
         * (E-07 · DOC-007 §9.2) 전부 상환완료라는 뜻이다. 그때 다음 행동은 등록이
         * 아니라 **상환 처리 또는 이월 확인**이므로 SCR-301의 셋째 빈 상태와 같은
         * 문구 부류다(DOC-010 AQ-34가 둘을 함께 다룬다).
         */
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
          임박한 평가일이 없다. 경과한 차수의 상환 처리 또는 이월을 확인한다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {visible.shown.map((item) => (
            <li
              key={`${item.productId}-${item.roundNo}`}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm tabular-nums">{ymd(item.evaluationDate)}</span>
                  <span className="text-xs tabular-nums text-neutral-500">
                    {dDayLabel(item.dDay)}
                  </span>
                  {isImminent(item.dDay) && (
                    <Badge grade="caution">{IMMINENT_LABEL}</Badge>
                  )}
                </span>
                <span className="flex flex-wrap items-baseline gap-1.5 text-xs text-neutral-500">
                  {/* §7.2 — 「SCR-101 홈 ─[평가일 알림]→ SCR-202 상세」 */}
                  <Link
                    href={PATHS.product(item.productId)}
                    className="truncate text-sm font-medium text-neutral-900 hover:underline"
                  >
                    {item.productName}
                  </Link>
                  <span>{item.roundNo}차</span>
                  {/*
                    범위가 전체일 때만 소유자를 적는다. 본인 보기에서는 전 행이
                    같은 값이므로 그 표시가 아무것도 구분하지 않는다(`ProductRow`가
                    「보유중」 뱃지를 달지 않는 것과 같은 판단).
                  */}
                  {scope === 'ALL' && <span className="truncate">{item.ownerName}</span>}
                </span>
              </span>

              <WillMeetCell item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * 예상 충족 — **`null`은 「미충족」이 아니다**(§4.1).
 *
 * 판정 결과가 없으면(시세 없음·무결성 결함) 충족 여부를 말하지 않는다. `false`로
 * 두면 「미충족」이라는 판정을 한 것이 되어 E-01과 구분되지 않으므로, 계약이 세 값을
 * 주는 것을 화면도 세 갈래로 받는다.
 */
function WillMeetCell({
  item,
}: {
  item: DashboardView['upcomingEvaluations'][number]
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-2 text-xs">
      <span className="tabular-nums text-neutral-500">
        배리어 {percent(item.barrier)}
      </span>
      {item.worstOf == null ? (
        // 이 목록은 판정 불가의 **원인**을 담지 않는다(뷰에 `integrityIssue`가 없다).
        // 원인별 안내는 SCR-201·202의 일이므로 여기서 지어내지 않는다.
        <span className="text-neutral-400">판정 없음</span>
      ) : (
        <>
          <span className="tabular-nums text-neutral-700">
            워스트오브 {percent(item.worstOf)}
          </span>
          <span className="tabular-nums text-neutral-500">
            {barrierGap(item.worstOf, item.barrier)}
          </span>
          {item.willMeet != null && (
            <Badge grade={item.willMeet ? 'positive' : 'caution'}>
              {item.willMeet ? '예상 충족' : '예상 미충족'}
            </Badge>
          )}
        </>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ② 총 자산 요약
// ---------------------------------------------------------------------------

/**
 * ② — **실현손익은 음수가 가능하다**(§4.1). 그것이 과세 금융소득과 갈리는 지점이며
 * (절대 규칙 #8) 부호를 붙여 표시한다(`signedWon`).
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
            {amount(totals.activePrincipal)}원
            {koreanWon(totals.activePrincipal) !== '0원' && (
              <span className="ml-1.5 text-xs font-normal text-neutral-500">
                ({koreanWon(totals.activePrincipal)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">실현손익 (누적)</dt>
          <dd
            className={`text-base font-semibold tabular-nums ${
              totals.realizedPnl.startsWith('-') ? 'text-red-700' : 'text-neutral-900'
            }`}
          >
            {signedWon(totals.realizedPnl)}
          </dd>
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
        </p>
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
 * `EVALUATION_PASSED`처럼 시간이 지나도 사라지지 않는 것들이다.
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
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
          조치가 필요한 상품이 없다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {groups.map((group) => (
            <li
              key={group.productId}
              className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={PATHS.product(group.productId)}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {group.productName}
                </Link>
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
                    {ATTENTION_REASON_LABELS[reason]}
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
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
          상환된 상품이 없다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {visible.shown.map((item) => (
            <li
              key={item.productId}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={PATHS.product(item.productId)}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {item.productName}
                </Link>
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
                  수령 {amount(item.grossAmount)}원
                </span>
                <span
                  className={`text-sm font-medium tabular-nums ${
                    item.realizedPnl.startsWith('-')
                      ? 'text-red-700'
                      : 'text-neutral-900'
                  }`}
                >
                  {signedWon(item.realizedPnl)}
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
