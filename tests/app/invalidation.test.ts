import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { UserSessionClient } from '@/lib/db/client'
import { createMutations } from '@/lib/db/mutations/context'
import { createQueries } from '@/lib/db/queries/context'
import {
  INVALIDATION,
  PENDING_ROUTES,
  ROUTE_QUERIES,
  staleRoutesFor,
  type MutationName,
  type QueryName,
} from '@/lib/routes/invalidation'
import { PATHS } from '@/lib/routes/paths'
import { PENDING_PARTS } from '@/lib/forms/steps'

/**
 * 무효화 맵 — 세 축으로 대조한다 (DOC-011 §8 · 계획 §8)
 *
 * | 축 | 무엇이 틀렸을 때 실패하는가 |
 * |---|---|
 * | 전수 | 계약이 늘었는데 「무엇이 낡는가」를 정하지 않았다 |
 * | 실재 | 맵이 문서에 없는 경로를 가리킨다 |
 * | 합성 | `affects` × `ROUTE_QUERIES`가 낡는 화면 목록과 어긋난다 |
 *
 * ## 무효화 **호출**은 여기서 보지 않는다 — 볼 것이 없다
 *
 * 컷 1b의 실측 결과 세 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이
 * 전부 같았고, 그래서 효과는 `revalidatePath('/', 'layout')` 한 줄로 끝난다
 * (`lib/routes/invalidation.ts`의 표에 근거가 있다). 이 파일이 지키는 것은 호출이
 * 아니라 **지식**이다: 어느 변경이 어느 조회를 바꾸고, 어느 라우트가 무엇을 읽는가.
 * 그 지식은 화면을 세울 때마다 쓰이고 문서(§8)와 대조 가능하다.
 *
 * DB도 Next도 없다. 맵이 순수 데이터인 이유가 이것이다.
 */

const APP = join(process.cwd(), 'src', 'app')
const DOC_011 = join(process.cwd(), 'docs', '11_API_계약_명세.md')
const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')

/** 조립만 하므로 클라이언트는 호출되지 않는다(`tests/db/mutations.test.ts`와 같은 스텁). */
const STUB = {} as UserSessionClient
const CTX = { db: STUB, asOf: '2026-07-28', viewerId: '00000000-0000-4000-8000-0000000000aa' }

const MUTATION_NAMES = Object.keys(createMutations(CTX)) as MutationName[]
const QUERY_NAMES = Object.keys(createQueries(CTX)) as QueryName[]

// ---------------------------------------------------------------------------
// 축 1 — 전수
// ---------------------------------------------------------------------------

describe('전수', () => {
  it('계약 11개가 모두 항목을 갖는다', () => {
    // 타입 수준에서도 `Record<MutationName, …>`가 강제하지만, 그쪽은 `keyof`가
    // 문서와 갈렸을 때를 보지 못한다 — 실제로 조립된 묶음의 키로 대조한다.
    expect(MUTATION_NAMES).toHaveLength(11)
    expect(Object.keys(INVALIDATION).sort()).toEqual([...MUTATION_NAMES].sort())
  })

  it('`affects`가 실재하는 조회 계약만 가리킨다', () => {
    for (const [name, rule] of Object.entries(INVALIDATION)) {
      for (const query of rule.affects) {
        expect(QUERY_NAMES, `${name}의 affects`).toContain(query)
      }
    }
  })

  it('아무것도 바꾸지 않는 계약이 없다', () => {
    // 변경이 어떤 조회도 바꾸지 않는다는 뜻이 되므로 빈 목록은 결함이다.
    for (const [name, rule] of Object.entries(INVALIDATION)) {
      expect(rule.affects.length, name).toBeGreaterThan(0)
      expect(staleRoutesFor(name as MutationName).length, name).toBeGreaterThan(0)
    }
  })

})

// ---------------------------------------------------------------------------
// 축 2 — 실재하는 라우트
// ---------------------------------------------------------------------------

