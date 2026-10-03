import { dec, ZERO } from '@/lib/decimal'
import {
  CURRENCY_ORDER,
  dDay,
  moneyString,
  sumByCurrency,
  toKrw,
  type EstimateRates,
  type ExchangeRate,
  type ProductCurrency,
} from '@/lib/domain'

import { currentYear } from '../today'
import type { QueryContext } from './context'
import {
  loadEstimateRates,
  loadLatestPrices,
  loadProducts,
  loadTaxProfile,
  loadTaxYearContext,
  type ProductRow,
} from './load'
import {
  amountString,
  attentionReasonsFor,
  couponObservationsOf,
  exchangeRateBasisOf,
  judge,
  ownerNameOf,
  paidCouponGrossOf,
  realizedPnlOfRow,
  ratioString,
  redemptionMarkOf,
  type AttentionReason,
  type ExchangeRateBasisView,
} from './map'
import { assetIdsOf } from './products'
import { computeOwnTax } from './tax'

/** §4.1 — 대시보드 */

export type DashboardView = {
  upcomingEvaluations: Array<{
    productId: string
    productName: string
    ownerName: string
    roundNo: number
    evaluationDate: string
    dDay: number
    worstOf: string | null
    barrier: string
    willMeet: boolean | null
  }>
  totals: {
    /** 보유중 상품 수 — 개수는 통화를 넘어 더한다(`= Σ byCurrency[].activeCount`) */
    activeCount: number
    /**
     * 통화별 사실 — **통화를 넘어 더하지 않는다** (§4.1 v4.9 · DOC-007 §7.7).
     *
     * 종전 `activePrincipal`·`realizedPnl`은 전 상품의 합이었고, 달러 상품이 들어오면 그
     * 덧셈이 `$70,000 + 10,000,000원 = 10,070,000`을 만든다 — 형식은 정상이고 값만 거짓이다.
     * 두 필드는 이 배열로 옮겨 가고 최상위에서 사라진다(남겨 두면 무엇의 합인지 답이 없다).
     *
     * 범위 안에 상품이 있는 통화마다 한 행(보유중·상환 완료를 가리지 않는다), `CURRENCY_ORDER`
     * 순. **상품 0건이면 원화 0 한 행**이다 — 빈 배열을 주지 않는다.
     */
    byCurrency: Array<{
      currency: ProductCurrency
      activeCount: number
      activePrincipal: string
      /**
       * 음수 가능. 항등식은 통화별이다 — `= Σ recentRedemptions[currency = c].realizedPnl`. **상환된 상품만**이고 상환된
       * 월지급 상품은 Σ PAID 월수익을 포함한다(포트폴리오 손익 — §4.1 v4.16 · 민서 결정(2026-10-02) ②)
       */
      realizedPnl: string
      /**
       * 받은 월수익 — 그 통화의 **보유중** 월지급 상품의 PAID 월수익 세전 합 (§4.1 v4.16 — 구현 b3). 0 이상.
       * 실현손익에 넣지 않는다 — 상환되는 순간 이 합에서 빠져 `realizedPnl`로 옮겨 간다
       */
      receivedCoupons: string
    }>
    /**
     * 원화 환산 추정 (§4.1 v4.9 — P8 컷 a3). **보유중 외화 원금이 있을 때만** 객체다 — 원화 전용이거나
     * 외화 상품이 전부 상환 완료면 `null`(상환된 외화의 손익은 환산하지 않는다 — DQ-15).
     */
    krwEstimate: {
      /**
       * 원화 + Σ 외화 × 추정 환율을 원 단위로 접은 값(Q-07 ⓑ). **외화 하나라도 환율이 없으면 `null`** —
       * 부분합을 주지 않는다. 빠지는 몫이 원금 통째라 부분합이 합계처럼 보인다
       */
      activePrincipal: string | null
      /** 쓴 추정 환율. `activePrincipal`과 **함께 빈다** */
      exchangeRateBasis: ExchangeRateBasisView | null
    } | null
  }
  currentYearTax: {
    year: number
    financialIncome: string
    isComprehensive: boolean
    additionalTax: string
    /**
     * 환율이 없어 F에서 빠진 달러 추정 건 수 — E-09 (§4.1 v4.9). §4.6 `income.unconvertedCount`와
     * **같은 값**이다(같은 `computeOwnTax`). 0보다 크면 위 셋이 과소 추정이다(DOC-008 ST-07)
     */
    unconvertedCount: number
    /** 추정 환율로 환산해 넣은 달러 추정 건 수 (§4.1 v4.9 — P8 컷 a3). §4.6 `income.convertedCount`와 같은 값 */
    convertedCount: number
    /** 환산이 한 건이라도 있었을 때의 추정 환율 — `≠ null ⇔ convertedCount > 0` */
    exchangeRateBasis: ExchangeRateBasisView | null
  }
  attentionItems: Array<{
    productId: string
    productName: string
    /**
     * **`scope = 'ALL'`에서 필요하다** (v2.0, P4 컷 9).
     *
     * 이 목록의 사유는 저마다 조치를 지목하고(`KI_BELOW` → SCR-202에서 사용자가
     * 터치를 확정한다, 결함 둘 → SCR-204에서 고친다) **그 조치는 소유자만 할 수
     * 있다**(ST-04 · W-01). 소유자를 담지 않으면 사용자는 자기가 할 수 없는 일이
     * 목록에 있는 이유를 상세로 들어가서야 안다.
     *
     * 같은 뷰의 `upcomingEvaluations`가 이미 담고 있었다 — **한 뷰 안에서 두
     * 목록의 주어가 달랐던 것**이 이 필드가 없던 상태다.
     */
    ownerName: string
    reason: AttentionReason
    /** `COUPON_UNRECORDED`에만 — 그 상품의 미기록 달 수(「n개월 미기록」의 n, §4.1 v4.16 — 구현 b3). 다른 사유에는 없다 */
    count?: number
  }>
  /**
   * ⑤ 최근 상환 실적 — DOC-008 §5 SCR-101의 다섯째 요소 (v2.0, P4 컷 9)
   *
   * v1.9까지 이 뷰는 요소 넷만 담았고 ⑤에는 **자료원이 없었다.** §8이 이 화면에
   * 배정한 조회 계약은 `getDashboard` 하나이므로 그 요소는 문서에만 존재했다 —
   * `totals.realizedPnl`은 합계이며 「무엇이 상환되었는가」를 말하지 않는다.
   *
   * **왕복은 늘지 않는다**: `loadProducts`가 이미 `redemptions`를 임베드로 읽고
   * 그 값으로 `totals.realizedPnl`을 계산한다. 같은 행의 다른 투영이다.
   */
  recentRedemptions: Array<{
    productId: string
    productName: string
    ownerName: string
    redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
    redemptionDate: string
    /** `grossAmount`·`realizedPnl`의 통화 (§4.0 규칙 1) */
    currency: ProductCurrency
    grossAmount: string
    /** 음수 가능 — 과세 금융소득과 갈리는 지점이다(절대 규칙 #8) */
    realizedPnl: string
    /** ST-05 — 지급명세서 미확인 값을 확정값과 같은 모습으로 표시하지 않는다 */
    isConfirmed: boolean
  }>
}

