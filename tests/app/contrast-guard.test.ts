import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 정보 글자의 대비를 사람이 세지 않는다 — 홈 피드백 컷 K2 (DOC-008 §6 ST-08)
 *
 * ## 왜 이 파일이 있는가
 *
 * 피드백 #12(「대비가 낮다」)는 실측으로 대부분 틀렸다 — 홈 회색 글자의 주력인
 * neutral-500은 흰 바탕에서 4.74:1이다. 그러나 홈 ①의 「판정 없음」은 neutral-400
 * (2.58:1)이었고, 홈 밖에도 정보 글자 넷(SCR-301 월 머리의 건수 · 기초자산 줄의 「없음」 ·
 * 「→」 · 「시세 없음」)과 펼침 표식 둘이 같은 색이었다. **회색은 「덜 중요하다」는 뜻으로
 * 고르는 색이라 한 자리씩 옅어지는 쪽으로 미끄러지는데, 그래도 빨개지는 테스트가 없다.**
 * 대비는 브라우저에서만 보이는 성질이므로, 싼 층(소스의 클래스 문자열)에서 잡을 수 있는
 * 만큼 잡고 나머지는 등재한다(DOC-010 AQ-103).
 *
 * ## 무엇을 단언하는가
 *
 * 1. neutral-400 **이하**(50 · 100 · 200 · 300 · 400) 글자색 토큰은 아래 갈래 중 하나이고
 *    **VIOLATION은 0건이다.** ST-08의 문언은 300 · 400이지만 더 옅은 단계는 같은 규칙
 *    본문(4.5:1)에 더 크게 어긋난다(흰 바탕 50 1.04 · 200 1.26:1) — 미끄러지는 쪽이 그쪽이다.
 *    - DISABLED — 비활성 변형 `disabled:` · `aria-disabled:` · `group-` / `peer-` 짝
 *      (WCAG 1.4.3의 비활성 예외). **이름이 정확히 맞아야 한다** — `not-disabled:`는 「비활성이
 *      아닐 때」, `has-disabled:`는 「비활성인 자식이 있을 때」라 예외가 아니다
 *    - ARIA_HIDDEN — **같은 요소에** `aria-hidden`(장식)
 *    - PLACEHOLDER — 요소의 글자가 정확히 「—」나 「-」(값 없음 · 구분 기호). 경계 사례라
 *      **건수 원장**으로 고정한다 — 다른 이유로 하나만 늘거나 줄어도 빨간불이다(DOC-010 AQ-104)
 *    - LEDGER — 클래스로 가를 수 없는 자리(어두운 부모 바탕 · 비활성 상태를 그리는 `<span>`).
 *      파일이 아니라 **자리**(파일 · 함수 · 요소 · 토큰)와 그 판단의 근거를 적고, 근거를 소스에서
 *      다시 확인한다
 *    - VIOLATION — 나머지 전부. **판정할 수 없는 자리도 여기다**(className 밖의 상수 ·
 *      객체 표 · `marker:` · `aria-[…]:` · `*:` 같은 다른 변형 · `${}`에 붙어 앞뒤가 식으로
 *      정해지는 토큰) — 모르면 통과가 아니라 빨간불이다
 * 2. `text-neutral-500`과 옅은 바탕 넷(neutral-100 · red-50 · blue-50 · sky-50 —
 *    4.33 ~ 4.45:1)이 **한 클래스 문자열에** 같이 오지 않는다.
 * 3. 무채색 팔레트를 `theme.css`에서 직접 읽어 50 ~ 400 < 4.5 ≤ 500 · 600 · 700이다 —
 *    앱이 그 값을 덮어쓰지 않는다는 전제(src의 CSS에 `--color-neutral-*`가 없다)와 함께.
 *    `tailwindcss: ^4`가 캐럿 범위라 neutral-500의 여유(0.24)를 지킬 근거가 필요하다.
 *
 * **스캐너는 TypeScript 구문 트리를 걷고, 문자열 조각을 공백으로 잘라 클래스 토큰 단위로
 * 본다** — Tailwind가 후보를 자르는 방식과 같다. 정규식으로 소스를 훑으면 주석 속 백틱이
 * 문자열로 짝지어져 진짜 className이 그 짝 **밖으로** 밀려날 수 있고, 토큰 안을 정규식으로
 * 찾으면 `aria-[current=page]:`의 `]`처럼 예상하지 못한 글자 앞에서 매치가 통째로 사라진다
 * (둘 다 놓치는 쪽의 오류다 — 아래 합성 소스가 고정한다). 변형은 **괄호 밖의 `:`**로만 가른다.
 *
 * ## 보지 못하는 것 (DOC-010 AQ-103)
 *
 * 상속(부모가 정한 글자색 · 바탕 — 아래 합성 소스가 그 한계를 고정한다), 조립한 클래스
 * (`GRADE_CLASS`처럼 바탕과 글자가 다른 문자열에서 온다), 비텍스트 대비(WCAG 1.4.11).
 * neutral 밖의 회색 계열(gray · zinc · slate · stone)은 팔레트를 재지 않았으므로 src에 0건임을
 * 전제로 단언한다. 종결 수단은 DOC-009의 디자인 토큰이다.
 *
 * **린트도 브라우저도 실행하지 않는다** — 파일시스템 읽기와 구문 분석뿐이다(ADR-003).
 */

