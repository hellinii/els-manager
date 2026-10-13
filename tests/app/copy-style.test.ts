import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import type { EvaluationVerdictKind, EvaluationVerdictView } from '@/lib/db/queries/map'
import type { CouponPayout } from '@/lib/domain'
import {
  EMPTY_STATES,
  EVALUATION_VERDICT_FRESH_DAYS,
  EVALUATION_VERDICT_LABELS,
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  GAP_TIER_LABELS,
  MONTHLY_COUPON_ESTIMATE_NOTE,
  SCOPE_LABELS,
  SECTION_EMPTY,
  SETTINGS_FOREIGN_DISCLAIMER,
  TAX_METHOD_VERDICT_LABELS,
  YEAR_TAX_TEXT,
  convertedIncludedLine,
  evaluationVerdictSentence,
  exchangeRateMissingLead,
  exchangeRateMissingNotice,
  missingUpcomingNote,
  type ExchangeRateMissing,
} from '@/lib/format'

import { liveDoc, quoteBlock } from './docText'

/**
 * 화면 글자의 문체를 사람이 세지 않는다 — DOC-005 §2.1 (홈 피드백 컷 K7 골격 · 원장 완성 K12)
 *
 * ## 왜 이 파일이 있는가
 *
 * §2.1은 안내문을 해요체로, 라벨 · 배지 · 상태 · 빈 상태 제목을 명사형으로 정했다(민서 결정(2026-10-12) D4). 화면 글자는
 * 앱 전체가 「~다」체였으므로 **고친 자리가 다시 미끄러져도 빨개지는 테스트가 없다** — 대비 가드(`contrast-guard.test.ts`)와
 * 같은 부류의 성질이다. 그래서 싼 층(문자열 · 함수 출력)에서 볼 수 있는 만큼 본다.
 *
 * ## 무엇을 단언하는가
 *
 * 1. **스캐너가 살아 있다** — 합성 입력에서 평서 종결을 잡고 명사형 · 해요체 · 「마다」 · 「보다」를 잡지 않는다. 파일
 *    스캐너는 주석을 보지 않고(구문 트리의 문자열 · JSX 글자만) 실제 파일에서 0보다 큰 수를 낸다(`errors.ts` — 서버
 *    메시지는 아직 다체다, DOC-008 SQ-23 ⓑ)
 * 2. **원장의 파일은 평서 종결이 0이다** — ~~원장은 아직 비어 있다~~ → 원장이 섰다 *(홈 피드백 컷 K12)*: 홈 다섯 파일
 *    (`HomeSections.tsx` · `app/(app)/page.tsx` · `lib/format/dashboard.ts` · `lib/format/emptyState.ts` ·
 *    `ExchangeRateMissingNotice.tsx`). 다음 컷이 파일을 통째로 고칠 때마다 더한다(DOC-008 SQ-23 ⓔ)
 * 3. **이미 고친 함수의 출력은 전 갈래가 해요체다** — 평가일 판정 문장(판정 넷 × 경과 일수 × 주말 × 지급방식 · K7)과
 *    ① · SCR-301의 빈 줄(K4), ③의 안내 여섯(`YEAR_TAX_TEXT` — K10)과 화면 빈 상태의 설명 여덟(`EMPTY_STATES` — K12).
 *    평서 종결 0이고 해요체 종결이 하나 이상이며 「~요.」로 끝난다. **홈이 공유하는 문장**
 *    (ST-07 세 형태 · 링크 글자 · 환산 포함 줄 · 월지급 면책 · SCR-502 달러 문장 — K8)도 평서 종결 0 · 해요체 종결 하나
 *    이상이다(끝은 링크 글자 · 근거 괄호 · 부르는 자리의 마침표라 「~요.」를 요구하지 않는다)
 * 4. **라벨은 명사형이다** — 종결어미 · 마침표 · 「요」로 끝나지 않는다(판정 라벨 · 절 빈 상태 제목 · 여유폭 단계 · 표시
 *    범위 · ③의 판정 제목과 칸 글자 · 화면 빈 상태의 제목과 행동 — K12)
 * 5. **SCR-502 면책 상자는 상자 전체가 해요체다**(민서 결정(2026-10-13) D8 · K8) — h2 「면책 고지」의 절을 구문 트리에서
 *    잘라 그 JSX 글자만 본다. 파일 전체를 원장에 올리지 않는 이유는 상자 밖(앱 정보 · 계정 안내)이 아직 다체라서다.
 *    **그 문단 셋은 DOC-008 SCR-502 각주와 바이트로 같다** *(K12)* — 절의 `<p>`를 편 글(`<strong>` → `**…**` · JSX 줄바꿈
 *    공백 규칙)이 그 각주에 「」째로 있다. K8은 문체만 보고 글자는 묶지 않았다
 *
 * **보지 못하는 것** — 원장 밖 파일의 JSX 글자, 개발자용 예외와 화면 글자의 구별(파일 단위로 원장에 올릴 때 사람이
 * 가른다), 문장의 길이 · 반복(§2.1 「한 사실에 한 문장」).
 *
 * **린트도 브라우저도 실행하지 않는다** — 파일시스템 읽기와 구문 분석뿐이다(ADR-003).
 */

