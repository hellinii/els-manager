import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import type { EvaluationVerdictKind, EvaluationVerdictView } from '@/lib/db/queries/map'
import type { CouponPayout } from '@/lib/domain'
import {
  EVALUATION_VERDICT_FRESH_DAYS,
  EVALUATION_VERDICT_LABELS,
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  MONTHLY_COUPON_ESTIMATE_NOTE,
  SECTION_EMPTY,
  SETTINGS_FOREIGN_DISCLAIMER,
  convertedIncludedLine,
  evaluationVerdictSentence,
  exchangeRateMissingLead,
  exchangeRateMissingNotice,
  missingUpcomingNote,
  type ExchangeRateMissing,
} from '@/lib/format'

/**
 * 화면 글자의 문체를 사람이 세지 않는다 — DOC-005 §2.1 (홈 피드백 컷 K7 골격 · 원장 완성은 K12)
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
 * 2. **원장의 파일은 평서 종결이 0이다** — 원장은 **아직 비어 있다.** 홈 세 파일은 ③ 판정 문구 · 빈 상태가 바뀌는 커밋
 *    (K10 · K12)까지 다체가 남으므로 지금 올리면 빨간불이다. K12가 채운다(그 전에는 `todo`로 보인다 — 비어 있는 원장을
 *    초록으로 세지 않는다)
 * 3. **이미 고친 함수의 출력은 전 갈래가 해요체다** — 평가일 판정 문장(판정 넷 × 경과 일수 × 주말 × 지급방식 · K7)과
 *    ① · SCR-301의 빈 줄(K4). 평서 종결 0이고 해요체 종결이 하나 이상이며 「~요.」로 끝난다. **홈이 공유하는 문장**
 *    (ST-07 세 형태 · 링크 글자 · 환산 포함 줄 · 월지급 면책 · SCR-502 달러 문장 — K8)도 평서 종결 0 · 해요체 종결 하나
 *    이상이다(끝은 링크 글자 · 근거 괄호 · 부르는 자리의 마침표라 「~요.」를 요구하지 않는다)
 * 4. **라벨은 명사형이다** — 종결어미 · 마침표 · 「요」로 끝나지 않는다(판정 라벨 · 절 빈 상태 제목)
 * 5. **SCR-502 면책 상자는 상자 전체가 해요체다**(민서 결정(2026-10-13) D8 · K8) — h2 「면책 고지」의 절을 구문 트리에서
 *    잘라 그 JSX 글자만 본다. 파일 전체를 원장에 올리지 않는 이유는 상자 밖(앱 정보 · 계정 안내)이 아직 다체라서다
 *
 * **보지 못하는 것** — 원장 밖 파일의 JSX 글자(⑥ 블록 안내는 `HomeSections.tsx`의 리터럴이라 K12 전까지 밖이다), 개발자용
 * 예외와 화면 글자의 구별(파일 단위로 원장에 올릴 때 사람이 가른다), 문장의 길이 · 반복(§2.1 「한 사실에 한 문장」).
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
 * K12의 대상: `src/components/home/HomeSections.tsx` · `src/app/(app)/page.tsx` · `src/lib/format/dashboard.ts` ·
 * `src/lib/format/emptyState.ts` · `src/components/display/ExchangeRateMissingNotice.tsx`. `verdict.ts`는 판정 문장이
 * 해요체여도 SCR-203의 `redeemPrefillNote`가 다체라 올릴 수 없다(SQ-23)
 */
const COPY_STYLE_DONE: readonly string[] = []

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
  if (COPY_STYLE_DONE.length === 0) {
    it.todo('원장의 파일에 평서 종결이 없다 — 원장은 홈 피드백 컷 K12가 채운다')
  } else {
    it.each(COPY_STYLE_DONE)('%s', (file) => {
      expect(fileEndings(file)).toEqual([])
    })
  }
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
  ])('%s', (_label, text) => {
    expect(declarativeEndings(text)).toEqual([])
    expect(text).toMatch(POLITE_ENDING)
    expect(text).toMatch(/요\.$/)
  })
})

describe('라벨은 명사형 — 종결어미 · 마침표 · 「요」로 끝나지 않는다 (DOC-005 §2.1)', () => {
  it.each([...Object.values(EVALUATION_VERDICT_LABELS), ...Object.values(SECTION_EMPTY)])('%s', (label) => {
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
