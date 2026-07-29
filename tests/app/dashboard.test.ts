import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { DashboardView } from '@/lib/db/queries/dashboard'
import type { AttentionReason } from '@/lib/db/queries/map'
import {
  ATTENTION_REASON_GRADES,
  ATTENTION_REASON_LABELS,
  IMMINENT_DAYS,
  IMMINENT_LABEL,
  RECENT_VISIBLE,
  UPCOMING_VISIBLE,
  groupAttention,
  hasFinancialIncomeToReport,
  heaviestGrade,
  isImminent,
  takeVisible,
} from '@/lib/format'

/**
 * 홈의 표시 구조 — SCR-101 (P4 컷 9)
 *
 * `lib/format/dashboard.ts`가 담은 것은 **계약이 화면에 넘긴 판단**이다(임박의 경계,
 * 표시 건수, 조치 목록의 접기). 화면 안에 두면 어떤 스위트도 보지 못하므로(AQ-23)
 * 순수 함수로 떼었고 여기가 그 관측 지점이다.
 *
 * ## 요소 ↔ 뷰 필드 대조가 이 파일의 핵심이다
 *
 * 컷 9가 드러낸 결함은 **DOC-008 §5가 규정한 요소 ⑤에 자료원이 없었다**는 것이다
 * (DOC-011 v1.9까지 뷰는 넷만 담았다). 앞의 다섯 사례는 「있는 값을 매퍼가 버렸다」
 * 또는 「파라미터와 반환이 비대칭이다」였고 그 둘은 계약 안에서 보이는 형태인데,
 * 이번 것은 **화면 목록과 계약을 나란히 놓아야** 보인다. 그 축이 없었으므로 만든다.
 */

const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')

// ---------------------------------------------------------------------------
// 요소 ↔ 뷰 필드
// ---------------------------------------------------------------------------

/**
 * **사람이 읽고 동의한 대응표다** — `STALE_ROUTES`와 같은 자리.
 *
 * 파생으로 만들 수 없다(요소의 한글 이름에서 필드 이름이 나오지 않는다). 값이
 * `keyof DashboardView`이므로 **필드 개명은 `typecheck`가** 잡고, 키가 문서의 마커
 * 집합과 대조되므로 **요소의 증감은 아래 단언이** 잡는다.
 */
const ELEMENT_SOURCES = {
  '①': 'upcomingEvaluations',
  '②': 'totals',
  '③': 'currentYearTax',
  '④': 'attentionItems',
  '⑤': 'recentRedemptions',
} as const satisfies Record<string, keyof DashboardView>

type Expect<T extends true> = T
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * **뷰에 대응 없는 필드가 없다.** 위 표는 「요소 → 필드」이고 이 별칭은 그 역을 본다 —
 * 필드가 늘면 `Unmapped`가 `never`를 벗어나 컴파일이 깨지고, 그때 물어야 하는 것은
 * 「그 필드를 어느 요소가 읽는가」다(요소가 없다면 DOC-008에 먼저 적는다).
 *
 * 값으로 쓰이지 않는 것이 정상이다(`payload.test.ts`의 머리글과 같은 규약).
 */
type Mapped = (typeof ELEMENT_SOURCES)[keyof typeof ELEMENT_SOURCES]
type Unmapped = Exclude<keyof DashboardView, Mapped>
type _NoUnmappedField = Expect<Equals<Unmapped, never>>

/** SCR-101 절의 「주요 요소」 셀. 화면마다 `| 항목 | 내용 |`이 있으므로 절부터 자른다 */
function mainElements(): string[] {
  const text = readFileSync(DOC_008, 'utf8')
  const at = text.indexOf('### SCR-101 홈 · 대시보드')
  expect(at, 'DOC-008에서 SCR-101 절을 찾지 못했다').toBeGreaterThan(-1)

  const row = /^\| 주요 요소 \|(.+)\|$/m.exec(text.slice(at))
  expect(row, 'SCR-101 절에 「주요 요소」 행이 없다').not.toBeNull()

  // 마커(①~⑨)로 자른다. 번호를 셀 안에서 세는 것이 요소의 정의다.
  return [...row![1]!.matchAll(/[①②③④⑤⑥⑦⑧⑨]/g)].map((m) => m[0])
}