const ROOT = process.cwd()

/**
 * 평서 종결 「~다」 — 문장 끝(구두점 · 괄호 · 공백 · 대시 · 조각 끝) 앞의 「다」. 여는 괄호는 근거 괄호다(「충족했다(추정)」).
 * 「마다」 · 「보다」는 종결이 아니다. 「~다면」 · 「~다고」처럼 뒤에 글자가 붙으면 종결이 아니다.
 */
function declarativeEndings(text: string): string[] {
  return [...text.matchAll(/[가-힣]다(?=[.,!?」』()\]\s—:;]|$)/g)]
    .map((m) => m[0])
    .filter((w) => w !== '마다' && w !== '보다')
}

/** 해요체 종결 — 「~요」 뒤에 구두점 · 여는 괄호(근거 괄호) · 닫는 따옴표 · 공백 · 끝 */
const POLITE_ENDING = /요(?=[.,!?」)(\s]|$)/

function sourceOf(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/** 파일의 화면 글자 후보 — 문자열 조각 · 템플릿 조각 · JSX 글자. 주석은 구문 트리에 없으므로 보지 않는다 */
function textFragments(file: string, text: string): string[] {
  return fragmentsUnder(sourceOf(file, text))
}

/** 한 노드 아래의 화면 글자 후보 — `textFragments`의 본체(파일 전체가 아니라 절 하나를 볼 때도 쓴다) */
function fragmentsUnder(root: ts.Node): string[] {
  const out: string[] = []
  const walk = (n: ts.Node): void => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text)
    } else if (ts.isJsxText(n) && !n.containsOnlyTriviaWhiteSpaces) {
      out.push(n.text.trim())
    }
    n.forEachChild(walk)
  }
  walk(root)
  return out
}

/**
 * `<h2>{heading}</h2>`을 직접 자식으로 둔 JSX 요소 — 화면의 절 하나(제목 + 상자). 몇 개를 찾았는지 그대로 돌려준다
 * (부르는 쪽이 정확히 하나임을 단언한다 — 0개를 자르고 초록이 되지 않게)
 */
function sectionsByHeading(sf: ts.SourceFile, heading: string): ts.JsxElement[] {
  const found: ts.JsxElement[] = []
  const isHeading = (c: ts.JsxChild): boolean =>
    ts.isJsxElement(c) &&
    c.openingElement.tagName.getText(sf) === 'h2' &&
    c.children.some((t) => ts.isJsxText(t) && t.text.trim() === heading)
  const walk = (n: ts.Node): void => {
    if (ts.isJsxElement(n) && n.children.some(isHeading)) found.push(n)
    n.forEachChild(walk)
  }
  walk(sf)
  return found
}

const fileEndings = (file: string): string[] =>
  textFragments(file, readFileSync(join(ROOT, file), 'utf8')).flatMap(declarativeEndings)

