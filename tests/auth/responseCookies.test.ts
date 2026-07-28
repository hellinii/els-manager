import { describe, expect, it, vi } from 'vitest'

import {
  createCookieAccumulator,
  responseCookieAdapter,
  type CookieSink,
  type ResponseLike,
} from '@/lib/db/client'

/**
 * 응답 쿠키·헤더 어댑터 — P4 선행 조건 ④의 영구 회귀 게이트
 *
 * ## 왜 이 스위트에 있는가
 *
 * 인증 쿠키를 싣는 응답이 CDN·리버스 프록시에 캐시되면 **한 사용자의 세션
 * 토큰이 다른 사용자에게 나간다.** `@supabase/ssr`은 그것을 막을 헤더 세 개를
 * `setAll`의 두 번째 인자로 주는데, P3b까지 아무도 그것을 쓰지 않았다(DOC-000
 * §3 ④). 프록시가 그 첫 소비자다.
 *
 * 그런데 **프록시 자체는 어떤 스위트도 import할 수 없다**(AQ-23 — `next`를
 * import하는 파일은 테스트 그래프 밖이다). 그래서 위험한 부분을 프레임워크
 * 무관한 두 함수로 빼고 여기서 본다. DB도 Next도 없으므로 **상시로 돈다** —
 * `tests/e2e/`는 수동 실행이라 이 방어가 두 해 뒤에도 살아 있으려면 여기여야 한다.
 *
 * ## 항진명제를 만들지 않기
 *
 * 종전 `tests/integration/session.test.ts`가 헤더 객체를 손수 만들어 넘기고
 * `not.toThrow()`를 단언했다 — 어댑터가 인자를 통째로 버려도 통과한다. 여기서는
 * **sink가 실제로 무엇을 받았는지**를 단언하고, sink가 한 번도 안 불린 경우를
 * 별도 케이스로 고정한다.
 */

/** 라이브러리가 실제로 주는 헤더 — `@supabase/ssr/dist/main/cookies.js:446-450` */
const LIBRARY_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
} as const

function recordingSink() {
  const cookies: { name: string; value: string; options: unknown }[] = []
  const headers: Record<string, string> = {}
  const sink: CookieSink = {
    setCookie: (name, value, options) => void cookies.push({ name, value, options }),
    setHeader: (name, value) => void (headers[name] = value),
  }
  return { sink, cookies, headers }
}

function fakeResponse() {
  const cookies: { name: string; value: string; options: unknown }[] = []
  const headers: Record<string, string> = {}
  const response: ResponseLike = {
    cookies: { set: (name, value, options) => cookies.push({ name, value, options }) },
    headers: { set: (name, value) => void (headers[name] = value) },
  }
  return { response, cookies, headers }
}

const getAll = () => [{ name: 'sb-auth-token', value: 'old' }]

describe('responseCookieAdapter', () => {
  it('cookiesToSet의 모든 항목이 sink에 도달한다', () => {
    const { sink, cookies } = recordingSink()
    const adapter = responseCookieAdapter(getAll, sink)

    adapter.setAll?.(
      [
        { name: 'sb-auth-token.0', value: 'chunk0', options: { path: '/' } },
        { name: 'sb-auth-token.1', value: 'chunk1', options: { path: '/' } },
      ],
      {},
    )

    expect(cookies).toEqual([
      { name: 'sb-auth-token.0', value: 'chunk0', options: { path: '/' } },
      { name: 'sb-auth-token.1', value: 'chunk1', options: { path: '/' } },
    ])
  })

  it('캐시 금지 헤더 세 개가 정확한 값으로 sink에 도달한다', () => {
    const { sink, headers } = recordingSink()
    const adapter = responseCookieAdapter(getAll, sink)

    adapter.setAll?.([{ name: 'x', value: 'y', options: {} }], { ...LIBRARY_HEADERS })

    // 값까지 단언한다. 헤더 이름만 보면 `Cache-Control: public`도 통과한다.
    expect(headers).toEqual({ ...LIBRARY_HEADERS })
  })

  it('삭제 쿠키(빈 값)도 그대로 전달한다', () => {
    const { sink, cookies } = recordingSink()
    const adapter = responseCookieAdapter(getAll, sink)

    // 갱신 실패·로그아웃의 경로다. 이것을 잃으면 브라우저가 죽은 쿠키를 계속 보낸다.
    adapter.setAll?.([{ name: 'sb-auth-token', value: '', options: { maxAge: 0 } }], {})

    expect(cookies).toEqual([
      { name: 'sb-auth-token', value: '', options: { maxAge: 0 } },
    ])
  })

  it('헤더가 빈 객체인 호출에서도 쿠키는 전달된다', () => {
    // 라이브러리의 브라우저 저장소 경로 두 곳이 `{}`를 준다(cookies.js:240·293).
    const { sink, cookies, headers } = recordingSink()
    const adapter = responseCookieAdapter(getAll, sink)

    adapter.setAll?.([{ name: 'a', value: 'b', options: {} }], {})

    expect(cookies).toHaveLength(1)
    expect(headers).toEqual({})
  })

  it('sink가 던져도 삼키고 로그를 남긴다 — 갱신 실패로 요청을 죽이지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = responseCookieAdapter(getAll, {
      setCookie: () => {
        throw new Error('응답이 이미 확정되었다')
      },
      setHeader: () => {},
    })

    expect(() =>
      adapter.setAll?.([{ name: 'a', value: 'b', options: {} }], {}),
    ).not.toThrow()
    expect(spy).toHaveBeenCalledOnce()

    spy.mockRestore()
  })

  it('getAll은 그대로 통과시킨다', () => {
    const { sink } = recordingSink()
    expect(responseCookieAdapter(getAll, sink).getAll()).toEqual([
      { name: 'sb-auth-token', value: 'old' },
    ])
  })
})

