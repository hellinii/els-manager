/**
 * `lib/domain` 공개 API — 조건 판정·평가일정·수령액 (DOC-007 §3, §4, §7.2)
 *
 * 순수 모듈이다. 기준일·시세·계약 조건은 모두 인자로 받으며 현재 시각에
 * 의존하지 않는다(DOC-010 DEP-01 ~ DEP-03, ADR-003).
 */

export type {
  AccountType,
  ConditionResult,
  KiObservation,
  KiStatus,
  RedemptionType,
} from './types'

export { underlyingRatio, worstOf, type UnderlyingPrice } from './worstOf'

export {
  asActive,
  isRedeemed,
  type Active,
  type RedemptionMark,
} from './redemption'

export { isKiNotTouched, isKiTouchCandidate, kiStatus, type KiParams } from './ki'

export { evaluateCondition, type ConditionParams } from './condition'

export {
  attributionYear,
  dDay,
  generateEvaluationDates,
  isPast,
  nextEvaluation,
  overdueEvaluations,
  type OverdueEvaluation,
} from './schedule'

export {
  aggregateRealizedPnl,
  applicableCouponRate,
  grossExpected,
  realizedPnl,
  taxableIncome,
  type RedeemingCondition,
} from './proceeds'
