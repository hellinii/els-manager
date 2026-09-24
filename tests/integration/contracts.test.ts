import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import {
  closeSeedConnection,
  resetFixtures,
  seedAsset,
  seedPrice,
  seedProduct,
  seedSchedule,
  seedUnderlying,
} from './helpers/seed'
import {
  AS_OF,
  YEAR,
  countRequests,
  setupScenario,
  tallyPaths,
  type Scenario,
} from './helpers/scenario'

/**
 * 계약 9개의 정상 경로 + 왕복 수 계수
 *
 * 여기서 확인하는 것은 **DOC-011 §4의 서명대로 값이 나오는가**다. 계산의 정확성은
 * 순수 모듈 테스트(TC-01~22)가, 매핑 분기는 `tests/db/map.test.ts`가 본다.
 * 이 스위트가 유일하게 증명할 수 있는 것은 PostgREST를 지나 실제로 도는가다.
 */

let s: Scenario

beforeAll(async () => {
  s = await setupScenario()
})

afterAll(async () => {
  // 성장 픽스처를 세우므로 정리한다 — 다른 통합 파일과 규율을 맞춘다.
  // 픽스처는 커밋되므로(HTTP 클라이언트가 다른 커넥션이다) 롤백이 없다.
  await resetFixtures()
  await closeSeedConnection()
})

describe('§4.2 listProducts', () => {
  it('전체 조회 — 모든 사용자의 상품이 보인다 (S-10)', async () => {
    const items = await s.asA.listProducts()
    const names = items.map((i) => i.name)

    expect(names.some((n) => n.includes('A정상'))).toBe(true)
    // 조회 정책이 using (true)이므로 B의 상품도 보인다
    expect(names.some((n) => n.includes('B하회'))).toBe(true)
  })

  it('ownerId 필터는 질의로 내려간다', async () => {
    const items = await s.asA.listProducts({ ownerId: ITG_USER_B })
    expect(items).toHaveLength(1)
    expect(items[0].name).toContain('B하회')
    expect(items[0].isOwner).toBe(false)
  })

  it('isOwner는 조회자 기준이다', async () => {
    const asA = await s.asA.listProducts({ ownerId: ITG_USER_A })
    const asB = await s.asB.listProducts({ ownerId: ITG_USER_A })

    expect(asA.every((i) => i.isOwner)).toBe(true)
    expect(asB.every((i) => !i.isOwner)).toBe(true)
  })

  it('정상 상품의 판정이 실제로 나온다', async () => {
    const items = await s.asA.listProducts({ ownerId: ITG_USER_A })
    const a = items.find((i) => i.name.includes('A정상'))!

    expect(a.status).toBe('ACTIVE')
    // 최신 시세 95 / 기준가 100 = 0.95 (2026-12-01의 500은 asOf 상한에 걸린다)
    expect(a.worstOf).toBe('0.9500')
    expect(a.nextEvaluation?.roundNo).toBe(1)
    expect(a.nextEvaluation?.date).toBe('2026-07-02')
    expect(a.nextEvaluation?.dDay).toBe(2)
    expect(a.conditionResult).toBe('EARLY')
    expect(a.kiStatus).toBe('SAFE')
    expect(a.integrityIssue).toBeNull()
    expect(a.principal).toBe('100000000')
  })

  it('status·kiStatus 필터는 조회 후 적용된다 (Q-05)', async () => {
    const redeemed = await s.asA.listProducts({ status: 'REDEEMED' })
    expect(redeemed.map((i) => i.name)).toEqual([expect.stringContaining('A상환완료')])

    const touched = await s.asA.listProducts({ kiStatus: 'TOUCHED' })
    expect(touched).toEqual([])

    const safe = await s.asA.listProducts({ kiStatus: 'SAFE' })
    expect(safe.map((i) => i.name)).toEqual([expect.stringContaining('A정상')])
  })

  it('sortBy=PRINCIPAL은 금액 내림차순 — 문자열 비교가 아니다', async () => {
    const items = await s.asA.listProducts({ sortBy: 'PRINCIPAL' })
    const amounts = items.map((i) => i.principal)

    // '20000000' > '100000000' 이 문자열 비교에서는 참이다
    expect(amounts[0]).toBe('100000000')
    expect(amounts[amounts.length - 1]).toBe('20000000')
  })

  it('sortBy=D_DAY는 상환 완료·일정 없음을 뒤로 보낸다', async () => {
    const items = await s.asA.listProducts({ sortBy: 'D_DAY' })
    const withNext = items.filter((i) => i.nextEvaluation != null)
    const withoutNext = items.filter((i) => i.nextEvaluation == null)

    const firstWithout = items.findIndex((i) => i.nextEvaluation == null)
    const lastWith = items.reduce(
      (acc, item, index) => (item.nextEvaluation != null ? index : acc),
      -1,
    )
    expect(withNext.length).toBeGreaterThan(0)
    expect(withoutNext.length).toBeGreaterThan(0)
    expect(lastWith).toBeLessThan(firstWithout)
  })
})

