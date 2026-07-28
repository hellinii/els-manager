'use client'

import { useActionState } from 'react'

import {
  deleteRedemptionAction,
  updateRedemptionAction,
} from '@/app/(app)/products/[id]/actions'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { RedemptionForm } from '@/components/products/RedemptionForm'
import type { RedemptionView } from '@/lib/db/queries/map'
import { REDEMPTION_ID_FIELD, type RoundOption } from '@/lib/forms/redemption'
import { initialFormState } from '@/lib/forms/state'

/**
 * §5.5 상환 수정·취소 — **같은 수준의 확인을 둔다** (SCR-202, P4 컷 6)
 *
 * ## 왜 상세 화면 안인가
 *
 * DOC-011 §8이 두 계약을 SCR-202에 배정한다. 별 라우트를 만들면 DOC-008 §4에 없는
 * 화면이 둘 생기고, 무엇보다 **두 조작의 대상이 지금 보고 있는 그 상환 실적**이므로
 * 값을 옆에 두고 고치는 편이 옳다.
 *
 * ## 둘 다 `<details>` 안이다
 *
 * §5.5는 「실행 전 확인 절차를 둔다」를 취소에만 적었지만, 같은 절이 **수정에도 같은
 * 수준의 확인**을 요구한다(v0.9: "`taxableIncome`·`redemptionDate`를 고치면 §4.6의
 * 연도별 집계가 그대로 바뀌므로 이 계약도 «값을 고치는 일»이 아니다"). 펼치는 행위가
 * 그 확인이고 JS를 요구하지 않는다 — 상품 삭제와 같은 형태다.
 *
 * **문구가 두 단계에서 다르다.** 첫 단계(상환 취소)는 「이 해의 금융소득이 바뀐다」,
 * 둘째 단계(상품 삭제)는 「상품이 사라진다」 — §5.5가 그렇게 규정했고 그 둘이 상품
 * 삭제 2단계의 서로 다른 절반이다.
 *
 * ## 오류·성공 문구는 접힘 **바깥**이다
 *
 * JS 없는 제출의 응답은 새 문서이므로 `<details>`가 접힌 상태로 렌더된다. 안에 두면
 * 결과가 접힌 채로 나와 「눌렀는데 아무 일도 없다」가 된다 — `DeleteProductForm`이
 * 같은 이유로 같은 형태다.
 */

export function RedemptionActions({
  redemption,
  rounds,
  initialValues,
}: {
  redemption: RedemptionView
  rounds: readonly RoundOption[]
  /** `redemptionValuesOf(redemption)` — 저장된 값이다. 추정이 아니다 */
  initialValues: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-lg border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">상환 실적 수정</summary>
        <p className="mt-2 text-sm text-neutral-700">
          확정된 과세 이력을 고치는 일이다 — 과세 금융소득이나 상환일을 바꾸면 그 해의
          금융소득 합계와 세액이 함께 바뀐다.
        </p>
        <div className="mt-3">
          <RedemptionForm
            action={updateRedemptionAction}
            initialValues={initialValues}
            rounds={rounds}
            redemptionId={redemption.id}
            submitLabel="상환 실적 저장"
          />
        </div>
      </details>

      <CancelRedemption redemptionId={redemption.id} />
    </div>
  )
}

/**
 * 상환 취소 — 2단계 삭제의 **첫 단계**.
 *
 * 이 버튼을 지나야 `deleteProduct`가 성공한다(§5.3이 상환 완료 상품을 `CONFLICT`로
 * 막는다). 그 순서가 우연이 아니라 설계이므로 문구가 상품 삭제와 다른 것을 말한다.
 */
function CancelRedemption({ redemptionId }: { redemptionId: string }) {
  const [state, formAction] = useActionState(deleteRedemptionAction, initialFormState())

  return (
    <div className="flex flex-col gap-2">
      {/* 접힘 밖이다 — 새 문서에서 `<details>`가 접히므로 */}
      <FormMessage state={state} />

      <details className="rounded-lg border border-red-200 bg-red-50/40 p-3">
        <summary className="cursor-pointer text-sm font-medium text-red-800">
          상환을 취소한다
        </summary>

        <p className="mt-2 text-sm text-neutral-700">
          <strong className="font-medium">이 해의 금융소득이 바뀐다.</strong> 상환
          실적이 사라지고 상품이 보유중으로 돌아간다 — 그 해의 종합과세 여부와 건강보험료
          산정이 함께 달라진다.
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          상품 자체를 지우려면 이 취소가 먼저다(DOC-011 §5.3). 두 단계로 나눈 이유가
          과세 이력을 지운다는 사실을 명시적으로 확인하는 것이다.
        </p>

        <form action={formAction} className="mt-3">
          <input type="hidden" name={REDEMPTION_ID_FIELD} value={redemptionId} />
          <SubmitButton
            label="상환을 취소한다"
            pendingLabel="취소 중…"
            variant="danger"
          />
        </form>
      </details>
    </div>
  )
}
