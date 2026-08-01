import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProductListItem } from '@/lib/db/queries/map'
import {
  kiTermLabel,
  lizardLabel,
  paginate,
  PRODUCTS_PER_PAGE,
  stepdownLabel,
} from '@/lib/format'
import {
  filterQuery,
  PAGE_KEY,
  pageQuery,
  parsePage,
  type ProductFilter,
} from '@/lib/forms/query'

/**
 * SCR-201의 표시 구조 — **문서와 계약이 갈리는 것을 여기서 본다** (P6 컷 2)
 *
 * ## 축 둘
 *
 * | 축 | 무엇이 틀렸을 때 실패하는가 |
 * |---|---|
 * | 문서 ↔ 뷰 | 표시 항목이 늘고 그것을 읽는 필드가 없다(또는 반대) |
 * | 표기 | 스텝다운·리자드·KI 문구를 화면이 조립하면 아무도 보지 못한다(AQ-23) |
 *
 * ## 첫째 축이 AQ-35의 두 번째 자리다
 *
 * DOC-010 AQ-35가 「**요소마다 그것을 읽는 필드가 있는가**를 묻는 대조가 SCR-101 한
 * 화면에만 있다」고 등재했다. 이 파일이 SCR-201에 같은 대조를 세운다 —
 * `tests/app/dashboard.test.ts`와 같은 형태이며, 그 파일이 실제로 결함을 냈다
 * (⑤ 최근 상환 실적에 대응하는 필드가 없었고 그 요소는 문서에만 존재했다).
 *
 * 파생으로 만들 수 없다(요소의 한글 이름에서 필드 이름이 나오지 않는다). 값이
 * `keyof ProductListItem`이므로 **필드 개명은 `typecheck`가** 잡고, 키가 문서의
 * 마커 집합과 대조되므로 **항목의 증감은 아래 단언이** 잡는다.
 */

const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')

/**
 * ①~⑦ — 판정의 결과. 억제 규칙(DOC-011 §4.2 D1)의 대상이다.
 *
 * ②는 `ownerName`이 아니라 `ownerId`도 함께 쓰지만, 표시하는 것은 이름 하나다 —
 * 이 표는 「무엇을 렌더하는가」이고 `ownerId`는 필터의 값이다(아래 `NOT_DISPLAYED`).
 */
const JUDGMENT_SOURCES = {
  '①': 'name',
  '②': 'ownerName',
  '③': 'principal',
  '④': 'nextEvaluation',
  '⑤': 'worstOf',
  '⑥': 'conditionResult',
  '⑦': 'kiStatus',
} as const satisfies Record<string, keyof ProductListItem>

/**
 * ⑧~⑫ — 계약 조건. **다섯이 한 필드(`terms`)의 다섯 속성이다.**
 *
 * 값이 `keyof ProductListItem['terms']`인 것이 「목록은 계약 조건 · 상세는 판정」이라는
 * 구분을 이 표에서도 지키는 형태다. ⑩은 배리어와 관찰방식 둘을 표시하지만 그 둘은
 * 함께 있거나 함께 없으므로(I-11) 한 항목이다 — 대표로 `kiBarrier`를 적는다.
 */
const TERM_SOURCES = {
  '⑧': 'underlyings',
  '⑨': 'annualCouponRate',
  '⑩': 'kiBarrier',
  '⑪': 'barriers',
  '⑫': 'lizards',
} as const satisfies Record<string, keyof ProductListItem['terms']>

type Expect<T extends true> = T
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * **표시하지 않는 필드를 명시한다.** 넷 다 이유가 있다 —
 *
 * | 필드 | 왜 표시 항목이 아닌가 |
 * |---|---|
 * | `id` | 링크의 목적지다(①이 그 링크다) |
 * | `ownerId` | 소유자 **필터**의 값이다. 표시는 ②의 이름이다 |
 * | `accountType` | 비과세일 때만 뱃지가 붙는다 — ①의 부속이며 별 항목이 아니다 |
 * | `status` | 상환완료일 때만 뱃지가 붙는다. 같은 이유 |
 * | `integrityIssue` | ⑤의 표시를 **가르는 입력**이다(§4.2 우선순위표) |
 * | `isOwner` | 액션 버튼 노출 판단. SCR-201에는 그 버튼이 없다 |
 * | `terms` | 다섯으로 갈려 `TERM_SOURCES`가 받는다 |
 */
