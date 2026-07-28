import { beforeAll, describe, expect, it } from 'vitest'

import { MORE_ITEMS, MORE_LABEL, NAV_ITEMS, PATHS } from '@/lib/routes/paths'

import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * 앱 셸 — DOC-008 §3 주 네비게이션 (P4 컷 0d)
 *
 * ## 왜 여기여야 하는가
 *
 * 셸은 **렌더된 HTML로만 존재한다.** 상시 스위트는 렌더하지 않고
 * (`@testing-library`를 들이지 않기로 했다 — 계획 §7의 "새 의존성 0"),
 * PostgREST 스위트는 Next를 지나지 않는다. 그래서 「탭이 실제로 나갔는가」를
 * 볼 수 있는 층이 이 스위트뿐이다.
 *
 * ## 무엇을 증명하고 무엇을 증명하지 못하는가
 *
 * 증명한다: 두 내비게이션이 **같은 5칸**이라는 것(§3: "데스크톱 상단 메뉴 동일
 * 구성"), 활성 표시가 붙는 링크가 정확히 어느 것인지, `/login`에 셸이 **없다**는 것.
 *
 * 증명하지 못한다: 브레이크포인트에서 **어느 쪽이 보이는가.** 그것은 CSS이고
 * 여기서는 클래스 문자열만 보인다 — 클래스를 단언하면 "구현을 구현으로 확인하는"
 * 항진명제가 된다. **AQ-32에 이미 등재된 공백**이며 종결 수단은 Playwright뿐이다.
 * 대신 두 벌이 **함께 나갔음**을 세어 한쪽만 렌더되는 결함은 잡는다.
 */

/** `<a>` 하나를 href·활성표시·텍스트로 줄인다. 클래스는 보지 않는다(위 docblock). */
function anchors(html: string): Array<{
  href: string | null
  current: boolean
  text: string
}> {
  return [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, text]) => ({
    href: /href="([^"]*)"/.exec(attrs ?? '')?.[1] ?? null,
    current: (attrs ?? '').includes('aria-current="page"'),
    text: text ?? '',
  }))
}

/** 텍스트 노드가 정확히 그 라벨인 링크의 개수. `홈`이 `홈으로`를 세지 않게 한다. */
function labelCount(html: string, label: string): number {
  return anchors(html).filter((a) => a.text === label).length
}

describe('셸이 인증 구역에만 걸린다', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('홈에 다섯 칸이 상단·하단 두 벌로 나간다', async () => {
    const res = await get(PATHS.home, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    for (const item of NAV_ITEMS) {
      /*
       * 2다 — 데스크톱 상단과 모바일 하단. 하나면 한쪽 내비게이션이 렌더되지
       * 않은 것이고, 그 결함은 그 브레이크포인트에서만 드러나므로 개발 중에
       * 보이지 않는다. §8의 "동일 구성"을 개수로 고정한다.
       */
      expect(labelCount(html, item.label), `${item.label} 탭`).toBe(2)
    }
    // 「더보기」는 `<summary>`이므로 링크가 아니다. 존재만 확인한다.
    expect(html).toContain(MORE_LABEL)
    // 펼친 항목도 두 벌이다(상단 드롭다운 + 하단 시트).
    for (const item of MORE_ITEMS) {
      expect(labelCount(html, item.label), `${item.label} 메뉴 항목`).toBe(2)
    }
  })

  it('/login에는 셸이 없다', async () => {
    /*
     * ★ 음성 대조의 대상이다. `AppShell`을 `(app)/layout.tsx`가 아니라 루트
     * `layout.tsx`로 옮기면 이 단언이 빨간불이 된다(확인함).
     *
     * 미인증 사용자에게 「상품」·「세금」 탭을 보여주면 누를 수 있는 것처럼
     * 보이고, 누르면 프록시가 다시 로그인으로 돌려보낸다.
     */
    const res = await get(PATHS.login)
    expect(res.status).toBe(200)
    const html = await res.text()

    for (const item of NAV_ITEMS) {
      expect(labelCount(html, item.label), `${item.label}이 로그인 화면에 있다`).toBe(0)
    }
    expect(html).not.toContain(MORE_LABEL)
    // 대조가 유효한지 확인 — 로그인 화면 자체는 제대로 나왔다.
    expect(html).toContain('로그인')
  })
})

describe('활성 탭 표시', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('홈에서는 홈만 활성이다', async () => {
    const html = await (await get(PATHS.home, jar)).text()
    const current = anchors(html).filter((a) => a.current)

    // 두 벌이므로 2건, 둘 다 홈이어야 한다. `'/'`가 접두사 규칙에 걸리면
    // 다섯 칸이 전부 활성이 되어 이 단언이 10건을 본다.
    expect(current).toHaveLength(2)
    expect(current.every((a) => a.href === PATHS.home)).toBe(true)
  })

  it('다른 구역에서는 그 구역만 활성이다', async () => {
    const html = await (await get(PATHS.products, jar)).text()
    const current = anchors(html).filter((a) => a.current)

    expect(current).toHaveLength(2)
    expect(current.every((a) => a.href === PATHS.products)).toBe(true)
    // 홈이 함께 켜지지 않는다는 것이 이 단언의 요점이다.
    expect(current.some((a) => a.href === PATHS.home)).toBe(false)
  })

  it('「더보기」 안의 경로에서도 활성 표시가 붙는다', async () => {
    // 「더보기」에는 자기 경로가 없으므로 펼친 항목으로 판정한다(`isMoreActive`).
    const html = await (await get(PATHS.prices, jar)).text()
    const current = anchors(html).filter((a) => a.current)

    expect(current).toHaveLength(2)
    expect(current.every((a) => a.href === PATHS.prices)).toBe(true)
  })
})

describe('자리표시 화면이 404가 아니다', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('다섯 칸이 가리키는 경로가 전부 200이다', async () => {
    /*
     * 네비게이션에 있는 탭이 404로 가면 결함으로 보인다. 컷의 종료 조건이
     * "빈 5탭이 동작"이므로 그 상태를 상태 코드로 고정한다 — 화면이 서면 같은
     * 단언이 실제 화면을 지킨다.
     */
    for (const item of [...NAV_ITEMS, ...MORE_ITEMS]) {
      const res = await get(item.href, jar)
      expect(res.status, `${item.label}(${item.href})`).toBe(200)
    }
  })

  it('SCR-402는 라우트가 있으나 네비게이션에 없다', async () => {
    // 무효화 맵이 `/forecast`를 가리키므로 라우트를 미리 둔다(컷 1b 대조 테스트).
    // 화면은 P4b이며, 그 사실이 탭 목록에 새지 않아야 한다.
    expect((await get(PATHS.forecast, jar)).status).toBe(200)
    expect(NAV_ITEMS.some((i) => i.href === PATHS.forecast)).toBe(false)
    expect(MORE_ITEMS.some((i) => i.href === PATHS.forecast)).toBe(false)
  })
})
