import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LABEL_AXES, STALE_LABEL } from '@/lib/format'
import {
  ATTENTION_REASON_GRADES,
  CONDITION_RESULT_GRADES,
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
    ])
    expect([...used].sort()).toEqual(documentedGrades().sort())
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
  })

  it('두 결함 사유는 조치 목록에서도 defect다', () => {
    expect(ATTENTION_REASON_GRADES.UNDERLYING_MISSING).toBe('defect')
    expect(ATTENTION_REASON_GRADES.SCHEDULE_MISSING).toBe('defect')
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
