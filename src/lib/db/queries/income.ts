import { dec, type DecimalValue } from '@/lib/decimal'
import {
  couponAmount,
  couponAttributionYear,
  couponConversionOf,
  couponFlowEndOf,
  couponTaxableIncomeKrw,
  estimateConversionOf,
  grossExpected,
  isWithinCouponFlow,
  taxableIncome,
  taxableIncomeKrw,
  type EstimateRates,
  type ExchangeRate,
  type ProductCurrency,
} from '@/lib/domain'

import { attributionOf } from './attribution'
import type { ProductRow } from './load'

/**
 * 소득 사건 — 한 상품이 과세 금융소득을 만드는 **사건**의 단일 원천 (P8 컷 b0 — 리팩터, 동작 불변)
 *
 * ## 왜 사건인가
 *
 * 지금까지 한 상품의 과세 기여는 **하나**였다 — 상환(확정) 또는 적용 차수의 예상 상환(추정). 세 소비자
 * (`contributionOf` → §4.6 · §4.1 · §4.8, `forecastItemsOf` → §4.7)가 그 하나를 각자 `attributionOf`에서
 * 다시 읽었다. 월지급식(DOC-001 S-14)은 **상품당 귀속 1건**을 깬다 — 매월의 월수익이 각자 지급일의 해에
 * 귀속되는 따로따로의 사건이다(설계 원자료 SB-4 · DOC-002 D-09 예정). 그래서 먼저 「상품 → 사건들」의 사상을
 * 이 파일 하나로 세우고, 소비자가 사건을 접게 한다. ~~**이 컷에서는 사건이 상품당 최대 하나다** — 상환 사건뿐이다.~~
 * **→ 컷 b4: 상환 0..1 + 월수익 0..K** (DOC-007 §7.6). 소비자 셋이 그 집합을 접는다 — `contributionOf`(그 해의 사건
 * — 「접는 규칙」) · `forecastItemsOf`(사건마다 항목) · `remainingCouponsOf`(§4.3 — 추정 월수익을 연도별로).
 *
 * ## ~~「최대 하나」는 타입이다~~ → 넓혔다 (b4)
 *
 * ~~반환형이 `readonly [] | readonly [IncomeEvent]`다.~~ b0은 그 튜플로 「접는 규칙을 정하기 전에는 넓히지 못한다」를
 * 컴파일에 맡겼고, b4가 규칙(DOC-007 §7.6 · DOC-011 §4.6 「월지급 상품의 기여」)을 구현하며 넓혔다 — 실제로
 * `contributionOf`의 대입이 멈췄다.
 *
 * ## 월수익 사건 (b4 — DOC-007 §7.6 「월수익 순번 k마다」)
 *
 * | 달 | 사건 | 귀속 | 과세 |
 * |---|---|---|---|
 * | 지급(`PAID`) 기록 — 순번 있음 · 없음(기실현) | 확정 | 기록의 지급일 연도 | 기록의 원화 값 |
 * | 미지급(`UNPAID`) 기록 | 없음 | — | — |
 * | 기록 없음 · `t_k ≤ T_end` | 추정(지급된 것으로) | 일정의 지급일 연도 | `q_k` · `q_k × x` · 비과세 0 |
 * | 기록 없음 · `t_k > T_end` | 없음 | — | — |
 *
 * **조기 반환은 상환 사건에만 걸린다** — 적용 차수 없음(`NO_ROUND`)이면 `T_end = ∞`라 일정 전부가 추정 사건이고,
 * 다른 해에 귀속되는 상환 옆에도 그 해의 월수익이 있다(검산 B-1). b0은 셋을 상품 단위로 걸었다.
 *
 * ## 연도를 주면 **값을 계산하기 전에** 거른다
 *
 * `contributionOf`는 한 해의 사건만 원한다. 연도를 거르지 않고 전 사건의 값을 먼저 계산하면 **다른 해에 귀속되는
 * 사건의 산식이 실행되어** 그 산식이 던지는 입력(계약 밖에서 넣은 값 — AQ-29. `round_no ≤ 0`은 이제 DB의
 * `redemption_schedules_round_no_check`가 막는다 — AQ-92 · M-b2. 이 순서는 그 뒤의 둘째 겹이다)이 그 해와 무관한 조회까지 죽인다. 종전 `contributionOf`는 귀속연도를 산식보다 먼저 봤다 — 그
 * 순서가 동작의 일부이고(반박 검토가 찾았다) 이 인자가 그것을 지킨다. **거름의 단위는 사건이다**(b4) — 상환은 그
 * 귀속연도로, 월수익은 지급일의 연도로 값보다 먼저 거른다.
 *
 * ## 값은 종전 `contributionOf`가 내던 것과 같다
 *
 * 분기와 산식은 그 함수에서 옮겨 왔다 — 상환은 증권사 확정값(A-04), 미상환은 적용 차수의 예상 수령액(RD-02),
 * 적용 차수가 없거나(`NO_ROUND`) 계약 조건이 없으면(연쿠폰율 `null`) 사건이 없다. 기존 고정값이 전부 그대로인
 * 것이 이 컷의 증명이다.
 */

