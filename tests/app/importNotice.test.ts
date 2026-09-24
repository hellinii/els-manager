import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { IMPORT_PANEL_STATES, importPanelStateOf } from '@/lib/format/importNotice'

/**
 * 불러오기 구획의 상태 일곱 ↔ DOC-008 SCR-204 (v2.9)
 *
 * 상태 표가 문서와 코드에 하나씩 있다. **이름 집합이 같은지만** 본다 — 조건·화면 칸은 산문이다
 * (DOC-010 §7 권한 표 대조와 같은 판단, `docs-contract.test.ts`).
 */
describe('상태 표 ↔ DOC-008', () => {
  const documented = (() => {
    const lines = readFileSync(join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md'), 'utf8').split('\n')
    const header = '> | 상태 | 조건 | 화면 |'
    const at = lines.indexOf(header)
    expect(at, '상태 표를 찾지 못했다').toBeGreaterThan(-1)
    expect(lines.indexOf(header, at + 1), '같은 헤더가 둘이다').toBe(-1)
    const names: string[] = []
    for (const line of lines.slice(at + 2)) {
      if (!line.startsWith('> |')) break
      names.push(line.replace(/^> \|/, '').split('|', 1)[0]!.trim())
    }
    return names
  })()

  it('★ 이름 집합이 같다 — 한쪽에만 상태가 늘면 빨간불', () => {
    expect(documented).toHaveLength(7)
    expect(new Set(Object.values(IMPORT_PANEL_STATES).map((s) => s.name))).toEqual(new Set(documented))
  })

  it('오류 색을 쓰지 않는다 — 불러오기는 보조 기능이다(ST-03)', () => {
    for (const s of Object.values(IMPORT_PANEL_STATES)) expect(['plain', 'info', 'warn']).toContain(s.tone)
  })
})

describe('상태 판정', () => {
  it('검색 전 · 결과 없음 · 후보 목록 · 검색 실패', () => {
    expect(importPanelStateOf({ query: null, code: null, search: null, fill: null })).toBe('IDLE')
    expect(importPanelStateOf({ query: '4000', code: null, search: { ok: true, count: 0 }, fill: null })).toBe(
      'NO_RESULTS',
    )
    expect(importPanelStateOf({ query: '4000', code: null, search: { ok: true, count: 2 }, fill: null })).toBe(
      'CANDIDATES',
    )
    expect(importPanelStateOf({ query: '4000', code: null, search: { ok: false }, fill: null })).toBe(
      'LOOKUP_FAILED',
    )
  })

  it('상품을 고른 뒤에는 상세가 이긴다 — 실패는 후보 목록으로 되돌아가지 않는다', () => {
    const base = { query: '4000', code: 'E04000', search: { ok: true as const, count: 1 } }
    expect(importPanelStateOf({ ...base, fill: { kind: 'PARTIAL' } })).toBe('PARTIAL')
    expect(importPanelStateOf({ ...base, fill: { kind: 'REFUSED' } })).toBe('REFUSED')
    expect(importPanelStateOf({ ...base, fill: { failed: true } })).toBe('LOOKUP_FAILED')
    expect(importPanelStateOf({ ...base, fill: null })).toBe('LOOKUP_FAILED')
  })
})