/**
 * 문체를 다 고친 파일 — **평서 종결이 0이어야 한다.** 파일이 통째로 §2.1을 따를 때만 올린다(한 줄이라도 다체가 남으면
 * 올리지 않는다 — 파일별 건수 원장으로 두면 고친 자리와 남은 자리가 섞여 미끄러짐이 보이지 않는다).
 *
 * 홈 피드백 컷 K12가 채웠다 — 홈의 화면 파일 둘과 홈이 글자를 가져오는 모듈 셋. `verdict.ts`는 판정 문장이 해요체여도
 * SCR-203의 `redeemPrefillNote`가 다체라 올릴 수 없다(SQ-23). `products/page.tsx`는 지금 0이지만 그 화면의 빈 상태 글자가
 * 이제 `emptyState.ts`에 있어 올려도 지키는 것이 없다 — 화면을 통째로 고치는 컷이 올린다
 */
const COPY_STYLE_DONE: readonly string[] = [
  'src/components/home/HomeSections.tsx',
  'src/app/(app)/page.tsx',
  'src/lib/format/dashboard.ts',
  'src/lib/format/emptyState.ts',
  'src/components/display/ExchangeRateMissingNotice.tsx',
]

describe('스캐너가 살아 있다 — 아래 단언이 항진명제가 아니다', () => {
  it('평서 종결을 잡고 명사형 · 해요체 · 「마다」 · 「보다」 · 「~다면」을 잡지 않는다', () => {
    expect(declarativeEndings('환율이 없다.')).toEqual(['없다'])
    expect(declarativeEndings('조건을 충족했다(추정). 상환되었으면 기록한다.')).toEqual(['했다', '한다'])
    expect(declarativeEndings('직접 확인한다 — 증권사')).toEqual(['한다'])
    expect(declarativeEndings('주의 상태 상품 없음')).toEqual([])
    expect(declarativeEndings('사라져요. 상환됐다면 기록하세요.')).toEqual([])
    expect(declarativeEndings('평가일마다 보다 많이')).toEqual([])
  })

  it('파일 스캐너는 주석을 보지 않고 문자열 · JSX 글자를 본다(합성 소스)', () => {
    const src = [
      '// 주석은 화면 글자가 아니다.',
      '/** 이것도 아니다. */',
      "const a = '문자열은 본다.'",
      'const b = `템플릿도 ${a} 본다.`',
      'export const C = () => <p>JSX 글자도 본다.</p>',
    ].join('\n')
    expect(textFragments('synthetic.tsx', src).flatMap(declarativeEndings)).toEqual(['본다', '본다', '본다'])
  })

  it('절 자르기는 그 h2의 절만 본다 — 옆 절의 다체를 잡지 않는다(합성 소스)', () => {
    const src = [
      'export const P = () => (',
      '  <section>',
      '    <div><h2>면책 고지</h2><p>추정이에요.</p></div>',
      '    <div><h2>계정</h2><p>바꾸지 않는다.</p></div>',
      '  </section>',
      ')',
    ].join('\n')
    const sf = sourceOf('synthetic.tsx', src)
    const sections = sectionsByHeading(sf, '면책 고지')
    expect(sections).toHaveLength(1)
    expect(fragmentsUnder(sections[0]!)).toEqual(['면책 고지', '추정이에요.'])
    expect(fragmentsUnder(sectionsByHeading(sf, '계정')[0]!).flatMap(declarativeEndings)).toEqual(['는다'])
  })

  it('실제 파일을 읽는다 — 서버 메시지(`errors.ts`)에는 아직 평서 종결이 있다(SQ-23 ⓑ)', () => {
    expect(fileEndings('src/lib/db/mutations/errors.ts').length).toBeGreaterThan(0)
  })
})

