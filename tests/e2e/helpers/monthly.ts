import { shiftDays } from '@/lib/domain'

import { queryRows, sql } from '../../integration/helpers/seed'

/**
 * 등록된 상품을 **월지급식으로 바꾼다** — e2e 전용 (P8 컷 b3).
 *
 * b3의 등록 폼은 「월지급식」을 고를 수 없다(선택지는 b4 — SB-13). 계약은 b2부터 월지급식을 받지만 e2e는 화면 폼으로
 * 등록하므로(`registerProduct`) 등록 뒤 SQL로 계약 조건과 월수익 일정을 붙인다 — `defects.ts`가 결함 상태를 SQL로
 * 세우는 것과 같은 자리다. 한 UPDATE에서 연쿠폰율 0 · 월수익 연쿠폰율 > 0을 함께 바꿔 I-23(`els_products_monthly_terms_check`)을
 * 만족한다. 기록이 없으므로 동결 트리거는 발화하지 않는다.
 *
 * *(b4-3c 뒤)* 폼이 「월지급식」을 고를 수 있게 되었다 — 화면 등록은 `registerProduct`의 `monthly` 옵션이다. 이 헬퍼는
 * **기준일 상대 날짜의 월수익 일정**(지난 달 · 다가올 달이 섞인)이 필요한 파일을 위해 남는다 — 폼의 산식 채우기는 발행일에서
 * 출발하므로 「어느 날 돌려도 무기록 지난 달이 있다」를 만들지 못한다.
 *
 * 월수익 평가일은 **오늘 기준 상대 날짜**다 — 시각이 데이터인 테스트를 만들지 않는다(redeem.test.ts의 같은 각주).
 */
export type MonthlyMonth = { couponNo: number; evaluationDate: string; paymentDate: string }

/**
 * 기준일에서 앞뒤로 다섯 달 — 1~3번째는 평가가 끝났고(3번째는 지급일도 지났다) 4 · 5번째는 아직이다.
 *
 * ★ **표시 시험용 저장 상태다 — 계약을 지나지 않는다** (P8.5 · DOC-011 v4.37). 상품은 평가주기 6 × 3차수(만기까지 18개월)인데
 * 다섯 달뿐이므로 V-26 행 수 규칙에 걸린다 — 이 상품을 그대로 **저장**하면 거부된다. SQL로 심는 이유가 「기준일 상대 날짜」라서
 * 그렇다(SCR-202 ⑦ · SCR-206 · SCR-301이 「지난 달 · 다가올 달」을 렌더하는 상태). **저장을 시험하는 사례는 `monthsToMaturity`를
 * 쓴다**
 */
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
  // 월지급식 + 리자드는 v2다(V-25 · 쓰기 함수 `els_products_monthly_lizard_forbidden`) — `registerProduct`의 2차 리자드를
  // 걷는다. 남기면 계약이 만들 수 없는 상품이 되고 그 상품의 수정 저장이 늘 거부된다(실측 — 이 헬퍼의 첫 판)
  await sql(
    `update public.redemption_schedules
        set lizard_barrier = null, lizard_coupon_rate = null, lizard_requires_no_ki = null
      where els_id = $1::uuid`,
    [productId],
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

/**
 * 만기까지 매월 — 계약(V-26 행 수 = 평가주기 × 총 차수)을 지나는 일정 (P8.5). 앱 산식(발행일 + k개월 − 1일 · 지급일 = 평가일 +
 * 3일)이고 `registerProduct`의 차수 평가일도 같은 산식이라 K번째가 만기와 같은 날이다(만기 이하).
 */
export async function monthsToMaturity(productId: string): Promise<MonthlyMonth[]> {
  const { rows } = await queryRows<{ issue_date: string; period: number; rounds: number }>(
    `select p.issue_date::text, p.evaluation_period_months as period,
            (select count(*)::int from public.redemption_schedules s where s.els_id = p.id) as rounds
       from public.els_products p where p.id = $1::uuid`,
    [productId],
  )
  const { issue_date: issueDate, period, rounds } = rows[0]!
  return Array.from({ length: period * rounds }, (_, index) => {
    const [y, m, d] = issueDate.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number]
    const plus = new Date(Date.UTC(y, m - 1 + index + 1, d))
    // 달 끝 넘침(1-31 + 1개월)은 그 달의 마지막 날로 — `generateEvaluationDates`와 같은 처리
    if (plus.getUTCDate() !== d) plus.setUTCDate(0)
    const evaluationDate = shiftDays(plus.toISOString().slice(0, 10), -1)
    return { couponNo: index + 1, evaluationDate, paymentDate: shiftDays(evaluationDate, 3) }
  })
}
