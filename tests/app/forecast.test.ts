import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ForecastRow } from '@/lib/db/queries/forecast'
import { isForecastEmpty } from '@/lib/format/forecast'

/**
 * SCR-402의 표시 구조 — 다년도 전망 (P4b 컷 8의 선행, 컷 7이 만든다)
 *
 * ## 이 파일이 AQ-35가 등재한 공백의 **두 번째 자리**다
 *
 * 「DOC-008 §5의 주요 요소 ↔ 뷰 필드」 대조는 컷 9까지 SCR-101 하나에만 있었고, AQ-35가
 * 「나머지 아홉 화면이 옳다고 볼 근거는 사람의 기억뿐」으로 그 공백을 등재했다. **그
 * 공백의 값이 이 화면에서 이미 실증되었다**: DOC-008 §5 SCR-402의 요소 셀이 v1.2까지
 * 마커 없는 **아홉 개** 나열이었고 「총자산」은 각주에만 있었다 — 즉 열 목록과 계약 필드가
 * 갈려 있었고 그것을 보는 층이 없었다. v1.3이 ①~⑫로 정본화했으므로 여기서 기계적으로 닫는다.
 *
 * ## 빈 상태 판정을 화면에서 뗀 이유
 *
 * §4.7이 상품 0건에서도 `years`개 행을 반환한다(§8.1의 E 부류를 재현하지 않기 위해).
 * 그러면 「전망할 데이터 없음」(DOC-008 §6)의 판정이 필요해지고, 그 조건이 화면의 삼항에
 * 남으면 어느 스위트도 보지 못한다(AQ-23).
 */

const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')

// ---------------------------------------------------------------------------
// 요소 ↔ 계약 필드
// ---------------------------------------------------------------------------

/**
 * **사람이 읽고 동의한 대응표다** — `dashboard.test.ts`의 `ELEMENT_SOURCES`와 같은 자리.
 *
 * 파생으로 만들 수 없다(요소의 한글 이름에서 필드 이름이 나오지 않는다). 값이
 * `keyof ForecastRow`이므로 **필드 개명은 `typecheck`가** 잡고, 키가 문서의 마커 집합과
 * 대조되므로 **요소의 증감은 아래 단언이** 잡는다.
 *
 * 개명 둘이 이 표에 박혀 있다(DOC-011 §4.7 v2.4) — ⑧은 `healthInsurance`가 아니라
 * `totalInsurance`이고(「건강보험료」는 장기요양을 포함하지 않는다 — 절대 규칙 #9)
 * ⑪은 `totalAssets`가 아니라 `cumulativeAssets`다(「총자산」은 정의가 없는 말이고
 * SCR-101 ②의 「총 자산 요약」과 다른 값이다).
 */
const ELEMENT_SOURCES = {
  '①': { label: '연도', field: 'year' },
  '②': { label: '세전 회수', field: 'grossProceeds' },
  '③': { label: '그 해 금융소득', field: 'financialIncome' },
  '④': { label: '종합과세 기준 대비', field: 'thresholdGap' },
  '⑤': { label: '종합과세 여부', field: 'isComprehensive' },
  '⑥': { label: '최종 부담률', field: 'effectiveRate' },
  '⑦': { label: '추가납부', field: 'additionalTax' },
  '⑧': { label: '보험료 합계', field: 'totalInsurance' },
  '⑨': { label: '세후 회수', field: 'netProceeds' },
  '⑩': { label: '누적 세후 회수', field: 'cumulativeNet' },
  '⑪': { label: '누적 자산', field: 'cumulativeAssets' },
  '⑫': { label: '잔여 원금', field: 'remainingPrincipal' },
} as const satisfies Record<string, { label: string; field: keyof ForecastRow }>

type Expect<T extends true> = T
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * **계약에 대응 없는 필드가 없다.** 위 표는 「요소 → 필드」이고 이 별칭은 그 역을 본다.
 *
 * 셋을 의도적으로 제외한다 — `taxLawYear`·`profileYear`·`hasEstimates`는 열이 아니라
 * **표 밖 표식**이며 DOC-008 §5가 그것을 별 행(`| 표 밖 표식 |`)으로 규정한다. 아래
 * 케이스가 그 행의 존재를 함께 단언하므로, 이 셋을 「대응 없음」으로 두는 것이 침묵이
 * 아니다. 넷째가 생기면 여기가 컴파일에서 깨지고 그때 물어야 하는 것은 「그것이 열인가
 * 표 밖 표식인가」다.
 */