/**
 * `totals.byCurrency` — 통화별로 **먼저 가르고** 그 안에서 더한다 (§4.1 v4.9).
 *
 * 행의 집합은 범위 안의 **모든** 상품의 통화다 — 보유중만 보면 상환 완료 달러 상품의
 * `realizedPnl`이 갈 행이 없다. `sumByCurrency`로 원금을, `aggregateRealizedPnl`(서명 불변 —
 * TC-17이 직접 부른다)로 손익을 통화마다 낸다.
 */
export function totalsByCurrency(
  rows: readonly ProductRow[],
  activeRows: readonly ProductRow[],
  redeemedRows: readonly ProductRow[],
): DashboardView['totals']['byCurrency'] {
  const present = CURRENCY_ORDER.filter((c) => rows.some((row) => row.currency === c))
  if (present.length === 0) {
    return [{ currency: 'KRW', activeCount: 0, activePrincipal: '0', realizedPnl: '0', receivedCoupons: '0' }]
  }

  const principals = new Map(
    sumByCurrency(
      activeRows.map((row) => ({ currency: row.currency, amount: row.principal })),
    ).map((entry) => [entry.currency, entry.amount]),
  )

  return present.map((currency) => {
    const active = activeRows.filter((row) => row.currency === currency)
    const redeemed = redeemedRows.filter((row) => row.currency === currency)
    return {
      currency,
      activeCount: active.length,
      activePrincipal: moneyString(principals.get(currency) ?? ZERO, currency),
      // 실현손익은 음수가 가능하다 — 과세 금융소득과 분기하는 지점이다(§4.4). 상세(§4.3)와 같은 함수다 — 상환된
      // 월지급 상품은 월수익을 포함하고(포트폴리오 손익) 상환 시 지급 상품은 종전 `realizedPnl(gross, P)` 그대로다
      realizedPnl: moneyString(
        redeemed.reduce((acc, row) => acc.plus(realizedPnlOfRow({ ...row, redemptions: row.redemptions! })), ZERO),
        currency,
      ),
      // 보유중 월지급 상품만 — 상환된 상품의 월수익은 위 손익에 들어 있다(한 월수익을 두 줄에 담지 않는다)
      receivedCoupons: moneyString(
        active
          .filter((row) => row.coupon_payout === 'MONTHLY')
          .reduce((acc, row) => acc.plus(paidCouponGrossOf(row)), ZERO),
        currency,
      ),
    }
  })
}

