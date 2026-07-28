'use server'

import { redirect } from 'next/navigation'

import { getAuth } from '@/lib/db/server'

/**
 * 인증 서버 액션 — SCR-001 / 셸 로그아웃
 *
 * **`src/app/actions.ts`가 아니다.** 그 파일은 DOC-011 §5의 열한 계약을 1:1로
 * 노출하는 것이 불변식이고(그 파일의 docblock), 인증은 그 열하나가 아니다.
 *
 * 여기도 위임만 둔다. 같은 이유다 — 이 파일은 `getAuth()`를 거쳐 `server.ts`를
 * 끌어오므로 어떤 스위트의 import 그래프에도 들어가지 못한다(AQ-23). 로직을
 * 두면 그만큼이 미검증으로 남으므로, 검증 가능한 것은 전부 `lib/auth/session.ts`에
 * 있다.
 */

/** 로그인 폼의 왕복 상태. 실패해도 이메일은 보존한다(비밀번호는 보존하지 않는다). */
export type LoginState = {
  email: string
  message?: string
  fields?: Record<string, string>
}

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const result = await (await getAuth()).signIn({ email, password })

  if (!result.ok) {
    return { email, message: result.error.message, fields: result.error.fields }
  }

  // `redirect()`는 NEXT_REDIRECT를 던지므로 성공 분기의 **마지막**에, try/catch
  // 밖에서 부른다. 위 블록 안에 있으면 성공이 오류로 잡힌다.
  redirect('/')
}

export async function signOutAction(): Promise<void> {
  await (await getAuth()).signOut()
  redirect('/login')
}
