import { ZERO, dec, type DecimalInput, type DecimalValue } from '@/lib/decimal'

import { aggregateFinancialIncome, netProceeds } from './aggregate'
import { calculateFinancialIncomeTax } from './comprehensive'
import { calculateHealthInsurance } from './healthInsurance'
import type {
  HealthInsuranceType,
  RoundingPolicy,
  TaxBracket,
  TaxConstants,
} from './types'

/**
 * 다년도 누적과 잔여 원금 — DOC-007 §7.5
 *
 * ## 배타적 분할이 **한 필드**에서 나온다
 *
 * `redeemedBy(item, Y) ⟺ attributionYear != null && attributionYear <= Y`이므로 유량
 * (`cumulativeNet`)과 저량(`remainingPrincipal`)이 **같은 필드를 읽는다.** 두 곳이
 * 각자 판정하면 서로 다른 해를 골라 §7.5의 분할이 깨지고 `cumulativeAssets`가
 * 조용히 틀린다 — 그 오류는 화면에서 「합계가 안 맞는다」로만 보인다.
 *
 * 네 부류가 전부 닫힌다.
 *
 * | `attributionYear` | `cumulativeNet(Y)` | `remainingPrincipal(Y)` |
 * |---|---|---|
 * | `Y₀ ≤ a ≤ Y` | 들어간다 (그 해 한 번) | — |
 * | `a > Y` | — | 들어간다 |
 * | `a < Y₀` | — | — |
 * | `null` | — | 들어간다 (전 연도) |
 *
 * 셋째 줄이 이름의 근거다 — 그래서 「총자산」이 아니라 **누적** 자산이다(§7.5).
 * 넷째 줄이 적용 차수를 정할 수 없는 상품이며 **배제하지 않는 것이 결정이다**(그
 * 원금이 화면에서 증발하지 않게).
 *
 * ## 연도마다 키를 명시해 집계한다
 *
 * `aggregateFinancialIncomeByOwnerYear`(§7.1의 `groupByOwnerYear`)를 쓰지 않는다.
 * 이유가 둘이다.
 *
 * 1. **그 함수는 섞인 입력을 거부하지 않고 나눈다** — 분할은 구조적으로 옳아지지만
 *    귀속연도 산출의 오프바이원 같은 **버그를 잡지 못한다.** 반면
 *    `aggregateFinancialIncome`은 키를 명시 인자로 받고 다른 키의 항목이 섞이면
 *    `RangeError`로 거부한다(§7.1의 두 겹 방어).
 * 2. **항목 없는 연도의 행을 만들지 않는다** — 전망은 상환이 없는 해에도 잔여 원금과
 *    누적 행이 필요하므로 연도 목록이 항목이 아니라 **구간**에서 와야 한다.
 *
 * ## 순수 모듈이다
 *
 * 세율·상수·절사 정책을 전부 인자로 받는다(절대 규칙 #5, DEP-03). `lib/db`를 모르고
 * 행 타입도 모른다 — 조회 계층이 행을 `ForecastItem`으로 옮긴 뒤 부른다. 그래서 §7.5의
 * 검산이 DB 없는 상시 스위트에서 돈다.
 */

/**
 * 전망의 입력 한 항목 = 상품 하나.
 *
 * `attributionYear`·`gross`·`taxableIncome`은 **이미 판정·산출된 값**이다(조회 계층의
 * `attributionOf`와 `lib/domain`의 `grossExpected`·`taxableIncome`이 낸다). 이 모듈은
 * 그것을 다시 계산하지 않는다 — 계산하면 적용 차수 판정이 두 곳에 생긴다.
 */
export type ForecastItem = {
  /** 투자원금. 상환되지 않은 해의 `remainingPrincipal`에 들어간다 */
  principal: DecimalInput
  /**
   * 귀속연도. **`null`이면 적용 차수를 정할 수 없다** — 어느 해에도 상환되지 않는
   * 것으로 취급하며 전 연도의 잔여 원금에 남는다(§7.5).
   */
  attributionYear: number | null
  /** 세전 실수령액. **원금 반환분을 포함한다** — 배타 분할의 전제다(§4.1) */
  gross: DecimalInput
  /** 과세 금융소득. 계좌유형·손실 규칙이 이미 적용된 값 */
  taxableIncome: DecimalInput
  /** 적용 차수 가정에 의존하는가 (미상환 추정) */
  isEstimated: boolean
}

/** 한 연도에 적용할 세법·프로필. 연도마다 다를 수 있으므로 행별로 받는다 */
export type ForecastYearInput = {
  year: number
  /** 적용된 세율·상수의 연도. `year`와 다르면 근사다 */
  taxLawYear: number
  brackets: readonly TaxBracket[]
  constants: TaxConstants
  /** `A` — 금융소득 외 종합소득 과세표준 */
  otherIncomeBase: DecimalInput
  /** ELS 외 금융소득 */
  otherFinancialIncome: DecimalInput
  subscriberType: HealthInsuranceType
  /** 적용한 과세 프로필의 연도. `null`이면 미입력 폴백이다 (DOC-011 §4.7 LOCF) */
  profileYear: number | null
}