describe('§4.3 getProduct', () => {
  it('상세가 문서 서명대로 나온다', async () => {
    const view = (await s.asA.getProduct(FX.productA))!

    expect(view.product.totalRounds).toBe(2)
    expect(view.product.annualCouponRate).toBe('0.0800')
    expect(view.product.kiBarrier).toBe('0.5000')
    expect(view.underlyings).toHaveLength(1)
    // 자릿수는 formats.test.ts가 본다. 여기 리터럴로 두면 그 한 곳만 지켜지고
    // 나머지 시세 필드는 무방비가 된다 — 실제로 그래서 놓쳤다.
    // "80/500이 아니라 95가 뽑혔다"는 의미는 아래 두 줄이 고정한다.
    expect(view.underlyings[0].priceAsOf).toBe('2026-06-29')
    expect(view.underlyings[0].ratio).toBe('0.9500')
    expect(view.underlyings[0].isWorst).toBe(true)
    expect(view.schedules).toHaveLength(2)
    expect(view.schedules[0].expectedGross).toBe('104000000')
    expect(view.schedules[1].expectedGross).toBe('108000000')
    expect(view.projection?.appliedRoundNo).toBe(1)
    expect(view.projection?.expectedTaxableIncome).toBe('4000000')
    expect(view.projection?.attributionYear).toBe(2026)
    expect(view.redemption).toBeNull()
  })

  it('상환 완료 상품 — projection은 null, 실현손익이 나온다', async () => {
    const view = (await s.asA.getProduct(FX.productRedeemed))!

    expect(view.projection).toBeNull()
    expect(view.redemption?.redemptionType).toBe('EARLY')
    expect(view.redemption?.grossAmount).toBe('104000000')
    expect(view.redemption?.taxableIncome).toBe('4000000')
    expect(view.redemption?.withholdingTax).toBe('616000')
    expect(view.redemption?.realizedPnl).toBe('4000000')
    // 차수별 예상 수령액은 상환 완료 상품에도 정의된다
    expect(view.schedules[0].expectedGross).toBe('104000000')
  })

  it('미존재는 null이다 — 예외가 아니다 (§3.1)', async () => {
    expect(await s.asA.getProduct('00000000-0000-4000-8000-0000000009ff')).toBeNull()
  })

  it('타인의 상품도 상세를 볼 수 있다 — isOwner만 false다', async () => {
    const view = (await s.asB.getProduct(FX.productA))!
    expect(view.product.isOwner).toBe(false)
    expect(view.product.ownerName).toContain('계약 사용자 A')
  })
})