describe('원장 — 문체를 다 고친 파일은 평서 종결 0', () => {
  it('전제 — 원장의 파일이 실재하고 화면 글자 후보를 실제로 담는다(빈 파일 · 지운 파일을 0으로 세지 않는다)', () => {
    expect(COPY_STYLE_DONE.length).toBeGreaterThan(0)
    for (const file of COPY_STYLE_DONE) {
      expect(textFragments(file, readFileSync(join(ROOT, file), 'utf8')).length, file).toBeGreaterThan(0)
    }
  })

  it.each(COPY_STYLE_DONE)('%s', (file) => {
    expect(fileEndings(file)).toEqual([])
  })
})

/**
 * ③의 글자(`YEAR_TAX_TEXT` — 홈 피드백 컷 K10)를 안내와 라벨로 가른다. **`Record`라 키가 늘면 typecheck가 여기서 막는다** —
 * 가르지 않은 새 글자가 아무 단언도 받지 않고 지나가지 않게. 판정 본문 둘은 한 키 아래 판정마다 하나다
 */
type YearTaxKey = Exclude<keyof typeof YEAR_TAX_TEXT, 'verdictBody'> | `verdictBody.${keyof typeof YEAR_TAX_TEXT.verdictBody}`
const YEAR_TAX_KIND: Record<YearTaxKey, 'GUIDE' | 'LABEL'> = {
  'verdictBody.COMPREHENSIVE': 'GUIDE',
  'verdictBody.SEPARATE': 'GUIDE',
  profileMissing: 'LABEL',
  atLeast: 'LABEL',
  profileMissingNote: 'GUIDE',
  profileMissingResolve: 'GUIDE',
  profileLink: 'LABEL',
  zeroIsNormal: 'GUIDE',
  basisSummary: 'LABEL',
  estimateBasis: 'GUIDE',
}
function yearTaxText(key: YearTaxKey): string {
  if (key === 'verdictBody.COMPREHENSIVE') return YEAR_TAX_TEXT.verdictBody.COMPREHENSIVE
  if (key === 'verdictBody.SEPARATE') return YEAR_TAX_TEXT.verdictBody.SEPARATE
  return YEAR_TAX_TEXT[key]
}
const YEAR_TAX_KEYS = Object.keys(YEAR_TAX_KIND) as YearTaxKey[]
const YEAR_TAX_GUIDES = YEAR_TAX_KEYS.filter((key) => YEAR_TAX_KIND[key] === 'GUIDE')
const YEAR_TAX_LABELS = YEAR_TAX_KEYS.filter((key) => YEAR_TAX_KIND[key] === 'LABEL')

describe('③의 글자 — 안내 · 라벨 가름이 전수다 (홈 피드백 컷 K12)', () => {
  it('전제 — 가름표가 `YEAR_TAX_TEXT`의 글자 전부를 정확히 한 번 덮는다(판정 본문은 판정마다)', () => {
    const actual = Object.entries(YEAR_TAX_TEXT).flatMap(([key, value]) =>
      typeof value === 'string' ? [key] : Object.keys(value).map((verdict) => `${key}.${verdict}`),
    )
    expect([...YEAR_TAX_KEYS].sort()).toEqual(actual.sort())
    expect(YEAR_TAX_GUIDES.length).toBe(6)
    expect(YEAR_TAX_LABELS.length).toBe(4)
  })
})

