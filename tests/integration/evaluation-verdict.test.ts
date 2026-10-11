import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DashboardView } from '@/lib/db/queries/dashboard'
import { loadEvaluationCloses } from '@/lib/db/queries/load'
import type { ProductDetailView } from '@/lib/db/queries/map'

import { FX, ITG_USER_A } from './helpers/fixtures'
import { collect, type Coverage, type Spec } from './helpers/formats'
import {
  closeSeedConnection,
  resetFixtures,
  seedAsset,
  seedPrice,
  seedProduct,
  seedSchedule,
  seedUnderlying,
} from './helpers/seed'
import { AS_OF, contractsFor, countRequests, setupScenario, tallyPaths, type Scenario } from './helpers/scenario'

/**
 * 평가일 판정 — 평가일 종가 로더 ↔ PostgREST · §4.3 `evaluationVerdict` (P6 컷 7 · DOC-007 §3.6 · DOC-011 §4.0 · §4.3)
 *
 * ## `formats.test.ts`와 왜 다른 파일인가
 *
 * 판정을 관측하려면 등록일을 **소급**한 상품과 평가일 종가가 필요하다(정본 시나리오의 상품은 `created_at = now()`라
 * `AS_OF`보다 뒤 — 모든 경과 차수가 「등록 전」이다, D3). 그 상품을 정본에 세우면 그 파일의 값 단언이 인질이 된다
 * (`coupon-views.test.ts`와 같은 이유). 그래서 같은 계기(`collect`)로 **`evaluationVerdict` 경로만** 판정한다 — 정본
 * 파일의 표에는 최상위 `evaluationVerdict: NULL_OBJECT` 하나만 있다.
 *
 * 기준일 `AS_OF` = 2026-06-30. 판정자산 둘의 기준가는 100.
 *
 * | 상품 | 등록일 | 차수 | 평가일 종가 | 판정 |
 * |---|---|---|---|---|
 * | 충족 | 소급 | 1차 06-01(B 0.90) · 2차 12-01 | 자산1 95 · 자산2 100 | EARLY · W 0.9500 |
 * | 결측 | 소급 | 1차 05-04 · 2차 12-01 | 자산1 92 · 자산2 없음 | CLOSE_MISSING(자산2) |
 * | 이월 | 소급 | 1차 06-02 · 2차 12-01 | 자산1 80 | null |
 * | 만기 | now() | 1차 03-02 · 2차 06-01(마지막) | — | MATURITY_REACHED(2차) |
 * | 등록 전 | now() | 1차 06-01 · 2차 12-01 | 자산1 95 | null |
 */

const BACKDATED = '2026-01-01T15:00:00+00:00' // KST 2026-01-02 = 발행일

const VERDICT_TABLE: Record<string, Spec> = {
  evaluationVerdict: 'NULL_OBJECT',
  'evaluationVerdict.kind': ['EARLY', 'LIZARD', 'MATURITY_REACHED', 'CLOSE_MISSING'],
  'evaluationVerdict.roundNo': 'NUMBER',
  'evaluationVerdict.evaluationDate': 'DATE',
  'evaluationVerdict.dDay': 'NUMBER',
  'evaluationVerdict.worstOf': 'RATIO',
  'evaluationVerdict.barrier': 'RATIO',
  'evaluationVerdict.missingAssets': 'NULL_OBJECT',
  'evaluationVerdict.missingAssets[].assetId': 'UUID',
  'evaluationVerdict.missingAssets[].assetName': 'TEXT',
  'evaluationVerdict.weekendEvaluation': 'BOOL',
}
const isVerdictPath = (entry: string) => entry.startsWith('evaluationVerdict')

/** §4.1 `redemptionChecks` (P6 컷 7-4) — 원소 = 상품 넷 + `EvaluationVerdictView`. 분류는 위 표와 같아야 한다(같은 매퍼다) */
const CHECK_TABLE: Record<string, Spec> = {
  'redemptionChecks[].productId': 'UUID',
  'redemptionChecks[].productName': 'TEXT',
  'redemptionChecks[].ownerName': 'TEXT',
  'redemptionChecks[].isOwner': 'BOOL',
  ...Object.fromEntries(
    Object.entries(VERDICT_TABLE)
      .filter(([path]) => path !== 'evaluationVerdict')
      .map(([path, spec]) => [path.replace(/^evaluationVerdict\./, 'redemptionChecks[].'), spec]),
  ),
}
const isCheckPath = (entry: string) => entry.startsWith('redemptionChecks')

let s: Scenario
let views: Record<'met' | 'missing' | 'carry' | 'maturity' | 'beforeReg', ProductDetailView>
let coverage: Coverage
let mine: DashboardView
let allAsB: DashboardView
let checkCoverage: Coverage

