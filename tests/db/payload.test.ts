import { describe, expect, it } from 'vitest'

import {
  toInsert,
  toUpdate,
  type InsertPayload,
  type MoneyColumnOf,
  type UpdatePayload,
} from '@/lib/db/mutations/payload'
import {
  ELS_PRODUCT_COLUMNS,
  PRICE_COLUMNS,
  REDEMPTION_COLUMNS,
  SCHEDULE_COLUMNS,
  TAX_PROFILE_COLUMNS,
  UNDERLYING_COLUMNS,
} from '@/lib/db/select'

/**
 * 쓰기 방향의 Q-08 — AQ-30 (DOC-011 §5.0 W-04)
 *
 * **`@ts-expect-error`가 이 파일의 본체다.** 진짜 게이트는 `npm run typecheck`이며,
 * 주석이 붙은 줄이 오류를 내지 **않으면** tsc가 "사용되지 않은 @ts-expect-error"로
 * 실패한다 — 방어가 사라지면 테스트가 조용히 통과하는 대신 컴파일이 깨진다
 * (`brand.test.ts`와 같은 형태다).
 *
 * 값 단언으로는 이 결함을 잡을 수 없다는 것이 요점이다. `numeric(15,0)` 금액은
 * 15자리까지 float64로 정확하므로 어떤 값 비교도 영원히 통과한다.
 */

/*
 * 아래 타입 별칭들은 **값으로 쓰이지 않는 것이 정상**이다. 게이트는 런타임이
 * 아니라 `npm run typecheck`이며, `Expect<T extends true>`가 거짓을 받으면
 * 컴파일이 실패한다. 참조를 만들어 경고를 없애면 그 참조가 단언의 일부인 것처럼
 * 읽힌다.
 *
 * 이름의 `_` 접두사가 그 뜻이며 **파일 단위 `eslint-disable`이 필요 없다**
 * (P4 컷 1b) — `els/unused-underscore`가 `^_`를 관례로 인정하게 했으므로, 규칙을
 * 끄지 않고도 의도가 표현된다. 규칙을 끄면 이 파일의 **진짜** 미사용 변수도
 * 함께 보이지 않게 된다.
 */

type Expect<T extends true> = T
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** 열 사양(읽기)에서 `::text` 캐스팅 대상만 뽑는다 */
type TextColumns<S> = { [K in keyof S]: S[K] extends 'text' ? K : never }[keyof S]

// ---------------------------------------------------------------------------
// ① 읽기와 쓰기가 "무엇이 금액인가"에 대해 갈리지 않는다
//
// 읽기는 `::text`로, 쓰기는 `string`으로 막는데 두 목록이 어긋나면 한 방향만
// 막힌 열이 생긴다. 둘 다 `CountingColumn` 하나에서 파생되므로 **같아야 하며**,
// 아래는 그 동치를 계약이 쓰는 6개 테이블 전부에 대해 단언한다.
// ---------------------------------------------------------------------------

type _ProductsAgree = Expect<
  Equals<TextColumns<typeof ELS_PRODUCT_COLUMNS>, MoneyColumnOf<'els_products'>>
>
type _UnderlyingsAgree = Expect<
  Equals<TextColumns<typeof UNDERLYING_COLUMNS>, MoneyColumnOf<'els_underlyings'>>
>
type _SchedulesAgree = Expect<
  Equals<TextColumns<typeof SCHEDULE_COLUMNS>, MoneyColumnOf<'redemption_schedules'>>
>
type _RedemptionsAgree = Expect<
  Equals<TextColumns<typeof REDEMPTION_COLUMNS>, MoneyColumnOf<'redemptions'>>
>
type _PricesAgree = Expect<Equals<TextColumns<typeof PRICE_COLUMNS>, MoneyColumnOf<'asset_prices'>>>
type _ProfilesAgree = Expect<
  Equals<TextColumns<typeof TAX_PROFILE_COLUMNS>, MoneyColumnOf<'tax_profiles'>>
>

// ---------------------------------------------------------------------------
// ② 금액은 문자열, 개수는 수치. 널 허용은 보존된다
// ---------------------------------------------------------------------------

type _PrincipalIsString = Expect<Equals<InsertPayload<'els_products'>['principal'], string>>
type _KiBarrierKeepsNull = Expect<
  Equals<InsertPayload<'els_products'>['ki_barrier'], string | null | undefined>
>
/** 개수를 세는 정수는 그대로 `number`다 — 여기가 `string`이 되면 판정이 아니라 분류가 틀린 것이다 */
type _MonthsStayNumber = Expect<
  Equals<InsertPayload<'els_products'>['evaluation_period_months'], number | undefined>
>
type _RoundNoStaysNumber = Expect<
  Equals<InsertPayload<'redemptions'>['round_no'], number | null | undefined>