type Mapped = (typeof ELEMENT_SOURCES)[keyof typeof ELEMENT_SOURCES]['field']
type OutsideTable = 'taxLawYear' | 'profileYear' | 'hasEstimates'
type Unmapped = Exclude<keyof ForecastRow, Mapped | OutsideTable>
type _NoUnmappedField = Expect<Equals<Unmapped, never>>

/** SCR-402 절의 「주요 요소」 셀 — 마커와 **그 뒤의 라벨**을 짝지어 뽑는다 */
function mainElementPairs(): Array<[marker: string, label: string]> {
  const text = readFileSync(DOC_008, 'utf8')
  const at = text.indexOf('### SCR-402 다년도 전망')
  expect(at, 'DOC-008에서 SCR-402 절을 찾지 못했다').toBeGreaterThan(-1)

  const row = /^\| 주요 요소 \|(.+)\|$/m.exec(text.slice(at))
  expect(row, 'SCR-402 절에 「주요 요소」 행이 없다').not.toBeNull()

  // ①~⑫는 U+2460~U+246B 연속이므로 범위로 적는다(SCR-101은 ⑨까지였다).
  // 라벨은 다음 마커 또는 셀 끝까지다.
  return [...row![1]!.matchAll(/([①-⑫])\s*([^①-⑫|]*)/g)].map((m) => [
    m[1]!,
    m[2]!.trim(),
  ])
}

function mainElements(): string[] {
  return mainElementPairs().map(([marker]) => marker)
}

describe('DOC-008 §5 주요 요소 ↔ `ForecastRow`', () => {
  it('요소 열둘마다 그것을 읽는 필드가 있다', () => {
    /*
     * ★ **이 단언이 AQ-35의 공백을 이 화면에 대해 닫는다.** v1.2의 셀은 아홉 개였고
     * 「총자산」이 각주에만 있었다 — 열 하나가 문서 본문에 없는 채로 계약이 그것을 담을
     * 예정이었다. 열셋째를 DOC-008에 적으면 여기가 빨간불이 되어 「무엇이 그것을
     * 읽는가」를 묻는다.
     */
    expect(mainElements()).toEqual(Object.keys(ELEMENT_SOURCES))
  })

  it('★ 마커가 **그 라벨**에 붙어 있다 — 순열에 불변인 대조를 만들지 않는다', () => {
    /*
     * ★ **여기 「파서가 요소를 열둘 찾았다」를 두지 않는 이유를 적어 둔다.** 그 단언은
     * 위 `toEqual`에 **완전히 함축된다** — 12개 키의 목록과 같으면 길이도 12다. 즉
     * 탐지력이 0이고, 초록색 하나가 늘어난 만큼 원장이 더 검증된 것처럼 보인다. SCR-101의
     * 같은 자리(`dashboard.test.ts`)가 그 형태이며 P4.5가 Q-06에서 같은 부류를 잡았다.
     *
     * 대신 그 자리를 **실제로 검증되지 않던 성질**에 쓴다. P4 종료 대조 §5.1 ④가 지목한
     * 것이 정확히 이것이다: 「문서에서 ②와 ③의 문구를 맞바꾸면 그대로 통과한다」 —
     * 마커 집합만 비교하면 마커와 라벨의 **짝짓기**는 사람의 기억에 남는다. 짝을 뽑아
     * 대조하면 그 순열이 잡힌다.
     *
     * 실측으로 확인했다 — 문서에서 ⑧·⑪의 라벨을 맞바꾸면 이 케이스가 빨간불이 되고
     * 위 `toEqual`은 초록으로 남는다.
     */
    const documented = Object.fromEntries(mainElementPairs())
    const expected = Object.fromEntries(
      Object.entries(ELEMENT_SOURCES).map(([marker, { label }]) => [marker, label]),
    )

    expect(documented).toEqual(expected)
  })

  it('표 밖 표식이 별 행으로 규정되어 있다 — 제외한 셋의 근거', () => {
    /*
     * `Unmapped`가 `taxLawYear`·`profileYear`·`hasEstimates`를 빼는 근거가 문서에
     * 실재함을 확인한다. 이 행이 사라지면 그 셋이 「어느 요소도 읽지 않는 필드」가 되므로
     * 타입 쪽 제외가 근거를 잃는다 — 제외를 주석으로만 두면 그 상실이 조용하다.
     */
    const text = readFileSync(DOC_008, 'utf8')
    const at = text.indexOf('### SCR-402 다년도 전망')
    const row = /^\| 표 밖 표식 \|(.+)\|$/m.exec(text.slice(at))

    expect(row, 'SCR-402 절에 「표 밖 표식」 행이 없다').not.toBeNull()
    expect(row![1]).toContain('적용 세율 연도')
    expect(row![1]).toContain('프로필 출처 연도')
    expect(row![1]).toContain('행별 추정 표식')
  })
})

