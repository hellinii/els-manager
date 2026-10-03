import type { CouponObservationView, CouponRecordView } from '@/lib/db/queries/map'

import { ymd } from './date'
import { REDEMPTION_KRW_TAXABLE_HINT, type ExchangeRateBasisText } from './exchangeRate'
import { exchangeRateDisplay } from './money'

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
export function couponAmountShown(coupon: Pick<CouponObservationView, 'record' | 'state' | 'expectedAmount'>): string | null {
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
