import { dec, truncateToUnit, type DecimalInput, type DecimalValue } from '@/lib/decimal'

import { MINOR_UNITS, type ProductCurrency } from './currency'
import { dDay, isPast } from './schedule'

/**
 * 쿠폰 지급방식 · 월수익 지급 기록의 결과 — DOC-002 v1.14 §4.6 · §4.14 · D-09, DOC-011 §4.0 「쿠폰 지급방식과 월수익」
 * (P8 컷 b2 · 계산은 b3)
 *
 * 순수 모듈이다(절대 규칙 #3). 값의 집합(b2)과 월수익의 표시 계산 — 금액 · 흐름 끝 · 상태 · 기록 가능 · 다음 행
 * 판정(b3, DOC-007 §3.5 · §4.7 · §7.6 · §9.4) — 을 둔다. 과세(§4.7의 `couponTaxableIncome` · `F`)는 b4다.
 * 위쪽에는 **값의 집합**을 둔다 — 계약(`mutations/types.ts`) · 셰이프 파싱 · 폼 선택지가 같은
 * 목록을 읽는다(`Record<CouponPayout, …>`가 값이 늘어나는 날 컴파일되지 않게 — 절대 규칙 #6 「열거가 따라온다」).
 */

/** 쿠폰 지급방식 (DOC-005 §3). DB 열거형 `coupon_payout`과 같은 값이다 */
export type CouponPayout = 'AT_REDEMPTION' | 'MONTHLY'

/** 월수익 지급 기록의 결과 (DOC-002 §4.14). DB 열거형 `coupon_outcome`과 같은 값이다 */
export type CouponOutcome = 'PAID' | 'UNPAID'

/** 선언 순서 — 상환 시 지급이 먼저다(기존 상품 전부가 그것이다) */
export const COUPON_PAYOUT_ORDER: readonly CouponPayout[] = ['AT_REDEMPTION', 'MONTHLY']

export const COUPON_OUTCOMES: readonly CouponOutcome[] = ['PAID', 'UNPAID']

/** 월수익 일정 · 일괄 기록의 상한 — DOC-011 V-26 · §5.14(1..60) */
export const MAX_COUPON_SCHEDULES = 60

// ---------------------------------------------------------------------------
// 월수익의 계산 — DOC-007 §3.5 · §4.7 · §7.6 · §9.4 E-10 (P8 컷 b3)
// ---------------------------------------------------------------------------

/**
 * 월수익 일정 한 행의 상태 — DOC-011 §4.0 `CouponState` · DOC-007 §9.4의 구획이 고른다.
 * 표시어의 정본은 DOC-005 §6.1(`couponState`)이고 라벨은 `format/labels.ts`가 같은 커밋에 둔다.
 */
export type CouponState =
  | 'PAID'
  | 'UNPAID'
  | 'UNRECORDED'
  | 'SCHEDULED'
  | 'BEYOND_ASSUMPTION'
  | 'ENDED'

/** 선언 순서 — 라벨 축 · 전수 대조가 읽는다 */
export const COUPON_STATES: readonly CouponState[] = [
  'PAID',
  'UNPAID',
  'UNRECORDED',
  'SCHEDULED',
  'BEYOND_ASSUMPTION',
  'ENDED',
]

/**
 * 다음 월수익 한 행의 조건 판정 — **표시 전용이다**(DOC-007 §3.5). `F`에 쓰지 않는다.
 * `UNKNOWN`은 그 행이 다음 행인데 워스트오브를 낼 수 없는 경우다(E-01 — 판정 `null`).
 */
export type CouponConditionResult = 'EXPECTED_PAID' | 'EXPECTED_UNPAID' | 'UNKNOWN'

export const COUPON_CONDITION_RESULTS: readonly CouponConditionResult[] = [
  'EXPECTED_PAID',
  'EXPECTED_UNPAID',
  'UNKNOWN',
]

