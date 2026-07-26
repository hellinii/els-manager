import { describe, expect, it } from 'vitest'
import { actingAs, anonymously, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { seedAsset, seedPrice } from './helpers/seed'
import { expectPermissionDenied } from './helpers/expect'

/**
 * `assets` · `asset_prices` — DOC-010 §7 "조회 전체 / 변경 전체 (공용 데이터).
 * 삭제 제외"
 *
 * 소유권 모델(D-02)의 의도된 예외다. 시세는 자산 단위로 1회만 관리되므로
 * (§4.3) 누가 넣었는지가 의미를 갖지 않는다.
 *
 * **삭제를 열지 않는 근거는 "정정은 UPSERT로 수행하므로 삭제 경로가
 * 불필요하다"다**(DOC-010 v0.3 §7). 종전 근거("타인 상품의 조건 판정이
 * 깨진다")는 UPDATE에 더 강하게 적용되어 삭제만 막는 논거가 되지 못했다 —
 * 삭제는 E-01로 드러나지만 잘못된 UPDATE는 드러나지 않는다.
 *
 * **좌표의 변경은 권한이 아니라 무결성으로 막는다**(I-16, constraints.test.ts).
 * 관측값의 수정은 공용 데이터 원칙대로 전체에 열려 있다.
 */

describe('공용 데이터 — 조회·등록·수정은 전체', () => {
  it('B는 A가 등록한 자산을 조회한다', async () => {
    const { id } = await seedAsset({ name: '테슬라' })

    const seen = await actingAs(USER_B).query('select id from public.assets where id = $1', [
      id,
    ])
    expect(seen.rowCount).toBe(1)
  })

  it('인증 사용자는 자산을 등록한다 (DOC-011 §5.10)', async () => {
    const created = await actingAs(USER_A).query(
      `insert into public.assets (name, asset_type, market, currency)
       values ('엔비디아', 'STOCK', 'NASDAQ', 'USD')`,
    )
    expect(created.rowCount).toBe(1)
  })

  it('B는 A가 등록한 자산을 수정한다 — 공용이므로 허용된다', async () => {
    const { id } = await seedAsset({ name: '테슬라' })

    const updated = await actingAs(USER_B).query(
      'update public.assets set market = $2 where id = $1',
      [id, 'NYSE'],
    )
    expect(updated.rowCount).toBe(1)
  })

  it('인증 사용자는 시세를 UPSERT 한다 (DOC-011 §5.7)', async () => {
    const asset = await seedAsset({ name: '테슬라' })

    const upserted = await actingAs(USER_A).query(
      `insert into public.asset_prices (asset_id, as_of_date, price, source)
       values ($1, '2026-07-01', 391.922500, 'MANUAL')
       on conflict (asset_id, as_of_date) do update
         set price = excluded.price, source = excluded.source`,
      [asset.id],
    )
    expect(upserted.rowCount).toBe(1)
  })

  it('선행 행이 있을 때 UPSERT가 do update 분기를 탄다', async () => {
    // 위 케이스는 선행 시세가 없어 INSERT 경로만 탄다. 충돌이 실제로
    // 발생하는 상태를 따로 만들어야 do update 가 검증된다
    const asset = await seedAsset({ name: '테슬라' })
    await seedPrice({ assetId: asset.id, asOfDate: '2026-07-01' })

    const upserted = await actingAs(USER_A).query(
      `insert into public.asset_prices (asset_id, as_of_date, price, source)
       values ($1, '2026-07-01', 400.000000, 'MANUAL')
       on conflict (asset_id, as_of_date) do update
         set price = excluded.price, source = excluded.source`,
      [asset.id],
    )
    expect(upserted.rowCount).toBe(1)

    const after = await asOwner<{ price: string }>(
      'select price from public.asset_prices where asset_id = $1',
      [asset.id],
    )
    expect(after.rows[0].price).toBe('400.000000')
  })

  it('supabase-js .upsert() 모양 — payload 전역을 do update set에 실어도 통과한다', async () => {
    // ★ I-16을 열 단위 GRANT가 아니라 트리거로 강제한 목적이 이것이다.
    //
    // supabase-js 의 .upsert() 는 payload 전역을 DO UPDATE SET 에 싣는다.
    // asset_id·as_of_date 를 열 단위 GRANT 로 회수하면 이 문장이 42501 로
    // 실패하고, DOC-011 §5.7 saveManualPrice 가 클라이언트 도구를 우회해야
    // 한다. 트리거는 동일값 재대입을 통과시키므로 그대로 동작한다
    const asset = await seedAsset({ name: '테슬라' })
    await seedPrice({ assetId: asset.id, asOfDate: '2026-07-01' })

    const upserted = await actingAs(USER_A).query(
      `insert into public.asset_prices (asset_id, as_of_date, price, source)
       values ($1, '2026-07-01', 402.500000, 'MANUAL')
       on conflict (asset_id, as_of_date) do update
         set asset_id   = excluded.asset_id,
             as_of_date = excluded.as_of_date,
             price      = excluded.price,
             source     = excluded.source`,
      [asset.id],
    )
    expect(upserted.rowCount).toBe(1)
  })

  it('조회한 행을 그대로 되싣는 UPSERT — created_at을 밀리초로 절단해도 통과한다', async () => {
    // ★ created_at 을 동결 목록에서 뺀 판단을 고정한다.
    //
    // timestamptz 는 마이크로초, JS Date 는 밀리초까지만 표현한다. 클라이언트가
    // 행을 조회해 객체로 받은 뒤 그대로 되실으면 created_at 이 절단되어
    // 돌아온다. 동결했다면 is distinct from 이 참이 되어 정상적인 정정 UPSERT 가
    // 23514 로 거부된다
    const asset = await seedAsset({ name: '테슬라' })
    await seedPrice({ assetId: asset.id, asOfDate: '2026-07-01' })

    // date_trunc('milliseconds', …) 가 클라이언트 왕복의 정밀도 손실을 재현한다
    const upserted = await actingAs(USER_A).query(
      `insert into public.asset_prices (asset_id, as_of_date, price, source, created_at)
       select asset_id, as_of_date, 410.000000, source,
              date_trunc('milliseconds', created_at)
         from public.asset_prices where asset_id = $1
       on conflict (asset_id, as_of_date) do update
         set asset_id   = excluded.asset_id,
             as_of_date = excluded.as_of_date,
             price      = excluded.price,
             created_at = excluded.created_at`,
      [asset.id],
    )
    expect(upserted.rowCount).toBe(1)
  })

  it('B는 A가 넣은 시세를 수정한다', async () => {
    const asset = await seedAsset({ name: '테슬라' })
    const price = await seedPrice({ assetId: asset.id })

    const updated = await actingAs(USER_B).query(
      'update public.asset_prices set price = 400.000000 where id = $1',
      [price.id],
    )
    expect(updated.rowCount).toBe(1)
  })
})

describe('삭제는 열지 않는다', () => {
  it('자산 삭제는 권한 자체가 없다', async () => {
    const { id } = await seedAsset({ name: '테슬라' })

    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.assets where id = $1', [id]),
    )

    const survived = await asOwner('select id from public.assets where id = $1', [id])
    expect(survived.rowCount).toBe(1)
  })

  it('시세 삭제도 권한 자체가 없다', async () => {
    // 타인 상품의 워스트오브가 이 값에 의존한다. 지워지면 그 상품의 조건
    // 판정이 E-01(시세 없음)으로 떨어진다
    const asset = await seedAsset({ name: '테슬라' })
    const price = await seedPrice({ assetId: asset.id })

    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.asset_prices where id = $1', [price.id]),
    )

    const survived = await asOwner('select id from public.asset_prices where id = $1', [
      price.id,
    ])
    expect(survived.rowCount).toBe(1)
  })
})