const NOT_DISPLAYED = [
  'id',
  'ownerId',
  'accountType',
  'status',
  'integrityIssue',
  'isOwner',
  'terms',
] as const satisfies ReadonlyArray<keyof ProductListItem>

/**
 * **뷰에 대응 없는 필드가 없다.** 필드가 늘면 `Unmapped`가 `never`를 벗어나 컴파일이
 * 깨지고, 그때 물어야 하는 것은 「그 필드를 어느 항목이 읽는가」다(항목이 없다면
 * DOC-008에 먼저 적는다 — 절대 규칙 #10).
 *
 * 값으로 쓰이지 않는 것이 정상이다(`payload.test.ts`의 머리글과 같은 규약).
 */
type MappedTop =
  | (typeof JUDGMENT_SOURCES)[keyof typeof JUDGMENT_SOURCES]
  | (typeof NOT_DISPLAYED)[number]
type UnmappedTop = Exclude<keyof ProductListItem, MappedTop>
type _NoUnmappedTop = Expect<Equals<UnmappedTop, never>>

type MappedTerm = (typeof TERM_SOURCES)[keyof typeof TERM_SOURCES]
type UnmappedTerm = Exclude<keyof ProductListItem['terms'], MappedTerm>
/** `kiObservation`은 ⑩이 `kiBarrier`와 함께 표시한다 — 그 하나만 예외다 */
type _NoUnmappedTerm = Expect<Equals<UnmappedTerm, 'kiObservation'>>

/** SCR-201 절의 표시 항목 셀. 화면마다 `| 항목 | 내용 |`이 있으므로 절부터 자른다 */
function displayMarkers(row: '판정' | '계약 조건'): string[] {
  const text = readFileSync(DOC_008, 'utf8')
  const at = text.indexOf('### SCR-201 ELS 목록')
  expect(at, 'DOC-008에서 SCR-201 절을 찾지 못했다').toBeGreaterThan(-1)

  const pattern = new RegExp(`^\\| 카드 표시 항목 — ${row} \\|(.+)\\|$`, 'm')
  const found = pattern.exec(text.slice(at))
  expect(found, `SCR-201 절에 「카드 표시 항목 — ${row}」 행이 없다`).not.toBeNull()

  // 마커로 자른다. 번호를 셀 안에서 세는 것이 항목의 정의다.
  return [...found![1]!.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]/g)].map((m) => m[0])
}

describe('DOC-008 §5 SCR-201 표시 항목 ↔ `ProductListItem`', () => {
  it('판정 항목마다 그것을 읽는 필드가 있다', () => {
    expect(displayMarkers('판정')).toEqual(Object.keys(JUDGMENT_SOURCES))
  })

  it('★ 계약 조건 항목마다 그것을 읽는 필드가 있다', () => {
    /*
     * ★ 여섯째 계약 조건을 DOC-008에 적으면 여기가 빨간불이 되어 「무엇이 그것을
     * 읽는가」를 묻는다. 그 물음이 없던 동안 SCR-101의 ⑤가 문서에만 존재했다
     * (`dashboard.test.ts`의 머리글).
     */
    expect(displayMarkers('계약 조건')).toEqual(Object.keys(TERM_SOURCES))
  })

  it('파서가 항목을 찾았다', () => {
    // 0건을 찾고 조용히 통과하는 것이 이 부류 파서의 유일한 위험이다.
    expect(displayMarkers('판정').length).toBe(7)
    expect(displayMarkers('계약 조건').length).toBe(5)
  })

  it('★ 표시하는 필드와 표시하지 않는 필드가 겹치지 않는다', () => {
    /*
     * ★ 타입 수준 단언(`_NoUnmappedTop`)은 **합집합이 전체를 덮는가**만 본다 —
     * 같은 필드가 두 표에 모두 있어도 그것은 통과한다. 그러면 「이 필드는 표시
     * 항목인가」에 두 답이 생기고, 다음 사람이 어느 쪽을 고쳐야 하는지 알 수 없다.
     */
    const displayed = new Set<string>(Object.values(JUDGMENT_SOURCES))
    const overlap = NOT_DISPLAYED.filter((name) => displayed.has(name))
    expect(overlap, '같은 필드가 두 표에 있다').toEqual([])

    // 파서와 같은 이유로 건수를 고정한다 — 0건을 세고 통과하는 것을 막는다
    expect(displayed.size + NOT_DISPLAYED.length).toBe(14)
  })

  it('두 행의 마커가 겹치지 않고 ①~⑫를 채운다', () => {
    /*
     * 겹치면 같은 번호가 두 뜻을 갖고, 빠지면 번호가 뜻하는 순서가 끊긴다. 둘 다
     * 위의 두 단언을 통과하면서 일어날 수 있다 — 각각 자기 행만 보기 때문이다.
     */
    const all = [...displayMarkers('판정'), ...displayMarkers('계약 조건')]
    expect(new Set(all).size, '마커가 겹친다').toBe(all.length)
    expect(all).toEqual([
      '①',
      '②',
      '③',
      '④',
      '⑤',
      '⑥',
      '⑦',
      '⑧',
      '⑨',
      '⑩',
      '⑪',
      '⑫',
    ])
  })
})