describe('이미 고친 함수의 출력 — 전 갈래가 해요체 (DOC-005 §2.1 안내문)', () => {
  const KINDS = Object.keys(EVALUATION_VERDICT_LABELS) as EvaluationVerdictKind[]
  const CONTEXTS: Array<{ couponPayout: CouponPayout } | null> = [
    { couponPayout: 'MONTHLY' },
    { couponPayout: 'AT_REDEMPTION' },
    null,
  ]

  /**
   * 판정 넷 × 경과(다음 날 이내 · 그 뒤) × 주말 × 지급방식 셋. 종가 없음의 결측 자산은 **둘짜리 한 가지**다 — 자산 수는
   * 괄호 안 이름 나열만 바꾸고 종결어미와 무관하다(홈 피드백 컷 K8에서 주석을 실제 갈래에 맞췄다 — 종전 「0 · 1 · 2」는 거짓)
   */
  function verdictOutputs(): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (const kind of KINDS) {
      for (const dDay of [-1, -EVALUATION_VERDICT_FRESH_DAYS - 1]) {
        for (const weekendEvaluation of [false, true]) {
          for (const context of CONTEXTS) {
            const view: EvaluationVerdictView = {
              kind,
              roundNo: 2,
              evaluationDate: '2026-09-15',
              dDay,
              worstOf: kind === 'EARLY' || kind === 'LIZARD' ? '0.8145' : null,
              barrier: kind === 'EARLY' || kind === 'LIZARD' ? '0.8000' : null,
              missingAssets:
                kind === 'CLOSE_MISSING'
                  ? [
                      { assetId: 'a', assetName: '코스피200' },
                      { assetId: 'b', assetName: 'S&P500' },
                    ]
                  : null,
              weekendEvaluation,
            }
            const label = `${kind} · D${dDay} · 주말 ${weekendEvaluation} · ${context?.couponPayout ?? 'null'}`
            out.push([label, evaluationVerdictSentence(view, context)])
          }
        }
      }
    }
    return out
  }

  it('전제 — 갈래를 실제로 다 만들었다(판정 넷 × 2 × 2 × 3)', () => {
    expect(KINDS).toHaveLength(4)
    const outputs = verdictOutputs()
    expect(outputs).toHaveLength(48)
    // 덧붙임 셋이 갈래 안에 실제로 있다 — 없으면 덧붙임의 문체는 아무도 보지 않는다
    expect(outputs.some(([, text]) => text.includes('주말'))).toBe(true)
    expect(outputs.some(([, text]) => text.includes('다음 날 오후'))).toBe(true)
    expect(outputs.some(([, text]) => text.includes('월수익'))).toBe(true)
  })

  it.each([
    ...verdictOutputs(),
    ['① 빈 줄 · ⑥ 있음', missingUpcomingNote('HOME', 1)],
    ['SCR-301 빈 줄', missingUpcomingNote('SCHEDULE')],
    ...YEAR_TAX_GUIDES.map((key): [string, string] => [`③ ${key}`, yearTaxText(key)]),
    ...(Object.keys(EMPTY_STATES) as Array<keyof typeof EMPTY_STATES>).map((key): [string, string] => [
      `화면 빈 상태 설명 · ${key}`,
      EMPTY_STATES[key].description,
    ]),
  ])('%s', (_label, text) => {
    expect(declarativeEndings(text)).toEqual([])
    expect(text).toMatch(POLITE_ENDING)
    expect(text).toMatch(/요\.$/)
  })
})

describe('라벨은 명사형 — 종결어미 · 마침표 · 「요」로 끝나지 않는다 (DOC-005 §2.1)', () => {
  it.each([
    ...Object.values(EVALUATION_VERDICT_LABELS),
    ...Object.values(SECTION_EMPTY),
    // 홈 피드백 컷 K12 — 홈이 그리는 나머지 라벨 · 제목 · 버튼 글자
    ...Object.values(GAP_TIER_LABELS),
    ...Object.values(SCOPE_LABELS),
    ...Object.values(TAX_METHOD_VERDICT_LABELS),
    ...YEAR_TAX_LABELS.map(yearTaxText),
    ...Object.values(EMPTY_STATES).flatMap((text) => [text.title, text.action]),
  ])('%s', (label) => {
    expect(declarativeEndings(label)).toEqual([])
    expect(label).not.toMatch(/[.요]$/)
  })
})