describe('미인증 접근 (SEC-03)', () => {
  it('자산·시세를 조회할 수 없다', async () => {
    await expectPermissionDenied(() => anonymously.query('select id from public.assets'))
    await expectPermissionDenied(() =>
      anonymously.query('select id from public.asset_prices'),
    )
  })
})

describe('asset_provider_symbols — 조회 전용', () => {
  it('인증 사용자는 매핑을 조회한다 (DOC-011 §4.9)', async () => {
    const asset = await seedAsset({ name: '테슬라' })
    await asOwner(
      `insert into public.asset_provider_symbols (asset_id, provider, provider_symbol)
       values ($1, 'stub', 'TSLA')`,
      [asset.id],
    )

    const seen = await actingAs(USER_A).query(
      'select provider_symbol from public.asset_provider_symbols where asset_id = $1',
      [asset.id],
    )
    expect(seen.rowCount).toBe(1)
  })

  it('인증 사용자는 매핑을 추가·수정·삭제할 수 없다', async () => {
    // ADR-004 — 도메인 코드는 공급자 심볼을 알지 못하고, 편집 화면도 없다.
    // 변경은 마이그레이션과 수집 배치(service_role) 전용이다
    const asset = await seedAsset({ name: '테슬라' })

    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        `insert into public.asset_provider_symbols (asset_id, provider, provider_symbol)
         values ($1, 'stub', 'TSLA')`,
        [asset.id],
      ),
    )
    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        `update public.asset_provider_symbols set provider_symbol = 'X'`,
      ),
    )
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.asset_provider_symbols'),
    )
  })
})