/**
 * 월수익 금액 `q_k = trunc_u(P × r_m / 12)` — **상품 통화** (DOC-007 §4.7).
 *
 * 보조단위에서 **절사**한다(달러 센트 미만 — 투자설명서 원문, 원화 원 미만 — 잠정, RD-10 ①). 절사는 집계의 반올림이
 * 아니라 **지급 금액의 정의**다 — 월수익은 보조단위로 지급되므로 정확값 `P × r_m / 12`는 어디에도 지급되지 않는다.
 * 그래서 `F` · 표시(`expectedAmount`) · 기록 화면의 세전 기본값이 이 값 하나를 쓴다(RD-10 ③ — 같은 달을 두 화면이
 * 1보조단위도 다르게 적지 않는다). 검산: 원화 1억 · 연 7% → 583,333원(B-6) · $10,000 · 연 24.24% → $202.00(C).
 */
export function couponAmount(params: {
  principal: DecimalInput
  annualRate: DecimalInput
  currency: ProductCurrency
}): DecimalValue {
  const exact = dec(params.principal).times(dec(params.annualRate)).div(12)
  return truncateToUnit(exact, MINOR_UNITS[params.currency].unit)
}

/**
 * 월수익 흐름 끝 `T_end` — 추정에 넣는 마지막 월수익 평가일의 상한 (DOC-007 §7.6).
 *
 * 세 갈래가 상태의 이름까지 가른다 — 흐름 끝 뒤의 달이 상환된 상품에서는 「상환 후 없음」, 적용 차수가 있는 미상환
 * 상품에서는 「예정 · 조기상환 가정 밖」이다(민서 결정(2026-10-02) ③). 둘을 한 값으로 두면 아직 상환되지 않은 상품에
 * 「상환 후」라는 거짓 문구가 생긴다. 적용 차수가 없으면(`NO_ROUND`) 흐름 끝이 없다(무한).
 */
export type CouponFlowEnd =
  | { kind: 'REDEEMED'; date: string }
  | { kind: 'ESTIMATED'; date: string }
  | { kind: 'NO_ROUND' }

/**
 * 흐름 끝을 정한다. 적용 차수는 §7.2의 「다음 도래 평가일의 차수」 — `nextEvaluation`과 같은 경계다(당일 포함).
 * 호출부가 그 날짜를 넘긴다 — 차수 판정의 단일 구현(`judge`)이 이미 고른 값을 다시 고르지 않는다.
 */
export function couponFlowEndOf(params: {
  redemptionDate: string | null
  appliedRoundEvaluationDate: string | null
}): CouponFlowEnd {
  if (params.redemptionDate != null) return { kind: 'REDEEMED', date: params.redemptionDate }
  if (params.appliedRoundEvaluationDate != null) {
    return { kind: 'ESTIMATED', date: params.appliedRoundEvaluationDate }
  }
  return { kind: 'NO_ROUND' }
}

/** `t_k ≤ T_end` — 비교 키는 월수익 평가일이고 **경계를 포함한다**(적용 차수와 같은 날 평가되는 달은 흐름 안 — RD-12) */
export function isWithinCouponFlow(evaluationDate: string, flowEnd: CouponFlowEnd): boolean {
  if (flowEnd.kind === 'NO_ROUND') return true
  return dDay({ from: flowEnd.date, evaluationDate }) <= 0
}

/**
 * 월수익 일정 한 행의 상태 — DOC-007 §9.4 E-10의 구획.
 *
 * - 기록이 있으면 기록이 정본이다(흐름 끝과 무관) — `PAID` · `UNPAID`
 * - 흐름 끝 이내 · 기록 없음: 월수익 지급일 `p_k < asOf`면 `UNRECORDED`, 아니면 `SCHEDULED`.
 *   **지급일 당일은 「예정」이다** — 주의는 다음 날부터 뜬다(§9.2 「평가일 당일은 경과가 아니다」와 같은 경계)
 * - 흐름 끝 이후 · 기록 없음: 상환됨 `ENDED` · 적용 차수가 있는 미상환 `BEYOND_ASSUMPTION`
 *
 * 시세를 쓰지 않는다 — 그래서 시세 축(`PRICE_WIDE`)에 세금이 없다는 것이 월지급식에서도 참이다(§7.6).
 */
