import {
  dec,
  roundToUnit,
  ZERO,
  type DecimalInput,
  type DecimalValue,
} from '@/lib/decimal'

import { taxableIncome } from './proceeds'
import type { AccountType } from './types'

/**
 * 상품 통화 — DOC-002 v1.10 M-08 · D-08, DOC-007 v1.4 §2 · §4.8 · §7.7 (P8 컷 a2)
 *
 * **이 모듈이 지키는 명제 셋.**
 *
 * 1. **금액은 상품 통화의 보조단위를 따른다** — 원화 1원(0자리) · 달러 1센트(2자리).
 *    `moneyString`은 **기본 인자가 없다**: 통화를 빠뜨린 호출이 조용히 원화가 되면 달러
 *    금액이 센트를 잃거나(`10000.50` → `10001`) 원화 뜻으로 읽힌다. 빠뜨리면 컴파일 오류다.
 * 2. **통화가 다른 금액은 더하지 않는다** — `sumByCurrency`가 통화별로 가른다. 합친 값이
 *    필요하면 `toKrw`로 **추정**을 만든다(DOC-007 §7.7 — 사실은 환산하지 않는다).
 * 3. **추정 환율이 없으면 추정하지 않는다** — `toKrw`는 `null`을 돌려주고 기본값을 쓰지 않는다
 *    (DOC-007 E-09). 환율 1을 대입하면 달러가 원으로 읽히는데 그 값이 그럴듯하다.
 *
 * 순수 모듈이다(절대 규칙 #3) — 환율은 인자로 받는다.
 */

export type ProductCurrency = 'KRW' | 'USD'
export type ForeignCurrency = Exclude<ProductCurrency, 'KRW'>

/** 보조단위 — 저장 자릿수 제약(I-21)과 같은 값이다. 통화를 더하면 CHECK도 함께 고친다 */
export const MINOR_UNITS: { readonly [C in ProductCurrency]: { unit: string; decimals: number } } = {
  KRW: { unit: '1', decimals: 0 },
  USD: { unit: '0.01', decimals: 2 },
}

/** 표시 순서 — 원화가 먼저다(DOC-011 §4.1 `byCurrency`) */
export const CURRENCY_ORDER: readonly ProductCurrency[] = ['KRW', 'USD']

/**
 * 금액 문자열 — 상품 통화의 보조단위로 반올림한 **고정 자릿수** 문자열 (DOC-011 Q-07′).
 *
 * 원화는 `amountString`과 **바이트 단위로 같다**(`'616000'`). 달러는 언제나 소수 두 자리다
 * (`'10000.5'`로 저장된 값도 `'10000.50'`) — DB는 「2자리 이내」만 보장하고 형식은 여기서
 * 고정한다(DOC-002 §4.6 각주).
 */
export function moneyString(value: DecimalValue, currency: ProductCurrency): string {
  const { unit, decimals } = MINOR_UNITS[currency]
  return roundToUnit(value, unit).toFixed(decimals)
}

/**
 * 입력 금액의 소수 자릿수가 보조단위 이내인가 — V-23의 판정.
 *
 * `dec('10.10').decimalPlaces()`는 1이다(끝의 0을 버린다) — `10.10`과 `10.1`, 원화 `100.0`과
 * `100`을 구별하지 않고 둘 다 통과시킨다. ★ **DB의 `scale()`은 끝의 0을 센다**(`scale('10.500')` =
 * 3) — 그래서 이 판정을 통과한 입력은 **저장 전에 `moneyString`으로 정규화해야 한다**
 * (DOC-002 §4.6 각주 · DOC-011 §5.1). 정규화 없이 보내면 `els_products_principal_scale_check`가
 * 끝의 0 때문에 거부한다.
 */
export function hasMinorUnitScale(value: DecimalInput, currency: ProductCurrency): boolean {
  return dec(value).decimalPlaces() <= MINOR_UNITS[currency].decimals
}

/** 추정 환율 한 건 — 기준일 이전 최신 1건이다(DOC-007 §4.8 · RD-09) */
export type ExchangeRate = {
  readonly currency: ForeignCurrency
  /** 1 단위당 원 */
  readonly rate: DecimalInput
  readonly asOfDate: string
}

/** 통화별 추정 환율. `null`은 「그 통화의 환율이 없다」 — E-09 */
export type EstimateRates = Readonly<Record<ForeignCurrency, ExchangeRate | null>>

/** 환율이 하나도 없는 상태 — 컷 a3(`exchange_rates`) 전의 유일한 값이다 */
export const NO_ESTIMATE_RATES: EstimateRates = { USD: null }

