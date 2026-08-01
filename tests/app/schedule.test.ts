import { describe, expect, it } from 'vitest'

import type { ScheduleItem } from '@/lib/db/queries/map'
import {
  groupByMonth,
  groupByProduct,
  splitByPast,
  taxBasisOf,
  type ScheduleProductFacts,
} from '@/lib/format'

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

/**
 * 상품별 묶음 — SCR-301 상품별 보기 (P6 컷 6)
 *
 * 위 두 함수와 같은 이유로 여기 있다. 픽스처도 같은 규율을 따른다 — `ScheduleItem`
 * 전체를 조립하지 않고 함수가 실제로 읽는 필드만 둔다. 그 대신 **타입 수준 증인**이
 * 계약과의 드리프트를 막는다(아래 `_witness`).
 */

type Round = ScheduleProductFacts & {
  roundNo: number
  isPast: boolean
}

const PRODUCT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const PRODUCT_B = 'bbbbbbbb-0000-4000-8000-000000000002'

function round(
  productId: string,
  roundNo: number,
  isPast = false,
  overrides: Partial<Round> = {},
): Round {
  return {
    productId,
    productName: productId === PRODUCT_A ? '상품 A' : '상품 B',
    principal: '100000000',
    annualCouponRate: '0.0800',
    totalRounds: 2,
    // v3.4의 셋도 **상품 단위 사실**이라 카드 머리가 읽는다(DOC-008 §5 ⑨⑩).
    // 그룹핑이 이 값들을 어느 차수에서 가져오는지는 아래 「같은 이름」 케이스가 본다.
    underlyings: [
      {
        assetName: '자산1',
        basePrice: '100.000000',
        currentPrice: '95.000000',
        ratio: '0.9500',
        isWorst: true,
      },
    ],
    kiBarrier: '0.5000',
    kiObservation: 'CLOSING',
    roundNo,
    isPast,
    ...overrides,
  }
}

/**
 * ★ **계약 ↔ 순수 함수의 드리프트 증인.**
 *
 * 위 픽스처가 `ScheduleItem`을 조립하지 않으므로, 계약이 `principal`을 개명하면
 * 이 파일은 초록인 채로 남고 화면만 깨진다. `ScheduleItem`이 `ScheduleProductFacts`에
 * 대입 가능한지를 타입 수준에서 단언해 그 경로를 막는다 — 값은 만들지 않는다.
 */
type _Witness = ScheduleItem extends ScheduleProductFacts ? true : never
const _witness: _Witness = true

