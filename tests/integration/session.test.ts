import { EXPIRY_MARGIN_MS } from '@supabase/auth-js/dist/main/lib/constants.js'
import { describe, expect, it, vi } from 'vitest'

import { createSessionClient, readOnlyCookieAdapter } from '@/lib/db/client'

import { resolveAnonKey, resolveApiUrl } from './helpers/env'
import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A } from './helpers/fixtures'

/**
 * `@supabase/ssr` 쿠키 코덱 왕복
 *
 * 한 클라이언트가 세션을 쿠키로 쓰고, **두 번째 클라이언트가 그 쿠키만으로**
 * `getUser()`와 조회를 수행한다. 이것이 P4의 서버 컴포넌트가 실제로 하는 일이며,
 * 쿠키 인코딩·청크 분할·이름 규칙이 어긋나면 여기서만 드러난다.
 *
 * `createTokenClient`로는 이 경로를 검증할 수 없다 — 그쪽은 토큰을 직접 들고
 * 가므로 쿠키를 아예 만들지 않는다.
 */

type Cookie = { name: string; value: string }

/** 메모리 쿠키 저장소. 브라우저·Next의 쿠키 저장소를 흉내낸다. */
function memoryCookieJar() {
  const jar = new Map<string, string>()

  return {
    getAll: (): Cookie[] =>
      [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (cookies: Array<{ name: string; value: string }>): void => {
      for (const { name, value } of cookies) {
        if (value === '') jar.delete(name)
        else jar.set(name, value)
      }
    },
    size: () => jar.size,
    names: () => [...jar.keys()],
  }
}

describe('쿠키 왕복', () => {
  it('쓰기 → 다른 클라이언트가 그 쿠키만으로 getUser()', async () => {
    const jar = memoryCookieJar()

    // ① 로그인하며 세션을 쿠키에 쓴다
    const writer = createSessionClient({
      getAll: jar.getAll,
      setAll: jar.setAll,
    })

    const { error: signInError } = await writer.auth.signInWithPassword({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    })
    expect(signInError).toBeNull()
    expect(jar.size()).toBeGreaterThan(0)

    // ② 완전히 새 클라이언트. 쿠키 외에 아무 상태도 공유하지 않는다.
    const reader = createSessionClient({
      getAll: jar.getAll,
      setAll: jar.setAll,
    })

    const { data, error } = await reader.auth.getUser()
    expect(error).toBeNull()
    expect(data.user?.id).toBe(ITG_USER_A)

    // ③ 그 세션으로 조회가 성립한다 — 토큰이 REST 요청에도 실린다
    const products = await reader.from('els_products').select('id').limit(1)
    expect(products.error).toBeNull()
  })

  it('쿠키가 없으면 getUser()가 사용자를 주지 않는다', async () => {
    const empty = createSessionClient({
      getAll: () => [],
      setAll: () => {},
    })

    const { data } = await empty.auth.getUser()
    expect(data.user).toBeNull()
  })

  it('쿠키가 손상되면 사용자를 주지 않는다 — 조용히 통과하지 않는다', async () => {
    const jar = memoryCookieJar()
    const writer = createSessionClient({ getAll: jar.getAll, setAll: jar.setAll })
    await writer.auth.signInWithPassword({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    })

    const corrupted = jar
      .getAll()
      .map((c) => ({ ...c, value: c.value.slice(0, Math.floor(c.value.length / 2)) }))

    const reader = createSessionClient({
      getAll: () => corrupted,
      setAll: () => {},
    })

    const { data } = await reader.auth.getUser()
    expect(data.user).toBeNull()
  })
})

describe('readOnlyCookieAdapter — 서버 컴포넌트 대응', () => {
  it('setAll이 던지지 않는다', () => {
    // 서버 컴포넌트 렌더 중에는 응답 헤더가 확정되어 쿠키를 쓸 수 없고 Next가
    // 던진다. 삼키지 않으면 **첫 토큰 갱신에서 전 화면이 500**이 된다 —
    // 갱신은 jwt_expiry(1시간) 뒤에 처음 발생하므로 개발 중에는 보이지 않는다.
    const adapter = readOnlyCookieAdapter(() => [])

    expect(() =>
      adapter.setAll!([{ name: 'x', value: 'y', options: {} }], {}),
    ).not.toThrow()
  })

  it('읽기는 주입된 함수를 그대로 쓴다', () => {
    const adapter = readOnlyCookieAdapter(() => [{ name: 'a', value: 'b' }])
    expect(adapter.getAll()).toEqual([{ name: 'a', value: 'b' }])
  })

  it('무연산 setAll로도 조회가 성립한다 — 갱신 없는 요청', async () => {
    const jar = memoryCookieJar()
    const writer = createSessionClient({ getAll: jar.getAll, setAll: jar.setAll })
    await writer.auth.signInWithPassword({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    })

    const serverComponent = createSessionClient(readOnlyCookieAdapter(jar.getAll))
    const { data, error } = await serverComponent.auth.getUser()

    expect(error).toBeNull()
    expect(data.user?.id).toBe(ITG_USER_A)
  })
})

describe('토큰 갱신 — P4 선행 조건 ②·④', () => {
  /**
   * 만료 마진 안으로 시계를 옮겨 **실제 GoTrue 갱신을 일으킨다.**
   *
   * 종전 이 자리에는 "헤더 객체를 손으로 만들어 넘기고 `not.toThrow()`"가 있었다.
   * 어댑터가 인자를 통째로 버려도 통과하는 항진명제였다 — P3a.5가 교체한 것과
   * 같은 부류이므로 교체한다.
   *
   * `Date`만 가짜로 만든다. `fetch`와 `setTimeout`은 진짜여야 실제 왕복이 일어난다.
   */
  const JUMP_MS = 60_000

  it('EXPIRY_MARGIN_MS가 점프 폭보다 크다 — 아래 테스트의 전제', () => {
    /*
     * **이 단언이 없으면 아래 테스트가 조용히 무의미해진다.**
     *
     * 라이브러리가 마진을 60초 이하로 낮추면 점프해도 갱신이 일어나지 않는데,
     * jar에는 로그인 때 받은 유효한 쿠키가 이미 있으므로 "쿠키가 있다"·"세 번째
     * 클라이언트가 인증된다"·"헤더가 왔다"가 **전부 그대로 통과한다.** 교체하려던
     * 항진명제로 되돌아가는 것이다.
     *
     * 그래서 상수 자체를 본다. 값이 바뀌면 여기서 **먼저** 빨간불이 뜬다 —
     * AQ-28이 "신규 함수가 PUBLIC 실행 가능임"을 케이스로 박고 "그 케이스가
     * 실패하면 좋은 소식"이라고 한 것과 같은 자리다.
     */
    expect(EXPIRY_MARGIN_MS).toBeGreaterThan(JUMP_MS)
  })

  it('만료 직전이면 갱신되고, 갱신분이 jar에 저장되며, 헤더 세 개가 함께 온다', async () => {
    const jar = memoryCookieJar()
    const received: Record<string, string>[] = []

    const writer = createSessionClient({
      getAll: jar.getAll,
      setAll: (cookies, headers) => {
        received.push(headers)
        jar.setAll(cookies)
      },
    })

    const { data: signIn } = await writer.auth.signInWithPassword({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    })
    const before = signIn.session!
    const beforeCookies = jar.getAll().map((c) => c.value).join('|')
    received.length = 0

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(before.expires_at! * 1000 - JUMP_MS)

      // 갱신은 getUser() 안에서 일어난다 — `_useSession` → `__loadSession`이
      // `expires_at*1000 - Date.now() < EXPIRY_MARGIN_MS`를 보고 부른다
      // (GoTrueClient.js:2490, 2517).
      const refresher = createSessionClient({
        getAll: jar.getAll,
        setAll: (cookies, headers) => {
          received.push(headers)
          jar.setAll(cookies)
        },
      })
      const { data: after, error } = await refresher.auth.getUser()
      expect(error).toBeNull()
      expect(after.user?.id).toBe(ITG_USER_A)

      const { data: session } = await refresher.auth.getSession()

      // ★ 나머지 단언의 전제다. 먼저 본다.
      expect(
        session.session?.access_token,
        'access_token이 그대로다 — 갱신이 일어나지 않았다. ' +
          `EXPIRY_MARGIN_MS(${EXPIRY_MARGIN_MS}ms) 전제가 깨졌을 수 있다. ` +
          '어댑터의 결함이 아니라 점프 폭을 다시 정해야 한다는 뜻이다.',
      ).not.toBe(before.access_token)

      // 갱신분이 실제로 저장되었다 — ②가 막으려는 것이 정확히 이것의 부재다
      expect(jar.getAll().map((c) => c.value).join('|')).not.toBe(beforeCookies)

      // ④ — 라이브러리가 실제로 넘긴 헤더. 우리가 만든 객체가 아니다.
      expect(received.length).toBeGreaterThan(0)
      expect(received.at(-1)).toMatchObject({
        'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
        Expires: '0',
        Pragma: 'no-cache',
      })
    } finally {
      vi.useRealTimers()
    }

    // 갱신 후 jar **만으로** 새 클라이언트가 같은 사용자로 인증된다.
    const fresh = createSessionClient(readOnlyCookieAdapter(jar.getAll))
    const { data: reread } = await fresh.auth.getUser()
    expect(reread.user?.id).toBe(ITG_USER_A)
  })

  it('무연산 어댑터로 갱신하면 갱신분이 유실된다 — ②의 대조군', async () => {
    /*
     * 서버 컴포넌트 경로가 지금 하는 일 그대로다. 갱신은 성공하지만 저장되지
     * 않으므로 **jar가 로그인 직후 상태에 머문다** — 매 요청이 다시 갱신한다.
     * 이 대조군이 초록이어야 위 테스트의 "저장되었다"가 의미를 갖는다.
     */
    const jar = memoryCookieJar()
    const writer = createSessionClient({ getAll: jar.getAll, setAll: jar.setAll })
    const { data: signIn } = await writer.auth.signInWithPassword({
      email: ITG_EMAIL[ITG_USER_A],
      password: ITG_PASSWORD,
    })
    const beforeCookies = jar.getAll().map((c) => c.value).join('|')

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(signIn.session!.expires_at! * 1000 - JUMP_MS)

      const serverComponent = createSessionClient(readOnlyCookieAdapter(jar.getAll))
      const { data } = await serverComponent.auth.getUser()
      expect(data.user?.id).toBe(ITG_USER_A) // 갱신 자체는 성공한다
    } finally {
      vi.useRealTimers()
    }

    // 그런데 저장되지 않았다.
    expect(jar.getAll().map((c) => c.value).join('|')).toBe(beforeCookies)
  })
})

