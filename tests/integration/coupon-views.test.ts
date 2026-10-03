import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadProduct, loadScheduleRows, type ProductRow, type ScheduleWithProductRow } from '@/lib/db/queries/load'
import type { DashboardView } from '@/lib/db/queries/dashboard'
import { dec } from '@/lib/decimal'
import type { ProductDetailView, ProductListItem } from '@/lib/db/queries/map'

import { FX, ITG_USER_A } from './helpers/fixtures'
import { collect, type Coverage, type Spec } from './helpers/formats'
import {
  closeSeedConnection,
  resetFixtures,
  seedCouponPayment,
  seedCouponSchedule,
  seedProduct,
  seedRedemption,
  seedSchedule,
  seedUnderlying,
} from './helpers/seed'
import { AS_OF, contractsFor, setupScenario, type Scenario } from './helpers/scenario'

/**
 * §4.3 월수익 필드의 직렬화 — `coupons` · `unnumberedCouponRecords` · `monthlyCouponAnnualRate` · `pnlBreakdown`
 * (P8 컷 b3-2, DOC-011 §4.3 · Q-07)
 *
 * ## `formats.test.ts`와 왜 다른 파일인가
 *
 * 월지급 픽스처 여섯(원화 · 달러 × 보유중 · 상환 · 기실현)을 A 소유로 세워야 `MONEY` 경로마다 두 통화가 관측된다
 * (③′). 그 파일에 세우면 같은 파일의 값 단언(`excludedForeignCount = 2` — 달러 보유 상품이 늘면 깨진다)이 이
 * 픽스처의 인질이 된다. 그래서 같은 계기(`collect`)를 쓰되 **월수익 경로만** 판정한다 — 그 밖의 경로는 그 파일이
 * 본다. 반대로 그 파일의 표에는 월수익 쪽 최상위 키(`null`로만 오는 셋)만 분류되어 있다.
 *
 * 기준일은 `AS_OF`(2026-06-30). 픽스처 날짜: 월수익 k번째 평가일 = 2026-(k+1)-01, 지급일 = +3일. 보유중 상품의 1차
 * 조기상환 평가일은 2026-07-02 — 흐름 끝이다(6번째 달 07-01은 안, 7번째부터 「조기상환 가정 밖」).
 */

const COUPON_STATES = ['PAID', 'UNPAID', 'UNRECORDED', 'SCHEDULED', 'BEYOND_ASSUMPTION', 'ENDED'] as const
const COUPON_OUTCOMES = ['PAID', 'UNPAID'] as const
const COUPON_CONDITION_RESULTS = ['EXPECTED_PAID', 'EXPECTED_UNPAID', 'UNKNOWN'] as const

const RECORD: Record<string, Spec> = {
  id: 'UUID',
  outcome: COUPON_OUTCOMES,
  paymentDate: 'DATE',
  grossAmount: 'MONEY',
  taxableIncome: 'AMOUNT_KRW',
  withholdingTax: 'AMOUNT_KRW',
  // 적용 환율(참고) — 상환의 같은 이름 필드와 같은 6자리 부류다(Q-07′)
  exchangeRate: 'PRICE',
  isConfirmed: 'BOOL',
  note: 'TEXT',
}
const prefixed = (prefix: string, table: Record<string, Spec>) =>
  Object.fromEntries(Object.entries(table).map(([key, spec]) => [`${prefix}.${key}`, spec]))

