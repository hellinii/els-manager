import { describe, expect, it } from 'vitest'

import { actingAs, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { seedAsset, seedProduct, seedRedemption } from './helpers/seed'
import { expectConstraintViolation, expectRlsViolation } from './helpers/expect'

/**
 * 함수 축 — DOC-010 §7·§7.1, AQ-28
 *
 * **카탈로그 테스트의 모든 질의가 `relkind = 'r'`이었다.** 그래서 함수는 RLS·권한
 * 검증 전체의 밖에 있었고, AQ-20이 뷰에 대해 지적한 것과 같은 구멍이다 — 객체
 * 종류가 늘어날 때 기존 단언이 자동으로 따라오지 않는다.
 *
 * ## 함수에는 예방적 방어가 없다 (P3b 6단계 실측)
 *
 * 테이블은 `alter default privileges`가 신규 객체를 미리 막지만(§7.1), 함수에서는
 * 그 수단이 작동하지 않는다.
 *
 * | 신규 객체 | ACL | 결과 |
 * |---|---|---|
 * | 테이블 | `{postgres=…,service_role=Dxtm/…}` | `authenticated`에 TRUNCATE 없음 |
 * | 함수 | `(null)` | **`anon`이 EXECUTE 가능** |
 *
 * `pg_default_acl`에 PUBLIC을 제외한 항목이 이미 있는데도 그렇다. 그래서
 * **이 파일이 방어의 전부다** — 테이블에서는 백스톱이었던 것이 여기서는 유일한
 * 수단이다. 아래 마지막 describe가 그 사실 자체를 단언한다: 전제가 바뀌면(플랫폼이
 * 동작을 고치면) 그 케이스가 실패하고 이 주석을 다시 읽게 된다.
 */

/** `SECURITY DEFINER`가 정당한 함수 — DOC-010 §7 함수 권한 표 */
const DEFINER_ALLOWLIST = ['handle_new_auth_user', 'handle_auth_user_email_change']

/** `authenticated`에게 `EXECUTE`를 부여한 함수 — 그 밖은 트리거 전용이다 */
const EXECUTABLE_BY_AUTHENTICATED = ['create_els_product', 'update_els_product']

type FunctionRow = {
  proname: string
  prosecdef: boolean
  acl: string | null
  config: string | null
}

async function publicFunctions(): Promise<FunctionRow[]> {
  const result = await asOwner<FunctionRow>(
    `select p.proname, p.prosecdef, p.proacl::text as acl, p.proconfig::text as config
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
      order by p.proname`,
  )
  return result.rows
}

describe('실행 컨텍스트 — SECURITY DEFINER는 정책을 우회한다', () => {
  it('DEFINER 함수가 화이트리스트와 정확히 일치한다', async () => {
    const definers = (await publicFunctions())
      .filter((row) => row.prosecdef)
      .map((row) => row.proname)

    // 양방향이다. 새 함수에 편의로 definer를 붙이면 여기서 먼저 실패하고,
    // 반대로 기존 함수의 definer가 사라지면(트리거가 조용히 실패한다) 그것도 잡는다
    expect(definers.sort()).toEqual([...DEFINER_ALLOWLIST].sort())
  })

  /**
   * **네 번째 축 — `search_path` (P3b.5 추가).**
   *
   * v0.8까지 이 파일은 `prosecdef`·`PUBLIC`의 `EXECUTE`·롤별 실행 가능 목록
   * 셋만 보았다. 그 셋을 다 지키고 **`set search_path = ''`만 빠뜨린 함수는
   * 조용히 통과했다.** 비우지 않으면 함수 안의 미수식 참조가 호출자의 검색
   * 경로를 타므로 `security invoker`에서도 위험이 남는다.
   *
   * **화이트리스트가 아니라 전 함수 열거다** — 다른 세 축과 같은 형태로 둔다.
   * 새 함수가 이 줄을 빠뜨리면 여기서 먼저 실패한다.
   */
  it('전 함수가 search_path를 비운 채 고정한다', async () => {
    const rows = await publicFunctions()
    expect(rows.length, '함수를 하나도 못 찾았다 — 질의가 조용히 0건이다').toBeGreaterThan(0)

    // proconfig는 text[]이며 `set search_path = ''`는 `{"search_path=\"\""}`로 남는다
    expect(rows.map((row) => `${row.proname}: ${row.config ?? '(null)'}`)).toEqual(
      rows.map((row) => `${row.proname}: {"search_path=\\"\\""}`),
    )
  })

  it('쓰기 함수는 INVOKER다 — RLS가 함수 안의 INSERT에도 적용된다', async () => {
    const rows = await publicFunctions()
    for (const name of EXECUTABLE_BY_AUTHENTICATED) {
      const fn = rows.find((row) => row.proname === name)
      expect(fn, name).toBeDefined()
      expect(fn!.prosecdef, `${name}은 SECURITY INVOKER여야 한다`).toBe(false)
    }
  })
})

describe('EXECUTE 권한 — 기본이 PUBLIC이다', () => {
  it('어떤 함수에도 PUBLIC의 EXECUTE가 없다', async () => {
    /**
     * **`aclexplode`로 grantee를 본다.** ACL 문자열에서 `'=X/'`를 찾으면
     * `{postgres=X/postgres}`도 걸린다 — 소유자 항목이 우연히 같은 조각을 담기
     * 때문이다. PUBLIC은 grantee가 **비어 있는** 항목이며 `aclexplode`에서
     * `grantee = 0`이다.
     *
     * `proacl is null`은 내장 기본값(owner + PUBLIC)이 적용된 상태, 곧 **회수를
     * 빠뜨린 함수**다. `aclexplode(null)`은 0행이므로 따로 봐야 한다.
     */
    const leaked = await asOwner<{ proname: string; acl: string }>(
      `select p.proname, coalesce(p.proacl::text, '(null)') as acl
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))
        order by p.proname`,
    )
    expect(leaked.rows.map((row) => `${row.proname}: ${row.acl}`)).toEqual([])
  })

  it('anon은 어떤 함수도 실행할 수 없다', async () => {
    const rows = await publicFunctions()
    for (const row of rows) {
      const can = await asOwner<{ ok: boolean }>(
        `select has_function_privilege('anon', p.oid, 'EXECUTE') as ok
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [row.proname],
      )
      expect(can.rows[0].ok, `anon → ${row.proname}`).toBe(false)
    }
  })

  it('authenticated는 쓰기 함수만 실행할 수 있다', async () => {
    const rows = await publicFunctions()
    const allowed: string[] = []

    for (const row of rows) {
      const can = await asOwner<{ ok: boolean }>(
        `select has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [row.proname],
      )
      if (can.rows[0].ok) allowed.push(row.proname)
    }

    // 트리거 함수는 회수되어 있어도 트리거로는 실행된다 — EXECUTE를 검사하지
    // 않기 때문이다. 그 사실은 아래 "트리거가 여전히 돈다"가 확인한다
    expect(allowed.sort()).toEqual([...EXECUTABLE_BY_AUTHENTICATED].sort())
  })

  it('트리거는 EXECUTE 회수 후에도 돈다 — 회수의 안전성', async () => {
    // set_updated_at·freeze_asset_price_coordinates에서 EXECUTE를 회수했다.
    // 트리거 실행이 그것을 검사한다면 상품 수정이 42501로 죽는다.
    //
    // **updated_at을 과거로 밀어 두고 본다.** 이 스위트는 한 트랜잭션 안에서
    // 돌고 `now()`는 트랜잭션 시작 시각이므로, 같은 트랜잭션에서 만든 행은
    // 갱신 전후 값이 같다 — 그 상태로 단언하면 트리거가 돌아도 실패한다
    const product = await seedProduct({ ownerId: USER_A })
    await asOwner(
      "update public.els_products set updated_at = '2020-01-01T00:00:00Z' where id = $1",
      [product.id],
    )

    await actingAs(USER_A).query(
      "update public.els_products set name = '이름변경' where id = $1",
      [product.id],
    )

    const after = await asOwner<{ year: string }>(
      "select to_char(updated_at, 'YYYY') as year from public.els_products where id = $1",
      [product.id],
    )
    expect(after.rows[0].year).not.toBe('2020')
  })
})

describe('쓰기 함수 — RLS가 함수 안에서도 강제된다', () => {
  const payload = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: '함수생성상품',
      issueDate: '2026-01-02',
      principal: '100000000',
      evaluationPeriodMonths: 6,
      annualCouponRate: '0.0800',
      accountType: 'GENERAL',
      underlyings: [{ assetId: null, basePrice: '100.000000', sequence: 1 }],
      schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' }],
      ...overrides,
    })

  async function createVia(
    user: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const asset = await seedAsset({})
    const body = JSON.parse(
      payload({
        underlyings: [{ assetId: asset.id, basePrice: '100.000000', sequence: 1 }],
        ...overrides,
      }),
    )
    const result = await actingAs(user).query<{ id: string }>(
      'select public.create_els_product($1::jsonb) as id',
      [JSON.stringify(body)],
    )
    return result.rows[0].id
  }

  it('owner_id를 auth.uid()로 박는다 — payload의 ownerId를 읽지 않는다', async () => {
    const id = await createVia(USER_A, { ownerId: USER_B })

    const row = await asOwner<{ owner_id: string }>(
      'select owner_id from public.els_products where id = $1',
      [id],
    )
    // payload가 B를 주장해도 A가 소유자다. §5.1의 "입력값으로 받지 않는다"가
    // 규율이 아니라 구조다
    expect(row.rows[0].owner_id).toBe(USER_A)
  })

  it('하위 행이 함께 생성된다 — 한 트랜잭션', async () => {
    const id = await createVia(USER_A)

    const counts = await asOwner<{ u: number; s: number }>(
      `select (select count(*)::int from public.els_underlyings where els_id = $1) as u,
              (select count(*)::int from public.redemption_schedules where els_id = $1) as s`,
      [id],
    )
    expect(counts.rows[0]).toEqual({ u: 1, s: 1 })
  })

  it('금액·비율이 문자열 → numeric으로 정확히 저장된다 (W-04)', async () => {
    const id = await createVia(USER_A)

    const row = await asOwner<{ principal: string; rate: string; base: string }>(
      `select p.principal::text as principal, p.annual_coupon_rate::text as rate,
              u.base_price::text as base
         from public.els_products p
         join public.els_underlyings u on u.els_id = p.id
        where p.id = $1`,
      [id],
    )
    expect(row.rows[0]).toEqual({
      principal: '100000000',
      rate: '0.0800',
      base: '100.000000',
    })
  })

  it('I-07 — 기초자산 0건이면 상품 행까지 되돌아간다', async () => {
    const before = await asOwner<{ n: number }>(
      'select count(*)::int as n from public.els_products where owner_id = $1',
      [USER_A],
    )

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.create_els_product($1::jsonb)', [
          payload({ underlyings: [] }),
        ]),
      '23514',
      'els_products_underlyings_required',
    )

    // ★ 여기가 함수를 도입한 이유다. 요청 3개로 나누면 이 시점에 기초자산 0건인
    //   상품이 남고, 그것이 §5.3이 만들 수 없다고 단언한 상태다
    const after = await asOwner<{ n: number }>(
      'select count(*)::int as n from public.els_products where owner_id = $1',
      [USER_A],
    )
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('I-07 — 평가일정 0건도 되돌아간다', async () => {
    const asset = await seedAsset({})

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.create_els_product($1::jsonb)', [
          payload({
            underlyings: [{ assetId: asset.id, basePrice: '100.000000', sequence: 1 }],
            schedules: [],
          }),
        ]),
      '23514',
      'els_products_schedules_required',
    )
  })

  it('anon은 함수를 부를 수 없다 — EXECUTE 회수', async () => {
    // 42501이지만 RLS가 아니라 권한이다. 이 경로가 열려 있으면 anon 키만으로
    // 쓰기 함수의 존재를 확인하고 payload 형태를 탐색할 수 있다
    let code: string | undefined
    try {
      await actingAs(null).query('select public.create_els_product($1::jsonb)', [payload()])
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('42501')
  })
})