describe('홈이 공유하는 문장 — ST-07 · 환산 포함 줄 · 면책 둘이 해요체 (홈 피드백 컷 K8 · DOC-005 §2.1)', () => {
  /** ST-07의 종류 전수 — `Record`가 빠짐을 typecheck에서 잡는다(새 형태가 생기면 여기가 빨갛다) */
  const ST07_KINDS: Record<ExchangeRateMissing['kind'], true> = { COUNT: true, PRODUCT: true, FORECAST: true }
  const MISSING: ExchangeRateMissing[] = [{ kind: 'COUNT', count: 2 }, { kind: 'PRODUCT' }, { kind: 'FORECAST', count: 3 }]
  const BASIS = { rate: '1392.400000', asOfDate: '2026-09-28', isStale: false }

  function sharedOutputs(): Array<[string, string]> {
    return [
      ...MISSING.map((m): [string, string] => [`ST-07 앞절 · ${m.kind}`, exchangeRateMissingLead(m)]),
      ...MISSING.map((m): [string, string] => [`ST-07 한 줄 · ${m.kind}`, exchangeRateMissingNotice(m)]),
      ['ST-07 링크 글자', EXCHANGE_RATE_INPUT_LINK_LABEL],
      ['SCR-101 ③ 환산 포함 줄', convertedIncludedLine(2, BASIS)],
      ['SCR-101 ③ 환산 포함 줄 · 환율 오래됨', convertedIncludedLine(2, { ...BASIS, isStale: true })],
      ['월지급 면책 (SCR-101 ③ · SCR-401 · SCR-502)', MONTHLY_COUPON_ESTIMATE_NOTE],
      ['SCR-502 달러 문장', SETTINGS_FOREIGN_DISCLAIMER],
    ]
  }

  it('전제 — 갈래를 실제로 다 만들었다(ST-07 셋 × 앞절 · 한 줄 + 링크 글자 + 환산 둘 + 면책 둘)', () => {
    expect(MISSING.map((m) => m.kind).sort()).toEqual(Object.keys(ST07_KINDS).sort())
    expect(sharedOutputs()).toHaveLength(11)
  })

  it.each(sharedOutputs())('%s', (_label, text) => {
    expect(declarativeEndings(text)).toEqual([])
    expect(text).toMatch(POLITE_ENDING)
  })
})

describe('SCR-502 면책 상자 — 상자 전체가 해요체 (민서 결정(2026-10-13) D8 · DOC-005 §2.1 「섞지 않는 단위는 상자다」)', () => {
  const FILE = 'src/app/(app)/settings/page.tsx'
  const sf = sourceOf(FILE, readFileSync(join(ROOT, FILE), 'utf8'))
  const sections = sectionsByHeading(sf, '면책 고지')

  it('전제 — 절이 정확히 하나이고 문단 셋의 글자와 상자가 잇는 상수 둘이 그 안에 있다', () => {
    expect(sections).toHaveLength(1)
    const section = sections[0]!
    const text = fragmentsUnder(section).join(' ')
    for (const phrase of ['투자 권유', '세금·건강보험료도', '사용자가 입력한 값']) expect(text).toContain(phrase)
    const source = section.getText(sf)
    expect(source).toContain('{SETTINGS_FOREIGN_DISCLAIMER}')
    expect(source).toContain('{MONTHLY_COUPON_ESTIMATE_NOTE}')
  })

  it('절의 JSX 글자에 평서 종결이 없다 — 상수 둘은 위 describe가 본다', () => {
    expect(fragmentsUnder(sections[0]!).flatMap(declarativeEndings)).toEqual([])
  })
})