/** 월수익 경로 — 이 파일의 판정 대상 전부 */
const COUPON_TABLE: Record<string, Spec> = {
  'product.monthlyCouponAnnualRate': 'RATIO',
  coupons: 'NULL_OBJECT',
  'coupons[].couponNo': 'NUMBER',
  'coupons[].evaluationDate': 'DATE',
  'coupons[].paymentDate': 'DATE',
  'coupons[].couponBarrier': 'RATIO',
  'coupons[].state': COUPON_STATES,
  'coupons[].record': 'NULL_OBJECT',
  ...prefixed('coupons[].record', RECORD),
  // 형제 가지 — 조상에 통화가 없으므로 루트 `product.currency`로 판정한다(§4.0 규칙 1)
  'coupons[].expectedAmount': 'MONEY',
  'coupons[].conditionResult': COUPON_CONDITION_RESULTS,
  'coupons[].recordable': 'BOOL',
  ...prefixed('unnumberedCouponRecords[]', RECORD),
  'redemption.pnlBreakdown': 'NULL_OBJECT',
  'redemption.pnlBreakdown.redemption': 'MONEY',
  'redemption.pnlBreakdown.coupons': 'MONEY',
}
/** §4.2 목록의 월수익 경로 (b3-5) — 상위 키(`couponProgress` · `terms.monthlyCoupon`)는 formats.test.ts가 null로 본다 */
const LIST_TABLE: Record<string, Spec> = {
  couponPayout: ['AT_REDEMPTION', 'MONTHLY'],
  couponProgress: 'NULL_OBJECT',
  'couponProgress.paid': 'NUMBER',
  'couponProgress.recorded': 'NUMBER',
  'couponProgress.total': 'NUMBER',
  'couponProgress.nextEvaluationDate': 'DATE',
  'couponProgress.nextDDay': 'NUMBER',
  'terms.monthlyCoupon': 'NULL_OBJECT',
  'terms.monthlyCoupon.annualRate': 'RATIO',
  'terms.monthlyCoupon.barrier': 'RATIO',
}
const LIST_PREFIXES = ['couponPayout', 'couponProgress', 'terms.monthlyCoupon']

/** §4.1 홈의 월수익 경로 (b3-5) */
const DASHBOARD_TABLE: Record<string, Spec> = {
  'totals.byCurrency[].receivedCoupons': 'MONEY',
  'attentionItems[].count': 'NUMBER',
}
const DASHBOARD_PREFIXES = ['totals.byCurrency[].receivedCoupons', 'attentionItems[].count']

/** 이 파일이 맡는 경로의 뿌리 — `product` · `redemption` 전체가 아니라 그 안의 월수익 필드만이다 */
const COUPON_PREFIXES = ['product.monthlyCouponAnnualRate', 'coupons', 'unnumberedCouponRecords', 'redemption.pnlBreakdown']

let s: Scenario
let views: Record<string, ProductDetailView>
let coverage: Coverage
/** 로더가 낸 행 그대로 — 존재 탐침의 길이를 잰다(뷰는 탐침을 싣지 않는다) */
let rawProduct: ProductRow | null
let rawScheduleRows: ScheduleWithProductRow[]
let list: ProductListItem[]
let dashboard: DashboardView
let listCoverage: Coverage
let dashboardCoverage: Coverage

async function seedMonthlyFull(params: {
  id: string
  name: string
  currency: 'KRW' | 'USD'
  principal: string
  rate: string
  rounds: ReadonlyArray<{ roundNo: number; evaluationDate: string }>
  /** 일정을 세우지 않으면 셋째 결함이다 */
  months?: number
}): Promise<void> {
  await seedProduct({
    id: params.id,
    ownerId: ITG_USER_A,
    name: params.name,
    principal: params.principal,
    currency: params.currency,
    annualCouponRate: '0',
    couponPayout: 'MONTHLY',
    monthlyCouponAnnualRate: params.rate,
  })
  await seedUnderlying({ elsId: params.id, assetId: FX.assetSolo, basePrice: '100.000000', sequence: 1 })
  for (const round of params.rounds) {
    await seedSchedule({ elsId: params.id, roundNo: round.roundNo, evaluationDate: round.evaluationDate, barrier: '0.9000' })
  }
  for (let k = 1; k <= (params.months ?? 12); k += 1) {
    const month = k + 1 // k=1 → 2월
    const year = month > 12 ? 2027 : 2026
    const mm = String(month > 12 ? month - 12 : month).padStart(2, '0')
    await seedCouponSchedule({
      elsId: params.id,
      couponNo: k,
      evaluationDate: `${year}-${mm}-01`,
      paymentDate: `${year}-${mm}-04`,
      couponBarrier: '0.6000',
    })
  }
}

