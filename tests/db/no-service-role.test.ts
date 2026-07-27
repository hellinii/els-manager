import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `src/`에 `service_role`이 없다 — DOC-010 §7.1, DOC-011 §4.0 Q-01
 *
 * **규율이 아니라 테스트로 지킨다.** `service_role`은 RLS를 통째로 우회하므로,
 * 조회 경로가 한 번이라도 쓰면 그 뒤의 모든 초록색이 무엇을 증명하는지 알 수
 * 없게 된다. "쓰지 않기로 했다"는 합의는 다음 사람에게 전달되지 않는다.
 *
 * ## `src/app/api/cron/**`를 처음부터 예외로 둔다
 *
 * DOC-010 §6.2의 시세 수집 배치(P5)가 그 문자열을 **요구한다** — 배치는 사용자
 * 세션이 없고 `asset_prices` UPSERT 권한이 필요하다. 그때 예외를 뚫으면
 * "통과시키려고 검사 자체를 없애는" 쪽으로 기울기 쉽다. 예외를 미리, 사유와 함께
 * 좁게 열어 두면 P5는 규칙을 지우지 않고 그 경로 안에서 작업하게 된다.
 *
 * P5가 이 파일을 볼 때: **예외 경로를 넓히지 말고, 배치가 그 디렉터리 안에
 * 있는지 확인한다.** 예외가 필요한 새 경로가 생기면 그것은 아키텍처 결정이므로
 * DOC-010 §7에 등재한 뒤 여기에 추가한다.
 */

const SRC = join(process.cwd(), 'src')

/** 예외 — 사유는 위 주석에 있다. 경로 단위로 좁게 둔다. */
const ALLOWED_PREFIXES = [join('src', 'app', 'api', 'cron')]

/** 이 검사 파일 자체는 문자열을 담으므로 대상이 아니다(src 밖이다) */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function walk(dir: string): string[] {
  const entries = readdirSync(dir)
  return entries.flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return SCANNED_EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : []
  })
}

function isAllowed(repoRelative: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => repoRelative === prefix || repoRelative.startsWith(prefix + sep),
  )
}

/**
 * 주석을 제거한다 — **문자열 리터럴은 남긴다.**
 *
 * 단순 부분문자열 검사는 "쓰지 않는다"고 적은 주석을 위반으로 잡는다(실제로
 * 잡았다). 그렇다고 주석에서 그 단어를 빼면 어느 키를 배제했는지 문서가
 * 말하지 못하게 된다 — 검사를 정확하게 만드는 쪽이 맞다.
 *
 * 문자열 리터럴을 함께 지우지 않는 이유: **키를 코드에 박는 것이 정확히 잡아야
 * 하는 사고**다. `createClient(url, 'eyJ...service_role...')`은 리터럴 안에 있다.
 *
 * 그래서 정규식으로 잘라내지 않고 문자 단위로 문자열 상태를 추적한다. `'http://'`
 * 같은 리터럴이 주석으로 오인되면 그 뒤 코드가 통째로 스캔에서 사라진다.
 */
export function stripComments(source: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (quote != null) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
      i += 1
      continue
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }

    out += ch
    i += 1
  }

  return out
}

describe('service_role 문자열 부재', () => {
  const files = walk(SRC).map((full) => ({
    full,
    rel: relative(process.cwd(), full),
  }))

  it('스캔 대상이 실제로 존재한다', () => {
    // 경로가 틀려 0개를 스캔하고 초록색이 되는 것을 막는다
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((f) => f.rel.includes(join('lib', 'db')))).toBe(true)
  })

  it('src/ 어디에도 service_role이 없다 (cron 예외 제외)', () => {
    const offenders = files
      .filter((f) => !isAllowed(f.rel))
      .filter((f) => stripComments(readFileSync(f.full, 'utf8')).includes('service_role'))
      .map((f) => f.rel)

    expect(offenders).toEqual([])
  })

  it('SECRET_KEY·SERVICE_ROLE 환경변수도 읽지 않는다', () => {
    const offenders = files
      .filter((f) => !isAllowed(f.rel))
      .filter((f) => {
        const source = stripComments(readFileSync(f.full, 'utf8'))
        return (
          source.includes('SUPABASE_SERVICE_ROLE') ||
          source.includes('SUPABASE_SECRET_KEY')
        )
      })
      .map((f) => f.rel)

    expect(offenders).toEqual([])
  })

  it('process.env를 읽는 파일은 env.ts 하나다', () => {
    // 린트도 같은 규칙을 강제하지만(DOC-010 §7.2), 린트 설정은 바뀔 수 있다.
    // "감사 지점이 한 곳"이라는 사실 자체를 테스트로 고정한다.
    const readers = files
      .filter((f) => stripComments(readFileSync(f.full, 'utf8')).includes('process.env'))
      .map((f) => f.rel)

    expect(readers).toEqual([join('src', 'lib', 'db', 'env.ts')])
  })
})

describe('주석 제거기 자체를 검증한다', () => {
  it('줄 주석·블록 주석을 지운다', () => {
    expect(stripComments('const a = 1 // service_role')).not.toContain('service_role')
    expect(stripComments('/* service_role */ const a = 1')).not.toContain('service_role')
  })

  it('문자열 리터럴은 남긴다 — 키 하드코딩은 잡아야 한다', () => {
    expect(stripComments(`const k = 'service_role'`)).toContain('service_role')
    expect(stripComments('const k = `service_role`')).toContain('service_role')
  })

  it('URL 리터럴을 주석으로 오인하지 않는다', () => {
    // 오인하면 그 뒤 코드가 통째로 스캔에서 사라져 검사가 조용히 무력해진다
    const source = `const u = 'http://x'\nconst k = 'service_role'`
    expect(stripComments(source)).toContain('service_role')
  })

  it('이스케이프된 인용부호를 넘어간다', () => {
    const source = `const s = 'a\\'b'\nconst k = 'service_role'`
    expect(stripComments(source)).toContain('service_role')
  })
})
