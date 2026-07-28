'use client'

import { useActionState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { SubmitButton } from '@/components/form/SubmitButton'

import { signInAction, type LoginState } from '../actions'

/**
 * SCR-001의 폼.
 *
 * `useActionState`가 실패 결과를 돌려받고 `defaultValue`가 그것을 되살린다.
 * 입력을 비제어로 두는 것이 요점이다 — 제어 컴포넌트로 만들면 하이드레이션
 * 전에 타이핑한 값이 사라진다.
 *
 * **컷 1a에서 공통 부품으로 갈았다.** `Field`가 `name`으로 라벨·오류·`aria-*`를
 * 묶고 `SubmitButton`이 `useFormStatus`를 든다. 여기 있던 사본을 지운 이유는
 * 두 벌이 되면 한쪽만 고쳐지기 때문이다 — 이 폼은 `FormState`를 쓰지 않는
 * 유일한 폼이지만(§5의 계약이 아니라 GoTrue를 부른다) 칸의 배선은 같다.
 *
 * 회원가입 링크를 두지 않는다. 폐쇄형 초대 기반이다(DOC-001 A-05).
 */

const INITIAL: LoginState = { email: '' }

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

      <Field name="email" label="이메일" error={state.fields?.email}>
        {(props) => (
          <input
            {...props}
            type="email"
            autoComplete="username"
            // 실패 시 보존된다. 비밀번호는 되돌려주지 않으므로 항상 빈 칸이다.
            defaultValue={state.email}
            className={INPUT_CLASS}
          />
        )}
      </Field>

      <Field name="password" label="비밀번호" error={state.fields?.password}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            className={INPUT_CLASS}
          />
        )}
      </Field>

      <SubmitButton label="로그인" pendingLabel="로그인 중…" fullWidth />
    </form>
  )
}
