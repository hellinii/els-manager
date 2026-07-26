import { dec, ZERO, type DecimalInput, type DecimalValue } from '@/lib/decimal'
import type { TaxBracket } from './types'

/**
 * 누진 산출세액 — DOC-007 §5.1
 *
 * 구간은 `tax_brackets`에서 주입받는다. 세율을 코드에 두지 않는다
 * (CLAUDE.md 절대 규칙 #5).
 */

/**
 * 과세표준이 속한 구간을 찾는다.
 *
 * **하한 이상**(`lowerBound ≤ x`) 중 하한이 가장 큰 구간을 고른다. 세법 조문은
 * "하한 초과"로 표현하지만, 누진공제 구조 때문에 `T(x)`가 구간 경계에서 연속이라
 * 두 해석의 결과가 같다. DOC-007 §5.1이 컬럼을 "과세표준 하한"으로 정의하므로
 * 하한 이상으로 구현한다. 이 연속성은 회귀 테스트로 고정되어 있다.
 */
export function findBracket(
  taxBase: DecimalInput,
  brackets: readonly TaxBracket[],
): TaxBracket {
  if (brackets.length === 0) {
    throw new RangeError('tax_brackets가 비어 있다. 해당 연도의 시드를 확인한다.')
  }

  const x = dec(taxBase)
  let found: TaxBracket | null = null
  let foundLowerBound: DecimalValue | null = null

  for (const bracket of brackets) {
    const lowerBound = dec(bracket.lowerBound)
    if (lowerBound.gt(x)) continue
    if (foundLowerBound === null || lowerBound.gt(foundLowerBound)) {
      found = bracket
      foundLowerBound = lowerBound
    }
  }

  if (found === null) {
    throw new RangeError(
      `과세표준 ${x.toString()}에 해당하는 구간이 없다. lower_bound = 0 구간이 누락되었는지 확인한다.`,
    )
  }
  return found
}

/**
 * `T(x)` — 종합소득세 누진 산출세액.
 *
 * ```
 * T(x) = 0                                      if x ≤ 0
 *      = x × rate(x) − progressiveDeduction(x)   otherwise
 * ```
 *
 * 중간 계산값이므로 반올림하지 않는다(DOC-007 §2).
 */
export function progressiveTax(
  taxBase: DecimalInput,
  brackets: readonly TaxBracket[],
): DecimalValue {
  const x = dec(taxBase)
  if (x.lte(0)) return ZERO

  const bracket = findBracket(x, brackets)
  return x.times(dec(bracket.rate)).minus(dec(bracket.progressiveDeduction))
}
