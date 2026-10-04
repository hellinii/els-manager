import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LABEL_AXES, STALE_LABEL } from '@/lib/format'
import {
  ATTENTION_REASON_GRADES,
  CONDITION_RESULT_GRADES,
  CONTRIBUTION_BASIS_GRADES,
  COUPON_CONDITION_RESULT_GRADES,
  COUPON_STATE_GRADES,
  INTEGRITY_ISSUE_GRADES,
  KI_STATUS_GRADES,
  STATUS_GRADES,
  type BadgeGrade,
} from '@/lib/format/badges'

/**
 * 표시 문자열 ↔ 문서 — **DOC-005 §6.1이 정본이다** (절대 규칙 #9)
 *
 * `tests/db/docs-contract.test.ts`가 DOC-011 §6·§3.2.1에 한 것을 DOC-005로
 * 확장한다. 근거는 같다: 코드의 라벨 표는 **문서 표를 손으로 옮긴 사본**이고,
 * 그 옮겨 적음이 맞는지는 아무도 보지 않는다. 실제로 이 프로젝트에서 그 결함이
 * 이미 있었다 — `kiStatus.BELOW`가 DOC-007과 DOC-008에 다르게 적혀 있었고
 * 어느 테스트도 실패하지 않았다.
 *
 * ## 파서의 전제를 스스로 검사한다
 *
 * 정규식 파싱의 유일한 위험은 형식이 바뀌어 **0건을 찾고 조용히 통과**하는
 * 것이다. 표를 찾지 못하면 실패하고, 찾은 행 수의 하한도 단언한다.
 */

const DOC_005 = join(process.cwd(), 'docs', '05_용어_사전.md')
const DOC_008 = join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md')

const SEPARATOR = /^\|(?:-+\|)+$/

/** 헤더 행을 앵커로 표의 데이터 행을 셀 배열로 돌려준다(docs-contract.test.ts와 같은 기법). */
function tableAfterHeader(file: string, header: string): string[][] {
  const lines = readFileSync(file, 'utf8').split('\n')
  const at = lines.indexOf(header)
  expect(at, `표 헤더를 찾지 못했다: ${header}`).toBeGreaterThan(-1)
  expect(
    lines.indexOf(header, at + 1),
    `같은 헤더가 둘 이상이다 — 앵커가 표를 특정하지 못한다: ${header}`,
  ).toBe(-1)
  expect(lines[at + 1], '헤더 다음 줄이 구분 행이 아니다').toMatch(SEPARATOR)

  const rows: string[][] = []
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith('|')) break
    rows.push(
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
  }
  return rows
}

