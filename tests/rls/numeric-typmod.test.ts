import { describe, expect, it } from 'vitest'

import { asOwner } from './helpers/client'

/**
 * numeric 정밀도·scale 원장 — P8 컷 1 계기 선행 (AQ-86)
 *
 * ## 왜 필요한가
 *
 * `tests/integration/types-drift.test.ts`는 **열 이름**만 대조한다. 생성 타입은
 * `numeric(15,0)`이든 `numeric`이든 둘 다 `number`로 적으므로, `principal`을
 * `numeric(15,0)` → `numeric`으로 넓혀도 이름이 같아 **초록인 채로 지나간다.**
 * 그런데 그 typmod가 절대 규칙 #2의 저장 쪽 절반이다 — `numeric(15,0)`은 `10000.50`을
 * 오류 없이 `10001`로 반올림하고, 정밀도 없는 `numeric`은 그러지 않는다. 즉 금액이
 * 어떻게 저장되는지가 **어떤 테스트도 보지 않는 곳에서** 바뀔 수 있었다.
 *
 * 그래서 public의 모든 numeric 열의 (관계, 열, 정밀도, scale)을 원장으로 고정하고
 * 카탈로그와 **양방향으로 정확히** 대조한다. 한쪽만 보면 새 금액 열이 원장 밖에
 * 조용히 남는다(`catalog.test.ts` 권한 매트릭스와 같은 논지).
 *
 * ## 열거를 무엇으로 하는가 — `information_schema`가 아니라 `pg_attribute`
 *
 * 실측(P8 컷 1, 롤백 트랜잭션 안에서 객체 종류별로 하나씩 만들어 대조했다):
 *
 * | 객체 | `information_schema.columns` | `pg_attribute` |
 * |---|---|---|
 * | 실테이블 `numeric(15,0)` | 15, 0 | 15, 0 |
 * | 도메인 열 (`numeric(17,2)` 위) | 17, 2 | 도메인을 따라가야 보인다 |
 * | 배열 열 `numeric(12,2)[]` | `ARRAY`, 정밀도 **null** | 12, 2 |
 * | 범위 열 `numrange` | `numrange`, 정밀도 null | 원소형까지 따라가야 보인다 |
 * | 구체화 뷰 | **행 자체가 없다** | 보인다 |
 * | 독립 복합 타입 | **행 자체가 없다** | 보인다 |
 *
 * 즉 `information_schema.columns where data_type = 'numeric'`은 배열·범위·구체화
 * 뷰·복합 타입을 **세지 않는다** — 셈이 맞아 보여도 부류를 가르지 못한다. 그래서
 * `pg_attribute`에서 출발해 도메인·배열·범위를 **재귀로 풀어** 원소형이 numeric에
 * 닿는 열을 모두 모은다. 열거는 관계 종류를 **제외 목록**으로 거른다 — 뷰·구체화 뷰·
 * 외부 테이블·파티션·복합 타입이 새로 생겨도 저절로 따라온다(CLAUDE.md 절대 규칙 6:
 * 「객체 종류가 늘어날 때 기존 열거가 따라오지 않는다」).
 *
 * 제외하는 것은 **인덱스(`i`·`I`)뿐이다.** 인덱스 열은 테이블 열의 typmod를 복제한
 * 파생물이다(실측: `tax_brackets_pkey.lower_bound`가 `numeric(15,0)`으로 보인다) —
 * `alter column … type`이 인덱스를 재작성하므로 둘이 갈릴 수 없다.
 *
 * ## 이 원장이 보지 «못하는» 것
 *
 * - **함수 인자·반환형** — Postgres가 함수 시그니처의 typmod를 저장하지 않는다
 *   (`pg_proc`에는 형 oid뿐이다). RPC의 `numeric(15,0)` 선언은 카탈로그에 남지 않으므로
 *   대조할 대상이 없다.
 * - **정밀도 없는 열의 scale 규칙** — P8 a2의 `principal`·`gross_amount`는 typmod가
 *   아니라 이름 있는 CHECK/트리거로 scale을 강제한다. 이 원장은 그 열을 `null, null`로만
 *   적으며, **그 CHECK가 실재하는지는 여기서 보이지 않는다.** 이름은
 *   `constraint-names.test.ts`가, 동작은 그 제약의 행동 테스트가 본다.
 *
 * ## 원장을 고칠 때
 *
 * 마이그레이션이 numeric 열을 더하거나 typmod를 바꾸면 **같은 커밋에서** 이 원장을
 * 고친다. 여기서 빨간불이 뜨는 것이 정상 경로다 — 그 변경이 의도였음을 사람이 한 줄로
 * 적게 만드는 것이 이 계기의 목적이다.
 */

type NumericShape = { precision: number | null; scale: number | null }

