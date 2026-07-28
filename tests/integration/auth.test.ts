import { describe, expect, it } from 'vitest'

import { signIn, signOut } from '@/lib/auth/session'

import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A } from './helpers/fixtures'

/**
 * SCR-001의 인증 계약 — `src/lib/auth/session.ts`
 *
 * `getAuth()`(Next 결선)는 여기서 볼 수 없다(AQ-23 — `next`를 import하는 파일은
 * 테스트 그래프 밖이다). 그래서 결선을 위임만으로 남기고 **판단이 있는 부분을
 * 전부 이 모듈에 두었다.** 여기가 그것을 실제 GoTrue 대상으로 본다.
 */

type Cookie = { name: string; value: string }

function memoryCookieJar() {
  const jar = new Map<string, string>()
  return {
    adapter: {
      getAll: (): Cookie[] =>
        [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies: Array<{ name: string; value: string }>): void => {
        for (const { name, value } of cookies) {
          if (value === '') jar.delete(name)
          else jar.set(name, value)
        }
      },
    },
    size: () => jar.size,
  }
}

describe('signIn', () => {
  it('올바른 자격이면 세션 쿠키가 jar에 실린다', async () => {
    const jar = memoryCookieJar()

    const result = await signIn(
      { email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD },
      jar.adapter,
    )

    expect(result.ok).toBe(true)
    expect(jar.size()).toBeGreaterThan(0)
  })

  it('이메일 앞뒤 공백을 다듬는다', async () => {
    const jar = memoryCookieJar()

    const result = await signIn(
      { email: `  ${ITG_EMAIL[ITG_USER_A]}  `, password: ITG_PASSWORD },
      jar.adapter,
    )

    expect(result.ok).toBe(true)
  })

  it('비밀번호가 틀리면 VALIDATION_FAILED이고 쿠키를 하나도 쓰지 않는다', async () => {
    const jar = memoryCookieJar()

    const result = await signIn(
      { email: ITG_EMAIL[ITG_USER_A], password: 'wrong-password' },
      jar.adapter,
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    // 실패가 부분적으로 세션을 남기지 않는다.
    expect(jar.size()).toBe(0)
  })

  it('없는 사용자와 틀린 비밀번호가 같은 **우리 문구**를 준다 — 이메일 열거 금지', async () => {
    /*
     * 구분하면 "그 계정은 존재한다"가 확인 가능해진다. 폐쇄형 초대 서비스에서
     * 그것은 그 자체로 정보다 — SEC-03이 공개 가입을 막은 것과 같은 축이다.
     *
     * **두 결과가 같다는 것만으로는 부족하다.** 음성 대조에서 드러났다 —
     * `error.message`를 그대로 통과시켜도 이 테스트가 통과했다. GoTrue가 두
     * 경우에 같은 영문 문구를 주기 때문이며, 즉 그 단언은 **우리 코드가 아니라
     * GoTrue의 균일성**을 보고 있었다. 매핑을 통째로 지워도 초록이었다.
     *
     * 그래서 문구를 정확히 고정한다. 보장은 두 겹이다 — GoTrue가 균일해야 하고
     * (앞의 단언) 우리가 거기에 세부를 덧붙이지 않아야 한다(뒤의 단언).
     * 원문 통과는 한글 UI에 영문 내부 문구를 내보내는 일이기도 하다.
     */
    const INVALID = '이메일 또는 비밀번호가 올바르지 않다.'

    const wrongPassword = await signIn(
      { email: ITG_EMAIL[ITG_USER_A], password: 'wrong-password' },
      memoryCookieJar().adapter,
    )
    const noSuchUser = await signIn(
      { email: 'nobody@example.test', password: 'wrong-password' },
      memoryCookieJar().adapter,
    )

    expect(wrongPassword.ok).toBe(false)
    expect(noSuchUser.ok).toBe(false)
    if (wrongPassword.ok || noSuchUser.ok) return

    expect(noSuchUser.error.message).toBe(wrongPassword.error.message)
    expect(noSuchUser.error.code).toBe(wrongPassword.error.code)
    expect(wrongPassword.error.message).toBe(INVALID)
    expect(wrongPassword.error.code).toBe('VALIDATION_FAILED')
  })

  it('빈 입력은 GoTrue에 보내지 않고 필드별 오류를 준다', async () => {
    // GoTrue는 어느 쪽이 비었는지 알려주지 않고 invalid_credentials 하나로
    // 답한다. 필드별 표시는 여기서만 가능하다.
    const result = await signIn({ email: '', password: '' }, memoryCookieJar().adapter)

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fields: { email: expect.any(String), password: expect.any(String) },
      },
    })
  })

  it('공백만 있는 이메일도 부재로 취급한다', async () => {
    const result = await signIn(
      { email: '   ', password: ITG_PASSWORD },
      memoryCookieJar().adapter,
    )

    expect(result).toMatchObject({
      ok: false,
      error: { fields: { email: expect.any(String) } },
    })
  })
})

describe('signOut — 쿠키 삭제 경로의 유일한 소비자', () => {
  it('jar를 비운다', async () => {
    const jar = memoryCookieJar()
    await signIn(
      { email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD },
      jar.adapter,
    )
    expect(jar.size()).toBeGreaterThan(0)

    const result = await signOut(jar.adapter)

    expect(result.ok).toBe(true)
    // 갱신은 값을 덮어쓰지만 삭제는 **빈 값을 싣는 다른 경로**다. 여기가 아니면
    // 어디서도 실행되지 않으며, 깨지면 브라우저가 죽은 쿠키를 계속 보낸다.
    expect(jar.size()).toBe(0)
  })

  it('비운 jar로는 더 이상 인증되지 않는다', async () => {
    const jar = memoryCookieJar()
    await signIn(
      { email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD },
      jar.adapter,
    )
    await signOut(jar.adapter)

    const { createSessionClient } = await import('@/lib/db/client')
    const after = createSessionClient(jar.adapter)
    const { data } = await after.auth.getUser()

    expect(data.user).toBeNull()
  })

  it('세션이 없어도 실패로 보고하지 않는다', async () => {
    // 이미 로그아웃된 상태에서 다시 눌러도 사용자는 로그아웃 화면으로 가야 한다.
    const result = await signOut(memoryCookieJar().adapter)
    expect(result.ok).toBe(true)
  })
})