const ROOT = process.cwd()

/** 판단의 근거 — 원장 자리마다 소스에서 다시 선다 */
type Premise =
  /** 조상 요소의 className에 어두운 바탕(neutral-800 · 900 · 950)이 변형 없이 있다 */
  | 'DARK_PARENT'
  /** 요소가 `if (disabled)` 또는 `disabled ? … :`의 참 갈래 안에 있다 */
  | 'DISABLED_BRANCH'

type LedgerSite = {
  file: string
  /** 자리를 담은 함수(컴포넌트) 이름 */
  within: string
  /** 토큰이 붙은 요소 */
  tag: string
  token: string
  premise: Premise
  reason: string
}

/**
 * 클래스로 가를 수 없어 **사람이 판단한** 자리 — 자리마다 정확히 한 번 잡혀야 한다.
 *
 * 파일별 건수가 아니라 자리를 적는 이유: 건수만 보면 판단한 자리가 사라지고 같은 파일의
 * 다른 곳에 정보 글자 neutral-400이 하나 들어와도 1 = 1로 초록이다. 자리가 맞아도 근거
 * (`premise`)가 소스에서 더는 서지 않으면 — 부모 바탕이 흰색이 되면 — 위반이다.
 * (`lint-coverage.test.ts`의 `EXEMPT`와 같은 형태 — 사유와 함께 · 양방향)
 */
const LEDGER: readonly LedgerSite[] = [
  {
    file: 'src/app/(app)/products/page.tsx',
    within: 'PageLink',
    tag: 'span',
    token: 'text-neutral-300',
    premise: 'DISABLED_BRANCH',
    reason:
      'SCR-201 페이지 이동의 비활성 칸 — `disabled:` 없이 평범한 `<span>`이 비활성 상태를 그린다' +
      '(누를 수 없는 링크는 링크가 아니어야 한다). WCAG 1.4.3의 비활성 예외 · ST-08',
  },
  {
    file: 'src/app/(app)/products/[id]/page.tsx',
    within: 'Summary',
    tag: 'span',
    token: 'text-neutral-300',
    premise: 'DARK_PARENT',
    reason:
      '어두운 바탕 — SCR-202 상단 요약의 무결성 결함 줄(부모 `<p>`가 neutral-800 · ST-06)의 ' +
      'neutral-300은 10.2:1로 통과한다. 바탕이 부모에 있어 같은 요소의 클래스로 가를 수 없다',
  },
]

/**
 * 값 없음 「—」 · 구분 기호 「-」의 **건수 원장** (2026-10-12 조사: 「—」 9 · 「-」 1).
 *
 * 개수가 아니라 파일별 표 전체를 대조한다 — 한 파일에서 하나 줄고 다른 파일에서 하나
 * 늘면 합계는 10 그대로지만 판단 없이 자리가 옮겨진 것이다. 홈 ①의 새 「—」(K5)는
 * `aria-hidden` 장식이라 여기 들지 않는다(DOC-010 AQ-104).
 */
const PLACEHOLDER_LEDGER: Record<string, number> = {
  'src/components/products/ProductRow.tsx': 5, // 「—」 4 · 「-」 1(기초자산 구분)
  'src/components/products/UnderlyingTable.tsx': 1,
  'src/components/schedule/ProductScheduleCard.tsx': 3,
  'src/components/schedule/ScheduleRow.tsx': 1,
}

type Kind = 'DISABLED' | 'ARIA_HIDDEN' | 'PLACEHOLDER' | 'LEDGER' | 'VIOLATION'
type RawHit = {
  file: string
  line: number
  token: string
  kind: Exclude<Kind, 'LEDGER' | 'VIOLATION'> | 'REST'
  /** 원장 자리 대조용 — 판정할 수 없으면 null */
  tag: string | null
  within: string | null
  premises: Premise[]
}
type Hit = Omit<RawHit, 'kind'> & { kind: Kind; site: LedgerSite | null }

