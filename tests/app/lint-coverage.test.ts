import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `els/*` 린트 글롭의 빈칸을 사람이 세지 않는다 — P5b 컷 7
 *
 * ## 왜 이 파일이 있는가
 *
 * `eslint.config.mjs`의 ★ 주석이 「아래 **다섯**은 파일 집합이 서로 겹치지 않는다」를
 * 손으로 세고 있었다. 그 열거는 **겹침**은 보지만 **빈칸**은 보지 못한다 —
 * 그리고 실제로 `src/lib/providers/**`가 어느 규칙에도 걸리지 않은 채 남아 있었다
 * (실측: 137개 중 5개가 밖). **위반자가 0인 동안 공백은 보이지 않는다.**
 *
 * **이것이 절대 규칙 #6이 열거하는 fail-open의 다섯 번째 형태다.** 앞의 넷은
 * 테이블(RLS 누락) · 뷰(`security_invoker`) · 함수(`revoke execute`) · Route Handler
 * (라우트 원장)였고, 공통점이 **「객체 종류가 늘 때 기존 열거가 따라오지 않는다」**이다.
 * 여기서 늘어나는 객체는 **디렉터리**다.
 *
 * ## 무엇을 단언하는가
 *
 * `src/`의 모든 `.ts`·`.tsx`가 **`els/*` 규칙 하나 이상에 걸리거나, 아래 원장에 사유와
 * 함께 등재되어 있다.** 새 디렉터리를 만들면 둘 중 하나를 해야 하고, 둘 다 안 하면
 * 빨간불이다.
 *
 * **린트를 실행하지 않는다** — 글롭과 파일 목록의 대조이며 파일시스템 읽기뿐이다
 * (ADR-003의 전제를 깨지 않는다).
 */

const ROOT = process.cwd()
const CONFIG = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8')

/**
 * 규칙에서 **의도적으로** 제외된 파일과 그 사유.
 *
 * 등재는 「규칙을 붙이지 않는다」는 결정이며 **빈칸과 다르다.** 사유가 없으면 다음
 * 사람이 「빠뜨린 것인지 뺀 것인지」를 구별할 수 없고, 그 구별이 이 원장의 존재 이유다.
 */
const EXEMPT: Record<string, string> = {
  'src/types/database.types.ts':
    '생성물 — `npm run db:types`가 덮어쓴다. `globalIgnores`에도 있다(AQ-19가 신선도를 본다)',
  'src/lib/decimal.ts':
    '고정소수점 산술의 **구현**이다. 강제 변환 금지를 여기 씌우면 자기 자신을 만들 수 없다',
  'src/lib/auth/session.ts':
    '금액·비율을 다루지 않는다(세션·쿠키). 강제 변환 규칙이 걸릴 값이 없다',
  'src/proxy.ts':
    'Next 미들웨어 — 요청/응답만 다루고 도메인 값이 없다',
}

/** `eslint.config.mjs`가 선언한 `els/*` 규칙의 글롭 전부 */
function elsGlobs(): { name: string; globs: string[] }[] {
  const consts = new Map<string, string[]>()
  for (const m of CONFIG.matchAll(/^const ([A-Z_]+) = (\[[^\]]*\]);/gm)) {
    consts.set(m[1]!, [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!))
  }
  const out: { name: string; globs: string[] }[] = []
  for (const m of CONFIG.matchAll(/name:\s*"(els\/[^"]+)",\s*\n\s*files:\s*(\[[^\]]*\]|[A-Z_]+)/g)) {
    const raw = m[2]!
    const globs = raw.startsWith('[')
      ? [...raw.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
      : (consts.get(raw) ?? [])
    out.push({ name: m[1]!, globs })
  }
  return out
}

/** `src/lib/**\/*.{ts,tsx}` 형태의 글롭을 정규식으로 — 별 두 개는 경로 구분자를 건넌다 */
function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 는 「0개 이상의 디렉터리」다 — `src/lib/db/**/*.ts`가 `src/lib/db/x.ts`도 덮는다
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '{') {
      const end = glob.indexOf('}', i)
      re += `(?:${glob.slice(i + 1, end).split(',').join('|')})`
      i = end
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function srcFiles(dir = join(ROOT, 'src')): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...srcFiles(p))
    else if (/\.tsx?$/.test(e.name)) out.push(relative(ROOT, p).split(/[\\/]/).join('/'))
  }
  return out.sort()
}

const RULES = elsGlobs()
const FILES = srcFiles()

const coveredBy = (file: string) =>
  RULES.filter((r) => r.globs.some((g) => globToRegExp(g).test(file))).map((r) => r.name)

describe('린트 글롭 커버리지 — 절대 규칙 #6의 다섯 번째 형태', () => {
  it('전제 1 — 설정에서 els/* 규칙을 실제로 읽었다', () => {
    // 0건을 찾으면 아래 단언이 전부 항진명제가 된다.
    expect(RULES.length).toBeGreaterThanOrEqual(6)
    expect(RULES.map((r) => r.name)).toContain('els/provider-values')
  })

  it('전제 2 — 글롭 → 정규식 변환이 실제로 갈린다', () => {
    const re = globToRegExp('src/lib/db/**/*.ts')
    expect(re.test('src/lib/db/select.ts')).toBe(true) // `**/`는 0개 디렉터리도 덮는다
    expect(re.test('src/lib/db/queries/load.ts')).toBe(true)
    expect(re.test('src/lib/cron/decide.ts')).toBe(false)
    const tsx = globToRegExp('src/app/**/*.{ts,tsx}')
    expect(tsx.test('src/app/page.tsx')).toBe(true)
    expect(tsx.test('src/app/(app)/prices/page.tsx')).toBe(true)
    expect(tsx.test('src/components/x.tsx')).toBe(false)
  })

  it('전제 3 — src에서 파일을 실제로 걷었다', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(FILES).toContain('src/lib/providers/types.ts')
  })

  it('★ src의 모든 파일이 규칙에 걸리거나 원장에 등재되어 있다', () => {
    const uncovered = FILES.filter((f) => coveredBy(f).length === 0 && !(f in EXEMPT))
    expect(
      uncovered,
      '새 디렉터리를 만들었으면 els/* 규칙을 붙이거나 EXEMPT에 사유와 함께 등재한다',
    ).toEqual([])
  })

  it('원장이 낡지 않았다 — 등재된 파일이 실재하고, 규칙이 생겼으면 원장에서 빠져야 한다', () => {
    // 양방향이다. 한쪽만 보면 원장이 조용히 거짓이 된다(`ROUTE_HANDLERS`와 같은 형태).
    for (const f of Object.keys(EXEMPT)) {
      expect(FILES, `원장의 ${f}가 실재하지 않는다`).toContain(f)
      expect(coveredBy(f), `${f}는 이제 규칙에 걸린다 — 원장에서 뺀다`).toEqual([])
    }
  })

  it('`src/lib/providers/**`가 강제 변환 금지 아래 있다 — 컷 7이 메운 빈칸', () => {
    // 어댑터가 외부 JSON을 파싱하는 자리이고 `Number(json.close)`가 정확히 그 함정이다.
    expect(coveredBy('src/lib/providers/types.ts')).toContain('els/provider-values')
    const block = CONFIG.slice(CONFIG.indexOf('els/provider-values'))
    expect(block).toContain('NO_COERCION_GLOBALS')
    expect(block).toContain('NO_COERCION_SYNTAX')
  })
})
