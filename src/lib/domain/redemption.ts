/**
 * 상환 상태와 판정 대상 — DOC-007 §9.1 (E-05)
 *
 * **상태는 상환 레코드의 존재로 유도한다**(DOC-002 §5.1, CLAUDE.md 절대 규칙 #4).
 * `els_products`에 `status` 컬럼이 없으므로 여기서도 상태를 값으로 받지 않고
 * 레코드의 유무로만 판단한다.
 */

/**
 * 판정 대상 표식.
 *
 * 이 심볼은 모듈 외부로 내보내지 않는다. 따라서 `Active<T>`는 객체 리터럴로
 * 만들 수 없고 `asActive`를 거쳐야만 얻을 수 있다 — E-05의 "호출 불가"가
 * 규율이 아니라 타입으로 강제되는 근거다.
 */
declare const ACTIVE: unique symbol

/**
 * 보유중이 확인된 판정 입력 — 조건 판정·KI 판정의 유일한 입력 타입.
 *
 * 표식은 `asActive`만 부여한다.
 */
export type Active<T> = T & { readonly [ACTIVE]: true }

/**
 * 상환 레코드. 존재 여부만 판단하므로 최소 형태로 받는다.
 *
 * `null`이면 보유중(active), 값이 있으면 상환완료(redeemed)다.
 */
export type RedemptionMark = { redemptionDate: string } | null

/**
 * E-05 — 판정 대상 여부를 결정한다.
 *
 * ```
 * asActive(params, redemption) = params   if redemption = NULL   # 보유중
 *                              = NULL     otherwise              # 상환완료
 * ```
 *
 * 반환된 `null`은 **판정 생략**을 뜻하며, 호출부가 `CARRY_OVER`나 `SAFE` 같은
 * 판정값으로 대체해서는 안 된다. 상환 완료 상품의 표시값은 판정 결과가 아니라
 * 상환 실적이다(§4.2).
 *
 * 판정 함수가 반환하는 `null`(E-01, 시세 없음)과 의미가 다르다. 전자는 시세가
 * 수집되면 값이 생기고, 이 `null`은 영구적이다.
 *
 * 오버로드는 호출부의 군더더기를 없애기 위한 것이다. 상환 레코드가 없음이
 * 타입으로 확정된 경우(`null` 리터럴)에는 `null` 검사를 요구하지 않는다.
 */
export function asActive<T extends object>(params: T, redemption: null): Active<T>
export function asActive<T extends object>(
  params: T,
  redemption: RedemptionMark,
): Active<T> | null
export function asActive<T extends object>(
  params: T,
  redemption: RedemptionMark,
): Active<T> | null {
  if (redemption != null) return null
  return params as Active<T>
}

/** 상환 완료 여부. 표시·분기용 술어다. */
export function isRedeemed(redemption: RedemptionMark): boolean {
  return redemption != null
}
