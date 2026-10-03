import { shiftDays } from '@/lib/domain'

import { sql } from '../../integration/helpers/seed'

/**
 * 등록된 상품을 **월지급식으로 바꾼다** — e2e 전용 (P8 컷 b3).
 *
 * b3의 등록 폼은 「월지급식」을 고를 수 없다(선택지는 b4 — SB-13). 계약은 b2부터 월지급식을 받지만 e2e는 화면 폼으로
 * 등록하므로(`registerProduct`) 등록 뒤 SQL로 계약 조건과 월수익 일정을 붙인다 — `defects.ts`가 결함 상태를 SQL로
 * 세우는 것과 같은 자리다. 한 UPDATE에서 연쿠폰율 0 · 월수익 연쿠폰율 > 0을 함께 바꿔 I-23(`els_products_monthly_terms_check`)을
 * 만족한다. 기록이 없으므로 동결 트리거는 발화하지 않는다.
 *
 * 월수익 평가일은 **오늘 기준 상대 날짜**다 — 시각이 데이터인 테스트를 만들지 않는다(redeem.test.ts의 같은 각주).
 */
export type MonthlyMonth = { couponNo: number; evaluationDate: string; paymentDate: string }

/** 기준일에서 앞뒤로 다섯 달 — 1~3번째는 평가가 끝났고(3번째는 지급일도 지났다) 4 · 5번째는 아직이다 */
export function monthsAround(asOf: string): MonthlyMonth[] {
  return [-70, -40, -10, 20, 50].map((offset, index) => {
    const evaluationDate = shiftDays(asOf, offset)
    return { couponNo: index + 1, evaluationDate, paymentDate: shiftDays(evaluationDate, 3) }
  })
}

export async function makeMonthly(
  productId: string,
  months: readonly MonthlyMonth[],
  annualRate = '0.0720',
): Promise<void> {
  await sql(
    `update public.els_products
        set coupon_payout = 'MONTHLY', annual_coupon_rate = 0, monthly_coupon_annual_rate = $2
      where id = $1::uuid`,
    [productId, annualRate],
  )
  for (const month of months) {
    await sql(
      `insert into public.monthly_coupon_schedules
         (els_id, coupon_no, evaluation_date, payment_date, coupon_barrier)
       values ($1::uuid, $2, $3, $4, 0.6000)`,
      [productId, month.couponNo, month.evaluationDate, month.paymentDate],
    )
  }
}