/**
 * 유틸리티 부분(변형을 뗀 나머지 · 앞뒤 `!` 중요도 표식을 뗀 것)에 대한 판정.
 * 불투명도(`/60`)는 대비를 더 낮추므로 같은 토큰이다. `text-neutral-4000` · `xtext-…`는 다른 토큰이다.
 */
const LOW_CONTRAST = /^text-neutral-(?:50|100|200|300|400)(?:\/\S+)?$/
/** `${}`에 이어 단계가 식으로 정해지는 꼴 — `text-neutral-${step}` */
const NEUTRAL_OPEN_STEP = /^text-neutral-\d*$/
const NEUTRAL_500 = /^text-neutral-500(?:\/\S+)?$/
/** neutral-500이 4.5:1에 못 미치는 옅은 바탕 넷 (DOC-008 「대비 실측」 표 — 4.35 · 4.33 · 4.36 · 4.45) */
const PALE_BG = /^bg-(?:neutral-100|red-50|blue-50|sky-50)(?:\/\S+)?$/
const DARK_BG = /^bg-neutral-(?:800|900|950)$/
/** 비활성 예외로 인정하는 변형 — 이름이 정확히 이것이어야 한다(`not-disabled` · `has-disabled`는 아니다) */
const DISABLED_VARIANT = /^(?:(?:group|peer)-)?(?:aria-)?disabled(?:\/[\w-]+)?$/
const PLACEHOLDER_TEXT = new Set(['—', '-'])
/** `${}`에 붙은 자리 — 그쪽 글자가 식이라 변형 · 단계를 모른다 */
const DYNAMIC = '${…}'

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((c) => walk(c, visit))
}

/** 클래스 토큰이 들어 있을 수 있는 문자열 조각 — 템플릿은 `${}` 사이의 글자 조각마다 */
const isStringPiece = (n: ts.Node): n is ts.LiteralLikeNode =>
  ts.isStringLiteral(n) ||
  ts.isNoSubstitutionTemplateLiteral(n) ||
  ts.isTemplateHead(n) ||
  ts.isTemplateMiddle(n) ||
  ts.isTemplateTail(n)

/** 변형을 **괄호 밖의 `:`**로만 가른다 — `aria-[current=page]:` · `[&:hover]:`의 괄호 안 `:`는 가르지 않는다 */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if ((c === ']' || c === ')') && depth > 0) depth--
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  const utility = token.slice(start).replace(/^!|!$/g, '')
  return { variants: parts, utility }
}

/** 문자열 하나를 클래스 토큰으로 — 공백으로 자른다 (Tailwind가 후보를 자르는 방식) */
const classTokens = (s: string) => s.split(/\s+/).filter(Boolean)

/** 이 문자열이 어느 요소의 `className`인가 — 가장 가까운 JSX 속성이 className이 아니면 모른다 */
function classNameOwner(n: ts.Node): ts.JsxOpeningLikeElement | null {
  for (let p = n.parent; p != null; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText() === 'className' ? p.parent.parent : null
  }
  return null
}

/** 요소의 className 속성에 든 모든 문자열 조각의 토큰 */
function ownClassTokens(el: ts.JsxOpeningLikeElement): string[] {
  const out: string[] = []
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'className' || a.initializer == null) continue
    walk(a.initializer, (n) => {
      if (isStringPiece(n)) out.push(...classTokens(n.text))
    })
  }
  return out
}

function isAriaHidden(el: ts.JsxOpeningLikeElement): boolean {
  return el.attributes.properties.some((a) => {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'aria-hidden') return false
    const v = a.initializer
    if (v == null) return true
    if (ts.isStringLiteral(v)) return v.text === 'true'
    return ts.isJsxExpression(v) && v.expression?.kind === ts.SyntaxKind.TrueKeyword
  })
}

/** 자식이 글자 하나뿐이고 그 글자가 정확히 「—」나 「-」인가 */
function isPlaceholder(el: ts.JsxOpeningLikeElement): boolean {
  if (!ts.isJsxOpeningElement(el)) return false
  const kids = el.parent.children.filter(
    (c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces),
  )
  const only = kids[0]
  return kids.length === 1 && only != null && ts.isJsxText(only) && PLACEHOLDER_TEXT.has(only.text.trim())
}

/** 가장 가까운 이름 있는 함수 — `function X` 또는 `const X = () =>` (`.map((x) => …)`은 건너뛴다) */
function enclosingFunction(n: ts.Node): string | null {
  for (let p = n.parent; p != null; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name != null) return p.name.text
    if (
      (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
      ts.isVariableDeclaration(p.parent) &&
      ts.isIdentifier(p.parent.name)
    ) {
      return p.parent.name.text
    }
  }
  return null
}

