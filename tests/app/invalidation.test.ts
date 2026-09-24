import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { UserSessionClient } from '@/lib/db/client'
import { createMutations } from '@/lib/db/mutations/context'
import { createQueries } from '@/lib/db/queries/context'
import { createKiwoomProductSource } from '@/lib/providers/kiwoom/terms'
import {
  INVALIDATION,
  PENDING_ROUTES,
  ROUTE_EXTERNAL_LOOKUPS,
  ROUTE_QUERIES,
  staleRoutesFor,
  type MutationName,
  type QueryAxisExhaustive,
  type QueryName,
} from '@/lib/routes/invalidation'
import { PATHS } from '@/lib/routes/paths'
import { PENDING_PARTS } from '@/lib/forms/productForm'

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

/** 그 조회를 낡게 하는 변경 계약 — `affects`의 역 인덱스를 **읽는 쪽에서** 만든다. */
function mutationsAffecting(query: QueryName): MutationName[] {
  return (Object.entries(INVALIDATION) as [MutationName, { affects: readonly QueryName[] }][])
    .filter(([, rule]) => rule.affects.includes(query))
    .map(([name]) => name)
    .sort()
}

// ---------------------------------------------------------------------------
// 축 0 — 조회 축의 파생이 항진명제가 아님을 고정한다 (AQ-39, 컷 6)
// ---------------------------------------------------------------------------

/**
 * **음성 대조** — `typecheck`가 검증한다(런타임 케이스가 아니다).
 *
 * `_queryAxisIsExhaustive`가 초록인 것은 두 가지 중 하나를 뜻한다: 조회 축이 실제로
 * 전수이거나, **파생이 아무것도 판별하지 못하거나.** 둘을 갈라야 그 초록이 값을
 * 갖는다. 그래서 결함 있는 맵으로 같은 파생을 다시 계산해 발화를 고정한다.
 *
 * `Without<Q>`는 목록을 손으로 베끼지 않는다 — 실제 `INVALIDATION`에서 `Q`만 기계적으로
 * 빼므로 맵이 바뀌어도 따라온다. 튜플이 `readonly …[]`로 넓어지지만 파생이 읽는 것은
 * `[number]`이므로 판별력은 같다.
 */
type Without<Q extends QueryName> = {
  [K in MutationName]: {
    affects: readonly Exclude<(typeof INVALIDATION)[K]['affects'][number], Q>[]
  }
}

/*
 * ★ **양성 대조가 먼저다.** 이 줄이 빨간불이면 아래 둘의 발화는 「빠진 계약을
 * 판별했다」가 아니라 `Without`의 변환 자체가 만든 거짓 양성이다 — 그 경우 음성 대조의
 * 탐지력이 0인데도 `@ts-expect-error`가 만족되어 초록으로 보인다.
 */
const _transformIsInnocent: QueryAxisExhaustive<Without<never>> = true

/*
 * 컷 6 이전의 실제 상태 — `listUserSummaries`가 어느 `affects`에도 없었다.
 * 이 파생이 그때 있었다면 그 결함이 컴파일에서 잡혔음을 보인다.
 */
// @ts-expect-error — ['조회 축에 빠진 계약', 'listUserSummaries']에 true를 할당할 수 없다
const _witnessCatchesTheRealDefect: QueryAxisExhaustive<Without<'listUserSummaries'>> = true

/*
 * 한 자리에만 등재된 계약도 잡는다 — `searchAssets`는 `createAsset`에만 있으므로
 * 위 경우(일곱 자리)와 판별 난이도가 다르다.
 */
// @ts-expect-error — ['조회 축에 빠진 계약', 'searchAssets']에 true를 할당할 수 없다
const _witnessCatchesSingleSite: QueryAxisExhaustive<Without<'searchAssets'>> = true

// ---------------------------------------------------------------------------
// 축 1 — 전수
// ---------------------------------------------------------------------------

