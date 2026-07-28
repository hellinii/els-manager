import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import { aggregateRealizedPnl, dDay, realizedPnl } from '@/lib/domain'

import { currentYear } from '../today'
import type { QueryContext } from './context'
import {
  loadLatestPrices,
  loadProducts,
  loadTaxProfile,
  loadTaxYearContext,
} from './load'
import {
  amountString,
  attentionReasonsFor,
  judge,
  ownerNameOf,
  ratioString,
  redemptionMarkOf,
  type AttentionReason,
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
    activePrincipal: string
    activeCount: number
    realizedPnl: string
  }
  currentYearTax: {
    year: number
    financialIncome: string
    isComprehensive: boolean
    additionalTax: string
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
    grossAmount: string
    /** 음수 가능 — 과세 금융소득과 갈리는 지점이다(절대 규칙 #8) */
    realizedPnl: string
    /** ST-05 — 지급명세서 미확인 값을 확정값과 같은 모습으로 표시하지 않는다 */
    isConfirmed: boolean
  }>
}

export function makeDashboardQueries(ctx: QueryContext) {
  async function getDashboard(params: {
    scope: 'MINE' | 'ALL'
  }): Promise<DashboardView> {
    const year = currentYear(ctx.asOf)

    /**
     * ①③④ — **한 물결이다.** 세율 연도 컨텍스트와 본인 프로필은 `ctx.asOf`·
     * `ctx.viewerId`만 있으면 되고 상품에 의존하지 않는다. 왕복은 4로 같고
     * (§4.0 예산 불변) 대기만 3파 → 2파로 준다.
     *
     * **③④가 없으면 2027-01-01에 홈 화면이 코드 변경 없이 죽는다** —
     * `currentYearTax`도 당해 연도의 구간·상수를 요구하므로 D7의 연도 처리가
     * 여기에도 적용되어야 한다.
     *
     * `scope = 'ALL'`이어도 세금은 본인 것만 쓴다(D-02) — `computeOwnTax`가
     * `owner_id`로 거른다.
     */
    const [rows, yearContext, ownProfile] = await Promise.all([
      loadProducts(ctx, params.scope === 'MINE' ? { ownerId: ctx.viewerId } : {}),
      loadTaxYearContext(ctx, year),
      loadTaxProfile(ctx, ctx.viewerId, year),
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
    })

    // 판정은 상품당 **한 번**이다. `attentionReasonsOf(row, prices, asOf)`를 쓰면
    // 위 `judgments`와 합쳐 두 번 판정하게 되고, 결함 상품의 로그가 두 번 찍혀
    // 원인을 가린다 — `listSchedule`이 부모별로 한 번만 매핑하는 것과 같은 이유다.
    const attentionItems = judgments.flatMap((entry) =>
      attentionReasonsFor(entry.j).map((reason) => ({
        productId: entry.row.id,
        productName: entry.row.name,
        ownerName: ownerNameOf(entry.row),
        reason,
      })),
    )

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
          grossAmount: amountString(dec(r.gross_amount)),
          realizedPnl: amountString(
            realizedPnl({ grossAmount: r.gross_amount, principal: row.principal }),
          ),
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
        activePrincipal: amountString(
          activeRows.reduce<DecimalValue>(
            (acc, row) => acc.plus(dec(row.principal)),
            ZERO,
          ),
        ),
        activeCount: activeRows.length,
        // 실현손익은 음수가 가능하다 — 과세 금융소득과 분기하는 지점이다(§4.4)
        realizedPnl: amountString(
          aggregateRealizedPnl(
            redeemedRows.map((row) => ({
              grossAmount: row.redemptions!.gross_amount,
              principal: row.principal,
            })),
          ),
        ),
      },
      currentYearTax: {
        year,
        financialIncome: amountString(own.financialIncome),
        isComprehensive: own.result.isComprehensive,
        additionalTax: amountString(own.result.additionalPayment),
      },
      attentionItems,
      recentRedemptions,
    }
  }

  return { getDashboard }
}
