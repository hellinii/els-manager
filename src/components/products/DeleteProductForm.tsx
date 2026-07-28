'use client'

import { useActionState } from 'react'

import { deleteProductAction } from '@/app/(app)/products/[id]/actions'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { initialFormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'

/**
 * §5.3 상품 삭제 — **확인은 JS 없는 2단 공개다** (SCR-202, P4 컷 5)
 *
 * ## 왜 `confirm()`이 아닌가
 *
 * DOC-011 §5.5는 상품 삭제를 2단계로 둔 이유를 「사용자가 과세 이력을 지운다는 사실을
 * 명시적으로 확인한다」로 적고 두 단계가 **서로 다른 것을 말해야** 한다고 규정한다
 * (첫 단계는 「이 해의 금융소득이 바뀐다」, 둘째는 「상품이 사라진다」). `confirm()`은
 * JS를 요구하므로 JS 없는 경로에서 확인 없이 지워지고, 별 라우트는 DOC-008 §4에 없는
 * 화면을 하나 만든다.
 *
 * `<details>`는 둘 다 피한다 — 펼치는 행위가 첫 단계이고, 접힌 내용이 **DOM에 있으므로**
 * 제출이 성립한다. SCR-204의 차수별 리자드 칸이 같은 이유로 `<details>`다.
 *
 * ## 오류 문구는 공개 **바깥**에 있다
 *
 * JS 없는 제출의 응답은 **새 문서**이므로 `<details>`가 접힌 상태로 렌더된다. 안에
 * 두면 `CONFLICT`("상환을 먼저 취소한다")가 접힌 채로 나와 「삭제가 안 되는데 아무
 * 표시도 없다」가 된다 — 컷 4b가 단계 폼에서 같은 형태를 막은 자리다.
 *
 * ## 링크가 아니라 폼이다
 *
 * 삭제는 상태를 바꾸므로 GET일 수 없다. 링크로 두면 프리페치·크롤러가 상품을 지운다.
 */

export function DeleteProductForm({
  productId,
  productName,
}: {
  productId: string
  productName: string
}) {
  const [state, formAction] = useActionState(deleteProductAction, initialFormState())

  return (
    <div className="flex flex-col gap-2">
      {/* 접힘 밖이다 — 위 각주 참조 */}
      <FormMessage state={state} />

      <details className="rounded-lg border border-red-200 bg-red-50/40 p-3">
        <summary className="cursor-pointer text-sm font-medium text-red-800">
          이 상품을 삭제한다
        </summary>

        <p className="mt-2 text-sm text-neutral-700">
          {productName}과(와) 그 기초자산·평가일정이 함께 사라진다. 되돌릴 수 없다.
        </p>
        <p className="mt-1 text-xs text-neutral-600">
          상환 실적이 있으면 삭제되지 않는다 — 실현된 과세 이력이 조작 한 번으로
          사라지지 않게 상환 취소를 먼저 요구한다(DOC-011 §5.3).
        </p>

        <form action={formAction} className="mt-3">
          <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
          <SubmitButton
            label="정말 삭제한다"
            pendingLabel="삭제 중…"
            variant="danger"
          />
        </form>
      </details>
    </div>
  )
}