export type IncomeEvent = {
  /** 사건의 종류 — 상환 · 월수익(컷 b4) */
  kind: 'REDEMPTION' | 'COUPON'
  /**
   * 귀속연도 — 상환이면 상환일, 추정 상환이면 적용 차수 평가일의 연도(DOC-007 §7.2 · RD-02), 월수익이면 지급일의
   * 연도(기록이면 기록의 지급일 · 추정이면 일정의 지급일 — SB-5)
   */
  year: number
  /** 그 상품의 통화. `gross`·`principalReturned`의 단위다 */
  currency: ProductCurrency
  /** 세전 실수령액 — **원금 반환분을 포함한다**(`grossExpected`의 정의 · DOC-007 §7.4) */
  gross: DecimalValue
  /**
   * 이 사건이 돌려주는 원금 — 상환 사건은 투자원금 전부다. 월수익 사건은 0이 된다(컷 b4) — 전망의 배타 분할
   * (한 상품의 원금은 잔여 원금 아니면 수령액 한쪽에만, DOC-007 §7.5)이 이 값 하나에 기댄다.
   *
   * **저장값 문자열 그대로다**(`principal::text` — Q-08). 종전 전망 항목이 원금을 그 문자열로 실었고 그 표현이
   * 고정값에 박혀 있다 — `Decimal`로 바꾸면 값은 같은데 고정값이 깨진다(컷 b0이 실제로 그렇게 깨졌다)
   */
  principalReturned: string
  /**
   * 과세 금융소득 — **원화**(과세 축). `null` = E-09: 달러 추정인데 추정 환율이 없다. 0으로 흡수하지 않는다
   * (DOC-011 §4.0 규칙 3)
   */
  taxableIncomeKrw: DecimalValue | null
  /** 증권사 확정값이 아니라 시스템 추정이다 */
  isEstimated: boolean
  /**
   * 이 사건을 원화로 환산한 추정 환율. `null` = 곱하지 않았다 — 원화 · 확정값 · 비과세 · 달러 이익 ≤ 0, 또는
   * 곱해야 하는데 환율이 없다(그쪽은 `taxableIncomeKrw = null`)
   */
  estimateRate: ExchangeRate | null
}

/** 한 상품의 사건 — 상환 0..1 + 월수익 0..K(머리 주석). 순서: 상환 → 월수익(순번 · 기실현은 지급일 순) */
export type IncomeEvents = readonly IncomeEvent[]

