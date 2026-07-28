import { beforeAll, describe, expect, it } from 'vitest'

import { signIn } from '@/lib/auth/session'

import {
  ITG_EMAIL,
  ITG_PASSWORD,
  ITG_USER_A,
} from '../integration/helpers/fixtures'
import { BASE_URL, cookieJar, get, locationPath } from './helpers/server'

/**
 * 프록시의 게이트와 응답 헤더 — P4 선행 조건 ②·④를 실 HTTP에서 본다
 *
 * 여기서만 볼 수 있는 것 셋:
 *  ① 리다이렉트 상태 코드와 `Location` — Next를 지나야 존재한다
 *  ② 응답에 실제로 실린 `Set-Cookie`와 캐시 금지 헤더 — 누산기 단위 시험은
 *    우리 코드가 옮기는 것까지만 보고 그 뒤 Next의 동작은 보지 못한다
 *  ③ 매처 예외(`api/cron`)가 실제로 동작하는지
 */

/** 로그인해서 브라우저가 가질 쿠키를 만든다. `signIn`은 어댑터를 인자로 받는다. */
async function authenticatedJar() {
  const cookies = new Map<string, string>()
  const result = await signIn(
    { email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD },
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

describe('미인증 게이트', () => {
  it('보호 경로는 /login으로 307한다', async () => {
    for (const path of ['/', '/products', '/tax', '/does-not-exist']) {
      const res = await get(path)
      expect(res.status, `${path}가 리다이렉트되지 않았다`).toBe(307)
      expect(locationPath(res)).toBe('/login')
    }
  })

  it('/login 자체는 통과한다 — 리다이렉트 루프가 없다', async () => {
    const res = await get('/login')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('로그인')
  })

  it('api/cron은 매처 밖이다 — Cron이 /login으로 튕기지 않는다', async () => {
    /*
     * 프록시가 이 경로를 잡으면 Vercel Cron이 307을 받고 DOC-011 §7.1의
     * CR-01(토큰 불일치 시 401)이 **영원히 실행되지 않는다.** 배치가 조용히
     * 죽는 종류라 지금 고정한다. 라우트는 아직 없으므로(P5) 404가 정답이며,
     * 307이면 매처 결함이다.
     */
    const res = await get('/api/cron/prices')
    expect(res.status).not.toBe(307)
    expect(res.status).toBe(404)
  })
})

describe('인증 게이트', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('보호 경로가 열린다', async () => {
    const res = await get('/', jar)
    expect(res.status).toBe(200)
  })

  it('/login에 오면 홈으로 307한다', async () => {
    const res = await get('/login', jar)
    expect(res.status).toBe(307)
    expect(locationPath(res)).toBe('/')
  })

  it('없는 경로는 404다 — SCR-901', async () => {
    const res = await get('/does-not-exist', jar)
    expect(res.status).toBe(404)
    // 문구까지 본다. 상태 코드만 보면 Next 기본 화면과 구분되지 않는다.
    expect(await res.text()).toContain('페이지를 찾을 수 없다')
  })
})

describe('④ 캐시 금지 헤더 — 갱신이 일어난 응답', () => {
  it('쿠키를 싣는 응답에는 세 헤더가 함께 실린다', async () => {
    /*
     * 프록시가 갱신을 저장하는 응답이 CDN·리버스 프록시에 캐시되면 **한 사용자의
     * 세션 토큰이 다른 사용자에게 나간다.** 그 위험이 가정이 아님은 컷 0a에서
     * 관측했다 — 같은 경로가 `Cache-Control: s-maxage=31536000`으로 나온다.
     *
     * 여기서는 만료 직전 세션을 만들 수 없으므로(서버의 시계를 조작할 수 없다)
     * **갱신이 일어난 경우에만** 단언한다. 갱신이 없으면 `Set-Cookie`도 없는
     * 것이 정상이고, 그 사실 자체를 조건으로 쓴다 — 억지로 초록을 만들지 않는다.
     *
     * 갱신 경로의 항상-검증은 `tests/integration/session.test.ts`(실제 갱신을
     * 강제한다)와 `tests/auth/responseCookies.test.ts`(헤더 전달)가 맡는다.
     */
    const jar = await authenticatedJar()
    const res = await get('/', jar)

    const setCookie = res.headers.getSetCookie()
    if (setCookie.length === 0) {
      expect(res.status).toBe(200) // 갱신 없음 — 정상 경로
      return
    }

    expect(res.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, must-revalidate, max-age=0',
    )
    expect(res.headers.get('expires')).toBe('0')
    expect(res.headers.get('pragma')).toBe('no-cache')
  })
})

describe('로그아웃 왕복', () => {
  it('로그아웃하면 쿠키가 지워지고 다시 게이트에 걸린다', async () => {
    const jar = await authenticatedJar()
    expect(jar.size()).toBeGreaterThan(0)
    expect((await get('/', jar)).status).toBe(200)

    /*
     * 서버 액션을 HTTP로 직접 부르는 것은 RSC 인코딩에 의존하므로 하지 않는다.
     * 대신 **브라우저가 그 결과로 갖게 될 상태**(빈 jar)를 만들어 게이트가
     * 그것을 어떻게 다루는지 본다. 삭제 자체는
     * `tests/integration/auth.test.ts`가 실제 `signOut`으로 본다 — 각 층이
     * 자기가 볼 수 있는 것만 본다.
     */
    const emptied = cookieJar()
    const res = await get('/', emptied)
    expect(res.status).toBe(307)
    expect(locationPath(res)).toBe('/login')
  })
})

describe('정적 자산은 매처 밖이다', () => {
  it('favicon은 리다이렉트되지 않는다', async () => {
    const res = await fetch(`${BASE_URL}/favicon.ico`, { redirect: 'manual' })
    expect(res.status).toBe(200)
  })
})
