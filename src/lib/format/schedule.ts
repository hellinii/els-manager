import { korMonth, monthKey } from './date'
import type { UnderlyingLine } from './underlyings'

/**
 * 평가일정의 **구획과 그룹** — SCR-301 (P4 컷 7)
 *
 * ## 왜 화면 안이 아니라 여기인가
 *
 * `page.tsx`는 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 「월이 바뀌는 자리에서 그룹이 갈린다」와 「절 경계가 계약의 판정과
 * 같다」는 값의 성질이므로 순수 함수로 떼어 두면 상시 스위트가 본다 —
 * `deriveDisplay`·`isNavActive`를 뗀 것과 같은 자리다.
 *
 * ## 날짜를 비교하지 않는다
 *
 * 구획의 기준은 계약이 준 `isPast`뿐이다(DOC-011 §4.4). 여기서 `evaluationDate`와
 * 기준일을 비교하면 **당일의 해석이 계약과 갈릴 수 있다** — 계약은 당일을 경과로
 * 보지 않는다(`isPast`는 `dDay < 0`). 그리고 이 디렉터리는 `new Date()`를 쓸 수
 * 없으므로(컷 0d 규칙 2) 기준일을 인자로 받아야 하는데, 그 인자를 두는 순간
 * **같은 판정이 두 곳에** 생긴다.
 *
 * 월 그룹은 `monthKey`(같은 달 판정)와 `korMonth`(표시)를 쓴다. 둘 다 문자열
 * 조작이므로 `Date` 객체가 생기지 않는다(`date.ts`의 머리글).
 *
 * ## 타입을 계약에 묶지 않는다
 *
 * 필요한 것은 `evaluationDate`·`isPast` 두 필드뿐이므로 제네릭으로 둔다. 그러면
 * 테스트가 `ScheduleItem` 전체를 조립하지 않고 두 필드만으로 성질을 시험할 수 있고,
 * §4.1의 `upcomingEvaluations`처럼 같은 모양의 다른 목록이 와도 그대로 쓰인다.
 */

export type MonthGroup<T> = {
  /** 같은 달을 묶는 키. `2026-07` */
  key: string
  /** 그룹 머리글. `2026년 7월` */
  label: string
  items: T[]
}

/**
 * 월별 그룹 — **입력 순서를 재정렬하지 않는다.**
 *
 * 정렬은 계약의 일이다(§4.4는 평가일 오름차순으로 준다). 여기서 다시 정렬하면
 * 두 곳이 순서를 정하게 되고, 계약이 순서를 바꾸는 날 화면만 옛 순서를 유지한다.
 * 그룹의 순서는 **첫 등장 순서**이므로 입력이 시간순이면 그룹도 시간순이다.
 *
 * 같은 달이 떨어져서 두 번 나타나면(입력이 시간순이 아닌 경우) 그룹도 두 번
 * 나타나는 대신 **먼저 만든 그룹에 합친다** — 머리글이 두 번 나오면 사용자는 그것을
 * 두 개의 다른 달로 읽는다.
 */