/** `src/app/**\/page.tsx`를 훑어 실제 라우트 경로를 만든다. 라우트 그룹은 URL에 없다. */
function actualRoutes(dir: string = APP, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') {
      routes.push(prefix === '' ? '/' : prefix)
      continue
    }
    if (!entry.isDirectory()) continue
    // `(auth)`·`(app)`은 그룹이므로 경로에 나타나지 않는다.
    const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`
    routes.push(...actualRoutes(join(dir, entry.name), `${prefix}${segment}`))
  }
  return routes
}

/**
 * **자리표시만 있는 라우트** — 파일은 있으나 화면은 없다.
 *
 * 계획 §4는 「자리표시 `PendingScreen`을 실제 화면으로 갈 때 `grep PendingScreen`으로
 * 남은 것을 센다」고 적었다. 사람이 세는 절차는 다음 사람이 지키지 않으면 썩으므로
 * 여기서 센다 — `NOT_YET_BUILT`가 「파일 없음」을 세는 것과 **같은 원장의 다른 절반**이며,
 * 둘의 합이 P4에 남은 화면 수다.
 */
function placeholderRoutes(dir: string = APP, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') {
      if (readFileSync(join(dir, entry.name), 'utf8').includes('PendingScreen')) {
        routes.push(prefix === '' ? '/' : prefix)
      }
      continue
    }
    if (!entry.isDirectory()) continue
    const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`
    routes.push(...placeholderRoutes(join(dir, entry.name), `${prefix}${segment}`))
  }
  return routes
}

/**
 * **파일이 아예 없는 라우트 → 세우는 컷.**
 *
 * 맵은 P4 전체를 미리 적는다(계획 §8) — 컷마다 고치면 그때그때의 화면만 보고
 * 정하게 되고, 그것이 "무효화를 나중에 추측으로 넣는다"가 막으려던 상태다.
 * 그래서 여기 있는 경로는 문서가 정의했으나 파일이 아직 없다.
 *
 * **이 표는 스스로 줄어든다** — 파일이 생기면 "없어야 한다"는 단언이 빨간불이 되어
 * 지우라고 말한다. 주석으로 남기면 다음 사람이 지우지 않는다.
 *
 * > **자리표시가 서면 여기서 지운다** — 그것이 원장의 상실이 아니라 **이전**이다.
 * > `/products/new`가 컷 2에서 그렇게 옮겨졌다: SCR-201이 그 주소로 가는 버튼을
 * > 둘 갖게 되었고(`+ 등록`·빈 상태의 다음 행동) 404는 사용자에게 결함으로 보이므로
 * > `PendingScreen`을 두었다. 남은 컷의 표식은 그 파일 안으로 옮겨지고, 아래
 * > `placeholderRoutes()`가 그것을 센다 — 계획 §4가 「`grep PendingScreen`으로 남은
 * > 것을 센다」고 적은 절차의 테스트판이다.
 */
const NOT_YET_BUILT: Record<string, string> = {
  '/users': '만들지 않는다 — DOC-008 SQ-01',
}

/** 화면을 만들지 않기로 한 것. 문서에는 조회 계약이 적혀 있다(계약은 남는다). */
const UNBUILT_SCREENS: Record<string, string> = {
  'SCR-501': 'SQ-01 — 소유자 필터가 대체한다. listUserSummaries는 계약으로 남는다',
}

