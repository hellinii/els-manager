import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  GAP_TIER_GRADES,
  GAP_TIER_LABELS,
  NARROW_GAP,
  barrierGap,
  conditionMeets,
  gapTierOf,
  percentPoint,
  type GapTier,
} from '@/lib/format'

import { liveDoc } from './docText'

/**
 * 여유폭 단계 — 「예상 근소 충족」 (홈 피드백 컷 K6 · 피드백 #2 · 민서 결정(2026-10-12) D3)
 *
 * 정본은 DOC-008 §5 머리 「예상 근소 충족」 블록과 DOC-005 §6 「여유폭 단계」 행이다. 이 파일이 지키는 것 넷:
 *
 * 1. **경계가 `dec`다** — 정확히 5%p는 「예상 충족」이다. float로 빼면 `0.9500 − 0.9000`이 `0.04999999999999993`이라
 *    근소로 떨어진다(첫 픽스처가 float `<` · float `≤` · dec `≤` 구현을 한 번에 가른다)
 * 2. **단계가 W를 따라 단조다** — 리자드(여유폭 음수 + 충족)를 「예상 충족」으로 두면 조기상환 배리어 바로 밑에서 단계가
 *    안전 쪽으로 되돌아간다(DOC-005 GQ-11)
 * 3. **낱말이 문서와 같다** — 굵은 표시어 셋(DOC-005)과 5%p 문장(DOC-008)을 취소선 · 이력 행을 벗긴 글에 묶는다(`liveDoc`)
 * 4. **세 화면이 한 함수를 부른다** — `barrierGap(`을 부르는 화면 파일은 `gapTierOf(`도 부른다. 라벨 리터럴은
 *    `labels.ts`에만 있다(종전 홈 ①의 「예상 충족」 · 「예상 미충족」 리터럴이 그 자리였다)
 */

const ROOT = process.cwd()

const W = (worstOf: string | null, barrier: string, meets: boolean | null) =>
  gapTierOf({ worstOf, barrier, meets })

describe('conditionMeets — 홈 `willMeet`과 같은 정의 (DOC-011 §4.1)', () => {
  it('조기상환 · 리자드는 충족, 이월은 미충족, 판정 없음은 null', () => {
    expect(conditionMeets('EARLY')).toBe(true)
    expect(conditionMeets('LIZARD')).toBe(true)
    expect(conditionMeets('CARRY_OVER')).toBe(false)
    // 「미충족」이 아니다 — 판정이 없으면 단계도 없다
    expect(conditionMeets(null)).toBeNull()
  })
})

