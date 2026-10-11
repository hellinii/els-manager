import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

let s: Scenario
let views: Record<'met' | 'missing' | 'carry' | 'maturity' | 'beforeReg', ProductDetailView>
let coverage: Coverage

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
