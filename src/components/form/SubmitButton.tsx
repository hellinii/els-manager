'use client'

import { useFormStatus } from 'react-dom'

/**
 * 제출 버튼 — 진행 중 상태를 스스로 안다
 *
 * **`useFormStatus`는 폼의 자손에서만 동작한다.** 폼을 렌더하는 컴포넌트에서
 * 부르면 항상 `pending: false`이고, 그러면 사용자가 같은 폼을 두 번 제출한다 —
 * `saveManualPrice`는 UPSERT라 결과가 같지만 `createAsset`은 `CONFLICT`가 되고
 * 사용자는 자기가 방금 만든 것과 충돌한다. 별 컴포넌트인 이유가 이것이므로
 * 인라인으로 되돌리지 않는다.
 *
 * DOC-008 §6의 로딩 상태(「저장 중」·「갱신 중」)가 여기서 나온다.
 */

export function SubmitButton({
  label,
  pendingLabel,
  variant = 'primary',
  fullWidth = false,
}: {
  label: string
  pendingLabel: string
  variant?: 'primary' | 'secondary'
  fullWidth?: boolean
}) {
  const { pending } = useFormStatus()

  const styles =
    variant === 'primary'
      ? 'bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-400'
      : 'border border-neutral-300 hover:bg-neutral-100 disabled:text-neutral-400'

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${styles}${
        fullWidth ? ' w-full' : ''
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