describe('실재하는 라우트', () => {
  const ROUTES = actualRoutes()
  const DEFINED = new Set(Object.values(screenRoutes()).flat())

  it('파서가 라우트를 찾았다', () => {
    // 0건을 찾고 조용히 통과하는 것이 이 부류 파서의 유일한 위험이다.
    expect(ROUTES.length).toBeGreaterThan(5)
    expect(ROUTES).toContain(PATHS.home)
    expect(ROUTES).toContain(PATHS.login)
  })

  it('컷 2·3·5·6이 세운 라우트가 실재한다', () => {
    /*
     * 다섯 다 `NOT_YET_BUILT`를 떠났다. 여기서 직접 단언하는 이유는 원장에서 지우는
     * 것만으로는 **지웠다는 사실**만 남고 「대신 무엇이 생겼는가」가 남지 않기
     * 때문이다. `/products/new`는 자리표시이므로 `placeholderRoutes()`가 다시 세고,
     * 나머지는 실제 화면이라 어느 원장에도 없다.
     *
     * **상품 계열이 이 컷에서 완결되었다** — 목록·상세·등록·수정·상환 다섯이다.
     */
    expect(ROUTES).toContain(PATHS.products)
    expect(ROUTES).toContain('/products/[id]')
    expect(ROUTES).toContain(PATHS.productNew)
    expect(ROUTES).toContain('/products/[id]/edit')
    expect(ROUTES).toContain('/products/[id]/redeem')
  })

  it('컷 7·8이 `/schedule`·`/tax`를 자리표시에서 실화면으로 바꿨다', () => {
    /*
     * 라우트는 컷 0d부터 있었으므로 `actualRoutes()`로는 아무 변화가 없다 —
     * 이 컷의 변화는 **자리표시 원장**에서만 보인다(아래 「두 원장이 함께 센다」).
     * 그래서 여기서는 그 사실을 직접 단언한다: 파일이 `PendingScreen`을 더 이상
     * 담지 않는다.
     */
    expect(ROUTES).toContain(PATHS.schedule)
    expect(placeholderRoutes()).not.toContain(PATHS.schedule)
    expect(ROUTES).toContain(PATHS.tax)
    expect(placeholderRoutes()).not.toContain(PATHS.tax)
  })

  it('낡는 라우트가 전부 DOC-008 §4가 정의한 라우트다', () => {
    /*
     * **실재보다 문서가 기준이다.** 맵은 P4 전체를 미리 적으므로 아직 파일이 없는
     * 경로가 있고, 그것과 **오타**는 구분되어야 한다 — `/product`(단수)나
     * `/products/[productId]`는 문서에 없으므로 여기서 걸린다.
     */
    for (const name of MUTATION_NAMES) {
      for (const route of staleRoutesFor(name)) {
        expect([...DEFINED], `${name} → ${route}`).toContain(route)
      }
    }
  })

  it('`ROUTE_QUERIES`의 모든 라우트가 정의되어 있다', () => {
    for (const route of Object.keys(ROUTE_QUERIES)) {
      expect([...DEFINED], route).toContain(route)
    }
  })

  it('세우지 않은 화면 표가 실제와 맞는다', () => {
    /*
     * ★ 이 단언이 표를 강제한다. 컷 3이 SCR-202를 세우면 여기가 빨간불이 되어
     * 표에서 지우라고 말한다 — 낡은 "미구현" 표가 남아 있으면 다음 대조가 그것을
     * 근거로 실재 검사를 건너뛴다.
     */
    for (const [route, when] of Object.entries(NOT_YET_BUILT)) {
      expect(ROUTES, `${route}가 생겼다(${when}) — NOT_YET_BUILT에서 지운다`).not.toContain(
        route,
      )
    }
  })

  it('정의된 라우트는 실재하거나 미구현으로 등재되어 있다', () => {
    for (const route of DEFINED) {
      expect(
        ROUTES.includes(route) || route in NOT_YET_BUILT,
        `${route}가 없고 미구현 등재도 없다`,
      ).toBe(true)
    }
  })

  it('실재하는 라우트가 전부 어딘가에 등재되어 있다', () => {
    /*
     * 반대 방향이다 — 화면을 세우고 `ROUTE_QUERIES`에 적지 않으면 그 화면은
     * **어떤 변경에도 무효화되지 않는다.** 증상은 "저장했는데 그 화면만 그대로"다.
     * `/login`은 조회 계약이 없다(부르면 Q-04로 죽는다).
     */
    const covered = new Set([
      ...Object.keys(ROUTE_QUERIES),
      ...Object.keys(PENDING_ROUTES),
      PATHS.login,
    ])
    expect(ROUTES.filter((route) => !covered.has(route))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 축 3 — 합성
// ---------------------------------------------------------------------------

/**
 * **낡는 라우트의 기대값** — 손으로 적는다.
 *
 * `staleRoutesFor()`가 `affects` × `ROUTE_QUERIES`를 곱해 내는 값과 대조한다.
 * 파생을 파생으로 확인하면 항진명제이므로 기대값은 **사람이 읽고 동의한 목록**이어야
 * 하고, 그 자리는 구현이 아니라 테스트다 — 런타임은 이 목록을 쓰지 않는다(실측).
 *
 * `affects`를 무심히 고치면 여기가 빨간불이 되어 「그래서 어느 화면이 낡는가」를
 * 다시 보게 한다. 그것이 이 표의 유일한 목적이다.
 */
const STALE_ROUTES: Record<MutationName, string[]> = {
  createProduct: ['/', '/forecast', '/prices', '/products', '/schedule', '/tax'],
  updateProduct: [
    '/',
    '/forecast',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
    '/tax',
  ],
  deleteProduct: [
    '/',
    '/forecast',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
    '/tax',
  ],
  // 세금·전망이 없다 — KI는 `grossExpected`에 들어가지 않는다.
  setKiTouched: [
    '/',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
  ],
  createRedemption: [
    '/',
    '/forecast',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
    '/tax',
  ],
  updateRedemption: [
    '/',
    '/forecast',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
    '/tax',
  ],
  deleteRedemption: [
    '/',
    '/forecast',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
    '/tax',
  ],
  saveTaxProfile: ['/', '/forecast', '/tax'],
  // 세금·전망이 없다 — 시세는 추정 기여에 들어가지 않는다.
  saveManualPrice: [
    '/',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
  ],
  refreshPrices: [
    '/',
    '/prices',
    '/products',
    '/products/[id]',
    '/products/[id]/edit',
    '/products/[id]/redeem',
    '/schedule',
  ],
  // 자산 목록을 읽는 곳만. 상세·상환은 자산 목록을 읽지 않는다.
  createAsset: ['/prices', '/products/[id]/edit', '/products/new'],
}

describe('합성 — affects × ROUTE_QUERIES', () => {
  it('계약마다 낡는 라우트가 기대값과 일치한다', () => {
    for (const name of MUTATION_NAMES) {
      expect(staleRoutesFor(name), `${name}`).toEqual([...STALE_ROUTES[name]].sort())
    }
  })

  it('상품을 바꾸는 변경은 상세·상환·수정을 함께 낡게 한다', () => {
    /*
     * 셋이 같은 `getProduct`를 읽는다. 하나만 낡는다고 보면 수정 화면이 낡은 값으로
     * 폼을 채우는 상태를 설계가 허용하게 된다 — 계획 §8이 "상품 스코프는 항상
     * layout"이라고 적은 이유가 그것이며, 지금은 그 규칙이 **파생으로 성립한다.**
     */
    for (const name of ['updateProduct', 'setKiTouched', 'createRedemption'] as const) {
      const stale = staleRoutesFor(name)
      expect(stale).toContain('/products/[id]')
      expect(stale).toContain('/products/[id]/edit')
      expect(stale).toContain('/products/[id]/redeem')
    }
  })

  it('자산 등록은 상세·상환을 낡게 하지 않는다', () => {
    // 그 두 화면은 자산 **목록**을 읽지 않는다. 넓히면 파생이 아니라 추측이 된다.
    const stale = staleRoutesFor('createAsset')
    expect(stale).not.toContain('/products/[id]')
    expect(stale).not.toContain('/products/[id]/redeem')
    expect(stale).toContain('/products/[id]/edit') // 자동완성을 읽는다
  })

  it('시세는 세금을 낡게 하지 않는다', () => {
    /*
     * 직관과 반대이므로 케이스로 박는다. `tax.ts`의 추정 기여는
     * `grossExpected(원금·연쿠폰율·평가주기·차수)`뿐이고 시세도 `conditionResult`도
     * 쓰지 않는다(§4.3의 `EARLY` 가정).
     */
    for (const name of ['saveManualPrice', 'refreshPrices'] as const) {
      expect(staleRoutesFor(name)).not.toContain(PATHS.tax)
      expect(staleRoutesFor(name)).not.toContain(PATHS.forecast)
      expect(INVALIDATION[name].affects).not.toContain('getTaxSummary')
    }
  })

  it('상환은 시세 화면을 낡게 한다', () => {
    // `usedByActiveProducts`가 "참조 중인 **미상환** 상품 수"이므로 상환 등록·취소가
    // 그 값을 바꾼다. 이것도 직관과 반대다.
    for (const name of [
      'createRedemption',
      'updateRedemption',
      'deleteRedemption',
    ] as const) {
      expect(staleRoutesFor(name)).toContain(PATHS.prices)
      expect(INVALIDATION[name].affects).toContain('listAssetPrices')
    }
  })

  it('KI 터치는 세금을 낡게 하지 않는다', () => {
    expect(staleRoutesFor('setKiTouched')).not.toContain(PATHS.tax)
    expect(staleRoutesFor('setKiTouched')).toContain(PATHS.schedule)
  })

  it('`/forecast`는 세금 요약과 함께 낡는다 — P4b의 대리 기준', () => {
    // 계약이 없으므로 `getTaxSummary`를 대리로 쓴다(`PENDING_ROUTES`의 근거).
    expect(Object.keys(PENDING_ROUTES)).toEqual([PATHS.forecast])
    for (const name of MUTATION_NAMES) {
      const withTax = INVALIDATION[name].affects.includes('getTaxSummary')
      expect(staleRoutesFor(name).includes(PATHS.forecast), name).toBe(withTax)
    }
  })
})

// ---------------------------------------------------------------------------
// 문서 대조 — DOC-011 §8 · DOC-008 §4
// ---------------------------------------------------------------------------

const SEPARATOR = /^\|(?:-+\|)+$/

function tableAfterHeader(file: string, header: string): string[][] {
  const lines = readFileSync(file, 'utf8').split('\n')
  const at = lines.indexOf(header)
  expect(at, `표 헤더를 찾지 못했다: ${header}`).toBeGreaterThan(-1)
  expect(lines.indexOf(header, at + 1), `같은 헤더가 둘 이상이다: ${header}`).toBe(-1)
  expect(lines[at + 1]).toMatch(SEPARATOR)

  const rows: string[][] = []
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
  }
  return rows
}

/** 셀에서 백틱으로 감싼 식별자만 뽑는다 — 각주·강조·괄호 설명을 버린다. */
function identifiers(cell: string): string[] {
  return [...cell.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)].map((m) => m[1]!)
}

describe('DOC-011 §8 추적 매트릭스 ↔ 맵', () => {
  const rows = tableAfterHeader(DOC_011, '| 화면 | 조회 계약 | 변경 계약 |')

  it('매트릭스를 찾았다', () => {
    expect(rows.length).toBe(12) // SCR-001·101·201·202·203·204·301·302·401·402·501·502
  })

  it('문서가 배정한 변경 계약이 전부 맵에 있다', () => {
    const documented = new Set(
      rows.flatMap(([, , mutations]) => identifiers(mutations ?? '')),
    )
    // `signIn`·`signOut`은 §5의 열하나가 아니다(`lib/auth/session.ts`).
    documented.delete('signIn')
    documented.delete('signOut')

    expect([...documented].sort()).toEqual([...MUTATION_NAMES].sort())
  })

  it('문서가 배정한 조회 계약이 전부 실재하거나 미구현으로 등재되어 있다', () => {
    const documented = new Set(rows.flatMap(([, queries]) => identifiers(queries ?? '')))
    const planned = new Set(Object.values(PENDING_ROUTES).map((p) => p.plannedQuery))

    for (const query of documented) {
      // `listUserSummaries`는 계약으로 남지만 화면을 만들지 않는다(SQ-01) —
      // 실재하는 계약이므로 `QUERY_NAMES`에 있다.
      expect(
        QUERY_NAMES.includes(query as QueryName) || planned.has(query),
        `${query}가 계약도 아니고 미구현 등재도 아니다`,
      ).toBe(true)
    }
  })

  it('화면이 읽는 계약과 `ROUTE_QUERIES`가 일치한다', () => {
    /*
     * §8은 **화면 단위**이고 `ROUTE_QUERIES`는 **라우트 단위**다. SCR-204가 두
     * 라우트(`/products/new`·`/products/[id]/edit`)이며 입력이 다르므로
     * (등록은 `searchAssets`만, 수정은 `getProduct`도) 화면 단위로는 표현할 수
     * 없다 — 화면 단위로 두면 「시세를 저장했으니 등록 화면도 지운다」는 잘못된
     * 합성이 나온다. 그래서 대조는 **합집합**으로 한다: 한 화면의 라우트들이 읽는
     * 계약을 합치면 문서가 그 화면에 적은 집합과 같아야 한다.
     */
    const routesOfScreen = screenRoutes()

    for (const [screen, queries] of rows.map(([cell, q]) => [cell ?? '', q ?? ''])) {
      const id = /SCR-\d+/.exec(screen)?.[0]
      if (id == null) continue
      if (id in UNBUILT_SCREENS) continue // 만들지 않기로 한 화면 — 위 표에 사유가 있다
      const routes = routesOfScreen[id]
      if (routes == null) continue // 경로가 없는 화면(SCR-901·902)

      const fromCode = new Set(routes.flatMap((route) => ROUTE_QUERIES[route] ?? []))
      const fromDoc = new Set(
        identifiers(queries).filter((q) => QUERY_NAMES.includes(q as QueryName)),
      )
      expect([...fromCode].sort(), `${id}가 읽는 계약`).toEqual([...fromDoc].sort())
    }
  })
})

/** DOC-008 §4의 `경로` 열을 파싱해 화면 → 라우트를 만든다. `:id` → `[id]`. */
function screenRoutes(): Record<string, string[]> {
  const rows = tableAfterHeader(
    DOC_008,
    '| ID | 화면명 | 경로 | 권한 | 관련 요구사항 | 주요 엔티티 |',
  )
  expect(rows.length, 'DOC-008 §4 화면 목록이 비어 있다').toBe(14)

  const map: Record<string, string[]> = {}
  for (const [id, , pathCell] of rows) {
    const routes = identifierPaths(pathCell ?? '')
    if (routes.length > 0) map[bare(id ?? '')] = routes
  }
  return map
}

function bare(cell: string): string {
  return cell.replace(/`|\*/g, '').trim()
}

/** 경로 셀에서 백틱 경로만 뽑는다. `*`(SCR-901)·`—`(SCR-902)는 라우트가 아니다. */
function identifierPaths(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1]!)
    .filter((value) => value.startsWith('/'))
    .map((value) => value.replace(/:(\w+)/g, '[id]'))
}

describe('DOC-008 §4 ↔ 라우트', () => {
  it('문서가 적은 경로가 실재하거나 남은 컷에 배정되어 있다', () => {
    const routes = new Set(actualRoutes())
    for (const [screen, paths] of Object.entries(screenRoutes())) {
      for (const path of paths) {
        expect(
          routes.has(path) || path in NOT_YET_BUILT,
          `${screen} ${path}: 화면도 없고 배정도 없다`,
        ).toBe(true)
      }
    }
  })

  it('P4에 남은 화면을 두 원장이 함께 센다', () => {
    /*
     * 진행 상황을 숫자로 고정한다. 컷이 진행되면 줄어들고, 늘면 무언가를 지운 것이다.
     *
     * **두 원장을 함께 세는 것이 요점이다.** 자리표시를 세우고 `NOT_YET_BUILT`에서
     * 지우면 앞의 숫자만 줄어들어 「화면이 섰다」로 읽힌다 — 실제로는 파일만 생겼다.
     * 합계는 그 이전에 불변이므로, 줄어들 때는 진짜로 화면이 선 것이다.
     */
    const noFile = Object.keys(NOT_YET_BUILT).filter((route) => route !== '/users')
    const placeholders = placeholderRoutes()

    /*
     * **파일 없는 라우트가 없다** — 컷 6이 마지막 하나(상환)를 세웠다. 「만들지
     * 않는다」로 결정된 `/users`만 표에 남으므로 이 목록은 비어 있다.
     */
    expect(noFile.sort()).toEqual([])
    // 컷 9(홈) · P4b(전망) — 컷 7이 `/schedule`을, 컷 8이 `/tax`를 세웠다
    expect(placeholders.sort()).toEqual(['/', '/forecast'])
  })

  it('세 번째 원장이 두 번째로 비었다 — 컷 6이 SCR-202의 셋을 세웠다', () => {
    /*
     * ★ **원장이 두 번 찼다가 두 번 비었다 — 그것이 이 표가 살아 있다는 증거다.**
     *
     * 컷 4a가 셋(③·④·저장)을 등재하고 컷 4b가 비웠으며, 컷 5가 SCR-202의 셋(상환
     * 처리·상환 취소·KI 터치 확정)을 등재하고 컷 6이 비웠다. 두 번째 채움의 계기는
     * 컷 5의 삭제 실패 문구가 **가리킬 대상이 없었다**는 것이다(「상환을 먼저
     * 취소한다」의 그 취소가 컷 6의 계약이었다).
     *
     * 비었음을 단언으로 남기므로 다음에 조각을 미루는 컷이 오면 여기가 그 사실을
     * 요구한다.
     */
    expect(actualRoutes()).toContain(PATHS.productNew)
    expect(PENDING_PARTS).toEqual({})
  })
})
