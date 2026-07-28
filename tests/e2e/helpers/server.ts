import { spawn, type ChildProcess } from 'node:child_process'

/** 로컬 개발 포트(3000)와 겹치지 않게 둔다 — 켜 둔 채 스위트를 돌릴 수 있어야 한다. */
export const E2E_PORT = 3100
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`

let server: ChildProcess | null = null

export async function startServer(): Promise<void> {
  server = spawn('npx', ['next', 'start', '-p', String(E2E_PORT)], {
    stdio: 'pipe',
    env: process.env,
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      // `/login`은 미인증에서 200이므로 준비 확인에 쓰기 좋다.
      const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' })
      if (res.status === 200) return
    } catch {
      // 아직 안 떴다
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(
    `next start가 ${E2E_PORT}에서 준비되지 않았다.\n` +
      `  포트가 이미 쓰이고 있는지 확인한다: lsof -i :${E2E_PORT}`,
  )
}

export async function stopServer(): Promise<void> {
  if (server == null) return
  server.kill('SIGTERM')
  server = null
  // 다음 실행이 같은 포트를 잡을 수 있게 잠깐 기다린다.
  await new Promise((r) => setTimeout(r, 500))
}

/**
 * 쿠키 jar. 브라우저를 흉내내되 **`Set-Cookie`의 만료·경로는 해석하지 않는다** —
 * 이 스위트가 보는 것은 "쿠키가 실렸는가"이지 브라우저의 저장 규칙이 아니다.
 */
export function cookieJar(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial))

  return {
    header: (): string =>
      [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (res: Response): void => {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(';')
        const eq = pair?.indexOf('=') ?? -1
        if (pair == null || eq < 0) continue
        const name = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        if (value === '') jar.delete(name)
        else jar.set(name, value)
      }
    },
    names: (): string[] => [...jar.keys()],
    size: (): number => jar.size,
  }
}

/** 리다이렉트를 따라가지 않는다 — 상태 코드와 Location 자체가 관측 대상이다. */
export function get(
  path: string,
  jar?: ReturnType<typeof cookieJar>,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: jar == null ? {} : { Cookie: jar.header() },
  })
}

/**
 * `Location`의 경로 부분.
 *
 * **Next는 같은 출처 리다이렉트의 `Location`을 상대 경로로 내려보낸다** —
 * `NextResponse.redirect(new URL('/login', request.url))`로 절대 URL을 주어도
 * 응답 헤더에는 `location: /login`이 실린다(실측). `new URL()`에 그대로 넣으면
 * `Invalid URL`이므로 base를 함께 준다.
 *
 * curl의 `%{redirect_url}`은 이것을 절대 URL로 해석해 보여주므로 그쪽으로
 * 확인하면 차이가 드러나지 않는다 — 실제로 그렇게 놓쳤다.
 */
export function locationPath(res: Response): string {
  const location = res.headers.get('location')
  if (location == null) throw new Error('Location 헤더가 없다')
  return new URL(location, BASE_URL).pathname
}
