import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ScheduleItem, ScheduleProceeds } from '@/lib/db/queries/map'

/**
 * SCR-301 항목 표시 ↔ `ScheduleItem` — 마커 전수 대조 (P8 컷 1 계기)
 *
 * DOC-008 v2.2가 「마커 ①~⑭는 두 행에 걸쳐 겹치지 않으며, 그것이 `keyof ScheduleItem`과의
 * 전수 대조를 가능하게 한다」고 적었는데 **그 대조를 하는 테스트가 없었다.** 있던 것은
 * `schedule.test.ts`의 사실 증인(`ScheduleItem extends ScheduleProductFacts`) 하나이고, 그것은
 * 「순수 함수가 읽는 필드가 계약에 있다」만 본다 — 문서의 마커도, 계약의 나머지 필드도
 * 보지 않는다. 그래서 P8이 ⑮(월수익 평가일 하위 목록)·⑯(월수익 행 종류)를 문서에 적거나
 * `ScheduleItem`에 통화·지급방식 필드를 더해도 **전부 초록인 채로** 들어온다 — CLAUDE.md
 * 절대 규칙 #6의 「객체 종류가 늘어날 때 기존 열거가 따라오지 않는다」가 이 화면에서 그대로다.
 *
 * `dashboard.test.ts`(SCR-101)·`forecast.test.ts`(SCR-402)와 같은 자리이며 DOC-010 AQ-35의
 * 네 번째 자리다. 두 방향을 서로 다른 층이 잡는다.
 *
 * - **문서 → 대응표**: 마커의 증감·순서·겹침·라벨·자리를 아래 단언이 잡는다(런타임).
 * - **대응표 → 계약**: 없는 필드를 가리키면, 계약 필드가 대응표에도 `UNMARKED`에도 없으면,
 *   둘 다에 있으면 **`typecheck`가** 잡는다(`satisfies`).
 *
 * ## 한 단계 더 내려가는 곳이 `proceeds` 하나인 이유
 *
 * ⑫⑬⑭ 셋이 **같은 필드** `proceeds`를 읽는다. 마커 → 키로만 대응시키면 셋의 짝이 서로
 * 바뀌어도, `ScheduleProceeds`에 원화 환산 같은 필드가 늘어도 이 대조가 **가르지 못한다** —
 * 셋 다 `'proceeds'`이기 때문이다. 그래서 그 셋에만 하위 키를 달고 `ScheduleProceeds`에
 * 같은 전수 원장을 둔다. ⑨ `underlyings`는 마커 하나가 필드 하나라 키 수준에서 이미 갈린다
 * (`UnderlyingLine`은 SCR-201과 공유하는 표시 타입이다 — 그 내부는 이 대조의 몫이 아니다).
 *
 * ## 이 파일이 보지 않는 것
 *
 * **렌더러.** 대조는 「문서 ↔ 계약 타입」이고 컴포넌트가 그 필드를 실제로 어디에 그리는지는
 * 보지 않는다(⑪의 주석이 그 층에서 갈린 한 자리다).
 */

const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')
const SECTION = '### SCR-301 평가일정'

// ---------------------------------------------------------------------------
// 마커 → 계약 필드
// ---------------------------------------------------------------------------

type Field = keyof ScheduleItem

/**
 * 마커 하나의 자료원. `fields`가 **비어 있을 수 없다** — 읽는 필드가 없는 마커는 문서에만
 * 존재하는 요소이고, 그것이 DOC-011 §8.1의 일곱째 사례(SCR-301에 다섯 값이 계약에 없었다)다.
 *
 * `proceeds` 하위 키는 `fields`가 정확히 `['proceeds']`일 때만 달 수 있고 그때는 **반드시**
 * 단다 — 첫 갈래가 `proceeds` 필드를 받지 않으므로 하위 키 없이 `proceeds`를 가리킬 수
 * 없고, 그 갈래의 `proceeds?: never`가 반대 방향(다른 필드에 하위 키)을 막는다.
 */
type OtherField = Exclude<Field, 'proceeds'>
type Source =
  | {
      where: string
      label: string
      fields: readonly [OtherField, ...OtherField[]]
      proceeds?: never
    }
  | {
      where: string
      label: string
      fields: readonly ['proceeds']
      proceeds: keyof ScheduleProceeds
    }

/**
 * **사람이 읽고 동의한 대응표다** — `dashboard.test.ts`의 `ELEMENT_SOURCES`와 같은 자리.
 *
 * `where`는 문서의 행 이름이다(`항목 표시 — 공통`이면 `공통`, 상품별 행은 `/`로 갈린
 * 조각의 머리말까지 붙인다). 마커가 카드 머리와 차수 행 사이를 옮겨 가면 뜻이 바뀌므로
 * (상품 단위 값 ↔ 차수 단위 값) 라벨과 함께 대조한다.
 */