describe('gapTierOf — 경계 픽스처 (Decimal 문자열)', () => {
  it('★ 정확히 5%p는 「예상 충족」이다 — float `<` · `≤` · dec `≤` 구현을 가른다', () => {
    // 전제 — 이 쌍이 float로는 5%p 미만이다(아니면 이 픽스처가 float 구현을 가르지 못한다)
    expect(0.95 - 0.9).toBeLessThan(0.05)
    expect(W('0.9500', '0.9000', true)).toBe('MET')
    // 반대쪽 float 오차 — 0.050000000000000044라 float `<`는 통과하지만 dec `≤` 구현은 근소로 떨어뜨린다
    expect(0.9 - 0.85).toBeGreaterThan(0.05)
    expect(W('0.9000', '0.8500', true)).toBe('MET')
    // 화면에 보이는 숫자와 같은 말을 한다
    expect(barrierGap('0.9500', '0.9000')).toBe('+5%p')
  })

  it('5%p 미만의 충족은 근소다 — 0%p(W = B)도', () => {
    expect(W('0.9499', '0.9000', true)).toBe('NARROW')
    expect(W('0.9300', '0.9000', true)).toBe('NARROW')
    expect(W('0.9000', '0.9000', true)).toBe('NARROW')
  })

  it('★ 리자드(여유폭 음수 + 충족)는 근소다 — 「예상 충족」이 아니다', () => {
    expect(W('0.8400', '0.8500', true)).toBe('NARROW')
    expect(W('0.6000', '0.8500', true)).toBe('NARROW')
    expect(barrierGap('0.6000', '0.8500')).toBe('-25%p')
  })

  it('★ 미충족은 판정이 정한다 — 여유폭이 0%p로 보여도 이월이면 미충족', () => {
    expect(W('0.9000', '0.9000', false)).toBe('UNMET')
    expect(W('0.8000', '0.9000', false)).toBe('UNMET')
    // 여유가 커 보여도 판정이 미충족이면 미충족이다(숫자가 판정을 뒤집지 않는다)
    expect(W('1.2000', '0.9000', false)).toBe('UNMET')
  })

  it('워스트오브나 판정이 없으면 단계도 없다', () => {
    expect(W(null, '0.9000', true)).toBeNull()
    expect(W(null, '0.9000', null)).toBeNull()
    expect(W('0.9500', '0.9000', null)).toBeNull()
  })

  it('경계는 보이는 수(4자리)로 정한다 — 표시와 단계가 어긋나지 않는다 (DOC-008 블록의 2)', () => {
    // 계약은 4자리를 준다. 4자리를 넘는 입력이 와도 표시와 같은 반올림을 거친다
    expect(barrierGap('0.94996', '0.9000')).toBe('+5%p')
    expect(W('0.94996', '0.9000', true)).toBe('MET')
    expect(barrierGap('0.94994', '0.9000')).toBe('+4.99%p')
    expect(W('0.94994', '0.9000', true)).toBe('NARROW')
  })
})

describe('gapTierOf — 단조성 성질', () => {
  it('★ W가 내려갈 때 단계는 충족 → 근소 → 미충족으로만 움직인다 (B 85% · 리자드 60%)', () => {
    const B = '0.8500'
    const L = '0.6000'
    const rank: Record<GapTier, number> = { MET: 2, NARROW: 1, UNMET: 0 }
    const seen: GapTier[] = []
    let prev = Infinity
    for (let i = 0; i <= 140; i += 1) {
      const w = dec('1.2000').minus(dec('0.0050').mul(i)).toFixed(4)
      // 조기상환 또는 리자드 — `evaluateCondition`의 순서와 같다(KI 미터치 전제)
      const meets = dec(w).gte(dec(B)) || dec(w).gte(dec(L))
      const tier = W(w, B, meets)
      expect(tier, w).not.toBeNull()
      expect(rank[tier!], `W ${w}에서 단계가 안전 쪽으로 되돌아갔다`).toBeLessThanOrEqual(prev)
      prev = rank[tier!]
      if (seen.at(-1) !== tier) seen.push(tier!)
    }
    // 전제 — 루프가 세 단계를 전부 지났다(한 단계만 보면 단조는 항진명제다)
    expect(seen).toEqual(['MET', 'NARROW', 'UNMET'])
  })
})

describe('표의 성질 — GAP_TIER_LABELS · GAP_TIER_GRADES', () => {
  it('★ 근소는 충족과 다른 등급이다 — 같으면 +3%p와 +30%p가 다시 같은 색이다 (피드백 #2)', () => {
    expect(GAP_TIER_GRADES.NARROW).not.toBe(GAP_TIER_GRADES.MET)
    expect(GAP_TIER_GRADES).toEqual({ MET: 'positive', NARROW: 'caution', UNMET: 'caution' })
  })

  it('낱말 셋은 서로 다르고 셋 다 「예상」을 달며, 「경계」 · 「근접」 · 숫자를 담지 않는다', () => {
    const labels = Object.values(GAP_TIER_LABELS)
    expect(new Set(labels).size).toBe(3)
    for (const label of labels) {
      expect(label, label).toMatch(/^예상 /)
      // 「경계」는 문턱의 이름(종전 임박 경계) · 「근접」은 KI 근접(손실 쪽) — DOC-005 「여유폭 단계」
      expect(label, label).not.toMatch(/경계|근접/)
      // 폭(5%p)은 낱말이 아니라 숫자 칸이 말한다 — 폭을 바꾸는 날 낱말이 거짓이 되지 않게
      expect(label, label).not.toMatch(/\d/)
    }
  })

  it('★ 굵은 표시어 셋이 DOC-005 「여유폭 단계」와 같다 — 취소선 · 이력 행 밖의 글', () => {
    const doc = liveDoc('05_용어_사전.md')
    for (const label of Object.values(GAP_TIER_LABELS)) {
      expect(doc, label).toContain(`**"${label}"**`)
    }
  })

  it('★ 5%p가 DOC-008 §5 머리 블록의 문장과 같다', () => {
    const width = percentPoint(NARROW_GAP).slice(1)
    expect(width).toBe('5%p')
    expect(liveDoc('08_정보구조_및_화면목록.md')).toContain(`**충족이고 여유폭 ${width} 미만**`)
  })
})