/**
 * 원화 환산 — **추정 전용** (DOC-007 §4.8).
 *
 * 원화는 그대로 돌려준다. 외화는 추정 환율을 곱하고, 환율이 없으면 `null`이다(기본값 없음).
 * 반올림하지 않는다 — 집계는 반올림하지 않은 값으로 한다(DOC-007 §2).
 *
 * **과세 금융소득에 이 함수를 쓸 때는 «이익»을 넘긴다** — `toKrw(max(0, gross − P))`이지
 * `toKrw(gross) − toKrw(P)`가 아니다(원금의 환차익은 과세표준에 들어가지 않는 것으로 읽는다 —
 * RD-13). 이 함수는 한 금액만 받으므로 그 차이를 구조로 강제하지는 못한다.
 */
export function toKrw(params: {
  amount: DecimalInput
  currency: ProductCurrency
  rates: EstimateRates
}): DecimalValue | null {
  if (params.currency === 'KRW') return dec(params.amount)
  const rate = params.rates[params.currency]
  if (rate == null) return null
  return dec(params.amount).times(dec(rate.rate))
}

/**
 * 과세 금융소득(원화) — DOC-007 §4.8 `taxableIncomeKrw`. **과세 축은 통화와 무관하게 원화다.**
 *
 * ```
 * 원화 상품     taxableIncome(…)                       # §4.3 그대로 — x = 1을 곱하는 것이 아니다
 * 달러 상품     0                  TAX_FREE             # 환율 없이 안다 — 검산 A-2
 *              redemption 값      상환 완료             # 거래내역의 원화 확정값. 환산하지 않는다
 *              0                  달러 이익 ≤ 0         # 곱할 이익이 없다 — 환율보다 먼저 본다
 *              이익 × x           x 있음                # 달러로 빼고 한 번 곱한다
 *              null               그 밖                 # E-09 — 호출부가 센다
 * ```
 *
 * **분기 순서가 명제다.** 환율부터 보면 비과세 계좌와 이익 0인 건이 E-09로 세어져 「빠졌다」는
 * 거짓 경고가 뜬다(검산 A-2). `gross × x₁ − P × x₀`(원화로 바꾼 두 금액의 차)는 쓰지 않는다 —
 * 원금의 환차익이 과세표준에 들어간다(검산 A-5·A-6, RD-13).
 *
 * 반올림하지 않는다 — `F`에는 반올림 전 값이 들어가고(§2) 표시만 1원으로 접는다.
 */
export function taxableIncomeKrw(params: {
  currency: ProductCurrency
  accountType: AccountType
  principal: DecimalInput
  redemption?: { taxableIncome: DecimalInput } | null
  expectedGross?: DecimalInput | null
  rates: EstimateRates
}): DecimalValue | null {
  const { currency, rates, ...base } = params
  if (currency === 'KRW') return taxableIncome(base)

  // 비과세와 확정값은 `taxableIncome`이 이미 원화로 안다 — 달러 이익을 만들기 전에 끝낸다
  if (base.accountType === 'TAX_FREE' || base.redemption != null) {
    return taxableIncome(base)
  }

  // 여기서부터 `taxableIncome`의 값은 **달러**다(max(0, gross − P)) — 원화 자리에 두지 않는다
  const profit = taxableIncome(base)
  if (profit.lte(ZERO)) return ZERO
  return toKrw({ amount: profit, currency, rates })
}

/**
 * 통화별 합 — 사실(투자원금·손익·수령 월수익)의 합산 (DOC-007 §7.7).
 *
 * 결과는 `CURRENCY_ORDER` 순서이고 **값이 있는 통화만** 담는다. 빈 입력은 빈 배열이다 —
 * 「원화 0」을 채우는 것은 화면·계약의 결정이다(DOC-011 §4.1의 빈 포트폴리오).
 */
export function sumByCurrency(
  items: ReadonlyArray<{ currency: ProductCurrency; amount: DecimalInput }>,
): Array<{ currency: ProductCurrency; amount: DecimalValue }> {
  const totals = new Map<ProductCurrency, DecimalValue>()
  for (const item of items) {
    const prev = totals.get(item.currency)
    totals.set(item.currency, prev == null ? dec(item.amount) : prev.plus(dec(item.amount)))
  }
  return CURRENCY_ORDER.filter((c) => totals.has(c)).map((currency) => ({
    currency,
    amount: totals.get(currency) as DecimalValue,
  }))
}

/**
 * 포트폴리오 손익 — 실수령액 + 받은 월수익 − 투자원금. **상품 통화** (DOC-005 §6).
 *
 * `realizedPnl(gross, P)`와 `aggregateRealizedPnl`은 서명을 바꾸지 않는다(TC-17이 직접 부른다).
 * 월수익이 없는 상품(상환 시 지급)은 `couponGrossTotal = '0'`이며 값이 `realizedPnl`과 같다.
 */
export function portfolioPnl(params: {
  principal: DecimalInput
  redemptionGross: DecimalInput
  couponGrossTotal: DecimalInput
}): DecimalValue {
  return dec(params.redemptionGross).plus(dec(params.couponGrossTotal)).minus(dec(params.principal))
}