/** 문서 셀의 `` `CODE` `` 백틱을 벗긴다. */
function bare(cell: string): string {
  return cell.replace(/`/g, '').trim()
}

/** DOC-005 §6.1 → `{ 축: { 코드: 표시 } }` */
function documentedLabels(): Record<string, Record<string, string>> {
  const rows = tableAfterHeader(DOC_005, '| 축 | 코드 값 | 표시 문자열 |')
  expect(rows.length, '§6.1 표가 비어 있다').toBeGreaterThan(20)

  const axes: Record<string, Record<string, string>> = {}
  for (const [axis, code, label] of rows) {
    const key = bare(axis ?? '')
    axes[key] ??= {}
    axes[key]![bare(code ?? '')] = (label ?? '').replace(/\*\*/g, '').trim()
  }
  return axes
}

describe('DOC-005 §6.1 ↔ labels.ts', () => {
  it('축 집합이 정확히 일치한다', () => {
    // `arrayContaining`을 쓰지 않는다 — 그것이 §3.2.1에서 9행의 누락을 영원히
    // 허용한 형태다(docs-contract.test.ts의 docblock).
    expect(Object.keys(documentedLabels()).sort()).toEqual(
      Object.keys(LABEL_AXES).sort(),
    )
  })

  it('축마다 코드 값과 표시 문자열이 전수 일치한다', () => {
    const documented = documentedLabels()
    for (const [axis, labels] of Object.entries(LABEL_AXES)) {
      expect(documented[axis], `문서에 없는 축: ${axis}`).toBeDefined()
      // 양방향이다 — 문서에만 있는 값도 코드에만 있는 값도 실패다.
      expect(documented[axis], `축 ${axis}`).toEqual(labels)
    }
  })

  it('§6.1의 모든 표시 문자열이 한글(또는 등재된 영문 약어)이다', () => {
    // CLAUDE.md 코딩 규약: UI 표시 문자열은 한글. `ETF`·`KI`는 DOC-005가 등재한
    // 표기이므로 허용한다 — 그 둘 외의 영문이 새로 들어오면 실패한다.
    for (const labels of Object.values(LABEL_AXES)) {
      for (const label of Object.values(labels)) {
        const withoutAllowed = label.replace(/ETF|KI/g, '')
        expect(withoutAllowed, label).not.toMatch(/[A-Za-z]/)
      }
    }
  })
})

describe('DOC-008 §5 SCR-101 ↔ 조치 사유', () => {
  /** 사유 열은 `` `KI_NEAR` `` 또는 `` `A`·`B` `` 형태다(둘을 한 칸에 묶은 행이 있다). */
  function documentedReasons(): string[] {
    const rows = tableAfterHeader(DOC_008, '| 사유 | 표시 | 조치 |')
    expect(rows.length, 'SCR-101 조치 표가 비어 있다').toBeGreaterThan(4)
    return rows.flatMap(([reason]) =>
      (reason ?? '').split('·').map((cell) => bare(cell)),
    )
  }

  it('사유 열거값이 정확히 일치한다', () => {
    expect(documentedReasons().sort()).toEqual(
      Object.keys(LABEL_AXES.attentionReason).sort(),
    )
  })

  it('결함 두 사유는 문서가 한 칸에 묶었어도 문구가 다르다', () => {
    /*
     * DOC-008이 두 사유를 한 칸에 둔 것은 **조치가 같다**(SCR-204로 유도)는
     * 뜻이지 문구가 같다는 뜻이 아니다. ST-06은 「기초자산 없음」과 「평가일정
     * 없음」을 구분하라고 요구하며, 뭉뚱그리면 그 요구가 조치 목록에서만 깨진다.
     */
    const { attentionReason, integrityIssue } = LABEL_AXES
    expect(attentionReason.UNDERLYING_MISSING).not.toBe(
      attentionReason.SCHEDULE_MISSING,
    )
    // 그리고 `integrityIssue` 축과 같은 문자열이어야 한다 — 같은 사실의 두 창구다.
    expect(attentionReason.UNDERLYING_MISSING).toBe(integrityIssue.UNDERLYING_MISSING)
    expect(attentionReason.SCHEDULE_MISSING).toBe(integrityIssue.SCHEDULE_MISSING)
  })

  it('KI_BELOW만 조치를 문구에 담는다', () => {
    // D-04: 시스템이 자동 확정하지 않으므로 사용자 확인이 필요한 유일한 상태다.
    // `KI_NEAR`(관찰)로 접으면 확인 요청이 경고로 격하된다(§4.1 각주).
    expect(LABEL_AXES.attentionReason.KI_BELOW).toContain('확인 필요')
    expect(LABEL_AXES.attentionReason.KI_NEAR).not.toContain('확인 필요')
    // 등급 축의 같은 상태는 조치를 담지 않는다 — 「확인 필요」는 등급이 아니다.
    expect(LABEL_AXES.kiStatus.BELOW).not.toContain('확인 필요')
  })
})

describe('DOC-005 §6.3 ↔ badges.ts', () => {
  function documentedGrades(): string[] {
    const rows = tableAfterHeader(DOC_005, '| 등급 | 의미 | 쓰는 곳 |')
    expect(rows.length, '§6.3 표가 비어 있다').toBe(5)
    return rows.map(([grade]) => bare(grade ?? ''))
  }

  it('등급 토큰 집합이 문서와 일치한다', () => {
    const used = new Set<BadgeGrade>([
      ...Object.values(STATUS_GRADES),
      ...Object.values(KI_STATUS_GRADES),
      ...Object.values(CONDITION_RESULT_GRADES),
      ...Object.values(INTEGRITY_ISSUE_GRADES),
      ...Object.values(ATTENTION_REASON_GRADES),
      // P8 — 월수익 축 둘(b3-3)과 기여 근거(b4-4). b3-3은 이 집합에 넣지 않았다 — 결과는 같았지만(새 등급 토큰이 없다)
      // 그 축이 새 토큰을 들이면 보이지 않았다(b4-4에서 메웠다)
      ...Object.values(COUPON_STATE_GRADES),
      ...Object.values(COUPON_CONDITION_RESULT_GRADES),
      ...Object.values(CONTRIBUTION_BASIS_GRADES),
    ])
    expect([...used].sort()).toEqual(documentedGrades().sort())
  })

  it('기여 근거 — 확정은 neutral, 추정이 섞이면 caution이다 · §6.3의 「쓰는 곳」과 같다 (ST-05 · DOC-005 v1.17)', () => {
    const rows = tableAfterHeader(DOC_005, '| 등급 | 의미 | 쓰는 곳 |')
    const usesOf = (grade: string) => rows.find(([g]) => bare(g ?? '') === grade)?.[2] ?? ''
    expect(CONTRIBUTION_BASIS_GRADES).toEqual({ CONFIRMED: 'neutral', ESTIMATED: 'caution', MIXED: 'caution' })
    expect(usesOf('neutral')).toContain('`contributionBasis.CONFIRMED`')
    expect(usesOf('caution')).toContain('`contributionBasis.ESTIMATED` · `MIXED`')
  })

  /*
   * **값별 대조** (DOC-005 v1.18 — P8.5 반박 검토). 위 「등급 토큰 집합」은 **새 토큰**만 잡는다 — `couponState.UNRECORDED`가
   * `attention`에서 `caution`으로 바뀌어도 집합은 같아 초록이었다(값별 대조는 `contributionBasis` 하나뿐이었다). 그래서
   * 「쓰는 곳」 칸을 `축.값 → 등급`으로 읽어 코드와 값마다 맞춘다.
   *
   * 칸의 읽기 규칙: `축.값`은 그 값 · 바로 뒤의 점 없는 대문자 토큰(`BEYOND_ASSUMPTION`)은 앞 토큰의 축을 잇는다 · 점 없는
   * 소문자 토큰(`accountType`)은 축 전체다. 백틱 밖의 낱말(「상환 실적」 · 「시세 오래됨」)은 열거형이 아니라 이 대조 밖이다.
   */
  function documentedValueGrades(): { values: Map<string, string>; wholeAxes: Map<string, string> } {
    const values = new Map<string, string>()
    const wholeAxes = new Map<string, string>()
    for (const [gradeCell, , uses] of tableAfterHeader(DOC_005, '| 등급 | 의미 | 쓰는 곳 |')) {
      const grade = bare(gradeCell ?? '')
      let axis: string | null = null
      for (const [, token] of (uses ?? '').matchAll(/`([A-Za-z_.]+)`/g)) {
        const dotted = /^([a-z][A-Za-z]*)\.([A-Z_]+)$/.exec(token!)
        const key = dotted != null ? `${(axis = dotted[1]!)}.${dotted[2]}` : /^[A-Z_]+$/.test(token!) ? `${axis}.${token}` : null
        if (key == null) {
          wholeAxes.set(token!, grade)
          axis = null
          continue
        }
        expect(axis, `${grade} 칸의 ${token}가 이을 축이 없다`).not.toBeNull()
        expect(values.has(key), `${key}가 §6.3에 둘 이상이다`).toBe(false)
        values.set(key, grade)
      }
    }
    return { values, wholeAxes }
  }

  const GRADE_RECORDS: Record<string, Record<string, BadgeGrade>> = {
    status: STATUS_GRADES,
    kiStatus: KI_STATUS_GRADES,
    conditionResult: CONDITION_RESULT_GRADES,
    integrityIssue: INTEGRITY_ISSUE_GRADES,
    attentionReason: ATTENTION_REASON_GRADES,
    couponState: COUPON_STATE_GRADES,
    couponConditionResult: COUPON_CONDITION_RESULT_GRADES,
    contributionBasis: CONTRIBUTION_BASIS_GRADES,
  }

  it('★ 「쓰는 곳」의 값마다 코드의 등급이 같다 — 집합이 아니라 값별이다 (DOC-005 v1.18)', () => {
    const { values, wholeAxes } = documentedValueGrades()
    expect(values.size, '§6.3에서 값을 읽었다').toBeGreaterThanOrEqual(20)
    for (const [key, grade] of values) {
      const [axis, value] = key.split('.') as [string, string]
      expect(GRADE_RECORDS, `${axis}에 대응하는 등급 표가 없다`).toHaveProperty(axis)
      expect(GRADE_RECORDS[axis]![value], key).toBe(grade)
    }
    // 축 전체 — 결함은 셋 다 defect. 등급 표가 없는 축(배지가 늘 중립인 둘)은 이 목록으로 고정한다 — 새 축이 조용히 빠지지 않게
    for (const [axis, grade] of wholeAxes) {
      if (axis in GRADE_RECORDS) {
        expect(Object.values(GRADE_RECORDS[axis]!).every((g) => g === grade), `${axis} 전체가 ${grade}`).toBe(true)
      }
    }
    expect([...wholeAxes.keys()].filter((axis) => !(axis in GRADE_RECORDS)).sort()).toEqual(['accountType', 'priceSource', 'productCurrency'])
    expect(wholeAxes.get('integrityIssue')).toBe('defect')
    expect(Object.keys(INTEGRITY_ISSUE_GRADES)).toHaveLength(3)
  })

  it('★ 월수익 축 · 기여 근거는 값이 전부 「쓰는 곳」에 있다 — 양방향 (DOC-005 v1.18)', () => {
    const { values } = documentedValueGrades()
    for (const axis of ['couponState', 'couponConditionResult', 'contributionBasis']) {
      const documented = Object.fromEntries(
        [...values].filter(([key]) => key.startsWith(`${axis}.`)).map(([key, grade]) => [key.slice(axis.length + 1), grade]),
      )
      expect(documented, axis).toEqual(GRADE_RECORDS[axis])
    }
    // 조치 사유 중 월수익 축 — 「월수익 미기록」은 사용자 조치다(「평가일 경과」와 같은 부류)
    expect(values.get('attentionReason.COUPON_UNRECORDED')).toBe('attention')
    expect(ATTENTION_REASON_GRADES.COUPON_UNRECORDED).toBe('attention')
  })

  it('결함은 조치와 다른 등급이다 — ST-06', () => {
    /*
     * 유도하는 화면이 다르다: `attention`은 SCR-202(사용자 확인), `defect`는
     * SCR-204(데이터 수정). 같은 등급으로 묶으면 색에서 그 구분이 사라지고,
     * 사용자는 고칠 수 있는 것과 기다려야 하는 것을 구별하지 못한다.
     */
    expect(INTEGRITY_ISSUE_GRADES.UNDERLYING_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.KI_BELOW).toBe('attention')
    expect(INTEGRITY_ISSUE_GRADES.UNDERLYING_MISSING).not.toBe(
      ATTENTION_REASON_GRADES.KI_BELOW,
    )
    // 셋째 결함(P8 컷 b3-2) — 고칠 곳이 월지급 블록(SCR-204)이다. 같은 축의 조치 「월수익 미기록」(SCR-206에서 옮겨 적는다)과
    // 색이 갈려야 한다 — DOC-005 v1.18이 이 단언의 빠짐을 찾았다
    expect(INTEGRITY_ISSUE_GRADES.COUPON_SCHEDULE_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.COUPON_SCHEDULE_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.COUPON_SCHEDULE_MISSING).not.toBe(ATTENTION_REASON_GRADES.COUPON_UNRECORDED)
  })

  it('세 결함 사유는 조치 목록에서도 defect다', () => {
    expect(ATTENTION_REASON_GRADES.UNDERLYING_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.SCHEDULE_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.COUPON_SCHEDULE_MISSING).toBe('defect')
  })

  it('노낙인은 안전이 아니라 중립이다', () => {
    // 「KI 배리어가 없다」는 판정 대상이 아니라는 뜻이다. 초록으로 칠하면
    // KI 판정을 통과한 것처럼 읽힌다.
    expect(KI_STATUS_GRADES.NO_KI).toBe('neutral')
    expect(KI_STATUS_GRADES.SAFE).toBe('positive')
  })
})

describe('열거형이 아닌 표시 문자열', () => {
  it('시세 경과는 DOC-005 §6의 문구를 쓴다', () => {
    const lines = readFileSync(DOC_005, 'utf8')
    expect(lines).toContain(`**"${STALE_LABEL}"**`)
  })
})
