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
  name,
  value,
}: {
  label: string
  pendingLabel: string
  variant?: 'primary' | 'secondary'
  fullWidth?: boolean
  /**
   * 제출 버튼도 값을 나른다 — SCR-204의 단계 전이가 그것으로 표현된다
   * (`name="intent" value="NEXT"`).
   *
   * **`onClick`으로 상태를 바꾸지 않는 이유**는 컷 1b가 실측한 것과 같다: 클릭
   * 처리기에 의미를 두면 JS 없이 누른 버튼이 아무 일도 하지 않는다. 버튼의
   * `name`·`value`는 브라우저가 제출에 싣는 표준 동작이므로 두 경로에서 같다.
   */
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()

  const styles =
    variant === 'primary'
      ? 'bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-400'
      : 'border border-neutral-300 hover:bg-neutral-100 disabled:text-neutral-400'

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${styles}${
        fullWidth ? ' w-full' : ''
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
