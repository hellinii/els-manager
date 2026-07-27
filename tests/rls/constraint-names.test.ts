import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MAPPED_CONSTRAINTS } from '@/lib/db/mutations/errors'

import { asOwner } from './helpers/client'

/**
 * 제약 이름은 계약 계층의 **입력값**이다 — DOC-011 §3.2.1, DOC-002 §8 명명 규약
 *
 * `errors.ts`가 이름으로 `fields`와 `ErrorCode`를 결정하므로, 이름이 하나라도
 * 어긋나면 그 오류는 조용히 기본값으로 떨어진다 — 필드 오류를 잃거나(사용자가
 * 어느 칸을 고칠지 모른다) 상태 충돌이 필드 오류가 된다(고칠 칸이 없다).
 * **오타는 어떤 테스트도 실패시키지 않고 런타임에도 드러나지 않는다.**
 *
 * ## 대조를 DB에서 하는 이유
 *
 * SQL 텍스트 파싱으로는 부족하다. `redemptions_els_id_fkey`처럼 **암묵적으로
 * 이름이 붙는 FK**는 마이그레이션 어디에도 문자열로 나타나지 않는다(`references`
 * 절만 있다). `pg_constraint`가 유일한 정본이다.
 *
 * ## 두 부류를 나눈다
 *
 * | 부류 | 실재하는 곳 | 검사 |
 * |---|---|---|
 * | 실제 제약 | `pg_constraint` | 카탈로그에 있는가 |
 * | `RAISE`가 만드는 이름 | 마이그레이션의 `constraint = '…'` | SQL 텍스트에 있는가 |
 *
 * 후자(I-16 트리거, P3b 6단계의 쓰기 함수)는 제약 객체가 아니라 **거부의 라벨**
 * 이므로 카탈로그에 없다. 그래도 오타는 같은 결과를 낳으므로 함께 본다.
 */

/** `pg_constraint`에 없는 이름 — plpgsql `RAISE`의 라벨이다 */
const RAISE_ONLY = [
  'asset_prices_coordinates_immutable',
  // P3b 6단계의 쓰기 함수가 만든다. 그 단계 전에는 SQL에도 없으므로 아래
  // 텍스트 대조에서 제외되며, 6단계가 이 목록을 그대로 쓴다
  'els_products_underlyings_required',
  'els_products_schedules_required',
  'els_products_redeemed_immutable',
] as const

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

function migrationText(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n')
}

async function catalogConstraints(): Promise<Set<string>> {
  const result = await asOwner<{ conname: string }>(
    `select conname
       from pg_constraint
      where connamespace = 'public'::regnamespace
        and contype in ('c', 'u', 'p', 'f')`,
  )
  return new Set(result.rows.map((row) => row.conname))
}

describe('사상의 이름이 실재한다', () => {
  it('실제 제약 이름이 모두 pg_constraint에 있다', async () => {
    const catalog = await catalogConstraints()
    const missing = MAPPED_CONSTRAINTS.filter(
      (name) => !RAISE_ONLY.includes(name as (typeof RAISE_ONLY)[number]) && !catalog.has(name),
    )
    expect(missing).toEqual([])
  })

  it('RAISE 라벨이 마이그레이션 SQL에 있다', () => {
    const sql = migrationText()
    // 6단계 전에는 쓰기 함수의 라벨이 아직 없다. 있는 것만 대조하고,
    // 6단계가 끝나면 이 목록이 전부 채워진다 — 그 상태를 아래 단언이 고정한다
    const present = RAISE_ONLY.filter((name) => sql.includes(`constraint = '${name}'`))
    expect(present).toContain('asset_prices_coordinates_immutable')
  })
})

describe('모든 CHECK 제약에 사상이 있다 — 역방향', () => {
  /**
   * 새 `CHECK`를 추가하고 사상을 잊으면 그 위반은 "입력값을 확인한다"만 남고
   * **어느 필드인지 말하지 않는다.** `VALIDATION_FAILED`의 정의(필드별 오류 표시)를
   * 만족하지 못하는 응답이며, 그 상태는 조용하다.
   *
   * `UNIQUE`·FK는 역방향을 강제하지 않는다 — 기본값(`CONFLICT` + 일반 메시지)이
   * 화면 처리로서 성립하고, 참조 데이터의 PK처럼 계약이 건드릴 수 없는 제약이
   * 다수 포함되기 때문이다. `CHECK`는 전부 사용자 입력에서 도달 가능하다.
   */
  it('public의 CHECK 제약 집합이 사상에 포함된다', async () => {
    const result = await asOwner<{ conname: string }>(
      `select conname
         from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'c'
        order by conname`,
    )

    const unmapped = result.rows
      .map((row) => row.conname)
      .filter((name) => !MAPPED_CONSTRAINTS.includes(name))

    expect(unmapped).toEqual([])
  })

  it('I-17의 네 제약이 실재한다 — 마이그레이션 적용 확인', async () => {
    const catalog = await catalogConstraints()
    for (const name of [
      'els_products_principal_check',
      'els_products_evaluation_period_check',
      'redemption_schedules_barrier_check',
      'redemptions_gross_amount_check',
    ]) {
      expect(catalog.has(name), name).toBe(true)
    }
  })
})