describe('update_els_product', () => {
  async function seedFull(owner: string): Promise<{ id: string; assetId: string }> {
    const asset = await seedAsset({})
    const result = await actingAs(owner).query<{ id: string }>(
      'select public.create_els_product($1::jsonb) as id',
      [
        JSON.stringify({
          name: '수정대상',
          issueDate: '2026-01-02',
          principal: '100000000',
          evaluationPeriodMonths: 6,
          annualCouponRate: '0.0800',
          kiBarrier: '0.5000',
          kiObservation: 'CLOSING',
          accountType: 'GENERAL',
          underlyings: [{ assetId: asset.id, basePrice: '100.000000', sequence: 1 }],
          schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' }],
        }),
      ],
    )
    return { id: result.rows[0].id, assetId: asset.id }
  }

  function updatePayload(assetId: string, overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      name: '수정됨',
      issueDate: '2026-01-02',
      principal: '200000000',
      evaluationPeriodMonths: 6,
      annualCouponRate: '0.0900',
      kiBarrier: '0.5000',
      kiObservation: 'CLOSING',
      accountType: 'GENERAL',
      underlyings: [{ assetId, basePrice: '110.000000', sequence: 1 }],
      schedules: [
        { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' },
        { roundNo: 2, evaluationDate: '2027-01-04', barrier: '0.8500' },
      ],
      ...overrides,
    })
  }

  it('하위 배열이 통째로 교체된다', async () => {
    const { id, assetId } = await seedFull(USER_A)

    await actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
      id,
      updatePayload(assetId),
    ])

    const row = await asOwner<{ principal: string; n: number; base: string }>(
      `select p.principal::text as principal,
              (select count(*)::int from public.redemption_schedules where els_id = p.id) as n,
              (select base_price::text from public.els_underlyings where els_id = p.id) as base
         from public.els_products p where p.id = $1`,
      [id],
    )
    expect(row.rows[0]).toEqual({ principal: '200000000', n: 2, base: '110.000000' })
  })

  it('타인의 상품은 NULL을 반환한다 — RLS의 USING이 0행으로 막는다', async () => {
    const { id, assetId } = await seedFull(USER_A)

    const result = await actingAs(USER_B).query<{ id: string | null }>(
      'select public.update_els_product($1, $2::jsonb) as id',
      [id, updatePayload(assetId)],
    )

    // 예외가 아니라 NULL이다. 구분(NOT_FOUND·FORBIDDEN)은 계약 계층이 한다(W-05)
    expect(result.rows[0].id).toBeNull()

    // 그리고 아무것도 바뀌지 않았다 — 하위 행 삭제까지 진행되면 안 된다
    const row = await asOwner<{ name: string; n: number }>(
      `select p.name,
              (select count(*)::int from public.redemption_schedules where els_id = p.id) as n
         from public.els_products p where p.id = $1`,
      [id],
    )
    expect(row.rows[0]).toEqual({ name: '수정대상', n: 1 })
  })

  it('없는 상품도 NULL이다 — 존재 여부를 함수가 판정하지 않는다', async () => {
    const result = await actingAs(USER_A).query<{ id: string | null }>(
      'select public.update_els_product($1, $2::jsonb) as id',
      ['00000000-0000-4000-8000-0000000009ff', updatePayload(USER_A)],
    )
    expect(result.rows[0].id).toBeNull()
  })

  it('상환 완료 상품은 상태 충돌로 거부된다', async () => {
    const { id, assetId } = await seedFull(USER_A)
    await seedRedemption({ elsId: id })

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
          id,
          updatePayload(assetId),
        ]),
      '23514',
      'els_products_redeemed_immutable',
    )
  })

  /**
   * **I-07 — create 쪽과 대칭이다 (P3b.5).**
   *
   * 말미 검사가 create에만 테스트되어 있었다. update 쪽 두 블록은 지우면
   * 세 스위트가 전부 초록이었다 — §5.2가 "원자성이 `createProduct`보다 **더**
   * 필요하다"고 적은 쪽이 오히려 미검증이었다.
   *
   * 계약을 경유하면 V-02·V-03이 앞에서 잡으므로 여기 닿지 않는다(AQ-29).
   * 함수를 직접 부르는 것이 DB 층 방어를 보는 유일한 방법이다.
   */
  it('I-07 — 기초자산 0건 교체는 거부된다', async () => {
    const { id } = await seedFull(USER_A)

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
          id,
          updatePayload(USER_A, { underlyings: [] }),
        ]),
      '23514',
      'els_products_underlyings_required',
    )
  })

  it('I-07 — 평가일정 0건 교체도 거부된다', async () => {
    const { id, assetId } = await seedFull(USER_A)

    await expectConstraintViolation(
      () =>
        actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
          id,
          updatePayload(assetId, { schedules: [] }),
        ]),
      '23514',
      'els_products_schedules_required',
    )
  })

  it('낙인형을 해제하면 ki_touched_at도 함께 비워진다 (V-18, I-15)', async () => {
    const { id, assetId } = await seedFull(USER_A)
    await asOwner('update public.els_products set ki_touched_at = $2 where id = $1', [
      id,
      '2026-06-01',
    ])

    await actingAs(USER_A).query('select public.update_els_product($1, $2::jsonb)', [
      id,
      updatePayload(assetId, { kiBarrier: null, kiObservation: null }),
    ])

    const row = await asOwner<{ touched: string | null; barrier: string | null }>(
      'select ki_touched_at::text as touched, ki_barrier::text as barrier from public.els_products where id = $1',
      [id],
    )
    // 계약 계층이 기억해야 하는 규율을 함수가 구조로 만든다 — 남기면 I-15가
    // 거부하고, 통과했다면 판정이 그 사실을 못 본다
    expect(row.rows[0]).toEqual({ touched: null, barrier: null })
  })

  it('타인이 하위 행을 함수 밖에서 재부모화할 수 없다 — 정책이 그대로 있다', async () => {
    const { id } = await seedFull(USER_A)
    const asset = await seedAsset({ name: 'B자산' })

    await expectRlsViolation(() =>
      actingAs(USER_B).query(
        `insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
         values ($1, $2, 100.000000, 9)`,
        [id, asset.id],
      ),
    )
  })
})