async function seedVerdictProduct(params: {
  id: string
  name: string
  createdAt?: string
  rounds: ReadonlyArray<{ roundNo: number; evaluationDate: string; barrier: string }>
  assets: readonly string[]
}): Promise<void> {
  await seedProduct({ id: params.id, ownerId: ITG_USER_A, name: params.name, createdAt: params.createdAt })
  for (const [i, assetId] of params.assets.entries()) {
    await seedUnderlying({ elsId: params.id, assetId, basePrice: '100.000000', sequence: i + 1 })
  }
  for (const round of params.rounds) {
    await seedSchedule({ elsId: params.id, ...round })
  }
}

beforeAll(async () => {
  s = await setupScenario()

  await seedAsset({ id: FX.assetVerdict1, name: '판정자산1' })
  await seedAsset({ id: FX.assetVerdict2, name: '판정자산2' })
  const BOTH = [FX.assetVerdict1, FX.assetVerdict2]
  const R2 = { roundNo: 2, evaluationDate: '2026-12-01', barrier: '0.8500' }

  await seedVerdictProduct({
    id: FX.productVerdictMet,
    name: '판정충족',
    createdAt: BACKDATED,
    rounds: [{ roundNo: 1, evaluationDate: '2026-06-01', barrier: '0.9000' }, R2],
    assets: BOTH,
  })
  await seedVerdictProduct({
    id: FX.productVerdictMissing,
    name: '판정결측',
    createdAt: BACKDATED,
    rounds: [{ roundNo: 1, evaluationDate: '2026-05-04', barrier: '0.9000' }, R2],
    assets: BOTH,
  })
  await seedVerdictProduct({
    id: FX.productVerdictCarry,
    name: '판정이월',
    createdAt: BACKDATED,
    rounds: [{ roundNo: 1, evaluationDate: '2026-06-02', barrier: '0.9000' }, R2],
    assets: [FX.assetVerdict1],
  })
  await seedVerdictProduct({
    id: FX.productVerdictMaturity,
    name: '판정만기',
    rounds: [
      { roundNo: 1, evaluationDate: '2026-03-02', barrier: '0.9000' },
      { roundNo: 2, evaluationDate: '2026-06-01', barrier: '0.8500' },
    ],
    assets: [FX.assetVerdict1],
  })
  await seedVerdictProduct({
    id: FX.productVerdictBeforeReg,
    name: '판정등록전',
    rounds: [{ roundNo: 1, evaluationDate: '2026-06-01', barrier: '0.9000' }, R2],
    assets: [FX.assetVerdict1],
  })

  // 평가일 종가 — 교차곱 음성 대조를 위해 «요청하지 않을» 조합에도 행을 세운다
  await seedPrice({ assetId: FX.assetVerdict1, asOfDate: '2026-06-01', price: '95.000000', source: 'AUTO' })
  await seedPrice({ assetId: FX.assetVerdict2, asOfDate: '2026-06-01', price: '100.000000', source: 'AUTO' })
  await seedPrice({ assetId: FX.assetVerdict1, asOfDate: '2026-05-04', price: '92.000000', source: 'AUTO' })
  await seedPrice({ assetId: FX.assetVerdict1, asOfDate: '2026-06-02', price: '80.000000', source: 'AUTO' })
  // 평가일 전날 — 대체하지 않는다는 대조(결측 상품의 자산2)
  await seedPrice({ assetId: FX.assetVerdict2, asOfDate: '2026-05-01', price: '120.000000', source: 'AUTO' })

  const detail = async (id: string) => {
    const view = await s.asA.getProduct(id)
    if (view == null) throw new Error(`픽스처 상품이 없다: ${id}`)
    return view
  }
  views = {
    met: await detail(FX.productVerdictMet),
    missing: await detail(FX.productVerdictMissing),
    carry: await detail(FX.productVerdictCarry),
    maturity: await detail(FX.productVerdictMaturity),
    beforeReg: await detail(FX.productVerdictBeforeReg),
  }
  coverage = collect(
    VERDICT_TABLE,
    Object.entries(views).map(([label, value]) => ({ label, value })),
  )

  mine = await s.asA.getDashboard({ scope: 'MINE' })
  allAsB = await s.asB.getDashboard({ scope: 'ALL' })
  checkCoverage = collect(CHECK_TABLE, [
    { label: 'A MINE', value: mine },
    { label: 'B ALL', value: allAsB },
  ])
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('loadEvaluationCloses — 정확한 쌍만 (PostgREST `or(and(…))`)', () => {
  it('요청한 쌍 중 실재하는 것만 온다 — 교차곱 조합(자산1@05-04 · 자산2@06-01)은 행이 있어도 오지 않는다', async () => {
    const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
    const closes = await loadEvaluationCloses(ctx, [
      { assetId: FX.assetVerdict1, date: '2026-06-01' },
      { assetId: FX.assetVerdict2, date: '2026-05-04' }, // 행 없음
    ])
    expect([...closes].map(([assetId, byDate]) => [assetId, [...byDate.keys()]])).toEqual([
      [FX.assetVerdict1, ['2026-06-01']],
    ])
    expect(closes.get(FX.assetVerdict1)?.get('2026-06-01')).toEqual({
      as_of_date: '2026-06-01',
      price: '95.000000',
      source: 'AUTO',
    })
  })

  it('★ 질의가 정확한 쌍만 가져온다 — 서버가 보낸 행 수와 요청 모양을 본다(로더의 JS 이중 방어 앞에서)', async () => {
    /*
     * 위 케이스는 로더가 «돌려준» 맵만 본다. 로더는 요청하지 않은 쌍을 JS에서 한 번 더 거르므로(이중 방어) 질의가
     * `.in(asset).in(date)` 교차곱으로 퇴행해도 그 맵은 같다 — 반박 검토(P6 컷 7-6)가 찾은 헛도는 음성 대조다. 교차곱의
     * 비용은 값이 아니라 **행 수**(자산 × 날짜 → Q-06 상한 → 홈 전체가 던진다)이므로 응답 본문의 행 수를 센다.
     * 교차곱 조합(자산1@05-04 · 자산2@06-01)에 행을 세워 두었다 — 교차곱이면 3행, 정확한 쌍이면 1행이다
     */
    const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
    const original = globalThis.fetch
    const seen: Array<{ url: string; rows: number }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/rest/v1/asset_prices')) {
        const body: unknown = await res.clone().json()
        seen.push({ url: decodeURIComponent(url), rows: Array.isArray(body) ? body.length : -1 })
      }
      return res
    }) as typeof fetch
    try {
      await loadEvaluationCloses(ctx, [
        { assetId: FX.assetVerdict1, date: '2026-06-01' },
        { assetId: FX.assetVerdict2, date: '2026-05-04' },
      ])
    } finally {
      globalThis.fetch = original
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]!.rows, '서버가 요청하지 않은 쌍의 행을 보냈다 — 교차곱이다').toBe(1)
    expect(seen[0]!.url).toContain(`or=(and(asset_id.eq.${FX.assetVerdict1},as_of_date.in.(2026-06-01))`)
    expect(seen[0]!.url).not.toMatch(/[?&]as_of_date=in\./)
  })

  it('한 자산의 여러 날짜를 한 묶음으로 읽는다', async () => {
    const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
    const closes = await loadEvaluationCloses(ctx, [
      { assetId: FX.assetVerdict1, date: '2026-06-01' },
      { assetId: FX.assetVerdict1, date: '2026-06-02' },
    ])
    expect([...(closes.get(FX.assetVerdict1)?.keys() ?? [])].sort()).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('쌍이 0건이면 질의를 내지 않는다', async () => {
    const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
    const counter = countRequests()
    try {
      const closes = await loadEvaluationCloses(ctx, [])
      expect(closes.size).toBe(0)
      expect(counter.paths()).toEqual([])
    } finally {
      counter.restore()
    }
  })

  it('형식이 아닌 쌍은 필터를 조립하기 전에 거부한다', async () => {
    const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
    await expect(
      loadEvaluationCloses(ctx, [{ assetId: `${FX.assetVerdict1}),or(true`, date: '2026-06-01' }]),
    ).rejects.toThrow(RangeError)
  })
})

