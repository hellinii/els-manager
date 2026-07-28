'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { signInAction, type LoginState } from '../actions'

/**
 * SCR-001의 폼 — 이 컷의 유일한 클라이언트 컴포넌트.
 *
 * `useActionState`가 실패 결과를 돌려받고 `defaultValue`가 그것을 되살린다.
 * 입력을 비제어로 두는 것이 요점이다 — 제어 컴포넌트로 만들면 하이드레이션
 * 전에 타이핑한 값이 사라진다.
 *
 * 회원가입 링크를 두지 않는다. 폐쇄형 초대 기반이다(DOC-001 A-05).
 */

const INITIAL: LoginState = { email: '' }

function SubmitButton() {
  // useFormStatus는 **폼의 자손**에서만 동작한다. 같은 컴포넌트에서 부르면
  // 항상 pending: false다.
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:bg-neutral-400"
    >
      {pending ? '로그인 중…' : '로그인'}
    </button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message != null && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          // 실패 시 보존된다. 비밀번호는 되돌려주지 않으므로 항상 빈 칸이다.
          defaultValue={state.email}
          aria-invalid={state.fields?.email != null}
          aria-describedby={state.fields?.email != null ? 'email-error' : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        {state.fields?.email != null && (
          <p id="email-error" className="text-sm text-red-700">
            {state.fields.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={state.fields?.password != null}
          aria-describedby={
            state.fields?.password != null ? 'password-error' : undefined
          }
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        {state.fields?.password != null && (
          <p id="password-error" className="text-sm text-red-700">
            {state.fields.password}
          </p>
        )}
      </div>

      <SubmitButton />
    </form>
  )
}
