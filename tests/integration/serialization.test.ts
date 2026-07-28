import { beforeAll, describe, expect, it } from 'vitest'

import { AS_OF, YEAR, setupScenario, type Scenario } from './helpers/scenario'
import { FX, ITG_USER_A } from './helpers/fixtures'

/**
 * 뷰가 서버 컴포넌트 경계를 넘는가 — AQ-23 ②
 *
 * ## 무엇이 공백이었는가
 *
 * AQ-23이 두 경계를 등재했다. ①은 `server.ts`의 분기(컷 0c에서
 * `tests/db/context-branches.test.ts`가 닫았다). **②는 "뷰가 서버 컴포넌트
 * 경계를 넘어 직렬화되는지 확인할 소비자가 없다"** 였다.
 *
 * Next는 서버 컴포넌트가 클라이언트 컴포넌트에 넘기는 props를 직렬화한다.
 * 직렬화할 수 없는 값(함수·클래스 인스턴스·`Symbol`·`undefined` 키)이 뷰에
 * 섞여 있으면 **런타임에 터지며, 그것도 그 props를 실제로 넘기는 화면이
 * 생겨야 드러난다.** 화면을 아홉 개 만든 뒤 발견하면 아홉 개를 고친다.
 *
 * `tests/db/brand.test.ts`가 `Active<T>` 브랜드를 **타입 수준**에서 보지만,
 * 런타임 값에 무엇이 들어 있는지는 보지 않는다. 여기가 그것이다.
 *
 * ## 왜 화면 없이 지금 볼 수 있는가
 *
 * 직렬화 가능성은 값의 성질이지 화면의 성질이 아니다. `structuredClone`과
 * JSON 왕복이 Next의 직렬화보다 **엄격하거나 같으므로**, 여기서 통과하면
 * 화면이 붙을 때 이 축으로는 터지지 않는다. 화면을 기다릴 이유가 없다.
 */

let s: Scenario

beforeAll(async () => {
  s = await setupScenario()
})

/** 계약 8개의 실제 반환값. §4.7 `getForecast`는 아직 없다(P4b). */
async function allViews(): Promise<Record<string, unknown>> {
  return {
    getDashboard: await s.asA.getDashboard({ scope: 'ALL' }),
    listProducts: await s.asA.listProducts(),
    getProduct: await s.asA.getProduct(FX.productA),
    listSchedule: await s.asA.listSchedule(),
    listAssetPrices: await s.asA.listAssetPrices(),
    getTaxSummary: await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
    listUserSummaries: await s.asA.listUserSummaries(),
    searchAssets: await s.asA.searchAssets('자산'),
  }
}

describe('뷰는 서버 → 클라이언트 경계를 넘을 수 있다', () => {
  it('계약 8개 전부가 structuredClone을 통과한다', async () => {
    const views = await allViews()
    expect(Object.keys(views)).toHaveLength(8)

    for (const [contract, view] of Object.entries(views)) {
      // structuredClone은 함수·클래스 프로토타입·Symbol에서 던진다.
      // Next의 RSC 직렬화가 거부하는 것과 같은 부류다.
      expect(() => structuredClone(view), `${contract}의 뷰가 복제되지 않는다`).not.toThrow()
    }
  })

  it('JSON 왕복이 값을 바꾸지 않는다 — 금액이 문자열로 남는다', async () => {
    const views = await allViews()

    for (const [contract, view] of Object.entries(views)) {
      /*
       * 왕복해도 **같아야** 한다. 달라진다면 `Date`·`undefined`·`Map` 같은
       * 것이 섞였다는 뜻이고, 그중 `Date`는 클라이언트에서 문자열이 되어
       * `.toISOString()`이 터진다.
       *
       * 동시에 이것이 Q-08의 확인이기도 하다 — 금액이 `number`였다면
       * `JSON.parse`가 float64를 만들지만 값은 같아 보인다. 그 축은
       * `tests/integration/formats.test.ts`가 전담하므로 여기서는 형태만 본다.
       */
      expect(JSON.parse(JSON.stringify(view)), `${contract}의 뷰가 왕복에서 달라진다`).toEqual(view)
    }
  })

  it('뷰 어디에도 함수·Symbol·undefined 값이 없다', async () => {
    const views = await allViews()

    const offenders: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'function' || typeof node === 'symbol') {
        offenders.push(`${path}: ${typeof node}`)
        return
      }
      if (node === undefined) {
        // `undefined`는 JSON에서 키째로 사라진다. 화면은 그 필드가 없는 것과
        // 구분하지 못하고, 계약이 `null`을 쓰기로 한 규약(§3.1)과도 어긋난다.
        offenders.push(`${path}: undefined`)
        return
      }
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`))
        return
      }
      if (Object.getPrototypeOf(node) !== Object.prototype) {
        offenders.push(`${path}: ${node.constructor?.name ?? '알 수 없는 프로토타입'}`)
        return
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }

    for (const [contract, view] of Object.entries(views)) walk(view, contract)

    expect(offenders).toEqual([])
  })

  it('Active<T> 브랜드가 런타임 값에 남아 있지 않다', async () => {
    /*
     * 브랜드는 `unique symbol` 키다. 타입 수준 부재는 `tests/db/brand.test.ts`가
     * 보지만, `asActive`가 값을 복사하며 심볼을 실제로 붙였다면 런타임에만
     * 남는다 — 그리고 심볼 키는 위의 `Object.entries` 순회에 **잡히지 않는다.**
     * 그래서 따로 본다.
     */
    const views = await allViews()

    const withSymbols: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return
      if (Object.getOwnPropertySymbols(node).length > 0) withSymbols.push(path)
      if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`))
      else for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }

    for (const [contract, view] of Object.entries(views)) walk(view, contract)

    expect(withSymbols).toEqual([])
  })

  it('기준일 고정이 유지된다 — 시나리오 전제', () => {
    // 위 단언들이 날짜에 의존하지 않지만, 시나리오가 흔들리면 뷰의 형태도
    // 흔들릴 수 있으므로 전제를 명시한다.
    expect(AS_OF).toBe('2026-06-30')
  })
})
