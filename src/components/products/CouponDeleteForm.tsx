'use client'

import { useActionState } from 'react'

import { deleteCouponPaymentsAction } from '@/app/(app)/products/[id]/actions'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { COUPON_PAYMENT_IDS_FIELD } from '@/lib/forms/coupons'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'
import { initialFormState } from '@/lib/forms/state'

/**
 * SCR-202 ⑦ 월수익 기록 삭제 — 행 하나 · 전부 (P8 컷 b3, DOC-011 §5.15)
 *
 * ## `<details>` 2단이다 — 과세 이력을 지운다
 *
 * 지급 기록을 지우면 그 달이 추정(지급 가정)으로 돌아가 그 해의 금융소득이 바뀐다. 상환 취소와 같은 부류이므로 같은
 * 수준의 확인을 둔다(DOC-008 SQ-21 ⓔ b3 개정 · `RedemptionActions`). 펼치는 행위가 그 확인이고 JS를 요구하지 않는다.
 *
 * **결과 문구는 접힘 바깥이다** — JS 없는 제출의 응답은 새 문서이므로 `<details>`가 접혀 렌더된다(`RedemptionActions`와
 * 같은 이유).
 */
export function CouponDeleteForm({
  productId,
  ids,
  summary,
}: {
  productId: string
  /** 지울 기록 id — 행이면 하나, 「전부 지우기」면 전부(1..60) */
  ids: readonly string[]
  /** 접힌 머리 — 「삭제」 또는 「월수익 기록 전부 지우기」 */
  summary: string
}) {
  const [state, formAction] = useActionState(deleteCouponPaymentsAction, initialFormState())
  const all = ids.length > 1

  return (
    <div className="flex flex-col gap-2">
      <FormMessage state={state} />
      <details className="rounded-md border border-red-200 bg-red-50/40 px-2 py-1">
        <summary className="cursor-pointer text-xs font-medium text-red-800">{summary}</summary>
        <p className="mt-2 text-xs text-neutral-700">
          <strong className="font-medium">이 해의 금융소득이 바뀐다.</strong>{' '}
          {all
            ? `월수익 지급 기록 ${ids.length}건이 사라지고 그 달들이 다시 추정(지급 가정)으로 돌아간다.`
            : '그 달이 다시 추정(지급 가정)으로 돌아간다.'}
        </p>
        <form action={formAction} className="mt-2 pb-1">
          <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
          {ids.map((id) => (
            <input key={id} type="hidden" name={COUPON_PAYMENT_IDS_FIELD} value={id} />
          ))}
          <SubmitButton label={summary} pendingLabel="지우는 중…" variant="danger" />
        </form>
      </details>
    </div>
  )
}
