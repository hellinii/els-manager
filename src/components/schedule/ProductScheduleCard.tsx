import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import { UnderlyingLines } from '@/components/display/UnderlyingLines'
import type { ScheduleItem } from '@/lib/db/queries/map'
import {
  ACCOUNT_TYPE_LABELS,
  CONDITION_RESULT_GRADES,
  CONDITION_RESULT_LABELS,
  KI_OBSERVATION_LABELS,
  STATUS_GRADES,
  STATUS_LABELS,
  amount,
  barrierGap,
  dDayLabel,
  deriveDisplay,
  kiTermLabel,
  percent,
  signedWon,
  ymd,
  type DisplayState,
  type ProductGroup,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * 상품 하나 = 카드 하나 — SCR-301 상품별 보기 (DOC-008 §5, P6 컷 6)
 *
 * ## 관용구 1(grid 「표」)이고, 진짜 `<table>`은 **쓸 수 없다**
 *
 * `<details>`는 `<tbody>`의 유효한 자식이 아니다. HTML 파서가 그것을 foster
 * parenting으로 표 **밖**으로 끌어내므로 접힌 지난 차수가 통째로 튀어나온다. 즉
 * 「지난 차수를 접는다」와 진짜 표는 양립 불가다.
 *
 * 그리고 이 관용구에서는 `<details>`가 그리드를 **깨지 않는다** — 그리드가 `<ul>`이
 * 아니라 **행마다** 선언되기 때문이다(`ScheduleTable`·`UnderlyingTable`과 같은
 * 형태). 두 구역의 열 정렬은 ⓐ 같은 템플릿 상수 ⓑ 같은 폭으로 성립하며,
 * `minmax(0, …)`가 내용 독립을 보장한다. 맨 `1.2fr`은 문법상 `minmax(auto, 1.2fr)`
 * 이라 **내용에 의존**하고, 그러면 다가오는/지난 두 그리드의 열이 어긋난다.
 *
 * ## 반응형 — 접지 않고 «재배치»한다 (§8)
 *
 * 금액 셋은 이 보기가 존재하는 이유라 하나를 클릭 뒤로 접으면 데스크톱에서 풀려던
 * 문제를 모바일에서 재현한다. 그리고 `<details open>`을 폭에 의존시키면 JS가
 * 필요하고 **인쇄가 창 크기에 좌우된다** — 이 카드는 이미 그 장치를 「지난 차수」에
 * 쓰고 있고 그 열림은 **데이터**가 정하므로, 축을 섞을 수 없다.
 *
 * 그래서 금액 셋을 래퍼로 묶고 `lg:contents`를 건다. `< lg`에서는 래퍼가 flex
 * 상자이고, `≥ lg`에서는 래퍼의 상자가 사라져 세 자식이 행 그리드의 직속 아이템이
 * 된다. **마크업 하나, 중복 렌더 없음** — 값을 두 번 렌더하면 페이지 내 검색과 e2e
 * 문자열 단언이 둘 다 갈린다.
 *
 * ## 「예상」 규율 (ST-05)
 *
 * 셀마다 「예상」을 붙이면 3 × N번이라 읽히지 않는다. **표식을 라벨에 태운다** —
 * 열 머리글과 `lg:hidden` 모바일 라벨이 **같은 문자열**이므로 폭과 무관하게 표식이
 * 값을 따라다닌다. 열 이름은 DOC-005 §9가 정한다: 「세후 수령액」이 아니라
 * **「세후 예상」**이다(「실수령액」·「세후 회수」와 겹친다).
 *
 * ## `deriveDisplay`의 **네 번째** 소비자다
 *
 * 정본 목록은 `lib/format/derived.ts`의 머리글 표 하나다 — 서수는 소비자가 늘
 * 때마다 낡는다(P4.5). 입력 셋이 전부 상품 단위 값이므로 **카드당 한 번** 부른다
 * (시간순은 행마다 부르고 상품 하나가 여섯 번이다).
 */

/**
 * ★ **완전한 리터럴이어야 한다** — Tailwind v4가 소스 텍스트를 스캔하므로
 * `` `lg:grid-cols-[${x}]` `` 같은 조립은 클래스를 만들지 않는다.
 * 차수 · 평가일 · D-Day · 조건 · 세전 · 세후 · 손익.
 */
const ROUND_COLS =
  'lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)]'

export function ProductScheduleCard({
  group,
  /** 셋째 빈 상태가 화면 단위로 떠 있으면 카드가 같은 말을 반복하지 않는다 */
  noteMissingUpcoming,
}: {
  group: ProductGroup<ScheduleItem>
  noteMissingUpcoming: boolean
}) {
  const head = group.upcoming[0] ?? group.past[0]
  // 그룹은 구성상 비지 않는다(차수가 있어야 카드가 생긴다). 타입이 그것을 말하지
  // 않으므로 방어하되, 이 분기는 도달 불가다.
  if (head == null) return null

  const display = deriveDisplay(head)
  const redeemed = head.status === 'REDEEMED'

  return (
    <li className="rounded-lg border border-neutral-200 p-4">
      {/* ── 카드 머리 ── */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* `<h2>`인 것이 의미이자 e2e의 앵커다 — `<h1>평가일정` 아래의 절이다 */}
          <h2 className="min-w-0 text-sm font-medium">
            <Link
              href={PATHS.product(group.productId)}
              className="block truncate hover:underline"
            >
              {group.productName}
            </Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span className="truncate">{head.ownerName}</span>
            {redeemed && (
              <Badge grade={STATUS_GRADES.REDEEMED}>{STATUS_LABELS.REDEEMED}</Badge>
            )}
            {head.accountType === 'TAX_FREE' && (
              <Badge grade="neutral">{ACCOUNT_TYPE_LABELS.TAX_FREE}</Badge>
            )}
          </p>
        </div>

        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <HeadFact label="투자원금">
            <span className="tabular-nums">{amount(group.principal)}</span>원
          </HeadFact>
          <HeadFact label="연쿠폰">
            {group.annualCouponRate == null ? (
              /* 계약 조건이 없는 상품이다(D-07). 「0%」가 아니라 「모른다」다 */
              <span className="text-neutral-400">—</span>
            ) : (
              <span className="tabular-nums">{percent(group.annualCouponRate)}</span>
            )}
          </HeadFact>
          {/* 워스트오브는 «상품 단위 값»이라 열이 아니라 머리에 둔다 — 열로 두면
              N행에 같은 숫자가 N번 나온다(시간순 보기가 안고 있는 중복이다) */}
          <HeadFact label="워스트오브">
            <WorstOfFact item={head} display={display} />
          </HeadFact>
          {group.isTruncated && (
            /* 기간 필터가 차수를 잘랐다. 적지 않으면 카드가 「3차부터 시작하는
               상품」으로 읽힌다 — 값은 계약의 `totalRounds`다 */
            <HeadFact label="차수">
              <span className="tabular-nums">
                전체 {group.totalRounds}차수 중 {group.shownRounds}차수
              </span>
            </HeadFact>
          )}
        </dl>
      </div>

      {/*
        ── ⑨⑩ 계약 조건 둘 — **둘째 줄이다** (v2.3, P6 컷 7)

        위 `<dl>`에 넣지 않는 이유는 그것이 제목과 `justify-between`으로 마주 보는
        블록이라는 것이다. 기초자산은 자산 수만큼 길어지므로 그 자리에 두면 상품명이
        눌린다 — SCR-201이 계약 조건을 카드의 **둘째 줄**로 뺀 것과 같은 형태이고,
        두 화면이 같은 값을 같은 자리에 두게 된다.

        차수 행이 아니라 카드 머리인 것은 ⑦⑧과 같은 근거다: 상품 단위 값이라 차수
        행에 두면 6차수 상품에서 같은 문자열이 여섯 번 나온다.
      */}
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <HeadFact label="기초자산">
          <UnderlyingLines lines={group.underlyings} />
        </HeadFact>
        <HeadFact label="KI">
          <span className="tabular-nums">
            {kiTermLabel(
              group.kiBarrier,
              group.kiObservation == null
                ? null
                : KI_OBSERVATION_LABELS[group.kiObservation],
            )}
          </span>
        </HeadFact>
      </dl>

      {/* ── 차수 표 — 카드 테두리까지 흘러나간다 (`TermsLine`의 선례) ── */}
      <div className="-mx-4 -mb-4 mt-3 overflow-hidden rounded-b-lg border-t border-neutral-200">
        {/* 머리글은 **카드마다** 반복된다 — 한 번만 두면 아래 카드의 열 뜻을
            위로 올라가 확인해야 하고, 그것은 사라진 머리글과 같다 */}
        <div
          className={`hidden ${ROUND_COLS} gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid`}
        >
          <span>차수</span>
          <span>평가일</span>
          <span className="text-right">D-Day</span>
          <span>조건 (배리어)</span>
          <span className="text-right">예상 세전 (원)</span>
          <span className="text-right">세후 예상 (원)</span>
          <span className="text-right">예상 손익</span>
        </div>

        {group.upcoming.length > 0 && (
          <ul className="divide-y divide-neutral-200">
            {group.upcoming.map((round) => (
              <RoundRow key={round.roundNo} item={round} redeemed={redeemed} />
            ))}
          </ul>
        )}

        {/* 넷째 빈 상태 — 카드의 것이다(DOC-008 §5). 상환 완료 상품에는 내지
            않는다: 정상 상태이고 머리의 표식이 이미 그 이유를 말한다 */}
        {group.upcoming.length === 0 && !redeemed && noteMissingUpcoming && (
          <p className="px-4 py-3 text-xs text-neutral-600">
            다가오는 차수가 없다.{' '}
            <Link href={PATHS.product(group.productId)} className="underline">
              상환 처리 · 이월 확인
            </Link>
          </p>
        )}

        {redeemed && (
          /* 계약은 남은 차수의 금액을 주지만 그것은 **도래하지 않을 날짜의
             반사실**이고, 이 화면에는 SCR-202와 달리 확정 실적이 옆에 없어
             맥락 없는 금액이 「받은 돈」으로 읽힌다(ST-05). */
          <p className="px-4 py-3 text-xs text-neutral-600">
            상환이 확정된 상품이다 — 남은 차수의 예상 금액은 표시하지 않는다.{' '}
            <Link href={PATHS.product(group.productId)} className="underline">
              확정 실적 보기
            </Link>
          </p>
        )}

        {group.past.length > 0 && (
          <details
            /*
             * ★ 열림이 **데이터**에 의존한다(`ConditionStep`의 `open={hasLizard}`와
             * 같은 형태). 금지된 것은 **폭 의존**이다 — 그것은 JS를 요구하고 인쇄
             * 결과가 창 크기에 좌우된다(`ScheduleTable`의 규약).
             *
             * 다가오는 차수가 없으면 펼친다: 접으면 카드가 비어 보이고 그 상품이
             * 화면에서 사라진 것처럼 읽힌다. 상환 완료·E-07·`range=PAST`가 전부
             * 이 한 규칙으로 처리된다.
             */
            open={group.upcoming.length === 0}
            className={
              group.upcoming.length > 0 ? 'border-t border-neutral-200' : undefined
            }
          >
            {/* `▸`를 «글자로 적지 않는다» — 네이티브 마커가 이미 있고 글자를
                더하면 회전하지 않는 두 번째 삼각형이 생긴다 */}
            <summary className="cursor-pointer px-4 py-2 text-xs text-neutral-600 marker:text-neutral-400 hover:bg-neutral-50">
              지난 차수 {group.past.length}건
            </summary>
            <ul className="divide-y divide-neutral-200 border-t border-neutral-200">
              {group.past.map((round) => (
                <RoundRow key={round.roundNo} item={round} redeemed={redeemed} isPast />
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  )
}

function HeadFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * §4.2 우선순위표의 네 갈래 — 카드 머리에서 **한 번** 판정한다.
 *
 * 「고치기」·「시세 입력」은 `ScheduleRow`와 같은 목적지다. 수정 화면으로 바로
 * 보내지 않는 이유도 같다 — 이 뷰에는 `isOwner`가 없어 타인의 상품에서 SCR-902에
 * 도달한다(상세에는 `OwnerOnly`가 감싼 수정 링크가 있다).
 */
function WorstOfFact({
  item,
  display,
}: {
  item: ScheduleItem
  display: DisplayState
}) {
  if (display.kind === 'INTEGRITY') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge grade={display.grade}>{display.label}</Badge>
        <Link
          href={PATHS.product(item.productId)}
          className="text-neutral-600 underline"
        >
          고치기
        </Link>
      </span>
    )
  }

  if (display.kind === 'PRICE_MISSING') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-neutral-500">{display.label}</span>
        <Link href={PATHS.prices} className="text-neutral-600 underline">
          시세 입력
        </Link>
      </span>
    )
  }

  const worstOf = display.kind === 'VALUED' ? display.worstOf : item.worstOf
  if (worstOf == null) return <span className="text-neutral-400">—</span>

  return <span className="font-medium tabular-nums">{percent(worstOf)}</span>
}

function RoundRow({
  item,
  redeemed,
  isPast = false,
}: {
  item: ScheduleItem
  redeemed: boolean
  isPast?: boolean
}) {
  const p = item.proceeds

  return (
    <li
      className={`grid gap-1.5 px-4 py-3 lg:items-center lg:gap-3 ${ROUND_COLS} ${
        isPast ? 'bg-neutral-50/60 text-neutral-500' : ''
      }`}
    >
      {/* ① 차수 */}
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium tabular-nums">{item.roundNo}차</span>
        {item.hasLizard && (
          /* 이 차수가 리자드로 상환되면 금액이 **이보다 작다**(DOC-007 §4.5) —
             `expectedGross`는 `EARLY` 가정 위에 있다 */
          <span className="text-xs text-neutral-500">리자드</span>
        )}
      </div>

      {/* ② 평가일 */}
      <Cell label="평가일">
        <span className="tabular-nums">{ymd(item.evaluationDate)}</span>
      </Cell>

      {/* ③ D-Day — 부호의 뒤집음은 `dDayLabel` 하나에만 있다 */}
      <Cell label="D-Day" align="right">
        <span className={`tabular-nums ${item.dDay < 0 ? 'text-red-700' : ''}`}>
          {dDayLabel(item.dDay)}
        </span>
      </Cell>

      {/* ④ 조건 — 배리어 · 거리 · 적용 차수의 예상 판정 */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs text-neutral-500 lg:hidden">조건</span>
        <span className="text-sm tabular-nums">배리어 {percent(item.barrier)}</span>
        {item.worstOf != null && (
          /* 행 자체가 차수이므로 그 차수의 배리어와 비교한다 — SCR-201에서
             「적용 차수가 없으면 붙이지 않는다」던 제약이 여기서는 없다 */
          <span className="text-xs tabular-nums text-neutral-500">
            {barrierGap(item.worstOf, item.barrier)}
          </span>
        )}
        {item.conditionResult != null && (
          <Badge grade={CONDITION_RESULT_GRADES[item.conditionResult]}>
            예상 {CONDITION_RESULT_LABELS[item.conditionResult]}
          </Badge>
        )}
      </div>

      {/* ⑤⑥⑦ 금액 셋 — `lg`에서 래퍼의 상자가 사라져 세 열로 «펼쳐진다» */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 lg:contents">
        <Money label="예상 세전">
          {redeemed || p == null ? null : amount(p.expectedGross)}
        </Money>
        <Money label="세후 예상" strong>
          {redeemed || p == null ? null : amount(p.expectedNet)}
        </Money>
        <Money label="예상 손익">
          {/* 현 산식에서 음수가 될 수 없다(`r ≥ 0`). 그래도 `signedWon`을 쓰는 것은
              `+`가 **「총액이 아니라 증분」**을 말하기 때문이다 — 색은 쓰지 않는다
              (이 저장소의 빨강은 「조치·경과」 축이고 한국 등락 관행과 방향이 반대다). */}
          {redeemed || p == null ? null : signedWon(p.expectedPnl)}
        </Money>
      </div>
    </li>
  )
}

function Cell({
  label,
  align = 'left',
  children,
}: {
  label: string
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex items-baseline gap-2 text-sm ${
        align === 'right' ? 'lg:justify-end' : ''
      }`}
    >
      <span className="text-xs font-normal text-neutral-500 lg:hidden">{label}</span>
      <span>{children}</span>
    </div>
  )
}

/**
 * 금액 한 칸 — **라벨이 곧 「예상」 표식이다**(ST-05).
 *
 * 모바일 라벨과 열 머리글이 같은 문자열이므로 폭이 어떻든 모든 값에 표식이 붙어
 * 있다. 그것이 셀마다 「예상」을 반복하지 않고도 규율을 지키는 기전이다.
 */
function Money({
  label,
  strong = false,
  children,
}: {
  label: string
  strong?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2 text-sm tabular-nums lg:justify-end">
      <span className="text-xs font-normal text-neutral-500 lg:hidden">{label}</span>
      <span className={strong ? 'font-medium text-neutral-900' : undefined}>
        {children ?? <span className="text-neutral-400">—</span>}
      </span>
    </div>
  )
}
