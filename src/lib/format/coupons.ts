import type { CouponObservationView, CouponRecordView } from '@/lib/db/queries/map'
import type { TaxSummaryView } from '@/lib/db/queries/tax'

import { dec } from '@/lib/decimal'

import { dDayLabel, ymd } from './date'
import { REDEMPTION_KRW_TAXABLE_HINT, type ExchangeRateBasisText } from './exchangeRate'
import { exchangeRateDisplay, won } from './money'
import { percent } from './ratio'

/**
 * 월수익의 표기 — DOC-008 §5 머리 「월수익 표기 1~3」 (P8 컷 b3)
 *
 * SCR-202 ⑦ · SCR-206 · SCR-301이 같은 함수를 지난다 — 한 사실을 세 화면이 다르게 부르지 않는다(셋째 빈 상태 각주의
 * 규율). 서버의 계약 문구(`mutations/couponMonths.ts` — 「기록된 달은 지울 수 없다 — 5번째 · 2027-02-16」)도 이 함수다.
 */

/**
 * 표기 1 — 「5번째 · 2027-02-16」(순번 + 월수익 평가일, 민서 결정(2026-10-02) ① · DOC-005 GQ-04).
 * 「회」는 회차와, 「차」는 차수와, 「월차」는 휴가와 겹친다(DOC-005 §8.3)
 */
export function couponMonthLabel(couponNo: number, evaluationDate: string): string {
  return `${couponNo}번째 · ${ymd(evaluationDate)}`
}

/**
 * 순번 없는 기록(기실현 월지급)의 머리 — DOC-008 SQ-21 ⓔ(b3 개정). 표기 1의 날짜 자리는 **평가일**이라 지급일을
 * 거기 두면 같은 자리가 행마다 다른 날짜를 뜻한다 — 날짜는 그 행의 지급일 칸이 나른다
 */
export const UNNUMBERED_COUPON_LABEL = '순번 없음'

/**
 * ⑦ · SCR-301의 금액 칸 — 표기 2. 상품 통화 금액 문자열을 고르기만 한다(통화 표기는 호출부의 `money`).
 *
 * - 기록이 있으면 기록의 세전이다 — 미지급은 금액이 없다(`null`)
 * - 기록이 없으면 예상 금액(`expectedAmount` — 보조단위 절사값, SCR-206 기본값과 같은 값)이다
 * - **「상환 후 없음」은 금액을 적지 않는다** — 도래하지 않을 날짜의 반사실이다(SCR-301 상품별 카드 규약 4와 같다)
 */
export function couponAmountShown(coupon: {
  // SCR-202 ⑦(§4.3 `CouponObservationView`)과 SCR-301(§4.12 `MonthlyCouponScheduleItem`)이 함께 쓴다 — 기록의 모양이 둘이라
  // 읽는 필드만 요구한다
  record: { grossAmount: string | null } | null
  state: CouponObservationView['state']
  expectedAmount: string
}): string | null {
  if (coupon.record != null) return coupon.record.grossAmount
  if (coupon.state === 'ENDED') return null
  return coupon.expectedAmount
}

/** 기록 하나의 세전 — 순번 없는 기록 행이 쓴다(늘 지급이다 — I-27) */
export function recordAmountShown(record: Pick<CouponRecordView, 'grossAmount'>): string | null {
  return record.grossAmount
}

/**
 * SCR-206 달러 상품의 과세 금융소득 힌트 — 채우지 않는다(U1). 과세표준은 지급일 환율로 환산한 원화이고 그 환율은
 * 거래내역만 안다. 근거 환율이 있으면 크기를 말하고(SCR-203 v2.19 선례), 없으면 뒷절만이다(DOC-008 SQ-21 ⓘ b3 개정)
 */
export function couponTaxableHint(basis: ExchangeRateBasisText | null): string {
  if (basis == null) return `≈ 세전 × 지급일 환율 — ${REDEMPTION_KRW_TAXABLE_HINT}`
  return `≈ 세전 × ${exchangeRateDisplay(basis.rate)} — ${ymd(basis.asOfDate)} 기준 추정 환율이다. ${REDEMPTION_KRW_TAXABLE_HINT}`
}

/**
 * 월 쿠폰율 — 월수익 연쿠폰율 ÷ 12 (DOC-008 SCR-201 ⑮ · SQ-21 ⓐ b3 개정). 퍼센트 소수 둘째 자리에서 나누어떨어지면
 * 그대로(「월 2.02%」 · 「월 0.6%」), 아니면 반올림하고 「≈」를 단다(「월 ≈0.61%」). **표시 전용 율이다** — 계산은 연율
 * 하나로 하고(DOC-005 「월수익 연쿠폰율」) 금액의 절사(표기 2)와 대상이 다르다. 근사를 숨기지 않는 것이 「≈」다.
 */
export function monthlyRateLabel(annualRate: string): string {
  const monthly = dec(annualRate).div(12)
  // 비율 소수 넷째 자리 = 퍼센트 둘째 자리 — 그 안에서 끝나면 정확한 값이다
  if (monthly.decimalPlaces() <= 4) return `월 ${percent(monthly.toFixed(4))}`
  // `D`의 기본 반올림이 HALF_UP이다(`lib/decimal.ts`) — 표시 반올림이며 금액이 아니다
  return `월 ≈${monthly.times(100).toFixed(2)}%`
}

