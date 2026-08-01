/**
 * 목록 페이지 나눔 — SCR-201 (DOC-008 §5 v2.0)
 *
 * ## 왜 계약이 아니라 여기인가
 *
 * `status`·`kiStatus`는 파생값이므로 계약이 조회 **후에** 거른다(Q-05). 그래서 DB의
 * `LIMIT/OFFSET`으로 나누면 **거르기 전의 집합을 자르게 되고** 페이지마다 건수가
 * 달라진다(마지막 페이지가 0건일 수도 있다). 거른 뒤의 목록을 자르는 것이 유일하게
 * 옳은 순서이며, 그 목록은 이미 메모리에 있다 — A-01 규모에서 전량 조회는 이 계약의
 * 전제이고 잘림 탐침이 상한을 지킨다.
 *
 * 즉 페이지 나눔은 **조회의 문제가 아니라 표시의 문제**다. `groupByMonth`·
 * `splitByPast`가 같은 부류로 이 디렉터리에 있다 — 화면을 위한 순수 목록 변환이다.
 *
 * ## 판단을 화면에 두지 않는다
 *
 * 「몇 페이지인가」·「범위 밖 페이지를 어떻게 하는가」는 판단이고, 화면은 어떤 스위트의
 * import 그래프에도 없다(AQ-23). 여기 있으면 상시 스위트가 전수로 본다.
 */

/** 실사용 요구 — 10건을 넘으면 나눈다 (DOC-008 §5 SCR-201 v2.0) */
export const PRODUCTS_PER_PAGE = 10

export type Paged<T> = {
  /** 이 페이지에 보일 항목 */
  items: T[]
  /** **clamp된** 현재 페이지(1-기반). 요청한 페이지와 다를 수 있다 */
  page: number
  /** 전체 페이지 수. 항목이 0건이면 1이다 — 「0페이지」는 표현하지 않는다 */
  pageCount: number
  /** 자르기 «전»의 전체 건수. 화면이 「N건 중 …」을 말할 때 쓴다 */
  total: number
}

/**
 * 목록을 페이지로 자른다.
 *
 * ## 범위 밖 페이지를 clamp한다 — 자르지 않는다
 *
 * `?page=99`를 그대로 자르면 빈 배열이 되고, 화면은 그 상태를 「조건에 맞는 상품이
 * 없다」로 렌더한다 — **상품은 있는데** 그렇게 보이므로 §6의 빈 상태 두 갈래가
 * 오염된다(그 둘의 구분은 「필터를 걸었는가」이고 「페이지를 잘못 짚었는가」가 아니다).
 * 그래서 마지막 페이지로 당긴다.
 *
 * 인식하지 못한 값(0·음수·`NaN`)도 1페이지다 — 조작된 링크가 화면을 막지 않는다는
 * `lib/forms/query.ts`의 규약과 같다.
 *
 * ## 0건에서 `pageCount`가 1이다
 *
 * 「0페이지 중 0페이지」는 사람이 읽는 말이 아니고, 화면은 그때 페이지 이동을 아예
 * 그리지 않는다(`pageCount <= 1`). 0으로 두면 나눗셈의 결과를 화면이 다시 해석해야
 * 한다.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  size: number = PRODUCTS_PER_PAGE,
): Paged<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))

  const requested = Number.isInteger(page) ? page : 1
  const current = Math.min(Math.max(requested, 1), pageCount)

  const from = (current - 1) * size
  return {
    items: items.slice(from, from + size),
    page: current,
    pageCount,
    total,
  }
}
