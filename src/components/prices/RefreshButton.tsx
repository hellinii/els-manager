'use client'

import { useActionState } from 'react'

import { refreshPricesAction } from '@/app/(app)/prices/actions'
import { SubmitButton } from '@/components/form/SubmitButton'
import { initialFormState, type FormState } from '@/lib/forms/state'

/**
 * 전체 갱신 — §5.8. **실패가 오류로 보이면 안 된다** (ST-03)
 *
 * 공급자가 0개인 동안 이 계약은 항상 `PROVIDER_UNAVAILABLE`을 준다(AQ-01 미결).
 * `ok: true` + `succeeded: 0`이 아닌 이유가 화면 처리다 — 전자는 폴백 안내이고
 * 후자는 "갱신했으나 대상이 없었다"로 읽힌다.
 *
 * **이 규칙을 지금 만나는 것이 SCR-302를 P4의 첫 화면으로 옮긴 근거 중 하나다**
 * (계획 §3). 「오류 = 빨간 박스」를 먼저 만들고 나중에 만나면 되돌려야 한다.
 *
 * **서버 액션을 감싸지 않고 그대로 넘긴다.** `() => refreshPricesAction()`처럼 클라이언트
 * 화살표로 감싸면 그것은 서버 액션 참조가 아니므로 React가 폼을
 * `action="javascript:throw …"`로 렌더하고 **JS 없이는 아무 일도 일어나지 않는다**
 * (실측 — `tests/e2e/prices.test.ts`가 그 형태를 잡았다). 그래서 액션 쪽이
 * `(prev, formData)` 서명을 지키고 여기서는 참조만 넘긴다.
 *
 * 페이로드 타입이 `FormData`인 것은 `<form action>`이 그것만 받기 때문이다 —
 * `void`로 두면 dispatch가 `(payload: void) => void`가 되어 폼에 넣을 수 없다.
 */

export function RefreshButton() {
  const [state, formAction] = useActionState<FormState, FormData>(
    refreshPricesAction,
    initialFormState(),
  )

  const notice = state.code === 'PROVIDER_UNAVAILABLE'

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <form action={formAction}>
        <SubmitButton label="전체 갱신" pendingLabel="갱신 중…" variant="secondary" />
      </form>

      {state.message != null && (
        <p
          /*
           * `alert`가 아니라 `status`다 — 폴백 안내는 경보가 아니다. 진짜 오류
           * (`INTERNAL`: 공급자가 등록되었는데 수집 로직이 없는 배포 결함)만
           * 경보로 읽는다.
           */
          role={notice || state.status === 'OK' ? 'status' : 'alert'}
          className={`text-sm ${
            notice
              ? 'text-amber-900'
              : state.status === 'OK'
                ? 'text-emerald-700'
                : 'text-red-700'
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  )
}