// ---------------------------------------------------------------------------
// 표기 — 화면이 조립하면 아무도 보지 못한다 (AQ-23)
// ---------------------------------------------------------------------------

describe('stepdownLabel — 입력 형식과 같은 표기', () => {
  it('`%`를 마지막에 한 번만 붙인다', () => {
    /*
     * SQ-04의 일괄 입력이 `90-85-80-75-70-65`이므로 사용자가 적은 것과 같은 모양으로
     * 되돌려 받는다. 차수마다 `%`를 붙이면 길이가 두 배가 되고 스텝다운의 모양
     * (내려가는 수열)이 기호에 묻힌다.
     */
    expect(
      stepdownLabel([
        '0.9000',
        '0.9000',
        '0.7500',
        '0.7000',
        '0.6500',
        '0.6000',
      ]),
    ).toBe('90-90-75-70-65-60%')
  })

  it('소수 배리어의 자릿수를 잃지 않는다', () => {
    // `numeric(6,4)`이므로 `0.8750` → `87.5`다. `88`로 접으면 값이 바뀐다.
    expect(stepdownLabel(['0.8750', '0.8325'])).toBe('87.5-83.25%')
  })

  it('차수가 0건이면 `null`이다 — 문구를 지어내지 않는다', () => {
    /*
     * 그 상태는 `SCHEDULE_MISSING`(I-07)이고 화면의 무결성 표식이 이미 이유를
     * 말한다. 여기서 「없음」을 만들면 같은 사실을 두 곳이 다르게 부른다.
     */
    expect(stepdownLabel([])).toBeNull()
  })

  it('한 차수도 수열이다', () => {
    expect(stepdownLabel(['0.9000'])).toBe('90%')
  })
})

describe('lizardLabel — 붙은 차수만', () => {
  const base = { roundNo: 2, barrier: '0.6000', requiresNoKi: false }

  it('0건이면 `null`이다 — 「없음」을 적지 않는다', () => {
    /*
     * 목록의 기본값에 라벨을 붙이면 그 라벨이 아무것도 구분하지 않는다 —
     * `ProductRow`가 「보유중」 뱃지를 달지 않는 것과 같은 판단(ST-05).
     */
    expect(lizardLabel([])).toBeNull()
  })

  it('1건은 차수·배리어·쿠폰을 적는다', () => {
    expect(lizardLabel([{ ...base, couponRate: '0.0300' }])).toBe(
      '2차 60% · 쿠폰 3%',
    )
  })

  it('★ 쿠폰율 0은 원금상환형이다 — 「쿠폰 0%」가 아니다', () => {
    // Q-04. `0`은 값이고(빈 칸이 아니다) SCR-202의 차수표와 같은 말을 쓴다.
    expect(lizardLabel([{ ...base, couponRate: '0.0000' }])).toBe(
      '2차 60% · 원금상환형',
    )
  })

  it('★ 쿠폰율 미입력과 원금상환형을 가른다', () => {
    /*
     * ★ I-10이 그 조합을 막으므로 도달하지 않지만 타입이 `null`을 허용한다. 없는
     * 값을 `0%`로 적으면 **원금상환형과 구별되지 않는다** — 그쪽은 값이 0인 것이고
     * 이쪽은 값이 없는 것이다.
     */
    expect(lizardLabel([{ ...base, couponRate: null }])).toBe(
      '2차 60% · 쿠폰율 미입력',
    )
  })

  it('KI 미터치 요구를 덧붙인다', () => {
    expect(
      lizardLabel([{ ...base, couponRate: '0.0300', requiresNoKi: true }]),
    ).toBe('2차 60% · 쿠폰 3% · KI 미터치')
  })

  it('★ 2건 이상은 차수만 적는다', () => {
    /*
     * 차수마다 값이 다를 수 있어 나열하면 한 줄이 두 줄이 된다. 그때 필요한 것은
     * 「어느 차수에 있는가」이고 값은 상세의 차수표가 보여준다.
     */
    expect(
      lizardLabel([
        { ...base, couponRate: '0.0300' },
        { roundNo: 4, barrier: '0.5500', couponRate: '0.0250', requiresNoKi: true },
      ]),
    ).toBe('2·4차')
  })
})

