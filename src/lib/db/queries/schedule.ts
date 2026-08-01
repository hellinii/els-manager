import { currentYear } from '../today'
import type { QueryContext } from './context'
import { loadAllTaxYears, loadLatestPrices, loadScheduleRows, resolveTaxYear } from './load'
import { toScheduleItems, type ScheduleItem, type ScheduleTaxBasis } from './map'
import { toConstants } from './tax'

/** §4.4 — 평가일정 */

export type ListScheduleParams = {
  from?: string
  to?: string
  ownerId?: string
  activeOnly?: boolean
}

export function makeScheduleQueries(ctx: QueryContext) {
  async function listSchedule(
    params: ListScheduleParams = {},
  ): Promise<ScheduleItem[]> {
    /*
     * ①③ **한 물결이다.** 세율 연도는 `ctx`에만 의존하고 차수를 보지 않으므로
     * 차수 조회와 나란히 나간다 — `getDashboard`·`getForecast`가 같은 형태다.
     * 왕복은 3이고 물결은 2다(§4.0).
     *
     * ① 차수 + 부모 상품(자기 일정 전체 포함) — 네 필터 모두 질의로 내려간다
     * ③ 세율 연도 — `expectedNet`이 `separate_taxation_rate`를 요구하고 절대
     *    규칙 #5가 그 값을 코드에 두는 것을 금지한다
     */
    const [rows, taxYears] = await Promise.all([
      loadScheduleRows(ctx, params),
      loadAllTaxYears(ctx),
    ])

    // ② 자산별 최신 시세. 같은 자산이 여러 차수에 걸쳐 나오므로 중복을 제거한다
    //   (loadLatestPrices가 Set으로 접는다). 여기만 순차인 것은 자산 id가
    //   ①의 결과이기 때문이다.
    const prices = await loadLatestPrices(
      ctx,
      rows.flatMap((row) => row.els_products.els_underlyings.map((u) => u.asset_id)),
    )

    /*
     * ★ **기준일의 연도로 푼다 — 차수의 귀속연도가 아니다** (DOC-010 AQ-66).
     *
     * `resolveTaxYear`는 시드보다 과거인 연도를 **던진다**(`TaxSeedRangeError`,
     * ADR-005의 재현성). 그런데 이 화면은 지난 차수를 구획으로 **반드시**
     * 렌더하고 2025년 평가일을 가진 상품은 지금 만들 수 있다(발행일에 하한이
     * 없고 SCR-205는 과거 이력을 옮기는 화면이다). 차수별로 풀면 **남의 상품
     * 하나가 SCR-301을 전원에게 500으로 만든다** — 모든 SELECT 정책이
     * `using (true)`이므로 §8.2가 기록한 부류다.
     *
     * `asOf`는 과거가 될 수 없으므로 그 분기가 **구조적으로 도달 불가**가 된다.
     * `resolveTaxYear`를 고쳐서 풀지 않는 것이 이 결정의 절반이다 — 그 거부는
     * §4.6·§5.4가 의존하는 성질이다.
     */
    const yearContext = resolveTaxYear(taxYears, currentYear(ctx.asOf))
    const tax: ScheduleTaxBasis = {
      constants: toConstants(yearContext),
      taxLawYear: yearContext.taxLawYear,
    }

    /**
     * 부모별로 한 번만 매핑한 뒤 요청된 차수만 고른다.
     *
     * 차수마다 `toScheduleItems`를 부르면 같은 상품의 판정이 차수 수만큼 반복되고,
     * `worstOf`가 매번 다시 계산된다. 결과는 같지만 결함 상품의 `console.error`가
     * 차수만큼 반복되어 로그가 원인을 가린다.
     */
    const byProduct = new Map<string, Map<number, ScheduleItem>>()

    for (const row of rows) {
      const product = row.els_products
      if (!byProduct.has(product.id)) {
        const items = toScheduleItems(product, prices, ctx.asOf, tax)
        byProduct.set(product.id, new Map(items.map((i) => [i.roundNo, i])))
      }
    }

    const result: ScheduleItem[] = []
    for (const row of rows) {
      const item = byProduct.get(row.els_products.id)?.get(row.round_no)
      if (item != null) result.push(item)
    }

    // 루트 정렬이 평가일 오름차순이므로 순서는 이미 맞다. 동일 평가일 안에서만
    // 차수로 안정화한다 — 정렬이 흔들리면 화면 스냅샷 테스트가 부서진다.
    return result.sort(
      (a, b) =>
        a.evaluationDate.localeCompare(b.evaluationDate) ||
        a.productName.localeCompare(b.productName) ||
        a.roundNo - b.roundNo,
    )
  }

  return { listSchedule }
}
