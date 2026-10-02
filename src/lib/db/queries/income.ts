import { dec, type DecimalValue } from '@/lib/decimal'
import {
  estimateConversionOf,
  grossExpected,
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
 * 이 파일 하나로 세우고, 소비자가 사건을 접게 한다. **이 컷에서는 사건이 상품당 최대 하나다** — 상환 사건뿐이다.
 *
 * ## 「최대 하나」는 타입이다
 *
 * 반환형이 `readonly [] | readonly [IncomeEvent]`다. 월수익 사건(컷 b4)이 들어와 이것이 배열로 넓어지는 순간
 * `contributionOf`의 대입이 **컴파일 오류**가 된다 — 사건 여럿을 접는 규칙(E-09를 사건 단위로 · 건수 · 확정/추정
 * 분할, 컷 b1의 명세)을 정하지 않은 채 첫 사건만 읽는 구현이 조용히 서지 않게 한다.
 *
 * ## 연도를 주면 **값을 계산하기 전에** 거른다
 *
 * `contributionOf`는 한 해의 사건만 원한다. 연도를 거르지 않고 전 사건의 값을 먼저 계산하면 **다른 해에 귀속되는
 * 사건의 산식이 실행되어** 그 산식이 던지는 입력(계약 밖에서 넣은 `round_no ≤ 0` — AQ-29 · DB에 `round_no ≥ 1`
 * CHECK가 없다)이 그 해와 무관한 조회까지 죽인다. 종전 `contributionOf`는 귀속연도를 산식보다 먼저 봤다 — 그
 * 순서가 동작의 일부이고(반박 검토가 찾았다) 이 인자가 그것을 지킨다. 월수익 사건(컷 b4)도 귀속연도가 지급일로
 * 값보다 먼저 정해지므로 같은 거름이 그대로 통한다.
 *
 * ## 값은 종전 `contributionOf`가 내던 것과 같다
 *
 * 분기와 산식은 그 함수에서 옮겨 왔다 — 상환은 증권사 확정값(A-04), 미상환은 적용 차수의 예상 수령액(RD-02),
 * 적용 차수가 없거나(`NO_ROUND`) 계약 조건이 없으면(연쿠폰율 `null`) 사건이 없다. 기존 고정값이 전부 그대로인
 * 것이 이 컷의 증명이다.
 */

export type IncomeEvent = {
  /** 사건의 종류. 이 컷에서는 상환뿐이다 — 월수익(`COUPON`)은 컷 b4가 더한다 */
  kind: 'REDEMPTION'
  /** 귀속연도 — 상환이면 상환일, 추정이면 적용 차수 평가일의 연도(DOC-007 §7.2 · RD-02) */
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

/** 한 상품의 사건 — **이 컷에서는 최대 하나다**(머리 주석 「「최대 하나」는 타입이다」) */
export type IncomeEvents = readonly [] | readonly [IncomeEvent]

export function incomeEventsOf(
  row: ProductRow,
  asOf: string,
  /** 추정 환율 — 기본값이 없다. 원화 상품과 확정값은 이 인자를 보지 않는다 */
  rates: EstimateRates,
  /** 이 해에 귀속되는 사건만 — **값을 계산하기 전에** 거른다(머리 주석). 주지 않으면 전 사건이다 */
  only?: { year: number },
): IncomeEvents {
  const attribution = attributionOf(row, asOf)

  // 적용 차수를 정할 수 없으면 사건이 없다 — E-07(전 차수 경과)과 일정 0건이 그 하나로 묶인다
  // (`attribution.ts`의 각주)
  if (attribution.kind === 'NO_ROUND') return []
  // 다른 해에 귀속되는 사건은 값을 계산하지 않는다 — 산식이 던지는 입력이 그 해의 조회를 죽이지 않게
  if (only != null && attribution.year !== only.year) return []

  // 상환 완료 — 증권사 확정값을 쓴다(A-04). 시스템 추정으로 대체하지 않는다.
  // 달러 상품도 같다 — 거래내역의 **원화** 과세이며 환율을 곱하지 않는다(U1).
  if (attribution.kind === 'REDEEMED') {
    return [
      {
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
      },
    ]
  }

  // 계약 조건이 없으면 추정할 수 없다 — 기실현 등재는 연쿠폰율이 없다(D-07).
  // **`NO_ROUND`와 같은 답을 준다**(사건이 없다): 「추정할 수 없다」와 「기여가 0이다」를 같은 값으로 내면
  // 그 상품의 원금이 §7.5에서 증발한다. 그 상품은 항상 상환 완료이므로 위 분기가 먼저 반환한다 — 여기 오는
  // 유일한 길은 계약 밖에서 차수를 넣은 경우다(AQ-14 · AQ-65).
  if (row.annual_coupon_rate == null) return []

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

  return [
    {
      kind: 'REDEMPTION',
      year: attribution.year,
      currency: row.currency,
      gross,
      principalReturned: row.principal,
      taxableIncomeKrw: taxableIncomeKrw({ ...input, rates }),
      isEstimated: true,
      estimateRate: conversion == null ? null : rates[conversion],
    },
  ]
}
