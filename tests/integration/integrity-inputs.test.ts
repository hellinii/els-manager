import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FX, ITG_USER_A } from './helpers/fixtures'
import {
  closeSeedConnection,
  resetFixtures,
  seedProduct,
  seedUnderlying,
} from './helpers/seed'
import { YEAR, setupScenario, type Scenario } from './helpers/scenario'

/**
 * 입력 기준 — 결함이 파괴한 입력만 죽는다 (DOC-011 §4.2, v0.8)
 *
 * `tests/db/map.test.ts`가 같은 규칙을 DB 없이 촘촘히 깔고, 이 파일은 그것이
 * **PostgREST를 지나서도, 그리고 계약을 가로질러서도** 성립하는지만 본다.
 *
 * ## 왜 자기 픽스처를 세우는가
 *
 * 정본 시나리오에는 **`SCHEDULE_MISSING` + 시세 있음이 없다.** `productNoSchedule`
 * (…305)은 시세 없는 자산을 참조하므로 "일정 0건"과 "시세 없음"이 뒤엉켜 있고,
 * 그 상태로는 어느 원인이 값을 죽였는지 갈리지 않는다.
 *
 * 정본에 추가하지 않는 이유는 건수 단언 때문이다 — `activeCount`·`activePrincipal`·
 * `usedByActiveProducts`·`upcomingEvaluations` 길이가 `contracts.test.ts`와
 * `user-summaries.test.ts`에 걸쳐 8곳 있고, 전부 이 한 상품의 인질이 된다.
 * 정본 시나리오의 선언된 목적("각 상품이 판정 상태 하나를 대표한다")도 흐려진다.
 *
 * "계약 8개가 같은 데이터를 본다"의 진짜 목적은 **계약 간 불일치 노출**인데,
 * 이 파일이 같은 증강 데이터에 다섯 계약을 한 번에 걸어 그것을 그대로 수행한다.
 */

let s: Scenario

beforeAll(async () => {
  s = await setupScenario()

  // 일정 0건. 기초자산은 **시세가 있는** 자산 둘을 쓴다.
  //   assetSolo  95/100 = 0.9500
  //   assetPair2 45/100 = 0.4500  → W = 0.4500, KI 배리어 0.5 하회
  await seedProduct({
    id: FX.productNoScheduleWithPrice,
    ownerId: ITG_USER_A,
    name: '일정없음시세있음',
    principal: '40000000',
    kiBarrier: '0.5000',
    kiObservation: 'CLOSING',
  })
  await seedUnderlying({
    elsId: FX.productNoScheduleWithPrice,
    assetId: FX.assetSolo,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedUnderlying({
    elsId: FX.productNoScheduleWithPrice,
    assetId: FX.assetPair2,
    basePrice: '100.000000',
    sequence: 2,
  })
  // 일정은 세우지 않는다 — 그것이 이 픽스처의 요점이다
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('SCHEDULE_MISSING + 시세 있음 — 차수가 파괴한 것만 사라진다', () => {
  it('§4.2 worstOf·kiStatus가 산출된다', async () => {
    const item = (await s.asA.listProducts()).find(
      (i) => i.id === FX.productNoScheduleWithPrice,
    )!

    expect(item.integrityIssue).toBe('SCHEDULE_MISSING')
    // ★ 종전에는 둘 다 null이었다 — 결함이 무관한 입력까지 죽였다
    expect(item.worstOf).toBe('0.4500')
    expect(item.kiStatus).toBe('BELOW')

    // 차수가 없어 사라지는 것들 — 억제가 아니라 자연 결과다
    expect(item.nextEvaluation).toBeNull()
    expect(item.conditionResult).toBeNull()
  })

  it('§4.3 ratio·isWorst가 산출되고 두 기초자산이 구분된다', async () => {
    const view = (await s.asA.getProduct(FX.productNoScheduleWithPrice))!

    expect(view.underlyings.map((u) => u.ratio)).toEqual(['0.9500', '0.4500'])
    // ★ 종전에는 ratio는 나오는데 isWorst만 전부 false였다 — 내부 모순이었다
    expect(view.underlyings.map((u) => u.isWorst)).toEqual([false, true])

    expect(view.product.totalRounds).toBe(0)
    expect(view.schedules).toEqual([])
    expect(view.projection).toBeNull() // 적용 차수가 없다 — 불변
  })

  it('§4.4 행이 없다 — 좁힌 유니온은 그대로다', async () => {
    const items = await s.asA.listSchedule()
    expect(
      items.some((i) => i.productId === FX.productNoScheduleWithPrice),
    ).toBe(false)
  })

  it('§4.6 기여하지 않는다 — 결함이라서가 아니라 적용 차수가 없어서다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    expect(
      view.contributingProducts.some(
        (p) => p.productId === FX.productNoScheduleWithPrice,
      ),
    ).toBe(false)
  })

  it('§4.1 결함과 KI 하회를 함께 올린다 — 이 목록이 유일한 창구다', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })
    const mine = view.attentionItems.filter(
      (i) => i.productId === FX.productNoScheduleWithPrice,
    )

    // 위 두 테스트가 보였듯 이 상품은 §4.4에 행이 없고 upcomingEvaluations에도
    // 없다. 결함으로 KI 하회를 가리면 사용자 확인이 필요한 그 상태가 시스템
    // 어디에서도 보이지 않는다(D-04).
    expect(mine.map((i) => i.reason)).toEqual(['SCHEDULE_MISSING', 'KI_BELOW'])
  })

  it('§4.2와 §4.3의 판정이 일치한다 — 계약 간 불일치가 없다', async () => {
    const item = (await s.asA.listProducts()).find(
      (i) => i.id === FX.productNoScheduleWithPrice,
    )!
    const view = (await s.asA.getProduct(FX.productNoScheduleWithPrice))!

    expect(item.worstOf).toBe(view.underlyings.find((u) => u.isWorst)!.ratio)
    expect(item.integrityIssue).toBe(view.product.integrityIssue)
  })
})

