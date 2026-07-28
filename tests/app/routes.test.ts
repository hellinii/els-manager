import { describe, expect, it } from 'vitest'

import {
  MORE_ITEMS,
  NAV_ITEMS,
  PATHS,
  isMoreActive,
  isNavActive,
} from '@/lib/routes/paths'

/**
 * 경로 데이터와 활성 탭 판정 — DOC-008 §3 · §4
 *
 * 이 판정이 컴포넌트 밖에 있는 이유가 이 파일이다. `usePathname`에 묶여 있으면
 * `/` 예외를 확인하려면 라우터가 필요하고, 그러면 브라우저 없이는 못 본다
 * (AQ-32의 경계선). 순수 함수로 떼어 두면 상시 스위트가 전수로 본다.
 */

describe('isNavActive', () => {
  it('홈은 정확히 일치할 때만 활성이다', () => {
    expect(isNavActive('/', PATHS.home)).toBe(true)
    /*
     * `'/'`는 모든 경로의 접두사다. 구분자 없는 `startsWith(href)`로 구현하면
     * 홈이 영원히 활성이고 다섯 탭이 항상 전부 켜진다 — **음성 대조로 확인했다**
     * (그 형태로 바꾸면 이 케이스와 아래 경계 케이스가 함께 빨간불이 된다).
     * 반대로 `href === '/'` 예외 분기는 지워도 아무 단언이 실패하지 않았으므로
     * 죽은 코드였고, 구현에서 제거했다.
     */
    expect(isNavActive('/products', PATHS.home)).toBe(false)
    expect(isNavActive('/tax', PATHS.home)).toBe(false)
  })

  it('하위 경로는 부모 탭을 활성으로 만든다', () => {
    for (const path of [
      '/products',
      '/products/new',
      '/products/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
      '/products/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/edit',
      '/products/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/redeem',
    ]) {
      expect(isNavActive(path, PATHS.products), path).toBe(true)
    }
  })

  it('접두사가 경계에서 끊긴다 — 다른 구역을 켜지 않는다', () => {
    // `/taxes`가 「세금」을 켜면 안 된다. `startsWith(href)`만 쓰면 켜진다.
    expect(isNavActive('/taxes', PATHS.tax)).toBe(false)
    expect(isNavActive('/products-archive', PATHS.products)).toBe(false)
    expect(isNavActive('/schedule', PATHS.products)).toBe(false)
  })

  it('DOC-008 §4의 동적 경로가 자기 부모를 켠다', () => {
    const id = 'e2f1c7a4-0000-4000-8000-000000000000'
    expect(isNavActive(PATHS.product(id), PATHS.products)).toBe(true)
    expect(isNavActive(PATHS.productEdit(id), PATHS.products)).toBe(true)
    expect(isNavActive(PATHS.productRedeem(id), PATHS.products)).toBe(true)
    // 슬래시 조립이 어긋나면 여기서 드러난다 — 404는 테스트가 보지 못한다.
    expect(PATHS.productEdit(id)).toBe(`/products/${id}/edit`)
  })
})

describe('isMoreActive', () => {
  it('「더보기」는 자기 경로가 없으므로 펼친 항목으로 판정한다', () => {
    expect(isMoreActive(PATHS.prices)).toBe(true)
    expect(isMoreActive(PATHS.settings)).toBe(true)
    expect(isMoreActive(PATHS.home)).toBe(false)
    expect(isMoreActive(PATHS.products)).toBe(false)
  })
})

describe('네비게이션 구성 — DOC-008 §3', () => {
  it('주 탭 4개 + 「더보기」 = 5칸이다', () => {
    // 문서의 표가 다섯 순서를 정했다. 다섯째가 링크가 아니라 묶음이므로
    // NAV_ITEMS는 넷이며, 그 사실이 조용히 바뀌면(예: /more 라우트 신설)
    // 문서에 없는 화면이 하나 생긴다.
    expect(NAV_ITEMS).toHaveLength(4)
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['홈', '상품', '일정', '세금'])
  })

  it('「더보기」에 시세·설정이 있고 SCR-501은 없다', () => {
    // SQ-01 해결 — SCR-501은 만들지 않는다. 링크만 남으면 404로 간다.
    expect(MORE_ITEMS.map((i) => i.href)).toEqual([PATHS.prices, PATHS.settings])
    expect(MORE_ITEMS.some((i) => i.screen === 'SCR-501')).toBe(false)
  })

  it('시세 관리는 주 탭에 없다 — 폴백을 정상 경로로 보이게 하지 않는다', () => {
    // DOC-008 §3의 각주. 자동 조회가 기본이고 수동 입력이 폴백이다.
    expect(NAV_ITEMS.some((i) => i.href === PATHS.prices)).toBe(false)
  })

  it('모든 항목의 경로가 유일하다', () => {
    const hrefs = [...NAV_ITEMS, ...MORE_ITEMS].map((i) => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
