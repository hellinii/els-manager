import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { ScheduleItem } from '@/lib/db/queries/map'
import {
  CONDITION_RESULT_GRADES,
  CONDITION_RESULT_LABELS,
  STATUS_GRADES,
  STATUS_LABELS,
  barrierGap,
  dDayLabel,
  deriveDisplay,
  percent,
  ymd,
  type DisplayState,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * 평가일 한 줄 — SCR-301의 카드이자 데스크톱 표의 행
 *
 * DOC-008 §5의 「항목 표시」 여섯을 그대로 담는다: 평가일 · 상품명 · 차수 · 배리어 ·
 * 현재 워스트오브 · 예상 충족 여부. `ProductRow`와 같은 구조(한 마크업이 카드와
 * 행 둘 다 된다)이고 §7.2가 그린 전이대로 **상품명이 SCR-202로 가는 링크**다.
 *
 * ## `deriveDisplay()`의 **세 번째이자 마지막 소비자**가 되었다
 *
 * v1.7까지 이 화면은 그 함수를 부를 수 없었다 — 뷰에 `status`가 없어 §4.2
 * 우선순위표의 E-05 단을 판정할 입력이 모자랐다(DOC-011 §4.4 v1.8이 신설한 이유).
 * 그래서 이 파일은 우선순위를 다시 정하지 않고 `kind`만 분기한다.
 *
 * > 종전 머리글은 「**다섯 번째** 소비자」였다. 그 함수의 머리글이 「이 판정을 하는
 * > 화면이 다섯」이라고 적었기 때문인데 **그 수가 틀렸다** — 나머지 둘(SCR-101·401)은
 * > 입력 셋을 담지 않는 계약을 읽으므로 이 함수를 부를 수 없고, 담지 않기로 한 것이
 * > 문서에 기록된 판단이다. 소비자는 셋이고 이 파일이 마지막이다(P4.5 정정).
 *
 * ## 「고치기」가 수정 화면이 아니라 상세로 간다
 *
 * ST-06은 「수정 화면으로 유도」를 요구하고 그 라우트는 컷 5에 섰다. 그런데
 * **`ScheduleItem`에는 `isOwner`가 없다** — 이 뷰는 차수 단위이고 소유 판정을 담지
 * 않는다. 수정 주소로 바로 보내면 타인의 상품에서 SCR-902(「권한이 없다」)에
 * 도달하므로, 결함을 고치라는 안내가 권한 오류로 끝난다. 상세에는 `OwnerOnly`가
 * 감싼 수정 링크가 있으므로 **소유자에게만 한 단계 뒤에 나타난다.**
 */

export function ScheduleRow({ item }: { item: ScheduleItem }) {
  const display = deriveDisplay(item)

  return (
    <li className="grid gap-2 rounded-lg border border-neutral-200 p-4 md:gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.5fr)] lg:items-center lg:rounded-none lg:border-0 lg:px-4 lg:py-3">
      {/* ① 평가일 + D-Day */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-sm tabular-nums">{ymd(item.evaluationDate)}</span>
        {/*
          부호의 뒤집음은 `dDayLabel` 하나에만 있다(§4.1의 `dDay`는 과거가 음수).
          지난 절에서도 값을 보여주는 이유는 「얼마나 지났는가」가 상환 처리의
          시급성이기 때문이다(§4.1 `EVALUATION_PASSED`).
        */}
        <span
          className={`text-xs tabular-nums ${
            item.dDay < 0 ? 'text-red-700' : 'text-neutral-500'
          }`}
        >
          {dDayLabel(item.dDay)}
        </span>
      </div>

      {/* ② 상품 — 이름이 SCR-202로 가는 링크다 (§7.2) */}
      <div className="min-w-0">
        <Link
          href={PATHS.product(item.productId)}
          className="block truncate font-medium hover:underline"
        >
          {item.productName}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span className="truncate">{item.ownerName}</span>
          {/*
            ★ v1.8의 `status`가 여기 쓰인다. **상환완료만 뱃지를 붙인다** —
            「보유중」이 목록의 기본값이므로 전 행에 중립 뱃지를 달면 그 색이
            아무것도 구분하지 않는다(`ProductRow`와 같은 판단).

            이 표식이 없으면 도래하지 않을 날짜가 미상환 차수와 같은 모습으로
            목록에 남는다 — 「미상환만 보기」로 **숨기는** 것과 상환을 **구분하는**
            것은 다른 일이다(DOC-008 §5 v0.8).
          */}
          {item.status === 'REDEEMED' && (
            <Badge grade={STATUS_GRADES.REDEEMED}>{STATUS_LABELS.REDEEMED}</Badge>
          )}
        </p>
      </div>

      {/* ③ 차수 */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-xs text-neutral-500 lg:hidden">차수</span>
        <span className="text-sm tabular-nums">{item.roundNo}차</span>
        {item.hasLizard && (
          <span className="ml-1.5 text-xs text-neutral-500">리자드</span>
        )}
      </div>

      {/* ④ 배리어 + 현재 워스트오브 */}
      <div className="flex flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-neutral-500 lg:hidden">배리어</span>
          <span className="text-sm tabular-nums">{percent(item.barrier)}</span>
        </span>
        <WorstOfCell item={item} />
      </div>

      {/* ⑤ 예상 충족 여부 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <JudgmentCell item={item} display={display} />
      </div>
    </li>
  )
}

/**
 * 현재 워스트오브와 배리어까지의 거리.
 *
 * **`barrierGap`은 그 차수의 배리어와 비교한다** — 이 뷰는 행 자체가 차수이므로
 * SCR-201에서 「적용 차수가 없으면 붙이지 않는다」던 제약이 여기서는 없다. 모든
 * 행이 자기 배리어를 들고 있고, 그것이 이 화면이 SCR-201보다 정확한 지점이다.
 */
function WorstOfCell({ item }: { item: ScheduleItem }) {
  if (item.worstOf == null) return null

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xs text-neutral-500">워스트오브</span>
      <span className="text-sm font-medium tabular-nums">{percent(item.worstOf)}</span>
      <span className="text-xs tabular-nums text-neutral-500">
        {barrierGap(item.worstOf, item.barrier)}
      </span>
    </span>
  )
}

/**
 * §4.2 우선순위표의 네 갈래 + 판정.
 *
 * **판정은 적용 차수에만 붙는다**(§4.4 「`conditionResult`는 적용 차수 한 행에만 값이
 * 있다」 — P4.5에서 명문화됐다). 그러므로 이 칸이 비어 있는 것은 결함이 아니라 「그
 * 차수는 지금 판정 대상이 아니다」이며, 우선순위 넷과는 다른 이유다 — 넷은 **왜
 * 판정할 수 없는가**를 말하고 이쪽은 **판정할 차수가 아니다**를 말한다.
 *
 * 그런데 **이 뷰에서는 그 둘이 갈리지 않는다.** §4.4가 적은 대로 목록이 여러 상품의
 * 차수를 섞으므로 「적용 차수가 아니다」와 「적용 차수인데 판정할 수 없다」를 이 필드
 * 하나로는 구분할 수 없다 — 그래서 위 네 갈래(`display.kind`)를 **먼저** 분기시킨다.
 * 원인이 있으면 그것을 말하고, 남은 「—」만이 「판정할 차수가 아니다」다.
 *
 * `isPast`로 판단하지 않는다 — 함의가 반대 방향이다(§4.4: `isPast = true`면 반드시
 * `null`이지만 `isPast = false`인 미래 차수 대부분도 `null`이다).
 */
function JudgmentCell({
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
          className="text-xs text-neutral-600 underline"
        >
          고치기
        </Link>
      </span>
    )
  }

  if (display.kind === 'PRICE_MISSING') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-neutral-500">{display.label}</span>
        {/* §7.3 — 「시세 없음 표시 → SCR-302 시세 관리」 */}
        <Link href={PATHS.prices} className="text-xs text-neutral-600 underline">
          시세 입력
        </Link>
      </span>
    )
  }

  /*
   * 상환 완료(E-05)는 판정을 생략한다. 표식은 ②의 뱃지가 이미 달았으므로 여기서
   * 같은 사실을 두 번 적지 않는다 — 「—」로 두면 판정 없음의 이유가 왼쪽에 있다.
   */
  if (item.conditionResult == null) {
    return <span className="text-sm text-neutral-400">—</span>
  }

  return (
    /*
     * **추정값이다.** 같은 라벨이 `redemptionType`(확정)에도 있으므로 ST-05가
     * 시각적 구분을 요구한다 — 등급은 `CONDITION_RESULT_GRADES`가 따로 정의하고
     * 「예상」을 덧붙여 문자로도 구분한다(`ProductRow`와 같은 규약).
     */
    <Badge grade={CONDITION_RESULT_GRADES[item.conditionResult]}>
      예상 {CONDITION_RESULT_LABELS[item.conditionResult]}
    </Badge>
  )
}
