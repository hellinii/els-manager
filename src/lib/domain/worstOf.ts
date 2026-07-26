import { dec, type DecimalInput, type DecimalValue } from '@/lib/decimal'

/**
 * 워스트오브 — DOC-007 §3.1
 *
 * ```
 * W = min( currentPrice(a) / basePrice(a) )   for a in underlyings(els)
 * ```
 *
 * 기준가와 현재가가 동일 통화로 표시되므로 비율에서 통화 단위가 상쇄된다.
 * 해외 기초자산이라도 환율 변환을 수행하지 않는다(D-03).
 */

export type UnderlyingPrice = {
  basePrice: DecimalInput
  /** `asset_prices`의 최신 `as_of_date` 값. 없으면 `null` */
  currentPrice: DecimalInput | null
}

/** 개별 기초자산의 기준가 대비 비율 */
export function underlyingRatio(
  basePrice: DecimalInput,
  currentPrice: DecimalInput,
): DecimalValue {
  const base = dec(basePrice)
  if (base.lte(0)) {
    throw new RangeError(
      `기준가격은 0보다 커야 한다: ${base.toString()}. 등락률의 분모다.`,
    )
  }
  return dec(currentPrice).div(base)
}

/**
 * 어느 하나의 기초자산이라도 현재가가 없으면 `null`을 반환한다(E-01).
 *
 * **임의의 기본값을 대입해서는 안 된다.** 시세가 하나 없을 때 나머지로 계산한
 * 워스트오브는 실제보다 높게 나올 수 있고, 그 값으로 조기상환 충족을 표시하면
 * 사용자가 존재하지 않는 상환을 기대한다.
 */
export function worstOf(
  underlyings: readonly UnderlyingPrice[],
): DecimalValue | null {
  if (underlyings.length === 0) return null

  let worst: DecimalValue | null = null

  for (const underlying of underlyings) {
    if (underlying.currentPrice == null) return null

    const ratio = underlyingRatio(underlying.basePrice, underlying.currentPrice)
    if (worst === null || ratio.lt(worst)) worst = ratio
  }

  return worst
}
