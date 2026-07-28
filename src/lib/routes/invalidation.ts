import type { Mutations } from '@/lib/db/mutations/context'
import type { Queries } from '@/lib/db/queries/context'

import { PATHS } from './paths'

/**
 * 무효화 — **DOC-011 §8 추적 매트릭스의 코드 측 짝**
 *
 * ## 실측이 이 파일의 형태를 정했다 (P4 컷 1b)
 *
 * 계획은 세분화된 경로 목록을 각 계약에 매다는 것이었다. 그 전에 **네 경우를
 * 실측했고**(계획 §8이 요구한 게이트) 결과가 설계를 바꿨다. `next build` +
 * `next start`에 실제 서버 액션을 HTTP로 호출해(브라우저 없이 — 서버가 렌더한
 * `$ACTION_*` 히든 필드를 복제하면 JS 없는 폼 제출과 같은 요청이 된다) 세 설정을
 * 관측했다.
 *
 * | 설정 | (a) 액션 응답 | (b) 새 문서 GET | (c) RSC 페이로드 |
 * |---|---|---|---|
 * | ① 무효화 없음 | 최신 | 최신 | 최신 |
 * | ② 정확한 경로 (세분화) | 최신 | 최신 | 최신 |
 * | ③ **무관한 경로만**(`/tax`) — 대조군 | 최신 | 최신 | 최신 |
 *
 * ④ `router.refresh()`는 클라이언트가 RSC를 재요청하는 방식이고, 그 재요청이 곧
 * (c)이므로 ①에 (c)를 한 번 더 붙인 것과 같다 — (c)가 이미 최신이므로 추가 효과가
 * 없다.
 *
 * **대조군이 초록인 것이 실험 실패가 아님을 따로 확인했다.** `revalidatePath` 호출을
 * 로그로 관측했다: ②는 `/prices`·`/products`·`/products/[id]`(layout)·
 * `/products/[id]/edit`(page)·`/products/new`·`/schedule`·`/`를 부르고 ③은 `/tax`
 * **하나만** 부른다. 즉 기전은 살아 있고 인자도 달랐는데 **관측이 같았다.**
 *
 * 이유는 서버에 지울 것이 없다는 것이다 — 모든 데이터 화면이 `cookies()`를 지나
 * 동적이고(`GET /prices` 응답이 `private, no-cache, no-store, max-age=0,
 * must-revalidate`) `createSessionClient`가 모든 Supabase 요청에 `cache: 'no-store'`를
 * 건다(`client.ts`). 정적으로 프리렌더된 응답은 자리표시 화면뿐이며
 * (`GET /products` → `s-maxage=31536000`) 그것들은 데이터를 읽지 않는다.
 *
 * ## 그래서 호출은 한 줄이고, 맵은 지식으로 남는다
 *
 * `revalidatePath`가 실제로 지우는 것은 **클라이언트 라우터 캐시**이고 그것은
 * 브라우저 안에 있다 — 우리가 가진 어느 층도 보지 못한다(AQ-32). 세분화의 유일한
 * 위험은 **부족하게 지우는 것**이고, 그 정확성을 확인할 방법이 없는 상태에서
 * 손으로 적은 경로 목록에 correctness를 의존하는 것은 «커버리지처럼 보이는 죽은
 * 무게»다. 효과는 `server.ts`에서 **경로 하나**(`'/'` + `layout`)로 끝낸다 —
 * 구조적으로 부족할 수 없다.
 *
 * 남기는 것은 **판정 기준**이다. 「어느 변경이 어느 조회를 바꾸는가」(`affects`)와
 * 「어느 라우트가 무엇을 읽는가」(`ROUTE_QUERIES`)는 화면을 세울 때마다 필요한
 * 지식이고 문서(§8)와 대조 가능하다. 경로 목록은 그 둘의 곱이므로 따로 적지 않는다 —
 * `tests/app/invalidation.test.ts`가 곱해서 검산한다.
 *
 * ## 판정 기준은 §4.2의 "입력 기준"이다
 *
 * 이름이나 직관이 아니라 그 계약이 **실제로 읽는 입력**. 코드를 읽어 직관 둘이
 * 틀렸음을 확인했다.
 *
 * | 직관 | 실제 |
 * |---|---|
 * | 시세가 바뀌면 세금도 바뀐다 | **아니다.** `tax.ts`의 추정 기여는 `grossExpected(원금·연쿠폰율·평가주기·차수)`뿐이고 `conditionResult`도 시세도 쓰지 않는다(§4.3이 정한 `EARLY` 가정) |
 * | 상환은 시세 화면과 무관하다 | **아니다.** `listAssetPrices.usedByActiveProducts`가 "참조 중인 **미상환** 상품 수"이므로 상환 등록·취소가 `/prices`를 바꾼다 |
 */

