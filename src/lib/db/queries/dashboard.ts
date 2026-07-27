import { dec, ZERO, type DecimalValue } from '@/lib/decimal'
import { aggregateRealizedPnl, dDay } from '@/lib/domain'

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
    reason: AttentionReason
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
          ownerName: entry.row.users?.display_name ?? '(알 수 없음)',
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
        reason,
      })),
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
    }
  }

  return { getDashboard }
}