describe('SCR-502 면책 문단 셋 ↔ DOC-008 SCR-502 「면책 상자 전체를 해요체로」 (살아 있는 글 · 그 각주 하나 · 홈 피드백 컷 K12)', () => {
  /*
   * K8은 이 상자의 **문체**만 봤다 — 각주에 적은 문단 셋은 화면 글자와 묶이지 않아, 화면 문장을 고쳐도 각주가 낡는 것을
   * 아무것도 보지 않았다(K8 검증 지적). 그래서 절의 `<p>`를 편 글을 그 각주와 「」째로 대조한다. 펴는 규칙:
   * `<strong>` → `**…**`(각주가 굵은 글을 그렇게 적는다) · JSX 글의 줄바꿈 공백 규칙(React — 줄을 다듬고 공백 하나로
   * 잇는다) · `{' '}`는 그 글자 · 주석 표현식은 빈 글 · **상수 표현식(`{SETTINGS_FOREIGN_DISCLAIMER}`)에서 멈춘다** — 두
   * 상수는 각자의 정본 블록과 따로 묶여 있다(`exchangeRate.test.ts` · `coupon-tax-text.test.ts`)
   */
  const FILE = 'src/app/(app)/settings/page.tsx'
  const sf = sourceOf(FILE, readFileSync(join(ROOT, FILE), 'utf8'))
  const section = sectionsByHeading(sf, '면책 고지')[0]
  const paragraphs = section == null ? [] : paragraphsUnder(section, sf).map((p) => spelled(p, sf))
  const block = quoteBlock(liveDoc('08_정보구조_및_화면목록.md'), '> **면책 상자 전체를 해요체로 (v2.51')

  it('전제 — 문단이 셋이고 편 글이 비지 않았다 · 둘째는 상수 앞에서 멈췄다', () => {
    expect(paragraphs).toHaveLength(3)
    for (const text of paragraphs) expect(text.length).toBeGreaterThan(20)
    expect(paragraphs[1]).not.toContain('달러')
  })

  it('JSX 공백 규칙 — 줄바꿈이 있는 글은 줄을 다듬어 공백 하나로 잇고, 없는 글은 그대로다(합성 소스)', () => {
    const src = ['export const P = () => (', '  <p>', '    <strong>굵게.</strong>{\' \'}', '    앞줄 끝,', '    다음 줄.{X}뒤', '  </p>', ')'].join('\n')
    const synthetic = sourceOf('synthetic.tsx', src)
    const found = paragraphsUnder(synthetic, synthetic)
    expect(found).toHaveLength(1)
    expect(spelled(found[0]!, synthetic)).toBe('**굵게.** 앞줄 끝, 다음 줄.')
  })

  it.each(paragraphs.map((text, i) => [i + 1, text] as const))('문단 %s — 그 각주에 「」째로 있다', (_n, text) => {
    expect(block).toContain(`「${text}」`)
  })
})

/** 한 노드 아래의 `<p>` 요소 — 문서 순서 */
function paragraphsUnder(root: ts.Node, sf: ts.SourceFile): ts.JsxElement[] {
  const out: ts.JsxElement[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === 'p') out.push(n)
    n.forEachChild(walk)
  }
  walk(root)
  return out
}

/** JSX 글의 줄바꿈 공백 규칙 — 줄바꿈이 있으면 줄마다 다듬고(첫 줄의 앞 · 끝 줄의 뒤는 남긴다) 빈 줄을 빼고 공백 하나로 잇는다 */
function jsxTextValue(raw: string): string {
  if (!/[\r\n]/.test(raw)) return raw
  const lines = raw.split(/\r\n|\n|\r/)
  return lines
    .map((line, i) => {
      let t = line.replace(/\t/g, ' ')
      if (i !== 0) t = t.replace(/^ +/, '')
      if (i !== lines.length - 1) t = t.replace(/ +$/, '')
      return t
    })
    .filter((t) => t !== '')
    .join(' ')
}

/** 문단 하나를 편 글 — 상수 표현식에서 멈춘다(위 describe의 각주). 모르는 꼴은 던진다(조용히 빼고 초록이 되지 않게) */
function spelled(element: ts.JsxElement, sf: ts.SourceFile): string {
  let out = ''
  let stopped = false
  const visit = (children: ts.NodeArray<ts.JsxChild>): void => {
    for (const child of children) {
      if (stopped) return
      if (ts.isJsxText(child)) out += jsxTextValue(child.text)
      else if (ts.isJsxElement(child) && child.openingElement.tagName.getText(sf) === 'strong') {
        out += '**'
        visit(child.children)
        out += '**'
      } else if (ts.isJsxExpression(child)) {
        if (child.expression == null) continue
        if (ts.isStringLiteral(child.expression)) out += child.expression.text
        else if (ts.isIdentifier(child.expression)) stopped = true
        else throw new Error(`모르는 표현식: ${child.getText(sf)}`)
      } else throw new Error(`모르는 자식: ${child.getText(sf)}`)
    }
  }
  visit(element.children)
  return out.trim()
}
