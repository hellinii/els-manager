import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor } from './helpers/auth'
import { FX, FX_NAME_PREFIX, ITG_USER_A } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures } from './helpers/seed'
import { setupScenario } from './helpers/scenario'
import type { UserSessionClient } from '@/lib/db/client'

/**
 * PostgREST 오류 본문의 형태 — DOC-011 §3.2.1의 **전제**
 *
 * §3.2.1은 SQLSTATE와 **제약 이름**으로 `ErrorCode`와 `fields`를 결정한다. 그런데
 * `PostgrestError`는 `{code, message, details, hint}` 넷뿐이고 `pg`가 주는
 * `constraint` 필드가 **없다.** 즉 이름을 어디서 얻는지가 매핑 구현의 전제이며,
 * 그 전제는 라이브러리·PostgREST·PostgreSQL 버전에 걸쳐 있다.
 *
 * **이 파일은 그 전제를 고정한다.** 형태가 바뀌면 매핑이 조용히 `INTERNAL`로
 * 퇴화하는 대신 여기가 먼저 빨간불이 된다 — `tests/db/errors.test.ts`는 여기서
 * 측정한 본문을 픽스처로 쓰므로 손으로 지은 가짜 오류만으로는 이 전제를 볼 수 없다.
 *
 * ## 측정 결과 (P3b 2단계)
 *
 * | 형태 | 이름의 위치 |
 * |---|---|
 * | 표준 `CHECK`·`UNIQUE`·FK | `message`의 `constraint "<이름>"` |
 * | **plpgsql `RAISE … using constraint`** | **어디에도 없다** ← 아래 |
 * | `42501` | 이름 없음. RLS와 권한 미부여는 `message`로 구분된다 |
 * | `22001`·`22003` | 이름도 **열 이름도** 없다 |
 * | `23502` | `message`에 열 이름이 있다 |
 *
 * **plpgsql `RAISE`의 `constraint`가 사라진다.** I-16 트리거는
 * `using errcode = '23514', constraint = 'asset_prices_coordinates_immutable'`로
 * 던지는데, HTTP 경계를 넘은 본문에는 `message`(한글 문구)만 남고 `details`·`hint`가
 * `null`이다. `tests/rls/`가 `error.constraint`를 단언할 수 있는 것은 그쪽이 `pg`
 * **직결**이기 때문이며, 같은 예외가 두 경로에서 다른 정보를 준다.
 *
 * 그래서 P3b 5·6단계는 plpgsql `RAISE`에 **`detail`로 이름을 함께 싣는다** —
 * `constraint` 옵션은 `pg` 경로(기존 `constraints.test.ts`)를 위해 유지한다.
 * 두 채널을 다 채우는 것이 어느 한쪽 테스트를 깨지 않는 유일한 형태다.
 *
 * ## 이 파일은 상태를 바꾸지 않는다
 *
 * 모든 케이스가 **거부되는** 조작이므로 성공 경로가 없다. 그럼에도 픽스처를
 * 세우는 이유는 위반 대상이 실재해야 하기 때문이며, 실패해야 할 문장이 성공하면
 * (제약·정책이 사라졌다면) `expect(error).not.toBeNull()`이 먼저 걸린다.
 */

let dbA: UserSessionClient