describe('전수', () => {
  it('계약 13개가 모두 항목을 갖는다', () => {
    // 타입 수준에서도 `Record<MutationName, …>`가 강제하지만, 그쪽은 `keyof`가
    // 문서와 갈렸을 때를 보지 못한다 — 실제로 조립된 묶음의 키로 대조한다.
    // (P6 컷 5에서 §5.11 `createRealizedProduct`가 더해져 11 → 12,
    //  P5a 컷 2b에서 §5.12 `saveProviderSymbol`이 더해져 12 → 13)
    expect(MUTATION_NAMES).toHaveLength(13)
    expect(Object.keys(INVALIDATION).sort()).toEqual([...MUTATION_NAMES].sort())
  })

  it('`affects`가 실재하는 조회 계약만 가리킨다', () => {
    for (const [name, rule] of Object.entries(INVALIDATION)) {
      for (const query of rule.affects) {
        expect(QUERY_NAMES, `${name}의 affects`).toContain(query)
      }
    }
  })

  it('조회 계약 전수가 어느 `affects`에든 있다 — 파생의 런타임 짝 (AQ-39)', () => {
    /*
     * 위 케이스의 **역방향**이며, 그 부재가 AQ-39의 fail-open이었다. 타입 수준
     * 파생(`_queryAxisIsExhaustive`)이 이미 이것을 강제하지만 그쪽은 `keyof`가
     * 문서·조립과 갈렸을 때를 보지 못한다 — 「계약 11개가 모두 항목을 갖는다」가
     * `Record`와 나란히 있는 것과 같은 이유로 실제 조립된 묶음의 키로 대조한다.
     */
    /*
     * ★ **`Set<string>`으로 넓혀 받는다.** 좁게 두면 `covered`가 `affects` 리터럴의
     * 유니온이 되어 **빠진 계약이 이 케이스의 실패가 아니라 `covered.has()`의 컴파일
     * 오류**로 나타난다. 그러면 이 케이스는 타입 층이 이미 잡은 것만 다시 잡는 셈이고,
     * 존재 이유(「`keyof`가 실제 조립과 갈렸을 때」)를 잃는다 — 그 갈림은 타입 오류가
     * 아니라 **런타임 값의 차이**로만 나타난다.
     */
    const covered = new Set<string>(
      Object.values(INVALIDATION).flatMap((rule) => [...rule.affects]),
    )
    const uncovered = QUERY_NAMES.filter((query) => !covered.has(query))
    expect(uncovered, '어느 affects에도 없는 조회 계약').toEqual([])
  })

  it('`listUserSummaries`가 낡는 자리는 `getTaxSummary`와 정확히 같다', () => {
    /*
     * ★ **비어 있던 것이 결정이 아니라 결함이었다.** 컷 6까지 이 계약은 어느
     * `affects`에도 없었다 — 읽는 라우트가 없어(SQ-01) `staleRoutesFor`가 달라지지
     * 않았으므로 무해했지만, 그 무해함이 기록된 적이 없다. §4.8이 상품 전량
     * (`loadProducts`)과 본인 프로필(`loadTaxProfile`)을 읽으므로 입력 기준으로는
     * `getTaxSummary`와 같은 자리다.
     *
     * 두 집합의 **동일성**을 단언하는 이유는 컷 8이 이 사실에 기댄다는 것이다 —
     * `/forecast`가 `PENDING_ROUTES`의 대리(`getTaxSummary`)에서 실명 계약으로
     * 옮겨도 결과가 같아야 하고, 그 근거가 「소속이 같다」다. 개수(일곱)로 적으면
     * 어느 일곱인지 갈려도 통과한다.
     */
    expect(mutationsAffecting('listUserSummaries')).toEqual(
      mutationsAffecting('getTaxSummary'),
    )
    // 그 집합이 무엇인지도 박는다 — 위 단언만으로는 둘이 함께 비어도 통과한다.
    expect(mutationsAffecting('listUserSummaries')).toEqual([
      'createProduct',
      // P6 컷 5 — 기실현 등재는 상환 실적을 함께 만들므로 그 해의 금융소득이
      // 즉시 바뀐다. 여덟째가 되면서도 **두 집합의 동일성은 유지된다**(위 단언).
      'createRealizedProduct',
      'createRedemption',
      'deleteProduct',
      'deleteRedemption',
      'saveTaxProfile',
      'updateProduct',
      'updateRedemption',
    ])
  })

  it('`getForecast`가 낡는 자리도 `getTaxSummary`와 정확히 같다 — 컷 8의 근거', () => {
    /*
     * ★ **이 단언이 컷 8의 원장 이전을 검산한다.** `/forecast`는 컷 7까지
     * `PENDING_ROUTES`에서 `getTaxSummary`를 **대리 기준**으로 썼다. 컷 8이 그것을
     * `ROUTE_QUERIES`의 실명 계약으로 옮기는데, 결과가 달라지지 않는 근거가 「소속이
     * 같다」다 — 여기서 그것을 값으로 확인한다. 갈리면 컷 8의 이전이 조용히 무효화 결과를
     * 바꾼다.
     *
     * 전망이 세금 요약보다 **넓게** 낡는 것(한 해가 아니라 `years`개 연도, 이월이 뒤
     * 연도로 나른다)은 소속과 별개다 — `affects`의 판정 기준은 「어느 입력을 읽는가」이고
     * 셋의 입력이 같다(§4.2).
     */
    expect(mutationsAffecting('getForecast')).toEqual(
      mutationsAffecting('getTaxSummary'),
    )
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

/**
 * `src/app/**\/page.tsx`를 훑어 실제 라우트 경로를 만든다. 라우트 그룹은 URL에 없다.
 *
 * ★ **`page.tsx`만 본다 — 그것이 이 함수의 범위이고, 아래 「축 2b」가 나머지를 본다.**
 * P5b 컷 1까지 이 필터가 저장소의 라우트 전부와 같았다(`route.ts`가 0개였다). 첫 Route
 * Handler가 서면서 그 등식이 깨졌고, 그러면 아래 「실재하는 라우트가 전부 등재되어
 * 있다」가 **초록인 채로 거짓**이 된다 — 스캐너가 보지 않는 종류의 라우트는 등재되지
 * 않아도 걸리지 않는다. CLAUDE.md 절대 규칙 #6이 열거하는 fail-open(테이블 · 뷰 · 함수)의
 * **네 번째 사례**이며 함정도 같다: **객체 종류가 늘어날 때 기존 열거가 따라오지 않는다.**
 */
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

  it('컷 7·8·9가 `/schedule`·`/tax`·`/`를 자리표시에서 실화면으로 바꿨다', () => {
    /*
     * 라우트는 컷 0d부터 있었으므로 `actualRoutes()`로는 아무 변화가 없다 —
     * 이 컷들의 변화는 **자리표시 원장**에서만 보인다(아래 「두 원장이 함께 센다」).
     * 그래서 여기서는 그 사실을 직접 단언한다: 파일이 `PendingScreen`을 더 이상
     * 담지 않는다.
     *
     * **홈이 마지막이다** — 컷 9로 P4가 세우는 화면 12개가 전부 섰고, 남은 자리표시는
     * P4b의 `/forecast` 하나다(그쪽은 화면이 아니라 계약 신설이다).
     */
    expect(ROUTES).toContain(PATHS.schedule)
    expect(placeholderRoutes()).not.toContain(PATHS.schedule)
    expect(ROUTES).toContain(PATHS.tax)
    expect(placeholderRoutes()).not.toContain(PATHS.tax)
    expect(ROUTES).toContain(PATHS.home)
    expect(placeholderRoutes()).not.toContain(PATHS.home)
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
     *
     * ★ **여기서 「실재하는 라우트」는 `page.tsx` 라우트다**(`actualRoutes()`의 독블록).
     * Route Handler는 조회 계약도 무효화도 갖지 않으므로 이 원장의 대상이 아니고,
     * **축 2b의 `ROUTE_HANDLERS`가 센다.** 둘이 서로를 흡수하지 않는다는 것을 그쪽에서
     * 단언한다 — 한쪽이 다른 쪽의 파일을 세면 「어딘가에 등재」가 다시 헐거워진다.
     */
    // `PENDING_ROUTES`는 컷 8에서 비었지만 **합집합에 남긴다** — 다음 자리표시가
    // 등재되는 날 그 라우트가 여기서 조용히 「미포함」으로 걸리지 않아야 한다.
    const covered = new Set([
      ...Object.keys(ROUTE_QUERIES),
      ...Object.keys(PENDING_ROUTES),
      PATHS.login,
    ])
    expect(ROUTES.filter((route) => !covered.has(route))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 축 2b — Route Handler 원장 (P5b 컷 1, B5)
// ---------------------------------------------------------------------------

const PROXY = join(process.cwd(), 'src', 'proxy.ts')
const VERCEL_JSON = join(process.cwd(), 'vercel.json')
const DOC_013 = join(process.cwd(), 'docs', '13_배포_및_운영.md')

/** `src/app/**\/route.ts`를 훑어 실제 Route Handler 경로를 만든다. */
function routeHandlers(dir: string = APP, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'route.ts') {
      routes.push(prefix === '' ? '/' : prefix)
      continue
    }
    if (!entry.isDirectory()) continue
    const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`
    routes.push(...routeHandlers(join(dir, entry.name), `${prefix}${segment}`))
  }
  return routes
}

/**
 * **Route Handler 원장** — `page.tsx` 원장들과 같은 규율을 `route.ts`에 적용한다.
 *
 * `proxied`는 취향이 아니라 **관측 가능한 사실**이다: 프록시 매처에 걸리는 핸들러는
 * 미인증 요청에서 307을 받고 자기 코드가 실행되지 않는다. `/api/cron/prices`가 그것을
 * 감당할 수 없는 이유는 **Vercel Cron이 리다이렉트를 따라가지 않고 3xx는 로그에도 남지
 * 않는다**는 것(ADR-006 실측 ⑤)이며, 그 상태에서 CR-01은 영원히 실행되지 않는다.
 *
 * 반대로 세션이 필요한 핸들러라면 `proxied: true`가 옳다. 그래서 이 열은 **각 핸들러의
 * 결정**이고, 아래 단언이 그 결정을 `src/proxy.ts`의 매처에서 파생시켜 대조한다 —
 * 손으로 적은 기대와 실제 정규식이 갈리면 빨간불이다.
 *
 * `forcesDynamic`도 같은 형태다. ★ **이 열이 있는 이유는 실측이다** — `export const
 * dynamic = 'force-dynamic'`을 지우고 e2e를 돌렸더니 **10건이 전부 초록이었다.** 핸들러가
 * `request.headers`를 읽으면 Next가 그것만으로 동적 렌더로 판정하기 때문이다. 즉 e2e의
 * 「같은 URL이 헤더에 따라 갈린다」는 **동적 렌더가 일어났음**을 증명하지만 **그 선언이
 * 있음**은 증명하지 않는다. 요청을 읽지 않는 핸들러(상수를 돌려주는 헬스 체크 같은 것)가
 * 오는 날 그 공백이 실재하는 위험이 되므로, 선언의 유무를 **소스에서** 본다.
 */
const ROUTE_HANDLERS: Record<
  string,
  { proxied: boolean; forcesDynamic: boolean; why: string }
> = {
  '/api/cron/prices': {
    proxied: false,
    forcesDynamic: true,
    why: 'DOC-011 §7.1 — Vercel Cron이 GET으로 부른다. 프록시가 잡으면 307이고, Cron은 리다이렉트를 따라가지 않으며 로그에도 남지 않는다(CR-01이 죽는다)',
  },
}

/**
 * `src/proxy.ts`의 매처를 **파일에서 뽑아** 정규식으로 만든다.
 *
 * `import { config } from '@/proxy'`로 가져오지 않는 이유: 그 모듈은 `next/server`와
 * `@supabase/ssr`을 끌어오므로 **상시 스위트의 import 그래프가 프레임워크로 넓어진다**
 * (AQ-23이 그 경계를 그은 자리다). 여기 필요한 것은 문자열 하나다.
 *
 * 소스의 `\\.`는 문자열 리터럴의 이스케이프이므로 `\.`로 되돌린다 — **그 하나 말고 다른
 * 이스케이프가 없다는 것을 함께 단언한다**(있으면 되돌림이 조용히 틀린다).
 */
function proxyMatcher(): RegExp {
  const source = readFileSync(PROXY, 'utf8')
  const matched = /^\s*'(\/\(\(\?!.+)',\s*$/m.exec(source)
  expect(matched, 'src/proxy.ts에서 매처 리터럴을 찾지 못했다').not.toBeNull()

  const raw = matched![1]!
  // `\\`(리터럴 백슬래시) 외의 이스케이프가 섞이면 아래 치환이 뜻을 바꾼다.
  expect(raw.replace(/\\\\/g, ''), '매처에 예상 밖의 이스케이프가 있다').not.toContain('\\')

  return new RegExp(`^${raw.replace(/\\\\/g, '\\')}$`)
}

describe('Route Handler 원장 — 저장소의 첫 핸들러 (P5b 컷 1)', () => {
  const HANDLERS = routeHandlers()

  it('스캐너가 무엇을 찾았다 — 0건을 찾고 조용히 통과하는 것이 유일한 위험이다', () => {
    /*
     * ★ **이 케이스가 없으면 아래 양방향 단언이 항진명제다.** 원장이 비고 스캐너가 아무것도
     * 못 찾으면 두 방향 모두 초록이다 — 그것이 「가드가 있는 것처럼 보이는데 없는」 상태이며,
     * `actualRoutes()`의 「파서가 라우트를 찾았다」가 같은 자리에 있는 이유다.
     */
    expect(HANDLERS).toEqual(['/api/cron/prices'])
  })

  it('두 스캐너가 서로를 흡수하지 않는다 — 원장이 둘인 이유', () => {
    // 한쪽이 다른 쪽의 파일을 세면 「어딘가에 등재되어 있다」가 다시 헐거워진다.
    const pages = new Set(actualRoutes())
    expect(HANDLERS.filter((route) => pages.has(route))).toEqual([])
    expect(placeholderRoutes().filter((route) => HANDLERS.includes(route))).toEqual([])
  })

  it('실재하는 핸들러가 전부 등재되어 있다', () => {
    expect(HANDLERS.filter((route) => !(route in ROUTE_HANDLERS))).toEqual([])
  })

  it('등재된 핸들러가 전부 실재한다 — 원장만 앞서가지 않는다', () => {
    for (const route of Object.keys(ROUTE_HANDLERS)) {
      expect(HANDLERS, `${route}가 원장에 있고 파일이 없다`).toContain(route)
    }
  })

  it('프록시 매처가 원장의 `proxied`와 일치한다', () => {
    /*
     * ★ **이것이 「307이 아니다」의 상시 대조다.** e2e도 같은 사실을 보지만 그쪽은 인프라
     * (Docker + `next build`)를 요구하므로 상시로 돌지 않는다. 매처는 문자열 하나이고
     * 실수는 그 한 줄에서 일어나므로, 파생으로 여기서 잡는 편이 싸다.
     */
    const matcher = proxyMatcher()

    // 파서·해석의 양성 대조 — 이 넷은 매처에 걸려야 한다(e2e가 307/200으로 실측했다).
    for (const path of ['/', '/products', '/login', '/does-not-exist']) {
      expect(matcher.test(path), `${path}가 매처 밖이다`).toBe(true)
    }
    // 음성 대조 — 정적 자산 제외가 실제로 동작한다(favicon은 e2e에서 200이다).
    for (const path of ['/_next/static/chunk.js', '/favicon.ico', '/logo.svg']) {
      expect(matcher.test(path), `${path}가 매처에 걸린다`).toBe(false)
    }

    for (const [route, { proxied, why }] of Object.entries(ROUTE_HANDLERS)) {
      expect(matcher.test(route), `${route}: ${why}`).toBe(proxied)
    }
  })

  it('`force-dynamic` 선언이 원장과 일치한다 — 행동으로는 관측되지 않는다', () => {
    /*
     * ★ **e2e가 이것을 보지 못한다는 것을 실측으로 확인하고 여기 넣었다**(위 독블록).
     * 선언을 지우고 `tests/e2e/cron.test.ts`를 돌리면 10건이 전부 초록이다 — 그래서
     * **소스를 본다.** 행동 단언으로 대체할 수 없는 자리이며, 이런 자리는 「있는 줄 알았던
     * 가드가 0인」 상태가 되기 쉽다.
     *
     * 정적 최적화되면 401/503 본문이 빌드에 구워지고 cron이 영원히 캐시 응답을 받는다.
     * 그리고 **캐시 응답은 Vercel 로그에도 남지 않으므로**(실측 ⑤) 그 사고는 자기 흔적을
     * 지운다.
     */
    const DECLARATION = "export const dynamic = 'force-dynamic'"

    for (const [route, { forcesDynamic }] of Object.entries(ROUTE_HANDLERS)) {
      const file = join(APP, ...route.split('/').filter(Boolean), 'route.ts')
      const source = readFileSync(file, 'utf8')
      expect(source, `${route}의 파일이 비어 있다`).not.toBe('')
      expect(source.includes(`\n${DECLARATION}`), `${route}`).toBe(forcesDynamic)
    }

    // 양성 대조 — 위 반복문이 0회 돌면 아무것도 증명하지 않는다.
    expect(Object.values(ROUTE_HANDLERS).filter((h) => h.forcesDynamic).length).toBeGreaterThan(0)
  })

  it('`vercel.json`의 cron 경로가 실재하는 핸들러다', () => {
    /*
     * 경로가 틀리면 **배포는 성공하고 잡만 404를 받는다.** 그리고 404는 3xx·캐시와 달리
     * 로그에 남지만, 남는 곳이 「1시간 보존」이므로 다음에 볼 때 사라져 있다(DOC-013 §7).
     * 오타를 저장소에서 잡는 편이 싸다.
     */
    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>
      regions?: string[]
    }
    expect(config.crons, 'vercel.json에 crons가 없다').toHaveLength(1)
    expect(HANDLERS).toContain(config.crons![0]!.path)
  })

  it('스케줄과 리전이 DOC-013 §6.2와 같다 — `vercel.json`이 시각을 혼자 정하지 않는다', () => {
    /*
     * ★ **DOC-010 §6.2의 각주가 요구한 것이 이 단언이다** — v1.8까지 시각이 어느 문서에도
     * 없어 `vercel.json`이 그것을 혼자 정하게 되어 있었고, 그러면 「왜 05:00 UTC인가」가
     * 어디에도 없다. 문서가 근거를 갖고 있으므로(공급자의 T+1 13:00 KST 게시) **설정이
     * 문서를 따라야 하며 그 방향을 여기서 고정한다.**
     */
    const lines = readFileSync(DOC_013, 'utf8').split('\n')
    const heading = lines.findIndex((line) => line.startsWith('### 6.2 스케줄'))
    expect(heading, 'DOC-013 §6.2를 찾지 못했다').toBeGreaterThan(-1)
    expect(
      lines.findIndex((line, i) => i > heading && line.startsWith('### 6.2 스케줄')),
      '§6.2 제목이 둘 이상이다',
    ).toBe(-1)

    const table = lines.slice(heading, heading + 12)
    const cell = (label: string): string => {
      const row = table.find((line) => line.startsWith(`| ${label} |`))
      expect(row, `§6.2에 「${label}」 행이 없다`).toBeDefined()
      const value = /`([^`]+)`/.exec(row!)
      expect(value, `「${label}」 행에 백틱 값이 없다`).not.toBeNull()
      return value![1]!
    }

    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
      regions: string[]
    }

    expect(config.crons[0]!.schedule).toBe(cell('표현식'))
    expect(config.regions).toEqual([cell('리전')])
    // 문서 쪽 값의 형태도 본다 — 빈 백틱이나 다른 셀을 잡았으면 여기서 드러난다.
    expect(cell('표현식')).toMatch(/^[\d*]+ [\d*]+ [\d*]+ [\d*]+ [\d*]+$/)
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
  // **`createProduct`에서 `/prices`·`/schedule`이 빠진 것이 이 행의 내용이다.**
  // 기실현 등재는 평가일정 0건·기초자산 0종이므로 일정 목록에 나타날 수 없고
  // 시세 화면의 `usedByActiveProducts`도 움직이지 않는다(DOC-002 D-07).
  createRealizedProduct: ['/', '/forecast', '/products', '/tax'],
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
  /*
   * §5.12 — `createAsset`과 **같은 셋**이다. 같은 두 질의(`listAssetPrices`·`searchAssets`)에
   * 미치므로 곱한 결과가 같다.
   *
   * ★ 「같아서 옳다」가 아니라 **옳아서 같다**는 것을 적어 둔다: 매핑을 고치면 SCR-302의
   * 목록과 등록·수정 화면의 자동완성(`hasPriceProvider`)이 낡는다. 반대로 `/products`나
   * `/tax`는 낡지 «않는다» — 매핑은 「어디서 값을 가져올지」이고 `asset_prices`의 값을
   * 바꾸지 않으므로 판정 입력이 그대로다.
   */
  saveProviderSymbol: ['/prices', '/products/[id]/edit', '/products/new'],
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

  it('조회 계약을 읽지 않는 라우트 둘 — 어떤 변경에도 낡지 않는다', () => {
    /*
     * ★ **빈 배열이 옳은 자리를 「하나」에서 「이유가 있는 둘」로 바꿨다 (P6 컷 5).**
     *
     * `ROUTE_QUERIES`의 항목이 비면 보통 그 화면은 「저장했는데 그 화면만 그대로」가
     * 되므로 이 단언은 원래 **`/settings` 하나만** 허용했다. 컷 5가 SCR-205를 세우며
     * 둘째가 생겼고, **개수를 늘리는 것으로 고치지 않는다** — 그러면 다음에 조용히
     * 빈 항목이 하나 더 생겨도 개수만 맞추면 통과한다. 대신 **이유를 원장으로 적고
     * 그 원장과 대조한다**: 새 빈 항목은 이유를 쓰지 않고는 초록이 되지 않는다.
     *
     * | 라우트 | 왜 아무것도 읽지 않는가 |
     * |---|---|
     * | `/settings` | 로그아웃 + 앱 정보·면책뿐이다. 낡을 값이 없다 |
     * | `/products/realized/new` | 계약 조건을 입력받지 않으므로 자산 목록조차 읽지 않는다(SCR-204와 갈리는 자리) |
     *
     * 같은 사실의 다른 면: 두 라우트는 `next build`에서 정적으로 프리렌더된다
     * (`cookies()`를 지나지 않는다). 그래서 **날짜·시각을 표시할 수 없다** — 그
     * 함정의 실측 기록이 `src/app/(app)/settings/page.tsx`의 머리글에 있다.
     */
    const READS_NOTHING: Record<string, string> = {
      [PATHS.settings]: '로그아웃 + 앱 정보·면책뿐. 낡을 값이 없다',
      [PATHS.productRealizedNew]:
        '계약 조건을 입력받지 않으므로 자산 목록조차 읽지 않는다 (DOC-008 SCR-205)',
    }

    for (const route of Object.keys(READS_NOTHING)) {
      expect(ROUTE_QUERIES[route], `${route}는 아무것도 읽지 않는다`).toEqual([])
      for (const name of MUTATION_NAMES) {
        expect(staleRoutesFor(name), `${name} → ${route}`).not.toContain(route)
      }
    }

    // 빈 항목이 원장과 정확히 일치한다 — 다른 화면이 조용히 비면 이 단언이 잡는다.
    const empty = Object.entries(ROUTE_QUERIES)
      .filter(([, queries]) => queries.length === 0)
      .map(([route]) => route)
    expect(empty.sort()).toEqual(Object.keys(READS_NOTHING).sort())
  })

  it('`/forecast`는 세금 요약과 함께 낡는다 — 대리 기준이 옳았다', () => {
    /*
     * ★ **제목이 「P4b의 대리 기준」에서 「대리 기준이 옳았다」로 바뀌었다.** 컷 8이
     * `/forecast`를 `PENDING_ROUTES`에서 `ROUTE_QUERIES`로 옮겼으므로 첫 줄의 단언이
     * 뒤집힌다 — 원장이 비었다.
     *
     * **본문은 살린다.** 그것이 대리가 옳았다는 **사후 증거**이기 때문이다: 대리
     * 기준이었을 때 이 반복문이 참이었고, 실명 계약으로 옮긴 뒤에도 같은 반복문이
     * 참이다. `getForecast`의 소속이 `getTaxSummary`와 정확히 같은 일곱이라는 것이 그
     * 근거이며 위 「낡는 자리도 같다」가 그 집합을 직접 단언한다. `PENDING_ROUTES`
     * 독블록이 적은 「지금 여섯 줄이 옳았다면 그대로 통과한다」가 여기서 검산된다.
     */
    expect(Object.keys(PENDING_ROUTES)).toEqual([])
    for (const name of MUTATION_NAMES) {
      // `INVALIDATION`이 `as const`이므로 리터럴 튜플의 유니온이고 `.includes`의
      // 파라미터가 `never`로 좁혀진다 — `staleRoutesFor`와 같은 이유로 넓혀 받는다.
      const affects: readonly QueryName[] = INVALIDATION[name].affects
      const withTax = affects.includes('getTaxSummary')
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

/**
 * 외부 조회의 이름 — **어댑터 객체에서 실행 시점에 파생한다** (DOC-011 §4.10, v4.4)
 *
 * `MUTATION_NAMES`가 `createMutations`의 키에서 나오는 것과 같은 형태다. 목록을 여기 다시 적으면
 * 어댑터에 조회가 늘어도 이 파일은 모른다(「빠지지 않았는가」에 답하지 못한다). 가짜 `fetch`는
 * 던진다 — 키만 읽고 부르지 않는다.
 */
const EXTERNAL_NAMES = Object.keys(
  createKiwoomProductSource({
    fetchImpl: (async () => {
      throw new Error('외부 조회 이름만 읽는다 — 부르지 않는다')
    }) as unknown as typeof fetch,
  }),
)

describe('DOC-011 §8 추적 매트릭스 ↔ 맵', () => {
  const rows = tableAfterHeader(DOC_011, '| 화면 | 조회 계약 | 변경 계약 |')

  it('매트릭스를 찾았다', () => {
    // SCR-001·101·201·202·203·204·**205**·301·302·401·402·501·502
    expect(rows.length).toBe(13)
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
    /*
     * **`planned`가 컷 8부터 빈 집합이다** — `PENDING_ROUTES`가 비었으므로 이 케이스는
     * 지금 「문서가 배정한 조회 계약이 전부 실재한다」와 같다. 그 갈래를 지우지 않는
     * 이유는 §4.7이 미구현이던 동안 이 단언을 통과시킨 것이 정확히 그 갈래였다는 것이다
     * — 다음 계약이 문서에 먼저 적히는 날(문서 선행이 이 프로젝트의 규약이다) 같은
     * 상태가 재현된다.
     */
    const documented = new Set(rows.flatMap(([, queries]) => identifiers(queries ?? '')))
    const planned = new Set(Object.values(PENDING_ROUTES).map((p) => p.plannedQuery))

    for (const query of documented) {
      // `listUserSummaries`는 계약으로 남지만 화면을 만들지 않는다(SQ-01) —
      // 실재하는 계약이므로 `QUERY_NAMES`에 있다. 외부 조회(§4.10)는 셋째 부류다.
      expect(
        QUERY_NAMES.includes(query as QueryName) || planned.has(query) || EXTERNAL_NAMES.includes(query),
        `${query}가 계약도 아니고 미구현 등재도 아니고 외부 조회도 아니다`,
      ).toBe(true)
    }
  })

  it('★ 외부 조회 — 이름이 조회 계약과 겹치지 않고, 원장의 값이 전부 실재한다', () => {
    expect(EXTERNAL_NAMES.sort()).toEqual(['getKiwoomProductTerms', 'listKiwoomAssets', 'searchKiwoomProducts'])
    for (const name of EXTERNAL_NAMES) expect(QUERY_NAMES as readonly string[]).not.toContain(name)
    for (const names of Object.values(ROUTE_EXTERNAL_LOOKUPS)) {
      for (const name of names) expect(EXTERNAL_NAMES).toContain(name)
    }
  })

  it('★ 화면이 부르는 외부 조회와 `ROUTE_EXTERNAL_LOOKUPS`가 일치한다 — 양방향', () => {
    /*
     * `ROUTE_QUERIES` 대조와 같은 합집합 규칙이다(아래 케이스의 각주). 한쪽에만 이름이 있으면
     * — 문서에만: 화면이 부른다고 적었는데 원장이 모른다 / 원장에만: 문서가 모르는 외부 요청을
     * 화면이 보낸다(ADR-009 §5의 「부르는 요청 수」가 거짓이 된다).
     */
    const routesOfScreen = screenRoutes()
    const documentedRoutes = new Set<string>()
    for (const [screen, queries] of rows.map(([cell, q]) => [cell ?? '', q ?? ''])) {
      const id = /SCR-\d+/.exec(screen)?.[0]
      if (id == null || id in UNBUILT_SCREENS) continue
      const routes = routesOfScreen[id]
      if (routes == null) continue
      const fromDoc = new Set(identifiers(queries).filter((q) => EXTERNAL_NAMES.includes(q)))
      const fromCode = new Set(routes.flatMap((route) => ROUTE_EXTERNAL_LOOKUPS[route] ?? []))
      expect([...fromCode].sort(), `${id}가 부르는 외부 조회`).toEqual([...fromDoc].sort())
      if (fromDoc.size > 0) routes.forEach((r) => documentedRoutes.add(r))
    }
    // 원장의 라우트가 전부 문서의 화면에 속한다 — 속하지 않으면 위 대조가 그 라우트를 보지 않는다
    for (const route of Object.keys(ROUTE_EXTERNAL_LOOKUPS)) expect(documentedRoutes).toContain(route)
  })

  it('화면이 읽는 계약과 `ROUTE_QUERIES`가 일치한다', () => {
    /*
     * §8은 **화면 단위**이고 `ROUTE_QUERIES`는 **라우트 단위**다. SCR-204가 두
     * 라우트(`/products/new`·`/products/[id]/edit`)이며 입력이 다르므로
     * (등록은 `searchAssets`만, 수정은 `getProduct`도) 화면 단위로는 표현할 수
     * 없다 — 화면 단위로 두면 「시세를 저장했으니 등록 화면도 지운다」는 잘못된
     * 합성이 나온다. 그래서 대조는 **합집합**으로 한다: 한 화면의 라우트들이 읽는
     * 계약을 합치면 문서가 그 화면에 적은 집합과 같아야 한다.
     *
     * ## 코드 측 원장은 **둘**이다 — `PENDING_ROUTES`도 읽는다 (P4b 컷 7)
     *
     * ★ **이 줄이 컷 7에서 필요해졌고 컷 8에서 무해해진다.** `getForecast`가 실재하는
     * 계약이 되는 순간 `fromDoc`에 그것이 들어오는데(그 전에는 `QUERY_NAMES` 필터가
     * 조용히 버렸다) `/forecast`는 아직 `PENDING_ROUTES`에 있으므로 `fromCode`가 비어
     * 「SCR-402가 읽는 계약: [] ≠ ['getForecast']」로 빨간불이 됐다.
     *
     * 답은 예외를 두는 것이 아니라 **원장을 온전히 읽는 것**이다. `PENDING_ROUTES`의
     * 존재 이유가 정확히 「이 라우트가 그 계약을 읽을 것이다」이므로, 그것을 세지 않는
     * 대조는 코드가 아는 것보다 좁게 본다. 컷 8이 그 항목을 `ROUTE_QUERIES`로 옮기면
     * 이 `??`의 오른쪽이 빈 집합이 되어 **같은 답이 남는다** — `PENDING_ROUTES` 독블록이
     * 적은 「합성 대조가 자동으로 검산한다」가 그렇게 성립한다.
     */
    const routesOfScreen = screenRoutes()

    for (const [screen, queries] of rows.map(([cell, q]) => [cell ?? '', q ?? ''])) {
      const id = /SCR-\d+/.exec(screen)?.[0]
      if (id == null) continue
      if (id in UNBUILT_SCREENS) continue // 만들지 않기로 한 화면 — 위 표에 사유가 있다
      const routes = routesOfScreen[id]
      if (routes == null) continue // 경로가 없는 화면(SCR-901·902)

      const fromCode = new Set(
        routes.flatMap((route) => {
          const planned = PENDING_ROUTES[route]?.plannedQuery
          return [
            ...(ROUTE_QUERIES[route] ?? []),
            // 미구현 등재의 `plannedQuery`가 실재하는 계약이 된 뒤에만 센다 — 계약이
            // 없는 동안은 `QUERY_NAMES` 필터가 `fromDoc`에서도 그것을 버리므로 양쪽이
            // 함께 비어 균형이 맞는다.
            ...(planned != null && QUERY_NAMES.includes(planned as QueryName)
              ? [planned as QueryName]
              : []),
          ]
        }),
      )
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
  // P6 컷 5에서 SCR-205(기실현 등재)가 더해져 14 → 15
  expect(rows.length, 'DOC-008 §4 화면 목록이 비어 있다').toBe(15)

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
    /*
     * **자리표시가 없다** — P4b 컷 8이 마지막 하나(`/forecast`)를 세웠다. 그것이
     * 화면이 아니라 **계약 신설**이었으므로(RD-02 + DOC-007 §7.5 + `getForecast`)
     * P4의 범위 밖에서 여기 남아 있었고, 컷 7이 계약을 세운 뒤 컷 8이 화면을 세웠다.
     *
     * **두 원장이 함께 비었다.** 위 `noFile`은 컷 6에서, 이쪽은 여기서 비었다 —
     * 합계가 0이라는 것이 「P4의 화면이 전부 실화면이다」의 형태다.
     */
    expect(placeholders.sort()).toEqual([])
  })

  it('P4가 세우는 화면 12개가 전부 섰다 — 컷 10의 종료 조건', () => {
    /*
     * ★ **P4의 종료 상태를 숫자로 고정한다.** 계획 §4의 「화면 12개 ↔ 컷」 표가 그
     * 목록이며, DOC-008 §4의 14개에서 SCR-501(만들지 않는다)을 빼고 SCR-901·902를
     * 선행 조건 ③으로 흡수한 결과다.
     *
     * 여기서 세는 것은 **라우트**이므로 12와 같지 않다: SCR-202·203·204가 라우트
     * 다섯이고(상세·상환·등록·수정) SCR-901·902는 라우트가 아니다. 그래서 개수 대신
     * **자리표시 원장이 비었다**는 사실을 종료 조건으로 쓴다.
     *
     * ★ **P4b 컷 8에서 `[PATHS.forecast]` → `[]`가 되었다.** 컷 10 시점에는 그 하나가
     * 남는 것이 정상이었다 — 화면이 아니라 계약 신설이었기 때문이다. 컷 7이 계약을
     * 세우고 컷 8이 화면을 세웠으므로 그 예외가 사라졌고, **아래 반복문의 예외도 함께
     * 지웠다** — `/forecast`가 나머지와 같은 규칙으로 단언된다.
     */
    const placeholders = placeholderRoutes()
    expect(placeholders).toEqual([])

    /*
     * 나머지 라우트는 전부 실화면이다 — 문서가 정의한 경로 중 파일 없는 것도,
     * 자리표시로 남은 것도 없다. **`/forecast`의 예외가 사라졌다**(컷 8): 이제 그
     * 경로도 「파일이 있고 자리표시가 아니다」를 나머지와 같이 통과해야 한다.
     */
    const routes = new Set(actualRoutes())
    for (const [screen, paths] of Object.entries(screenRoutes())) {
      for (const path of paths) {
        if (path in NOT_YET_BUILT) continue
        expect(routes.has(path), `${screen} ${path}`).toBe(true)
        expect(placeholders, `${screen} ${path}는 아직 자리표시다`).not.toContain(path)
      }
    }
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

  it('원장 셋이 전부 비었다 — 뒤의 둘은 **같은 사실의 두 관측**이다 (P4b 컷 8)', () => {
    /*
     * ★ **셋으로 세고 넷으로 세지 않는다.** `PENDING_ROUTES`와 `placeholderRoutes()`는
     * 서로 다른 원장처럼 보이지만 컷 8 이후로는 **한 사실의 두 관측**이다: 전자는 손으로
     * 적은 선언이고 후자는 `page.tsx`를 실제로 훑은 결과이며, 마지막 자리표시가
     * `/forecast` 하나였으므로 둘이 함께 비거나 함께 차 있다.
     *
     * 그래서 이 케이스의 값은 「셋이 비었다」가 아니라 **「선언과 실측이 일치한다」**다.
     * 갈리는 경우가 둘 있고 그것이 이 단언이 잡는 것이다 — ① `PENDING_ROUTES`에서 항목을
     * 지웠는데 `page.tsx`가 여전히 자리표시다(원장만 앞서갔다) ② 자리표시를 세웠는데
     * 원장에서 지우지 않았다(원장이 뒤처졌다). **①이 더 위험하다**: 그쪽은 화면이 섰다고
     * 말하면서 실제로는 서지 않은 상태이고, 다른 어느 케이스도 그것을 보지 않는다.
     *
     * `NOT_YET_BUILT`(`/users` 제외)는 위 「두 원장이 함께 센다」가 이미 비었음을 단언하고
     * `PENDING_PARTS`는 그 위 케이스가 단언한다 — 여기서 다시 세지 않는다.
     */
    expect(Object.keys(PENDING_ROUTES)).toEqual([])
    expect(placeholderRoutes()).toEqual([])

    /*
     * 두 관측이 **같은 라우트 집합**임을 함께 박는다. 위 두 줄만으로는 둘이 각각 비었다는
     * 것뿐이고, 다음에 자리표시가 하나 생겼을 때 한쪽만 채워도 둘 다 「비지 않았다」로
     * 통과한다 — 그때 갈림을 잡는 것이 이 줄이다.
     */
    expect(placeholderRoutes().sort()).toEqual(Object.keys(PENDING_ROUTES).sort())
  })
})