describe('UNDERLYING_MISSING — 시세가 파괴한 것만 사라진다', () => {
  it('§4.3 projection이 산출된다 — 계약 조건만 쓰는 값이다', async () => {
    const view = (await s.asA.getProduct(FX.productNoUnderlying))!

    expect(view.product.integrityIssue).toBe('UNDERLYING_MISSING')
    expect(view.underlyings).toEqual([])

    // ★ 종전에는 null이었다. 3천만 × (1 + 0.08 × 6/12) = 31,200,000
    expect(view.projection).not.toBeNull()
    expect(view.projection!.appliedRoundNo).toBe(1)
    expect(view.projection!.expectedGross).toBe('31200000')
    expect(view.projection!.expectedTaxableIncome).toBe('1200000')
    expect(view.projection!.attributionYear).toBe(2026)

    // 시세가 파괴한 것은 그대로 죽는다
    expect(view.schedules[0].conditionResult).toBeNull()
  })

  it('§4.3 projection과 §4.6 기여가 같은 값이다 — 두 계약이 갈리지 않는다', async () => {
    const view = (await s.asA.getProduct(FX.productNoUnderlying))!
    const summary = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const row = summary.contributingProducts.find(
      (p) => p.productId === FX.productNoUnderlying,
    )!

    // ★ 이 한 줄이 입력 기준의 존재 이유다. 종전에는 §4.6이 1,200,000을 세고
    //   §4.3은 null을 주어, 같은 상품의 같은 계산이 두 화면에서 갈렸다.
    expect(row.taxableIncome).toBe(view.projection!.expectedTaxableIncome)
  })

  it('§4.6 표식과 함께 포함된다 — 금액은 불변이다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const row = view.contributingProducts.find(
      (p) => p.productId === FX.productNoUnderlying,
    )!

    expect(row.taxableIncome).toBe('1200000') // 불변
    expect(row.isEstimated).toBe(true)
    expect(row.integrityIssue).toBe('UNDERLYING_MISSING') // v0.8 신설
    expect(view.income.elsTaxableIncome).toBe('9200000') // 합계도 불변
  })

  it('§4.1 PRICE_MISSING을 내지 않는다 — 오지 않을 시세를 기다리게 하지 않는다', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })
    const mine = view.attentionItems.filter(
      (i) => i.productId === FX.productNoUnderlying,
    )

    expect(mine.map((i) => i.reason)).toEqual(['UNDERLYING_MISSING'])
  })
})