/** `(관계).(열)` → 정밀도·scale. 정밀도 없는 `numeric`은 `null, null`이다 */
const NUMERIC_LEDGER: Record<string, NumericShape> = {
  // ── 상품 통화 금액 (DOC-002 M-08) ──────────────────────────────────────
  // ★ **P8 a2(20260930040321_product_currency)가 이 둘의 정밀도를 의도적으로 뗐다.**
  //   scale 규칙(KRW 0자리·USD 2자리·정수부 15자리)은 typmod가 아니라 이름 있는
  //   CHECK/트리거(`els_products_principal_scale_check` · `redemptions_gross_amount_digits_check`
  //   · `redemptions_gross_amount_scale`)가 강제하며 이 원장은 그것을 보지 못한다(위
  //   「보지 못하는 것」). 신설될 `monthly_coupon_payments.gross_amount`도 같은 부류로 들어온다
  'els_products.principal': { precision: null, scale: null },
  'redemptions.gross_amount': { precision: null, scale: null },

  // ── 적용 환율 — 참고값 (DOC-005 §4, P8 a2) ────────────────────────────
  'redemptions.exchange_rate': { precision: 18, scale: 6 },

  // ── 과세 축 금액 — 항상 KRW `numeric(15,0)` (M-08) ─────────────────────
  'redemptions.taxable_income': { precision: 15, scale: 0 },
  'redemptions.withholding_tax': { precision: 15, scale: 0 },
  'tax_profiles.other_financial_income': { precision: 15, scale: 0 },
  'tax_profiles.other_income_base': { precision: 15, scale: 0 },
  'tax_brackets.lower_bound': { precision: 15, scale: 0 },
  'tax_brackets.progressive_deduction': { precision: 15, scale: 0 },

  // ── 비율 — 소수 정규화 (`0.9` = 90%) ──────────────────────────────────
  'els_products.annual_coupon_rate': { precision: 6, scale: 4 },
  'els_products.ki_barrier': { precision: 6, scale: 4 },
  'redemption_schedules.barrier': { precision: 6, scale: 4 },
  'redemption_schedules.lizard_barrier': { precision: 6, scale: 4 },
  'redemption_schedules.lizard_coupon_rate': { precision: 6, scale: 4 },
  'tax_brackets.rate': { precision: 6, scale: 4 },

  // ── 시세·기준가·주입 상수 ─────────────────────────────────────────────
  'asset_prices.price': { precision: 18, scale: 6 },
  'els_underlyings.base_price': { precision: 18, scale: 6 },
  // P8 컷 a3 — 환율은 시세와 같은 부류다(DOC-011 Q-07 — 형식 PRICE). 저장은 여섯 자리, 표시만 두 자리
  'exchange_rates.rate': { precision: 18, scale: 6 },
  'tax_constants.value': { precision: 18, scale: 6 },
}

/**
 * public의 numeric 열 전부 — 도메인·배열·범위를 재귀로 풀어 원소형이 numeric인 열.
 *
 * typmod 해독은 `numeric.c`의 매크로를 그대로 옮긴 것이다. scale은 PG15부터 음수가
 * 될 수 있어 11비트 부호 확장을 한다(`numeric(5,-2)` 실측으로 확인). 해독이 맞는지는
 * 아래 두 번째 케이스가 **Postgres 자신의 `format_type`**과 대조한다.
 *
 * 전파 규칙: 도메인은 자기 `typtypmod`가 있으면 그것을 쓰고(열의 `atttypmod`는 -1이다),
 * 배열은 열의 typmod가 원소에 적용되며, 범위·다중범위의 원소는 typmod를 가질 수 없다.
 */
const CATALOG_NUMERIC_COLUMNS = `
  with recursive walk as (
    select c.relname::text  as relation,
           a.attname::text  as column_name,
           a.atttypid       as typid,
           a.atttypmod      as typmod,
           0                as depth
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relkind not in ('i', 'I')
       and a.attnum > 0
       and not a.attisdropped
    union all
    select w.relation,
           w.column_name,
           case when t.typtype = 'd'        then t.typbasetype
                when r.rngtypid is not null then r.rngsubtype
                else t.typelem end,
           case when t.typtype = 'd' and t.typtypmod <> -1 then t.typtypmod
                when r.rngtypid is not null then -1
                else w.typmod end,
           w.depth + 1
      from walk w
      join pg_type t on t.oid = w.typid
      left join pg_range r on t.oid in (r.rngtypid, r.rngmultitypid)
     where w.depth < 8
       and (t.typtype = 'd'
            or r.rngtypid is not null
            or (t.typcategory = 'A' and t.typelem <> 0))
  )
  select relation,
         column_name,
         case when typmod = -1 then null
              else ((typmod - 4) >> 16) & 65535 end                 as numeric_precision,
         case when typmod = -1 then null
              else (((typmod - 4) & 2047) # 1024) - 1024 end        as numeric_scale,
         format_type('numeric'::regtype, nullif(typmod, -1))        as canonical
    from walk
   where typid = 'numeric'::regtype
   order by relation, column_name
`