describe('§4.4 listSchedule', () => {
  it('행 단위가 차수다', async () => {
    const items = await s.asA.listSchedule()
    const forA = items.filter((i) => i.productName.includes('A정상'))
    expect(forA.map((i) => i.roundNo)).toEqual([1, 2])
  })

  it('from·to가 질의로 내려가고 판정은 온전하다', async () => {
    // 2027년만 조회한다 — 적용 차수(1차, 2026-07-02)는 범위 밖이다
    const items = await s.asA.listSchedule({ from: '2027-01-01', to: '2027-12-31' })

    expect(items.every((i) => i.evaluationDate >= '2027-01-01')).toBe(true)

    const round2 = items.find(
      (i) => i.productName.includes('A정상') && i.roundNo === 2,
    )!
    // ★ 범위 안의 차수가 적용 차수로 승격되지 않는다. 부모의 일정 전체를
    //   따로 담기 때문에 nextEvaluation이 여전히 1차를 고른다.
    expect(round2.conditionResult).toBeNull()
  })

  it('범위를 넓히면 적용 차수에 판정이 붙는다', async () => {
    const items = await s.asA.listSchedule({ from: '2026-01-01', to: '2027-12-31' })
    const a = items.filter((i) => i.productName.includes('A정상'))

    expect(a.find((i) => i.roundNo === 1)!.conditionResult).toBe('EARLY')
    expect(a.find((i) => i.roundNo === 2)!.conditionResult).toBeNull()
  })

  it('ownerId가 질의로 내려간다', async () => {
    const items = await s.asA.listSchedule({ ownerId: ITG_USER_B })
    expect(items.every((i) => i.productName.includes('B하회'))).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it('activeOnly가 상환 완료 상품의 차수를 제거한다', async () => {
    const all = await s.asA.listSchedule()
    const active = await s.asA.listSchedule({ activeOnly: true })

    expect(all.some((i) => i.productName.includes('A상환완료'))).toBe(true)
    expect(active.some((i) => i.productName.includes('A상환완료'))).toBe(false)
    expect(active.length).toBeLessThan(all.length)
  })

  it('일정 0건 상품은 행이 없다 — SCHEDULE_MISSING은 도달 불가', async () => {
    const items = await s.asA.listSchedule()
    expect(items.some((i) => i.productName.includes('A일정없음'))).toBe(false)

    // 런타임 단언을 둘 수 없다 — `ScheduleItem.integrityIssue`가
    // `'UNDERLYING_MISSING' | null`로 좁혀져 있어 tsc가 "겹치지 않는 비교"로
    // 거부한다. 그것이 §4.4가 유니온을 좁힌 목적이며, **타입이 이미 증명한다.**
    // @ts-expect-error — 좁힌 유니온에는 이 값이 없다
    expect(items.every((i) => i.integrityIssue !== 'SCHEDULE_MISSING')).toBe(true)
  })

  it('평가일 오름차순이다', async () => {
    const items = await s.asA.listSchedule()
    const dates = items.map((i) => i.evaluationDate)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('§4.5 listAssetPrices', () => {
  it('자산별 최신 시세와 참조 수', async () => {
    const rows = await s.asA.listAssetPrices()
    const byName = new Map(rows.map((r) => [r.name, r]))

    const solo = byName.get('[ITG] 단독자산')!
    expect(solo.latestPrice).toBe('95.000000')
    // D6 — 2026-12-01의 500은 asOf 상한에 걸린다
    expect(solo.asOfDate).toBe('2026-06-29')
    expect(solo.source).toBe('MANUAL')
    expect(solo.usedByActiveProducts).toBe(1)
    expect(solo.isStale).toBe(false)
  })

  it('시세 행이 없으면 null이고 isStale은 false다', async () => {
    const rows = await s.asA.listAssetPrices()
    const none = rows.find((r) => r.name === '[ITG] 시세없음')!

    expect(none.latestPrice).toBeNull()
    expect(none.asOfDate).toBeNull()
    // 경과 판단의 대상이 아니다 — E-01 표시가 앞선다
    expect(none.isStale).toBe(false)
  })

  it('5일 이상 경과하면 isStale', async () => {
    const rows = await s.asA.listAssetPrices()
    const stale = rows.find((r) => r.name === '[ITG] 경과자산')!

    expect(stale.asOfDate).toBe('2026-06-20')
    expect(stale.isStale).toBe(true)
  })

  it('상환 완료 상품은 참조 수에 세지 않는다', async () => {
    const rows = await s.asA.listAssetPrices()
    // assetPair1은 상환 완료 상품만 참조한다
    const pair1 = rows.find((r) => r.name === '[ITG] 쌍자산1')!
    expect(pair1.usedByActiveProducts).toBe(0)
  })

  it('★ providerSymbols가 매핑을 «값으로» 나른다 — 형식만이 아니라 내용', async () => {
    /*
     * `formats.test.ts`는 잎의 **형식**을 보고 이 케이스가 **값**을 본다. 둘이 필요한
     * 이유는 형식 검사가 `'TEXT'`이므로 **엉뚱한 문자열도 통과**하기 때문이다 —
     * 임베드가 다른 자산의 행을 붙여도(조인 키를 틀리면 그렇게 된다) 형식은 옳다.
     */
    const rows = await s.asA.listAssetPrices()
    const solo = rows.find((r) => r.name === '[ITG] 단독자산')!
    expect(solo.providerSymbols).toEqual([
      { provider: 'KIWOOM_ES040', symbol: '3:AAPL' },
    ])
  })

  it('★ 매핑이 없으면 빈 배열이다 — `null`이 아니다', async () => {
    /*
     * 화면이 `.length === 0`으로 「자동 수집 안 함」을 판정하므로 `null`이 오면
     * `TypeError`가 된다. 임베드가 0건일 때 postgrest가 `[]`을 준다는 것을 값으로
     * 고정한다 — 그 성질을 가정하고 화면을 짰기 때문이다.
     */
    const rows = await s.asA.listAssetPrices()
    const pair1 = rows.find((r) => r.name === '[ITG] 쌍자산1')!
    expect(pair1.providerSymbols).toEqual([])
  })
})

describe('§4.9 searchAssets', () => {
  it('이름 부분일치', async () => {
    const options = await s.asA.searchAssets('단독')
    expect(options).toHaveLength(1)
    expect(options[0].name).toBe('[ITG] 단독자산')
    expect(options[0].currency).toBe('USD')
    /*
     * ★ **`false` → `true`로 뒤집혔다 (P5a 컷 2b).** 종전 값은 옳았지만 그것이 옳은
     * 이유는 **어떤 픽스처에도 매핑이 없었기 때문**이다 — `asset_provider_symbols`가
     * 저장소 전체에서 비어 있었고, 그래서 **이 파생값의 `true` 갈래가 한 번도 실행되지
     * 않았다.** 컷 2b가 `assetSolo`에 매핑을 하나 심으면서 처음 실행된다.
     *
     * 즉 이 한 줄의 변경이 「값이 바뀌었다」가 아니라 **「없던 갈래가 생겼다」**다.
     */
    expect(options[0].hasPriceProvider).toBe(true)
    // v4.3 — 심볼 자체가 실린다(불러오기가 이것으로 잇는다). `hasPriceProvider`와 같은 행에서 나온다
    expect(options[0].providerSymbols.length).toBeGreaterThan(0)
    expect(options[0].providerSymbols[0]).toEqual({
      provider: expect.any(String),
      symbol: expect.any(String),
    })
  })

  it('★ 매핑이 없는 자산은 `hasPriceProvider`가 false다 — 반대 갈래', async () => {
    /*
     * 위 케이스만 두면 이번에는 **`false` 갈래가 미실행**이 된다(부호만 뒤집힌 같은
     * 공백이다). 둘을 나란히 두어 파생이 실제로 «가른다»는 것을 고정한다 —
     * 그래서 시나리오가 `assetSolo`에만 매핑을 심는다.
     */
    const options = await s.asA.searchAssets('쌍자산1')
    expect(options).toHaveLength(1)
    expect(options[0].hasPriceProvider).toBe(false)
    expect(options[0].providerSymbols).toEqual([])
  })

  /**
   * **빈 질의는 전량이다 (§4.9 v1.5, P4 컷 4a).** 종전 단언은 `[]`였다 —
   * SCR-204가 소비자가 되면서 그 값이 「자동완성을 영구히 비게 만드는 값」임이
   * 드러났다. §1.2가 조회를 서버 액션으로 감싸지 않으므로 타이핑마다 묻는 경로가
   * 없고, 화면은 렌더 1회에 전량을 받아 클라이언트에서 좁힌다.
   *
   * 건수를 고정하지 않는다 — 이 스위트는 다른 실행이 남긴 자산과 함께 돌고
   * (자산에는 삭제 계약이 없다) 필터 없는 전역 건수 단언은 CLAUDE.md가 경고한
   * 형태다. 대신 **부분일치 결과의 상위집합이며 그 원소를 포함한다**를 본다.
   */
  it('빈 검색어는 전량이다 — 이름 필터만 없다', async () => {
    const all = await s.asA.searchAssets('')
    const named = await s.asA.searchAssets('단독')

    expect(all.length).toBeGreaterThanOrEqual(named.length)
    expect(all.map((option) => option.id)).toContain(named[0].id)
    // 공백만 있는 질의도 같은 경로다(`trim()` 후 판정한다).
    expect((await s.asA.searchAssets('   ')).length).toBe(all.length)
    // 이름 순 정렬은 두 경로가 공유한다.
    expect([...all].map((o) => o.name)).toEqual(
      [...all].map((o) => o.name).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
    )
  })

  it('% 한 글자가 전체 목록을 반환하지 않는다', async () => {
    /*
     * 이스케이프하지 않으면 %가 와일드카드가 되어 전 자산이 나온다. **빈 질의가
     * 전량이 된 뒤에도 이 단언은 유효하다** — 두 경로는 다른 함수이고, `'%'`는
     * 비-빈 질의이므로 이름 필터를 지난다. 즉 이스케이프가 사라지면 이 결과가
     * 빈 질의의 결과와 같아진다.
     */
    const wildcard = await s.asA.searchAssets('%')
    expect(wildcard).toEqual([])
  })

  it('구분자(,)가 필터를 쪼개지 않는다', async () => {
    // postgrest-js는 필터 값을 인용하지 않는다 — 쉼표가 그대로 실리면
    // 필터 문법이 깨져 오류가 나거나 엉뚱한 결과가 온다
    const commas = await s.asA.searchAssets('단독,자산')
    expect(commas).toEqual([])
  })

  it('_ 와일드카드도 이스케이프된다', async () => {
    // '단_자산'은 LIKE에서 '단X자산'에 일치한다. 이스케이프되면 일치하지 않는다.
    expect(await s.asA.searchAssets('단_자산')).toEqual([])
  })
})

describe('§4.1 getDashboard', () => {
  it('scope=MINE은 본인 상품만 센다', async () => {
    const view = await s.asA.getDashboard({ scope: 'MINE' })

    expect(view.upcomingEvaluations.every((e) => e.ownerName.includes('A'))).toBe(true)
    // A의 미상환: A정상, A기초자산없음, A일정없음 = 3건
    expect(view.totals.activeCount).toBe(3)
    expect(view.totals.activePrincipal).toBe('150000000')
    // 상환 완료 1건: 104,000,000 − 100,000,000
    expect(view.totals.realizedPnl).toBe('4000000')
  })

  it('scope=ALL은 전체를 센다 — 세금은 합산하지 않는다 (D-02)', async () => {
    const mine = await s.asA.getDashboard({ scope: 'MINE' })
    const all = await s.asA.getDashboard({ scope: 'ALL' })

    expect(all.totals.activeCount).toBeGreaterThan(mine.totals.activeCount)
    // 절대 규칙 #7 — 사용자 간 금융소득을 합산하지 않는다
    expect(all.currentYearTax.financialIncome).toBe(
      mine.currentYearTax.financialIncome,
    )
  })

  it('기간 창이 없다 — 상품당 다음 평가일 1건, dDay 오름차순', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })
    const dDays = view.upcomingEvaluations.map((e) => e.dDay)

    // **상품당 1건**이다(그 상품의 다음 평가일). 차수 전체가 아니다 —
    // 경과 차수는 attentionItems가, 이후 차수는 listSchedule이 담당한다.
    expect(view.upcomingEvaluations).toHaveLength(3)
    expect(dDays).toEqual([2, 34, 63])

    expect([...dDays].sort((a, b) => a - b)).toEqual(dDays)
    // 창을 두면 63일 뒤 항목이 사라진다 — "곧 평가일이 오는가"의 범위가
    // 조용히 좁아지는 것을 이 단언이 막는다
    expect(dDays.some((d) => d > 60)).toBe(true)

    // 일정 0건 상품은 다음 평가일이 없으므로 목록에 없다
    expect(
      view.upcomingEvaluations.some((e) => e.productName.includes('A일정없음')),
    ).toBe(false)
  })

  it('willMeet — 판정 결과가 없으면 null이다 (false가 아니다)', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })

    const ok = view.upcomingEvaluations.find((e) => e.productName.includes('A정상'))!
    expect(ok.willMeet).toBe(true)

    const broken = view.upcomingEvaluations.find((e) =>
      e.productName.includes('A기초자산없음'),
    )!
    // false로 두면 "미충족"이라는 판정을 한 것이 되어 E-01과 구분되지 않는다
    expect(broken.willMeet).toBeNull()
    expect(broken.worstOf).toBeNull()
  })

  it('attentionItems — 상품당 사유가 여러 개다. 결함이 나머지를 가리지 않는다', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })

    // **다중맵이어야 한다.** 상품명 → 사유 하나로 접으면 마지막 값만 남아
    // 다중 사유를 잃는다 — 결함 상품에서 특히 그렇다(§4.1 v0.8).
    const reasons = new Map<string, string[]>()
    for (const item of view.attentionItems) {
      const key = item.productName.replace('[ITG] ', '')
      reasons.set(key, [...(reasons.get(key) ?? []), item.reason])
    }

    // 기초자산 0건 — 시세 파생 사유는 산출할 수 없고 1차(2026-09-01)는 미경과다.
    // PRICE_MISSING이 없는 것이 요점 — 오지 않을 시세를 기다리게 하지 않는다.
    expect(reasons.get('A기초자산없음')).toEqual(['UNDERLYING_MISSING'])

    // 일정 0건 + 기초자산은 시세 없는 자산 → 결함과 진짜 E-01이 함께 온다
    expect(reasons.get('A일정없음')).toEqual(['SCHEDULE_MISSING', 'PRICE_MISSING'])

    expect(view.attentionItems.some((i) => i.reason === 'KI_BELOW')).toBe(true)
    // 상환 완료 상품은 조치 대상이 아니다
    expect(view.attentionItems.some((i) => i.productName.includes('A상환완료'))).toBe(
      false,
    )
  })

  it('currentYearTax가 실제로 산출된다 — 2027년에 죽지 않을 경로', async () => {
    const view = await s.asA.getDashboard({ scope: 'MINE' })

    expect(view.currentYearTax.year).toBe(YEAR)
    expect(view.currentYearTax.financialIncome).not.toBe('')
    expect(typeof view.currentYearTax.isComprehensive).toBe('boolean')
  })

  it('attentionItems가 소유자를 담는다 — v2.0 `ownerName`', async () => {
    /*
     * ★ 이 목록의 사유는 저마다 조치를 지목하고 **그 조치는 소유자만 할 수 있다**
     * (ST-04 · W-01). 같은 뷰의 `upcomingEvaluations`는 v0.6부터 담고 있었으므로
     * **한 뷰 안에서 두 목록의 주어가 달랐다.**
     *
     * 두 목록이 같은 상품에 대해 같은 이름을 낸다는 것까지 본다 — 폴백 문자열이
     * 호출부마다 적혀 있으면 `users` 행이 없을 때만 갈리고, 그 상태는 평소에 보이지
     * 않는다(`ownerNameOf`를 한 함수로 둔 이유).
     */
    const view = await s.asA.getDashboard({ scope: 'ALL' })

    expect(view.attentionItems.length).toBeGreaterThan(0)
    for (const attention of view.attentionItems) {
      expect(attention.ownerName, attention.productName).not.toBe('')
      const upcoming = view.upcomingEvaluations.find(
        (e) => e.productId === attention.productId,
      )
      if (upcoming != null) expect(attention.ownerName).toBe(upcoming.ownerName)
    }

    // B의 상품이 섞여 있으므로 이름이 하나가 아니다 — 그래야 이 필드에 뜻이 있다.
    expect(new Set(view.attentionItems.map((i) => i.ownerName)).size).toBeGreaterThan(1)
  })

  it('recentRedemptions가 상환 실적을 담고 합계와 어긋나지 않는다 — v2.0', async () => {
    /*
     * ★ **⑤에 자료원이 없던 것이 컷 9의 발견이다**(DOC-008 §5는 요소 다섯을
     * 규정하는데 v1.9의 뷰는 넷만 담았다). 기간 창을 두지 않았으므로
     * `totals.realizedPnl = Σ recentRedemptions[].realizedPnl`이 **항등식**이며,
     * 창을 넣는 순간 이 단언이 깨진다 — 그것이 이 케이스의 존재 이유다.
     */
    const view = await s.asA.getDashboard({ scope: 'MINE' })

    // A의 상환 완료 1건: 104,000,000 − 100,000,000
    expect(view.recentRedemptions).toHaveLength(1)
    const row = view.recentRedemptions[0]!
    expect(row.productName).toContain('A상환완료')
    expect(row.grossAmount).toBe('104000000')
    expect(row.realizedPnl).toBe('4000000')
    expect(row.redemptionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof row.isConfirmed).toBe('boolean')

    // 항등식 — 문자열이므로 합을 만들지 않고 1건일 때의 동일성으로 본다.
    expect(view.totals.realizedPnl).toBe(row.realizedPnl)
  })

  it('recentRedemptions와 activeCount가 행을 정확히 나눈다', async () => {
    /*
     * `activeRows`는 상환 레코드가 없는 것, `redeemedRows`는 있는 것이므로 둘의 합이
     * 그 범위의 전체다. **SCR-101의 빈 상태 판정이 이 성질에 의존한다** — 화면이
     * 「상품이 아예 없다」를 둘로만 판정하며, 어느 행이 양쪽에 없거나 양쪽에 있으면
     * 상품이 있는데도 빈 상태가 렌더된다.
     *
     * > **정렬 방향은 여기서 확인할 수 없다.** 정본 시나리오의 상환이 1건이므로
     * > 오름차순과 내림차순이 **같은 배열**을 낸다 — 실측으로 확인했다(정렬을
     * > 뒤집는 음성 대조가 초록이었다). 픽스처가 두 구현에서 일치하는 부류의 무효
     * > 대조이며, 정본에 상환을 더하면 `activeCount`·`realizedPnl`·
     * > `usedByActiveProducts` 단언 여럿이 그 한 상품의 인질이 된다. 방향은
     * > **상환 둘을 통제할 수 있는 곳**에서 본다 — `tests/e2e/home.test.ts`가
     * > 전용 사용자에게 서로 다른 날짜의 상환 둘을 만들어 대조한다.
     */
    const view = await s.asA.getDashboard({ scope: 'ALL' })

    expect(view.recentRedemptions.length + view.totals.activeCount).toBe(
      (await s.asA.listProducts()).length,
    )
    // 미상환 상품이 이 목록에 섞이지 않는다(위 등식의 한쪽 방향을 값으로 고정한다)
    const redeemedIds = new Set(view.recentRedemptions.map((r) => r.productId))
    expect(redeemedIds.has(FX.productA)).toBe(false)
    expect(redeemedIds.has(FX.productRedeemed)).toBe(true)
  })
})

