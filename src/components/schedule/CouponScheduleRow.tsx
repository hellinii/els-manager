import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { MonthlyCouponScheduleItem } from '@/lib/db/queries/map'
import {
  COUPON_CONDITION_RESULT_GRADES,
  COUPON_CONDITION_RESULT_LABELS,
  COUPON_STATE_GRADES,
  COUPON_STATE_LABELS,
  couponAmountShown,
  money,
  percent,
  ymd,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * 월수익 행 한 줄 — SCR-301 시간순 보기의 ⑯ (P8 컷 b3-6, DOC-008 SCR-301 「P8 월지급식」 · DOC-011 §4.12)
 *
 * `ScheduleRow`와 **같은 그리드 · 같은 다섯 칸**이다 — 한 표에 두 종류의 행이 섞이므로 열이 어긋나면 표가 아니게 된다.
 * 칸의 뜻만 바뀐다(DOC-008 v2.33 ⓒ): 평가일 자리에 월수익 평가일, 차수 자리에 「n번째」, 배리어 자리에 월수익 배리어,
 * 예상 충족 자리에 상태 · 판정 · 금액.
 *
 * ## D-Day가 없다
 *
 * §4.12가 싣지 않고 화면은 날짜를 셈하지 않는다(DOC-008 SCR-301 구획 각주). 차수 행의 D-Day는 계약의 `dDay`다.
 *
 * ## 상태 · 판정 · 금액은 SCR-202 ⑦과 같은 함수를 지난다
 *
 * 같은 상품의 같은 달에 두 화면이 다른 말을 하지 않는다 — 계약은 같은 매퍼(§4.12)이고 표기는 같은 라벨 · 같은
 * `couponAmountShown`이다(「상환 후 없음」은 금액을 적지 않는다). 판정은 계약이 다음 한 행에만 준다.
 *
 * 「고치기」 · 「시세 입력」 같은 결함 갈래가 없는 이유: 셋째 결함 상품은 월수익 행이 없고(억제 — §4.2 D1) 그 사실은
 * 같은 상품의 차수 행이 말한다(`ScheduleItem.integrityIssue`).
 */
export function CouponScheduleRow({ item }: { item: MonthlyCouponScheduleItem }) {
  const amount = couponAmountShown(item)

  return (
    <li className="grid gap-2 rounded-lg border border-neutral-200 p-4 md:gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.5fr)] lg:items-center lg:rounded-none lg:border-0 lg:px-4 lg:py-3">
      {/* 월수익 평가일 — D-Day 없음 */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-sm tabular-nums">{ymd(item.evaluationDate)}</span>
      </div>

      {/* 상품 — 이름이 SCR-202로 가는 링크다(차수 행과 같다) */}
      <div className="min-w-0">
        <Link
          href={PATHS.product(item.productId)}
          className="block truncate font-medium hover:underline"
        >
          {item.productName}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span className="truncate">{item.ownerName}</span>
        </p>
      </div>

      {/* 순번 + 종류 — 이 행은 늘 종류를 말한다(월수익 행이 있으면 「종류」가 그려진다 — v2.33 ⓑ) */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-sm tabular-nums">{item.couponNo}번째</span>
        <span className="text-xs text-neutral-500 lg:block">월수익 평가일</span>
      </div>

      {/* 월수익 배리어 */}
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-neutral-500 lg:hidden">월수익 배리어</span>
        <span className="text-sm tabular-nums">{percent(item.couponBarrier)}</span>
      </div>

      {/* 상태 · 예상 판정 · 금액 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge grade={COUPON_STATE_GRADES[item.state]}>{COUPON_STATE_LABELS[item.state]}</Badge>
        {item.conditionResult != null && (
          <Badge grade={COUPON_CONDITION_RESULT_GRADES[item.conditionResult]}>
            {COUPON_CONDITION_RESULT_LABELS[item.conditionResult]}
          </Badge>
        )}
        {amount != null && (
          <span className="text-sm tabular-nums">{money(amount, item.currency)}</span>
        )}
      </div>
    </li>
  )
}
