import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { GRADE_ACCENT, GRADE_CLASS, GRADE_TEXT_CLASS } from '@/components/display/Badge'
import { GAP_TIER_GRADES, type BadgeGrade } from '@/lib/format'

/**
 * 등급 → 색 — **색 자체를 상시 스위트가 지킨다** (홈 피드백 컷 K6)
 *
 * ## 왜 이 파일이 있는가
 *
 * 등급 토큰은 DOC-005 §6.3과 값별로 대조되지만(`labels.test.ts`) **토큰 → 색**은 아무도 보지 않았다. K3 검증에서
 * `Badge.tsx`의 `record` 배지와 띠를 빨강으로 되돌려도 상시 스위트가 전부 초록이었다(2177/2177 — 실측). 피드백 #1의
 * 결함(조건 충족이 경고처럼 빨갛다)이 그대로 돌아와도 아무것도 빨개지지 않는 상태다. 그래서 여기서 셋을 고정한다.
 *
 * 1. **`record` 「기록 필요」는 파랑이고 빨강이 아니다 · `attention`(원금 위험)은 빨강이다** — 배지 · 띠 · 글자색 셋 다
 *    (민서 결정(2026-10-12) D1 · DOC-005 §6.3 각주)
 * 2. **근소 단계의 숫자색은 충족과 다르다** — 같으면 「+3%p」와 「+30%p」가 다시 같은 색이다(피드백 #2 · D3)
 * 3. **글자색이 대비를 지난다** — 등급 글자색은 흰 바탕 4.5:1 이상, 띠는 3:1 이상(WCAG 1.4.3 · 1.4.11). 대비 가드
 *    (`contrast-guard.test.ts`)는 무채색 팔레트만 재므로 유채색 단계는 여기서 `theme.css`의 값으로 직접 잰다
 */

const GRADES: readonly BadgeGrade[] = ['neutral', 'positive', 'caution', 'record', 'attention', 'defect']

/** 클래스 문자열의 색 계열 — `bg-blue-50` · `text-blue-700` · `ring-blue-300` · `border-l-blue-600` → `blue` */
function huesOf(classes: string): string[] {
  return classes
    .split(/\s+/)
    .map((token) => /^(?:bg|text|ring|border-l)-([a-z]+)-\d+$/.exec(token)?.[1])
    .filter((hue): hue is string => hue != null)
}

describe('등급의 색 계열 — 기록은 파랑, 원금 위험은 빨강 (D1)', () => {
  it('전제 — 세 표가 여섯 등급을 전부 갖고 계열을 읽을 수 있다', () => {
    for (const table of [GRADE_CLASS, GRADE_ACCENT, GRADE_TEXT_CLASS]) {
      expect(Object.keys(table).sort()).toEqual([...GRADES].sort())
    }
    // 배지는 바탕 · 글자 · 테두리 셋이다(defect의 글자는 `text-white`라 계열 토큰이 아니다)
    expect(huesOf(GRADE_CLASS.record)).toHaveLength(3)
    expect(huesOf(GRADE_ACCENT.record)).toHaveLength(1)
    expect(huesOf(GRADE_TEXT_CLASS.record)).toHaveLength(1)
  })

  it('★ `record`는 배지 · 띠 · 글자색이 전부 파랑이고 빨강이 없다', () => {
    for (const [name, table] of [
      ['GRADE_CLASS', GRADE_CLASS],
      ['GRADE_ACCENT', GRADE_ACCENT],
      ['GRADE_TEXT_CLASS', GRADE_TEXT_CLASS],
    ] as const) {
      expect(new Set(huesOf(table.record)), `${name}.record`).toEqual(new Set(['blue']))
      expect(table.record, `${name}.record`).not.toMatch(/red/)
    }
  })

  it('★ `attention`(원금 위험)은 배지 · 띠 · 글자색이 전부 빨강이다', () => {
    for (const [name, table] of [
      ['GRADE_CLASS', GRADE_CLASS],
      ['GRADE_ACCENT', GRADE_ACCENT],
      ['GRADE_TEXT_CLASS', GRADE_TEXT_CLASS],
    ] as const) {
      expect(new Set(huesOf(table.attention)), `${name}.attention`).toEqual(new Set(['red']))
    }
  })

  it('나란히 놓이는 등급끼리 색이 갈린다 — record · attention · defect · positive', () => {
    // 배지 클래스 문자열이 서로 다르다(같으면 ST-06의 구분이 색에서 사라진다)
    expect(new Set(GRADES.map((g) => GRADE_CLASS[g])).size).toBe(GRADES.length)
    expect(new Set(GRADES.map((g) => GRADE_ACCENT[g])).size).toBe(GRADES.length)
    expect(new Set(GRADES.map((g) => GRADE_TEXT_CLASS[g])).size).toBe(GRADES.length)
  })

  it('글자색 표는 배지의 글자색과 같은 단계다 — defect만 예외(배지가 어두운 바탕이다)', () => {
    for (const g of GRADES) {
      const badgeText = GRADE_CLASS[g].split(/\s+/).find((t) => t.startsWith('text-'))
      if (g === 'defect') {
        expect(badgeText).toBe('text-white')
        continue
      }
      expect(GRADE_TEXT_CLASS[g], g).toBe(badgeText)
    }
  })
})

