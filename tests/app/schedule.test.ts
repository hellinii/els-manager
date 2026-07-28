import { describe, expect, it } from 'vitest'

import { groupByMonth, splitByPast } from '@/lib/format'

/**
 * SCR-301의 구획과 월 그룹 — **순수 함수라 여기서 보인다** (P4 컷 7)
 *
 * 화면(`page.tsx`)은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 없다
 * (AQ-23). 「월이 바뀌는 자리에서 그룹이 갈린다」와 「구획의 경계가 계약의 판정과
 * 같다」는 값의 성질이므로 함수로 떼어 두면 상시 스위트가 대조한다.
 *
 * 픽스처가 `ScheduleItem` 전체가 아닌 이유: 두 함수가 필요로 하는 필드가
 * `evaluationDate`·`isPast` 둘뿐이므로 제네릭으로 두었다. 전체를 조립하면 이 파일이
 * 계약 형태에 묶이고, 필드가 늘 때 성질과 무관한 수정이 생긴다.
 */

type Item = { evaluationDate: string; isPast: boolean; label: string }

function item(evaluationDate: string, isPast = false, label = evaluationDate): Item {
  return { evaluationDate, isPast, label }
}

describe('월별 그룹', () => {
  it('같은 달을 묶고 라벨을 한글로 낸다', () => {
    const groups = groupByMonth([
      item('2026-07-02'),
      item('2026-07-28'),
      item('2026-08-03'),
    ])

    expect(groups.map((g) => g.key)).toEqual(['2026-07', '2026-08'])
    expect(groups.map((g) => g.label)).toEqual(['2026년 7월', '2026년 8월'])
    expect(groups.map((g) => g.items.length)).toEqual([2, 1])
  })

  it('해가 바뀌면 다른 그룹이다 — 월만 보지 않는다', () => {
    /*
     * ★ 키가 `MM`이면 2026년 1월과 2027년 1월이 한 그룹으로 접힌다. 3·6개월 주기
     * 상품에서 12개월 떨어진 두 차수는 흔하므로(DOC-002) 이 결함은 표본에서 바로
     * 나타난다 — 그런데 라벨을 `korMonth`로 찍으면 「2026년 1월」 하나만 보이므로
     * **두 차수가 한 달에 있는 것처럼** 읽힌다.
     */
    const groups = groupByMonth([item('2026-01-05'), item('2027-01-05')])
    expect(groups.map((g) => g.key)).toEqual(['2026-01', '2027-01'])
  })

  it('입력을 재정렬하지 않는다 — 정렬은 계약의 일이다', () => {
    /*
     * 여기서 다시 정렬하면 순서를 두 곳이 정하게 되고, 계약이 순서를 바꾸는 날
     * 화면만 옛 순서를 유지한다(§4.4는 평가일 오름차순으로 준다).
     */
    const groups = groupByMonth([item('2026-07-28'), item('2026-07-02')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((i) => i.label)).toEqual(['2026-07-28', '2026-07-02'])
  })

  it('떨어져서 다시 나타난 달을 먼저 만든 그룹에 합친다', () => {
    /*
     * 머리글이 두 번 나오면 사용자는 그것을 두 개의 다른 달로 읽는다. 입력이
     * 시간순이면 발생하지 않지만, 발생했을 때의 결과가 「같은 달이 둘」인 것보다는
     * 「순서가 조금 어긋난 하나」인 편이 낫다.
     */
    const groups = groupByMonth([
      item('2026-07-02'),
      item('2026-08-03'),
      item('2026-07-28'),
    ])
    expect(groups.map((g) => g.key)).toEqual(['2026-07', '2026-08'])
    expect(groups[0]!.items).toHaveLength(2)
  })

  it('빈 목록은 빈 그룹이다', () => {
    expect(groupByMonth([])).toEqual([])
  })

  it('날짜 형식이 아니면 던진다 — 조용히 빈 그룹을 만들지 않는다', () => {
    // `date.ts`의 규약을 그대로 물려받는다(표시 계층이 빈 문자열을 내면 화면에서
    // 날짜가 사라지고 원인을 알 수 없다).
    expect(() => groupByMonth([item('2026/07/02')])).toThrow(RangeError)
  })
})

describe('과거/미래 구획', () => {
  it('계약이 준 `isPast`로 나눈다', () => {
    const { past, upcoming } = splitByPast([
      item('2026-06-01', true),
      item('2026-07-28', false),
      item('2027-01-04', false),
    ])

    expect(past.map((i) => i.label)).toEqual(['2026-06-01'])
    expect(upcoming.map((i) => i.label)).toEqual(['2026-07-28', '2027-01-04'])
  })

  it('★ 기준일 당일은 「다가오는」이다 — 계약의 경계를 화면이 다시 정하지 않는다', () => {
    /*
     * ★ 계약의 `isPast`는 `dDay < 0`이므로 **당일은 경과가 아니다**(`isPast`의
     * docblock). 화면이 날짜를 비교해 나누면 그 경계가 갈릴 수 있고, 갈리면
     * 「오늘 평가되는 차수」가 지난 절에 들어간다 — 오늘 해야 할 일이 이미 지난
     * 일로 보이는 형태다.
     *
     * 그리고 `PAST` 기간의 질의는 `to = 기준일`이므로(포함) **당일 차수가 실제로
     * 목록에 온다**(`tests/app/query.test.ts`). 그것을 여기서 거르는 것이 두
     * 함수의 분업이다.
     */
    const today = item('2026-07-28', false)
    const { past, upcoming } = splitByPast([item('2026-07-27', true), today])

    expect(past).toHaveLength(1)
    expect(upcoming).toEqual([today])
  })

  it('순서에 기대지 않는다 — 섞여 있어도 내용이 같다', () => {
    /*
     * 「목록이 오름차순이므로 `isPast`는 단조다」는 계약의 **현재 구현의 성질**이고
     * 계약이 보장한 것이 아니다. 첫 미래 차수를 찾아 자르는 구현이면 이 케이스에서
     * 지난 차수가 미래 절에 섞인다.
     */
    const { past, upcoming } = splitByPast([
      item('2026-07-28', false),
      item('2026-06-01', true),
    ])
    expect(past.map((i) => i.label)).toEqual(['2026-06-01'])
    expect(upcoming.map((i) => i.label)).toEqual(['2026-07-28'])
  })

  it('절 안의 순서는 입력 그대로다', () => {
    const { upcoming } = splitByPast([item('2026-09-01'), item('2026-08-01')])
    expect(upcoming.map((i) => i.label)).toEqual(['2026-09-01', '2026-08-01'])
  })

  it('한쪽만 있는 경우가 셋째 빈 상태를 만든다', () => {
    /*
     * 지난 절만 있고 미래 절이 비면 DOC-008 §6의 「예정 평가일 없음」이다 —
     * 전 차수가 경과한 미상환 상품만 남은 상태(E-07)이며 다음 행동이 등록도 필터
     * 해제도 아니라 상환 처리·이월 확인이다. 화면이 그 셋을 가르는 입력이 여기다.
     */
    const onlyPast = splitByPast([item('2026-06-01', true)])
    expect(onlyPast.upcoming).toEqual([])
    expect(onlyPast.past).toHaveLength(1)

    const onlyUpcoming = splitByPast([item('2027-01-04', false)])
    expect(onlyUpcoming.past).toEqual([])
  })
})