/**
 * `totals.krwEstimate` — 보유중 원금의 원화 환산 **추정** (§4.1 v4.9 · DOC-007 §4.8 · §7.7).
 *
 * 사실(`byCurrency`)은 환산하지 않는다 — 이 값은 그 옆에 **표식이 붙은 추정**으로 따로 선다. 외화 중
 * 하나라도 환율이 없으면 `activePrincipal`·`exchangeRateBasis`가 함께 빈다(부분합 없음). 원화 전용이면
 * 객체 자체가 `null`이라 원화 포트폴리오의 응답이 이 필드 하나 말고는 바뀌지 않는다.
 */
export function krwEstimateOf(
  activeRows: readonly ProductRow[],
  rates: EstimateRates,
  asOf: string,
): DashboardView['totals']['krwEstimate'] {
  const foreign = activeRows.filter((row) => row.currency !== 'KRW')
  if (foreign.length === 0) return null

  let total = ZERO
  const used: ExchangeRate[] = []
  for (const entry of sumByCurrency(
    activeRows.map((row) => ({ currency: row.currency, amount: row.principal })),
  )) {
    const krw = toKrw({ amount: entry.amount, currency: entry.currency, rates })
    if (krw == null) return { activePrincipal: null, exchangeRateBasis: null }
    total = total.plus(krw)
    const rate = entry.currency === 'KRW' ? null : rates[entry.currency]
    if (rate != null) used.push(rate)
  }

  return {
    activePrincipal: amountString(total),
    // 지원 외화가 `USD` 하나인 동안 `used`는 한 건이다 — 통화가 늘면 뷰가 배열이 되어야 한다(§4.1)
    exchangeRateBasis: exchangeRateBasisOf(used[0] ?? null, asOf),
  }
}

