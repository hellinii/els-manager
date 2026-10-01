import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toInsert } from '@/lib/db/mutations/payload'
import { amountString, dec } from '@/lib/decimal'

import { FX, FX_RATE_DATES, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import {
  closeSeedConnection,
  queryRows,
  resetFixtures,
  seedProduct,
  seedRedemption,
  seedSchedule,
  seedUnderlying,
} from './helpers/seed'
import {
  AS_OF,
  RATE_AS_OF,
  YEAR,
  contractsFor,
  setupScenario,
  type Contracts,
} from './helpers/scenario'

/**
 * 환율 — §4.11 `listExchangeRates` · §5.13 `saveExchangeRate` · §4.0 규칙 2 (P8 컷 a3)
 *
 * **이 파일만 증명할 수 있는 것 셋.**
 *
 * ① **계약 경로의 `provider: null`** — PostgREST의 UPSERT는 payload에 있는 열만 `DO UPDATE SET`에 싣는다.
 *    `tests/rls/exchange-rates.test.ts`는 손으로 쓴 SQL로 DB 층만 보았다 — `saveExchangeRate`가 실제로 그
 *    열을 싣는지는 HTTP를 지나야 보인다. 짝 통제로 열을 뺀 직접 UPSERT가 거부됨을 함께 본다.
 * ② **「같은 행」** — SCR-302의 최신 환율과 SCR-401·SCR-101·SCR-202·SCR-402가 쓴 추정 환율이 같은 값이다(§4.11).
 * ③ **F의 항등** — `getTaxSummary(Y₀).income.total` = `getForecast()` Y₀ 행 `financialIncome` = 본인
 *    `UserSummary.currentYearFinancialIncome` = 홈 `currentYearTax.financialIncome`. 달러 픽스처 + 환율로 잰다
 *    (DOC-011 §4.6 — `listUserSummaries`가 `contributionOf`의 둘째 소비자다).
 *
 * **기준일이 둘이다.** 환율 픽스처는 전부 `AS_OF` 뒤의 예약 날짜(`FX_RATE_DATES`)이므로 `AS_OF` 컨텍스트에는
 * 환율이 없고 `RATE_AS_OF` 컨텍스트에는 있다 — 한 파일 안에서 두 상태를 나란히 잰다.
 */

/**
 * 그 좌표를 **자동 수집 행**으로 만든다 — 소유자 권한(수집기는 컷 c2다). 앞 케이스가 남긴 수동 행이 있어도
 * 같은 상태에서 출발하도록 UPSERT로 쓴다
 */
async function asAutoRow(asOfDate: '2026-07-05'): Promise<void> {
  await queryRows(
    `insert into public.exchange_rates (currency, as_of_date, rate, source, provider)
     values ('USD', $1, 1388.000000, 'AUTO', 'FIXTURE_AUTO')
     on conflict (currency, as_of_date) do update
       set rate = excluded.rate, source = excluded.source, provider = excluded.provider`,
    [asOfDate],
  )
}

let now: Contracts // AS_OF — 환율 없음
let later: Contracts // RATE_AS_OF — 환율 있음

const RATE = '1392.4'

beforeAll(async () => {
  await setupScenario()

  // 달러 · 미상환 · 일반 — 1차(2026-12-01)가 두 기준일 모두의 적용 차수다. 이익 $800.01
  await seedProduct({
    id: FX.productRateUsd,
    ownerId: ITG_USER_A,
    name: '환율달러보유',
    principal: '20000.25',
    currency: 'USD',
  })
  await seedUnderlying({
    elsId: FX.productRateUsd,
    assetId: FX.assetSolo,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productRateUsd,
    roundNo: 1,
    evaluationDate: '2026-12-01',
    barrier: '0.9000',
  })

  // B 소유 달러 둘 — 보유중 하나 · 상환 완료 하나(`usedByActiveProducts`의 두 규칙을 가른다)
  for (const id of [FX.productRateUsdB, FX.productRateUsdBRedeemed]) {
    await seedProduct({
      id,
      ownerId: ITG_USER_B,
      name: id === FX.productRateUsdB ? '환율달러B보유' : '환율달러B상환',
      principal: '5000.00',
      currency: 'USD',
    })
    await seedUnderlying({ elsId: id, assetId: FX.assetSolo, basePrice: '100.000000', sequence: 1 })
    await seedSchedule({ elsId: id, roundNo: 1, evaluationDate: '2026-05-04', barrier: '0.9000' })
    await seedSchedule({ elsId: id, roundNo: 2, evaluationDate: '2026-11-02', barrier: '0.8500' })
  }
  await seedRedemption({
    elsId: FX.productRateUsdBRedeemed,
    roundNo: 1,
    redemptionType: 'EARLY',
    redemptionDate: '2026-05-07',
    grossAmount: '5200.00',
    taxableIncome: '278480',
    withholdingTax: '42880',
    exchangeRate: '1392.400000',
  })

  ;[now, later] = await Promise.all([
    contractsFor(ITG_USER_A),
    contractsFor(ITG_USER_A, RATE_AS_OF),
  ])
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('픽스처의 전제', () => {
  it('예약 환율 날짜는 전부 AS_OF 뒤이고 RATE_AS_OF 이하다 — 다른 파일이 환율 없는 상태로 돈다', () => {
    for (const date of FX_RATE_DATES) {
      expect(date > AS_OF, date).toBe(true)
      expect(date <= RATE_AS_OF, date).toBe(true)
    }
    // 같은 해 — 귀속연도가 `YEAR` 그대로라 항등을 한 해로 잰다
    expect(RATE_AS_OF.slice(0, 4)).toBe(String(YEAR))
  })
})

describe('§4.11 listExchangeRates — 원소는 지원 외화마다 하나', () => {
  it('환율이 없어도 원소가 온다 — 빈 배열이 「환율 없음」이 아니다', async () => {
    expect(await now.read.listExchangeRates()).toEqual([
      {
        currency: 'USD',
        latestRate: null,
        asOfDate: null,
        source: null,
        provider: null,
        isStale: false,
        // ★ 전 사용자(A 하나 + B 하나)의 «미상환» 달러 — 조회자로 좁히면 1, 상환 완료(B)를 세면 3이다
        usedByActiveProducts: 2,
        autoCollected: false,
      },
    ])
  })
})

describe('§5.13 saveExchangeRate — UPSERT · MANUAL · provider null', () => {
  it('저장한 환율이 6자리로 돌아오고 출처는 수동이다', async () => {
    const result = await later.write.saveExchangeRate({
      currency: 'USD',
      asOfDate: '2026-07-03',
      rate: RATE,
    })
    expect(result).toEqual({ ok: true, data: undefined })

    const [view] = await later.read.listExchangeRates()
    expect(view).toMatchObject({
      latestRate: '1392.400000',
      asOfDate: '2026-07-03',
      source: 'MANUAL',
      provider: null,
      isStale: false,
    })
  })

  it('같은 좌표는 덮어쓴다 — 행이 하나로 남는다 (삭제 계약이 없다)', async () => {
    await later.write.saveExchangeRate({ currency: 'USD', asOfDate: '2026-07-04', rate: '1400' })
    await later.write.saveExchangeRate({ currency: 'USD', asOfDate: '2026-07-04', rate: '1395.5' })

    const rows = await queryRows<{ n: string; rate: string }>(
      `select count(*)::text as n, max(rate)::text as rate
         from public.exchange_rates where currency = 'USD' and as_of_date = '2026-07-04'`,
    )
    expect(rows.rows[0]).toEqual({ n: '1', rate: '1395.500000' })
  })

  it('★ 자동 수집 행을 수동으로 정정하면 공급자가 지워진다 — 계약이 provider를 «싣는다»', async () => {
    await asAutoRow('2026-07-05')
    const result = await later.write.saveExchangeRate({
      currency: 'USD',
      asOfDate: '2026-07-05',
      rate: '1390',
    })
    expect(result.ok).toBe(true)

    const [view] = await later.read.listExchangeRates()
    expect(view).toMatchObject({
      latestRate: '1390.000000',
      asOfDate: '2026-07-05',
      source: 'MANUAL',
      provider: null,
    })
  })

  it('짝 통제 — provider를 빼고 PostgREST로 UPSERT하면 provider_check에 걸린다', async () => {
    /*
     * 위 케이스가 「계약이 provider를 실었기 때문에」 초록인지 가른다. 같은 UPSERT에서 열만 빼면 PostgREST가
     * `DO UPDATE SET`에 provider를 싣지 않아 AUTO의 공급자가 남는다 — 그 조합을 짝 제약이 거부한다.
     */
    await asAutoRow('2026-07-05')

    const { error } = await later.db
      .from('exchange_rates')
      .upsert(
        toInsert('exchange_rates', {
          currency: 'USD',
          as_of_date: '2026-07-05',
          rate: '1391',
          source: 'MANUAL',
        }),
        { onConflict: 'currency,as_of_date' },
      )
      .select('id')
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('exchange_rates_provider_check')
  })

  it('미래 날짜는 V-17 — 문구가 「환율」을 말한다', async () => {
    const result = await now.write.saveExchangeRate({
      currency: 'USD',
      asOfDate: '2026-07-03',
      rate: RATE,
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fields: { asOfDate: `기준일(${AS_OF}) 이후의 환율은 입력할 수 없다.` },
      },
    })
  })

  it('원화 환율은 계약이 먼저 거부한다 — DB CHECK가 둘째 겹이다 (V-24 ⓑ)', async () => {
    /*
     * **계약의 문구로 가른다.** `fields.currency`만 보면 DB의 `exchange_rates_currency_check`도 같은 칸으로
     * 사상되므로 계약이 원화를 통과시켜도 초록이다(반박 검토 지적). 계약은 「선택한다」, DB는 「저장하지 않는다」다.
     */
    const result = await later.write.saveExchangeRate({
      currency: 'KRW' as never,
      asOfDate: '2026-07-03',
      rate: '1',
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        fields: { currency: '통화을(를) 선택한다.' },
      },
    })
  })

  it('짝 통제 — 계약을 지나지 않은 원화 UPSERT는 DB CHECK가 거부한다 (둘째 겹이 실재한다)', async () => {
    const { error } = await later.db
      .from('exchange_rates')
      .upsert(
        toInsert('exchange_rates', {
          currency: 'KRW',
          as_of_date: '2026-07-03',
          rate: '1',
          source: 'MANUAL',
          provider: null,
        }),
        { onConflict: 'currency,as_of_date' },
      )
      .select('id')
    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('exchange_rates_currency_check')
  })
})

describe('「같은 행」 — 화면마다 같은 추정 환율 (§4.11 · §4.0 규칙 2)', () => {
  // 앞 describe의 순서에 기대지 않는다 — 최신 좌표(07-05)를 계약으로 알려진 값에 둔다
  beforeAll(async () => {
    await later.write.saveExchangeRate({ currency: 'USD', asOfDate: '2026-07-05', rate: '1390' })
  })

  it('SCR-302의 최신 환율 = SCR-401 · SCR-101 · SCR-202 · SCR-402가 쓴 환율', async () => {
    const [rates, tax, dashboard, detail, forecast] = await Promise.all([
      later.read.listExchangeRates(),
      later.read.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
      later.read.getDashboard({ scope: 'MINE' }),
      later.read.getProduct(FX.productRateUsd),
      later.read.getForecast({ ownerId: ITG_USER_A }),
    ])
    const latest = rates[0]!
    const basis = {
      currency: latest.currency,
      rate: latest.latestRate,
      asOfDate: latest.asOfDate,
      source: latest.source,
      isStale: latest.isStale,
    }
    // 위 케이스들이 07-03 · 07-04 · 07-05에 썼다 — 최신은 07-05
    expect(basis.asOfDate).toBe('2026-07-05')

    expect(tax.income.exchangeRateBasis).toEqual(basis)
    expect(dashboard.currentYearTax.exchangeRateBasis).toEqual(basis)
    expect(dashboard.totals.krwEstimate?.exchangeRateBasis).toEqual(basis)
    expect(detail!.projection?.exchangeRateBasis).toEqual(basis)
    for (const row of forecast) expect(row.exchangeRateBasis, String(row.year)).toEqual(basis)
  })
})

describe('F의 항등 — 같은 사건 집합 · 같은 추정 환율 (§4.6)', () => {
  beforeAll(async () => {
    await later.write.saveExchangeRate({ currency: 'USD', asOfDate: '2026-07-05', rate: '1390' })
  })

  async function incomes(c: Contracts) {
    const [tax, forecast, users, dashboard] = await Promise.all([
      c.read.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR }),
      c.read.getForecast({ ownerId: ITG_USER_A }),
      c.read.listUserSummaries(),
      c.read.getDashboard({ scope: 'MINE' }),
    ])
    return {
      tax,
      dashboard,
      values: [
        tax.income.total,
        forecast.find((row) => row.year === YEAR)!.financialIncome,
        users.find((row) => row.userId === ITG_USER_A)!.currentYearFinancialIncome,
        dashboard.currentYearTax.financialIncome,
      ],
    }
  }

  it('환율 있음 — 네 값이 같고 달러 추정이 들어 있다', async () => {
    const withRate = await incomes(later)
    const withoutRate = await incomes(now)

    expect(new Set(withRate.values).size, JSON.stringify(withRate.values)).toBe(1)
    expect(new Set(withoutRate.values).size, JSON.stringify(withoutRate.values)).toBe(1)

    // 같은 사건 집합이 두 기준일에 같지 않다(A정상의 1차가 지나 2027로 간다) — 그래서 「환산분」을
    // 기여 행에서 직접 읽는다. 달러 행: $800.01 × 1,390 = 1,112,013.9 → 표시 1,112,014
    const usdRow = withRate.tax.contributingProducts.find((row) => row.productId === FX.productRateUsd)
    expect(usdRow).toMatchObject({ currency: 'USD', taxableIncome: '1112014', exchangeRateMissing: false })
    expect(withRate.tax.income).toMatchObject({ convertedCount: 1, unconvertedCount: 0 })
    expect(withRate.dashboard.currentYearTax).toMatchObject({ convertedCount: 1, unconvertedCount: 0 })
  })

  it('환율 없음 — 같은 달러 행이 빠지고 센다 · 근거가 없다', async () => {
    const { tax, dashboard } = await incomes(now)
    const usdRow = tax.contributingProducts.find((row) => row.productId === FX.productRateUsd)
    expect(usdRow).toMatchObject({ taxableIncome: null, exchangeRateMissing: true })
    expect(tax.income).toMatchObject({
      convertedCount: 0,
      unconvertedCount: 1,
      exchangeRateBasis: null,
    })
    expect(dashboard.totals.krwEstimate).toEqual({ activePrincipal: null, exchangeRateBasis: null })
  })

  it('§4.1 krwEstimate — 원화 원금 + 달러 원금 × 추정 환율 (원 단위)', async () => {
    const { dashboard } = await incomes(later)
    const krw = dashboard.totals.byCurrency.find((row) => row.currency === 'KRW')!
    const usd = dashboard.totals.byCurrency.find((row) => row.currency === 'USD')!
    const rate = dashboard.totals.krwEstimate!.exchangeRateBasis!.rate
    expect(dashboard.totals.krwEstimate!.activePrincipal).toBe(
      amountString(dec(krw.activePrincipal).plus(dec(usd.activePrincipal).times(dec(rate)))),
    )
  })
})
