import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 비제어 `<select>`는 `key`로 다시 선다 — AQ-64의 구조 그물 (P8.5 · DOC-010 v3.39)
 *
 * React는 `<form action>` 제출마다 폼을 초기화하는데 비제어 `<select>`는 **마운트 때의 `defaultValue`로** 돌아간다(AQ-64 — 소스
 * 대조). 같은 폼에 머무는 제출(조작 버튼 · 검증 실패) 뒤 표시가 낡은 값이 되고, 사용자가 그 표시를 믿고 저장하면 값이 조용히
 * 바뀐다. 프로젝트의 규약은 `key`를 `defaultValue`와 같은 식으로 두는 것이다(값이 바뀌면 다시 선다).
 *
 * **이 규약이 한 번 빠졌다** — SCR-206의 「결과」 선택 상자(b3-3). 「빈 행 추가」 뒤 앞 행의 「지급」이 「선택 안 함」으로 보이고
 * 그대로 저장하면 그 행이 빠졌다. 반박 검토가 소스로 찾았다(P8.5). 표시 상태를 증명하는 층(jsdom)은 여전히 없으므로 — AQ-64는
 * 미결이다 — 대신 **소스를 훑어 `defaultValue`를 쓰는 `<select>`가 전부 `key`를 갖는지** 본다. 「key가 있다」가 「표시가 맞다」를
 * 증명하지는 않는다. 빠뜨림만 잡는다.
 *
 * ## 예외 — GET 폼
 *
 * GET 폼(필터 · 연도 선택)은 제출이 **새 페이지**다 — React의 폼 초기화가 돌지 않고 서버가 새 `defaultValue`로 처음부터 그린다.
 * 그 파일은 사유와 함께 아래에 등재한다. 등재된 파일이 더는 그런 `<select>`를 갖지 않으면 빨간불이다(낡은 예외를 남기지 않는다).
 */
const ROOTS = ['src/components', 'src/app']

const EXEMPT: Record<string, string> = {
  'src/components/tax/TaxProfileForms.tsx': 'SCR-401 귀속연도 · 건강보험 가입 유형 — GET 폼(시뮬레이션 쿼리, `TAX_KEYS`)',
  'src/components/products/ProductFilters.tsx': 'SCR-201 필터 — GET 폼이고 클라이언트 컴포넌트도 아니다(`useActionState` 없음)',
  'src/components/schedule/ScheduleFilters.tsx': 'SCR-301 필터 — GET 폼(SCR-201과 같은 형태)',
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return name.endsWith('.tsx') ? [full] : []
  })
}

/** 블록 주석 · 줄 주석을 걷는다 — 주석 속의 「`<select>`」 낱말과 `>`가 태그 경계를 흐리지 않게 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/** `<select …>` 여는 태그들 — 중괄호 깊이 0의 `>`에서 끝난다(`onChange={(e) => …}`의 `>`는 안이다) */
function selectTags(source: string): string[] {
  const tags: string[] = []
  for (const match of source.matchAll(/<select\b/g)) {
    let depth = 0
    let end = match.index
    for (; end < source.length; end += 1) {
      const c = source[end]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    tags.push(source.slice(match.index, end + 1))
  }
  return tags
}

const files = ROOTS.flatMap((root) => sources(join(process.cwd(), root))).map((full) => ({
  path: relative(process.cwd(), full),
  tags: selectTags(stripComments(readFileSync(full, 'utf8'))).filter((tag) => /\bdefaultValue=/.test(tag)),
}))

describe('AQ-64 — 비제어 <select>는 key로 다시 선다', () => {
  it('스캔이 무언가를 본다 — 대상이 0이면 이 단언은 아무것도 증명하지 않는다', () => {
    expect(files.reduce((n, f) => n + f.tags.length, 0)).toBeGreaterThanOrEqual(10)
  })

  it('★ defaultValue를 쓰는 <select>는 전부 key를 갖는다 — 예외는 GET 폼으로 등재된 파일뿐', () => {
    const missing = files
      .filter((f) => !(f.path in EXEMPT))
      .flatMap((f) => f.tags.filter((tag) => !/\bkey=/.test(tag)).map(() => f.path))
    expect(missing).toEqual([])
  })

  it('예외가 낡지 않았다 — 등재된 파일에 key 없는 그런 <select>가 실제로 있다', () => {
    for (const path of Object.keys(EXEMPT)) {
      const file = files.find((f) => f.path === path)
      expect(file, `${path}가 없다`).toBeDefined()
      expect(file!.tags.some((tag) => !/\bkey=/.test(tag)), `${path}에 key 없는 <select>가 더는 없다 — 예외를 지운다`).toBe(
        true,
      )
    }
  })
})