const ELEMENT_SOURCES = {
  '①': { where: '공통', label: '평가일', fields: ['evaluationDate'] },
  '②': { where: '공통', label: '상품명', fields: ['productName'] },
  '③': { where: '공통', label: '차수', fields: ['roundNo'] },
  '④': { where: '공통', label: '배리어', fields: ['barrier'] },
  '⑤': { where: '공통', label: '현재 워스트오브', fields: ['worstOf'] },
  '⑥': { where: '공통', label: '예상 충족 여부', fields: ['conditionResult'] },
  '⑦': { where: '상품별 보기 · 카드 머리', label: '투자원금', fields: ['principal'] },
  '⑧': { where: '상품별 보기 · 카드 머리', label: '연쿠폰율', fields: ['annualCouponRate'] },
  '⑨': {
    where: '상품별 보기 · 카드 머리',
    label: '기초자산·기준가·현재가·비율',
    fields: ['underlyings'],
  },
  '⑩': {
    where: '상품별 보기 · 카드 머리',
    label: 'KI 배리어·관찰방식',
    fields: ['kiBarrier', 'kiObservation'],
  },
  /*
   * 문서는 ⑪을 상품별 차수 행에만 두고 「⑦~⑭가 상품별에만 있는 것은 결정」이라 적는데,
   * 시간순 보기(`ScheduleRow`)도 ① 옆에 D-Day를 렌더한다 — 문서의 배치와 렌더러가 갈린
   * 자리다(P8 컷 1에서 발견). 이 파일은 렌더러를 보지 않으므로 문서 쪽 배치를 적는다.
   */
  '⑪': { where: '상품별 보기 · 차수 행', label: 'D-Day', fields: ['dDay'] },
  '⑫': {
    where: '상품별 보기 · 차수 행',
    label: '예상 수령액',
    fields: ['proceeds'],
    proceeds: 'expectedGross',
  },
  '⑬': {
    where: '상품별 보기 · 차수 행',
    label: '세후 예상 수령액',
    fields: ['proceeds'],
    proceeds: 'expectedNet',
  },
  '⑭': {
    where: '상품별 보기 · 차수 행',
    label: '예상 손익',
    fields: ['proceeds'],
    proceeds: 'expectedPnl',
  },
} as const satisfies Record<string, Source>

type Entry = (typeof ELEMENT_SOURCES)[keyof typeof ELEMENT_SOURCES]
type Mapped = Entry['fields'][number]
type MappedProceeds = Extract<Entry, { proceeds: string }>['proceeds']

// ---------------------------------------------------------------------------
// 마커 없는 필드 — 계약 → 대응표의 역방향
// ---------------------------------------------------------------------------

/**
 * 마커를 갖지 않는 필드의 부류. **「표시되지 않는다」와 「마커 없이 표시된다」를 가른다** —
 * 한 이름(`NOT_DISPLAYED`)으로 묶으면 상환완료 뱃지(`status`)가 「표시되지 않는 필드」로
 * 원장에 적히는데 그것은 거짓이다.
 *
 * - `NOT_DISPLAYED` — 값으로 렌더되지 않는다(링크 대상·묶는 키·다른 값의 입력).
 * - `PROSE` — 표시되지만 마커가 아니라 SCR-301 절의 **본문 규약**이 정한다. `anchor`가 그
 *   절에 실재함을 아래 케이스가 단언한다 — 제외의 근거를 주석으로만 두면 그 근거가 문서에서
 *   사라져도 조용하다(`forecast.test.ts`의 「표 밖 표식」과 같은 규율).
 * - `UNREGISTERED` — **표시되는데 SCR-301 절에 근거가 없다.** 결정이 아니라 발견된 공백이며
 *   비어 있는 것이 정상이다. 여기 두는 것은 침묵이 아니라 등재 대기다.
 */
type Unmarked =
  | { kind: 'NOT_DISPLAYED'; reason: string }
  | { kind: 'PROSE'; anchor: string; reason: string }
  | { kind: 'UNREGISTERED'; reason: string }

/**
 * `Record<Exclude<keyof ScheduleItem, Mapped>, …>`이므로 **필드가 늘면 여기가 컴파일에서
 * 깨진다** — 그때 물어야 하는 것은 「그 필드를 어느 마커가 읽는가」이고, 마커가 없다면
 * DOC-008에 먼저 적는다(절대 규칙 #10). 대응표에 있는 필드를 여기 또 적어도 초과 속성으로 깨진다.
 */