beforeAll(async () => {
  await setupScenario()
  dbA = await clientFor(ITG_USER_A)
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

type Body = { code: string; message: string; details: string | null; hint: string | null }

/**
 * 생성 타입의 `Insert`·`Update`는 금액·비율 열을 **`number`로 요구한다.**
 *
 * `::text` 캐스팅으로 읽기 방향을 막은 것(Q-08)과 달리 **쓰기 방향에는 방어가
 * 없었다** — 타입을 그대로 따르면 금액을 `number`로 실어야 하고, 그것이 절대
 * 규칙 #2가 금지하는 float64 경유다. PostgREST는 `numeric` 열에 문자열을 받으므로
 * 값은 문자열로 보내는 것이 맞고, 어긋나는 것은 생성 타입이다.
 *
 * 이 파일은 **오류 본문을 측정하는** 것이 목적이므로 여기서 한 번만 캐스팅하고,
 * 구조적 해결(`InsertPayload<T>` — `defineColumns`의 쓰기 쪽 대응물)은 변경 계약
 * 구현에서 만든다. DOC-011 §5.0 W-04·AQ-30.
 */
function amounts(payload: Record<string, unknown>): never {
  return payload as never
}

/** 거부를 잡아 본문만 남긴다. 성공은 그 자체로 실패다 — 방어가 사라졌다는 뜻이다. */
function bodyOf(error: unknown, what: string): Body {
  expect(error, `${what}: 거부되어야 할 조작이 성공했다`).not.toBeNull()
  const e = error as Body
  return { code: e.code, message: e.message, details: e.details, hint: e.hint }
}

/** §3.2.1의 파싱 대상 ① — 표준 제약 위반은 이름을 메시지에 담는다 */
const CONSTRAINT_IN_MESSAGE = /constraint "([^"]+)"/

describe('표준 제약 위반 — 이름이 message에 있다', () => {
  it('23514 CHECK — els_products_ki_pair_check (I-11)', async () => {
    const { error } = await dbA
      .from('els_products')
      .update({ ki_observation: null })
      .eq('id', FX.productA)

    const body = bodyOf(error, 'I-11 위반')
    expect(body.code).toBe('23514')
    expect(CONSTRAINT_IN_MESSAGE.exec(body.message)?.[1]).toBe(
      'els_products_ki_pair_check',
    )
  })

  it('23505 UNIQUE — assets_name_market_key', async () => {
    const { error } = await dbA.from('assets').insert({
      name: `${FX_NAME_PREFIX} 단독자산`,
      asset_type: 'STOCK',
      market: 'NASDAQ',
      currency: 'USD',
    })

    const body = bodyOf(error, 'UNIQUE 위반')
    expect(body.code).toBe('23505')
    expect(CONSTRAINT_IN_MESSAGE.exec(body.message)?.[1]).toBe('assets_name_market_key')
    // 키 값을 details로 노출하지 않는다 — PostgREST가 그것을 접는다(실측)
    expect(body.details).toBeNull()
  })

  it('23503 FK RESTRICT — 상환 완료 상품은 삭제되지 않는다 (§5.3)', async () => {
    const { error } = await dbA.from('els_products').delete().eq('id', FX.productRedeemed)

    const body = bodyOf(error, 'FK RESTRICT')
    expect(body.code).toBe('23503')
    expect(CONSTRAINT_IN_MESSAGE.exec(body.message)?.[1]).toBe('redemptions_els_id_fkey')
    // FK만 details가 채워진다 — 참조하는 쪽 테이블이 들어온다
    expect(body.details).toBe('Key is still referenced from table "redemptions".')
  })
})

describe('plpgsql RAISE — constraint 옵션이 HTTP 경계에서 사라진다', () => {
  it('23514 트리거 — I-16 좌표 불변', async () => {
    const { error } = await dbA
      .from('asset_prices')
      .update({ as_of_date: '2026-06-28' })
      .eq('asset_id', FX.assetSolo)
      .eq('as_of_date', '2026-06-29')

    const body = bodyOf(error, 'I-16 위반')
    expect(body.code).toBe('23514')

    // ★ 이 세 단언이 5·6단계의 detail 적재를 강제한다.
    //   메시지는 한글 문구이므로 표준 형태의 파싱이 아무것도 찾지 못하고,
    //   details·hint도 비어 있어 이름을 얻을 채널이 **하나도 없다**.
    expect(CONSTRAINT_IN_MESSAGE.exec(body.message)).toBeNull()
    expect(body.message).toContain('DOC-002 I-16')
    expect(body.details).toBeNull()
    expect(body.hint).toBeNull()
  })
})

