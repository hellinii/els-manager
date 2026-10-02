/**
 * 쿠폰 지급방식 · 월수익 지급 기록의 결과 — DOC-002 v1.14 §4.6 · §4.14 · D-09, DOC-011 §4.0 「쿠폰 지급방식과 월수익」
 * (P8 컷 b2)
 *
 * 순수 모듈이다(절대 규칙 #3). 판정 · 금액 계산은 아직 없다 — 월수익의 계산(DOC-007 §3.5 · §4.7)은 컷 b3 · b4가
 * 이 파일에 더한다. 여기에는 **값의 집합**만 둔다 — 계약(`mutations/types.ts`) · 셰이프 파싱 · 폼 선택지가 같은
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
