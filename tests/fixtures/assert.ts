import { expect } from 'vitest'
import type { DecimalValue } from '@/lib/decimal'

/**
 * 금액 비교는 항상 정확 비교로 한다.
 *
 * `toBeCloseTo` 같은 근사 비교를 쓰면 부동소수점 오차가 테스트를 통과해버려
 * DOC-002 M-03(부동소수점 금지)을 검증할 수 없다.
 */
export function expectAmount(
  actual: DecimalValue | null,
  expected: string,
): void {
  expect(actual === null ? null : actual.toString()).toBe(expected)
}

/**
 * 비율을 소수 2자리 퍼센트 문자열로 변환한다.
 * DOC-007 §10이 부담률·한계율을 `15.40%` 형태로 표기하므로 그 표기에 맞춘다.
 */
export function percent2(rate: DecimalValue): string {
  return `${rate.times(100).toFixed(2)}%`
}