>
type _TaxYearStaysNumber = Expect<Equals<InsertPayload<'tax_profiles'>['tax_year'], number>>
/** 수치가 아닌 열은 손대지 않는다 */
type _BooleanUntouched = Expect<Equals<InsertPayload<'redemptions'>['is_confirmed'], boolean>>
/** `Update`도 같은 사상을 받는다 (전 열이 선택적인 것만 다르다) */
type _UpdateStringifies = Expect<
  Equals<UpdatePayload<'redemptions'>['taxable_income'], string | undefined>
>

describe('AQ-30 — 생성 타입의 쓰기 방향에 Q-08 방어가 생겼다', () => {
  it('금액 열에 number를 넣을 수 없다 — 생성 타입이 요구하던 바로 그 형태다', () => {
    toInsert('asset_prices', {
      asset_id: '00000000-0000-4000-8000-000000000001',
      as_of_date: '2026-06-30',
      // @ts-expect-error — 생성 타입은 `price: number`를 요구한다. 그것이 AQ-30이다.
      price: 99999999999.999999,
      source: 'MANUAL',
    })

    toInsert('els_products', {
      owner_id: '00000000-0000-4000-8000-000000000001',
      name: '상품',
      issue_date: '2026-01-02',
      // @ts-expect-error — 금액
      principal: 100000000,
      annual_coupon_rate: '0.08',
      account_type: 'GENERAL',
    })

    toUpdate('redemptions', {
      // @ts-expect-error — 금액
      taxable_income: 4000000,
    })

    expect(true).toBe(true)
  })

  it('개수 열에 문자열을 넣을 수 없다 — 사상이 반대로 넓어지는 것도 막는다', () => {
    toInsert('redemptions', {
      els_id: '00000000-0000-4000-8000-000000000001',
      redemption_type: 'EARLY',
      // @ts-expect-error — 차수는 세는 값이므로 number다
      round_no: '1',
      redemption_date: '2026-05-04',
      gross_amount: '104000000',
      taxable_income: '4000000',
      is_confirmed: true,
    })

    expect(true).toBe(true)
  })

  it('문자열 금액은 그대로 통과한다 — 방어가 정상 경로를 막지 않는다', () => {
    const payload = toInsert('asset_prices', {
      asset_id: '00000000-0000-4000-8000-000000000001',
      as_of_date: '2026-06-30',
      price: '99999999999.999999',
      source: 'MANUAL',
    })

    // 단언 하나만 있고 변환은 없다 — 전송되는 값이 곧 우리가 쓴 문자열이다.
    expect(payload).toEqual({
      asset_id: '00000000-0000-4000-8000-000000000001',
      as_of_date: '2026-06-30',
      price: '99999999999.999999',
      source: 'MANUAL',
    })
    expect(typeof (payload as unknown as { price: unknown }).price).toBe('string')
  })

  it('널 허용 금액은 null을 받는다', () => {
    const payload = toUpdate('els_products', { ki_barrier: null, ki_observation: null })
    expect(payload).toEqual({ ki_barrier: null, ki_observation: null })
  })
})

/**
 * 열 사양(런타임)과 문서의 금액 열 목록을 대조한다.
 *
 * 위 ①은 **타입 수준**에서 읽기와 쓰기를 묶었다. 여기서는 그 읽기 사양 자체가
 * 기대한 열을 담고 있는지를 본다 — 두 방향이 함께 틀리면 ①은 여전히 통과하기
 * 때문이다. 세 꼭짓점(문서 목록 · 읽기 사양 · 쓰기 타입)이 닫혀야 한다.
 */
describe('금액 열 목록이 문서와 일치한다', () => {
  const textColumnsOf = (spec: Record<string, string>): string[] =>
    Object.entries(spec)
      .filter(([, kind]) => kind === 'text')
      .map(([column]) => column)
      .sort()

  const EXPECTED: Array<[string, Record<string, string>, string[]]> = [
    ['els_products', ELS_PRODUCT_COLUMNS, ['annual_coupon_rate', 'ki_barrier', 'principal']],
    ['els_underlyings', UNDERLYING_COLUMNS, ['base_price']],
    [
      'redemption_schedules',
      SCHEDULE_COLUMNS,
      ['barrier', 'lizard_barrier', 'lizard_coupon_rate'],
    ],
    ['redemptions', REDEMPTION_COLUMNS, ['gross_amount', 'taxable_income', 'withholding_tax']],
    ['asset_prices', PRICE_COLUMNS, ['price']],
    ['tax_profiles', TAX_PROFILE_COLUMNS, ['other_financial_income', 'other_income_base']],
  ]

  for (const [table, spec, expected] of EXPECTED) {
    it(`${table} — ${expected.length}개`, () => {
      expect(textColumnsOf(spec)).toEqual(expected)
    })
  }
})
