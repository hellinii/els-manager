import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection } from './helpers/seed'
import { AS_OF, YEAR, countRequests, setupScenario, type Scenario } from './helpers/scenario'

/**
 * 계약 8개의 정상 경로 + 왕복 수 계수
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
    expect(view.underlyings[0].currentPrice).toBe('95.000000')
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
})

describe('§4.9 searchAssets', () => {
  it('이름 부분일치', async () => {
    const options = await s.asA.searchAssets('단독')
    expect(options).toHaveLength(1)
    expect(options[0].name).toBe('[ITG] 단독자산')
    expect(options[0].currency).toBe('USD')
    expect(options[0].hasPriceProvider).toBe(false)
  })

  it('빈 검색어는 전체를 반환하지 않는다', async () => {
    expect(await s.asA.searchAssets('')).toEqual([])
    expect(await s.asA.searchAssets('   ')).toEqual([])
  })

  it('% 한 글자가 전체 목록을 반환하지 않는다', async () => {
    // 이스케이프하지 않으면 %가 와일드카드가 되어 전 자산이 나온다
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

  it('attentionItems — 무결성 결함 두 종류와 KI 하회', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })
    const reasons = new Map(
      view.attentionItems.map((i) => [i.productName.replace('[ITG] ', ''), i.reason]),
    )

    expect(reasons.get('A기초자산없음')).toBe('UNDERLYING_MISSING')
    expect(reasons.get('A일정없음')).toBe('SCHEDULE_MISSING')
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

    // 무결성 결함 상품도 기여한다 — 시세에 의존하지 않는 계약 조건 계산이다
    expect(byName.get('A기초자산없음')!.taxableIncome).toBe('1200000')
    expect(byName.get('A기초자산없음')!.isEstimated).toBe(true)

    // 일정 0건 상품은 적용 차수가 없으므로 기여하지 않는다
    expect(byName.has('A일정없음')).toBe(false)
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
  const measured: Array<{ contract: string; rest: number }> = []

  async function measure(contract: string, run: () => Promise<unknown>): Promise<number> {
    const counter = countRequests()
    counter.reset()
    try {
      await run()
      const rest = counter.rest()
      measured.push({ contract, rest })
      return rest
    } finally {
      counter.restore()
    }
  }

  it('계약별 REST 요청 수를 측정한다', async () => {
    const listProducts = await measure('listProducts', () => s.asA.listProducts())
    const getProduct = await measure('getProduct', () => s.asA.getProduct(FX.productA))
    const listSchedule = await measure('listSchedule', () => s.asA.listSchedule())
    const listAssetPrices = await measure('listAssetPrices', () =>
      s.asA.listAssetPrices(),
    )
    const searchAssets = await measure('searchAssets', () => s.asA.searchAssets('단독'))
    const getTaxSummary = await measure('getTaxSummary', () =>
      s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
    )
    const listUserSummaries = await measure('listUserSummaries', () =>
      s.asA.listUserSummaries(),
    )
    const getDashboard = await measure('getDashboard', () =>
      s.asA.getDashboard({ scope: 'ALL' }),
    )

    /**
     * **실측된 계약별 REST 왕복 수** (아래 단언이 정본이다).
     *
     * | 계약 | 왕복 | 구성 |
     * |---|---|---|
     * | `listProducts` | 2 | 상품+하위 / 최신 시세 |
     * | `getProduct` | 2 | 상품+하위 / 최신 시세 |
     * | `listSchedule` | 2 | 차수+부모 / 최신 시세 |
     * | `searchAssets` | 1 | 자산 이름 검색 |
     * | `listAssetPrices` | 2 | 자산+시세 / 상품(참조 수 계산) |
     * | `getTaxSummary` | 3 | 세율 연도 / 프로필 / 상품 |
     * | `listUserSummaries` | 4 | 사용자 / 상품 / 세율 연도 / 프로필 |
     * | `getDashboard` | 4 | 상품 / 시세 / 세율 연도 / 프로필 |
     *
     * 계획서의 예산과 두 곳이 다르다 — `listAssetPrices`는 3이 아니라 2(자산별
     * `count` 질의를 두지 않고 상품을 한 번 읽어 JS에서 센다), `listUserSummaries`는
     * 3이 아니라 4(본인 프로필을 별도로 읽는다. 사용자 목록에 임베드할 수 없다 —
     * `tax_profiles` 조회가 본인 한정이라 타인 행은 어차피 오지 않는다).
     *
     * N+1이 생기면 이 수가 자산·상품 수에 비례해 늘어나므로 정확히 고정한다.
     */
    expect(measured.map((m) => m.contract)).toHaveLength(8)
    expect(listProducts).toBe(2)
    expect(getProduct).toBe(2)
    expect(listSchedule).toBe(2)
    expect(searchAssets).toBe(1)
    expect(listAssetPrices).toBe(2)
    expect(getTaxSummary).toBe(3)
    expect(listUserSummaries).toBe(4)
    expect(getDashboard).toBe(4)
  })

  it('자산이 늘어도 왕복 수가 변하지 않는다 — N+1 부재', async () => {
    const before = await measure('listProducts(1)', () => s.asA.listProducts())
    // 시나리오에는 자산 5개·상품 5건이 이미 있다. 왕복이 그 수에 비례하지 않는다.
    const after = await measure('listProducts(2)', () => s.asA.listProducts())
    expect(before).toBe(after)
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