// ---------------------------------------------------------------------------
// 빈 상태 판정
// ---------------------------------------------------------------------------

/** 전부 0인 행 — 상품이 없고 프로필도 없는 사용자의 한 해. */
function zeroRow(year: number, overrides: Partial<ForecastRow> = {}): ForecastRow {
  return {
    year,
    taxLawYear: 2026,
    profileYear: null,
    grossProceeds: '0',
    financialIncome: '0',
    thresholdGap: '-20000000',
    isComprehensive: false,
    effectiveRate: '0.0000',
    additionalTax: '0',
    totalInsurance: '0',
    netProceeds: '0',
    cumulativeNet: '0',
    remainingPrincipal: '0',
    cumulativeAssets: '0',
    hasEstimates: false,
    ...overrides,
  }
}

const SIX_ZERO_YEARS = Array.from({ length: 6 }, (_, offset) => zeroRow(2026 + offset))

describe('`isForecastEmpty` — 「전망할 데이터 없음」', () => {
  it('여섯 행이 전부 0이면 비어 있다', () => {
    expect(isForecastEmpty(SIX_ZERO_YEARS)).toBe(true)
  })

  it('★ 상품 0건 + ELS 외 금융소득은 **비어 있지 않다** — E 부류의 재현을 막는다', () => {
    /*
     * ★ **계약이 `[]`를 주지 않기로 한 결정이 여기서 두 번째로 지켜진다.**
     *
     * 그 사용자에게 상품은 없지만 종합과세 여부와 보험료는 실재하고, 그 둘이 이 화면의
     * 목적 중 하나다. 앞의 두 축(`grossProceeds`·`remainingPrincipal`)만 보면 이 행이
     * 「데이터 없음」으로 판정되어 **계약의 결정이 화면 층에서 그대로 무효화된다** —
     * SCR-101의 빈 상태 분기가 요소 ③을 함께 지운 것과 같은 형태(§8.1 E 부류)다.
     *
     * 그래서 방어가 두 층에 있다: 계약이 행을 주고, 이 함수가 그 행을 비어 있다고 하지 않는다.
     */
    const withOtherIncome = SIX_ZERO_YEARS.map((row) =>
      zeroRow(row.year, {
        financialIncome: '30000000',
        profileYear: 2026,
        isComprehensive: true,
        totalInsurance: '2440429',
      }),
    )

    expect(isForecastEmpty(withOtherIncome)).toBe(false)
  })

  it('회수가 있는 해가 하나라도 있으면 비어 있지 않다', () => {
    const rows = [...SIX_ZERO_YEARS]
    rows[2] = zeroRow(2028, { grossProceeds: '110000000' })
    expect(isForecastEmpty(rows)).toBe(false)
  })

  it('★ 적용 차수 없는 상품만 있어도 비어 있지 않다 — 잔여 원금 축', () => {
    /*
     * E-07 상품 하나만 보유한 사용자다. 유량은 전 연도가 0이고 금융소득도 0이지만
     * **원금이 여섯 행 전부에 남아 있다** — §7.5가 「배제하면 그 원금이 화면에서 조용히
     * 증발한다」로 못 박은 값이다. 이 축이 없으면 그 상품을 가진 사용자가 「전망할 데이터
     * 없음」을 보게 되고, 화면이 말해야 할 사실이 정확히 그 반대다.
     */
    const rows = SIX_ZERO_YEARS.map((row) =>
      zeroRow(row.year, {
        remainingPrincipal: '100000000',
        cumulativeAssets: '100000000',
        hasEstimates: true,
      }),
    )

    expect(isForecastEmpty(rows)).toBe(false)
  })

  it('빈 배열도 비어 있다 — 계약은 주지 않지만 판정이 총함수여야 한다', () => {
    expect(isForecastEmpty([])).toBe(true)
  })

  it('0의 표기가 달라도 0으로 읽는다 — 문자열 비교가 아니다', () => {
    // `'0'`·`'0.000000'`·`'-0'`이 전부 0이다. `=== '0'`으로 적으면 조용히 갈린다.
    const rows = [
      zeroRow(2026, { grossProceeds: '0.000000', remainingPrincipal: '-0' }),
    ]
    expect(isForecastEmpty(rows)).toBe(true)
  })
})