export function incomeEventsOf(
  row: ProductRow,
  asOf: string,
  /** 추정 환율 — 기본값이 없다. 원화 상품과 확정값은 이 인자를 보지 않는다 */
  rates: EstimateRates,
  /** 이 해에 귀속되는 사건만 — **값을 계산하기 전에** 거른다(머리 주석). 주지 않으면 전 사건이다 */
  only?: { year: number },
): IncomeEvents {
  const attribution = attributionOf(row, asOf)
  const redemption = redemptionEventOf(row, attribution, rates, only)
  return [...(redemption == null ? [] : [redemption]), ...couponEventsOf(row, attribution, rates, only)]
}

/** 상환 사건 — b0의 분기 그대로다. **조기 반환 셋이 이 사건에만 걸린다**(b4) */
function redemptionEventOf(
  row: ProductRow,
  attribution: ReturnType<typeof attributionOf>,
  rates: EstimateRates,
  only: { year: number } | undefined,
): IncomeEvent | null {
  // 적용 차수를 정할 수 없으면 상환 사건이 없다 — E-07(전 차수 경과)과 일정 0건이 그 하나로 묶인다
  // (`attribution.ts`의 각주). 월수익 사건은 남는다 — 흐름 끝이 무한이다
  if (attribution.kind === 'NO_ROUND') return null
  // 다른 해에 귀속되는 상환은 값을 계산하지 않는다 — 산식이 던지는 입력이 그 해의 조회를 죽이지 않게
  if (only != null && attribution.year !== only.year) return null

  // 상환 완료 — 증권사 확정값을 쓴다(A-04). 시스템 추정으로 대체하지 않는다.
  // 달러 상품도 같다 — 거래내역의 **원화** 과세이며 환율을 곱하지 않는다(U1).
  if (attribution.kind === 'REDEEMED') {
    return {
      kind: 'REDEMPTION',
      year: attribution.year,
      currency: row.currency,
      gross: dec(attribution.redemption.gross_amount),
      principalReturned: row.principal,
      taxableIncomeKrw: taxableIncome({
        accountType: row.account_type,
        principal: row.principal,
        redemption: { taxableIncome: attribution.redemption.taxable_income },
      }),
      isEstimated: false,
      estimateRate: null,
    }
  }

  // 계약 조건이 없으면 추정할 수 없다 — 기실현 등재는 연쿠폰율이 없다(D-07).
  // **`NO_ROUND`와 같은 답을 준다**(사건이 없다): 「추정할 수 없다」와 「기여가 0이다」를 같은 값으로 내면
  // 그 상품의 원금이 §7.5에서 증발한다. 그 상품은 항상 상환 완료이므로 위 분기가 먼저 반환한다 — 여기 오는
  // 유일한 길은 계약 밖에서 차수를 넣은 경우다(AQ-14 · AQ-65). 월지급식 FULL은 연쿠폰율이 `0`이라 닿지 않는다(I-23)
  if (row.annual_coupon_rate == null) return null

  const gross = grossExpected({
    principal: row.principal,
    couponRate: row.annual_coupon_rate,
    evaluationPeriodMonths: row.evaluation_period_months,
    roundNo: attribution.round.round_no,
  })

  // §4.3 `projection`과 같은 함수다 — 두 화면이 같은 상품에 같은 E-09를 말한다
  const input = {
    currency: row.currency,
    accountType: row.account_type,
    principal: row.principal,
    redemption: null,
    expectedGross: gross,
  }
  const conversion = estimateConversionOf(input)

  return {
    kind: 'REDEMPTION',
    year: attribution.year,
    currency: row.currency,
    gross,
    principalReturned: row.principal,
    taxableIncomeKrw: taxableIncomeKrw({ ...input, rates }),
    isEstimated: true,
    estimateRate: conversion == null ? null : rates[conversion],
  }
}

