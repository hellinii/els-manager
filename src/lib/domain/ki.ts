import { dec, type DecimalInput } from '@/lib/decimal'
import type { Active } from './redemption'
import type { KiStatus } from './types'

/**
 * KI 상태 — DOC-007 §3.4
 *
 * ```
 * KI 미설정   ⟺  ki_barrier IS NULL          (노낙인 상품)
 * KI 터치됨   ⟺  ki_touched_at IS NOT NULL
 * KI 미터치   ⟺  위 두 경우가 아님
 * ```
 */

/**
 * DOC-007 §3.4의 "주의" 등급 임계값.
 *
 * 법령 요율이 아니라 표시용 임계값이므로 상수 주입 대상(절대 규칙 #5)이 아니다.
 * 값의 근거는 DOC-007 §3.4 표시 등급 표에 있다.
 */
const DEFAULT_WARNING_MULTIPLIER = '1.1'

export type KiParams = {
  /** `null`이면 노낙인 상품 */
  kiBarrier: DecimalInput | null
  /** KI 최초 터치일. `null`이면 미터치 */
  kiTouchedAt: string | null
  worstOf: DecimalInput | null
}

/**
 * 표시 등급을 산출한다. 시세가 없으면 `null`(E-01).
 *
 * 판정 순서는 노낙인 → 터치 확정 → 시세 유무 → 비율 구간이다. 노낙인을 먼저
 * 보는 이유는 §3.4가 `ki_barrier IS NULL`을 KI 미설정의 정의로 두기 때문이다.
 *
 * **입력은 `asActive`를 거친 값만 받는다**(E-05, §9.1). 상환이 끝난 상품의 KI
 * 등급은 의미가 없다 — 손익은 상환 실적으로 확정되었고, 이후의 시세 변동은
 * 그 상품과 무관하다.
 */
export function kiStatus(
  params: Active<KiParams & { warningMultiplier?: DecimalInput }>,
): KiStatus | null {
  // E-06 — 노낙인 상품은 KI 판정을 생략한다
  if (params.kiBarrier == null) return 'NO_KI'

  if (params.kiTouchedAt != null) return 'TOUCHED'

  if (params.worstOf == null) return null

  const barrier = dec(params.kiBarrier)
  const w = dec(params.worstOf)

  if (w.lte(barrier)) return 'BELOW'

  const multiplier = dec(
    params.warningMultiplier ?? DEFAULT_WARNING_MULTIPLIER,
  )
  if (w.lte(barrier.times(multiplier))) return 'WARNING'

  return 'SAFE'
}

/**
 * 터치 후보 판정 — DOC-007 §3.4 보조 판정
 *
 * **시스템이 `ki_touched_at`을 확정하지 않는다**(D-04). 일 배치 종가 수집으로는
 * `CONTINUOUS` 관찰 방식의 장중 터치를 확인할 수 없고, 도입 이전의 이력도
 * 유도할 수 없다. 따라서 이 함수는 사용자 확인을 요청할 대상만 골라낸다.
 *
 * 터치는 배리어를 "하회"하는 사건이므로 등호를 포함하지 않는다. 표시 등급의
 * `BELOW`(`W ≤ 배리어`)보다 좁은 조건이다.
 *
 * 시세 비교이므로 보유중 상품에만 정의된다(E-05, §9.1).
 */
export function isKiTouchCandidate(params: Active<KiParams>): boolean {
  if (params.kiBarrier == null) return false
  if (params.kiTouchedAt != null) return false
  if (params.worstOf == null) return false

  return dec(params.worstOf).lt(dec(params.kiBarrier))
}

/**
 * 리자드 조건이 요구하는 "KI 미터치" 충족 여부.
 *
 * 노낙인 상품(`ki_barrier IS NULL`)은 항상 충족으로 처리한다(E-06).
 */
export function isKiNotTouched(params: {
  kiBarrier?: DecimalInput | null
  kiTouchedAt?: string | null
}): boolean {
  if (params.kiBarrier == null) return true
  return params.kiTouchedAt == null
}