export function couponStateOf(params: {
  evaluationDate: string
  paymentDate: string
  recordOutcome: CouponOutcome | null
  flowEnd: CouponFlowEnd
  asOf: string
}): CouponState {
  if (params.recordOutcome != null) return params.recordOutcome
  if (!isWithinCouponFlow(params.evaluationDate, params.flowEnd)) {
    // NO_ROUND는 흐름 끝 이후가 없으므로 여기에 오지 않는다(isWithinCouponFlow가 늘 참)
    return params.flowEnd.kind === 'REDEEMED' ? 'ENDED' : 'BEYOND_ASSUMPTION'
  }
  return isPast({ evaluationDate: params.paymentDate, asOf: params.asOf }) ? 'UNRECORDED' : 'SCHEDULED'
}

/**
 * V-27의 「그 달」 조건 둘 — **기록 계약(§5.14 · §5.15)과 상세의 `recordable`(§4.3)이 같은 함수를 지난다.**
 * 화면이 「평가일 ≤ 기준일」을 따로 비교하면 경계(당일 · 상환일)가 V-27과 갈릴 수 있다 — 기록 화면이 내보인 달을
 * 같은 제출의 V-27이 거부하는 일을 구성으로 없앤다(DOC-011 §4.3 「`recordable`」 · DOC-008 SQ-21 ⓘ).
 */
export function isCouponEvaluated(params: { evaluationDate: string; asOf: string }): boolean {
  return dDay({ from: params.asOf, evaluationDate: params.evaluationDate }) <= 0
}

/** 상환이 있으면 **그 달의 월수익 평가일 ≤ 상환일**(V-27 · DOC-002 I-27 — 비교 키는 지급일이 아니다, RD-18) */
export function isCouponBeforeRedemption(params: {
  evaluationDate: string
  redemptionDate: string | null
}): boolean {
  if (params.redemptionDate == null) return true
  return dDay({ from: params.redemptionDate, evaluationDate: params.evaluationDate }) <= 0
}

/** 기록할 수 있는 달인가 — 기록 없음 · 평가됨 · 상환일 이내(V-27의 지급 · 미지급 공통 조건) */
export function isCouponRecordable(params: {
  evaluationDate: string
  asOf: string
  redemptionDate: string | null
  recorded: boolean
}): boolean {
  return (
    !params.recorded &&
    isCouponEvaluated(params) &&
    isCouponBeforeRedemption(params)
  )
}

/**
 * 다음 월수익 — 월수익 평가일 `t_k ≥ asOf`인 행 중 최소 1건 (DOC-007 §3.5 — `nextEvaluation`과 같은 경계).
 * 같은 날이면 순번이 작은 쪽이다. 없으면 `null`(전부 지났다).
 */
export function nextCoupon<T extends { couponNo: number; evaluationDate: string }>(params: {
  coupons: readonly T[]
  asOf: string
}): T | null {
  let next: T | null = null
  for (const coupon of params.coupons) {
    if (isPast({ evaluationDate: coupon.evaluationDate, asOf: params.asOf })) continue
    if (
      next == null ||
      coupon.evaluationDate < next.evaluationDate ||
      (coupon.evaluationDate === next.evaluationDate && coupon.couponNo < next.couponNo)
    ) {
      next = coupon
    }
  }
  return next
}

/**
 * 월수익 지급 조건 `W ≥ β`(경계 포함) — 표시 전용 (DOC-007 §3.5).
 * `W`가 `null`이면 `UNKNOWN`이다(E-01 — 기본값을 대입하지 않는다). 상환 완료 상품에는 부르지 않는다(E-05 · `asActive`).
 */
export function couponConditionOf(params: {
  worstOf: DecimalValue | null
  barrier: DecimalInput
}): CouponConditionResult {
  if (params.worstOf == null) return 'UNKNOWN'
  return params.worstOf.gte(dec(params.barrier)) ? 'EXPECTED_PAID' : 'EXPECTED_UNPAID'
}
