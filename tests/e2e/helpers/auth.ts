import { expect } from 'vitest'

import { signIn } from '@/lib/auth/session'

import {
  ITG_EMAIL,
  ITG_PASSWORD,
  ITG_USER_A,
  type ItgUser,
} from '../../integration/helpers/fixtures'
import { cookieJar } from './server'

/**
 * 브라우저가 로그인 후 갖게 될 쿠키 jar.
 *
 * `signIn`이 어댑터를 인자로 받으므로(프레임워크 비의존) 메모리 jar를 넘겨
 * 실제 GoTrue 왕복의 결과를 그대로 받는다. 서버 액션을 HTTP로 부르지 않는
 * 이유는 그것이 RSC 인코딩에 의존하기 때문이다 — 여기서 필요한 것은 **결과
 * 상태**뿐이다.
 *
 * **둘째 사용자가 컷 5에서 필요해졌다.** 소유자 전용 라우트가 처음 생겼고(수정)
 * SCR-902에 도달하는 유일한 길이 「그 주소를 직접 타이핑」이므로, 타인의 상품으로
 * 그 경로를 밟아야 화면이 실제로 그것을 막는지 알 수 있다.
 */
export async function authenticatedJar(
  user: ItgUser = ITG_USER_A,
): Promise<ReturnType<typeof cookieJar>> {
  const cookies = new Map<string, string>()
  const result = await signIn(
    { email: ITG_EMAIL[user], password: ITG_PASSWORD },
    {
      getAll: () => [...cookies.entries()].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          if (value === '') cookies.delete(name)
          else cookies.set(name, value)
        }
      },
    },
  )
  expect(result.ok, '시드 사용자 로그인이 실패했다').toBe(true)
  return cookieJar(Object.fromEntries(cookies))
}
