import { describe, expect, it } from 'vitest'
import {
  assertBracketsAgree,
  assertConstantsAgree,
  assertKeyMapIsComplete,
} from '../fixtures/tax-seed-contract'
import { parseSeededBrackets, parseSeededConstants } from './parse-seed-sql'

/**
 * AQ-05 — 세율 마이그레이션과 검증 픽스처의 일치
 *
 * `tests/fixtures/tax-2026.ts`는 TC-01~16의 입력이고 마이그레이션 시드는
 * 운영의 입력이다. 둘이 어긋나면 **테스트는 통과하는데 화면 숫자가 다른**
 * 상태가 되며, 그때 K-08(세금 계산 검증 100%)은 아무것도 보증하지 못한다.
 *
 * 이 스위트는 DB 없이 돈다. 로컬 스택이 꺼져 있어도 드리프트는 즉시 잡힌다.
 * 적용 상태 검증은 `tests/rls/tax-seed.test.ts`가 담당한다.
 */

describe('AQ-05: 2026년 세율 시드가 픽스처와 일치한다', () => {
  it('상수 키 매핑이 TaxConstants를 빠짐없이 덮는다', () => {
    // employeeNonWageThreshold → employee_non_wage_income_threshold처럼
    // 기계적 변환이 아닌 대응이 있으므로 매핑 자체를 먼저 검증한다
    assertKeyMapIsComplete()
  })

  it('tax_brackets 8행이 BRACKETS_2026과 일치한다', () => {
    assertBracketsAgree(parseSeededBrackets(2026))
  })

  it('tax_constants 9행이 CONSTANTS_2026과 일치한다', () => {
    assertConstantsAgree(parseSeededConstants(2026))
  })
})

describe('시드 파서가 조용히 0건을 반환하지 않는다', () => {
  it('구간·상수 튜플을 실제로 찾아낸다', () => {
    // 형식이 바뀌어 정규식이 아무것도 못 잡으면 위 두 테스트는 "빈 배열끼리
    // 일치"로 통과할 수 있다. 개수를 직접 못박아 그 경로를 막는다
    expect(parseSeededBrackets(2026)).toHaveLength(8)
    expect(parseSeededConstants(2026)).toHaveLength(9)
  })

  it('존재하지 않는 연도는 오류로 알린다', () => {
    expect(() => parseSeededBrackets(2099)).toThrow(/정확히 1개/)
  })
})