describe('DOC-008 §5 주요 요소 ↔ `DashboardView`', () => {
  it('요소마다 그것을 읽는 필드가 있다', () => {
    /*
     * ★ **컷 9가 이 축을 만든 이유가 이 단언이다.** v1.9까지 ⑤(최근 상환 실적)에
     * 대응하는 필드가 없었고 §8이 이 화면에 배정한 조회 계약은 `getDashboard`
     * 하나였으므로, 그 요소는 문서에만 존재했다. 여섯째 요소를 DOC-008에 적으면
     * 여기가 빨간불이 되어 「무엇이 그것을 읽는가」를 묻는다.
     */
    expect(mainElements()).toEqual(Object.keys(ELEMENT_SOURCES))
  })

  it('파서가 요소를 찾았다', () => {
    // 0건을 찾고 조용히 통과하는 것이 이 부류 파서의 유일한 위험이다.
    expect(mainElements().length).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 임박 — DOC-008 §5의 「화면이 정한 값 셋」
// ---------------------------------------------------------------------------

describe('임박 판정', () => {
  it('경계가 30일이고 포함이다', () => {
    expect(IMMINENT_DAYS).toBe(30)
    expect(isImminent(IMMINENT_DAYS)).toBe(true)
    expect(isImminent(IMMINENT_DAYS + 1)).toBe(false)
  })

  it('당일은 임박이다', () => {
    // `dDay = 0`은 「오늘 평가된다」이며 가장 임박한 상태다. 경계 판정이 `> 0`이면
    // 그 하루가 빠지는데, 그것이 사용자가 가장 알아야 하는 날이다.
    expect(isImminent(0)).toBe(true)
  })

  it('경과한 차수는 임박이 아니다', () => {
    /*
     * `upcomingEvaluations`는 이미 미래 차수만 담으므로(§4.1) 이 하한은 방어다 —
     * 계약이 그 성질을 잃는 날 「경과했는데 임박」이라는 표시가 나오지 않게 한다.
     * 절댓값을 쓰는 구현(`Math.abs(dDay) <= 30`)이 정확히 그 표시를 만든다.
     */
    expect(isImminent(-1)).toBe(false)
    expect(isImminent(-30)).toBe(false)
  })

  it('표식이 D-Day를 대신하지 않는다 — 라벨이 값을 담지 않는다', () => {
    // 근거는 `IMMINENT_DAYS`의 각주다: 경계가 틀려도 정보가 사라지지 않아야 하므로
    // 표식은 덧붙는 말이어야 하고, 숫자를 담으면 그것이 곧 두 번째 D-Day 표기가 된다.
    expect(IMMINENT_LABEL).toBe('임박')
    expect(IMMINENT_LABEL).not.toMatch(/\d/)
  })
})

// ---------------------------------------------------------------------------
// 자름 — 표시하지 않는 자름을 만들지 않는다
// ---------------------------------------------------------------------------

describe('takeVisible', () => {
  const five = [1, 2, 3, 4, 5]

  it('한도 이하면 자르지 않고 자름을 말하지 않는다', () => {
    expect(takeVisible(five, 5)).toEqual({ shown: five, total: 5, hidden: 0 })
    expect(takeVisible(five, 9).hidden).toBe(0)
  })

  it('한도를 넘으면 잘린 건수를 낸다', () => {
    expect(takeVisible(five, 3)).toEqual({ shown: [1, 2, 3], total: 5, hidden: 2 })
  })

  it('빈 목록에서 음수가 나오지 않는다', () => {
    // `hidden`이 음수면 화면이 「−3건이 숨겨졌다」를 렌더한다.
    expect(takeVisible([], 5)).toEqual({ shown: [], total: 0, hidden: 0 })
  })

  it('원본을 바꾸지 않는다', () => {
    const source = [1, 2, 3]
    takeVisible(source, 1)
    expect(source).toEqual([1, 2, 3])
  })

  it('표시 건수가 ①보다 ⑤가 짧다', () => {
    // ⑤는 세 물음(§5의 설계 의도) 중 어디에도 없는 회고다. 같거나 더 길면 회고가
    // 브리핑보다 자리를 더 쓰게 된다.
    expect(UPCOMING_VISIBLE).toBe(5)
    expect(RECENT_VISIBLE).toBe(3)
    expect(RECENT_VISIBLE).toBeLessThan(UPCOMING_VISIBLE)
  })
})

// ---------------------------------------------------------------------------
// 조치 목록 접기 — 계약의 순서를 다시 정하지 않는다
// ---------------------------------------------------------------------------

type Item = {
  productId: string
  productName: string
  ownerName: string
  reason: AttentionReason
}

function item(productId: string, reason: AttentionReason, name = productId): Item {
  return { productId, productName: name, ownerName: '소유자', reason }
}

describe('groupAttention', () => {
  it('한 상품이 한 줄이다 — 사유가 둘이어도', () => {
    /*
     * ★ **P3a.5 결정 F가 이 화면에서 표시되는 형태다.** 계약이 결함과 KI 하회를
     * 함께 올리는데(§4.1 v0.8) 화면이 접지 않으면 그 상품이 목록에 두 번 나타나고
     * 사용자는 두 개의 상품으로 읽는다.
     */
    const groups = groupAttention([
      item('p1', 'SCHEDULE_MISSING'),
      item('p1', 'KI_BELOW'),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.reasons).toEqual(['SCHEDULE_MISSING', 'KI_BELOW'])
  })

  it('사유의 순서를 다시 정하지 않는다', () => {
    /*
     * 계약이 「결함 우선」으로 고정했다(§4.1 v0.8). 여기서 정렬하면 §4.2 우선순위표가
     * 화면마다 갈리는 함정이 이 요소에서 재발한다 — 그래서 **입력이 뒤집혀 있어도
     * 뒤집힌 채로 낸다.** 순서를 지키는 것은 계약의 일이고 여기서 고치면 계약의
     * 결함이 화면에 가려진다.
     */
    const groups = groupAttention([
      item('p1', 'KI_BELOW'),
      item('p1', 'SCHEDULE_MISSING'),
    ])
    expect(groups[0]!.reasons).toEqual(['KI_BELOW', 'SCHEDULE_MISSING'])
  })

  it('상품의 순서는 첫 등장 순서다', () => {
    const groups = groupAttention([
      item('p2', 'KI_NEAR'),
      item('p1', 'KI_BELOW'),
      item('p2', 'EVALUATION_PASSED'),
    ])
    expect(groups.map((g) => g.productId)).toEqual(['p2', 'p1'])
  })

  it('같은 상품이 떨어져 나타나도 그룹을 두 번 만들지 않는다', () => {
    // 제목이 두 번 나오면 사용자는 두 상품으로 읽는다(`groupByMonth`와 같은 규약).
    const groups = groupAttention([
      item('p1', 'KI_BELOW'),
      item('p2', 'KI_NEAR'),
      item('p1', 'EVALUATION_PASSED'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.reasons).toEqual(['KI_BELOW', 'EVALUATION_PASSED'])
  })

  it('소유자를 그룹으로 옮긴다 — `scope = ALL`에서 화면이 읽는다', () => {
    const groups = groupAttention([
      { ...item('p1', 'KI_BELOW'), ownerName: '아버지' },
    ])
    expect(groups[0]!.ownerName).toBe('아버지')
  })

  it('빈 목록은 빈 그룹이다', () => {
    expect(groupAttention([])).toEqual([])
  })
})

describe('heaviestGrade — 줄 전체의 강조', () => {
  it('결함 우선 순서 때문에 첫 사유를 쓰면 안 된다', () => {
    /*
     * ★ 계약의 순서는 **조치의 성격** 순이고 심각도 순이 아니다. 첫 사유를 쓰면
     * `['SCHEDULE_MISSING', 'KI_BELOW']`와 `['UNDERLYING_MISSING']`이 같은 등급이
     * 되는데, 앞은 사용자 확인까지 필요한 상태다. 그래서 가장 무거운 것을 고른다.
     */
    expect(heaviestGrade(['KI_NEAR', 'SCHEDULE_MISSING'])).toBe('defect')
    expect(heaviestGrade(['SCHEDULE_MISSING', 'KI_NEAR'])).toBe('defect')
  })

  it('순서에 의존하지 않는다', () => {
    expect(heaviestGrade(['KI_BELOW', 'KI_NEAR'])).toBe(
      heaviestGrade(['KI_NEAR', 'KI_BELOW']),
    )
  })

  it('사유가 없으면 중립이다', () => {
    expect(heaviestGrade([])).toBe('neutral')
  })

  it('일곱 사유가 전부 등급을 얻는다 — 전수', () => {
    // `ATTENTION_REASON_GRADES`가 `Record<AttentionReason, …>`이므로 누락은 컴파일에서
    // 걸리지만, 그 표를 실제로 지나는지는 여기서 본다(빈 문자열·undefined 방어).
    for (const reason of Object.keys(ATTENTION_REASON_LABELS) as AttentionReason[]) {
      expect(heaviestGrade([reason]), reason).toBe(ATTENTION_REASON_GRADES[reason])
    }
  })
})

// ---------------------------------------------------------------------------
// 빈 상태가 ③을 함께 지우지 않는다 — P4.5
// ---------------------------------------------------------------------------

/**
 * ★ **화면이 계약이 준 필드를 「모든 분기에서」 렌더하는가** (P4.5)
 *
 * 위 요소↔필드 축은 「요소마다 그것을 읽는 필드가 있는가」를 묻고 **그 필드가 어느
 * 분기에서 렌더되는가는 묻지 않는다.** 그 공백에서 결함이 하나 나왔다: 빈 상태 분기가
 * 다섯 절을 통째로 지웠고, ③의 값은 상품에 의존하지 않으므로 **상품 0건 + ELS 외
 * 금융소득**인 사용자에게 §5의 세 물음 중 둘째가 답되지 않았다.
 *
 * DOC-011 §8.1의 재발 방지 물음 **넷째**가 이 형태를 담당하며, 이 describe가 그
 * 물음의 첫 관측 지점이다.
 *
 * ## 여기서 볼 수 있는 것과 볼 수 없는 것
 *
 * 볼 수 있는 것은 **판정**이다(`hasFinancialIncomeToReport`). 볼 수 없는 것은 그
 * 판정이 실제로 절을 렌더하는지이며, 그것은 `src/app/**`의 DOM 성질이라 AQ-32의
 * 잔여에 남는다 — 판정을 순수 모듈로 뺀 만큼이 상시 스위트가 보는 전부다(AQ-23의
 * 형태와 같다).
 *
 * ## 음성 대조 3건 — 셋이 각각 다른 케이스를 잡는다
 *
 * | 되돌린 것 | 실패한 케이스 |
 * |---|---|
 * | `tax.financialIncome !== '0'` (문자열 비교) | **1건** — 표기 케이스뿐 |
 * | `true` 고정 | **2건** — 0 케이스 · 표기 케이스 |
 * | `false` 고정 | **2건** — 양수 케이스 · 음수 케이스 |
 *
 * 첫 줄이 **1건**인 것이 이 파일의 기록이다 — 표기 케이스가 문자열 비교를 잡는
 * **유일한** 대조점이므로 그것을 지우면 그 구현이 아무 단언도 깨뜨리지 않는다
 * (`map.test.ts`가 `kiStatus`에 대해 남긴 기록과 같은 형태다).
 *
 * ## 무효 대조 세 유형을 순서대로 배제한다
 *
 * ① **픽스처가 두 구현에서 일치한다** — `'0'`만 쓰면 문자열 비교와 Decimal 비교가
 *    같은 답을 낸다. 그래서 **`'0.000000'`·`'00'`을 함께 넣는다**(두 구현이 갈리는
 *    유일한 입력이다). 표기 케이스가 빠지면 문자열 비교로 되돌리는 대조가 초록이 된다.
 * ② **테스트가 값을 얹는다** — 판정 함수를 재구현하지 않고 **그 함수를 부른다**.
 *    기대값은 손으로 적은 boolean이며, 그것이 이 축에서 「얹지 않음」의 형태다
 *    (화면이 부르는 것과 같은 함수를 같은 인자로 부른다).
 * ③ **단언이 깨뜨림에 불변인 대리 지표를 본다** — 「함수가 존재한다」나 「예외를 던지지
 *    않는다」가 아니라 **참/거짓 양쪽**을 본다. 한쪽만 보면 상수로 되돌리는 대조 둘 중
 *    하나가 초록이 된다(실측: `true` 고정은 **거짓을 기대하는 두 케이스**를, `false`
 *    고정은 **참을 기대하는 두 케이스**를 깨뜨린다 — 두 방향을 함께 두어야 상수 구현이
 *    둘 다 걸린다).
 */
describe('③은 상품이 없어도 말할 것이 있으면 남는다', () => {
  it('금융소득이 양수면 참이다 — 상품 0건에서도 도달한다', () => {
    /*
     * 도달 경로: §5.6 `saveTaxProfile`은 상품을 요구하지 않고, `getDashboard`가 본인
     * 프로필의 `other_financial_income`을 함께 읽어 `elsTotal.plus(other)`를 낸다.
     * 즉 상품 0건 + 3,000만 원이면 종합과세 판정이 참이 될 수 있다.
     */
    expect(hasFinancialIncomeToReport({ financialIncome: '30000000' })).toBe(true)
    expect(hasFinancialIncomeToReport({ financialIncome: '1' })).toBe(true)
  })

  it('금융소득이 0이면 거짓이다 — 그때는 빈 상태만으로 정직하다', () => {
    expect(hasFinancialIncomeToReport({ financialIncome: '0' })).toBe(false)
  })

  it('★ 표기가 판정을 정하지 않는다 — 값으로 비교한다', () => {
    /*
     * ★ **문자열 비교(`!== '0'`)로 구현하면 여기가 빨간불이다.** 값이 아니라 **표기**가
     * 화면을 정하는 형태를 막는다 — 절대 규칙 #2가 금액 비교에 부동소수점을 금지한 것과
     * 같은 자리이며, 여기서는 그 규칙이 **판정**에 적용된다.
     *
     * > **아래 표기가 오늘 이 필드로 올 수는 없다.** `getDashboard`가
     * > `amountString(own.financialIncome)`으로 만들고 그 함수는 `toFixed(0)`이므로 항상
     * > 고정표기 정수 문자열이다(`'-0'`도 `'0'`이 된다). 즉 `!== '0'`도 **오늘은 옳고**,
     * > 이 케이스는 **그 정규화가 사라지는 날의 회귀 방어**다. Q-08의 `::text` 원형을
     * > 그대로 통과하는 축(예: 시세)에는 유효한 논거이지만 이 필드는 그쪽이 아니다 —
     * > 초안 주석이 그 둘을 섞어 적었고 적대적 반증이 잡았다.
     *
     * 그래도 이 케이스가 **필요하다**: 없으면 문자열 비교로 되돌리는 음성 대조가
     * **초록**이 된다(`'0'` 하나로는 두 구현이 같은 답을 낸다 — 픽스처가 두 구현에서
     * 일치하는 부류의 무효 대조다). 즉 판별력은 실재하고 근거만 좁혀졌다.
     */
    for (const zero of ['0.000000', '00', '0.0', '-0']) {
      expect(hasFinancialIncomeToReport({ financialIncome: zero }), zero).toBe(false)
    }
  })

  it('음수도 「말할 것이 있다」다 — 손실은 0이 아니다', () => {
    /*
     * 이 뷰의 `financialIncome`은 과세 금융소득이므로 절대 규칙 #8에 따라 음수가
     * 되지 않는다(손실 상환의 과세소득은 0이다). 그래도 판정을 `> 0`이 아니라
     * `!== 0`으로 두는 이유는 **그 불변식이 이 함수의 전제가 아니어야** 하기
     * 때문이다 — 음수가 오면 그것은 상위 계층의 결함이고, 그때 ③을 지우면 결함이
     * 화면에서 사라진다(「조용히 틀리지 않는다」).
     */
    expect(hasFinancialIncomeToReport({ financialIncome: '-1' })).toBe(true)
  })
})