type CatalogRow = {
  relation: string
  column_name: string
  numeric_precision: number | null
  numeric_scale: number | null
  canonical: string
}

async function catalogRows(): Promise<CatalogRow[]> {
  return (await asOwner<CatalogRow>(CATALOG_NUMERIC_COLUMNS)).rows
}

function toShapes(rows: readonly CatalogRow[]): Record<string, NumericShape> {
  const shapes: Record<string, NumericShape> = {}
  for (const row of rows) {
    const key = `${row.relation}.${row.column_name}`
    // 한 열은 형 사슬 하나를 따라 내려가므로 두 번 나올 수 없다. 나온다면 질의가
    // 틀린 것이고, 덮어쓰면 그 사실이 조용히 사라진다
    if (key in shapes) throw new Error(`카탈로그 질의가 같은 열을 두 번 냈다: ${key}`)
    shapes[key] = { precision: row.numeric_precision, scale: row.numeric_scale }
  }
  return shapes
}

type LedgerDiff = {
  /** 카탈로그에만 있다 — 원장에 적지 않은 새 numeric 열 */
  catalogOnly: string[]
  /** 원장에만 있다 — 사라졌거나 numeric이 아니게 된 열 */
  ledgerOnly: string[]
  /** 둘 다 있으나 정밀도·scale이 다르다 */
  changed: { column: string; ledger: NumericShape; catalog: NumericShape }[]
}

const NO_DIFF: LedgerDiff = { catalogOnly: [], ledgerOnly: [], changed: [] }

function diffLedger(
  ledger: Record<string, NumericShape>,
  catalog: Record<string, NumericShape>,
): LedgerDiff {
  const catalogOnly = Object.keys(catalog)
    .filter((key) => !(key in ledger))
    .sort()
  const ledgerOnly = Object.keys(ledger)
    .filter((key) => !(key in catalog))
    .sort()
  const changed = Object.keys(ledger)
    .filter((key) => key in catalog)
    .sort()
    .filter(
      (key) =>
        ledger[key].precision !== catalog[key].precision ||
        ledger[key].scale !== catalog[key].scale,
    )
    .map((column) => ({ column, ledger: ledger[column], catalog: catalog[column] }))
  return { catalogOnly, ledgerOnly, changed }
}

describe('numeric 원장 — 정밀도·scale이 카탈로그와 정확히 일치한다', () => {
  it('public의 모든 numeric 열이 원장과 양방향 일치한다', async () => {
    expect(diffLedger(NUMERIC_LEDGER, toShapes(await catalogRows()))).toEqual(NO_DIFF)
  })

  it('typmod 해독이 Postgres 자신의 format_type과 같다', async () => {
    // 비트 연산을 잘못 옮기면 원장과 카탈로그가 **같은 방식으로** 틀려 초록이 된다.
    // 해독 결과를 정본 포매터와 행마다 맞춰 그 경로를 닫는다.
    //
    // ★ **현재 스키마의 typmod만으로는 이 대조가 판별하지 못한다** (실측). scale이
    // 0·4·6뿐이라 `(typmod - 4) & 255` 같은 틀린 해독도 전부 맞게 나오고, 그때 이
    // 케이스와 위 원장 대조가 **둘 다 초록**이었다. 그래서 경계값 열을 트랜잭션 안에
    // 만들어 함께 대조한다 — 음수 scale(PG15+), 255를 넘는 scale, 정밀도보다 큰 scale.
    // 롤백으로 사라진다
    await asOwner(
      `create table public.probe_typmod_edges (
         a numeric(5,-2), b numeric(1000,1000), c numeric(1000,-1000),
         d numeric(3,5),  e numeric(1,0),       f numeric
       )`,
    )
    const rows = await catalogRows()
    expect(rows.filter((row) => row.relation === 'probe_typmod_edges')).toHaveLength(6)
    for (const row of rows) {
      const decoded =
        row.numeric_precision === null
          ? 'numeric'
          : `numeric(${row.numeric_precision},${row.numeric_scale})`
      expect(decoded, `${row.relation}.${row.column_name}`).toBe(row.canonical)
    }
  })
})

/**
 * 계기 자기검사 — 대조가 보는 것을 실물로 확인한다
 *
 * 모든 DDL은 테스트 트랜잭션 안에서 일어나고 `afterEach`의 롤백으로 사라진다(이
 * 스위트에 커밋 경로가 없다). `lock_timeout`을 거는 이유는 `alter column … type`이
 * `ACCESS EXCLUSIVE`를 잡기 때문이다 — 다른 커넥션이 그 테이블을 쥐고 있으면
 * 테스트 제한 시간까지 조용히 기다리는 대신 원인이 적힌 오류로 끝나게 한다.
 */