describe('§4.3 evaluationVerdict — 값', () => {
  it('충족 — 평가일 종가로 낸 W와 배리어', () => {
    expect(views.met.evaluationVerdict).toEqual({
      kind: 'EARLY',
      roundNo: 1,
      evaluationDate: '2026-06-01',
      dDay: -29,
      worstOf: '0.9500',
      barrier: '0.9000',
      missingAssets: null,
      weekendEvaluation: false,
    })
  })

  it('결측 — 전날 종가가 있어도 대체하지 않고 결측 자산의 이름을 싣는다', () => {
    expect(views.missing.evaluationVerdict).toMatchObject({
      kind: 'CLOSE_MISSING',
      roundNo: 1,
      evaluationDate: '2026-05-04',
      missingAssets: [{ assetId: FX.assetVerdict2, assetName: '[ITG] 판정자산2' }],
    })
  })

  it('이월이면 null · 등록 전이면 null(종가가 충족이어도)', () => {
    expect(views.carry.evaluationVerdict).toBeNull()
    expect(views.beforeReg.evaluationVerdict).toBeNull()
  })

  it('만기 — 등록일과 무관하게 만기 평가일 경과', () => {
    expect(views.maturity.evaluationVerdict).toMatchObject({ kind: 'MATURITY_REACHED', roundNo: 2, worstOf: null })
  })

  it('★ 경과 행의 conditionResult는 여전히 null이다 — 별도 필드다', () => {
    expect(views.met.schedules.find((row) => row.roundNo === 1)?.conditionResult).toBeNull()
  })

  it('JSON 왕복이 값을 바꾸지 않는다', () => {
    expect(JSON.parse(JSON.stringify(views.met.evaluationVerdict))).toEqual(views.met.evaluationVerdict)
  })
})