describe('§4.6 getTaxSummary', () => {
  it('본인 조회가 성립한다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(view.year).toBe(YEAR)
    expect(view.taxLawYear).toBe(YEAR)

    /**
     * 9,200,000 = 4,000,000 + 4,000,000 + 1,200,000
     *
     * | 상품 | 기여 | 근거 |
     * |---|---|---|
     * | A상환완료 | 4,000,000 | 증권사 확정값 (A-04) |
     * | A정상 | 4,000,000 | 1억 × (1 + 0.08 × 6/12) − 1억 |
     * | A기초자산없음 | 1,200,000 | 3천만 × (1 + 0.08 × 6/12) − 3천만 |
     *
     * **무결성 결함 상품도 기여한다.** 과세소득 추정은 계약 조건(원금·쿠폰율·
     * 평가주기·차수)에서만 나오고 시세에 의존하지 않으므로, 기초자산이 0건인
     * 것과 무관하다. 결함은 **조건 판정**을 막을 뿐 쿠폰 산출을 막지 않는다 —
     * §4.3이 `expectedGross`를 판정과 무관하게 전 차수에 정의한 것과 같은 이유다.
     * 여기서 이 상품을 빼면 세액이 실제보다 낮게 나온다.
     */
    expect(view.income.elsTaxableIncome).toBe('9200000')
    expect(view.income.total).toBe('9200000')
    expect(view.income.isComprehensive).toBe(false)
    // F ≤ 기준금액이므로 비교과세를 적용하지 않는다
    expect(view.tax.method1).toBeNull()
    expect(view.tax.method2).toBeNull()
    expect(view.healthInsurance.isEstimate).toBe(true)
  })

  it('프로필이 없으면 폴백한다 — NONE + 0, isSaved=false', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(view.profile.isSaved).toBe(false)
    expect(view.profile.healthInsuranceType).toBe('NONE')
    expect(view.profile.otherIncomeBase).toBe('0')
    expect(view.profile.otherFinancialIncome).toBe('0')
    // NONE은 건강보험료를 0으로 만든다 — 화면은 미입력으로 표시해야 한다
    expect(view.healthInsurance.total).toBe('0')
  })

  it('bracketLabel이 합성된다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(view.marginalRates.length).toBeGreaterThan(0)
    expect(view.marginalRates[0].bracketLabel).toBe('1,400만 이하')
    expect(view.marginalRates[view.marginalRates.length - 1].bracketLabel).toContain(
      '초과',
    )
    expect(view.marginalRates.every((r) => r.bracketLabel !== '')).toBe(true)
  })

  it('contributingProducts가 추정 여부를 구분한다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const byName = new Map(
      view.contributingProducts.map((p) => [p.productName.replace('[ITG] ', ''), p]),
    )

    expect(byName.get('A상환완료')!.isEstimated).toBe(false)
    expect(byName.get('A상환완료')!.taxableIncome).toBe('4000000')
    expect(byName.get('A정상')!.isEstimated).toBe(true)

    // 무결성 결함 상품도 기여한다 — 시세에 의존하지 않는 계약 조건 계산이다.
    // **금액은 v0.8에서도 바뀌지 않는다** — 이 두 줄이 "표식만 붙인다"의 회귀 고정이다.
    expect(byName.get('A기초자산없음')!.taxableIncome).toBe('1200000')
    expect(byName.get('A기초자산없음')!.isEstimated).toBe(true)

    // 일정 0건 상품은 적용 차수가 없으므로 기여하지 않는다
    expect(byName.has('A일정없음')).toBe(false)
  })

  it('contributingProducts가 결함을 드러낸다 — isEstimated와 직교한다 (v0.8)', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })
    const byName = new Map(
      view.contributingProducts.map((p) => [p.productName.replace('[ITG] ', ''), p]),
    )

    // 표식이 없으면 SCR-202에서 "수정 필요"인 같은 상품이 SCR-401에는 숫자로만
    // 나타나 사용자가 모순으로 읽는다
    expect(byName.get('A기초자산없음')!.integrityIssue).toBe('UNDERLYING_MISSING')
    expect(byName.get('A정상')!.integrityIssue).toBeNull()
    expect(byName.get('A상환완료')!.integrityIssue).toBeNull()

    // 두 축이 직교한다 — 같은 상품이 결함이면서 추정이다
    expect(byName.get('A기초자산없음')!.isEstimated).toBe(true)
  })

  it('타인 조회는 던진다 — 조용히 과소 산출하지 않는다 (D3)', async () => {
    await expect(
      s.asA.getTaxSummary({ ownerId: ITG_USER_B, year: YEAR }),
    ).rejects.toThrow(/본인 전용/)
  })

  it('시드보다 과거 연도는 거부한다 — 재현성 (ADR-005)', async () => {
    await expect(
      s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: 2025 }),
    ).rejects.toThrow(/재현성/)
  })

  it('시드보다 미래 연도는 근사하고 taxLawYear로 드러낸다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: 2030 })

    expect(view.year).toBe(2030)
    expect(view.taxLawYear).toBe(2026)
    expect(view.taxLawYear).not.toBe(view.year)
  })
})

