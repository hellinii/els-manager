import { beforeEach, describe, expect, it } from 'vitest'

import { MORE_ITEMS, PATHS } from '@/lib/routes/paths'

import { actionIdOf, formFieldsFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get, locationPath } from './helpers/server'

/**
 * SCR-502 설정 — **쿠키 삭제 경로의 유일한 소비자** (P4 컷 10)
 *
 * ## 이 파일이 여기서만 확인할 수 있는 것
 *
 * 로그아웃은 `tests/integration/auth.test.ts`가 이미 본다 — 그쪽은 `signOut`이 메모리
 * jar를 비우는 것을 확인한다. **여기서 다른 것은 그 사이의 층 전부다**: 서버 액션이
 * 응답에 삭제 쿠키를 실어 보내고, 브라우저가 그것을 흡수해 세션을 잃고, 다음 요청이
 * 프록시에 걸려 `/login`으로 간다. 그 세 단계는 실 HTTP 응답에만 있다.
 *
 * **왜 그것이 중요한가.** 갱신은 값을 덮어쓰지만 삭제는 **빈 값을 싣는 다른 경로**이며
 * (`cookieJar.absorb`가 빈 값을 `delete`로 다루는 이유) 그것이 깨지면 브라우저가 죽은
 * 쿠키를 계속 보낸다. 증상은 「로그아웃했는데 로그인 상태」가 아니라 「영원히 재시도하는
 * 갱신」이므로 조용하다.
 *
 * ## 매 케이스가 새 jar를 받는다
 *
 * 로그아웃이 세션을 **파괴하므로** jar를 공유하면 실행 순서가 결과를 정한다. 다른
 * 파일들이 `beforeAll`을 쓰는 것과 다른 이유가 이것이며, 순서가 데이터인 초록색을
 * 만들지 않는다.
 */

const APP_INFO = '앱 정보'
const DISCLAIMER = '면책 고지'

describe('SCR-502 설정', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeEach(async () => {
    jar = await authenticatedJar()
  })

  it('200으로 서고 두 요소가 있다 — 로그아웃 · 앱 정보·면책', async () => {
    const res = await get(PATHS.settings, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain(APP_INFO)
    expect(html).toContain(DISCLAIMER)
    // 컷 9까지 남아 있던 자리표시 문구가 사라졌다
    expect(html).not.toContain('컷 10에서 더한다')

    /*
     * **투자 권유가 아니라는 문구가 여기 있어야 한다.** SCR-401의 면책은 그 화면의
     * 숫자에 대한 것이고(C-04) 이것은 앱 전체에 대한 것이다 — 세금 화면을 한 번도
     * 열지 않는 사용자도 조건 판정과 예상 수령액을 본다.
     */
    expect(html).toContain('투자 권유가 아니다')
    expect(html).toContain('로그아웃')
  })

  it('표시명 변경이 없다 — v1 보류 (DOC-008 §5 U-03)', async () => {
    /*
     * DB는 허용하지만(`grant update (display_name)`) DOC-011 §5에 계약이 없다.
     * 입력란이 있으면 사용자는 그것이 저장된다고 기대하고, 저장할 곳이 없다.
     * 폼이 하나뿐인 것이 그 사실의 관측 가능한 형태다.
     */
    const html = await (await get(PATHS.settings, jar)).text()
    expect([...html.matchAll(/<form\b/g)]).toHaveLength(1)
    expect(html).not.toContain('name="displayName"')
  })

  it('★ 로그아웃이 세션을 파괴한다 — 삭제 쿠키가 실 응답에 실린다', async () => {
    /*
     * ★ 세 단계를 한 번에 본다: 액션 응답의 삭제 쿠키 → jar가 세션을 잃음 → 다음
     * 요청이 프록시에 걸려 `/login`으로 간다. 앞의 층들(`signOut` 자체·어댑터·
     * 누산기)은 각각 다른 스위트가 보며, **그 사이의 결선은 여기에만 있다.**
     */
    const before = jar.names()
    expect(before.length, '로그인 쿠키가 없다 — 대조가 무효다').toBeGreaterThan(0)

    const page = await (await get(PATHS.settings, jar)).text()
    const actionId = actionIdOf('signOutAction')
    const res = await submitAction(PATHS.settings, jar, formFieldsFor(page, actionId))

    // 액션이 리다이렉트로 끝난다(`signOutAction`이 `/login`으로 보낸다)
    expect([200, 302, 303]).toContain(res.status)
    // ★ jar가 비었다 — `submitAction`이 `Set-Cookie`를 흡수했고 그 값이 빈 문자열이다
    expect(jar.names(), '삭제 쿠키가 실리지 않았다').toEqual([])

    // 그리고 다음 요청은 미인증이다 — 프록시가 잡는다
    const after = await get(PATHS.settings, jar)
    expect(after.status).toBe(307)
    expect(locationPath(after)).toBe(PATHS.login)
  })

  it('셸의 「더보기」가 이 화면을 가리킨다', async () => {
    // §3의 주 네비게이션에 설정 탭이 없으므로(다섯 칸에 들어가지 않는다) 이 화면에
    // 도달하는 경로는 「더보기」뿐이다. 그 링크가 죽으면 로그아웃에 갈 수 없다.
    const html = await (await get(PATHS.home, jar)).text()
    const settings = MORE_ITEMS.find((item) => item.href === PATHS.settings)!
    expect(html).toContain(`href="${settings.href}"`)
  })
})
