import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import { CouponDeleteForm } from '@/components/products/CouponDeleteForm'
import { OwnerOnly } from '@/components/state/OwnerOnly'
import type { CouponObservationView, CouponRecordView, ProductDetailView } from '@/lib/db/queries/map'
import {
  COUPON_CONDITION_RESULT_GRADES,
  COUPON_CONDITION_RESULT_LABELS,
  COUPON_STATE_GRADES,
  COUPON_STATE_LABELS,
  couponAmountShown,
  couponMonthLabel,
  money,
  UNNUMBERED_COUPON_LABEL,
  ymd,
} from '@/lib/format'
import { recordedCouponIds } from '@/lib/forms/coupons'
import { COUPON_SECTION, PATHS } from '@/lib/routes/paths'

/**
 * SCR-202 ⑦ 월수익 — 월지급식 상품에만 있다 (P8 컷 b3, DOC-008 SCR-202 ⑦ · DOC-011 §4.3)
 *
 * 상환 시 지급 상품에는 이 요소가 없다 — 부재로 구현한다(노낙인 상품에 KI 터치 폼을 두지 않는 것과 같은 판단).
 * 행마다 「5번째 · 2027-02-16」 · 월수익 지급일 · 상태 · 금액 · 액션이고, 다음 한 행에만 「예상 지급 / 예상 미지급」을
 * 붙인다(표시 전용 — DOC-007 §3.5. 세금 추정은 이 판정을 쓰지 않는다).
 *
 * ## 금액은 계약이 고른 문자열이다
 *
 * 기록이 있으면 기록의 세전, 없으면 예상 금액(보조단위 절사값 — SCR-206 기본값과 같다), 미지급 · 「상환 후 없음」은
 * 적지 않는다(`couponAmountShown`). 화면은 금액을 계산하지 않는다.
 *
 * ## 액션은 소유자에게만 — 「기록」은 기록할 달이 있을 때만
 *
 * `recordable`이 하나라도 참일 때(DOC-011 §4.3 — 화면은 날짜를 비교하지 않는다), 기실현 월지급은 늘(「빈 행 추가」).
 * 기록된 행마다 「수정」(SCR-206 `?edit=<id>`) · 「삭제」(`<details>` 2단), 구획에 「월수익 기록 전부 지우기」.
 */
export function CouponSection({ view }: { view: ProductDetailView }) {
  const { product, coupons, unnumberedCouponRecords } = view

  if (coupons == null) {
    // 월지급식인데 일정이 0행 — 셋째 결함의 억제(§4.2 D1). 이유를 적고 고칠 곳으로 보낸다(ST-06)
    return (
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        월수익 일정이 0건이다 — 계약을 경유하는 조작으로는 만들 수 없는 상태다(DOC-002 I-25). 수정 화면의 월지급
        블록에서 일정을 채운다.
      </p>
    )
  }

  const canRecord = product.entryMode === 'REALIZED_ONLY' || coupons.some((coupon) => coupon.recordable)
  const ids = recordedCouponIds(view)

  return (
    <>
      <OwnerOnly isOwner={product.isOwner}>
        <div className="flex flex-wrap items-start gap-3">
          {canRecord && (
            <Link
              href={PATHS.productCoupons(product.id)}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              기록
            </Link>
          )}
          {ids.length > 0 && (
            <CouponDeleteForm productId={product.id} ids={ids} summary="월수익 기록 전부 지우기" />
          )}
        </div>
      </OwnerOnly>

      {coupons.length === 0 && unnumberedCouponRecords.length === 0 ? (
        <p className="text-sm text-neutral-700">
          기실현 등재 상품이라 월수익 일정이 없다 — 받은 월수익은 「기록」에서 거래내역 한 줄씩 적는다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
            <span>월수익</span>
            <span>월수익 지급일</span>
            <span>상태</span>
            <span className="text-right">{product.currency === 'KRW' ? '금액 (원)' : '금액'}</span>
            <span>액션</span>
          </div>
          <ul className="divide-y divide-neutral-200">
            {coupons.map((coupon) => (
              <CouponRow key={coupon.couponNo} coupon={coupon} view={view} />
            ))}
            {unnumberedCouponRecords.map((record) => (
              <UnnumberedRow key={record.id} record={record} view={view} />
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

const ROW_CLASS =
  'grid gap-1.5 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-3'

function CouponRow({ coupon, view }: { coupon: CouponObservationView; view: ProductDetailView }) {
  const amount = couponAmountShown(coupon)
  return (
    <li className={ROW_CLASS}>
      <span className="text-sm font-medium tabular-nums">{couponMonthLabel(coupon.couponNo, coupon.evaluationDate)}</span>
      {/* 지급 기록이 있으면 거래내역의 지급일이다 — 일정의 지급일과 다를 수 있다 */}
      <Value label="월수익 지급일">{ymd(coupon.record?.paymentDate ?? coupon.paymentDate)}</Value>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge grade={COUPON_STATE_GRADES[coupon.state]}>{COUPON_STATE_LABELS[coupon.state]}</Badge>
        {coupon.conditionResult != null && (
          <Badge grade={COUPON_CONDITION_RESULT_GRADES[coupon.conditionResult]}>
            {COUPON_CONDITION_RESULT_LABELS[coupon.conditionResult]}
          </Badge>
        )}
        {coupon.record != null && !coupon.record.isConfirmed && (
          <span className="text-xs text-neutral-500">추정값</span>
        )}
      </div>
      <Value label="금액" align="right">
        {amount == null ? '—' : money(amount, view.product.currency)}
      </Value>
      {coupon.record == null ? <span className="hidden lg:block" /> : <RecordActions record={coupon.record} view={view} />}
    </li>
  )
}

/** 순번 없는 기록(기실현 월지급) — 늘 지급이다(I-27). 머리는 「순번 없음」 — 날짜는 지급일 칸이 나른다 */
function UnnumberedRow({ record, view }: { record: CouponRecordView; view: ProductDetailView }) {
  return (
    <li className={ROW_CLASS}>
      <span className="text-sm font-medium">{UNNUMBERED_COUPON_LABEL}</span>
      <Value label="월수익 지급일">{record.paymentDate == null ? '—' : ymd(record.paymentDate)}</Value>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge grade={COUPON_STATE_GRADES.PAID}>{COUPON_STATE_LABELS.PAID}</Badge>
        {!record.isConfirmed && <span className="text-xs text-neutral-500">추정값</span>}
      </div>
      <Value label="금액" align="right">
        {record.grossAmount == null ? '—' : money(record.grossAmount, view.product.currency)}
      </Value>
      <RecordActions record={record} view={view} />
    </li>
  )
}

function RecordActions({ record, view }: { record: CouponRecordView; view: ProductDetailView }) {
  return (
    <OwnerOnly isOwner={view.product.isOwner}>
      <div className="flex flex-wrap items-start gap-2">
        <Link
          href={COUPON_SECTION.editHref(view.product.id, record.id)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100"
        >
          수정
        </Link>
        <CouponDeleteForm productId={view.product.id} ids={[record.id]} summary="삭제" />
      </div>
    </OwnerOnly>
  )
}

function Value({
  label,
  align,
  children,
}: {
  label: string
  align?: 'right'
  children: React.ReactNode
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 lg:block ${align === 'right' ? 'lg:text-right' : ''}`}>
      <span className="text-xs text-neutral-500 lg:hidden">{label}</span>
      <span className="text-sm tabular-nums">{children}</span>
    </div>
  )
}