describe('kiTermLabel — `null`이 노낙인이다', () => {
  it('배리어가 없으면 노낙인이다', () => {
    // I-11 — 배리어와 관찰방식은 함께 있거나 함께 없다.
    expect(kiTermLabel(null, null)).toBe('노낙인')
  })

  it('배리어와 관찰방식을 함께 적는다', () => {
    expect(kiTermLabel('0.5000', '종가')).toBe('50% 종가')
  })

  it('★ 관찰방식이 없으면 지어내지 않는다', () => {
    /*
     * 도달하지 않는 조합이지만(I-11) 기본값으로 「종가」를 그리면 **없는 조건을
     * 있는 것처럼** 보여준다. 배리어만 적는 것이 그 상태의 정직한 표시다.
     */
    expect(kiTermLabel('0.5000', null)).toBe('50%')
  })
})

// ---------------------------------------------------------------------------
// 페이지 나눔 — DOC-008 §5 SCR-201 v2.0
// ---------------------------------------------------------------------------

describe('paginate — 거른 뒤의 목록을 자른다', () => {
  const of = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

  it('10건까지는 한 페이지다 — 요구가 「10개가 넘어가면」이다', () => {
    const paged = paginate(of(10), 1)
    expect(paged.items).toHaveLength(10)
    expect(paged.pageCount).toBe(1)
    expect(paged.total).toBe(10)
  })

  it('11건이면 두 페이지이고 마지막이 1건이다', () => {
    expect(paginate(of(11), 1).items).toHaveLength(10)
    const second = paginate(of(11), 2)
    expect(second.items).toEqual([11])
    expect(second.pageCount).toBe(2)
    // 건수는 자르기 **전**의 전체다 — 화면이 「N건」을 그것으로 말한다
    expect(second.total).toBe(11)
  })

  it('★ 범위 밖 페이지를 마지막으로 clamp한다 — 자르지 않는다', () => {
    /*
     * ★ 그대로 자르면 빈 배열이 되고 화면은 그 상태를 「조건에 맞는 상품이 없다」로
     * 렌더한다 — **상품은 있는데** 그렇게 보이므로 §6의 빈 상태 두 갈래가 오염된다
     * (그 둘의 구분은 「필터를 걸었는가」이고 「페이지를 잘못 짚었는가」가 아니다).
     */
    const paged = paginate(of(11), 99)
    expect(paged.page).toBe(2)
    expect(paged.items).toEqual([11])
    expect(paged.items).not.toEqual([])
  })

  it('인식하지 못한 페이지는 1이다 — 조작된 링크가 화면을 막지 않는다', () => {
    for (const bad of [0, -3, Number.NaN, 1.5]) {
      const paged = paginate(of(25), bad)
      expect(paged.page, String(bad)).toBe(1)
      expect(paged.items[0], String(bad)).toBe(1)
    }
  })

  it('0건에서 pageCount가 1이다 — 「0페이지 중 0페이지」를 만들지 않는다', () => {
    const paged = paginate([], 1)
    expect(paged).toEqual({ items: [], page: 1, pageCount: 1, total: 0 })
  })

  it('★ 페이지를 이어 붙이면 원본이다 — 빠지거나 겹치는 항목이 없다', () => {
    /*
     * ★ off-by-one은 「한 항목이 두 페이지에 나온다」 또는 「한 항목이 어느 페이지에도
     * 없다」로 나타나고, 둘 다 페이지를 하나씩 볼 때는 정상으로 보인다. 이어 붙여
     * 대조하는 것이 그것을 잡는 유일한 형태다.
     */
    const source = of(37)
    const { pageCount } = paginate(source, 1)
    expect(pageCount).toBe(4)

    const joined = Array.from({ length: pageCount }, (_, i) =>
      paginate(source, i + 1).items,
    ).flat()
    expect(joined).toEqual(source)
  })

  it('페이지 크기를 인자로 받는다 — 상수에 묶이지 않는다', () => {
    expect(paginate(of(5), 2, 2).items).toEqual([3, 4])
    expect(PRODUCTS_PER_PAGE).toBe(10)
  })
})