describe('상품별 묶음', () => {
  it('같은 상품의 차수를 한 카드로 묶는다', () => {
    const groups = groupByProduct([
      round(PRODUCT_A, 1),
      round(PRODUCT_A, 2),
      round(PRODUCT_B, 1),
    ])

    expect(groups.map((g) => g.productId)).toEqual([PRODUCT_A, PRODUCT_B])
    expect(groups[0]!.shownRounds).toBe(2)
    expect(groups[1]!.shownRounds).toBe(1)
  })

  it('★ 카드 순서는 가장 이른 «다가오는» 차수 순이고 이름 순이 아니다', () => {
    /*
     * 계약이 평가일 오름차순으로 주므로 「다가오는 행의 첫 등장 순」이 곧 그것이다 —
     * 날짜를 비교하지 않는다. 이름·원금·수익률 어느 축으로든 바꾸는 순간 「시간
     * 순으로 조망」이 카드 경계에서 끊긴다(DOC-008 §5).
     */
    const groups = groupByProduct([
      round(PRODUCT_B, 1, false, { productName: 'ZZZ' }),
      round(PRODUCT_A, 1, false, { productName: 'AAA' }),
    ])
    expect(groups.map((g) => g.productName)).toEqual(['ZZZ', 'AAA'])
  })

  it('★★ 전 차수가 경과한 상품은 꼬리로 간다 — 표본 12건이 이것을 요구했다', () => {
    /*
     * ★ **실측으로 고친 자리다.** 처음에는 첫 등장 순(= 가장 이른 «평가일» 순)이었고
     * `supabase/dev/01_sample_portfolio.sql`을 넣자 **전 차수가 경과한 상품 셋이 맨
     * 위로 올라왔다** — 그것들의 1차가 2023년이기 때문이다. 화면의 물음이 「다음이
     * 언제 오는가」인데 답이 세 칸 아래에 있으면 그 순서는 목적을 거스른다.
     *
     * 아래 입력은 계약이 주는 형태 그대로다(평가일 오름차순이므로 2023년 행이 앞).
     * 첫 등장 순이면 `[전부경과, 다가옴]`이 되고, 지금 규칙이면 뒤집힌다.
     */
    const PAST_ONLY = 'cccccccc-0000-4000-8000-000000000003'
    const groups = groupByProduct([
      round(PAST_ONLY, 1, true), // 2023년 — 입력의 맨 앞
      round(PAST_ONLY, 2, true),
      round(PRODUCT_A, 1, true), // 최근에 지난 차수
      round(PRODUCT_A, 2, false), // 다가온다
    ])

    expect(groups.map((g) => g.productId)).toEqual([PRODUCT_A, PAST_ONLY])
    expect(groups[1]!.upcoming).toEqual([])
  })

  it('다가오는 차수가 없는 상품끼리는 «최근에 지난 것»부터다', () => {
    /*
     * 그쪽에서 시급한 것은 방금 놓친 차수이지 3년 전 것이 아니다 — E-07의 다음
     * 행동이 「상환 처리 또는 이월 확인」이므로 최근 것이 위에 와야 한다.
     */
    const OLD = 'dddddddd-0000-4000-8000-000000000004'
    const groups = groupByProduct([
      round(OLD, 1, true), // 오래 전
      round(PRODUCT_A, 1, true), // 그보다 최근 (입력이 날짜 오름차순이다)
    ])
    expect(groups.map((g) => g.productId)).toEqual([PRODUCT_A, OLD])
  })

  it('★ 동명의 다른 상품은 갈린다 — 이름이 아니라 id로 묶는다', () => {
    /*
     * 이름으로 묶으면 두 상품이 한 카드가 되고 원금·연쿠폰율이 한쪽 것으로
     * 표시되는데 **그 카드는 그럴싸하다.** `groupByMonth`가 「해가 바뀌면 다른
     * 그룹이다」로 피한 것과 같은 부류다.
     */
    const groups = groupByProduct([
      round(PRODUCT_A, 1, false, { productName: '같은 이름', principal: '100000000' }),
      round(PRODUCT_B, 1, false, { productName: '같은 이름', principal: '50000000' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.principal)).toEqual(['100000000', '50000000'])
  })

  it('떨어져서 다시 나타난 상품을 먼저 만든 카드에 합친다', () => {
    // 카드 머리가 두 번 나오면 사용자는 그것을 두 상품으로 읽는다.
    const groups = groupByProduct([
      round(PRODUCT_A, 1),
      round(PRODUCT_B, 1),
      round(PRODUCT_A, 2),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.productId)).toEqual([PRODUCT_A, PRODUCT_B])
    expect(groups[0]!.upcoming.map((r) => r.roundNo)).toEqual([1, 2])
  })

  it('★ 카드 «안»은 차수 오름차순이다 — 평가일 순에 기대지 않는다', () => {
    /*
     * V-07(평가일 증가)은 계약 계층에만 있고 `create_els_product`는 보지 않는다
     * (DOC-011 AQ-29). 그래서 계약이 준 평가일 순서가 차수 순서를 «보장하지
     * 않는다** — 입력 순서를 보존하면 카드가 `3차, 2차`를 조용히 찍는다.
     */
    const groups = groupByProduct([
      round(PRODUCT_A, 3),
      round(PRODUCT_A, 1),
      round(PRODUCT_A, 2),
    ])
    expect(groups[0]!.upcoming.map((r) => r.roundNo)).toEqual([1, 2, 3])
  })

  it('카드 안에서 과거/미래가 갈리고 둘 다 차수 오름차순이다', () => {
    const [group] = groupByProduct([
      round(PRODUCT_A, 4),
      round(PRODUCT_A, 2, true),
      round(PRODUCT_A, 3),
      round(PRODUCT_A, 1, true),
    ])

    expect(group!.past.map((r) => r.roundNo)).toEqual([1, 2])
    expect(group!.upcoming.map((r) => r.roundNo)).toEqual([3, 4])
    // 구획의 기준은 계약의 `isPast`뿐이다 — 같은 판정이 두 곳에 생기지 않는다
    expect(group!.past.every((r) => r.isPast)).toBe(true)
  })

  it('다가오는 차수가 없는 카드는 지난 차수만 갖는다 — 화면이 펼친 채 렌더한다', () => {
    const [group] = groupByProduct([round(PRODUCT_A, 1, true), round(PRODUCT_A, 2, true)])

    expect(group!.upcoming).toEqual([])
    expect(group!.past).toHaveLength(2)
  })

  it('기간 필터가 차수를 자르면 isTruncated가 참이다', () => {
    /*
     * 카드 머리가 「전체 6차수 중 2차수」를 적는 근거다. 자르지 않았으면 거짓이며,
     * 그 값을 `max(roundNo)`로 합성하면 3~4차만 남은 6차수 상품에서 4가 나와 틀린다.
     */
    const cut = groupByProduct([
      round(PRODUCT_A, 3, false, { totalRounds: 6 }),
      round(PRODUCT_A, 4, false, { totalRounds: 6 }),
    ])
    expect(cut[0]!.isTruncated).toBe(true)
    expect(cut[0]!.shownRounds).toBe(2)
    expect(cut[0]!.totalRounds).toBe(6)

    const full = groupByProduct([round(PRODUCT_A, 1), round(PRODUCT_A, 2)])
    expect(full[0]!.isTruncated).toBe(false)
  })

  it('빈 목록은 빈 배열이다', () => {
    expect(groupByProduct([])).toEqual([])
  })
})

describe('세율 연도 고지', () => {
  const withYear = (taxLawYear: number | null) => ({
    proceeds: taxLawYear == null ? null : { taxLawYear },
  })

  it('드러낼 값이 없으면 null이다', () => {
    expect(taxBasisOf([])).toBeNull()
    expect(taxBasisOf([withYear(null)])).toBeNull()
  })

  it('전 행이 같은 연도면 그 연도다', () => {
    expect(taxBasisOf([withYear(2026), withYear(2026)])).toBe(2026)
  })

  it('갈리면 가장 최근 연도를 낸다 — 금액 없는 행은 세지 않는다', () => {
    /*
     * 지금 계약은 전 행에 같은 값을 싣지만(§4.4는 `year(asOf)` 하나로 푼다),
     * 차수별로 갈리는 날이 와도 「가장 최근 법으로 계산된 행이 있다」가 참으로
     * 남아야 고지가 거짓이 되지 않는다 — DOC-010 AQ-66의 잔여 ⓐ.
     */
    expect(taxBasisOf([withYear(2026), withYear(null), withYear(2027)])).toBe(2027)
  })
})
