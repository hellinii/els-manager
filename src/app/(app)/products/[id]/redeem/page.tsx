import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { RedemptionForm } from '@/components/products/RedemptionForm'
import { AccessDenied } from '@/components/system/AccessDenied'
import { getAsOf, getQueries } from '@/lib/db/server'
import { REDEMPTION_TYPE_LABELS, korDate, won } from '@/lib/format'
import { isUuid } from '@/lib/forms/query'
import { redemptionDefaults, roundOptionsOf } from '@/lib/forms/redemption'
import { PATHS } from '@/lib/routes/paths'

import { redemptionFormAction } from './actions'

/**
 * SCR-203 상환 처리 — **상태를 보유중 → 상환완료로 전이한다** (P4 컷 6, DOC-008 §5)
 *
 * ## 상태를 갱신하지 않는다 — 레코드를 만든다
 *
 * `els_products`에 `status` 열이 없다(절대 규칙 #4). 전이는 `redemptions` 1건의
 * 존재로 유도되며(D-01) 그래서 이 화면이 하는 일은 「상태 변경」이 아니라 **사실의
 * 기록**이다. K-03(상환 처리 1단계)이 충족되는 것도 그 형태 때문이다.
 *
 * ## 소유자 전용 라우트 둘째다
 *
 * 계획 §5가 「902에 도달하는 유일한 길은 소유자 전용 URL을 직접 타이핑」이라고 적으며
 * 화면을 둘로 셌다 — 수정(컷 5)과 이 화면이다. 셋째가 생기면 `forbidden()` +
 * `app/forbidden.tsx`를 재검토한다(그때는 403 상태 코드의 값이 커진다).
 *
 * ## 이미 상환된 상품은 폼을 그리지 않는다
 *
 * 계약이 `CONFLICT`를 주지만(I-01) 그것을 저장 시점에 처음 알려 주면 사용자가 채운
 * 입력이 버려진다. 그리고 이 경우의 다음 행동은 「고쳐서 다시 저장」이 아니라
 * **상세에서 수정하거나 취소하는 것**이므로 링크가 답이다.
 *
 * ## 결함 상품에도 상환을 기록할 수 있다
 *
 * `integrityIssue`가 있어도 막지 않는다(§5.4 v0.9) — 상환은 증권사가 확정한 외부
 * 사실이고(A-04) 결함은 우리 쪽 데이터의 문제다. 막으면 과세 이력이 누락된다. 다만
 * 평가일정 0건 상품에서 `EARLY`·`LIZARD`는 DB가 `23503`으로 거부하므로(I-13) 그
 * 사실을 미리 적는다 — 그때 할 일은 상환을 포기하는 것이 아니라 일정을 복구하는 것이다.
 */

export const metadata: Metadata = { title: '상환 처리 · 언제들어오나' }

export default async function ProductRedeemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const queries = await getQueries()
  const view = await queries.getProduct(id)
  if (view == null) notFound()

  if (!view.product.isOwner) {
    return <AccessDenied what="이 상품의 상환을 처리할" productId={id} />
  }

  const { product, projection, redemption } = view

  return (
    <section className="flex flex-col gap-5">
      <header>
        <Link href={PATHS.product(id)} className="text-sm text-neutral-600 underline">
          ← 상세
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">상환 처리</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {product.name} · 투자원금 {won(product.principal)}
        </p>
      </header>

      {redemption != null ? (
        /*
         * I-01 — 상품당 상환 1건. 폼을 그리지 않는 이유는 위 각주에 있다.
         * 다음 행동 둘(수정·취소)이 상세에 있으므로 그곳으로 보낸다.
         */
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            이미 상환 처리된 상품이다 —{' '}
            {REDEMPTION_TYPE_LABELS[redemption.redemptionType]} ·{' '}
            {korDate(redemption.redemptionDate)} · {won(redemption.grossAmount)}.
          </p>
          <p className="text-sm text-amber-900">
            고치거나 취소하려면 상세에서 한다. 상환 취소는 그 해의 금융소득을 바꾼다.
          </p>
          <Link
            href={PATHS.product(id)}
            className="self-start rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            상세로
          </Link>
        </div>
      ) : (
        <>
          {projection == null ? (
            /*
             * 적용 차수가 없다 — 전 차수 경과(E-07) 또는 평가일정 0건(§9.2).
             * 자동 채움의 근거가 없으므로 그 사실을 적는다. 폼은 그대로 그린다:
             * 상환 자체는 기록할 수 있어야 한다.
             */
            <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
              적용 차수가 없어 자동으로 채울 값이 없다 — 전 차수가 경과했거나
              평가일정이 0건이다. 증권사 거래내역을 보고 직접 입력한다.
            </p>
          ) : (
            /*
             * ★ **차수 번호를 여기 박지 않는다** (v2.7). 종전에는
             * 「{appliedRoundNo}차 평가 기준의 추정값을 채웠다」였는데, 이 문단은
             * **서버 렌더**라 사용자가 차수를 바꿔도 그대로 남는다 — 화면이 1차를
             * 말하면서 폼은 2차의 금액을 담는 상태가 된다. 차수를 말하는 것은
             * 선택을 따라가는 **칸의 안내**이고(`RedemptionForm`) 여기는 규칙만 적는다.
             *
             * 그리고 「다음 도래 차수」라고 적는 것이 정확하다 — 적용 차수는
             * `nextEvaluation`이 내므로(RD-02) 보통 **아직 오지 않은** 차수다.
             * 방금 지난 차수를 기록하러 온 사용자는 차수를 바꿔야 한다.
             */
            <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
              다음 도래 차수 기준의 <strong>추정값</strong>을 채웠다.{' '}
              <strong>차수를 바꾸면 상환일·실수령액·과세 금융소득을 그 차수 기준으로 다시 채운다.</strong>{' '}
              증권사 거래내역의 실제 값으로 고친다 — 저장되는 것은 여기 적힌 값이다.
            </p>
          )}

          {view.schedules.length === 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              평가일정이 0건이다. 조기상환·리자드상환은 차수가 실재해야 하므로(I-13)
              거부된다 — 만기 상환으로 기록하거나 수정 화면에서 일정을 먼저 복구한다.
            </p>
          )}

          <RedemptionForm
            action={redemptionFormAction}
            initialValues={redemptionDefaults(view, getAsOf())}
            rounds={roundOptionsOf(view)}
            productId={id}
            submitLabel="상환 저장"
          />
        </>
      )}
    </section>
  )
}