// ---------------------------------------------------------------------------
// 소스 스캔 — 세 화면이 한 함수를 부른다
// ---------------------------------------------------------------------------

function srcFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) out.push(relative(ROOT, full))
    }
  }
  walk(join(ROOT, dir))
  return out.sort()
}

function parse(file: string, text = readFileSync(join(ROOT, file), 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** 그 파일이 부르는 함수 이름들 — 주석 · 문자열 속 이름은 세지 않는다(구문 트리의 호출식만) */
function calledNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) names.add(node.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** 그 파일의 글자 조각 — 문자열 리터럴 · 템플릿 조각 · JSX 글자(주석은 구문 트리에 없다) */
function textPieces(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text)
    } else if (ts.isJsxText(node)) {
      out.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * `barrierGap`을 부르면서 단계를 쓰지 않는 자리 — 사유가 있어야 한다.
 *
 * SCR-202 요약의 「KI 배리어(…) 대비 …」는 같은 함수가 낸 **KI 배리어와의 차**이고 여유폭이 아니다(DOC-005 「여유폭」 ·
 * DOC-008 블록의 7 「쓰지 않는 곳」).
 */
const GAP_WITHOUT_TIER: Record<string, string> = {
  'src/app/(app)/products/[id]/page.tsx': 'KI 배리어와의 차 — 조기상환 배리어의 여유폭이 아니다',
}

/**
 * 라벨 낱말이 `labels.ts` 밖에 리터럴로 서도 되는 자리. SCR-301 시간순 보기의 **열 머리글** 「예상 충족」은 칸의 이름이고
 * (DOC-008 SCR-301 ⑥ 「예상 충족 여부」) 단계의 낱말이 아니다.
 */
const LABEL_LITERAL_ELSEWHERE: Record<string, { file: string; reason: string }> = {
  [GAP_TIER_LABELS.MET]: { file: 'src/app/(app)/schedule/page.tsx', reason: 'SCR-301 시간순 보기의 열 머리글(칸 이름)' },
}

describe('소스 스캔 — 여유폭을 그리는 화면은 단계를 같은 함수로 낸다', () => {
  const SCREEN_FILES = [...srcFiles('src/app'), ...srcFiles('src/components')]
  const CALLS = new Map(SCREEN_FILES.map((f) => [f, calledNames(parse(f))]))

  it('전제 — 화면 파일을 실제로 걸었다', () => {
    expect(SCREEN_FILES.length).toBeGreaterThan(50)
    expect(SCREEN_FILES).toContain('src/components/home/HomeSections.tsx')
  })

  it('★ `barrierGap(`을 부르는 파일은 `gapTierOf(`도 부른다 — 예외는 사유와 함께 하나', () => {
    const gapFiles = SCREEN_FILES.filter((f) => CALLS.get(f)!.has('barrierGap'))
    // 0건을 찾고 조용히 통과하지 않게 수를 고정한다 — 홈 ① · SCR-201 · SCR-301 시간순 · 상품별 + SCR-202 KI 차
    expect(gapFiles).toHaveLength(5)
    const missing = gapFiles.filter((f) => !CALLS.get(f)!.has('gapTierOf') && !(f in GAP_WITHOUT_TIER))
    expect(missing, '여유폭을 그리면 그 색과 근소 배지는 gapTierOf가 정한다 — DOC-008 §5 머리 블록').toEqual([])
  })

  it('예외가 낡지 않았다 — 그 파일이 여전히 `barrierGap`을 부르고 단계를 쓰지 않는다', () => {
    for (const [file, reason] of Object.entries(GAP_WITHOUT_TIER)) {
      expect(reason.length).toBeGreaterThan(0)
      expect(CALLS.get(file), `${file}이 없다`).toBeDefined()
      expect(CALLS.get(file)!.has('barrierGap'), `${file}이 barrierGap을 부르지 않는다 — 예외를 지운다`).toBe(true)
      expect(CALLS.get(file)!.has('gapTierOf'), `${file}이 단계를 쓴다 — 예외를 지운다`).toBe(false)
    }
  })

  it('★ 단계 낱말은 `labels.ts`에만 리터럴로 있다 — 화면은 표를 읽는다', () => {
    const files = srcFiles('src')
    const found: string[] = []
    for (const file of files) {
      const pieces = textPieces(parse(file))
      for (const label of Object.values(GAP_TIER_LABELS)) {
        if (file === 'src/lib/format/labels.ts') continue
        if (LABEL_LITERAL_ELSEWHERE[label]?.file === file) continue
        if (pieces.some((p) => p.includes(label))) found.push(`${file} 「${label}」`)
      }
    }
    expect(found, '낱말은 GAP_TIER_LABELS를 읽는다 — 리터럴은 표가 바뀌는 날 혼자 남는다').toEqual([])
    // 정본 자리에는 실제로 있다(스캐너가 그 꼴을 잡는다는 자기 검증이기도 하다)
    const own = textPieces(parse('src/lib/format/labels.ts'))
    for (const label of Object.values(GAP_TIER_LABELS)) expect(own, label).toContain(label)
  })

  it('라벨 예외가 낡지 않았다 — 그 파일에 그 낱말이 실제로 있다', () => {
    for (const [label, { file, reason }] of Object.entries(LABEL_LITERAL_ELSEWHERE)) {
      expect(reason.length).toBeGreaterThan(0)
      expect(textPieces(parse(file)).some((p) => p.includes(label)), `${file}에 「${label}」이 없다 — 예외를 지운다`).toBe(true)
    }
  })

  it('스캐너 자기 검증 — 주석의 낱말은 세지 않고 JSX 글자 · 문자열 · 템플릿은 센다', () => {
    const label = GAP_TIER_LABELS.NARROW
    const pieces = (src: string) => textPieces(parse('synthetic.tsx', src))
    expect(pieces(`// ${label}\nexport const X = 1`).some((p) => p.includes(label))).toBe(false)
    expect(pieces(`/* ${label} */ export const X = () => <b>a</b>`).some((p) => p.includes(label))).toBe(false)
    expect(pieces(`export const X = () => <b>${label}</b>`).some((p) => p.includes(label))).toBe(true)
    expect(pieces(`export const X = '${label}'`).some((p) => p.includes(label))).toBe(true)
    expect(pieces('export const X = (n: number) => `' + label + ' ${n}`').some((p) => p.includes(label))).toBe(true)
    // 호출식만 센다 — 이름이 주석이나 문자열에 있어도 부르지 않은 것이다
    const calls = (src: string) => calledNames(parse('synthetic.tsx', src))
    expect(calls('// gapTierOf(x)\nexport const s = "gapTierOf(y)"').has('gapTierOf')).toBe(false)
    expect(calls('export const t = gapTierOf({ worstOf: null, barrier: "0.9", meets: null })').has('gapTierOf')).toBe(true)
  })
})
