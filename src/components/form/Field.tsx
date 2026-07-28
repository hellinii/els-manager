/**
 * 입력 한 칸 — 라벨·입력·오류를 **한 이름으로** 묶는다
 *
 * `name`이 세 가지를 동시에 정한다: 폼 전송 키, `fieldErrors`의 조회 키(§3.1이
 * `fields`를 "계약 입력의 필드 이름"으로 정의했다), `htmlFor`/`id`의 짝.
 * 세 곳에 각자 적으면 오류가 표시되지 않는 칸이 생기고, **표시되지 않는 오류는
 * "저장이 안 되는데 아무 말도 없다"가 된다.**
 *
 * `aria-invalid`·`aria-describedby`를 자동으로 이어 주므로 접근성 배선을 칸마다
 * 기억하지 않는다.
 */

export function Field({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: string
  label: string
  /** `fieldErrors[name]`을 그대로 넘긴다. */
  error?: string
  hint?: string
  /** 입력 요소. `id`·`name`·`aria-*`는 이 컴포넌트가 붙인다. */
  children: (props: {
    id: string
    name: string
    'aria-invalid': boolean
    'aria-describedby': string | undefined
  }) => React.ReactNode
}) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  const described = [error != null ? errorId : null, hint != null ? hintId : null]
    .filter((v) => v != null)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>

      {children({
        id: name,
        name,
        'aria-invalid': error != null,
        'aria-describedby': described === '' ? undefined : described,
      })}

      {hint != null && (
        <p id={hintId} className="text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error != null && (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/** 공통 입력 스타일. 칸마다 클래스를 적으면 한 칸이 다르게 보이는 날이 온다. */
export const INPUT_CLASS =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none aria-[invalid=true]:border-red-400'