/** 원장 자리의 근거 중 이 요소에서 소스로 다시 서는 것 */
function premisesOf(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): Premise[] {
  const out: Premise[] = []
  const self = ts.isJsxOpeningElement(el) ? el.parent : el
  for (let prev: ts.Node = self, p = self.parent; p != null; prev = p, p = p.parent) {
    if (ts.isJsxElement(p) && ownClassTokens(p.openingElement).some((t) => DARK_BG.test(t))) {
      if (!out.includes('DARK_PARENT')) out.push('DARK_PARENT')
    }
    const cond =
      ts.isIfStatement(p) && prev === p.thenStatement
        ? p.expression
        : ts.isConditionalExpression(p) && prev === p.whenTrue
          ? p.condition
          : null
    if (cond != null && cond.getText(sf) === 'disabled' && !out.includes('DISABLED_BRANCH')) {
      out.push('DISABLED_BRANCH')
    }
  }
  return out
}

function scanLowContrast(file: string, text: string): RawHit[] {
  const sf = parse(file, text)
  const out: RawHit[] = []
  walk(sf, (n) => {
    if (!isStringPiece(n)) return
    const body = n.text
    // 템플릿 조각의 맨 앞 · 맨 끝 토큰은 `${}`에 붙어 있을 수 있다 — 그쪽 글자는 식이다
    const gluedBefore = ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
    const gluedAfter = ts.isTemplateHead(n) || ts.isTemplateMiddle(n)
    for (const m of body.matchAll(/\S+/g)) {
      const head = gluedBefore && m.index === 0
      const tail = gluedAfter && m.index + m[0].length === body.length
      const { variants, utility } = splitVariants(m[0])
      if (!LOW_CONTRAST.test(utility) && !(tail && NEUTRAL_OPEN_STEP.test(utility))) continue
      // 모든 조각이 한 글자 구분자(따옴표 · 백틱 · `}`)로 시작한다
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf) + 1 + m.index).line + 1
      const token = `${head ? DYNAMIC : ''}${m[0]}${tail ? DYNAMIC : ''}`
      const owner = classNameOwner(n)
      const kind =
        head || tail
          ? 'REST'
          : variants.some((v) => DISABLED_VARIANT.test(v))
            ? 'DISABLED'
            : owner != null && isAriaHidden(owner)
              ? 'ARIA_HIDDEN'
              : owner != null && variants.length === 0 && isPlaceholder(owner)
                ? 'PLACEHOLDER'
                : 'REST'
      out.push({
        file,
        line,
        token,
        kind,
        tag: owner?.tagName.getText(sf) ?? null,
        within: enclosingFunction(n),
        premises: owner != null ? premisesOf(owner, sf) : [],
      })
    }
  })
  return out
}

const siteOf = (h: RawHit): LedgerSite | null =>
  LEDGER.find(
    (s) =>
      s.file === h.file &&
      s.within === h.within &&
      s.tag === h.tag &&
      s.token === h.token &&
      h.premises.includes(s.premise),
  ) ?? null

/** 원장 자리(근거까지 맞는)의 나머지는 LEDGER, 아니면 — 원장 파일 안이라도 — VIOLATION */
const classify = (hits: RawHit[]): Hit[] =>
  hits.map((h) => {
    const site = h.kind === 'REST' ? siteOf(h) : null
    return { ...h, site, kind: h.kind !== 'REST' ? h.kind : site != null ? 'LEDGER' : 'VIOLATION' }
  })

/** 한 클래스 문자열 안에 neutral-500과 옅은 바탕이 같이 있는 자리 */
function scanPaleBackground(file: string, text: string): { file: string; line: number }[] {
  const sf = parse(file, text)
  const out: { file: string; line: number }[] = []
  walk(sf, (n) => {
    const s =
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
        ? n.text
        : ts.isTemplateExpression(n)
          ? [n.head.text, ...n.templateSpans.map((x) => x.literal.text)].join(' ')
          : null
    if (s == null) return
    const utilities = classTokens(s).map((t) => splitVariants(t).utility)
    if (utilities.some((u) => NEUTRAL_500.test(u)) && utilities.some((u) => PALE_BG.test(u))) {
      out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
    }
  })
  return out
}

function srcFiles(pattern: RegExp, dir = join(ROOT, 'src')): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...srcFiles(pattern, p))
    else if (pattern.test(e.name)) out.push(relative(ROOT, p).split(/[\\/]/).join('/'))
  }
  return out.sort()
}

const FILES = srcFiles(/\.tsx?$/)
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
const HITS = classify(FILES.flatMap((f) => scanLowContrast(f, SOURCES.get(f)!)))
const where = (hs: { file: string; line: number; token?: string }[]) =>
  hs.map((h) => `${h.file}:${h.line}${h.token ? ` ${h.token}` : ''}`)