describe('§4.8 listUserSummaries', () => {
  it('본인과 타인이 다르게 채워진다', async () => {
    const rows = await s.asA.listUserSummaries()
    const me = rows.find((r) => r.userId === ITG_USER_A)!
    const other = rows.find((r) => r.userId === ITG_USER_B)!

    expect(me.isMe).toBe(true)
    expect(me.includesOtherFinancialIncome).toBe(true)
    expect(typeof me.isComprehensive).toBe('boolean')

    expect(other.isMe).toBe(false)
    // 타인의 other_financial_income을 읽을 수 없으므로 판정하지 않는다
    expect(other.includesOtherFinancialIncome).toBe(false)
    expect(other.isComprehensive).toBeNull()
  })

  it('활성 건수·원금이 사용자별로 분리된다', async () => {
    const rows = await s.asA.listUserSummaries()
    const me = rows.find((r) => r.userId === ITG_USER_A)!
    const other = rows.find((r) => r.userId === ITG_USER_B)!

    expect(me.activeCount).toBe(3)
    expect(me.activePrincipal).toBe('150000000')
    expect(other.activeCount).toBe(1)
    expect(other.activePrincipal).toBe('50000000')
  })

  it('합계 행이 없다 — 종합과세는 개인 단위다', async () => {
    const rows = await s.asA.listUserSummaries()
    expect(rows.every((r) => r.userId !== '')).toBe(true)
    expect(rows.some((r) => r.displayName.includes('합계'))).toBe(false)
  })
})

