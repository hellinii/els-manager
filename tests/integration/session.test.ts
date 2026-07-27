import { describe, expect, it } from 'vitest'

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

  it('두 번째 인자(응답 헤더)를 받아도 던지지 않는다', () => {
    // setAll의 2번째 인자는 `Cache-Control: private, no-cache, no-store` 등
    // **응답에 반드시 실려야 하는 헤더**다. 실리지 않으면 CDN·리버스 프록시가
    // 인증 쿠키가 담긴 응답을 캐시해 **한 사용자의 세션 토큰이 다른 사용자에게
    // 나갈 수 있다**(라이브러리 주석). 서버 컴포넌트 경로는 쿠키를 아예 쓰지
    // 않으므로 헤더도 필요 없지만, **P4의 middleware는 반드시 적용해야 한다.**
    const adapter = readOnlyCookieAdapter(() => [])
    expect(() =>
      adapter.setAll!(
        [{ name: 'sb-x', value: 'y', options: {} }],
        { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0' },
      ),
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