async function seedRealized(params: { id: string; name: string; currency: 'KRW' | 'USD'; gross: string; coupon: string; taxable: string }) {
  await seedProduct({
    id: params.id,
    ownerId: ITG_USER_A,
    name: params.name,
    principal: params.currency === 'KRW' ? '100000000' : '10000.50',
    currency: params.currency,
    entryMode: 'REALIZED_ONLY',
    issueDateNull: true,
    annualCouponRate: null,
    couponPayout: 'MONTHLY',
    monthlyCouponAnnualRate: null,
  })
  // 기록 먼저 — 순번 없는 기록은 상환일 비교 밖이지만 실제 순서(등재 뒤 기록)와 무관하게 서는지도 본다
  await seedRedemption({
    elsId: params.id,
    roundNo: null,
    redemptionType: 'MATURITY_LOSS',
    redemptionDate: '2026-03-02',
    grossAmount: params.gross,
    taxableIncome: '0',
    withholdingTax: '0',
  })
  // 지급일 순이 아닌 순서로 넣는다 — 응답이 지급일 순인지가 단언 대상이다
  for (const paymentDate of ['2025-08-20', '2025-07-20']) {
    await seedCouponPayment({
      elsId: params.id,
      couponNo: null,
      outcome: 'PAID',
      paymentDate,
      grossAmount: params.coupon,
      taxableIncome: params.taxable,
      withholdingTax: '0',
      exchangeRate: params.currency === 'USD' ? '1300.000000' : null,
      note: paymentDate === '2025-07-20' ? '연 합계 아님' : null,
    })
  }
}

