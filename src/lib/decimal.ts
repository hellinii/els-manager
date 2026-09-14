import Decimal from 'decimal.js'

/**
 * 고정소수점 산술 기반 — DOC-002 M-03, CLAUDE.md 절대 규칙 #2
 *
 * 금액·비율 계산에서 부동소수점을 사용하지 않는다. `lib/tax`·`lib/domain`의
 * 모든 수치 연산은 이 모듈이 제공하는 Decimal을 경유한다.
 */

/**
 * 전역 `Decimal`을 재설정하지 않고 clone을 쓴다. 전역 설정 변경은 같은 프로세스의
 * 다른 소비자에게 새는 부작용이므로 순수성 전제와 맞지 않는다.
 *
 * - `precision: 40` — 나눗셈(부담률 등)이 무한소수가 되는 경우의 유효자릿수.
 *   금액 15자리 + 비율 4자리를 감당하고도 여유가 있다.
 * - `toExpNeg`/`toExpPos` — `toString()`이 지수 표기로 새지 않게 범위를 넓힌다.
 *   기본값(-7, 21)에서는 작은 비율이 `1e-8` 형태로 직렬화되어 경계에서 문자열
 *   전달 규약(DOC-011 §2)을 깨뜨린다.
 */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
})

/** 계산 결과 타입. 항상 이 모듈의 clone으로 생성된 인스턴스다. */
export type DecimalValue = Decimal

/**
 * 금액·비율 입력 타입.
 *
 * **`number`를 의도적으로 배제한다.** `0.1 + 0.2 !== 0.3`인 값이 경계를 넘어오면
 * 이후 모든 계산이 오염되고, 그 시점을 추적할 수 없다. 금액·비율은 문자열 또는
 * Decimal로만 전달한다(DOC-011 §2). 차수·개월수·연도처럼 개수를 세는 값은
 * 정수 `number`를 그대로 쓴다.
 */
export type DecimalInput = string | Decimal

export const ZERO: DecimalValue = new D(0)
export const ONE: DecimalValue = new D(1)

/** 입력을 Decimal로 정규화한다. NaN·Infinity는 금액이 될 수 없으므로 거부한다. */
export function dec(value: DecimalInput): DecimalValue {
  const result = new D(value as Decimal.Value)
  if (!result.isFinite()) {
    throw new RangeError(`유한한 수가 아니다: ${String(value)}`)
  }
  return result
}

/** `max(0, value)`. 과세 금융소득·보험료 산정 소득의 하한을 강제한다(절대 규칙 #8). */
export function maxZero(value: DecimalValue): DecimalValue {
  return value.isNegative() ? ZERO : value
}

export function sum(values: readonly DecimalValue[]): DecimalValue {
  return values.reduce<DecimalValue>((acc, v) => acc.plus(v), ZERO)
}

/**
 * 절사 — DOC-007 §2 "세액·보험료 최종값: 원 단위 절사"
 *
 * 단위는 RD-01 미결이므로 인자로 받는다. 0을 향해 버린다.
 */
export function truncateToUnit(
  value: DecimalValue,
  unit: DecimalInput,
): DecimalValue {
  const u = dec(unit)
  if (u.lte(0)) {
    throw new RangeError(`절사 단위는 0보다 커야 한다: ${u.toString()}`)
  }
  return value.div(u).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(u)
}

/** 반올림 — DOC-007 §2 "화면 표시 금액: 원 단위 반올림" */
export function roundToUnit(
  value: DecimalValue,
  unit: DecimalInput,
): DecimalValue {
  const u = dec(unit)
  if (u.lte(0)) {
    throw new RangeError(`반올림 단위는 0보다 커야 한다: ${u.toString()}`)
  }
  return value.div(u).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(u)
}

/**
 * 금액 문자열 — 원 단위 반올림 정수. DOC-007 §2 「화면 표시 금액: 원 단위 반올림」.
 *
 * **저장 축과 같은 형식이다.** `numeric(15,0)`이고 V-19·V-11이 `/^\d+$/`를 요구하므로
 * 이 함수의 출력이 곧 계약이 받는 모양이다 — 조회가 내는 값과 폼이 채우는 값이 같은
 * 식을 지나야 한다는 뜻이다.
 *
 * **여기 있는 이유가 그것이다.** 종전에는 `lib/db/queries/map.ts`에 있었고 조회 계층만
 * 썼다. 폼 계층(`lib/forms`)이 차수별 추정값을 채우면서 같은 형식이 필요해졌는데,
 * 그쪽은 `lib/db`를 **타입으로만** import한다(값으로 끌면 조회·판정·시세가 통째로
 * 클라이언트 번들에 실린다 — `els/component-boundaries`가 `src/components`에 건 규율과
 * 같은 이유). 사본을 만들면 반올림 규약이 둘이 되고 **그 둘이 갈리는 것은 금액에서만
 * 드러난다.** 그래서 올렸고 `map.ts`는 같은 이름으로 재수출한다.
 */
export function amountString(value: DecimalValue): string {
  return roundToUnit(value, '1').toFixed(0)
}

/** 개수를 세는 정수 인자의 검증. 차수·개월수 등에 사용한다. */
export function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name}는 양의 정수여야 한다: ${value}`)
  }
}