/**
 * 월수익 사건 (컷 b4 — DOC-007 §7.6). 월지급식 상품만이다 — 상환 시 지급 상품 아래 일정 행이 남아 있어도(계약 밖
 * 쓰기 — I-25) 읽지 않는다.
 *
 * **셋째 결함(`COUPON_SCHEDULE_MISSING`)은 따로 거르지 않는다** — 일정이 0행이면 추정 사건이 없고, 순번 있는 기록은
 * 일정 행을 복합 FK로 가리키므로 생길 수 없으며, 순번 없는 기록은 기실현에만 있다(I-27). 그래서 억제(§4.2 D1)가
 * 구조로 성립한다 — §4.6 `breakdown.coupons = null`이 그 결과다.
 */
function couponEventsOf(
  row: ProductRow,
  attribution: ReturnType<typeof attributionOf>,
  rates: EstimateRates,
  only: { year: number } | undefined,
): IncomeEvent[] {
  if (row.coupon_payout !== 'MONTHLY') return []
  const inYear = (year: number) => only == null || year === only.year
  const events: IncomeEvent[] = []

  // ① 지급 기록 — 확정 사건(흐름 끝과 무관하다 — 기록은 사실이다). 미지급은 사건이 아니다
  const paid = row.monthly_coupon_payments
    .filter((payment) => payment.outcome === 'PAID' && payment.payment_date != null)
    .sort(
      (a, b) =>
        (a.coupon_no ?? Number.MAX_SAFE_INTEGER) - (b.coupon_no ?? Number.MAX_SAFE_INTEGER) ||
        (a.payment_date as string).localeCompare(b.payment_date as string),
    )
  for (const payment of paid) {
    const year = couponAttributionYear(payment.payment_date as string)
    if (!inYear(year)) continue
    const record = { taxableIncome: payment.taxable_income ?? '0' }
    events.push({
      kind: 'COUPON',
      year,
      currency: row.currency,
      gross: dec(payment.gross_amount ?? '0'),
      principalReturned: '0',
      taxableIncomeKrw: couponTaxableIncomeKrw({
        currency: row.currency,
        accountType: row.account_type,
        record,
        amount: '0',
        rates,
      }),
      isEstimated: false,
      estimateRate: null,
    })
  }

  // ② 기록 없는 달 · 흐름 끝 이내 — 추정 사건(지급된 것으로 — 조건과 무관하다, DOC-007 §7.6 · E-10)
  // 월지급식 FULL은 월수익 연쿠폰율이 있다(I-23). 없으면 계약 밖 쓰기다 — 금액을 지어내지 않고 추정만 비운다
  // (§4.3 `couponObservationsOf`가 같은 경우에 월수익을 비우는 것과 같다)
  if (row.monthly_coupon_annual_rate == null) return events
  const recorded = new Set(
    row.monthly_coupon_payments.flatMap((payment) => (payment.coupon_no == null ? [] : [payment.coupon_no])),
  )
  const flowEnd = couponFlowEndOf({
    redemptionDate: row.redemptions?.redemption_date ?? null,
    appliedRoundEvaluationDate: attribution.kind === 'ESTIMATED' ? attribution.round.evaluation_date : null,
  })
  const amount = couponAmount({
    principal: row.principal,
    annualRate: row.monthly_coupon_annual_rate,
    currency: row.currency,
  })
  const conversion = couponConversionOf({ currency: row.currency, accountType: row.account_type, record: null })

  const schedules = [...row.monthly_coupon_schedules].sort((a, b) => a.coupon_no - b.coupon_no)
  for (const schedule of schedules) {
    if (recorded.has(schedule.coupon_no)) continue
    if (!isWithinCouponFlow(schedule.evaluation_date, flowEnd)) continue
    const year = couponAttributionYear(schedule.payment_date)
    if (!inYear(year)) continue
    events.push({
      kind: 'COUPON',
      year,
      currency: row.currency,
      gross: amount,
      principalReturned: '0',
      taxableIncomeKrw: couponTaxableIncomeKrw({
        currency: row.currency,
        accountType: row.account_type,
        record: null,
        amount,
        rates,
      }),
      isEstimated: true,
      estimateRate: conversion == null ? null : rates[conversion],
    })
  }
  return events
}
