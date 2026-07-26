import { describe, expect, it } from 'vitest'
import { actingAs } from './helpers/client'
import { USER_A } from './helpers/fixtures'
import {
  assertBracketsAgree,
  assertConstantsAgree,
  type BracketRow,
  type ConstantRow,
} from '../fixtures/tax-seed-contract'

/**
 * AQ-05 (적용 상태) — 실제 DB에 들어간 값을 검증한다.
 *
 * `tests/seed/`의 `.sql` 파싱이 잡지 못하는 것만 여기서 잡힌다.
 *
 * - 마이그레이션이 적용되지 않았다
 * - 후속 마이그레이션이 2026년 행을 수정했다 (ADR-005 위반)
 * - `numeric(6,4)` / `numeric(18,6)`이 값을 조용히 반올림했다
 * - 중복 행이 있다
 *
 * 조회를 `authenticated` 롤로 하므로 참조 테이블의 SELECT 정책도 함께
 * 증명된다. `pg`는 NUMERIC을 문자열로 돌려주므로 부동소수점을 경유하지
 * 않는다(M-03).
 */

describe('AQ-05: 적용된 DB의 2026년 세율이 픽스처와 일치한다', () => {
  it('tax_brackets 8행', async () => {
    const result = await actingAs(USER_A).query<BracketRow>(
      `select lower_bound            as "lowerBound",
              rate,
              progressive_deduction  as "progressiveDeduction"
         from public.tax_brackets
        where tax_year = 2026`,
    )
    assertBracketsAgree(result.rows)
  })

  it('tax_constants 9행', async () => {
    const result = await actingAs(USER_A).query<ConstantRow>(
      'select key, value from public.tax_constants where tax_year = 2026',
    )
    assertConstantsAgree(result.rows)
  })

  it('tax_years에 2026이 등록되어 있다', async () => {
    const result = await actingAs(USER_A).query(
      'select tax_year from public.tax_years where tax_year = 2026',
    )
    expect(result.rowCount).toBe(1)
  })

  it('numeric 자릿수가 값을 잘라내지 않았다', async () => {
    // rate는 numeric(6,4)다. 소수 5자리 값이 들어오면 오류 없이 반올림된다.
    // 2026년 값은 모두 4자리 이하이므로 왕복해도 변하지 않아야 한다
    const result = await actingAs(USER_A).query<{ rate: string }>(
      'select rate from public.tax_brackets where tax_year = 2026 order by lower_bound',
    )
    expect(result.rows.map((r) => r.rate)).toEqual([
      '0.0600',
      '0.1500',
      '0.2400',
      '0.3500',
      '0.3800',
      '0.4000',
      '0.4200',
      '0.4500',
    ])
  })
})
