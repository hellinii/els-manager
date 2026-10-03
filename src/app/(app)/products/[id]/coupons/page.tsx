import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CouponRecordForm } from '@/components/products/CouponRecordForm'
import { AccessDenied } from '@/components/system/AccessDenied'
import { getQueries } from '@/lib/db/server'
import { couponMonthLabel, money, UNNUMBERED_COUPON_LABEL, ymd } from '@/lib/format'
import { couponEditValuesOf, couponFormValuesOf, couponRowsOf, findCouponRecord } from '@/lib/forms/coupons'
import { isUuid } from '@/lib/forms/query'
import { COUPON_SECTION } from '@/lib/routes/paths'

import { recordCouponPaymentsAction, updateCouponPaymentAction } from './actions'

/**
 * SCR-206 월수익 기록 — 월지급식 상품의 월수익 지급 기록(지급 · 미지급)을 거래내역에서 옮겨 적는다 (P8 컷 b3)
 *
 * DOC-008 SCR-206 · §7.5 · DOC-011 §5.14 · §5.15. 읽는 계약은 `getProduct` 하나다(DOC-011 §9 ⑭ⓑ — 기본 목록 · 기본값 ·
 * 수정 초기값이 전부 §4.3에 있다).
 *
 * ## 소유자 전용 라우트 셋째다 — `AccessDenied`다 (DOC-010 AQ-81, 민서 결정(2026-10-03) ①)
 *
 * 수정 · 상환과 같은 컴포넌트를 쓴다(상태 200). `forbidden()`(403)은 `experimental.authInterrupts`를 요구하고, 그
 * 속성은 이제 측정할 수 있다(e2e가 상태 코드를 단언한다) — 그래도 켜지 않는다. 3인 폐쇄형 서비스에서 403이 주는 것
 * (봇 · 모니터링이 읽는 의미)은 사용자에게 보이지 않고 실험 플래그의 표면이 그보다 크다. 넷째가 생기면 다시 본다.
 *
 * ## 상환 시 지급 상품은 404다
 *
 * 기록할 것이 없는 상품이다 — 「권한 없음」이나 빈 화면이 아니라 이 주소 자체가 없다(DOC-008 SCR-206).
 *
 * ## 기본 목록은 계약의 `recordable`이 고른다 — 화면은 날짜를 비교하지 않는다
 *
 * 「기록 없는 달 중 평가일 ≤ min(기준일, 흐름 끝)」을 화면이 셈하면 V-27과 경계(당일 · 상환일)가 갈릴 수 있다.
 * `recordable`은 V-27과 같은 함수를 지난다(DOC-011 §4.3 b3 개정) — 이 화면이 내보인 달을 같은 제출의 V-27이
 * 거부하는 일이 구성으로 없다.
 */

export const metadata: Metadata = { title: '월수익 기록 · 언제들어오나' }

export default async function CouponRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const queries = await getQueries()
  const view = await queries.getProduct(id)
  if (view == null) notFound()
  if (view.product.couponPayout !== 'MONTHLY') notFound()

  if (!view.product.isOwner) {
    return <AccessDenied what="이 상품의 월수익을 기록할" productId={id} />
  }

  const { product } = view
  const editParam = (await searchParams)[COUPON_SECTION.editParam]
  const editId = typeof editParam === 'string' ? editParam : null
  const basis = view.projection?.exchangeRateBasis ?? null

  return (
    <section className="flex flex-col gap-5">
      <header>
        <Link href={COUPON_SECTION.detailHref(id)} className="text-sm text-neutral-600 underline">
          ← 상세
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {editId == null ? '월수익 기록' : '월수익 기록 수정'}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          {product.name} · 투자원금 {money(product.principal, product.currency)}
        </p>
      </header>

      {editId != null ? (
        <EditOne view={view} editId={editId} basis={basis} />
      ) : (
        <RecordMany view={view} basis={basis} />
      )}
    </section>
  )
}

type View = NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof getQueries>>['getProduct']>>>
type Basis = NonNullable<View['projection']>['exchangeRateBasis']

/** §5.14 — 밀린 달마다 한 행. 기실현은 순번 없는 빈 행과 「빈 행 추가」 */
function RecordMany({ view, basis }: { view: View; basis: Basis }) {
  const { product } = view
  const realized = product.entryMode === 'REALIZED_ONLY'
  const rows = couponRowsOf(view)

  if (!realized && rows.length === 0) {
    // 빈 상태(ST-02) — 다음 행동을 준다. 다음 지급일은 계약이 준 행에서 고른다(화면이 날짜를 비교하지 않는다:
    // 기록할 달이 없으면 남은 무기록 달은 전부 아직 평가되지 않은 달이고, 그 첫 행이 다음이다)
    const next = (view.coupons ?? []).find(
      (coupon) => coupon.record == null && (coupon.state === 'SCHEDULED' || coupon.state === 'BEYOND_ASSUMPTION'),
    )
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
        <p className="text-sm text-neutral-700">
          기록할 밀린 달이 없다.
          {next != null && (
            <>
              {' '}
              다음 월수익은 {couponMonthLabel(next.couponNo, next.evaluationDate)} — 지급일 {ymd(next.paymentDate)}.
            </>
          )}
        </p>
        <Link
          href={COUPON_SECTION.detailHref(view.product.id)}
          className="self-start rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          상세로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <>
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        {realized ? (
          <>
            기실현 등재 상품은 월수익 일정이 없다 — 거래내역 한 줄을 한 행으로 적는다(지급만). 연 합계 한 행도 받되
            비고에 그 사실을 적는다. 행이 모자라면 「빈 행 추가」를 누른다.
          </>
        ) : (
          <>
            평가가 끝난 달 중 기록이 없는 달이다. <strong>결과를 고른 행만 저장한다</strong> — 한 행이라도 거부되면
            아무것도 저장되지 않고 입력값이 남는다. 금액은 월수익 금액(보조단위 절사)으로 채웠다 — 거래내역의 값으로 고친다.
          </>
        )}
      </p>

      <CouponRecordForm
        action={recordCouponPaymentsAction}
        initialValues={couponFormValuesOf(rows)}
        heads={realized ? [] : rows}
        growable={realized}
        productId={product.id}
        currency={product.currency}
        taxableHintBasis={basis}
        submitLabel="월수익 기록 저장"
      />
    </>
  )
}

/** §5.15 — 한 기록 전체 교체. 순번 · 상품은 바뀌지 않는다 */
function EditOne({ view, editId, basis }: { view: View; editId: string; basis: Basis }) {
  const found = findCouponRecord(view, editId)
  // 이 상품의 기록이 아닌 id — 주소가 틀렸다. 남의 상품의 기록 id를 붙여도 여기서 멈춘다(계약이 마지막 겹)
  if (found == null) notFound()

  const label =
    found.coupon == null ? UNNUMBERED_COUPON_LABEL : couponMonthLabel(found.coupon.couponNo, found.coupon.evaluationDate)

  return (
    <CouponRecordForm
      action={updateCouponPaymentAction}
      initialValues={couponEditValuesOf(found.record)}
      heads={[{ label, scheduledPaymentDate: found.coupon?.paymentDate ?? null }]}
      growable={false}
      productId={view.product.id}
      currency={view.product.currency}
      taxableHintBasis={basis}
      editId={found.record.id}
      submitLabel="수정 저장"
    />
  )
}