const UNMARKED = {
  productId: {
    kind: 'NOT_DISPLAYED',
    reason: '링크 대상(§7 「항목 선택」 → SCR-202)이자 상품별 묶음의 키다',
  },
  ownerId: {
    kind: 'NOT_DISPLAYED',
    reason: '소유자 필터 선택지의 값이다(`schedule/page.tsx`의 `ownersOf`)',
  },
  ownerName: {
    kind: 'UNREGISTERED',
    reason:
      '두 보기 모두 상품명 아래에 적는다(`ScheduleRow`·`ProductScheduleCard`) — 소유자 선택지의 라벨이기도 하다. 항목 표시에 마커가 없고 SCR-301 절에 그 표시의 근거가 없다',
  },
  hasLizard: {
    kind: 'PROSE',
    anchor: '리자드가 붙은 차수는',
    reason: '차수 옆의 「리자드」 표식 — 상품별 카드 규약 3',
  },
  status: {
    kind: 'PROSE',
    anchor: '행에 `상환완료` 표식을 붙인다',
    reason: '상환완료 뱃지. 값이 아니라 표식이다(E-05 단)',
  },
  integrityIssue: {
    kind: 'PROSE',
    anchor: '§4.2 우선순위표',
    reason: '`deriveDisplay`의 입력 — 판정 자리에 「기초자산 없음」 표식으로 선다(우선순위표 1단)',
  },
  isPast: {
    kind: 'PROSE',
    anchor: '`isPast`',
    reason: '구획(지난 / 다가오는)과 상품별 카드의 접기를 가른다. 값으로 렌더되지 않는다',
  },
  accountType: {
    kind: 'UNREGISTERED',
    reason:
      '상품별 카드 머리에 「비과세」 뱃지로 선다(`ProductScheduleCard`). 항목 표시에 마커가 없고 SCR-301 절에 그 표시의 근거가 없다',
  },
  totalRounds: {
    kind: 'PROSE',
    anchor: '`totalRounds`',
    reason: '기간 필터가 차수를 잘랐을 때만 카드 머리의 「전체 N차수 중 M차수」',
  },
} as const satisfies Record<Exclude<Field, Mapped>, Unmarked>

/** ⑫⑬⑭가 나눠 읽는 `proceeds`의 나머지 — 위와 같은 규약, 한 단계 아래 */
const UNMARKED_PROCEEDS = {
  expectedWithholding: {
    kind: 'NOT_DISPLAYED',
    reason: '⑬의 입력이다(세후 = 세전 − 예상 원천징수, 잔차). 화면은 뺄셈의 결과만 적는다',
  },
  separateTaxationRate: {
    kind: 'PROSE',
    anchor: '비율은 화면이 적지 않고 계약이 준 값을 렌더한다',
    reason: '목록에 한 번 적는 세후 고지의 세율 — 상품별 카드 규약 2',
  },
  taxLawYear: {
    kind: 'PROSE',
    anchor: '적용 세율의 연도가 기준일의 연도와 다르면',
    reason: '같은 고지의 근사 문구 — 상품별 카드 규약 2',
  },
} as const satisfies Record<Exclude<keyof ScheduleProceeds, MappedProceeds>, Unmarked>

// ---------------------------------------------------------------------------
// 문서 파싱
// ---------------------------------------------------------------------------

/**
 * 원문자 마커. **①~⑳에 ㉑~㉟까지 연다** — `forecast.test.ts`는 ⑫까지로 좁혔는데, 여기서
 * 좁히면 P8이 적을 ⑮·⑯이 파서에 **보이지 않아** 대조가 초록인 채로 새 요소를 흘린다.
 * 이 계기가 막으려는 형태가 정확히 그것이다.
 */
const MARKER_CLASS = '\\u2460-\\u2473\\u3251-\\u325f'
const MARKER = new RegExp(`[${MARKER_CLASS}]`, 'u')
const MARKER_WITH_LABEL = new RegExp(`([${MARKER_CLASS}])([^${MARKER_CLASS}]*)`, 'gu')

type DocElement = { marker: string; where: string; label: string }

/** SCR-301 절 — 다음 `### `까지. 절 밖의 마커(다른 화면)를 세지 않는다 */
function scr301(text = readFileSync(DOC_008, 'utf8')): string {
  const at = text.indexOf(SECTION)
  expect(at, 'DOC-008에서 SCR-301 절을 찾지 못했다').toBeGreaterThan(-1)
  const next = text.indexOf('\n### ', at + SECTION.length)
  return text.slice(at, next === -1 ? undefined : next)
}

/** 절의 첫 표(`| 항목 | 내용 |`) — 행 이름과 무관하게 전부 */
function firstTable(section: string): string[] {
  const lines = section.split('\n')
  const start = lines.findIndex((line) => line.startsWith('| 항목 |'))
  expect(start, 'SCR-301 절에 `| 항목 | 내용 |` 표가 없다').toBeGreaterThan(-1)
  const end = lines.findIndex((line, i) => i > start && !line.startsWith('|'))
  return lines.slice(start, end === -1 ? undefined : end)
}

