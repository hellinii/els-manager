import { asActive, type Active } from '@/lib/domain/redemption'

/**
 * 보유중 상품의 판정 입력 — DOC-007 §9.1 (E-05)
 *
 * 조건 판정·KI 판정은 `asActive`를 거친 값만 받는다. 테스트에서 매번
 * `asActive(params, null)`을 쓰면 본문이 가려지므로 이름만 줄인다.
 *
 * **상환 레코드를 `null`로 고정한다.** 상환 완료 상품의 판정을 시험하려면 이
 * 헬퍼가 아니라 `asActive(params, redemption)`을 직접 호출해 `null` 반환을
 * 확인한다.
 */
export function active<T extends object>(params: T): Active<T> {
  return asActive(params, null)
}
