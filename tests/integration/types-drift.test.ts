import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as select from '@/lib/db/select'

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
      // P8 컷 b2 — 월수익 연쿠폰율(비율). ELS_PRODUCT_COLUMNS가 text로 읽는다
      'els_products.monthly_coupon_annual_rate',
      'els_products.principal',
      'els_underlyings.base_price',
      'exchange_rates.rate',
      // P8 컷 b2 — 월수익 지급 기록의 금액 넷(상품 통화 세전 · 원화 과세 둘 · 적용 환율)과 월수익 배리어
      'monthly_coupon_payments.exchange_rate',
      'monthly_coupon_payments.gross_amount',
      'monthly_coupon_payments.taxable_income',
      'monthly_coupon_payments.withholding_tax',
      'monthly_coupon_schedules.coupon_barrier',
      'redemption_schedules.barrier',
      'redemption_schedules.lizard_barrier',
      'redemption_schedules.lizard_coupon_rate',
      // P8 a2 — 적용 환율(참고값). numeric(18,6)이며 REDEMPTION_COLUMNS가 text로 읽는다
      'redemptions.exchange_rate',
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
    // 사양이 **없는** 테이블은 여기서 보지 않는다 — 그 누락은 아래 「열 사양 대조가
    // 빠짐없다」가 따로 빨간불로 만든다. 종전에는 `if (spec == null) continue`가
    // 그 자리였고, 새 테이블이 조용히 통과했다.
    const numeric = await numericColumnsByRelation()

    const violations: string[] = []
    for (const name of SPEC_NAMES) {
      const table = SPEC_TABLES[name]
      const spec: Readonly<Record<string, string>> = select[name]
      for (const column of numeric.get(table) ?? []) {
        const kind = spec[column]
        // 사양에 없는 열은 아예 조회하지 않으므로 위반이 아니다
        if (kind != null && kind !== 'text') {
          violations.push(`${name}(${table}).${column} = ${kind}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 열 사양 대조가 빠짐없다 — CLAUDE.md 규칙 6 (P8 컷 1)
//
// 위 「text로 둔다」는 **대조표에 있는 사양만** 본다. 그래서 그 초록색은 「대조표가
// 빠지지 않았다」를 전제한다. 그 전제를 두 방향에서 따로 단언한다.
//
//   카탈로그 → 대조표   수치 열이 있는 관계는 전부 사양이 있거나, 사유와 함께 면제된다
//   export  → 대조표   `select.ts`가 내보내는 열 사양은 전부 대조표에 있다
//
// 둘이 따로인 이유: 앞의 것은 **테이블 단위**라서 이미 사양이 있는 테이블의 두 번째
// 사양(`ASSET_OPTION_COLUMNS`가 그 형태다)을 가르지 못한다. 뒤의 것은 export만 세므로
// 사양이 아예 없는 새 테이블을 가르지 못한다.
// ---------------------------------------------------------------------------

/**
 * `select.ts`의 열 사양 export → 그 사양이 읽는 테이블.
 *
 * 사양 객체는 실행 시점에 테이블 이름을 갖지 않는다(`defineColumns`가 첫 인자를
 * 버린다). 그래서 짝을 여기 적는다. **키가 export 이름이다** — 종전처럼 테이블을
 * 키로 쓰면 한 테이블에 사양이 둘일 때 하나가 들어갈 자리가 없다.
 *
 * `satisfies`가 키를 실제 export 이름으로, 값을 생성 타입의 테이블 이름으로 묶는다.
 * 짝이 **맞는가**는 타입이 못 본다(모든 키가 선택적인 사양 타입은 구조적으로 서로
 * 대입된다) — 아래 「대조표의 짝이 맞다」가 카탈로그로 본다.
 */
const SPEC_TABLES = {
  USER_COLUMNS: 'users',
  ELS_PRODUCT_COLUMNS: 'els_products',
  UNDERLYING_COLUMNS: 'els_underlyings',
  SCHEDULE_COLUMNS: 'redemption_schedules',
  REDEMPTION_COLUMNS: 'redemptions',
  ASSET_COLUMNS: 'assets',
  ASSET_OPTION_COLUMNS: 'assets',
  PROVIDER_SYMBOL_COLUMNS: 'asset_provider_symbols',
  PRICE_COLUMNS: 'asset_prices',
  // P8 컷 a3 — 환율. 시세와 같은 부류(rate = numeric(18,6) → text)
  EXCHANGE_RATE_COLUMNS: 'exchange_rates',
  // P8 컷 b2 — 상품 루트 로더가 임베드한다(DOC-010 AQ-77 — 차수 루트에는 넣지 않는다)
  MONTHLY_COUPON_SCHEDULE_COLUMNS: 'monthly_coupon_schedules',
  MONTHLY_COUPON_PAYMENT_COLUMNS: 'monthly_coupon_payments',
  TAX_PROFILE_COLUMNS: 'tax_profiles',
  TAX_BRACKET_COLUMNS: 'tax_brackets',
  TAX_CONSTANT_COLUMNS: 'tax_constants',
} as const satisfies { readonly [K in keyof typeof select]?: select.TableName }

type SpecName = keyof typeof SPEC_TABLES
const SPEC_NAMES = Object.keys(SPEC_TABLES) as SpecName[]

/**
 * 수치 열이 있는데 열 사양이 **없어도 되는** 관계 → 사유. 지금은 비어 있다.
 *
 * 사양이 없는 관계는 `selectList`를 지나지 않으므로 `::text` 방어 **밖**에 있다.
 * 그래서 면제는 이름이 아니라 사유로 등재한다. 사양이 생기거나 관계가 사라지면
 * 그 면제는 낡은 것이 되고, 아래 단언이 빨간불로 지우게 한다.
 */
const NUMERIC_RELATIONS_WITHOUT_SPEC: Readonly<Record<string, string>> = {}

/**
 * 공개 스키마에서 `numeric` 열을 가진 관계 → 그 열들.
 *
 * **`information_schema.columns`가 아니라 `pg_catalog`를 읽는다.** 이 명제에 대해
 * 전자가 가르지 못하는 부류가 둘 있다(아래 양성 대조가 둘 다 프로브로 둔다).
 *   ① 구체화 뷰(relkind `m`)를 싣지 않는다
 *   ② `numeric[]`의 `data_type`이 `'ARRAY'`다 — 위 17행 원장의 `= 'numeric'`이 놓친다
 * 도메인은 기저 형식으로 푼다(`typbasetype`을 재귀로 따라간다). 배열의 원소가
 * 도메인인 경우도 같은 재귀가 잡는다.
 */
async function numericColumnsByRelation(): Promise<Map<string, string[]>> {
  const { rows } = await client.query<{ relname: string; attname: string }>(
    `with recursive numeric_types(oid) as (
         select 'numeric'::regtype::oid
       union
         select t.oid
           from pg_type t
           join numeric_types n
             on t.typbasetype = n.oid
             or (t.typcategory = 'A' and t.typelem = n.oid)
     )
     select c.relname, a.attname
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and a.attnum > 0
        and not a.attisdropped
        and a.atttypid in (select oid from numeric_types)`,
  )

  const result = new Map<string, string[]>()
  for (const row of rows) {
    const existing = result.get(row.relname) ?? []
    existing.push(row.attname)
    result.set(row.relname, existing.sort())
  }
  return result
}

function coverage(
  numeric: Map<string, string[]>,
  exemptions: Readonly<Record<string, string>> = NUMERIC_RELATIONS_WITHOUT_SPEC,
): {
  uncovered: string[]
  staleExemptions: string[]
} {
  const specified = new Set<string>(Object.values(SPEC_TABLES))
  const uncovered = [...numeric.keys()]
    .filter((r) => !specified.has(r) && !(r in exemptions))
    .sort()
  const staleExemptions = Object.keys(exemptions)
    .filter((r) => !numeric.has(r) || specified.has(r))
    .sort()
  return { uncovered, staleExemptions }
}

/** export가 열 사양의 **모양**인가 — 이름 접미사(`_COLUMNS`)가 아니라 값으로 가른다 */
function isColumnSpec(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const kinds = Object.values(value)
  return kinds.length > 0 && kinds.every((k) => k === 'text' || k === 'raw')
}

describe('열 사양 대조가 빠짐없다 — 규칙 6', () => {
  it('수치 열이 있는 관계는 전부 열 사양이 있거나, 사유와 함께 면제된다', async () => {
    const numeric = await numericColumnsByRelation()

    // 비공허 — 이 질의가 17행 원장(information_schema)이 보는 테이블을 전부 본다.
    // 0행을 돌려주고 「누락 없음」이 되는 경로를 여기서 막는다
    const { rows } = await client.query<{ table_name: string }>(
      `select distinct table_name
         from information_schema.columns
        where table_schema = 'public' and data_type = 'numeric'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    expect([...numeric.keys()]).toEqual(
      expect.arrayContaining(rows.map((r) => r.table_name)),
    )

    expect(
      coverage(numeric),
      '수치 열이 있는 관계에 열 사양이 없다(uncovered) 또는 면제가 낡았다(staleExemptions). ' +
        '사양을 select.ts에 만들고 SPEC_TABLES에 짝을 적는다. 읽는 경로가 없어 사양이 ' +
        '필요 없다면 NUMERIC_RELATIONS_WITHOUT_SPEC에 사유와 함께 등재한다 (CLAUDE.md 규칙 6)',
    ).toEqual({ uncovered: [], staleExemptions: [] })
  })

  it('면제 대조가 공허하지 않다 — 낡은 면제와 쓰인 면제를 가른다', () => {
    // 오늘 NUMERIC_RELATIONS_WITHOUT_SPEC이 비어 있어 위 단언의 staleExemptions 절반은 실패할 수 없다.
    // P8 b2가 첫 면제를 넣고 b3가 빼야 하므로 그 절반의 판별력을 여기서 고정한다(P8 컷 1 검증).
    const numeric = new Map<string, string[]>([
      ['els_products', ['principal']],
      ['__probe_exempt', ['amount']],
    ])
    expect(
      coverage(numeric, { __gone_table: '사라진 관계', els_products: '사양이 이미 있다', __probe_exempt: '읽는 경로 없음' }),
    ).toEqual({ uncovered: [], staleExemptions: ['__gone_table', 'els_products'] })
    expect(coverage(numeric, {})).toEqual({ uncovered: ['__probe_exempt'], staleExemptions: [] })
  })

  it('select.ts가 내보내는 열 사양은 전부 대조표에 있다', () => {
    const exported = Object.entries(select)
      .filter(([, value]) => isColumnSpec(value))
      .map(([name]) => name)
      .sort()

    expect(
      exported,
      '대조표(SPEC_TABLES)에 없는 열 사양 export가 있다 — 그 사양은 「text로 둔다」가 보지 않는다',
    ).toEqual([...SPEC_NAMES].sort())
  })

  it('대조표의 짝이 맞다 — 사양의 키가 전부 그 테이블의 실제 열이다', async () => {
    // 짝이 틀리면 「text로 둔다」는 **엉뚱한 테이블의** 수치 열과 대조하고 초록색이 된다
    const columns = await actualColumns()

    const mismatched: string[] = []
    for (const name of SPEC_NAMES) {
      const table = SPEC_TABLES[name]
      const actual = columns.get(table) ?? []
      const missing = Object.keys(select[name]).filter((c) => !actual.includes(c))
      if (missing.length > 0) mismatched.push(`${name} → ${table}: ${missing.join(',')}`)
    }

    expect(mismatched).toEqual([])
  })

  it('양성 대조 — 롤백되는 트랜잭션 안의 새 관계를 이름으로 잡는다', async () => {
    // 프로브와 실제 카탈로그가 **한 번의 질의**에 함께 나온다(tests/rls/catalog.test.ts의
    // 뷰 프로브와 같은 형태). 결과가 프로브 다섯과 정확히 같아야 한다 — 그 밖의 이름이
    // 끼면 실제 누락이다.
    //
    // 각 프로브가 가르는 것:
    //   __probe_numeric   평범한 numeric 열            → 잡는다
    //   __probe_domain    numeric 위의 도메인           → 잡는다 (atttypid만 보면 놓친다)
    //   __probe_array     numeric[]                    → 잡는다 (information_schema는 'ARRAY')
    //   __probe_view      뷰                           → 잡는다 (relkind 필터)
    //   __probe_matview   구체화 뷰                     → 잡는다 (information_schema는 싣지 않는다)
    //   __probe_counting  integer·text만               → 잡지 않는다 (새 관계를 전부 세는 질의를 가른다)
    await client.query('begin')
    try {
      await client.query('create domain public.__probe_money as numeric(15, 0)')
      await client.query('create table public.__probe_numeric (amount numeric(15, 0))')
      await client.query('create table public.__probe_domain (amount public.__probe_money)')
      await client.query('create table public.__probe_array (amounts numeric[])')
      await client.query('create view public.__probe_view as select 1::numeric as amount')
      await client.query(
        'create materialized view public.__probe_matview as select 1::numeric as amount',
      )
      await client.query('create table public.__probe_counting (n integer, label text)')

      expect(
        coverage(await numericColumnsByRelation()).uncovered,
        '프로브 다섯 외의 이름이 실제 누락이다',
      ).toEqual([
        '__probe_array',
        '__probe_domain',
        '__probe_matview',
        '__probe_numeric',
        '__probe_view',
      ])
    } finally {
      await client.query('rollback')
    }

    // 롤백이 프로브를 실제로 지웠다 — 공유 스택의 다른 세션·다음 파일에 남지 않는다
    const after = await numericColumnsByRelation()
    expect([...after.keys()].filter((r) => r.startsWith('__probe_'))).toEqual([])
  })
})