/**
 * `| 항목 표시 — {행} | … |` 행들을 마커 단위로 편다.
 *
 * 셀을 `/`로 조각내고 조각의 머리말(첫 마커 앞)을 자리 이름에 붙인다. **마커 없는 조각은
 * 실패로 둔다** — 마커 없이 적힌 요소는 이 대조에서 보이지 않으므로, 건너뛰면 그것이 곧
 * 신호 없는 누락이다.
 */
function documentedElements(section = scr301()): DocElement[] {
  const rows = [...section.matchAll(/^\| 항목 표시(?: — ([^|]*?))? \|(.*)\|$/gm)]
  expect(rows.length, 'SCR-301 절에 「항목 표시」 행이 없다').toBeGreaterThan(0)

  const out: DocElement[] = []
  for (const row of rows) {
    const name = (row[1] ?? '').trim()
    for (const segment of row[2]!.split('/')) {
      const first = segment.search(MARKER)
      expect(first, `「항목 표시 — ${name}」에 마커 없는 조각이 있다: ${segment.trim()}`)
        .toBeGreaterThan(-1)
      const prefix = segment.slice(0, first).trim()
      const where = prefix === '' ? name : `${name} · ${prefix}`
      for (const m of segment.slice(first).matchAll(MARKER_WITH_LABEL)) {
        out.push({ marker: m[1]!, where, label: m[2]!.trim() })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------

describe('DOC-008 §5 SCR-301 항목 표시 ↔ `ScheduleItem`', () => {
  it('표의 마커는 전부 「항목 표시」 행에 있다 — 다른 행의 마커는 대조 밖으로 샌다', () => {
    /*
     * 파서가 「항목 표시」 행만 읽으므로, 마커를 「주요 요소」나 새 이름의 행에 적으면
     * 아래 대조가 그것을 **보지 못하고** 초록으로 남는다. 표 전체의 마커 열이 파서가 편
     * 열과 같아야 그 누수가 없다.
     */
    const inTable = firstTable(scr301()).flatMap((line) =>
      [...line.matchAll(new RegExp(MARKER.source, 'gu'))].map((m) => m[0]),
    )

    expect(inTable).toEqual(documentedElements().map((e) => e.marker))
  })

  it('마커마다 그것을 읽는 필드가 있다 — 증감·순서·겹침', () => {
    /*
     * ★ **이 단언이 v2.2의 주장을 처음으로 기계에 옮긴다.** 순서 있는 열로 비교하므로
     * 두 행에 걸친 마커 겹침(v2.2가 전수 대조의 조건으로 든 성질)도 여기서 깨진다 —
     * 같은 마커가 두 번 나오면 열의 길이부터 다르다. P8이 ⑮·⑯을 적으면 여기가 빨간불이
     * 되어 「무엇이 그것을 읽는가」를 묻는다.
     */
    expect(documentedElements().map((e) => e.marker)).toEqual(Object.keys(ELEMENT_SOURCES))
  })

  it('★ 마커가 그 라벨·그 자리에 붙어 있다 — 순열에 불변인 대조를 만들지 않는다', () => {
    /*
     * 위 케이스는 마커 **집합**만 본다. 문서에서 ⑫와 ⑬의 라벨을 맞바꾸거나 ⑩을 차수 행으로
     * 옮겨도 마커 열은 그대로이므로 초록으로 남는다 — P4 종료 대조 §5.1 ④가 SCR-402에서
     * 지목한 형태다(`forecast.test.ts`). 짝을 뽑아 대조하면 그 순열과 이동이 잡힌다.
     */
    const documented = Object.fromEntries(
      documentedElements().map(({ marker, where, label }) => [marker, { where, label }]),
    )
    const expected = Object.fromEntries(
      Object.entries(ELEMENT_SOURCES).map(([marker, { where, label }]) => [
        marker,
        { where, label },
      ]),
    )

    expect(documented).toEqual(expected)
  })

  it('마커 없이 표시되는 필드의 근거가 SCR-301 절에 실재한다', () => {
    /*
     * `PROSE`로 적은 제외는 그 문장이 문서에 있어야 제외다. 문장이 지워지거나 다시 쓰이면
     * 그 필드는 「어느 마커도 어느 규약도 읽지 않는 필드」가 되는데, 타입 쪽 원장은 여전히
     * 초록이다 — 그 상실을 여기서 드러낸다.
     */
    const section = scr301()
    const missing = [
      ...Object.entries(UNMARKED),
      ...Object.entries(UNMARKED_PROCEEDS).map(([k, v]) => [`proceeds.${k}`, v] as const),
    ]
      .filter(([, v]) => v.kind === 'PROSE')
      .map(([field, v]) => [field, (v as { anchor: string }).anchor] as const)
      .filter(([, anchor]) => !section.includes(anchor))

    expect(missing).toEqual([])
  })
})
