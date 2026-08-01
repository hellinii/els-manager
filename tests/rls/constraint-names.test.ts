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
  // ★ P6 컷 5에서 **`CHECK`에서 트리거로 내려왔다** — 면제 조건이 부모 상품의
  // `entry_mode`라 단일 행 `CHECK`로 표현할 수 없다(DOC-002 §8 I-14). 그래서
  // 이 이름은 이제 `pg_constraint`에 **없고** 여기로 옮겨진다. 접미사에서
  // `_check`가 빠진 것도 같은 사실의 표현이다(`*_required` = 교차 행 규칙).
  'redemptions_round_no_required',
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

  it('RAISE 라벨 전부가 마이그레이션 SQL에 있다', () => {
    const sql = migrationText()
    const missing = RAISE_ONLY.filter((name) => !sql.includes(`constraint = '${name}'`))
    expect(missing).toEqual([])
  })

  it('RAISE 라벨은 detail에도 실린다 — PostgREST 경로의 유일한 채널', () => {
    // constraint 옵션만 지정하면 그 이름이 HTTP 경계에서 사라진다(2단계 실측).
    // 두 채널을 다 채우지 않으면 계약 계층이 fields를 만들 수 없다
    const sql = migrationText()
    const missing = RAISE_ONLY.filter(
      (name) => !sql.includes(`detail     = 'constraint=${name}'`),
    )
    expect(missing).toEqual([])
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
