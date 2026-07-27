import { expect } from 'vitest'
import { dec } from '@/lib/decimal'
import { TAX_CONSTANT_KEY_MAP } from '@/lib/db/taxConstants'
import type { TaxConstants } from '@/lib/tax/types'
import { BRACKETS_2026, CONSTANTS_2026 } from './tax-2026'

/**
 * 시드 ↔ 픽스처 일치 계약 — AQ-05, ADR-005, DOC-002 §4.10
 *
 * 같은 단언을 두 곳에서 쓴다.
 *
 * | 대조 대상 | 파일 | 실행 조건 |
 * |---|---|---|
 * | 마이그레이션 `.sql` 텍스트 | `tests/seed/tax-2026-agreement.test.ts` | 항상 |
 * | 적용된 데이터베이스 | `tests/rls/tax-seed.test.ts` | 로컬 스택 필요 |
 *
 * 비교 로직을 한 모듈에 두어야 두 테스트가 서로 다른 정답을 갖는 일이 없다.
 *
 * 둘 다 필요한 이유는 잡는 것이 다르기 때문이다. SQL 파싱은 `numeric(6,4)`가
 * 값을 조용히 반올림하는 사고나 마이그레이션 미적용을 알 수 없고, DB 조회는
 * 로컬 스택이 없으면 아예 실행되지 않아 게이트가 사라진다.
 */

/**
 * TS 키 ↔ DB 키 매핑의 **정본은 `src/lib/db/taxConstants.ts`로 옮겼다** (P3a).
 *
 * 조회 계층도 같은 매핑이 필요하고, 사본을 두면 두 사본이 갈리는 순간 상수
 * 하나가 조용히 사라진다. 그 모듈은 `@/lib/tax/types` 외에 아무것도 import하지
 * 않으므로 이 상시 스위트가 supabase 클라이언트를 끌어오지 않는다.
 *
 * `satisfies`에 의한 양방향 완전성 강제도 그 파일에 함께 있다.
 */
export { TAX_CONSTANT_KEY_MAP }

/** `tax_constants` 1행 — DB·SQL 어느 쪽에서 왔든 값은 문자열이다 */
export type ConstantRow = { key: string; value: string }

/** `tax_brackets` 1행 */
export type BracketRow = {
  lowerBound: string
  rate: string
  progressiveDeduction: string
}

/** 매핑이 픽스처의 키 집합을 정확히 덮는지 — 타입 검사의 런타임 이중화 */
export function assertKeyMapIsComplete(): void {
  expect(Object.keys(TAX_CONSTANT_KEY_MAP).sort()).toEqual(
    Object.keys(CONSTANTS_2026).sort(),
  )
  const dbKeys = Object.values(TAX_CONSTANT_KEY_MAP)
  expect(new Set(dbKeys).size, 'DB 키가 중복된다').toBe(dbKeys.length)
}

/**
 * 상수 9개 일치 — DOC-002 §4.10
 *
 * 값 비교는 반드시 Decimal로 한다. `tax_constants.value`는 `numeric(18,6)`
 * 이므로 픽스처의 `'0.14'`가 `'0.140000'`으로 돌아온다. 문자열 비교는
 * 무조건 깨진다.
 */
export function assertConstantsAgree(rows: readonly ConstantRow[]): void {
  assertKeyMapIsComplete()

  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  expect(byKey.size, '시드에 중복 키가 있다').toBe(rows.length)

  // 누락 키와 잉여 키(오탈자로 생긴 고아 행)를 동시에 잡는다
  expect([...byKey.keys()].sort()).toEqual(
    [...Object.values(TAX_CONSTANT_KEY_MAP)].sort(),
  )

  for (const [tsKey, dbKey] of Object.entries(TAX_CONSTANT_KEY_MAP)) {
    const fixture = CONSTANTS_2026[tsKey as keyof TaxConstants]
    const seeded = byKey.get(dbKey)!
    expect(
      dec(seeded).eq(dec(fixture)),
      `${tsKey} ↔ ${dbKey}: 픽스처 ${String(fixture)} ≠ 시드 ${seeded}`,
    ).toBe(true)
  }
}

/**
 * 구간 8행 일치 — DOC-007 §5.1
 *
 * `rate`는 `numeric(6,4)`이므로 `'0.40'`이 `'0.4000'`으로 돌아온다.
 */
export function assertBracketsAgree(rows: readonly BracketRow[]): void {
  expect(rows, '2026년 세율 구간은 8행이다').toHaveLength(BRACKETS_2026.length)

  const sorted = [...rows].sort((a, b) =>
    dec(a.lowerBound).comparedTo(dec(b.lowerBound)),
  )

  sorted.forEach((row, index) => {
    const fixture = BRACKETS_2026[index]
    const at = `구간 #${index + 1}(하한 ${row.lowerBound})`

    expect(dec(row.lowerBound).eq(dec(fixture.lowerBound)), `${at} 하한`).toBe(
      true,
    )
    expect(dec(row.rate).eq(dec(fixture.rate)), `${at} 세율`).toBe(true)
    expect(
      dec(row.progressiveDeduction).eq(dec(fixture.progressiveDeduction)),
      `${at} 누진공제`,
    ).toBe(true)
  })
}
