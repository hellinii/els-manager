import {
  dec,
  maxZero,
  truncateToUnit,
  ZERO,
  type DecimalInput,
  type DecimalValue,
} from '@/lib/decimal'
import { progressiveTax } from './brackets'
import {
  DEFAULT_ROUNDING,
  type RoundingPolicy,
  type TaxBracket,
  type TaxConstants,
} from './types'
import { separateTaxationWithholding } from './withholding'

/**
 * 금융소득종합과세 — DOC-007 §5
 *
 * 반환 필드는 DOC-011 §4.6 `TaxSummaryView.tax`와 1:1 대응한다.
 */
export type FinancialIncomeTaxResult = {
  /** `F > 종합과세 기준금액` */
  isComprehensive: boolean
  /** 방식①(분리 기준) 산출 소득세. 비교과세 미적용 시 `null` */
  method1: DecimalValue | null
  /** 방식②(종합 기준) 산출 소득세. 비교과세 미적용 시 `null` */
  method2: DecimalValue | null
  /** 금융소득 귀속세액(국세) */
  computedTax: DecimalValue
  /** 지방소득세 */
  localIncomeTax: DecimalValue
  /** 총세액 = 귀속세액 + 지방소득세 */
  totalTax: DecimalValue
  /** 원천징수액 */
  withheld: DecimalValue
  /** 추가납부 예상액 */
  additionalPayment: DecimalValue
  /** 최종 부담률 = 총세액 / F */
  effectiveRate: DecimalValue
}

export type FinancialIncomeTaxParams = {
  /** `F` — 해당 소유자·연도의 과세 금융소득 총액 */
  financialIncome: DecimalInput
  /** `A` — 금융소득 외 종합소득 과세표준. 미입력은 0으로 정규화한다 (E-03) */
  otherIncomeBase?: DecimalInput | null
  brackets: readonly TaxBracket[]
  constants: TaxConstants
  /** 세액 절사 정책. RD-01 미결이므로 주입받는다 */
  rounding?: RoundingPolicy
}

const ZERO_RESULT: FinancialIncomeTaxResult = {
  isComprehensive: false,
  method1: null,
  method2: null,
  computedTax: ZERO,
  localIncomeTax: ZERO,
  totalTax: ZERO,
  withheld: ZERO,
  additionalPayment: ZERO,
  effectiveRate: ZERO,
}

export function calculateFinancialIncomeTax(
  params: FinancialIncomeTaxParams,
): FinancialIncomeTaxResult {
  const { brackets, constants, rounding = DEFAULT_ROUNDING } = params

  const financialIncome = dec(params.financialIncome)
  // E-03 — `A` 미입력과 0의 결과가 동일해야 한다
  const otherIncomeBase =
    params.otherIncomeBase == null ? ZERO : dec(params.otherIncomeBase)

  const threshold = dec(constants.comprehensiveTaxationThreshold)
  const incomeTaxRate = dec(constants.separateTaxationIncomeTaxRate)
  const localRate = dec(constants.localIncomeTaxRate)

  // 절사 단위 검증을 조기에 수행한다. F ≤ 0 경로에서도 잘못된 정책은 오류다
  truncateToUnit(ZERO, rounding.unit)

  // E-02 — F ≤ 0이면 모든 세액이 0이다
  if (financialIncome.lte(0)) return ZERO_RESULT

  const isComprehensive = financialIncome.gt(threshold)

  let method1: DecimalValue | null = null
  let method2: DecimalValue | null = null
  let incomeTax: DecimalValue

  if (!isComprehensive) {
    // 분리과세로 종결한다. 비교과세식을 이 구간까지 확장하면 틀린다 —
    // 방식②는 기준금액까지를 항상 전액 과세한 것으로 계산하기 때문이다
    // (DOC-007 §5.2 "기준금액 이하의 조기 반환은 생략할 수 없다")
    incomeTax = financialIncome.times(incomeTaxRate)
  } else {
    const taxWithoutFinancialIncome = progressiveTax(otherIncomeBase, brackets)

    method1 = financialIncome
      .times(incomeTaxRate)
      .plus(taxWithoutFinancialIncome)

    method2 = threshold.times(incomeTaxRate).plus(
      progressiveTax(
        maxZero(financialIncome.minus(threshold)).plus(otherIncomeBase),
        brackets,
      ),
    )

    // 금융소득 귀속세액 = 전체 산출세액 − 금융소득이 없었을 때의 세액
    const computed = method1.gte(method2) ? method1 : method2
    incomeTax = computed.minus(taxWithoutFinancialIncome)
  }

  /**
   * 총세액을 1차 값으로 두고 지방소득세를 잔차로 구한다.
   *
   * DOC-007 §5.3이 `totalTax = 소득세 × (1 + 지방세율)`로 정의하므로 총세액을
   * 절사 기준으로 삼는다. 귀속세액과 지방소득세를 각각 절사한 뒤 더하면
   * 화면에 표시되는 세 값의 합이 총세액과 어긋날 수 있다.
   */
  const computedTax = truncateToUnit(incomeTax, rounding.unit)
  const totalTax = truncateToUnit(
    incomeTax.times(dec('1').plus(localRate)),
    rounding.unit,
  )
  const localIncomeTax = totalTax.minus(computedTax)

  /*
   * §5.5의 `withheld(F)`. 같은 식이 §4.5(차수별)와 §5.4(상환 실적 산출)에도
   * 있으므로 순수 함수 하나를 공유한다 — DOC-010 AQ-67. 여기서 상수 묶음을
   * 그대로 넘기는 것이 요점이다: 0.154와 0.14 중 고르는 일이 그 함수의 것이다.
   */
  const withheld = separateTaxationWithholding({
    taxableIncome: financialIncome,
    constants,
    rounding,
  })

  return {
    isComprehensive,
    method1,
    method2,
    computedTax,
    localIncomeTax,
    totalTax,
    withheld,
    // 이미 징수된 금액을 넘는 부분만 납부한다. 0이 정상인 구간이 있다 (§5.5)
    additionalPayment: maxZero(totalTax.minus(withheld)),
    // §5.4 — 평균 개념. 절사된 총세액 기준
    effectiveRate: totalTax.div(financialIncome),
  }
}