export type QueryName = keyof Queries
export type MutationName = keyof Mutations

export type InvalidationRule = {
  /** 이 변경이 값을 바꾸는 조회 계약 — 판정 기준(§4.2 입력 기준) */
  affects: readonly QueryName[]
}

/** 상품의 존재·조건·상태를 바꾸는 것들이 공유하는 축. */
const PRODUCT_WIDE = [
  'getProduct',
  'listProducts',
  'listSchedule',
  'getDashboard',
  'listAssetPrices',
  'getTaxSummary',
] as const satisfies readonly QueryName[]

/** 시세를 바꾸는 것들이 공유하는 축. 세금이 없는 것이 요점이다. */
const PRICE_WIDE = [
  'listAssetPrices',
  'listProducts',
  'getProduct',
  'listSchedule',
  'getDashboard',
] as const satisfies readonly QueryName[]

/**
 * **`Record<MutationName, …>`이다.** 계약이 열둘째로 늘면 여기서 컴파일이 깨지므로
 * 「무엇이 낡는가」를 정하지 않고 계약을 추가할 수 없다. `RULE_IDS` 전수 열거와
 * 같은 자리다.
 */
export const INVALIDATION: Record<MutationName, InvalidationRule> = {
  // §5.1 — 새 상품이 목록·일정·홈에 나타나고 시세 화면의 `usedByActiveProducts`가
  // 올라가고 세금·전망의 추정 기여가 생긴다. **기존 상품의 상세는 바뀌지 않는다.**
  createProduct: {
    affects: [
      'listProducts',
      'listSchedule',
      'getDashboard',
      'listAssetPrices',
      'getTaxSummary',
    ],
  },

  // §5.2·§5.3 — 위 전부 + 그 상품의 상세. 삭제 후 상세는 404가 되어야 한다.
  updateProduct: { affects: [...PRODUCT_WIDE] },
  deleteProduct: { affects: [...PRODUCT_WIDE] },

  // §5.9 — **세금이 아니다.** KI 터치는 `kiStatus`와 조건 판정을 바꾸지만 세금의
  // 추정 기여는 `grossExpected`뿐이고 그것은 KI를 보지 않는다.
  setKiTouched: {
    affects: ['getProduct', 'listProducts', 'listSchedule', 'getDashboard'],
  },

  // §5.4·§5.5 — 상태 전이이므로 가장 넓다. `listAssetPrices`가 포함되는 이유가
  // `usedByActiveProducts`다(위 표의 둘째 줄).
  createRedemption: { affects: [...PRODUCT_WIDE] },
  updateRedemption: { affects: [...PRODUCT_WIDE] },
  deleteRedemption: { affects: [...PRODUCT_WIDE] },

  // §5.6 — 프로필은 세금 계산의 입력이다. 홈의 `currentYearTax`도 같은 집계를 쓴다.
  saveTaxProfile: { affects: ['getTaxSummary', 'getDashboard'] },

  // §5.7·§5.8 — **세금이 아니다**(위 표의 첫째 줄).
  saveManualPrice: { affects: [...PRICE_WIDE] },
  refreshPrices: { affects: [...PRICE_WIDE] },

  // §5.10 — 자산 목록을 읽는 곳만. 시세 목록과 등록·수정 화면의 자동완성이다.
  createAsset: { affects: ['listAssetPrices', 'searchAssets'] },
}

