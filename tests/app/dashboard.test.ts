import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { DashboardView } from '@/lib/db/queries/dashboard'
import type { AttentionReason } from '@/lib/db/queries/map'
import {
  ATTENTION_REASON_GRADES,
  ATTENTION_REASON_LABELS,
  RECENT_VISIBLE,
  TAX_METHOD_VERDICT_LABELS,
  UPCOMING_VISIBLE,
  YEAR_TAX_TEXT,
  groupAttention,
  hasFinancialIncomeToReport,
  heaviestGrade,
  shownCurrencyRows,
  takeVisible,
  yearTaxDisplay,
  type YearTaxAmount,
  type YearTaxLine,
} from '@/lib/format'
import { PATHS, TAX_PROFILE_SECTION } from '@/lib/routes/paths'

import { liveDoc, quoteBlock } from './docText'

/**
 * 홈의 표시 구조 — SCR-101 (P4 컷 9)
 *
 * `lib/format/dashboard.ts`가 담은 것은 **계약이 화면에 넘긴 판단**이다(표시 건수, 조치
 * 목록의 접기 — ~~임박의 경계~~는 없앴다, 홈 피드백 컷 K4 · D2). 화면 안에 두면 어떤 스위트도 보지 못하므로(AQ-23)
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
  // P6 컷 7-4 — 화면에서는 맨 위지만 번호는 끝이다(①~⑤의 참조가 수십 곳 — DOC-008 SCR-101 「P6 컷 7-0」 각주)
  '⑥': 'redemptionChecks',
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
    expect(mainElements().length).toBe(6)
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
      item('p2', 'PRICE_MISSING'),
    ])
    expect(groups.map((g) => g.productId)).toEqual(['p2', 'p1'])
  })

  it('같은 상품이 떨어져 나타나도 그룹을 두 번 만들지 않는다', () => {
    // 제목이 두 번 나오면 사용자는 두 상품으로 읽는다(`groupByMonth`와 같은 규약).
    const groups = groupAttention([
      item('p1', 'KI_BELOW'),
      item('p2', 'KI_NEAR'),
      item('p1', 'PRICE_MISSING'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.reasons).toEqual(['KI_BELOW', 'PRICE_MISSING'])
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

  it('★ 기록(record)은 관찰보다 무겁고 원금 위험 · 결함보다 가볍다 — 순서를 뒤집어도 같은 답 (홈 피드백 컷 K3 · DOC-005 §6.3 v1.24)', () => {
    /*
     * 비교가 엄격(`>`)이라 `record`가 `caution`과 같은 무게면 먼저 온 사유가 이긴다 — 첫 쌍이 순서에 따라 갈린다.
     * 0이면 「월수익 미기록」만 있는 줄이 `neutral`이 된다(아래 「사유 전수」가 빨개진다).
     */
    const cases: [AttentionReason[], string][] = [
      [['KI_NEAR', 'COUPON_UNRECORDED'], 'record'],
      [['PRICE_MISSING', 'COUPON_UNRECORDED'], 'record'],
      [['COUPON_UNRECORDED', 'KI_BELOW'], 'attention'],
      [['COUPON_UNRECORDED', 'KI_TOUCHED'], 'attention'],
      [['UNDERLYING_MISSING', 'COUPON_UNRECORDED'], 'defect'],
      [['COUPON_SCHEDULE_MISSING', 'COUPON_UNRECORDED'], 'defect'],
    ]
    for (const [reasons, grade] of cases) {
      expect(heaviestGrade(reasons), reasons.join(' · ')).toBe(grade)
      expect(heaviestGrade([...reasons].reverse()), [...reasons].reverse().join(' · ')).toBe(grade)
    }
  })

  it('사유가 없으면 중립이다', () => {
    expect(heaviestGrade([])).toBe('neutral')
  })

  it('사유 전수가 각자의 등급을 얻는다', () => {
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
// ---------------------------------------------------------------------------
// ② — 값이 0인 통화 줄은 숨긴다 (홈 피드백 컷 K11)
// ---------------------------------------------------------------------------

/**
 * `shownCurrencyRows` — DOC-008 SCR-101 「홈 피드백 컷 K0」 ②. 기대값은 손으로 적는다. 행 모양은 계약의 `byCurrency` 한 원소다
 * (원금 · 손익 · 받은 월수익 — 달러는 소수 두 자리 고정 · Q-07′).
 */
describe('shownCurrencyRows — ② 통화 줄 (홈 피드백 컷 K11 · 피드백 #7 · D5)', () => {
  type Row = DashboardView['totals']['byCurrency'][number]
  function row(
    currency: Row['currency'],
    activePrincipal: string,
    realizedPnl = currency === 'KRW' ? '0' : '0.00',
    receivedCoupons = currency === 'KRW' ? '0' : '0.00',
  ): Row {
    return { currency, activeCount: 0, activePrincipal, realizedPnl, receivedCoupons }
  }
  const currencies = (rows: readonly Row[]) => rows.map((r) => r.currency)

  it.each<[string, Row[], Row['currency'][]]>([
    ['달러가 0이면 원화만', [row('KRW', '5000000'), row('USD', '0.00')], ['KRW']],
    ['원화가 0이면 달러만', [row('KRW', '0'), row('USD', '600.00')], ['USD']],
    ['둘 다 있으면 둘 다 — 계약이 준 순서 그대로', [row('KRW', '616000'), row('USD', '600.00')], ['KRW', 'USD']],
    ['★ 전부 0이면 첫 줄 하나 — 칸이 비지 않는다', [row('KRW', '0'), row('USD', '0.00')], ['KRW']],
    ['달러뿐이고 0이어도 그 줄 하나', [row('USD', '0.00')], ['USD']],
    ['상품 0건 — 계약의 원화 0 한 행', [row('KRW', '0')], ['KRW']],
  ])('투자원금 · keepOne — %s', (_case, rows, expected) => {
    expect(currencies(shownCurrencyRows(rows, 'activePrincipal', { keepOne: true }))).toEqual(expected)
  })

  it('★ 칸마다 자기 필드로 고른다 — 달러가 전부 상환되면 원금 칸에서는 빠지고 손익 칸에는 선다', () => {
    const rows = [row('KRW', '1000000000', '616000'), row('USD', '0.00', '600.00')]
    expect(currencies(shownCurrencyRows(rows, 'activePrincipal', { keepOne: true }))).toEqual(['KRW'])
    expect(currencies(shownCurrencyRows(rows, 'realizedPnl', { keepOne: true }))).toEqual(['KRW', 'USD'])
  })

  it('음수는 0이 아니다 — 손실 줄은 남는다', () => {
    const rows = [row('KRW', '1000', '-850000'), row('USD', '1.00', '0.00')]
    expect(currencies(shownCurrencyRows(rows, 'realizedPnl', { keepOne: true }))).toEqual(['KRW'])
    const usdLoss = [row('KRW', '1000', '0'), row('USD', '1.00', '-92.40')]
    expect(currencies(shownCurrencyRows(usdLoss, 'realizedPnl', { keepOne: true }))).toEqual(['USD'])
  })

  it('받은 월수익은 keepOne이 아니다 — 전부 0이면 줄이 없다 (종전대로)', () => {
    const none = [row('KRW', '1000', '0', '0'), row('USD', '1.00', '0.00', '0.00')]
    expect(shownCurrencyRows(none, 'receivedCoupons', { keepOne: false })).toEqual([])
    const usdOnly = [row('KRW', '1000', '0', '0'), row('USD', '1.00', '0.00', '1200.00')]
    expect(currencies(shownCurrencyRows(usdOnly, 'receivedCoupons', { keepOne: false }))).toEqual(['USD'])
  })

  it('★ 순서를 다시 정하지 않는다 — 남기는 첫 줄도 준 순서의 첫째다 (이름으로 원화를 고르는 구현을 잡는다)', () => {
    const reversed = [row('USD', '600.00'), row('KRW', '616000')]
    expect(currencies(shownCurrencyRows(reversed, 'activePrincipal', { keepOne: true }))).toEqual(['USD', 'KRW'])
    const zeros = [row('USD', '0.00'), row('KRW', '0')]
    expect(currencies(shownCurrencyRows(zeros, 'activePrincipal', { keepOne: true }))).toEqual(['USD'])
  })

  it('★ 표기가 줄을 정하지 않는다 — 0의 다른 표기도 0이다 (종전 받은 월수익 거름의 문자열 비교를 잡는다)', () => {
    /*
     * 종전 화면은 `!== '0' && !== '0.00'`로 걸렀다. 오늘 계약은 `moneyString`(고정 자릿수 · 음의 0은 부호 없음 — 실측)이라 그
     * 비교도 같은 답을 내지만, 표기가 줄을 정하면 그 정규화가 사라지는 날 「$0.000」 줄이 선다(`hasFinancialIncomeToReport` 선례)
     */
    for (const zero of ['-0', '-0.00', '0.000', '00']) {
      const rows = [row('KRW', '1000', '0', zero), row('USD', '1.00', '0.00', zero)]
      expect(shownCurrencyRows(rows, 'receivedCoupons', { keepOne: false }), zero).toEqual([])
      const principals = [row('KRW', '5000000'), row('USD', zero)]
      expect(currencies(shownCurrencyRows(principals, 'activePrincipal', { keepOne: true })), zero).toEqual(['KRW'])
    }
  })

  it('원본을 바꾸지 않고 행을 그대로 돌려준다 — 화면이 같은 행의 다른 필드(통화)를 읽는다', () => {
    const rows = [row('KRW', '0'), row('USD', '600.00')]
    const shown = shownCurrencyRows(rows, 'activePrincipal', { keepOne: true })
    expect(shown[0]).toBe(rows[1])
    expect(currencies(rows)).toEqual(['KRW', 'USD'])
  })
})

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

// ---------------------------------------------------------------------------
// ③ — 하한을 확정처럼 적지 않는다 (홈 피드백 컷 K10)
// ---------------------------------------------------------------------------

/**
 * `yearTaxDisplay` — **기대값은 손으로 적은 표다**(함수에서 유도하지 않는다). 축은 넷: C 종합과세 · S 그 해 프로필 저장 ·
 * Z 추가납부 0 · U 환율이 없어 빠진 달러 상품 있음. 표는 DOC-008 SCR-101 「홈 피드백 컷 K0」 ③의 상태 표를 16칸으로 편 것이다.
 *
 * **분리과세에서 추가납부가 0이 아닌 칸(C=F · Z=F)을 지우지 않는다.** 상수가 일관되면 그 경로의 추가납부는 정확히 0이지만
 * (`separateTaxationRate` = 소득세율 × (1 + 지방소득세율)) 그 일관성을 단언하는 테스트가 없다 — 그래서 함수는 판정과 무관하게
 * 계약의 값을 그대로 다루고, 표도 그 칸의 금액이 숨지 않는 것을 본다.
 */
describe('yearTaxDisplay — ③ 추가납부 칸과 펼친 줄 (홈 피드백 컷 K10 · 피드백 #5 · #6)', () => {
  const P: YearTaxLine = 'PROFILE_MISSING'
  const E: YearTaxLine = 'EXCHANGE_RATE_MISSING'
  const N: YearTaxLine = 'ZERO_IS_NORMAL'
  const NONZERO = '1234000'

  type Kind = YearTaxAmount['kind']
  //            C      S      Z      U      추가납부 칸         펼친 줄
  const TABLE: Array<[boolean, boolean, boolean, boolean, Kind, YearTaxLine[]]> = [
    [false, false, false, false, 'AT_LEAST', [P]],
    [false, false, false, true, 'AT_LEAST', [P, E]],
    [false, false, true, false, 'PROFILE_MISSING', [P]],
    [false, false, true, true, 'PROFILE_MISSING', [P, E]],
    [false, true, false, false, 'AMOUNT', []],
    [false, true, false, true, 'AT_LEAST', [E]],
    [false, true, true, false, 'AMOUNT', []],
    [false, true, true, true, 'AMOUNT', [E]],
    [true, false, false, false, 'AT_LEAST', [P]],
    [true, false, false, true, 'AT_LEAST', [P, E]],
    [true, false, true, false, 'PROFILE_MISSING', [P]],
    [true, false, true, true, 'PROFILE_MISSING', [P, E]],
    [true, true, false, false, 'AMOUNT', []],
    [true, true, false, true, 'AT_LEAST', [E]],
    [true, true, true, false, 'AMOUNT', [N]],
    [true, true, true, true, 'AMOUNT', [E]],
  ]

  function input(
    c: boolean,
    s: boolean,
    z: boolean | string,
    u: boolean,
    extra: Partial<Parameters<typeof yearTaxDisplay>[0]> = {},
  ): Parameters<typeof yearTaxDisplay>[0] {
    return {
      isComprehensive: c,
      isProfileSaved: s,
      additionalTax: typeof z === 'string' ? z : z ? '0' : NONZERO,
      unconvertedCount: u ? 2 : 0,
      convertedCount: 0,
      monthlyCouponAssumption: false,
      exchangeRateBasis: null,
      ...extra,
    }
  }

  const BASIS = { rate: '1392.400000', asOfDate: '2026-09-28', isStale: false }
  /** 접는 줄의 갈래 넷 — 월지급 가정 × 환산 포함. 불변식은 16칸 × 이 넷 전부에서 본다 */
  const FOLD_VARIANTS = [
    {},
    { monthlyCouponAssumption: true },
    { convertedCount: 1, exchangeRateBasis: BASIS },
    { monthlyCouponAssumption: true, convertedCount: 1, exchangeRateBasis: BASIS },
  ]

  it('전제 — 표가 16조합을 정확히 한 번씩 덮는다', () => {
    const keys = new Set(TABLE.map(([c, s, z, u]) => `${c}${s}${z}${u}`))
    expect(TABLE).toHaveLength(16)
    expect(keys.size).toBe(16)
  })

  it.each(TABLE)('C=%s S=%s Z=%s U=%s → 칸 %s · 펼침 %j', (c, s, z, u, kind, shown) => {
    const d = yearTaxDisplay(input(c, s, z, u))
    expect(d.verdict).toBe(c ? 'COMPREHENSIVE' : 'SEPARATE')
    expect(d.additionalTax.kind).toBe(kind)
    // 금액은 계약의 문자열 그대로다 — 화면이 `won`으로 적는다
    if (kind !== 'PROFILE_MISSING') expect(d.additionalTax).toEqual({ kind, value: z ? '0' : NONZERO })
    expect(d.shown).toEqual(shown)
    expect(d.folded).toEqual(['ESTIMATE_BASIS'])
  })

  describe('불변식 — 16칸 × 접는 줄 갈래 넷', () => {
    const cases = TABLE.flatMap(([c, s, z, u]) =>
      FOLD_VARIANTS.map((extra) => ({ label: `C=${c} S=${s} Z=${z} U=${u} ${JSON.stringify(extra)}`, s, z, u, d: yearTaxDisplay(input(c, s, z, u, extra)) })),
    )

    it('전제 — 64갈래', () => expect(cases).toHaveLength(64))

    it('★ 프로필이 없으면 추가납부 칸이 맨 금액이 아니다 — 「0원」이 확정처럼 서지 않는다(이번 피드백의 회귀 방지)', () => {
      for (const { label, s, d } of cases) if (!s) expect(d.additionalTax.kind, label).not.toBe('AMOUNT')
    })

    it('하한(프로필 없음 · 환율 빠짐)이면 0이 아닌 금액은 늘 「이상」이 붙는다', () => {
      for (const { label, s, z, u, d } of cases) if ((!s || u) && !z) expect(d.additionalTax.kind, label).toBe('AT_LEAST')
    })

    it('하한 신호 둘과 「0원이 정상」은 접지 않는다 · 적용 차수 가정은 늘 접힌 첫 줄이다', () => {
      for (const { label, d } of cases) {
        for (const line of [P, E, N]) expect(d.folded, label).not.toContain(line)
        expect(d.folded[0], label).toBe('ESTIMATE_BASIS')
        // 같은 줄이 두 자리에 서지 않는다
        expect(new Set([...d.shown, ...d.folded]).size, label).toBe(d.shown.length + d.folded.length)
      }
    })
  })

  it('접는 줄 — 월지급 가정 · 환산 포함은 계약이 준 조건에서만 (적용 차수 가정 뒤 · 그 순서)', () => {
    const base = (extra: Partial<Parameters<typeof yearTaxDisplay>[0]>) => yearTaxDisplay(input(true, true, false, false, extra)).folded
    expect(base({ monthlyCouponAssumption: true })).toEqual(['ESTIMATE_BASIS', 'MONTHLY_COUPON'])
    expect(base({ convertedCount: 2, exchangeRateBasis: BASIS })).toEqual(['ESTIMATE_BASIS', 'CONVERTED'])
    expect(base({ monthlyCouponAssumption: true, convertedCount: 2, exchangeRateBasis: BASIS })).toEqual([
      'ESTIMATE_BASIS',
      'MONTHLY_COUPON',
      'CONVERTED',
    ])
    // 환율이 없으면 그 줄을 쓸 수 없다 · 건수가 0이면 환율이 있어도 줄이 없다(계약의 `≠ null ⇔ convertedCount > 0`의 두 반쪽)
    expect(base({ convertedCount: 2, exchangeRateBasis: null })).toEqual(['ESTIMATE_BASIS'])
    expect(base({ convertedCount: 0, exchangeRateBasis: BASIS })).toEqual(['ESTIMATE_BASIS'])
  })

  it('★ 표기가 칸을 정하지 않는다 — 0의 다른 표기도 0이다(문자열 비교 구현을 잡는다)', () => {
    /*
     * 오늘 이 필드는 `amountString`(`toFixed(0)`)을 지나 늘 정수 표기라 `=== '0'`도 같은 답을 낸다 — 이 케이스는 그
     * 정규화가 사라지는 날의 회귀 방어이고, 없으면 문자열 비교로 되돌리는 음성 대조가 초록이다(`hasFinancialIncomeToReport` 선례)
     */
    for (const zero of ['0.000', '00', '-0', '0.0']) {
      expect(yearTaxDisplay(input(false, false, zero, false)).additionalTax, zero).toEqual({ kind: 'PROFILE_MISSING' })
      const saved = yearTaxDisplay(input(true, true, zero, false))
      expect(saved.additionalTax, zero).toEqual({ kind: 'AMOUNT', value: zero })
      expect(saved.shown, zero).toEqual([N])
      expect(yearTaxDisplay(input(true, true, zero, true)).additionalTax.kind, zero).toBe('AMOUNT')
    }
  })
})

describe('③ 문구 ↔ DOC-008 SCR-101 「홈 피드백 컷 K0」 ③ (살아 있는 글 · 그 각주 하나 · 홈 피드백 컷 K10)', () => {
  /*
   * 문구의 정본은 K0 각주의 ③ 문단이다. 그 각주는 ①부터 ⑥까지 한 인용 블록이므로 ③의 머리에서 잘라 ⑥ 머리 앞에서 끊는다 —
   * 같은 낱말(「추정 기준 보기」 · 「종합과세 대상」)을 §9 SQ-27 · DOC-005가 인용하므로 문서 전체에 걸면 정본에서 지워도 초록이다
   */
  const block = quoteBlock(liveDoc('08_정보구조_및_화면목록.md'), '> **③ 올해 금융소득(본인) — 과세 프로필과 추정 기준')
  const end = block.indexOf('\n> **⑥')
  const section = block.slice(0, end)

  /** 문구 상수 전부 — 중첩(판정 본문)을 펴서 키가 늘어도 결속 밖으로 새지 않게 한다 */
  const TEXTS: Array<[string, string]> = [
    ...Object.entries(TAX_METHOD_VERDICT_LABELS).map(([k, v]): [string, string] => [`판정 제목 ${k}`, v]),
    ...Object.entries(YEAR_TAX_TEXT).flatMap(([k, v]): Array<[string, string]> =>
      typeof v === 'string' ? [[k, v]] : Object.entries(v).map(([k2, v2]): [string, string] => [`${k}.${k2}`, v2]),
    ),
  ]

  it('전제 — ③ 문단만 잘랐다(⑥ 앞에서 끊었다) · 상수 열둘을 다 폈다', () => {
    expect(end, '⑥ 머리를 찾지 못했다 — 블록 끝까지 자르면 ⑥의 인용이 섞인다').toBeGreaterThan(0)
    expect(section).not.toContain('⑥ 상환 확인 필요')
    expect(TEXTS).toHaveLength(12)
  })

  it.each(TEXTS)('%s — 「」째로 있다', (_key, text) => {
    expect(section).toContain(`「${text}」`)
  })

  it('링크의 목적지 — 백틱째 있고 SCR-401 경로의 조각이다', () => {
    expect(TAX_PROFILE_SECTION.href).toBe(`${PATHS.tax}#${TAX_PROFILE_SECTION.id}`)
    expect(section).toContain(`\`${TAX_PROFILE_SECTION.href}\``)
  })

  it('판정 제목은 DOC-005 §9의 권장 표기다 — SCR-401과 같은 이름', () => {
    expect(liveDoc('05_용어_사전.md')).toContain(
      `「${TAX_METHOD_VERDICT_LABELS.COMPREHENSIVE}」 · 「${TAX_METHOD_VERDICT_LABELS.SEPARATE}」 (SCR-101 ③ · SCR-401의 판정 제목)`,
    )
  })
})