describe('함수의 예방적 방어가 없다는 사실 자체를 고정한다', () => {
  /**
   * 이 케이스가 **실패하면 좋은 소식**이다 — 플랫폼이 동작을 고쳤다는 뜻이므로
   * 마이그레이션의 주석과 AQ-28을 갱신하면 된다. 지금은 그렇지 않다는 것을
   * 박아 두어야, 새 함수를 추가할 때 `revoke execute`가 선택이 아님이 드러난다.
   */
  it('새로 만든 함수는 PUBLIC 실행 가능으로 태어난다', async () => {
    await asOwner("create function public.probe_default_acl() returns int language sql as 'select 1'")

    const row = await asOwner<{ acl: string | null; anon_can: boolean }>(
      `select p.proacl::text as acl,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'probe_default_acl'`,
    )

    expect(row.rows[0].acl).toBeNull()
    expect(row.rows[0].anon_can).toBe(true)
    // 트랜잭션 롤백으로 사라진다 — 이 스위트에 커밋 경로가 없다
  })

  it('신규 테이블은 반대다 — 기본 권한 회수가 적용된다 (§7.1)', async () => {
    await asOwner('create table public.probe_default_table (id int)')

    const row = await asOwner<{ acl: string | null; trunc: boolean }>(
      `select c.relacl::text as acl,
              has_table_privilege('authenticated', c.oid, 'TRUNCATE') as trunc
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relname = 'probe_default_table'`,
    )

    expect(row.rows[0].acl).not.toBeNull()
    expect(row.rows[0].trunc).toBe(false)
  })
})