describe('42501 — 두 원인이 SQLSTATE를 공유하고 message로 갈린다', () => {
  it('RLS 정책 위반 — 타인 상품에 하위 행 INSERT', async () => {
    const { error } = await dbA.from('els_underlyings').insert(
      amounts({
        els_id: FX.productB,
        asset_id: FX.assetSolo,
        base_price: '100.000000',
        sequence: 9,
      }),
    )

    const body = bodyOf(error, 'RLS 위반')
    expect(body.code).toBe('42501')
    // tests/rls/helpers/expect.ts의 구분이 HTTP 경유에서도 유지된다
    expect(body.message).toMatch(/row-level security/i)
  })

  it('권한 미부여 — 참조 데이터 UPDATE (ADR-005)', async () => {
    const { error } = await dbA
      .from('tax_constants')
      .update(amounts({ value: '0.999' }))
      .eq('tax_year', 2026)
      .eq('key', 'separate_taxation_rate')

    const body = bodyOf(error, '권한 미부여')
    expect(body.code).toBe('42501')
    expect(body.message).toMatch(/permission denied/i)
    // PostgREST가 해결책을 hint로 준다 — 사용자에게 노출하면 안 되는 문구다
    expect(body.hint).toContain('GRANT UPDATE ON public.tax_constants')
  })
})

describe('값의 형태 — V-19·V-20이 앞에서 잡아야 하는 이유', () => {
  it('22001 길이 초과 — 열 이름이 없다', async () => {
    const { error } = await dbA.from('assets').insert({
      name: `${FX_NAME_PREFIX} ${'가'.repeat(200)}`,
      asset_type: 'STOCK',
      market: 'NASDAQ',
      currency: 'USD',
    })

    const body = bodyOf(error, '길이 초과')
    expect(body.code).toBe('22001')
    // ★ 타입만 말한다. 어느 열인지 알 수 없으므로 fields를 채울 수 없다 —
    //   varchar(100)인 열이 둘 이상이면 어느 쪽인지 추정조차 안 된다.
    expect(body.message).toBe('value too long for type character varying(100)')
    expect(body.details).toBeNull()
  })

  it('22003 자릿수 초과 — 열 이름이 없다', async () => {
    const { error } = await dbA.from('asset_prices').insert(
      amounts({
        asset_id: FX.assetNoPrice,
        as_of_date: '2026-06-01',
        price: '99999999999999999999',
        source: 'MANUAL',
      }),
    )

    const body = bodyOf(error, '자릿수 초과')
    expect(body.code).toBe('22003')
    expect(body.message).toBe('numeric field overflow')
    // details는 정밀도만 말한다 (numeric(18,6) → 10^12)
    expect(body.details).toContain('precision 18, scale 6')
  })

  it('날짜 형식 오류는 22P02가 아니라 22007이다', async () => {
    const { error } = await dbA.from('asset_prices').insert(
      amounts({
        asset_id: FX.assetNoPrice,
        as_of_date: 'not-a-date',
        price: '100.000000',
        source: 'MANUAL',
      }),
    )

    const body = bodyOf(error, '날짜 형식')
    // ★ 실측이 명세를 고쳤다. 22P02(invalid_text_representation)는 uuid·numeric
    //   등에 나오고 date·timestamp는 22007(invalid_datetime_format)이다.
    //   매핑에 22007이 없으면 잘못 입력한 날짜가 INTERNAL로 떨어진다.
    expect(body.code).toBe('22007')
    expect(body.message).toContain('invalid input syntax for type date')
  })

  it('23502 널 위반 — 유일하게 열 이름이 message에 있다', async () => {
    const { error } = await dbA.from('assets').insert({
      name: `${FX_NAME_PREFIX} 널테스트`,
      asset_type: 'STOCK',
      market: 'NASDAQ',
    } as never)

    const body = bodyOf(error, '널 위반')
    expect(body.code).toBe('23502')
    expect(body.message).toBe(
      'null value in column "currency" of relation "assets" violates not-null constraint',
    )
  })
})