describe('§4.3 evaluationVerdict — 형식 (Q-07)', () => {
  it('위반 · 미분류 · 미관측 · null로만 관측 없음', () => {
    expect(coverage.violations).toEqual([])
    expect(coverage.unclassified.filter(isVerdictPath)).toEqual([])
    expect(coverage.unobserved).toEqual([])
    expect(coverage.neverNonNull).toEqual([])
  })
})

describe('§4.0 왕복 — 평가일 종가는 쌍이 있을 때만 하나 는다', () => {
  it('판정할 차수가 있으면 asset_prices 1 — 시세와 나란히(물결 2 그대로)', async () => {
    const counter = countRequests()
    try {
      await s.asA.getProduct(FX.productVerdictMet)
      expect(tallyPaths(counter.paths())).toEqual({ els_products: 1, exchange_rates: 1, assets: 1, asset_prices: 1 })
    } finally {
      counter.restore()
    }
  })

  it('판정할 차수가 없으면(등록 전 · 만기) 종전 그대로', async () => {
    const counter = countRequests()
    try {
      await s.asA.getProduct(FX.productVerdictBeforeReg)
      await s.asA.getProduct(FX.productVerdictMaturity)
      expect(tallyPaths(counter.paths())).toEqual({ els_products: 2, exchange_rates: 2, assets: 2 })
    } finally {
      counter.restore()
    }
  })
})

describe('§4.1 redemptionChecks — 홈 ⑥ (P6 컷 7-4)', () => {
  const ids = (view: DashboardView) => view.redemptionChecks.map((item) => item.productId)
  const VERDICT_IDS: readonly string[] = [FX.productVerdictMissing, FX.productVerdictMet, FX.productVerdictMaturity]

  it('묻는 상품만 — 충족 · 종가 없음 · 만기. 이월 · 등록 전은 없다 · 평가일 오름차순', () => {
    // 결측 05-04 → 충족 06-01 · 만기 06-01(같은 날이면 상품명 — 「판정만기」 < 「판정충족」)
    expect(ids(mine)).toEqual([FX.productVerdictMissing, FX.productVerdictMaturity, FX.productVerdictMet])
    expect(mine.redemptionChecks.map((item) => item.kind)).toEqual(['CLOSE_MISSING', 'MATURITY_REACHED', 'EARLY'])
  })

  it('상세와 같은 판정 · 같은 형태다 — 한 사실을 두 화면이 다르게 부르지 않는다', () => {
    const met = mine.redemptionChecks.find((item) => item.productId === FX.productVerdictMet)
    expect(met).toEqual({
      productId: FX.productVerdictMet,
      productName: '[ITG] 판정충족',
      ownerName: expect.any(String),
      isOwner: true,
      ...views.met.evaluationVerdict,
    })
  })

  it('★ isOwner — 전체 보기의 남의 상품은 거짓이다(버튼이 소유자 전용)', () => {
    const asB = allAsB.redemptionChecks.filter((item) => VERDICT_IDS.includes(item.productId))
    expect(asB).toHaveLength(3)
    expect(asB.every((item) => item.isOwner === false)).toBe(true)
    expect(mine.redemptionChecks.every((item) => item.isOwner)).toBe(true)
  })

  it('④에 「평가일 경과」 사유가 없다 — 경과 차수는 ⑥이 묻는다', () => {
    expect(mine.attentionItems.map((item) => item.reason)).not.toContain('EVALUATION_PASSED')
  })

  it('형식 — 위반 · 미분류 · 미관측 · null로만 관측 없음', () => {
    expect(checkCoverage.violations).toEqual([])
    expect(checkCoverage.unclassified.filter(isCheckPath)).toEqual([])
    expect(checkCoverage.unobserved).toEqual([])
    expect(checkCoverage.neverNonNull).toEqual([])
  })

  it('★ 왕복 — 판정할 쌍이 있으면 asset_prices 1이 시세와 나란히 는다(5 → 6)', async () => {
    const counter = countRequests()
    try {
      await s.asA.getDashboard({ scope: 'MINE' })
      expect(tallyPaths(counter.paths())).toEqual({
        els_products: 1,
        assets: 1,
        tax_years: 1,
        tax_profiles: 1,
        exchange_rates: 1,
        asset_prices: 1,
      })
    } finally {
      counter.restore()
    }
  })
})

