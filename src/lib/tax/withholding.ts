import {
  dec,
  truncateToUnit,
  type DecimalInput,
  type DecimalValue,
} from '@/lib/decimal'
import { DEFAULT_ROUNDING, type RoundingPolicy, type TaxConstants } from './types'

/**
 * 분리과세 원천징수 — DOC-007 §4.5 · §5.5 (P6 컷 6, DOC-010 AQ-67)
 *
 * ```
 * withholding = trunc( 과세 금융소득 × separate_taxation_rate )
 * ```
 *
 * ## 세 자리에 흩어져 있던 것을 모았다
 *
 * 같은 곱셈이 `comprehensive.ts`(비교과세의 `withheld(F)` — §5.5)와
 * `db/mutations/redemptions.ts`(상환 실적의 산출 — §5.4)에 **각자 적혀 있었고**,
 * §4.5의 차수별 세후가 세 번째를 만들 참이었다. `db/taxConstants.ts`의 머리글이
 * 적은 교훈이 그대로다 — 「사본을 만들면 두 사본이 갈리는 순간 상수 하나가 조용히
 * 사라진다」.
 *
 * **입력만 다르고 식은 같다.** §5.5는 `F`(소유자·연도 합계)를 넣고 §4.5는 한
 * 차수의 과세 금융소득을 넣는다. 그래서 인자 이름이 `financialIncome`이 아니라
 * `taxableIncome`이다 — 둘 다 「과세 금융소득」이며 집계 단위만 다르다.
 *
 * ## 요율이 아니라 **상수 묶음**을 받는다
 *
 * `TaxConstants`에는 `separateTaxationRate`(0.154)와
 * `separateTaxationIncomeTaxRate`(0.14)가 **둘 다** 있고 차이는 정확히
 * 지방소득세분이다. `rate: DecimalInput`으로 열어 두면 호출부가 둘 중 하나를
 * 고르게 되고, **잘못 고른 결과는 그럴싸한 숫자다** — 10% 과소 징수가 어느
 * 단언에도 걸리지 않고 지나간다. 고르는 일을 함수의 것으로 만든다.
 *
 * 원천징수액은 **지방소득세를 포함한 실제 징수액**이므로 0.154가 맞다
 * (DOC-007 §2의 상수 표 각주가 그 구분의 정본이다).
 *
 * ## 절사를 안에 둔다
 *
 * 두 기존 호출부가 이미 `truncateToUnit(…, DEFAULT_ROUNDING.unit)`을 각자 걸고
 * 있었다. 밖에 두면 넷째 호출부가 잊고, 그 어긋남은 원 단위 하나라 어느 단언에도
 * 걸리지 않는다. 단위는 RD-01이 미결이므로 정책을 주입받는다.
 *
 * ## 값 보존
 *
 * 식·상수·절사가 셋 다 종전과 같으므로 §5.5의 값이 달라지지 않는다 —
 * **TC-01~22가 그 사실의 회귀망이다**(절대 규칙 #1에 걸리는 변경이면 그 스위트가
 * 빨간불이 된다).
 */
export function separateTaxationWithholding(params: {
  /**
   * 과세 금융소득. 절대 규칙 #8에 따라 음수가 아니다 — 그 보장은 상류
   * (`taxableIncome`의 `maxZero` · I-08 · V-12)에 있고 여기서 다시 접지 않는다.
   * 접으면 「음수가 들어왔다」가 0으로 조용히 흡수되어 상류의 결함이 가려진다.
   */
  taxableIncome: DecimalInput
  constants: TaxConstants
  rounding?: RoundingPolicy
}): DecimalValue {
  const { rounding = DEFAULT_ROUNDING } = params

  return truncateToUnit(
    dec(params.taxableIncome).times(dec(params.constants.separateTaxationRate)),
    rounding.unit,
  )
}
