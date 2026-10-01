import { describe, expect, it } from 'vitest'

import { asOwner } from './helpers/client'

/**
 * `public`에 부동소수 · money 열이 없다 — 절대 규칙 #2의 카탈로그 층 (DOC-010 AQ-88)
 *
 * ## 왜 따로 있는가
 *
 * types-drift와 `numeric-typmod.test.ts`는 둘 다 **numeric 계열만** 열거한다. 그래서 누가 환율을
 * `float8`로, 금액을 `money`로 만들면 그 열은 **두 계기 모두에 보이지 않는다** — numeric이 아니므로
 * 원장의 「카탈로그에만 있다」에도 나오지 않는다. 금액·비율에 부동소수점을 쓰지 않는다는 규칙이
 * 코드(린트 · `::text` · `InsertPayload`)에는 있고 스키마에는 없었다. P8 컷 a3가 `exchange_rates`를
 * 만들기 **전에** 둔다(AQ-88의 종결 조건) — 환율이 이 저장소의 첫 「부동소수로 만들고 싶어지는」 값이다.
 *
 * ## 무엇을 세는가
 *
 * `public`의 모든 관계(테이블 · 뷰 · 구체화 뷰 · 복합형 · 외부 테이블 — 색인 제외)의 열에서 **형 사슬을
 * 끝까지 푼 원소형**이 `real`(float4) · `double precision`(float8) · `money`인 것. 도메인 · 배열 · 범위를
 * 재귀로 푸는 방식은 `numeric-typmod.test.ts`와 같다 — `float8` 도메인의 배열도 잡힌다.
 *
 * 금액이 아닌 실수(통계량 등)가 정당하게 생기면 이 단언을 «허용 목록»으로 바꾸고 그 열의 사유를 적는다 —
 * 지금은 그런 열이 하나도 없으므로 0이 정본이다.
 */

const CATALOG_FLOAT_MONEY_COLUMNS = `
  with recursive walk as (
    select c.relname::text  as relation,
           a.attname::text  as column_name,
           a.atttypid       as typid,
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
           w.depth + 1
      from walk w
      join pg_type t on t.oid = w.typid
      left join pg_range r on t.oid in (r.rngtypid, r.rngmultitypid)
     where w.depth < 8
       and (t.typtype = 'd'
            or r.rngtypid is not null
            or (t.typcategory = 'A' and t.typelem <> 0))
  )
  select relation || '.' || column_name || ' ' || format_type(typid, null) as found
    from walk
   where typid in ('real'::regtype, 'double precision'::regtype, 'money'::regtype)
   order by 1
`

async function floatMoneyColumns(): Promise<string[]> {
  return (await asOwner<{ found: string }>(CATALOG_FLOAT_MONEY_COLUMNS)).rows.map((row) => row.found)
}

describe('AQ-88 — public에 부동소수 · money 열이 없다', () => {
  it('0개다 — 금액 · 비율 · 시세 · 환율은 전부 numeric이다', async () => {
    expect(await floatMoneyColumns()).toEqual([])
  })

  it('양성 대조 — 롤백 트랜잭션 안에서 만든 열을 전부 잡는다 (도메인 · 배열 · 범위 · 뷰 · 복합형)', async () => {
    await asOwner(`set local lock_timeout = '5s'`)
    await asOwner(`create domain public.probe_float_rate as double precision`)
    await asOwner(`create table public.probe_float_table (
         id      int,
         price   numeric(18,6),
         rate    float8,
         ratio   real,
         cash    money,
         rates   float8[],
         dom     public.probe_float_rate,
         dom_arr public.probe_float_rate[],
         span    numrange
       )`)
    await asOwner(`create view public.probe_float_view with (security_invoker = true)
         as select rate, price::float8 as derived from public.probe_float_table`)
    await asOwner(`create type public.probe_float_composite as (x real)`)

    // numeric · 정수 · numeric 범위(`span`)는 나오지 않는다 — 필터가 전부를 세는 것이 아니다
    expect(await floatMoneyColumns()).toEqual([
      'probe_float_composite.x real',
      'probe_float_table.cash money',
      'probe_float_table.dom double precision',
      'probe_float_table.dom_arr double precision',
      'probe_float_table.rate double precision',
      'probe_float_table.rates double precision',
      'probe_float_table.ratio real',
      'probe_float_view.derived double precision',
      'probe_float_view.rate double precision',
    ])
  })
})
