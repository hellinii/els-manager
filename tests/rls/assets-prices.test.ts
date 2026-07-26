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
 * **삭제만은 예외의 예외다.** 계약(DOC-011 §5)에 삭제 함수가 없고, 한 사용자가
 * 시세를 지우면 그 자산을 쓰는 타인 상품의 조건 판정이 함께 깨진다.
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
