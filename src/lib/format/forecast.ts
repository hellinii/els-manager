import { dec } from '@/lib/decimal'

import type { ForecastRow } from '@/lib/db/queries/forecast'

/**
 * SCR-402의 빈 상태 판정 — DOC-008 §6 「전망할 데이터 없음」
 *
 * ## 계약이 `[]`를 주지 않으므로 판정이 필요하다
 *
 * §4.7은 상품이 0건이어도 **`years`개 행**을 반환한다. 그렇게 정한 이유가 §8.1의 E
 * 부류다 — SCR-101의 빈 상태 분기가 요소 ③을 함께 지운 그 형태다. 상품 0건이면서 ELS
 * 외 금융소득이 있는 사용자에게 `[]`를 주면 종합과세 여부와 보험료가 화면에서 사라지고,
 * 그 두 값은 상품과 무관하게 실재한다.
 *
 * 그래서 「행이 없다」로 빈 상태를 판정할 수 없고, 「행이 **아무것도 말하지 않는다**」로
 * 판정한다. 그 판정을 화면이 삼항으로 적으면 조건이 손에 남으므로 여기 둔다.
 *
 * ## 세 축을 **전부** 본다
 *
 * | 축 | 0이 아니면 |
 * |---|---|
 * | `grossProceeds` | 그 해에 회수가 있다 |
 * | `remainingPrincipal` | 그 해 말에 남은 원금이 있다 |
 * | `financialIncome` | 세금·보험료 열이 값을 갖는다 — **상품이 없어도 참일 수 있다** |
 *
 * 셋째가 이 함수의 요점이다. 앞의 둘만 보면 상품 0건 + ELS 외 금융소득인 사용자가
 * 「전망할 데이터 없음」으로 판정되어 **계약이 `[]`를 주지 않기로 한 결정이 화면에서
 * 그대로 무효화된다.** 계약과 화면 두 층에 같은 방어가 필요한 이유다.
 *
 * `cumulativeAssets`·`cumulativeNet`은 보지 않는다 — 앞의 셋에서 파생되므로 축이 늘지
 * 않는다. `netProceeds`도 보지 않는다: `grossProceeds − F × 부담률`이므로 세 축이 전부
 * 0이면 이것도 0이고, **0이 아니면 세 축 중 하나가 이미 0이 아니다.**
 */
export function isForecastEmpty(rows: readonly ForecastRow[]): boolean {
  if (rows.length === 0) return true

  return rows.every(
    (row) =>
      dec(row.grossProceeds).isZero() &&
      dec(row.remainingPrincipal).isZero() &&
      dec(row.financialIncome).isZero(),
  )
}