/**
 * ⑮ 월수익 요약 — 「월 2.02% · 월수익 배리어 50% · 지급 5/36 · 다음 D-12」 (DOC-008 SCR-201 ⑮).
 *
 * - 상환 시 지급 · 기실현 월지급(`terms.monthlyCoupon = null`)이면 없다(부재 — ST-04와 같은 형태)
 * - **셋째 결함이면 그리지 않는다** — `barrier = null`의 뜻이 둘(달마다 다름 · 결함)이라 `integrityIssue`로 가른다. 가르지
 *   않으면 결함 상품에 「월수익 배리어 달마다 다름」이라는 거짓 조각이 붙는다(카드는 결함 문구를 따른다 — ST-06)
 * - 진행(`couponProgress`)이 없으면 앞 두 조각만, 다음 평가일이 없으면 셋째까지
 */
export function couponSummaryOf(item: {
  integrityIssue: string | null
  couponProgress: { paid: number; total: number; nextDDay: number | null } | null
  terms: { monthlyCoupon: { annualRate: string; barrier: string | null } | null }
}): string | null {
  const term = item.terms.monthlyCoupon
  if (term == null || item.integrityIssue === 'COUPON_SCHEDULE_MISSING') return null
  const pieces = [
    monthlyRateLabel(term.annualRate),
    term.barrier == null ? '월수익 배리어 달마다 다름' : `월수익 배리어 ${percent(term.barrier)}`,
  ]
  if (item.couponProgress != null) {
    pieces.push(`지급 ${item.couponProgress.paid}/${item.couponProgress.total}`)
    if (item.couponProgress.nextDDay != null) pieces.push(`다음 ${dDayLabel(item.couponProgress.nextDDay)}`)
  }
  return pieces.join(' · ')
}

// ---------------------------------------------------------------------------
// 세금 · 전망의 월수익 표시 (P8 컷 b4 — DOC-008 SQ-21 ⓚ · ⓛ · SCR-401 · SCR-402 · SCR-502)
// ---------------------------------------------------------------------------

/**
 * 월지급식 가정의 면책 한 문장 — SCR-502(조건 없이) · SCR-401 · SCR-101 ③(그 해의 `F`에 추정 월수익 사건이 있을 때 —
 * `monthlyCouponAssumption`)이 같은 상수다(DOC-008 SQ-21 ⓛ · ⓚ (c)). 한 가정을 세 화면이 다르게 말하지 않는다
 */
export const MONTHLY_COUPON_ESTIMATE_NOTE =
  '월지급식 — 기록 없는 지난 월수익은 지급된 것으로, 미상환 상품은 적용 차수까지 매월 지급된다고 가정한 추정이다. 확정값은 월수익 지급 기록(거래내역)이다'

/** SCR-402 표 밖 표식 여섯째 — 표식이라 짧다(DOC-008 SCR-402 v2.22 · 「표 밖 표식」 셀). 화면 전체 고지와 별개다(RD-19) */
export const MONTHLY_COUPON_ASSUMPTION = '월지급식은 적용 차수까지 매월 지급 가정'

/**
 * SCR-401 — 금액이 있는데 `exchangeRateMissing`인 행(확정분은 들어가고 달러 추정분만 빠졌다). ST-07의 「환율이 없어」를
 * 공유하고 빠진 것만 말한다(DOC-008 SQ-21 ⓚ (a)). 몇 건인지는 내역 줄이 적는다
 */
export const PARTIAL_RATE_MISSING_NOTE = '환율이 없어 추정분은 빠졌다'

/**
 * SCR-401 기여 상품 행의 내역 한 줄 — 「상환 0원 (추정) · 월수익 확정 1건 600,000원 · 추정 4건 2,400,000원」.
 *
 * **월수익 내역이 없으면 `null`이다** — 상환 시 지급 상품의 행은 사건이 상환 하나라 내역이 행의 금액과 같은 말을 되풀이한다.
 * 그 행은 종전과 바이트 단위로 같다. 금액은 원화(과세 축)이고 `null`은 「환율 없음」이다(E-09 — 0으로 적지 않는다)
 */
export function contributionBreakdownLine(
  breakdown: TaxSummaryView['contributingProducts'][number]['breakdown'],
): string | null {
  const coupons = breakdown.coupons
  if (coupons == null) return null
  const money = (value: string | null) => (value == null ? '환율 없음' : won(value))
  const pieces: string[] = []
  if (breakdown.redemption != null) {
    pieces.push(`상환 ${money(breakdown.redemption.taxableIncome)}${breakdown.redemption.isEstimated ? ' (추정)' : ''}`)
  }
  if (coupons.confirmedCount > 0) pieces.push(`월수익 확정 ${coupons.confirmedCount}건 ${won(coupons.confirmedTaxableIncome)}`)
  if (coupons.estimatedCount > 0) pieces.push(`추정 ${coupons.estimatedCount}건 ${money(coupons.estimatedTaxableIncome)}`)
  return pieces.join(' · ')
}