describe('왕복 수 계수 — 실측', () => {
  /**
   * 부수효과 없는 측정. **전역 배열에 기록하지 않는다** — 기록하면 `beforeAll`의
   * baseline 측정이 그 배열에 먼저 쌓여 뒤 테스트의 길이 단언이 어긋난다.
   */
  async function tables(run: () => Promise<unknown>): Promise<Record<string, number>> {
    const counter = countRequests()
    try {
      await run()
      return tallyPaths(counter.paths())
    } finally {
      counter.restore()
    }
  }

  const GROWTH_PROBES: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ['listProducts', () => s.asA.listProducts()],
    ['listAssetPrices', () => s.asA.listAssetPrices()],
    ['getDashboard', () => s.asA.getDashboard({ scope: 'ALL' })],
  ]

  const baseline = new Map<string, Record<string, number>>()

  beforeAll(async () => {
    /**
     * 중첩 describe의 `beforeAll`은 **그 describe가 시작될 때** 실행되므로 위
     * §4.2~§4.8의 모든 `it`은 성장 전 데이터를 본다. 그 순서를 가정으로만 두지
     * 않고 여기서 못 박는다 — 파일 순서가 바뀌면 이 줄이 먼저 죽는다.
     */
    expect(await s.asA.listProducts()).toHaveLength(5)

    for (const [name, run] of GROWTH_PROBES) baseline.set(name, await tables(run))

    // 자산 5→7, 상품 5→6, 기초자산 6→8. 왕복이 데이터 크기에 비례하면 갈린다.
    await seedAsset({ id: FX.assetGrowth1, name: '성장자산1' })
    await seedAsset({ id: FX.assetGrowth2, name: '성장자산2' })
    await seedPrice({
      assetId: FX.assetGrowth1,
      asOfDate: '2026-06-29',
      price: '120.000000',
    })
    await seedPrice({
      assetId: FX.assetGrowth2,
      asOfDate: '2026-06-29',
      price: '60.000000',
    })
    await seedProduct({
      id: FX.productGrowth,
      ownerId: ITG_USER_A,
      name: '성장상품',
      principal: '70000000',
      kiBarrier: '0.5000',
      kiObservation: 'CLOSING',
    })
    await seedUnderlying({
      elsId: FX.productGrowth,
      assetId: FX.assetGrowth1,
      basePrice: '100.000000',
      sequence: 1,
    })
    await seedUnderlying({
      elsId: FX.productGrowth,
      assetId: FX.assetGrowth2,
      basePrice: '100.000000',
      sequence: 2,
    })
    await seedSchedule({
      elsId: FX.productGrowth,
      roundNo: 1,
      evaluationDate: '2026-10-05',
      barrier: '0.9000',
    })
  })

  /**
   * **계약별 REST 테이블 다중집합이 정본이다** (DOC-011 §4.0의 "구성" 열).
   *
   * 총합만 세면 "상품 2회"와 "상품 1회 + 시세 1회"가 구분되지 않는다. 배열
   * 순서가 아니라 다중집합으로 비교하므로 `Promise.all`의 순서를 무해하게 바꿔도
   * 깨지지 않고, 테이블이 하나 늘거나 같은 테이블을 두 번 치면 반드시 깨진다.
   */
  it('계약별 REST 테이블 다중집합 — N+1은 여기서 드러난다', async () => {
    const budget = {
      listProducts: await tables(() => s.asA.listProducts()),
      getProduct: await tables(() => s.asA.getProduct(FX.productA)),
      // 기초자산 0건이면 시세 로더가 아예 나가지 않는다 — 빈 in() 질의를 만들지 않는다
      getProductNoUnderlying: await tables(() =>
        s.asA.getProduct(FX.productNoUnderlying),
      ),
      listSchedule: await tables(() => s.asA.listSchedule()),
      // asset_provider_symbols는 임베드라 왕복이 아니다
      searchAssets: await tables(() => s.asA.searchAssets('단독')),
      listAssetPrices: await tables(() => s.asA.listAssetPrices()),
      // tax_brackets·tax_constants는 tax_years 임베드다 (D7)
      getTaxSummary: await tables(() =>
        s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
      ),
      listUserSummaries: await tables(() => s.asA.listUserSummaries()),
      // tax_profiles를 `.lte()` 한 번으로 받는다 — 연도 수에 비례하지 않는 것이 요점이다
      getForecast: await tables(() => s.asA.getForecast({ ownerId: ITG_USER_A })),
      getDashboard: await tables(() => s.asA.getDashboard({ scope: 'ALL' })),
    }

    expect(budget.listProducts).toEqual({ els_products: 1, assets: 1 })
    expect(budget.getProduct).toEqual({ els_products: 1, assets: 1 })
    expect(budget.getProductNoUnderlying).toEqual({ els_products: 1 })
    // v3.3에서 `tax_years`가 늘었다 — `expectedNet`이 `separate_taxation_rate`를
    // 요구하고 절대 규칙 #5가 그 값을 코드에 두는 것을 막는다. 다중집합으로 세는
    // 이유가 여기서 값을 한다: 총합만 세면 「차수 2회」와 「차수 1회 + 세율 1회」가
    // 구분되지 않는다.
    expect(budget.listSchedule).toEqual({
      redemption_schedules: 1,
      assets: 1,
      tax_years: 1,
    })
    expect(budget.searchAssets).toEqual({ assets: 1 })
    expect(budget.listAssetPrices).toEqual({ assets: 1, els_products: 1 })
    expect(budget.getTaxSummary).toEqual({
      tax_years: 1,
      tax_profiles: 1,
      els_products: 1,
    })

    /**
     * ★ `tax_profiles: 1` — **사용자 수와 무관하게 1이다.**
     *
     * §4.8은 타인의 프로필을 읽지 않는다(D3). 사용자별로 물으면 총 왕복이 사용자
     * 수에 비례하는데, 사용자 2명 픽스처에서는 총합이 4 → 5로만 늘어 "예산이 하나
     * 틀렸다"로 보인다. **본인 것만 읽는다는 전제가 깨졌다는 사실**은 이 항목만이 말한다.
     */
    expect(budget.listUserSummaries).toEqual({
      users: 1,
      els_products: 1,
      tax_years: 1,
      tax_profiles: 1,
    })

    /**
     * ★ **`getTaxSummary`와 같은 다중집합이다 — 연도가 여섯인데.**
     *
     * 세 테이블 각각 1이라는 것이 §4.7의 「연도 수에 비례하지 않는다」의 형태다.
     * `tax_years: 1`은 `loadAllTaxYears`가 시드 전체를 한 번에 가져와 순수한
     * `resolveTaxYear`를 연도마다 재사용하기 때문이고, `tax_profiles: 1`은 이월을
     * `.in(연도들)`이 아니라 `.lte(마지막 연도)` 하나로 받기 때문이다.
     *
     * **연도마다 왕복하는 구현이 이 단언을 깨뜨린다** — 그 구현도 값은 옳으므로
     * 다른 어느 케이스에도 걸리지 않는다. 왕복 표가 정본인 이유가 그것이다.
     */
    expect(budget.getForecast).toEqual({
      tax_years: 1,
      tax_profiles: 1,
      els_products: 1,
    })

    expect(budget.getDashboard).toEqual({
      els_products: 1,
      assets: 1,
      tax_years: 1,
      tax_profiles: 1,
    })

    // 계약 9개를 하나도 빠뜨리지 않았다 (getProduct는 두 경우를 잰다 → 10)
    expect(Object.keys(budget)).toHaveLength(10)
  })

  it('DOC-011 §4.0의 왕복 수와 일치한다', async () => {
    const total = (m: Record<string, number>): number =>
      Object.values(m).reduce((a, b) => a + b, 0)

    expect(total(await tables(() => s.asA.listProducts()))).toBe(2)
    expect(total(await tables(() => s.asA.getProduct(FX.productA)))).toBe(2)
    expect(total(await tables(() => s.asA.listSchedule()))).toBe(3)
    expect(total(await tables(() => s.asA.searchAssets('단독')))).toBe(1)
    expect(total(await tables(() => s.asA.listAssetPrices()))).toBe(2)
    expect(
      total(
        await tables(() => s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })),
      ),
    ).toBe(3)
    expect(total(await tables(() => s.asA.listUserSummaries()))).toBe(4)
    /*
     * ★ **연도 수에 비례하지 않는 것이 §4.7의 주장이다.** 기본 6년인데 왕복이 3이므로
     * 연도마다 세율을 읽지 않는다는 뜻이다 — `loadAllTaxYears`가 시드된 연도를 한 번에
     * 가져오고 순수한 `resolveTaxYear`를 연도마다 재사용한다. `years`를 늘려도 이 수가
     * 그대로임을 아래에서 함께 단언한다.
     */
    expect(
      total(await tables(() => s.asA.getForecast({ ownerId: ITG_USER_A }))),
    ).toBe(3)
    expect(
      total(await tables(() => s.asA.getForecast({ ownerId: ITG_USER_A, years: 20 }))),
    ).toBe(3)
    expect(total(await tables(() => s.asA.getDashboard({ scope: 'ALL' })))).toBe(4)
  })

  /**
   * **데이터를 실제로 늘려서 잰다.**
   *
   * 종전 테스트는 같은 계약을 같은 데이터로 두 번 부르고 결과가 같은지 보았다 —
   * 항진명제였다. 진짜 N+1 구현(`for (asset of assets) await count(asset)`)을
   * 넣어도 두 호출의 왕복 수는 서로 같으므로 그 단언은 통과한다.
   */
  it('데이터가 늘어도 왕복 구성이 변하지 않는다 — N+1 부재', async () => {
    // 성장 픽스처가 실제로 반영됐는지 먼저 확인한다 — 늘지 않았으면 이 테스트는
    // 다시 항진명제가 된다
    expect(await s.asA.listProducts()).toHaveLength(6)

    for (const [name, run] of GROWTH_PROBES) {
      // 키에 계약명을 실어 실패 메시지가 어느 계약인지 말하게 한다
      expect({ [name]: await tables(run) }).toEqual({ [name]: baseline.get(name) })
    }
  })
})

describe('기준일 규약 — Q-02', () => {
  it('컨텍스트 조립 시 형식을 검증한다', async () => {
    const { createQueries } = await import('@/lib/db/queries/context')
    const { clientFor } = await import('./helpers/auth')
    const db = await clientFor(ITG_USER_A)

    expect(() =>
      createQueries({ db, asOf: '2026/06/30', viewerId: ITG_USER_A }),
    ).toThrow(/YYYY-MM-DD/)
  })

  it('viewerId가 비면 조립 자체가 실패한다 — Q-04', async () => {
    const { createQueries } = await import('@/lib/db/queries/context')
    const { clientFor } = await import('./helpers/auth')
    const db = await clientFor(ITG_USER_A)

    expect(() => createQueries({ db, asOf: AS_OF, viewerId: '' })).toThrow(/Q-04/)
  })
})