describe('계기 자기검사 — 대조가 무엇을 보는지 롤백 트랜잭션 안에서 확인한다', () => {
  async function ddl(...statements: string[]): Promise<void> {
    await asOwner(`set local lock_timeout = '5s'`)
    for (const sql of statements) await asOwner(sql)
  }

  it('양성 대조 — 새 객체 종류의 numeric 열이 원장 밖으로 보고된다', async () => {
    await ddl(
      `create domain public.probe_typmod_amount as numeric(17,2)`,
      `create table public.probe_typmod_table (
         id    int,
         label text,
         plain numeric(15,0),
         loose numeric,
         arr   numeric(12,2)[],
         rng   numrange,
         dom   public.probe_typmod_amount,
         dom_arr public.probe_typmod_amount[]
       )`,
      `create view public.probe_typmod_view with (security_invoker = true)
         as select plain, loose + 1 as derived from public.probe_typmod_table`,
      `create materialized view public.probe_typmod_mv
         as select plain from public.probe_typmod_table with no data`,
      `create type public.probe_typmod_composite as (x numeric(9,3))`,
    )

    const catalog = toShapes(await catalogRows())

    // 정수·문자열 열(`id`·`label`)은 나오지 않는다 — 필터가 전부를 세는 것이 아니다
    expect(diffLedger(NUMERIC_LEDGER, catalog)).toEqual({
      catalogOnly: [
        'probe_typmod_composite.x',
        'probe_typmod_mv.plain',
        'probe_typmod_table.arr',
        'probe_typmod_table.dom',
        'probe_typmod_table.dom_arr',
        'probe_typmod_table.loose',
        'probe_typmod_table.plain',
        'probe_typmod_table.rng',
        'probe_typmod_view.derived',
        'probe_typmod_view.plain',
      ],
      ledgerOnly: [],
      changed: [],
    })

    // 형 사슬을 푼 결과가 선언과 같다 — 도메인·배열의 typmod 전파
    expect({
      arr: catalog['probe_typmod_table.arr'],
      rng: catalog['probe_typmod_table.rng'],
      dom: catalog['probe_typmod_table.dom'],
      dom_arr: catalog['probe_typmod_table.dom_arr'],
      derived: catalog['probe_typmod_view.derived'],
      composite: catalog['probe_typmod_composite.x'],
    }).toEqual({
      arr: { precision: 12, scale: 2 },
      rng: { precision: null, scale: null },
      dom: { precision: 17, scale: 2 },
      dom_arr: { precision: 17, scale: 2 },
      derived: { precision: null, scale: null },
      composite: { precision: 9, scale: 3 },
    })
  })

  it.each([
    {
      label: 'base_price를 numeric(20,6)으로 넓히면',
      sql: `alter table public.els_underlyings alter column base_price type numeric(20,6)`,
      column: 'els_underlyings.base_price',
      catalog: { precision: 20, scale: 6 },
    },
    {
      // P8 a2가 뗀 정밀도가 되돌아오는 회귀 — 이 계기가 컷 1에서 선 이유가 이 두 열이다
      label: 'principal을 numeric(15,0)으로 되돌리면 (P8 a2 회귀)',
      sql: `alter table public.els_products alter column principal type numeric(15,0)`,
      column: 'els_products.principal',
      catalog: { precision: 15, scale: 0 },
    },
    {
      label: 'redemptions.gross_amount를 numeric(15,0)으로 되돌리면 (P8 a2 회귀)',
      sql: `alter table public.redemptions alter column gross_amount type numeric(15,0)`,
      column: 'redemptions.gross_amount',
      catalog: { precision: 15, scale: 0 },
    },
  ])('음성 대조 — $label 그 열 하나만 보고된다', async ({ sql, column, catalog }) => {
    await ddl(sql)

    expect(diffLedger(NUMERIC_LEDGER, toShapes(await catalogRows()))).toEqual({
      catalogOnly: [],
      ledgerOnly: [],
      changed: [{ column, ledger: NUMERIC_LEDGER[column], catalog }],
    })
  })

  it('역방향 — 원장에 있는데 카탈로그에서 사라진 열을 보고한다', async () => {
    await ddl(`alter table public.tax_constants rename column value to value_probe`)

    expect(diffLedger(NUMERIC_LEDGER, toShapes(await catalogRows()))).toEqual({
      catalogOnly: ['tax_constants.value_probe'],
      ledgerOnly: ['tax_constants.value'],
      changed: [],
    })
  })
})
