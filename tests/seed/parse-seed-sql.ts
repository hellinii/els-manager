import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BracketRow, ConstantRow } from '../fixtures/tax-seed-contract'

/**
 * 세율 시드 마이그레이션 파서 — AQ-05
 *
 * 파일시스템 읽기이지 DB·네트워크 접근이 아니므로 DB 없는 스위트에 있어도
 * ADR-003의 전제("테스트가 DB·네트워크 없이 실행된다")를 깨지 않는다.
 * 오프라인이고 결정적이다.
 *
 * 정규식 파싱의 유일한 위험은 형식이 바뀌어 **0건을 찾고 조용히 통과**하는
 * 것이다. 호출부가 튜플 개수를 정확히 단언하므로(8행·9행) 그 경로가 막힌다.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/** 연도당 마이그레이션은 정확히 1개다 — ADR-005의 전제 */
function readSeedFile(year: number): string {
  const suffix = `_tax_rates_${year}.sql`
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(suffix))

  if (files.length !== 1) {
    throw new Error(
      `${year}년 세율 마이그레이션이 정확히 1개여야 한다. ` +
        `발견 ${files.length}개 [${files.join(', ')}]. ` +
        'ADR-005는 연도당 1개 파일을 전제하며, 정정도 신규 연도 파일이 아니라 ' +
        '별도 마이그레이션으로 처리한다.',
    )
  }
  return readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8')
}

/**
 * 대상 테이블의 INSERT 문 하나를 잘라낸다.
 *
 * `--` 주석을 먼저 지우는 이유: 주석 안에 예시로 적힌 튜플이 집계되면
 * 개수 단언이 엉뚱하게 통과하거나 실패한다.
 */
function statementFor(sql: string, table: string): string {
  const stripped = sql.replace(/--[^\n]*/g, '')
  const matched = new RegExp(
    `insert\\s+into\\s+public\\.${table}\\b[\\s\\S]*?;`,
    'i',
  ).exec(stripped)

  if (matched === null) {
    throw new Error(`public.${table} 삽입문을 찾지 못했다.`)
  }
  return matched[0]
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`

export function parseSeededConstants(year: number): ConstantRow[] {
  const statement = statementFor(readSeedFile(year), 'tax_constants')
  const tuple = new RegExp(
    String.raw`\(\s*(\d{4})\s*,\s*'([a-z0-9_]+)'\s*,\s*(${NUMBER})\s*\)`,
    'g',
  )

  return [...statement.matchAll(tuple)]
    .filter((m) => Number(m[1]) === year)
    .map((m) => ({ key: m[2], value: m[3] }))
}

export function parseSeededBrackets(year: number): BracketRow[] {
  const statement = statementFor(readSeedFile(year), 'tax_brackets')
  const tuple = new RegExp(
    String.raw`\(\s*(\d{4})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`,
    'g',
  )

  return [...statement.matchAll(tuple)]
    .filter((m) => Number(m[1]) === year)
    .map((m) => ({
      lowerBound: m[2],
      rate: m[3],
      progressiveDeduction: m[4],
    }))
}