describe('주소의 페이지 축 — 필터와 분리되어 있다', () => {
  const BASE: ProductFilter = {
    ownerId: null,
    status: null,
    kiStatus: null,
    sortBy: 'EVALUATION_DATE',
  }

  it('인식하지 못한 값은 1페이지다', () => {
    for (const raw of ['', '0', '-2', 'abc', '1.5', undefined]) {
      expect(parsePage({ [PAGE_KEY]: raw }), String(raw)).toBe(1)
    }
    expect(parsePage({})).toBe(1)
  })

  it('★ 배열은 첫 값을 쓰지 않고 버린다 — `one()`의 규약을 그대로 따른다', () => {
    /*
     * ★ `?page=3&page=9`는 폼이 만들 수 없는 형태이므로 조작된 주소다. 어느 쪽을
     * 골라도 **사용자가 고르지 않은 하나를 우리가 고르는 것**이라 버린다(`one()`의
     * 각주). 초안에서 「첫 값을 본다」로 단언했다가 이 규약에 걸렸다 — 새 축이 기존
     * 규약을 따르는지가 여기서 확인된다.
     */
    expect(parsePage({ [PAGE_KEY]: ['3', '9'] })).toBe(1)
    // 음성 대조 — 단일 값은 읽는다(무조건 1을 내는 것이 아니다)
    expect(parsePage({ [PAGE_KEY]: '3' })).toBe(3)
  })

  it('1페이지는 주소에 싣지 않는다', () => {
    expect(pageQuery(BASE, 1)).toBe('')
    expect(pageQuery(BASE, 2)).toBe(`?${PAGE_KEY}=2`)
  })

  it('★ 페이지 링크가 현재 필터를 그대로 싣는다', () => {
    const narrowed: ProductFilter = { ...BASE, status: 'ACTIVE', sortBy: 'PRINCIPAL' }
    const query = pageQuery(narrowed, 3)
    expect(query).toContain('status=ACTIVE')
    expect(query).toContain('sortBy=PRINCIPAL')
    expect(query).toContain(`${PAGE_KEY}=3`)
    // `filterQuery`를 재사용하므로 `?`가 하나다
    expect(query.match(/\?/g)).toHaveLength(1)
  })

  it('★★ 필터 질의에는 페이지가 없다 — 초기화가 규율이 아니라 구조다', () => {
    /*
     * ★★ 이 단언이 「필터를 바꾸면 1페이지로 돌아간다」의 근거다. 필터·정렬 폼은
     * `<form method="GET">`이고 그 안에 `page` 칸이 없으므로 제출하면 주소에 그 키가
     * 실리지 않는다 — `filterQuery`가 그것을 만들지 않는 것이 같은 사실의 다른 면이다.
     *
     * `page`를 `ProductFilter`에 넣었다면 여기가 빨간불이 되고, 그때 실제로 깨지는
     * 것은 「3페이지를 보다가 필터를 좁히면 상품이 있는데 빈 화면」이다.
     */
    const query = filterQuery({ ...BASE, status: 'REDEEMED' })
    expect(query).not.toContain(PAGE_KEY)
    // 음성 대조 — 다른 축은 실린다(질의 자체가 비어 있어서 통과하는 것이 아니다)
    expect(query).toContain('status=REDEEMED')
  })
})