describe('createCookieAccumulator', () => {
  it('applyTo가 쿠키와 헤더를 모두 응답으로 옮긴다', () => {
    const acc = createCookieAccumulator()
    const adapter = responseCookieAdapter(getAll, acc.sink)

    adapter.setAll?.([{ name: 'sb-auth-token', value: 'new', options: { path: '/' } }], {
      ...LIBRARY_HEADERS,
    })

    const { response, cookies, headers } = fakeResponse()
    expect(acc.applyTo(response)).toBe(response)
    expect(cookies).toEqual([
      { name: 'sb-auth-token', value: 'new', options: { path: '/' } },
    ])
    expect(headers).toEqual({ ...LIBRARY_HEADERS })
  })

  it('setAll보다 늦게 만들어진 응답에도 옮겨진다 — 리다이렉트가 쿠키를 잃지 않는다', () => {
    // 이 프록시의 실제 순서다: getUser()가 setAll을 발화시키고, 그 결과를 보고
    // 리다이렉트 응답을 만든다. 어댑터가 응답을 직접 들고 있었다면 여기서 유실된다.
    const acc = createCookieAccumulator()
    const adapter = responseCookieAdapter(getAll, acc.sink)

    adapter.setAll?.([{ name: 'sb-auth-token', value: 'refreshed', options: {} }], {
      ...LIBRARY_HEADERS,
    })

    const redirect = fakeResponse() // 발화 이후에 생성된다
    acc.applyTo(redirect.response)

    expect(redirect.cookies).toHaveLength(1)
    expect(redirect.headers['Cache-Control']).toBe(LIBRARY_HEADERS['Cache-Control'])
  })

  it('같은 헤더를 두 번 쓰면 마지막 값이 남는다', () => {
    const acc = createCookieAccumulator()
    acc.sink.setHeader('Cache-Control', 'public, max-age=60')
    acc.sink.setHeader('Cache-Control', LIBRARY_HEADERS['Cache-Control'])

    const { response, headers } = fakeResponse()
    acc.applyTo(response)

    expect(headers['Cache-Control']).toBe(LIBRARY_HEADERS['Cache-Control'])
  })

  it('아무것도 쓰지 않았으면 응답을 건드리지 않는다', () => {
    // 갱신이 없는 요청이 대부분이다. 빈 헤더를 실으면 캐시 정책이 조용히 바뀐다.
    const acc = createCookieAccumulator()
    const { response, cookies, headers } = fakeResponse()

    acc.applyTo(response)

    expect(cookies).toEqual([])
    expect(headers).toEqual({})
  })

  it('applyTo 이후의 쓰기는 유실되며 로그를 남긴다 — 조용히 버리지 않는다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const acc = createCookieAccumulator()
    const first = fakeResponse()
    acc.applyTo(first.response)

    acc.sink.setCookie('late', 'value', {})
    acc.sink.setHeader('Pragma', 'no-cache')

    const second = fakeResponse()
    acc.applyTo(second.response)

    expect(second.cookies).toEqual([])
    expect(second.headers).toEqual({})
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0]?.[0]).toContain("쿠키 'late'")

    spy.mockRestore()
  })
})