export function groupByMonth<T extends { evaluationDate: string }>(
  items: readonly T[],
): Array<MonthGroup<T>> {
  const groups: Array<MonthGroup<T>> = []
  const byKey = new Map<string, MonthGroup<T>>()

  for (const item of items) {
    const key = monthKey(item.evaluationDate)
    let group = byKey.get(key)
    if (group == null) {
      group = { key, label: korMonth(item.evaluationDate), items: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.items.push(item)
  }

  return groups
}

/**
 * 과거/미래 구획 — DOC-008 §5 SCR-301의 「과거/미래 구분」.
 *
 * **계약의 `isPast`로 거른다.** 순서에 기대지 않는 이유는 「목록이 오름차순이므로
 * 그 값은 단조다」가 **계약의 현재 구현의 성질**이고 계약이 보장한 것은 아니라는
 * 것이다. 거르면 순서가 어떻든 두 절의 내용이 같고, 절 안의 순서는 입력 그대로다.
 */
export function splitByPast<T extends { isPast: boolean }>(
  items: readonly T[],
): { past: T[]; upcoming: T[] } {
  return {
    past: items.filter((item) => item.isPast),
    upcoming: items.filter((item) => !item.isPast),
  }
}

// ---------------------------------------------------------------------------
// 상품 그룹 — SCR-301 상품별 보기 (P6 컷 6)
// ---------------------------------------------------------------------------

/**
 * 카드 머리가 읽는 **상품 단위 사실** — 차수마다 같은 값으로 실려 온다(DOC-011 §4.4).
 *
 * 계약 타입에 묶지 않는 이유는 이 파일 머리글의 그것과 같다. 대신 이 구조가
 * `ScheduleItem`의 부분집합이라는 사실은 **타입 수준 증인**이 지킨다
 * (`tests/app/schedule.test.ts`) — 계약이 필드 이름을 바꾸면 그쪽이 깨진다.
 */
export type ScheduleProductFacts = {
  productId: string
  productName: string
  principal: string
  annualCouponRate: string | null
  totalRounds: number
  /** DOC-008 §5 ⑨ — 계약(기준가)과 관측(현재가)이 한 칸에 온다 (v3.4) */
  underlyings: readonly UnderlyingLine[]
  /** DOC-008 §5 ⑩ — `null`이 노낙인이다(I-11의 짝) */
  kiBarrier: string | null
  kiObservation: 'CONTINUOUS' | 'CLOSING' | null
}

export type ProductGroup<T> = ScheduleProductFacts & {
  /** 차수 오름차순. `isPast = false` */
  upcoming: T[]
  /** 차수 오름차순. `isPast = true` — 화면이 접는다 */
  past: T[]
  /** 이 카드가 실제로 담은 차수 수 */
  shownRounds: number
  /** 기간 필터가 이 상품의 차수를 잘랐다 — 카드 머리가 「전체 N차수 중 M차수」를 적는다 */
  isTruncated: boolean
}

/**
 * 상품별 묶음 — **정렬이 아니라 「묶는 키」만 다르다** (DOC-008 §5).
 *
 * ## 카드 순서는 「가장 이른 **다가오는** 차수」다 — 첫 등장 순이 아니다
 *
 * ★ **표본 12건으로 재고 고쳤다.** 처음에는 `groupByMonth`처럼 첫 등장 순으로
 * 두었는데(계약이 평가일 오름차순이므로 「그 상품의 가장 이른 평가일 순」이 된다)
 * 실제 데이터에서 **전 차수가 경과한 상품 셋이 맨 위로 올라왔다** — 그것들의 가장
 * 이른 차수가 2023년이기 때문이다. 화면의 물음이 「다음이 언제 오는가」인데 답이
 * 세 칸 아래에 있으면 그 순서는 목적을 거스른다.
 *
 * 그래서 **다가오는 차수를 가진 상품이 먼저**이고 그 안에서는 가장 이른 다가오는
 * 차수 순이다. 다가오는 차수가 없는 상품(전 차수 경과 · 상환 완료)은 **꼬리에,
 * 최근에 지난 것부터** — 그쪽에서 시급한 것은 방금 놓친 차수이지 3년 전 것이
 * 아니다(E-07의 다음 행동이 「상환 처리 또는 이월 확인」이다).
 *
 * ## 그래도 「정렬은 계약의 일이다」가 유지된다
 *
 * **날짜를 비교하지 않는다.** 두 부류 모두 **입력 순서의 위치**로만 정렬하며,
 * 그 순서를 평가일 오름차순으로 만든 것은 계약이다. 즉 여기서 하는 일은 계약이
 * 준 전순서를 **다시 매기는 것이 아니라 두 부분수열로 가르는 것**이고, 각 부분수열
 * 안에서는 계약의 순서가 그대로다 — `splitByPast`가 절을 가르는 것과 같은 형태이며
 * 이 파일이 「날짜를 비교하지 않는다」고 적은 규약도 지켜진다.
 *
 * ★ **카드 순서를 상품명·원금·수익률로 두면 DOC-008 §5의 정렬 각주가 깨진다.**
 * 그 축들은 시간과 무관하므로 「시간 순으로 조망」이 카드 경계에서 끊긴다.
 * 「상품별로 견준다」는 목적은 **카드 안에서** 달성되며 그런 순서를 요구하지 않는다.
 *
 * ## 그룹 «안»은 차수로 정렬한다 — 이것이 유일한 재정렬이고 필요하다
 *
 * 계약은 평가일 오름차순으로 주는데, 한 상품 안에서 날짜 순 = 차수 순인 것은
 * **V-07(평가일 증가)이 성립할 때뿐**이다. 그 규칙은 계약 계층에만 있고
 * `create_els_product`는 보지 않는다(DOC-011 AQ-29). 3차가 2차보다 이른 상품이
 * 오면 입력 순서를 보존하는 카드는 **`3차, 2차, 4차`를 조용히 찍는다.**
 *
 * ## `productId`로 묶는다 — 이름이 아니다
 *
 * 동명의 다른 상품 둘이 한 카드로 접히면 원금·연쿠폰율이 한쪽 것으로 표시되고,
 * 그 카드는 **그럴싸하다.** `groupByMonth`가 「해가 바뀌면 다른 그룹이다」로
 * 같은 함정을 피한 것과 같은 자리다.
 *
 * ## 상품 단위 사실을 그룹이 «들고 있다»
 *
 * 화면이 `upcoming[0] ?? past[0]`로 읽으면 타입이 정당화하지 못하는 단언이
 * 필요하다(그룹이 비지 않는다는 것은 구성상 참이지만 타입이 말하지 않는다).
 * 값은 그 상품의 **첫 항목**에서 취한다 — §4.4가 차수마다 같은 값을 보장한다.
 */
export function groupByProduct<
  T extends ScheduleProductFacts & { roundNo: number; isPast: boolean },
>(items: readonly T[]): Array<ProductGroup<T>> {
  const byId = new Map<string, { facts: ScheduleProductFacts; rounds: T[] }>()
  /** 그 상품의 가장 이른 **다가오는** 차수의 입력 위치. 없으면 `-1` */
  const firstUpcoming = new Map<string, number>()
  /** 그 상품의 가장 늦은 **지난** 차수의 입력 위치 */
  const lastPast = new Map<string, number>()

  items.forEach((item, index) => {
    let bucket = byId.get(item.productId)
    if (bucket == null) {
      bucket = {
        facts: {
          productId: item.productId,
          productName: item.productName,
          principal: item.principal,
          annualCouponRate: item.annualCouponRate,
          totalRounds: item.totalRounds,
          underlyings: item.underlyings,
          kiBarrier: item.kiBarrier,
          kiObservation: item.kiObservation,
        },
        rounds: [],
      }
      byId.set(item.productId, bucket)
    }
    bucket.rounds.push(item)

    if (item.isPast) lastPast.set(item.productId, index)
    else if (!firstUpcoming.has(item.productId)) {
      firstUpcoming.set(item.productId, index)
    }
  })

  const ids = [...byId.keys()]
  const upcomingFirst = ids
    .filter((id) => firstUpcoming.has(id))
    .sort((a, b) => firstUpcoming.get(a)! - firstUpcoming.get(b)!)
  // 다가오는 차수가 없는 상품 — 꼬리에, **최근에 지난 것부터**. 그쪽에서 시급한
  // 것은 방금 놓친 차수이지 3년 전 것이 아니다(E-07).
  const pastOnly = ids
    .filter((id) => !firstUpcoming.has(id))
    .sort((a, b) => (lastPast.get(b) ?? 0) - (lastPast.get(a) ?? 0))

  return [...upcomingFirst, ...pastOnly].map((id) => {
    const { facts, rounds } = byId.get(id)!
    // 정렬 뒤에 나눈다 — `splitByPast`가 입력 순서를 보존하므로 두 배열이 모두
    // 차수 오름차순이 되고, 과거/미래 판정이 이 파일 하나에만 남는다.
    const sorted = [...rounds].sort((a, b) => a.roundNo - b.roundNo)
    const { past, upcoming } = splitByPast(sorted)

    return {
      ...facts,
      upcoming,
      past,
      shownRounds: sorted.length,
      isTruncated: sorted.length < facts.totalRounds,
    }
  })
}

/**
 * 목록 전체의 세율 연도 — 화면 고지가 읽는다. `null`이면 드러낼 값이 없다.
 *
 * 최대값으로 접는다. 지금은 계약이 전 행에 같은 값을 싣지만(§4.4는
 * `year(asOf)` 하나로 푼다), 차수별로 갈리는 날이 와도 **「가장 최근 법으로
 * 계산된 행이 있다」**가 참으로 남는다 — 그때 고지를 행 단위로 옮길지는
 * DOC-010 AQ-66의 잔여 ⓐ다.
 */
export function taxBasisOf(
  items: readonly { proceeds: { taxLawYear: number } | null }[],
): number | null {
  let latest: number | null = null
  for (const item of items) {
    if (item.proceeds == null) continue
    if (latest == null || item.proceeds.taxLawYear > latest) {
      latest = item.proceeds.taxLawYear
    }
  }
  return latest
}