beforeAll(async () => {
  s = await setupScenario()

  const ACTIVE_ROUNDS = [
    { roundNo: 1, evaluationDate: '2026-07-02' },
    { roundNo: 2, evaluationDate: '2027-01-04' },
  ]
  // 상환 픽스처 — 1차(04-01)에 조기상환, 04-06 지급. 3번째 달(04-01)이 상환 차수와 같은 날이다
  const REDEEMED_ROUNDS = [
    { roundNo: 1, evaluationDate: '2026-04-01' },
    { roundNo: 2, evaluationDate: '2026-10-01' },
  ]

  // ① 원화 보유중 — 지급 1 · 미지급 1
  await seedMonthlyFull({ id: FX.productMonthlyKrw, name: '월지급원화', currency: 'KRW', principal: '100000000', rate: '0.0720', rounds: ACTIVE_ROUNDS })
  await seedCouponPayment({ elsId: FX.productMonthlyKrw, couponNo: 1, outcome: 'PAID', paymentDate: '2026-02-04', grossAmount: '600000', taxableIncome: '600000', withholdingTax: '92400', note: '메모' })
  await seedCouponPayment({ elsId: FX.productMonthlyKrw, couponNo: 2, outcome: 'UNPAID', isConfirmed: false })

  // ② 달러 보유중 — 지급 1(센트 · 적용 환율)
  await seedMonthlyFull({ id: FX.productMonthlyUsd, name: '월지급달러', currency: 'USD', principal: '10000.50', rate: '0.2424', rounds: ACTIVE_ROUNDS })
  await seedCouponPayment({ elsId: FX.productMonthlyUsd, couponNo: 1, outcome: 'PAID', paymentDate: '2026-02-04', grossAmount: '202.01', taxableIncome: '279810', withholdingTax: '43090', exchangeRate: '1385.200000' })

  // ③④ 상환 — 1~3번째 달 지급 뒤 1차 조기상환(원금만 — 수익은 월수익)
  for (const fx of [
    { id: FX.productMonthlyKrwRedeemed, name: '월지급원화상환', currency: 'KRW' as const, principal: '100000000', coupon: '600000', taxable: '600000' },
    { id: FX.productMonthlyUsdRedeemed, name: '월지급달러상환', currency: 'USD' as const, principal: '10000.50', coupon: '202.01', taxable: '279810' },
  ]) {
    await seedMonthlyFull({ id: fx.id, name: fx.name, currency: fx.currency, principal: fx.principal, rate: fx.currency === 'KRW' ? '0.0720' : '0.2424', rounds: REDEEMED_ROUNDS })
    for (const k of [1, 2, 3]) {
      await seedCouponPayment({ elsId: fx.id, couponNo: k, outcome: 'PAID', paymentDate: `2026-0${k + 1}-04`, grossAmount: fx.coupon, taxableIncome: fx.taxable, withholdingTax: '0' })
    }
    await seedRedemption({
      elsId: fx.id,
      roundNo: 1,
      redemptionType: 'EARLY',
      redemptionDate: '2026-04-06',
      grossAmount: fx.principal,
      taxableIncome: '0',
      withholdingTax: '0',
      exchangeRate: fx.currency === 'USD' ? '1390.000000' : null,
    })
  }

  // ⑤⑥ 기실현 — 일정 없음 · 순번 없는 지급 기록
  await seedRealized({ id: FX.productMonthlyKrwRealized, name: '월지급원화기실현', currency: 'KRW', gross: '70000000', coupon: '600000', taxable: '600000' })
  await seedRealized({ id: FX.productMonthlyUsdRealized, name: '월지급달러기실현', currency: 'USD', gross: '7000.25', coupon: '202.01', taxable: '262613' })

  // ⑦ 셋째 결함 — 월지급식인데 일정 0행
  await seedMonthlyFull({ id: FX.productMonthlyBroken, name: '월지급결함', currency: 'KRW', principal: '100000000', rate: '0.0720', rounds: ACTIVE_ROUNDS, months: 0 })

  const ids = {
    krw: FX.productMonthlyKrw,
    usd: FX.productMonthlyUsd,
    krwRedeemed: FX.productMonthlyKrwRedeemed,
    usdRedeemed: FX.productMonthlyUsdRedeemed,
    krwRealized: FX.productMonthlyKrwRealized,
    usdRealized: FX.productMonthlyUsdRealized,
    broken: FX.productMonthlyBroken,
    // 상환 시 지급 대조 둘 — null 분기(`coupons` · `pnlBreakdown`)
    plain: FX.productA,
    plainRedeemed: FX.productRedeemed,
  }
  const entries = await Promise.all(
    Object.entries(ids).map(async ([key, id]) => [key, (await s.asA.getProduct(id))!] as const),
  )
  views = Object.fromEntries(entries)
  coverage = collect(
    COUPON_TABLE,
    entries.map(([label, value]) => ({ label, value })),
  )

  list = await s.asA.listProducts()
  dashboard = await s.asA.getDashboard({ scope: 'MINE' })
  listCoverage = collect(LIST_TABLE, list.map((value, i) => ({ label: `listProducts[${i}]`, value })))
  dashboardCoverage = collect(DASHBOARD_TABLE, [{ label: 'MINE', value: dashboard }])

  const ctx = { db: (await contractsFor(ITG_USER_A)).db, asOf: AS_OF, viewerId: ITG_USER_A }
  rawProduct = await loadProduct(ctx, FX.productMonthlyKrw)
  rawScheduleRows = (await loadScheduleRows(ctx, { ownerId: ITG_USER_A })).filter(
    (row) => row.els_products.id === FX.productMonthlyKrw,
  )
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('형식 — 월수익 경로 (Q-07)', () => {
  it('위반이 없다', () => {
    expect(coverage.violations).toEqual([])
  })

  it('월수익 쪽에 분류되지 않은 경로가 없다 — 그 밖의 경로는 formats.test.ts가 본다', () => {
    const mine = coverage.unclassified.filter((entry) => COUPON_PREFIXES.some((p) => entry.startsWith(p)))
    expect(mine).toEqual([])
  })

  it('표의 모든 경로가 관측되고 비-null로도 관측된다(③)', () => {
    expect(coverage.unobserved).toEqual([])
    expect(coverage.neverNonNull).toEqual([])
  })

  it('★ 상품 통화 경로마다 원화와 달러가 둘 다 관측된다(③′)', () => {
    for (const [path, currencies] of Object.entries(coverage.moneyCurrencies)) {
      expect(currencies, path).toEqual(['KRW', 'USD'])
    }
  })
})

describe('값 — 보유중 월지급', () => {
  it('원화 600,000원 · 달러 $202.01(센트 미만 절사 — 10000.50 × 24.24% / 12 = 202.0101)', () => {
    expect(views.krw?.coupons?.[0]?.expectedAmount).toBe('600000')
    expect(views.usd?.coupons?.[0]?.expectedAmount).toBe('202.01')
  })

  it('상태 — 지급 · 미지급 · 미기록 셋 · 예정(흐름 끝 07-02 안의 07-01) · 가정 밖', () => {
    expect(views.krw?.coupons?.map((c) => c.state)).toEqual([
      'PAID', 'UNPAID', 'UNRECORDED', 'UNRECORDED', 'UNRECORDED', 'SCHEDULED',
      ...Array(6).fill('BEYOND_ASSUMPTION'),
    ])
  })

  it('다음 한 행(07-01)에만 판정 — 0.95 ≥ 0.60 → 예상 지급', () => {
    const results = views.krw?.coupons?.map((c) => c.conditionResult)
    expect(results?.[5]).toBe('EXPECTED_PAID')
    expect(results?.filter((r) => r != null)).toHaveLength(1)
  })

  it('기록 가능 — 평가된 무기록 달(3~5번째)만', () => {
    expect(views.krw?.coupons?.map((c) => c.recordable)).toEqual([
      false, false, true, true, true, ...Array(7).fill(false),
    ])
  })
})

describe('값 — 상환 · 기실현 · 결함 · 대조', () => {
  it('상환 — 흐름 끝 = 상환일(04-06): 4번째 달부터 「상환 후 없음」', () => {
    expect(views.krwRedeemed?.coupons?.map((c) => c.state)).toEqual([
      'PAID', 'PAID', 'PAID', ...Array(9).fill('ENDED'),
    ])
  })

  it('상환 — 실현손익 = 원금 + Σ PAID − 원금, 구성 두 값', () => {
    expect(views.krwRedeemed?.redemption?.realizedPnl).toBe('1800000')
    expect(views.krwRedeemed?.redemption?.pnlBreakdown).toEqual({ redemption: '0', coupons: '1800000' })
    expect(views.usdRedeemed?.redemption?.realizedPnl).toBe('606.03')
    expect(views.usdRedeemed?.redemption?.pnlBreakdown).toEqual({ redemption: '0.00', coupons: '606.03' })
  })

  it('기실현 — coupons [] · 순번 없는 기록은 지급일 순 · 실현손익에 들어간다', () => {
    expect(views.krwRealized?.coupons).toEqual([])
    expect(views.krwRealized?.unnumberedCouponRecords.map((r) => r.paymentDate)).toEqual(['2025-07-20', '2025-08-20'])
    expect(views.krwRealized?.redemption?.realizedPnl).toBe('-28800000')
    expect(views.krwRealized?.product.integrityIssue).toBeNull()
  })

  it('셋째 결함 — DB에서 읽은 행도 탐침으로 판정된다', () => {
    expect(views.broken?.product.integrityIssue).toBe('COUPON_SCHEDULE_MISSING')
    expect(views.broken?.coupons).toBeNull()
    expect(views.broken?.projection).not.toBeNull()
  })

  it('★ 존재 탐침은 한 행 · 한 열이다 — 상품 루트에서도 차수 루트에서도(AQ-77)', () => {
    // 상품 루트: 일정 전체(12행)는 따로 오고 탐침은 1행이다 — limit이 무시되면 12가 된다
    expect(rawProduct?.monthly_coupon_schedules).toHaveLength(12)
    expect(rawProduct?.coupon_schedule_probe).toEqual([{ coupon_no: expect.any(Number) }])
    // 차수 루트: 차수마다 복제되는 임베드라 1행이어야 한다 — 일정 전체를 넣지 않는 이유가 그 복제다
    expect(rawScheduleRows).toHaveLength(2)
    for (const row of rawScheduleRows) {
      expect(row.els_products.coupon_schedule_probe).toHaveLength(1)
      expect(Object.keys(row.els_products.coupon_schedule_probe[0] ?? {})).toEqual(['coupon_no'])
    }
    expect(views.krw?.product.integrityIssue).toBeNull()
  })

  it('상환 시 지급 대조 — coupons null · 구성 null · 월수익 연쿠폰율 null', () => {
    expect(views.plain?.coupons).toBeNull()
    expect(views.plain?.product.monthlyCouponAnnualRate).toBeNull()
    expect(views.plainRedeemed?.redemption?.pnlBreakdown).toBeNull()
    expect(views.plainRedeemed?.unnumberedCouponRecords).toEqual([])
  })
})

describe('§4.2 목록 · §4.1 홈 — 월수익 경로 (b3-5)', () => {
  const mine = (c: Coverage, prefixes: readonly string[]) =>
    c.unclassified.filter((entry) => prefixes.some((p) => entry.startsWith(p)))

  it('형식 — 위반 없음 · 미분류 없음 · 관측됨 · 비-null 관측(③)', () => {
    for (const [c, prefixes] of [
      [listCoverage, LIST_PREFIXES],
      [dashboardCoverage, DASHBOARD_PREFIXES],
    ] as const) {
      expect(c.violations).toEqual([])
      expect(mine(c, prefixes)).toEqual([])
      expect(c.unobserved).toEqual([])
      expect(c.neverNonNull).toEqual([])
    }
  })

  it('★ 받은 월수익 — 원화 · 달러 둘 다 관측되고 값은 보유중 월지급 상품의 PAID 합이다(상환된 상품은 손익으로)', () => {
    expect(dashboardCoverage.moneyCurrencies['totals.byCurrency[].receivedCoupons']).toEqual(['KRW', 'USD'])
    const by = Object.fromEntries(dashboard.totals.byCurrency.map((row) => [row.currency, row.receivedCoupons]))
    expect(by).toEqual({ KRW: '600000', USD: '202.01' })
  })

  it('항등식은 통화별로 그대로 선다 — realizedPnl = Σ recentRedemptions (월수익 포함 산식이 양쪽에 같다)', () => {
    for (const row of dashboard.totals.byCurrency) {
      const sum = dashboard.recentRedemptions
        .filter((r) => r.currency === row.currency)
        .reduce((acc, r) => acc.plus(dec(r.realizedPnl)), dec('0'))
      expect(dec(row.realizedPnl).equals(sum), `${row.currency} ${row.realizedPnl} ≠ ${sum.toString()}`).toBe(true)
    }
    const krwRedeemed = dashboard.recentRedemptions.find((r) => r.productId === FX.productMonthlyKrwRedeemed)
    expect(krwRedeemed?.realizedPnl).toBe('1800000')
  })

  it('조치 — 월수익 미기록은 상품 단위 · count = 미기록 달 수(원화 3 · 달러 4) · 상환 · 기실현 · 결함은 없다', () => {
    const unrecorded = dashboard.attentionItems.filter((item) => item.reason === 'COUPON_UNRECORDED')
    expect(Object.fromEntries(unrecorded.map((item) => [item.productId, item.count]))).toEqual({
      [FX.productMonthlyKrw]: 3,
      [FX.productMonthlyUsd]: 4,
    })
    expect(dashboard.attentionItems.filter((item) => item.reason !== 'COUPON_UNRECORDED' && item.count != null)).toEqual([])
  })

  it('목록 — 원화 보유중 월지급 「지급 1/12 · 다음 07-01」, 상환 시 지급은 null', () => {
    const krw = list.find((row) => row.id === FX.productMonthlyKrw)
    expect(krw?.couponProgress).toEqual({ paid: 1, recorded: 2, total: 12, nextEvaluationDate: '2026-07-01', nextDDay: 1 })
    expect(krw?.terms.monthlyCoupon).toEqual({ annualRate: '0.0720', barrier: '0.6000' })
    const plain = list.find((row) => row.id === FX.productA)
    expect([plain?.couponPayout, plain?.couponProgress, plain?.terms.monthlyCoupon]).toEqual(['AT_REDEMPTION', null, null])
  })
})