export type ForecastYear = {
  year: number
  taxLawYear: number
  profileYear: number | null
  grossProceeds: DecimalValue
  financialIncome: DecimalValue
  /** 종합과세 기준금액 대비. 양수면 초과 */
  thresholdGap: DecimalValue
  isComprehensive: boolean
  effectiveRate: DecimalValue
  additionalTax: DecimalValue
  /** 건강보험료 + 장기요양보험료 (DOC-005 §5 「보험료 합계」) */
  totalInsurance: DecimalValue
  netProceeds: DecimalValue
  cumulativeNet: DecimalValue
  remainingPrincipal: DecimalValue
  /** **건보료 차감 전이다** — §7.4가 세액만 반영하므로 그 누계도 같은 기준이다 */
  cumulativeAssets: DecimalValue
  hasEstimates: boolean
}

/** `redeemedBy(item, Y)` — §7.5. **두 항이 이 함수 하나를 읽는다.** */
function redeemedBy(item: ForecastItem, year: number): boolean {
  return item.attributionYear != null && item.attributionYear <= year
}

function sum(values: readonly DecimalValue[]): DecimalValue {
  return values.reduce((acc, v) => acc.plus(v), ZERO)
}

/**
 * 전망 구간의 연도별 행 — §7.5
 *
 * `years`는 **오름차순 연속**이어야 한다(호출부가 `[Y₀, Y₀ + n − 1]`을 만든다).
 * `cumulativeNet`이 앞 연도의 누계에 의존하므로 순서가 뒤섞이면 값이 틀린다 —
 * 그것을 규율로 두지 않고 **여기서 거부한다.**
 */
export function forecastYears(params: {
  ownerId: string
  items: readonly ForecastItem[]
  /** 연도별 세법·프로필. 오름차순 연속 */
  years: readonly ForecastYearInput[]
  rounding?: RoundingPolicy
}): ForecastYear[] {
  assertAscendingConsecutive(params.years)

  const rows: ForecastYear[] = []
  let cumulativeNet = ZERO

  for (const input of params.years) {
    const { year } = input

    // ── 그 해에 귀속된 항목 ────────────────────────────────────────────────
    const attributed = params.items.filter((item) => item.attributionYear === year)

    // 키를 명시 인자로 넘긴다 — 섞인 항목이 있으면 `RangeError`로 거부된다(§7.1).
    const income = aggregateFinancialIncome({
      key: { ownerId: params.ownerId, year },
      items: attributed.map((item) => ({
        ownerId: params.ownerId,
        year,
        taxableIncome: item.taxableIncome,
      })),
      otherFinancialIncome: input.otherFinancialIncome,
    })

    const tax = calculateFinancialIncomeTax({
      financialIncome: income.financialIncome,
      otherIncomeBase: input.otherIncomeBase,
      brackets: input.brackets,
      constants: input.constants,
      ...(params.rounding == null ? {} : { rounding: params.rounding }),
    })

    const insurance = calculateHealthInsurance({
      financialIncome: income.financialIncome,
      subscriberType: input.subscriberType,
      constants: input.constants,
      ...(params.rounding == null ? {} : { rounding: params.rounding }),
    })

    const grossProceeds = sum(attributed.map((item) => dec(item.gross)))

    // ── 유량 ────────────────────────────────────────────────────────────────
    // 건강보험료는 차감하지 않는다 — §7.4의 정의이며 표의 별 열로 보여 준다.
    const net = netProceeds({
      income,
      grossTotal: grossProceeds,
      effectiveRate: tax.effectiveRate,
    })
    cumulativeNet = cumulativeNet.plus(net)

    // ── 저량 ────────────────────────────────────────────────────────────────
    // **측정 시점이 연도 말이다.** 기준일에서 재면 `asOf` 이후 같은 해에 상환되는
    // 상품이 위 유량과 여기 양쪽에 잡혀 그 원금만큼 과대해진다(§7.5의 검산).
    const remaining = params.items.filter((item) => !redeemedBy(item, year))
    const remainingPrincipal = sum(remaining.map((item) => dec(item.principal)))

    rows.push({
      year,
      taxLawYear: input.taxLawYear,
      profileYear: input.profileYear,
      grossProceeds,
      financialIncome: income.financialIncome,
      thresholdGap: income.financialIncome.minus(
        dec(input.constants.comprehensiveTaxationThreshold),
      ),
      isComprehensive: tax.isComprehensive,
      effectiveRate: tax.effectiveRate,
      additionalTax: tax.additionalPayment,
      totalInsurance: insurance.total,
      netProceeds: net,
      cumulativeNet,
      remainingPrincipal,
      cumulativeAssets: cumulativeNet.plus(remainingPrincipal),
      // 두 축 중 **행 축**이다(§7.5) — 화면 전체 고지는 화면이 따로 한다.
      // 그 해에 상환이 가정된 항목이 있거나, 연도 말에 미상환 항목이 남아 있으면
      // 이 행의 값이 적용 차수 가정에 의존한다.
      hasEstimates:
        attributed.some((item) => item.isEstimated) ||
        remaining.some((item) => item.isEstimated || item.attributionYear == null),
    })
  }

  return rows
}

function assertAscendingConsecutive(years: readonly ForecastYearInput[]): void {
  if (years.length === 0) {
    throw new RangeError('전망 구간이 비어 있다. 연도를 하나 이상 넘긴다 (DOC-007 §7.5).')
  }

  for (let i = 1; i < years.length; i += 1) {
    const previous = years[i - 1]!.year
    const current = years[i]!.year
    if (current !== previous + 1) {
      throw new RangeError(
        `전망 구간은 오름차순 연속이어야 한다: ${previous} 다음이 ${current}다. ` +
          'cumulativeNet이 앞 연도의 누계에 의존하므로 순서가 뒤섞이면 값이 틀린다(DOC-007 §7.5).',
      )
    }
  }
}
