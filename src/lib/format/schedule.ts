import { korMonth, monthKey } from './date'

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