describe('createTokenClient는 auth를 쓸 수 없다 — 실측된 제약', () => {
  it('accessToken 옵션을 주면 .auth 접근이 던진다', async () => {
    const { createTokenClient } = await import('@/lib/db/client')
    const { signIn } = await import('./helpers/auth')

    const db = createTokenClient(await signIn(ITG_USER_A))

    // supabase-js가 auth를 Proxy로 대체한다. 두 클라이언트의 용도를 겸하면
    // 런타임에서만 드러나므로 그 사실을 테스트로 고정한다.
    expect(() => db.auth.getUser()).toThrow(/accessToken/)

    // 조회는 정상이다
    const { error } = await db.from('els_products').select('id').limit(1)
    expect(error).toBeNull()
  })

  it('빈 토큰으로는 만들 수 없다', async () => {
    const { createTokenClient } = await import('@/lib/db/client')
    expect(() => createTokenClient('   ')).toThrow(/빈 액세스 토큰/)
  })
})

describe('환경변수 부재는 즉시 던진다', () => {
  it('빈 문자열도 부재로 취급한다', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = ''

    try {
      const { supabaseEnv } = await import('@/lib/db/env')
      expect(() => supabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url
    }
  })

  it('정상 환경에서는 값을 준다', async () => {
    const { supabaseEnv } = await import('@/lib/db/env')
    const env = supabaseEnv()

    expect(env.url).toBe(resolveApiUrl())
    expect(env.anonKey).toBe(resolveAnonKey())
  })
})
