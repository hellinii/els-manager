import type { Mutations } from '@/lib/db/mutations/context'
import type { Queries } from '@/lib/db/queries/context'
import type { KiwoomProductSource } from '@/lib/providers/kiwoom/terms-types'

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

/**
 * 상품의 존재·조건·상태를 바꾸는 것들이 공유하는 축.
 *
 * `listUserSummaries`·`getForecast`가 `getTaxSummary`와 **같은 자리에 있다** — 셋 다
 * 상품 전량과 본인 프로필을 읽는다(`loadProducts`·`loadTaxProfile(s)`). 화면이 없다는
 * 것(SQ-01)은 값이 낡지 않는다는 뜻이 아니다.
 *
 * `getForecast`가 세 계약 중 가장 넓게 낡는다 — 한 해가 아니라 `years`개 연도이고
 * `cumulativeNet`이 앞 연도의 누계에 의존하므로 어느 해의 상환이 바뀌어도 그 뒤 행이
 * 전부 바뀐다. 그래도 **소속은 같다**: 판정 기준이 「어느 입력을 읽는가」이고 셋의
 * 입력이 같기 때문이다(§4.2).
 */
const PRODUCT_WIDE = [
  'getProduct',
  'listProducts',
  'listSchedule',
  'getDashboard',
  'listAssetPrices',
  'getTaxSummary',
  'listUserSummaries',
  'getForecast',
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
 * **`satisfies Record<MutationName, …>`이다.** 계약이 열둘째로 늘면 여기서 컴파일이
 * 깨지므로 「무엇이 낡는가」를 정하지 않고 변경 계약을 추가할 수 없다. `RULE_IDS`
 * 전수 열거와 같은 자리다.
 *
 * **`as const`인 이유는 조회 축이다** — 주석이 아니라 아래 `_queryAxisIsExhaustive`가
 * 리터럴을 읽어야 「어느 `affects`에도 없는 조회」를 컴파일에서 잡는다. 그래서 형태를
 * 타입 표기에서 `satisfies`로 옮겼다: 표기는 리터럴을 지워 witness를 항진명제로
 * 만들고, `satisfies`는 지우지 않으면서 같은 전수를 강제한다.
 */
export const INVALIDATION = {
  // §5.1 — 새 상품이 목록·일정·홈에 나타나고 시세 화면의 `usedByActiveProducts`가
  // 올라가고 세금·전망의 추정 기여가 생긴다. **기존 상품의 상세는 바뀌지 않는다.**
  createProduct: {
    affects: [
      'listProducts',
      'listSchedule',
      'getDashboard',
      'listAssetPrices',
      'getTaxSummary',
      'listUserSummaries',
      'getForecast',
    ],
  },

  // §5.11 — 기실현 등재. **`createProduct`보다 좁다**: 그 상품은 평가일정 0건·
  // 기초자산 0종이므로(DOC-002 D-07)
  //   · `listSchedule`에 나타날 수 없다 — 그 목록의 행 단위가 **차수**다
  //   · `listAssetPrices`의 `usedByActiveProducts`를 움직이지 않는다 — 참조하는
  //     자산이 없고, 애초에 상환 완료라 「미상환」에도 들지 않는다
  // 반대로 세금·전망은 즉시 바뀐다 — 상환 실적이 그 해의 금융소득에 들어간다.
  createRealizedProduct: {
    affects: [
      'listProducts',
      'getDashboard',
      'getTaxSummary',
      'listUserSummaries',
      'getForecast',
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
  // §4.8의 본인 행도 그 프로필을 읽는다(`includesOtherFinancialIncome`이 참인 행).
  // 전망은 **저장한 해 이후 전부**가 바뀐다 — 이월(LOCF)이 그 값을 뒤 연도로 나른다.
  saveTaxProfile: {
    affects: ['getTaxSummary', 'getDashboard', 'listUserSummaries', 'getForecast'],
  },

  // §5.7·§5.8 — **세금이 아니다**(위 표의 첫째 줄).
  saveManualPrice: { affects: [...PRICE_WIDE] },
  refreshPrices: { affects: [...PRICE_WIDE] },

  // §5.10 — 자산 목록을 읽는 곳만. 시세 목록과 등록·수정 화면의 자동완성이다.
  createAsset: { affects: ['listAssetPrices', 'searchAssets'] },

  /*
   * §5.12 — 공급자 매핑. **`createAsset`과 같은 둘이며 그 사실에 근거가 있다.**
   *
   * ⓐ `listAssetPrices` — SCR-302의 뷰가 `providerSymbols`를 담는다(§4.5)
   * ⓑ `searchAssets` — 그쪽의 `hasPriceProvider`가 **바로 이 테이블의 행 수에서
   *    파생된다**(`queries/prices.ts`). 매핑을 넣거나 지우면 그 boolean이 뒤집히므로
   *    빠뜨리면 등록 화면의 자동완성이 낡은 값을 보여 준다
   *
   * ★ **시세·상품·세금 축에는 미치지 «않는다».** 매핑은 「어디서 값을 가져올지」이고
   * `asset_prices`의 값을 바꾸지 않는다 — 판정 입력이 그대로이므로 워스트오브·조건
   * 판정·세금이 움직일 이유가 없다. `PRICE_WIDE`를 쓰면 다섯 개를 헛되게 무효화한다.
   * (매핑을 넣은 «결과»로 시세가 들어오는 것은 §5.8의 몫이고 그쪽이 `PRICE_WIDE`다.)
   */
  saveProviderSymbol: { affects: ['listAssetPrices', 'searchAssets'] },
} as const satisfies Record<MutationName, InvalidationRule>

/**
 * 어느 `affects`에도 없는 조회 계약 — **AQ-39의 fail-open을 파생으로 닫는다**
 *
 * ## 왜 단언이 아니라 파생인가
 *
 * 변경 축은 위 `satisfies Record<MutationName, …>`가 이미 닫았다 — 변경 계약이 늘면
 * 컴파일이 깨진다. **조회 축에는 그 대칭이 없었다.** `tests/app/invalidation.test.ts`가
 * 「`affects`가 실재하는 계약만 가리킨다」를 단언하지만 그것은 한 방향이고, 새 조회
 * 계약을 어느 `affects`에도 넣지 않아도 **아무것도 실패하지 않았다.** CLAUDE.md 절대
 * 규칙 #6이 열거하는 형태 그대로다 — 「객체 종류가 늘어날 때 기존 카탈로그 단언이
 * 따라오지 않는다」.
 *
 * 실제로 하나가 그 구멍에 있었다. `listUserSummaries`는 상품 전량과 본인 프로필을
 * 읽는데(§4.8) 어느 `affects`에도 없었다 — 읽는 라우트가 없어 `staleRoutesFor`의
 * 결과가 달라지지 않았으므로 **무해했지만 기록된 무해함이 아니었다.** 이 파생을
 * 세우자 그 계약이 즉시 빨간불이 되었고, 답은 화이트리스트가 아니라 **등재**였다
 * (위 일곱 자리). 「비어 있던 것이 결정이 아니라 결함」임이 그렇게 판별된다.
 *
 * ## 왜 역 인덱스(`Record<QueryName, …>`)가 아닌가
 *
 * DOC-010의 권고 (b)는 조회 축의 역 인덱스를 함께 두는 것이었다. 쓰지 않는다 —
 * `Record<QueryName, …>`는 항목의 **존재**만 강제하고 `[]`가 합법이므로 「어느
 * `affects`에도 없는 조회」를 「빈 항목」으로 **옮겨 놓을 뿐이다.** 그리고 같은 지식이
 * 두 표에 손으로 적혀, 그 항목 자신의 근거인 「단언이 아니라 파생」을 위반한다.
 *
 * ## 형태
 *
 * `[T] extends [never]`의 튜플 감싸기가 필요하다 — 맨 `T extends never`는 분배
 * 조건부이므로 `T`가 `never`일 때 조건부 전체가 `never`로 붕괴해 어느 쪽 가지도
 * 고르지 않는다. 실패 가지가 `true`가 아니라 **튜플**인 이유는 오류 메시지다 —
 * 빠진 계약명이 「`['조회 축에 빠진 계약', 'getForecast']` 형식에 `true`를 할당할 수
 * 없다」로 그대로 나온다.
 *
 * 제네릭인 이유는 **음성 대조**다. `tests/app/invalidation.test.ts`가 결함 있는 맵으로
 * 이 파생을 다시 계산해 `@ts-expect-error`가 발화함을 고정한다 — 그 줄이 조용해지면
 * witness가 항진명제라는 뜻이다. 제약(`Record<MutationName, InvalidationRule>`)이
 * `affects`를 넓히지 **않는다**: 제약은 타입 인자를 검사할 뿐 대체하지 않으므로
 * `T[MutationName]['affects'][number]`는 넘긴 리터럴을 그대로 읽는다.
 */
export type UncoveredQueries<T extends Record<MutationName, InvalidationRule>> = Exclude<
  QueryName,
  T[MutationName]['affects'][number]
>

export type QueryAxisExhaustive<T extends Record<MutationName, InvalidationRule>> = [
  UncoveredQueries<T>,
] extends [never]
  ? true
  : ['조회 축에 빠진 계약', UncoveredQueries<T>]

/** 이 줄이 빨간불이면 새 조회 계약을 어느 `affects`에도 넣지 않았다는 뜻이다. */
const _queryAxisIsExhaustive: QueryAxisExhaustive<typeof INVALIDATION> = true

/**
 * 라우트별로 **무엇을 읽는가** — DOC-011 §8을 **라우트 단위로** 쪼갠 것
 *
 * §8은 화면 단위이고 SCR-204는 라우트가 둘이다(`/products/new`·`/products/[id]/edit`).
 * 그 둘의 입력이 다르다 — 등록은 `searchAssets`만 읽고 수정은 `getProduct`도 읽는다.
 * 화면 단위로 두면 「시세를 저장했으니 등록 화면도 낡았다」는 잘못된 합성이 나온다.
 *
 * `/forecast`가 P4b 컷 8에서 여기로 옮겨 왔다 — `PENDING_ROUTES`의 대리 기준이 실명
 * 계약이 되었고, 그 이전이 무효화 결과를 바꾸지 않았다(아래 `PENDING_ROUTES`의 각주).
 */
export const ROUTE_QUERIES: Record<string, readonly QueryName[]> = {
  [PATHS.home]: ['getDashboard'],
  [PATHS.products]: ['listProducts'],
  '/products/[id]': ['getProduct'],
  '/products/[id]/redeem': ['getProduct'],
  '/products/[id]/edit': ['getProduct', 'searchAssets'],
  [PATHS.productNew]: ['searchAssets'],
  // **비어 있는 것이 옳다** — 계약 조건을 입력받지 않으므로 자산 목록도 읽지 않고,
  // 읽는 것이 없으므로 어느 변경도 이 화면을 낡게 하지 않는다(`/settings`와 같은 자리).
  [PATHS.productRealizedNew]: [],
  [PATHS.schedule]: ['listSchedule'],
  [PATHS.prices]: ['listAssetPrices'],
  [PATHS.tax]: ['getTaxSummary'],
  [PATHS.forecast]: ['getForecast'],
  [PATHS.settings]: [],
}

/**
 * 라우트별 **외부 조회** — DB가 아니므로 무효화 축 밖이다 (DOC-011 §4.10 X-05, v4.3)
 *
 * `ROUTE_QUERIES`에 넣지 않는 이유: 그 표의 값은 `QueryName`이고 `_queryAxisIsExhaustive`가 모든
 * `QueryName`이 어느 변경의 `affects`에 있기를 요구한다. 키움 조회를 낡게 하는 변경은 없다 — 넣으려면
 * 가짜 `affects`를 지어내야 한다. 그래서 **따로 원장을 두고** DOC-011 §8과만 대조한다
 * (`tests/app/invalidation.test.ts` — 이름 집합은 어댑터 객체에서 실행 시점에 파생한다).
 */
export type ExternalLookupName = keyof KiwoomProductSource

export const ROUTE_EXTERNAL_LOOKUPS: Record<string, readonly ExternalLookupName[]> = {
  [PATHS.productNew]: ['searchKiwoomProducts', 'getKiwoomProductTerms', 'listKiwoomAssets'],
  // 수정 화면도 같은 셋이다(DOC-008 v2.12 · DOC-011 v4.6) — 소유 확인 뒤, 상환 처리된 상품에서는 부르지 않는다
  '/products/[id]/edit': ['searchKiwoomProducts', 'getKiwoomProductTerms', 'listKiwoomAssets'],
}

/**
 * 계약이 아직 없는 라우트 — **비었다** (P4b 컷 8에서 `/forecast`가 떠났다)
 *
 * ## 원장의 역사를 지우지 않고 「비었다」로 적는다
 *
 * 이 항목은 `/forecast` 하나를 담고 있었다. `getForecast`가 `QueryName`에 없어
 * `ROUTE_QUERIES`에 적을 수 없었고, 빈 배열로 두면 **아무 변경에도 낡지 않는 화면**이
 * 되어 그 경로를 무효화 대상으로 넣은 근거가 사라졌기 때문이다. 그래서 **대리 기준**을
 * 데이터로 적었다: `getForecast`의 입력(상품 + 과세 프로필 + 세율 시드)이
 * `getTaxSummary`의 입력을 포함하므로 세금 요약이 낡는 변경은 전망도 낡게 하고, KI
 * 터치·시세는 둘 다 낡게 하지 않는다.
 *
 * ## **그 대리가 옳았음이 사후 검산되었다**
 *
 * 컷 7이 `getForecast`를 세우고 `affects`에 등재했을 때 그 소속이 `getTaxSummary`와
 * **정확히 같은 일곱**으로 나왔다(`tests/app/invalidation.test.ts`가 두 집합의 동일성을
 * 단언한다). 그래서 이 항목을 지우고 `ROUTE_QUERIES`에 실명으로 넣어도
 * `staleRoutesFor('...')`의 결과가 한 줄도 달라지지 않는다 — 손으로 적은 `STALE_ROUTES`
 * 표가 불변인 것이 그 관측이다. 「지금 여섯 줄이 옳았다면 그대로 통과한다」가 그렇게 성립했다.
 *
 * 타입을 남기는 이유는 다음 자리표시다. 빈 객체는 **「자리표시가 없다」는 단언의 대상**이며
 * (`PENDING_PARTS`가 같은 형태로 비어 있다) 지우면 다음 사람이 같은 판단을 처음부터 한다.
 */
export const PENDING_ROUTES: Record<
  string,
  { plannedQuery: string; invalidatedWith: QueryName }
> = {}

/**
 * 그 변경으로 **낡는 라우트** — `affects` × `ROUTE_QUERIES`.
 *
 * 런타임 무효화는 이 목록을 쓰지 않는다(위 실측). 화면을 세울 때 「이 변경 뒤에
 * 무엇이 낡는가」를 묻는 자리와 `tests/app/invalidation.test.ts`의 합성 대조가
 * 소비하며, 어느 라우트가 캐시 가능해지는 날(`'use cache'`·정적 렌더) 그때
 * 무효화의 입력이 된다.
 */
export function staleRoutesFor(name: MutationName): string[] {
  /*
   * **넓은 타입으로 한 번 받는다.** `INVALIDATION`이 `as const`이므로
   * `INVALIDATION[name].affects`는 리터럴 튜플 열하나의 **유니온**이고, 유니온에
   * 메서드를 부르면 파라미터가 교집합으로 좁혀진다 — 원소가 서로 다른 문자열
   * 리터럴이므로 `.includes`의 인자 타입이 `never`가 되어 아래 두 줄이 컴파일되지
   * 않는다. 값은 그대로이고 표기만 넓힌다.
   */
  const affects: readonly QueryName[] = INVALIDATION[name].affects

  const fromQueries = Object.entries(ROUTE_QUERIES)
    .filter(([, queries]) => queries.some((query) => affects.includes(query)))
    .map(([route]) => route)

  const fromPending = Object.entries(PENDING_ROUTES)
    .filter(([, pending]) => affects.includes(pending.invalidatedWith))
    .map(([route]) => route)

  return [...fromQueries, ...fromPending].sort()
}