/**
 * 라우트별로 **무엇을 읽는가** — DOC-011 §8을 **라우트 단위로** 쪼갠 것
 *
 * §8은 화면 단위이고 SCR-204는 라우트가 둘이다(`/products/new`·`/products/[id]/edit`).
 * 그 둘의 입력이 다르다 — 등록은 `searchAssets`만 읽고 수정은 `getProduct`도 읽는다.
 * 화면 단위로 두면 「시세를 저장했으니 등록 화면도 낡았다」는 잘못된 합성이 나온다.
 *
 * `/forecast`는 계약이 아직 없다(§4.7 미구현) — `PENDING_ROUTES`에 있다.
 */
export const ROUTE_QUERIES: Record<string, readonly QueryName[]> = {
  [PATHS.home]: ['getDashboard'],
  [PATHS.products]: ['listProducts'],
  '/products/[id]': ['getProduct'],
  '/products/[id]/redeem': ['getProduct'],
  '/products/[id]/edit': ['getProduct', 'searchAssets'],
  [PATHS.productNew]: ['searchAssets'],
  [PATHS.schedule]: ['listSchedule'],
  [PATHS.prices]: ['listAssetPrices'],
  [PATHS.tax]: ['getTaxSummary'],
  [PATHS.settings]: [],
}

/**
 * 계약이 아직 없는 라우트 — **`/forecast` 하나다** (§4.7 미구현, P4b)
 *
 * `ROUTE_QUERIES`에 적을 수 없다. `getForecast`가 `QueryName`에 없으므로(계약이
 * 없다) 적으면 컴파일이 깨지고, 빈 배열로 두면 **아무 변경에도 낡지 않는 화면**이
 * 되어 계획 §8이 그 경로를 여섯 줄에 넣은 근거가 사라진다.
 *
 * 그래서 대리 기준을 데이터로 적는다. `getForecast`의 입력(상품 + 과세 프로필 +
 * 세율 시드)은 `getTaxSummary`의 입력을 **포함하므로**, 세금 요약이 낡는 변경은
 * 전망도 낡게 한다. 반대로 KI 터치·시세는 둘 다 낡게 하지 않는다 — 같은 기준이 두
 * 경로에 같은 답을 준다는 것이 대리가 성립하는 근거다.
 *
 * P4b가 `getForecast`를 만들면 이 항목을 지우고 `ROUTE_QUERIES`에 실명으로 넣는다.
 * 그때 합성 대조가 **자동으로 검산한다** — 지금 여섯 줄이 옳았다면 그대로 통과한다.
 */
export const PENDING_ROUTES: Record<
  string,
  { plannedQuery: string; invalidatedWith: QueryName }
> = {
  [PATHS.forecast]: { plannedQuery: 'getForecast', invalidatedWith: 'getTaxSummary' },
}

/**
 * 그 변경으로 **낡는 라우트** — `affects` × `ROUTE_QUERIES`.
 *
 * 런타임 무효화는 이 목록을 쓰지 않는다(위 실측). 화면을 세울 때 「이 변경 뒤에
 * 무엇이 낡는가」를 묻는 자리와 `tests/app/invalidation.test.ts`의 합성 대조가
 * 소비하며, 어느 라우트가 캐시 가능해지는 날(`'use cache'`·정적 렌더) 그때
 * 무효화의 입력이 된다.
 */
export function staleRoutesFor(name: MutationName): string[] {
  const { affects } = INVALIDATION[name]

  const fromQueries = Object.entries(ROUTE_QUERIES)
    .filter(([, queries]) => queries.some((query) => affects.includes(query)))
    .map(([route]) => route)

  const fromPending = Object.entries(PENDING_ROUTES)
    .filter(([, pending]) => affects.includes(pending.invalidatedWith))
    .map(([route]) => route)

  return [...fromQueries, ...fromPending].sort()
}
