import { couponMonthLabel as formatCouponMonth } from '@/lib/format/coupons'

import type { ProductRow } from '../queries/load'

/**
 * 월수익 달의 표기 · 기록된 달의 최댓값 — 기록 계약(§5.14 · §5.15)과 상환 계약(§5.4 · §5.5)이 함께 쓴다 (P8 컷 b2).
 *
 * 별도 파일인 이유는 순환이다 — `coupons.ts`가 원천징수 기본값을 `redemptions.ts`에서 가져오고, `redemptions.ts`가
 * 상환 쪽 V-27을 위해 아래 둘을 쓴다. 둘이 서로를 import하지 않게 공용 조각을 여기 둔다.
 */

/**
 * 월수익 표기 — 「5번째 · 2027-02-16」(순번 + 월수익 평가일, DOC-005 GQ-04 · 민서 결정(2026-10-02) ①).
 * 화면의 표기와 **같은 함수**다(`lib/format/coupons.ts` — P8 컷 b3). 일정에 없는 순번(계약 밖 입력)은 날짜 자리가 「?」다
 */
export function couponMonthLabel(couponNo: number, evaluationDate: string | undefined): string {
  return evaluationDate == null ? `${couponNo}번째 · ?` : formatCouponMonth(couponNo, evaluationDate)
}

/**
 * 기록된 달(지급 · 미지급) 중 월수익 평가일이 가장 늦은 달 — **상환 쪽 V-27의 기준이다** (§5.4 · §5.5 · DOC-002 I-27).
 *
 * 순번 없는 기실현 기록은 평가일이 없어 세지 않는다(검사 밖 — 등재만). `redemptions_before_coupon_payment`가 같은
 * 집합을 본다 — 계약과 DB가 다른 집합을 보면 한쪽이 통과시킨 것을 다른 쪽이 거부하는데 그 사유가 화면에 없다.
 */
export function latestRecordedMonth(
  product: Pick<ProductRow, 'monthly_coupon_payments' | 'monthly_coupon_schedules'>,
): { couponNo: number; evaluationDate: string } | null {
  const evaluationOf = new Map(
    product.monthly_coupon_schedules.map((s) => [s.coupon_no, s.evaluation_date]),
  )
  let latest: { couponNo: number; evaluationDate: string } | null = null
  for (const payment of product.monthly_coupon_payments) {
    if (payment.coupon_no == null) continue
    const evaluationDate = evaluationOf.get(payment.coupon_no)
    if (evaluationDate == null) continue
    if (latest == null || evaluationDate > latest.evaluationDate) {
      latest = { couponNo: payment.coupon_no, evaluationDate }
    }
  }
  return latest
}
