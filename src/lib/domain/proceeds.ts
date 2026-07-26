import {
  assertPositiveInteger,
  dec,
  maxZero,
  sum,
  ZERO,
  type DecimalInput,
  type DecimalValue,
} from '@/lib/decimal'
import type { AccountType, ConditionResult } from './types'

/** 수령액 및 과세 금융소득 — DOC-007 §4 */

/**
 * 적용 쿠폰율의 대상이 되는 판정 결과 — DOC-007 §4.1
 *
 * `CARRY_OVER`는 해당 차수에 상환되지 않으므로 적용 쿠폰율이 정의되지 않는다.
 * 타입에서 제외하여 호출 자체를 막는다.
 */
export type RedeemingCondition = Exclude<ConditionResult, 'CARRY_OVER'>

/**
 * 적용 쿠폰율 — DOC-007 §4.1
 *
 * ```
 * = r                  if condition = EARLY
 * = lizardCouponRate   if condition = LIZARD
 * ```
 *
 * 아직 평가일이 도래하지 않은 차수는 판정값이 없으므로 호출부가 `EARLY`(정상
 * 조기상환)를 가정한다. 리자드 상환을 가정하려면 `LIZARD`를 명시한다.
 *
 * `LIZARD`인데 해당 차수의 `lizard_coupon_rate`가 없으면 **거부한다.** 원금만
 * 상환되는 리자드 변형은 `'0'`으로 표기하며 `null`로 표기하지 않는다(Q-04).
 * `null`을 0이나 `r`로 임의 대체하면 수령액이 실제와 어긋난다 — 전자는 과소,
 * 후자는 과대 추정이다. 어느 쪽이든 사용자가 잘못된 금액을 기대하게 된다.
 */
export function applicableCouponRate(params: {
  condition: RedeemingCondition
  /** 연쿠폰율 (소수 정규화) */
  annualCouponRate: DecimalInput
  /** 해당 차수의 리자드 쿠폰율 */
  lizardCouponRate?: DecimalInput | null
}): DecimalValue {
  if (params.condition === 'EARLY') return dec(params.annualCouponRate)

  if (params.lizardCouponRate == null) {
    throw new RangeError(
      '리자드 상환인데 해당 차수의 리자드 쿠폰율이 없다. ' +
        '원금상환형 리자드는 0으로 입력한다(DOC-007 §4.1).',
    )
  }
  return dec(params.lizardCouponRate)
}

/**
 * 예상 수령액 — DOC-007 §4.1
 *
 * ```
 * grossExpected(n) = P × ( 1 + r × (m × n) / 12 )
 * ```
 *
 * 리자드 상환을 가정하는 경우 `couponRate`에 해당 차수의 `lizard_coupon_rate`를
 * 주입한다. 쿠폰율 0이면 원금만 상환되는 변형이 표현된다(Q-04).
 */
export function grossExpected(params: {
  principal: DecimalInput
  /** 연쿠폰율 또는 리자드 쿠폰율 (소수 정규화) */
  couponRate: DecimalInput
  evaluationPeriodMonths: number
  roundNo: number
}): DecimalValue {
  assertPositiveInteger(params.evaluationPeriodMonths, '평가주기(개월)')
  assertPositiveInteger(params.roundNo, '차수')

  const elapsedMonths = dec(String(params.evaluationPeriodMonths)).times(
    dec(String(params.roundNo)),
  )

  return dec(params.principal).times(
    dec('1').plus(
      dec(params.couponRate).times(elapsedMonths).div(dec('12')),
    ),
  )
}

/**
 * 과세 금융소득 — DOC-007 §4.3, §4.4
 *
 * ```
 * if account_type = TAX_FREE:  0
 * elif 상환 완료:               redemptions.taxable_income
 * else:                        max(0, grossExpected(n) − P)
 * ```
 *
 * **음수가 될 수 없다**(절대 규칙 #8). ELS 손실은 다른 금융소득과 통산되지
 * 않으므로 손실 상환의 과세 금융소득은 음수가 아니라 0이다. 포트폴리오 손익은
 * `realizedPnl`로 별도 산출한다.
 */
export function taxableIncome(params: {
  accountType: AccountType
  principal: DecimalInput
  /** 상환 완료 시 증권사 확정값. 시스템 추정값으로 대체하지 않는다 (A-04) */
  redemption?: { taxableIncome: DecimalInput } | null
  /** 미상환 시 적용 차수의 예상 수령액 */
  expectedGross?: DecimalInput | null
}): DecimalValue {
  // 비과세 계좌는 종합과세 대상에서 제외된다. 확정값이 있어도 0이다
  if (params.accountType === 'TAX_FREE') return ZERO

  if (params.redemption != null) {
    // V-11·I-08이 상류에서 0 이상을 보장하지만, 절대 규칙 #8을 여기서도 지킨다
    return maxZero(dec(params.redemption.taxableIncome))
  }

  if (params.expectedGross == null) {
    throw new RangeError(
      '과세 금융소득을 산출할 수 없다. 상환 확정값 또는 예상 수령액이 필요하다.',
    )
  }

  return maxZero(dec(params.expectedGross).minus(dec(params.principal)))
}

/**
 * 포트폴리오 손익 — DOC-005 §8.5
 *
 * ```
 * realizedPnl = gross_amount − P
 * ```
 *
 * **음수가 가능하다.** 과세 금융소득과 분기하는 지점이므로 화면에서 두 값을
 * 별도 항목으로 표시한다(§4.4).
 */
export function realizedPnl(params: {
  grossAmount: DecimalInput
  principal: DecimalInput
}): DecimalValue {
  return dec(params.grossAmount).minus(dec(params.principal))
}

/** 소유자·연도 단위 포트폴리오 손익 합계. 손실이 이익을 상쇄한다. */
export function aggregateRealizedPnl(
  items: ReadonlyArray<{ grossAmount: DecimalInput; principal: DecimalInput }>,
): DecimalValue {
  return sum(items.map((item) => realizedPnl(item)))
}
