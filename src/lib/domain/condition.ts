import { dec, type DecimalInput } from '@/lib/decimal'
import { isKiNotTouched } from './ki'
import type { Active } from './redemption'
import type { ConditionResult } from './types'

/**
 * 조건 판정 — DOC-007 §3.2, §3.3
 *
 * 판정 우선순위:
 * ```
 * 1. W ≥ B(n)          → 조기상환 (EARLY)
 * 2. 리자드 충족        → 리자드상환 (LIZARD)
 * 3. 그 외              → 다음 차수로 이월 (CARRY_OVER)
 * ```
 *
 * 리자드는 **조기상환 조건이 충족되지 않았을 때에만** 판정한다.
 */
export type ConditionParams = {
  /** 워스트오브. `null`이면 판정 보류 (E-01) */
  worstOf: DecimalInput | null
  /** 해당 차수의 조기상환 배리어 */
  barrier: DecimalInput
  /** `null`이면 해당 차수에 리자드 조건이 없다 */
  lizardBarrier?: DecimalInput | null
  /** 리자드 조건이 KI 미터치를 함께 요구하는지 */
  lizardRequiresNoKi?: boolean | null
  /** `null`이면 노낙인 상품 (E-06) */
  kiBarrier?: DecimalInput | null
  kiTouchedAt?: string | null
}

/**
 * 조건 판정 결과. 시세가 없으면 `null`을 반환한다(E-01, TC-22).
 *
 * 인자 범위가 Q-04(리자드 변형 수용 범위)의 확정 결과다 — 차수별
 * (리자드 배리어 · 리자드 쿠폰율 · KI 미터치 요구) 3속성. 쿠폰율은 판정에
 * 관여하지 않으므로 수령액 산출(`proceeds`)에서만 쓴다.
 *
 * **입력은 `asActive`를 거친 값만 받는다**(E-05, §9.1). 상환 완료 상품에서는
 * `asActive`가 `null`을 반환하므로 이 함수에 넘길 값이 존재하지 않는다.
 */
export function evaluateCondition(
  params: Active<ConditionParams>,
): ConditionResult | null {
  // E-01 — 판정 보류. 기본값을 대입하지 않는다
  if (params.worstOf == null) return null

  const w = dec(params.worstOf)

  // §3.2 조기상환
  if (w.gte(dec(params.barrier))) return 'EARLY'

  // §3.3 리자드 — 리자드가 정의된 차수에서만 평가한다
  if (params.lizardBarrier != null) {
    const meetsLizardBarrier = w.gte(dec(params.lizardBarrier))
    const meetsKiRequirement =
      params.lizardRequiresNoKi !== true ||
      isKiNotTouched({
        kiBarrier: params.kiBarrier,
        kiTouchedAt: params.kiTouchedAt,
      })

    if (meetsLizardBarrier && meetsKiRequirement) return 'LIZARD'
  }

  return 'CARRY_OVER'
}