export function makeDashboardQueries(ctx: QueryContext) {
  async function getDashboard(params: {
    scope: 'MINE' | 'ALL'
  }): Promise<DashboardView> {
    const year = currentYear(ctx.asOf)

    /**
     * ①③④ — **한 물결이다.** 세율 연도 컨텍스트와 본인 프로필은 `ctx.asOf`·
     * `ctx.viewerId`만 있으면 되고 상품에 의존하지 않는다. 병렬화는 왕복을 늘리지 않았고
     * (당시 4 — §4.0 예산 불변) 대기만 3파 → 2파로 줄였다. 컷 a3 이후 추정 환율이 같은 물결에 더해져 5다.
     *
     * **③④가 없으면 2027-01-01에 홈 화면이 코드 변경 없이 죽는다** —
     * `currentYearTax`도 당해 연도의 구간·상수를 요구하므로 D7의 연도 처리가
     * 여기에도 적용되어야 한다.
     *
     * `scope = 'ALL'`이어도 세금은 본인 것만 쓴다(D-02) — `computeOwnTax`가
     * `owner_id`로 거른다.
     */
    const [rows, yearContext, ownProfile, rates] = await Promise.all([
      loadProducts(ctx, params.scope === 'MINE' ? { ownerId: ctx.viewerId } : {}),
      loadTaxYearContext(ctx, year),
      loadTaxProfile(ctx, ctx.viewerId, year),
      // 추정 환율 — `ctx.asOf`에만 의존한다(§4.0 규칙 2). 왕복 4 → 5, 물결 2 그대로
      loadEstimateRates(ctx),
    ])

    // ② 자산별 최신 시세 — assetIdsOf(rows)를 알아야 하므로 여기만 순차다
    const prices = await loadLatestPrices(ctx, assetIdsOf(rows))

    const judgments = rows.map((row) => ({ row, j: judge(row, prices, ctx.asOf) }))

    /**
     * **기간 창을 두지 않는다** (§4.1).
     *
     * 미상환 상품의 다음 평가일 전체를 `dDay` 오름차순으로 반환하고 표시 건수는
     * 화면이 정한다. "임박"의 경계를 계약에 박으면 그 값이 어느 문서에도 근거가
     * 없는 상수가 되고, 창 밖의 상품은 화면에서 사라져 SCR-101의 목적이 조용히
     * 좁아진다. 이미 경과한 차수는 `attentionItems`의 `EVALUATION_PASSED`가 담당한다.
     */
    const upcomingEvaluations = judgments
      .filter((entry) => entry.j.next != null)
      .map((entry) => {
        const next = entry.j.next!
        return {
          productId: entry.row.id,
          productName: entry.row.name,
          ownerName: ownerNameOf(entry.row),
          roundNo: next.round_no,
          evaluationDate: next.evaluation_date,
          dDay: dDay({ from: ctx.asOf, evaluationDate: next.evaluation_date }),
          worstOf: entry.j.worstOf == null ? null : ratioString(entry.j.worstOf),
          barrier: ratioString(dec(next.barrier)),
          // 판정 결과가 없으면(시세 없음·무결성 결함) 충족 여부를 말하지 않는다.
          // false로 두면 "미충족"이라는 판정을 한 것이 되어 E-01과 구분되지 않는다.
          willMeet:
            entry.j.conditionResult == null
              ? null
              : entry.j.conditionResult !== 'CARRY_OVER',
        }
      })
      .sort((a, b) => a.dDay - b.dDay || a.productName.localeCompare(b.productName))

    const activeRows = rows.filter((row) => redemptionMarkOf(row) == null)
    const redeemedRows = rows.filter((row) => row.redemptions != null)

    const own = computeOwnTax({
      products: rows,
      ownerId: ctx.viewerId,
      year,
      asOf: ctx.asOf,
      yearContext,
      otherFinancialIncome: dec(ownProfile?.other_financial_income ?? '0'),
      otherIncomeBase: dec(ownProfile?.other_income_base ?? '0'),
      rates,
    })

    // 판정은 상품당 **한 번**이다. `attentionReasonsOf(row, prices, asOf)`를 쓰면
    // 위 `judgments`와 합쳐 두 번 판정하게 되고, 결함 상품의 로그가 두 번 찍혀
    // 원인을 가린다 — `listSchedule`이 부모별로 한 번만 매핑하는 것과 같은 이유다.
    const attentionItems = judgments.flatMap((entry) => {
      // 미기록 달 수 — 상세의 `coupons`와 같은 매퍼에서 센다(E-10의 판정을 다시 하지 않는다 — 화면이 세지 않는 이유와 같다)
      const unrecorded = (couponObservationsOf(entry.row, entry.j, ctx.asOf) ?? []).filter(
        (coupon) => coupon.state === 'UNRECORDED',
      ).length
      return attentionReasonsFor(entry.j, unrecorded).map((reason) => ({
        productId: entry.row.id,
        productName: entry.row.name,
        ownerName: ownerNameOf(entry.row),
        reason,
        ...(reason === 'COUPON_UNRECORDED' ? { count: unrecorded } : {}),
      }))
    })

    /**
     * ⑤ — **기간 창을 두지 않는다.** `upcomingEvaluations`와 같은 근거이고 여기서는
     * 그것이 검산 가능한 형태가 된다: 창이 없으므로
     * `totals.realizedPnl = Σ recentRedemptions[].realizedPnl`이 **항등식**이며,
     * 창을 넣는 순간 그 항등식이 깨진다. 표시 건수와 자름의 표시는 화면이 정한다.
     *
     * 정렬은 상환일 **내림차순**이다(「최근」이 그 뜻이다). 동일 일자는 상품명으로
     * 안정화한다 — 정하지 않으면 DB가 준 순서가 되고, 그 순서는 아무 의미가 없는데
     * 안정적이라 의미가 있는 것처럼 보인다.
     */
    const recentRedemptions = redeemedRows
      .map((row) => {
        const r = row.redemptions!
        return {
          productId: row.id,
          productName: row.name,
          ownerName: ownerNameOf(row),
          redemptionType: r.redemption_type,
          redemptionDate: r.redemption_date,
          currency: row.currency,
          grossAmount: moneyString(dec(r.gross_amount), row.currency),
          // 위 합계와 같은 함수 — 항등식 `byCurrency[c].realizedPnl = Σ recentRedemptions[c].realizedPnl`이 산식 위에 선다
          realizedPnl: moneyString(realizedPnlOfRow({ ...row, redemptions: r }), row.currency),
          isConfirmed: r.is_confirmed,
        }
      })
      .sort(
        (a, b) =>
          b.redemptionDate.localeCompare(a.redemptionDate) ||
          a.productName.localeCompare(b.productName),
      )

    return {
      upcomingEvaluations,
      totals: {
        activeCount: activeRows.length,
        byCurrency: totalsByCurrency(rows, activeRows, redeemedRows),
        krwEstimate: krwEstimateOf(activeRows, rates, ctx.asOf),
      },
      currentYearTax: {
        year,
        financialIncome: amountString(own.financialIncome),
        isComprehensive: own.result.isComprehensive,
        additionalTax: amountString(own.result.additionalPayment),
        unconvertedCount: own.unconvertedCount,
        convertedCount: own.convertedCount,
        exchangeRateBasis: exchangeRateBasisOf(own.estimateRate, ctx.asOf),
      },
      attentionItems,
      recentRedemptions,
    }
  }

  return { getDashboard }
}