describe('여유폭 단계의 숫자색 (D3)', () => {
  it('★ 근소는 충족과 다른 색이다 — 계열부터 다르다', () => {
    const met = GRADE_TEXT_CLASS[GAP_TIER_GRADES.MET]
    const narrow = GRADE_TEXT_CLASS[GAP_TIER_GRADES.NARROW]
    expect(narrow).not.toBe(met)
    expect(huesOf(narrow)).not.toEqual(huesOf(met))
    // 근소 · 미충족은 둘 다 관찰(caution)이고 빨강이 아니다 — 음수 여유폭(리자드)이 빨강이 되지 않는다(부호가 아니라 단계)
    for (const tier of ['NARROW', 'UNMET'] as const) {
      expect(GRADE_TEXT_CLASS[GAP_TIER_GRADES[tier]], tier).not.toMatch(/red/)
    }
  })
})

// ---------------------------------------------------------------------------
// 대비 — theme.css의 oklch를 sRGB로 옮겨 잰다
// ---------------------------------------------------------------------------

describe('대비 — 등급 글자색 4.5:1 · 띠 3:1 (흰 바탕)', () => {
  const css = readFileSync(join(process.cwd(), 'node_modules/tailwindcss/theme.css'), 'utf8')
  const palette = new Map<string, [number, number, number]>()
  for (const m of css.matchAll(/--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)/g)) {
    palette.set(m[1]!, [Number.parseFloat(m[2]!) / 100, Number.parseFloat(m[3]!), m[4] === 'none' ? 0 : Number.parseFloat(m[4]!)])
  }

  /**
   * OKLCH → 선형 sRGB(Björn Ottosson의 행렬) → 상대 휘도. 색역 밖 성분은 [0, 1]로 자른다 — 브라우저는 채도를 줄여
   * 색역에 넣으므로(CSS Color 4) 근사이고, 아래 값들은 문턱에서 1 이상 떨어져 있어 근사가 판정을 바꾸지 않는다.
   */
  function luminance(step: string): number {
    const lch = palette.get(step)
    expect(lch, `theme.css에 ${step}이 없다`).toBeDefined()
    const [L, C, h] = lch!
    const a = C * Math.cos((h * Math.PI) / 180)
    const b = C * Math.sin((h * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const clip = (x: number) => Math.min(1, Math.max(0, x))
    const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const onWhite = (step: string) => (1 + 0.05) / (luminance(step) + 0.05)
  const stepOf = (cls: string, prefix: string) => cls.slice(prefix.length)

  it('전제 — 팔레트를 읽었고 변환이 무채색에서 L³과 같다 (contrast-guard의 방법과 일치)', () => {
    expect(palette.size).toBeGreaterThan(200)
    const [L] = palette.get('neutral-500')!
    expect(luminance('neutral-500')).toBeCloseTo(L ** 3, 6)
    // 알려진 값 — neutral-500은 흰 바탕 4.74:1(DOC-008 ST-08)
    expect(onWhite('neutral-500')).toBeCloseTo(4.74, 1)
  })

  it('★ 등급 글자색은 전부 흰 바탕 4.5:1 이상이다 — 근소 · 충족 · 기록의 숫자가 읽힌다', () => {
    for (const g of GRADES) {
      const cls = GRADE_TEXT_CLASS[g]
      expect(cls, g).toMatch(/^text-[a-z]+-\d+$/)
      expect(onWhite(stepOf(cls, 'text-')), `${g} ${cls}`).toBeGreaterThanOrEqual(4.5)
    }
    // 대비 가드의 금지 단계(neutral-400 이하)가 아니다 — 그쪽 스캐너는 표 안의 문자열을 VIOLATION으로 볼 수 있다
    for (const g of GRADES) expect(GRADE_TEXT_CLASS[g], g).not.toMatch(/^text-neutral-(?:50|100|200|300|400)$/)
  })

  it('띠는 전부 흰 바탕 3:1 이상이다 — 비텍스트 대비(WCAG 1.4.11)', () => {
    for (const g of GRADES) {
      const cls = GRADE_ACCENT[g]
      expect(cls, g).toMatch(/^border-l-[a-z]+-\d+$/)
      expect(onWhite(stepOf(cls, 'border-l-')), `${g} ${cls}`).toBeGreaterThanOrEqual(3)
    }
  })
})
