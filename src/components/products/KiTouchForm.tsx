'use client'

import { useActionState } from 'react'

import { setKiTouchedAction } from '@/app/(app)/products/[id]/actions'
import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { initialFormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'

/**
 * §5.9 KI 터치 확정 — **사용자의 조치다. 시스템이 자동 확정하지 않는다** (D-04)
 *
 * 일 배치 종가 수집으로는 `CONTINUOUS` 관찰의 장중 터치를 확인할 수 없다. 그래서
 * 계약은 수집 시세로 하회가 관측된 상태를 **후보**(`kiStatus = 'BELOW'`)로만 표시하고
 * 확정은 이 폼이 한다 — AQ-24가 필터를 5값으로 넓힌 이유가 그 상태를 목록에서 고를 수
 * 있게 하는 것이었고, 여기가 그 조치의 도착지다.
 *
 * ## 해제는 「비우고 저장」이다 — 버튼이 아니다
 *
 * 계약의 두 번째 인자가 `string | null`이고 `null`이 해제다. 버튼으로 의도를 나르면
 * (`intent=CLEAR`) 같은 폼에 두 동작이 생기는데, 실제로는 한 동작(값의 설정)이고
 * 빈 값이 그 동작의 정상적인 한 경우다. 그 변환은 순수 모듈에 있다
 * (`parseTouchedAtForm`) — 빈 칸을 `''`로 넘기면 「YYYY-MM-DD 형식이 아니다」가 되어
 * **해제할 방법이 없어진다.**
 *
 * ## `max`를 두지 않는다
 *
 * V-17은 시세에만 걸린다(§5.9 v0.9). 터치 확정일은 증권사 통지에서 옮겨 적는 외부
 * 사실이고 기준일보다 앞선 날짜는 **관측일과 통지일의 시차**일 수 있다. 판정에서도
 * `ki_touched_at`은 존재 여부만 쓰이므로(DOC-007 §3.4) 미래 일자가 판정을 틀리게
 * 만드는 경로가 없다 — 시세와 다른 점이다.
 */

export function KiTouchForm({
  productId,
  touchedAt,
}: {
  productId: string
  /** 저장된 확정일. `null`이면 미확정이다 */
  touchedAt: string | null
}) {
  const [state, formAction] = useActionState(
    setKiTouchedAction,
    initialFormState({ kiTouchedAt: touchedAt ?? '' }),
  )

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field
            name="kiTouchedAt"
            label="터치 확정일"
            error={state.fieldErrors.kiTouchedAt}
            hint="비우고 저장하면 해제된다"
          >
            {(props) => (
              <input
                {...props}
                type="date"
                defaultValue={state.values.kiTouchedAt ?? ''}
                className={`${INPUT_CLASS} w-full`}
              />
            )}
          </Field>
        </div>

        <SubmitButton label="저장" pendingLabel="저장 중…" variant="secondary" />
      </div>

      <p className="text-xs text-neutral-500">
        시스템은 터치를 자동 확정하지 않는다 — 일 종가로는 장중 터치를 확인할 수 없기
        때문이다. 증권사 통지를 받은 날짜를 적는다.
      </p>
    </form>
  )
}
