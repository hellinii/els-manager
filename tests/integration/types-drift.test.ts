import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveDatabaseUrl } from './helpers/env'

/**
 * 생성 타입 ↔ 실제 스키마 대조 — DOC-010 AQ-19
 *
 * `src/types/database.types.ts`는 **생성물이고 커밋된다.** 마이그레이션 후
 * `npm run db:types`를 빠뜨리면 타입만 예전 스키마를 가리키는데 **`typecheck`는
 * 통과한다.** 그 상태에서 조용히 멈추는 것은 DOC-011 §4.0 Q-08의 타입 방어다 —
 * 사라진 열을 여전히 캐스팅 대상으로 알고 있거나, 새 금액 열을 모른다.
 *
 * AQ-05의 이중 게이트와 같은 취지다. 다만 **이 검사는 수동 스위트에만 있다** —
 * 상시 게이트는 `src/lib/db/select.ts`의 열 사양이다(사양의 키가 생성 타입의
 * 열로 제한되므로, 열이 사라지면 `typecheck`가 즉시 실패한다). 두 방어의 역할이
 * 다르다: 사양은 **쓰는 열**만 보고, 이 검사는 **모든 열**을 본다.
 */

const TYPES_PATH = join(process.cwd(), 'src', 'types', 'database.types.ts')

let client: Client

beforeAll(async () => {
  client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
})

afterAll(async () => {
  await client.end()
})

/** 생성 파일의 `Tables` 블록에서 테이블별 `Row` 열 목록을 뽑는다 */
function parseGeneratedRows(): Map<string, string[]> {
  const source = readFileSync(TYPES_PATH, 'utf8')

  const tablesStart = source.indexOf('Tables: {')
  const viewsStart = source.indexOf('Views: {')
  expect(tablesStart, '생성 파일에 Tables 블록이 없다').toBeGreaterThan(-1)
  expect(viewsStart, '생성 파일에 Views 블록이 없다').toBeGreaterThan(tablesStart)

  const block = source.slice(tablesStart, viewsStart)
  const result = new Map<string, string[]>()

  const tableRe = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/g
  let match: RegExpExecArray | null

  while ((match = tableRe.exec(block)) !== null) {
    const [, table, body] = match
    const columns = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(':')[0].trim())
    result.set(table, columns.sort())
  }

  return result
}

async function actualColumns(): Promise<Map<string, string[]>> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, column_name`,
  )

  const result = new Map<string, string[]>()
  for (const row of rows) {
    const existing = result.get(row.table_name) ?? []
    existing.push(row.column_name)
    result.set(row.table_name, existing)
  }
  return result
}

describe('생성 타입이 스키마와 일치한다', () => {
  it('파서가 실제로 테이블을 찾는다', async () => {
    // 정규식이 어긋나 0개를 파싱하고 초록색이 되는 것을 막는다
    const generated = parseGeneratedRows()
    expect(generated.size).toBeGreaterThanOrEqual(12)
    expect(generated.get('els_products')).toBeDefined()
  })

  it('테이블 목록이 같다', async () => {
    const generated = [...parseGeneratedRows().keys()].sort()
    const actual = [...(await actualColumns()).keys()].sort()

    expect(generated).toEqual(actual)
  })

  it('테이블별 열 목록이 같다', async () => {
    const generated = parseGeneratedRows()
    const actual = await actualColumns()

    const mismatches: string[] = []
    for (const [table, columns] of actual) {
      const gen = generated.get(table)
      if (gen == null) {
        mismatches.push(`${table}: 생성 타입에 없다`)
        continue
      }
      const missing = columns.filter((c) => !gen.includes(c))
      const extra = gen.filter((c) => !columns.includes(c))
      if (missing.length > 0) mismatches.push(`${table}: 타입에 없는 열 ${missing.join(',')}`)
      if (extra.length > 0) mismatches.push(`${table}: 스키마에 없는 열 ${extra.join(',')}`)
    }

    expect(
      mismatches,
      'npm run db:types를 실행하지 않았다. CLAUDE.md 마이그레이션 절차 참조.',
    ).toEqual([])
  })

  it('삭제된 열이 타입에 남아 있지 않다 — DQ-05 회귀', async () => {
    const generated = parseGeneratedRows()
    expect(generated.get('els_products')).not.toContain('total_rounds')

    const actual = await actualColumns()
    expect(actual.get('els_products')).not.toContain('total_rounds')
  })
})

describe('금액·비율 열이 캐스팅 대상으로 남아 있다', () => {
  it('numeric 열 목록이 열 사양의 캐스팅 대상과 어긋나지 않는다', async () => {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public' and data_type = 'numeric'
        order by table_name, column_name`,
    )

    // 새 numeric 열이 생기면 여기가 먼저 알려준다. 사양에 등재하지 않으면
    // 그 열은 조회되지 않으므로(select * 를 쓰지 않는다) 조용히 float64가 되는
    // 경로는 없지만, **등재하면서 캐스팅을 빠뜨리는** 경로는 있다.
    const numericColumns = rows.map((r) => `${r.table_name}.${r.column_name}`)

    expect(numericColumns).toEqual([
      'asset_prices.price',
      'els_products.annual_coupon_rate',
      'els_products.ki_barrier',
      'els_products.principal',
      'els_underlyings.base_price',
      'redemption_schedules.barrier',
      'redemption_schedules.lizard_barrier',
      'redemption_schedules.lizard_coupon_rate',
      'redemptions.gross_amount',
      'redemptions.taxable_income',
      'redemptions.withholding_tax',
      'tax_brackets.lower_bound',
      'tax_brackets.progressive_deduction',
      'tax_brackets.rate',
      'tax_constants.value',
      'tax_profiles.other_financial_income',
      'tax_profiles.other_income_base',
    ])
  })

  it('열 사양이 그 열들을 전부 text로 둔다', async () => {
    const {
      ASSET_COLUMNS,
      ELS_PRODUCT_COLUMNS,
      PRICE_COLUMNS,
      REDEMPTION_COLUMNS,
      SCHEDULE_COLUMNS,
      TAX_BRACKET_COLUMNS,
      TAX_CONSTANT_COLUMNS,
      TAX_PROFILE_COLUMNS,
      UNDERLYING_COLUMNS,
      USER_COLUMNS,
    } = await import('@/lib/db/select')

    const specs: Record<string, Record<string, string>> = {
      assets: ASSET_COLUMNS,
      els_products: ELS_PRODUCT_COLUMNS,
      asset_prices: PRICE_COLUMNS,
      redemptions: REDEMPTION_COLUMNS,
      redemption_schedules: SCHEDULE_COLUMNS,
      tax_brackets: TAX_BRACKET_COLUMNS,
      tax_constants: TAX_CONSTANT_COLUMNS,
      tax_profiles: TAX_PROFILE_COLUMNS,
      els_underlyings: UNDERLYING_COLUMNS,
      users: USER_COLUMNS,
    }

    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public' and data_type = 'numeric'`,
    )

    const violations: string[] = []
    for (const row of rows) {
      const spec = specs[row.table_name]
      if (spec == null) continue
      const kind = spec[row.column_name]
      // 사양에 없는 열은 아예 조회하지 않으므로 위반이 아니다
      if (kind != null && kind !== 'text') {
        violations.push(`${row.table_name}.${row.column_name} = ${kind}`)
      }
    }

    expect(violations).toEqual([])
  })
})