const synthIn = (file: string, src: string) => classify(scanLowContrast(file, src)).map((h) => h.kind)
const synth = (snippet: string) => synthIn('synthetic.tsx', `export const X = () => (${snippet})`)

describe('대비 가드 — DOC-008 ST-08 (홈 피드백 컷 K2)', () => {
  describe('스캐너 자기 검증 — 합성 소스가 각 갈래로 갈린다', () => {
    it.each<[string, string, Kind[]]>([
      ['정보 글자는 위반이다 — 고치기 전의 홈 ①', '<span className="text-neutral-400">판정 없음</span>', ['VIOLATION']],
      ['300도 같다', '<span className="ml-1 text-neutral-300">3건</span>', ['VIOLATION']],
      ['더 옅은 단계도 같다 — 200 (흰 바탕 1.26:1)', '<span className="text-neutral-200">3건</span>', ['VIOLATION']],
      ['더 옅은 단계도 같다 — 50', '<span className="text-neutral-50">3건</span>', ['VIOLATION']],
      ['불투명도를 낮춘 토큰도 같다', '<span className="text-neutral-400/70">3건</span>', ['VIOLATION']],
      ['중요도 표식 — 앞', '<span className="!text-neutral-400">3건</span>', ['VIOLATION']],
      ['중요도 표식 — 뒤 (v4)', '<span className="text-neutral-400!">3건</span>', ['VIOLATION']],
      ['값 없음 「—」', '<span className="text-sm text-neutral-400">—</span>', ['PLACEHOLDER']],
      ['구분 기호 「-」 — 둘레 공백은 무시', '<span className="text-neutral-300"> - </span>', ['PLACEHOLDER']],
      ['기호 + 글자는 자리표시가 아니다', '<span className="text-neutral-400">— 원</span>', ['VIOLATION']],
      ['자식 요소가 섞이면 자리표시가 아니다', '<span className="text-neutral-400">—<b>x</b></span>', ['VIOLATION']],
      ['장식', '<span aria-hidden className="text-neutral-400">→</span>', ['ARIA_HIDDEN']],
      ['장식 — 문자열 "true"', '<span aria-hidden="true" className="text-neutral-400">→</span>', ['ARIA_HIDDEN']],
      ['aria-hidden={false}는 장식이 아니다', '<span aria-hidden={false} className="text-neutral-400">→</span>', ['VIOLATION']],
      ['비활성 변형', '<button className="border disabled:text-neutral-400">저장</button>', ['DISABLED']],
      ['변형이 겹쳐도 비활성', '<button className="md:disabled:text-neutral-400">저장</button>', ['DISABLED']],
      ['aria-disabled도 비활성', '<a aria-disabled className="aria-disabled:text-neutral-400">다음</a>', ['DISABLED']],
      ['group-disabled · peer-disabled도 비활성', '<span className="group-disabled:text-neutral-400 peer-disabled/x:text-neutral-300">저장</span>', ['DISABLED', 'DISABLED']],
      // ★ 이름이 비슷해도 뜻이 반대거나 다르다 — 활성 버튼의 낮은 대비가 예외로 빠져나가는 길
      ['not-disabled는 「비활성이 아닐 때」 — 위반', '<button className="not-disabled:text-neutral-400">저장</button>', ['VIOLATION']],
      ['has-disabled는 「비활성인 자식이 있을 때」 — 위반', '<div className="has-disabled:text-neutral-400">묶음</div>', ['VIOLATION']],
      ['비활성이 아닌 변형은 위반 — 고치기 전의 펼침 표식', '<summary className="marker:text-neutral-400">지난 차수</summary>', ['VIOLATION']],
      ['hover도 위반', '<a className="hover:text-neutral-400">링크</a>', ['VIOLATION']],
      // ★ 괄호 · `*` 변형 — 토큰 안을 정규식으로 찾으면 `]` · `*` 앞에서 매치가 통째로 사라졌다(0건 · 초록)
      ['괄호 변형 — Nav의 aria-[current=page]: 꼴', '<a className="aria-[current=page]:text-neutral-400">메뉴</a>', ['VIOLATION']],
      ['괄호 변형 — data-[state=open]:', '<div className="data-[state=open]:text-neutral-400">x</div>', ['VIOLATION']],
      ['자식 변형 *:', '<ul className="*:text-neutral-400"><li>x</li></ul>', ['VIOLATION']],
      ['괄호 안의 `:`는 변형 구분이 아니다 — [&:hover]:', '<a className="[&:hover]:text-neutral-400">x</a>', ['VIOLATION']],
      // 임의 변형은 해석하지 않는다 — 뜻이 `disabled:`와 같아도 위반(보수적 오탐 · `disabled:`로 쓰면 된다)
      ['임의 변형은 해석하지 않는다 — [&:disabled]:', '<a className="[&:disabled]:text-neutral-400">x</a>', ['VIOLATION']],
      ['변형이 붙은 「—」는 자리표시로 보지 않는다', '<span className="marker:text-neutral-400">—</span>', ['VIOLATION']],
      ['템플릿 리터럴의 조각', '<span className={`${shape} text-neutral-300`}>{children}</span>', ['VIOLATION']],
      // ★ `${}`에 붙은 토큰은 앞(변형)이나 뒤(단계)가 식이라 판정할 수 없다 — 위반
      ['변형이 식이다 — `${v}:text-neutral-400`', '<span className={`${v}:text-neutral-400`}>—</span>', ['VIOLATION']],
      ['단계가 식이다 — `text-neutral-${step}`', '<span className={`p-1 text-neutral-${step}`}>—</span>', ['VIOLATION']],
      ['조건식 안의 문자열도 요소를 찾는다', "<span className={ok ? 'text-neutral-700' : 'text-neutral-400'}>—</span>", ['PLACEHOLDER']],
      ['className이 아닌 자리의 문자열은 판정할 수 없다 — 위반', "<span>{ok ? 'text-neutral-400' : ''}</span>", ['VIOLATION']],
      ['500은 대상이 아니다', '<span className="text-neutral-500">배리어</span>', []],
      ['토큰 경계', '<span className="xtext-neutral-400 text-neutral-4000 text-neutral-1000">x</span>', []],
    ])('%s', (_name, snippet, expected) => {
      expect(synth(snippet)).toEqual(expected)
    })

    it('주석 속 토큰은 세지 않는다 — 구문 트리에서 주석은 문자열이 아니다', () => {
      const src = '// text-neutral-400\n/* `text-neutral-300` */\nexport const a = 1\n'
      expect(scanLowContrast('synthetic.tsx', src)).toEqual([])
    })

    it('className 밖의 상수는 판정할 수 없다 — 위반 (모르면 통과가 아니다)', () => {
      const src = "const styles = 'border text-neutral-400'\nexport const s = styles\n"
      expect(synthIn('synthetic.ts', src)).toEqual(['VIOLATION'])
    })

    it('주석 속 백틱이 진짜 className을 가리지 않는다 — 정규식 스캐너가 놓치는 형태', () => {
      // 홀수 개의 백틱이 든 주석: 정규식으로 `…`를 짝지으면 주석의 백틱이 아래 템플릿의 **여는**
      // 백틱과 짝이 되어 `${shape} text-neutral-300`이 문자열 «밖»으로 밀려난다.
      const src =
        '// 주석 속 백틱 하나 `\n' +
        'export const X = () => <span className={`${shape} text-neutral-300`}>{children}</span>\n'
      expect(synthIn('synthetic.tsx', src)).toEqual(['VIOLATION'])
    })

    describe('원장 — 파일이 아니라 자리와 근거', () => {
      const [disabledSite, darkSite] = LEDGER
      const pageLink = (span: string, link: string) =>
        `function PageLink({ disabled }) {\n  if (disabled) {\n    return ${span}\n  }\n  return ${link}\n}\n`
      const summary = (parentBg: string, inner = '<span className="text-neutral-300">결함</span>') =>
        `function Summary() {\n  return <p className="rounded-md ${parentBg} text-white">${inner}</p>\n}\n`

      it('자리와 근거가 맞으면 LEDGER — 비활성 갈래의 <span>', () => {
        const src = pageLink('<span className="text-neutral-300">1</span>', '<a className="text-neutral-700">1</a>')
        expect(synthIn(disabledSite!.file, src)).toEqual(['LEDGER'])
      })

      it('자리와 근거가 맞으면 LEDGER — 어두운 부모 바탕', () => {
        expect(synthIn(darkSite!.file, summary('bg-neutral-800'))).toEqual(['LEDGER'])
      })

      it('★ 원장 파일 안이라도 다른 자리는 위반 — 활성 갈래 · 다른 함수 · 다른 요소 · 다른 토큰', () => {
        // 활성 갈래(링크)
        expect(
          synthIn(disabledSite!.file, pageLink('<span className="text-neutral-700">1</span>', '<a className="text-neutral-300">1</a>')),
        ).toEqual(['VIOLATION'])
        // 다른 함수
        expect(synthIn(darkSite!.file, summary('bg-neutral-800').replace('Summary', 'Header'))).toEqual(['VIOLATION'])
        // 다른 요소
        expect(synthIn(darkSite!.file, summary('bg-neutral-800', '<em className="text-neutral-300">결함</em>'))).toEqual(['VIOLATION'])
        // 다른 토큰
        expect(synthIn(darkSite!.file, summary('bg-neutral-800', '<span className="text-neutral-400">결함</span>'))).toEqual(['VIOLATION'])
      })

      it('★ 근거가 소스에서 더는 서지 않으면 위반 — 부모 바탕이 흰색 · hover에만 어둡다 · 다른 조건', () => {
        expect(synthIn(darkSite!.file, summary('bg-white'))).toEqual(['VIOLATION'])
        expect(synthIn(darkSite!.file, summary('hover:bg-neutral-800'))).toEqual(['VIOLATION'])
        const other = pageLink('<span className="text-neutral-300">1</span>', '<a className="text-neutral-700">1</a>').replace(
          'if (disabled)',
          'if (first)',
        )
        expect(synthIn(disabledSite!.file, other)).toEqual(['VIOLATION'])
      })

      it('삼항의 참 갈래도 비활성 갈래다', () => {
        const src =
          'function PageLink({ disabled }) {\n' +
          '  return disabled ? <span className="text-neutral-300">1</span> : <a className="text-neutral-300">1</a>\n}\n'
        expect(synthIn(disabledSite!.file, src)).toEqual(['LEDGER', 'VIOLATION'])
      })
    })

    it.each<[string, string, number]>([
      ['옅은 파랑 바탕 + 500', '<div className="bg-blue-50 text-neutral-500">x</div>', 1],
      ['템플릿 조각에 나뉘어도 한 문자열이다', '<div className={`${x} bg-red-50 p-2 text-neutral-500`}>x</div>', 1],
      ['hover 바탕도 그 순간의 바탕이다', '<a className="hover:bg-neutral-100 text-neutral-500">x</a>', 1],
      ['괄호 변형의 바탕 · 글자도 같다', '<a className="aria-[current=page]:bg-sky-50 *:text-neutral-500">x</a>', 1],
      ['중요도 표식이 붙어도 같다', '<div className="!bg-blue-50 text-neutral-500!">x</div>', 1],
      ['sky-50', '<div className="rounded bg-sky-50 text-neutral-500">x</div>', 1],
      ['neutral-50은 허용 (4.54:1)', '<div className="bg-neutral-50 text-neutral-500">x</div>', 0],
      ['amber-50은 허용 (4.57:1)', '<div className="bg-amber-50 text-neutral-500">x</div>', 0],
      ['red-500은 다른 토큰이다', '<div className="bg-red-500 text-neutral-500">x</div>', 0],
      // ★ 한계를 고정한다 — 바탕이 부모에 있으면 보이지 않는다(DOC-010 AQ-103 ⓐ 상속).
      ['상속은 보지 못한다 (AQ-103)', '<div className="bg-blue-50"><span className="text-neutral-500">x</span></div>', 0],
    ])('조합 — %s', (_name, snippet, expected) => {
      expect(scanPaleBackground('synthetic.tsx', `export const X = () => (${snippet})`)).toHaveLength(expected)
    })
  })

  it('전제 — src를 실제로 걷었고 토큰을 찾았다', () => {
    // 0건을 찾으면 아래 단언이 전부 항진명제가 된다.
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES).toContain('src/components/home/HomeSections.tsx')
    expect(HITS.filter((h) => h.kind === 'PLACEHOLDER').length).toBeGreaterThan(0)
  })

  it('전제 — neutral 밖의 회색 계열(gray · zinc · slate · stone) 클래스가 src에 없다 — 팔레트를 재지 않았다', () => {
    const found = FILES.flatMap((f) =>
      [...SOURCES.get(f)!.matchAll(/(?<![\w-])(?:[\w-]+-)?(?:gray|zinc|slate|stone)-\d+(?![\w-])/g)].map(
        (m) => `${f} ${m[0]}`,
      ),
    )
    expect(found, '쓰려면 그 계열의 대비를 이 파일의 팔레트 실측에 더한다').toEqual([])
  })

  it('★ 정보를 나르는 글자에 neutral-400 이하가 없다 — VIOLATION 0건', () => {
    expect(
      where(HITS.filter((h) => h.kind === 'VIOLATION')),
      '정보 글자는 neutral-600(흰 바탕 7.81:1) 이상으로 올린다. 장식이면 aria-hidden, ' +
        '클래스로 가를 수 없는 자리면 LEDGER에 근거와 함께 등재한다 — DOC-008 ST-08',
    ).toEqual([])
  })

  it('「—」 · 「-」 건수 원장 — 파일별로 늘거나 줄면 빨간불 (DOC-010 AQ-104)', () => {
    const observed: Record<string, number> = {}
    for (const h of HITS.filter((x) => x.kind === 'PLACEHOLDER')) {
      observed[h.file] = (observed[h.file] ?? 0) + 1
    }
    expect(observed).toEqual(PLACEHOLDER_LEDGER)
    expect(Object.values(PLACEHOLDER_LEDGER).reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('원장이 낡지 않았다 — 자리마다 정확히 한 번 잡히고 근거가 선다', () => {
    for (const s of LEDGER) {
      expect(FILES, `원장의 ${s.file}가 실재하지 않는다`).toContain(s.file)
      expect(s.reason.length, `${s.file}의 사유가 비었다`).toBeGreaterThan(0)
      expect(
        where(HITS.filter((h) => h.site === s)),
        `${s.file} ${s.within} <${s.tag}> ${s.token}(${s.premise}) — 자리가 없어졌거나 근거가 무너졌으면 ` +
          '원장을 고치고, 같은 자리가 둘이 되었으면 새 자리를 판단한다',
      ).toHaveLength(1)
    }
    expect(HITS.filter((h) => h.kind === 'LEDGER')).toHaveLength(LEDGER.length)
  })

  it('★ neutral-500과 옅은 바탕 넷이 한 클래스 문자열에 없다 (4.33 ~ 4.45:1)', () => {
    const found = FILES.flatMap((f) => scanPaleBackground(f, SOURCES.get(f)!))
    expect(
      where(found),
      '그 바탕 위의 회색 글자는 neutral-600 이상이다 — 또는 바탕을 깔지 말고 흰 바탕에 띠(SCR-101 ⑥)',
    ).toEqual([])
  })

  describe('팔레트 실측 — node_modules/tailwindcss/theme.css의 무채색', () => {
    const css = readFileSync(join(ROOT, 'node_modules/tailwindcss/theme.css'), 'utf8')
    const neutral = new Map<number, { L: number; chroma: string }>()
    for (const m of css.matchAll(/--color-neutral-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\w.]+)\)/g)) {
      neutral.set(Number.parseInt(m[1]!, 10), { L: Number.parseFloat(m[2]!) / 100, chroma: m[3]! })
    }
    /**
     * 무채색(C = 0)이면 OKLab의 l = m = s = L이고 OKLab → 선형 sRGB 행렬의 각 행 합이 1이라
     * r = g = b = L³ — 상대 휘도가 **정확히** L³이다(8비트 반올림 없이 · DOC-008 「대비 실측」 방법).
     */
    const Y = (step: number) => neutral.get(step)!.L ** 3
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const WHITE = 1

    it('전제 — 앱이 이 값을 쓴다: src의 CSS가 tailwindcss를 들이고 neutral을 덮어쓰지 않는다', () => {
      const sheets = srcFiles(/\.css$/)
      expect(sheets).toContain('src/app/globals.css')
      expect(readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')).toMatch(/@import\s+["']tailwindcss["']/)
      for (const f of sheets) {
        expect(readFileSync(join(ROOT, f), 'utf8'), `${f}가 neutral 팔레트를 덮어쓴다 — 측정 대상과 렌더 대상이 갈린다`).not.toMatch(
          /--color-neutral-/,
        )
      }
    })

    it('전제 — neutral 열한 단계를 읽었고 전부 무채색이며 단계가 갈수록 어두워진다', () => {
      expect([...neutral.keys()]).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
      for (const { chroma } of neutral.values()) expect(Number.parseFloat(chroma)).toBe(0)
      const Ls = [...neutral.values()].map((v) => v.L)
      expect(Ls).toEqual([...Ls].sort((a, b) => b - a))
    })

    it('흰 바탕 — 50 ~ 400은 4.5:1 미만, 500 · 600 · 700은 이상', () => {
      for (const s of [50, 100, 200, 300, 400]) expect(ratio(Y(s), WHITE), `neutral-${s}`).toBeLessThan(4.5)
      for (const s of [500, 600, 700]) {
        expect(ratio(Y(s), WHITE), `neutral-${s}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('neutral-50 바탕은 500을 허용하고 neutral-100 바탕은 금지한다 — ST-08의 바탕 목록 근거', () => {
      for (const s of [500, 600, 700]) {
        expect(ratio(Y(s), Y(50)), `neutral-${s} on neutral-50`).toBeGreaterThanOrEqual(4.5)
      }
      expect(ratio(Y(500), Y(100)), 'neutral-500 on neutral-100').toBeLessThan(4.5)
      expect(ratio(Y(600), Y(100)), 'neutral-600 on neutral-100').toBeGreaterThanOrEqual(4.5)
    })
  })
})
