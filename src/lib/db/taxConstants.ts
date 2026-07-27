import type { TaxConstants } from '@/lib/tax/types'

/**
 * `tax_constants`의 키 ↔ `TaxConstants` 필드 대응 — DOC-002 §4.10이 정본
 *
 * **이 파일은 `@/lib/tax/types` 외에 아무것도 import하지 않는다.** 그래서 상시
 * 스위트(`tests/seed/`)와 조회 계층이 같은 매핑을 공유하면서도 그 스위트가
 * supabase 클라이언트를 끌어오지 않는다. P2까지는 이 매핑이 테스트 픽스처에만
 * 있었고, 조회 계층이 자기 사본을 만들면 **두 사본이 갈리는 순간 상수 하나가
 * 조용히 사라진다** — 그래서 정본을 프로덕션 쪽으로 옮겼다.
 *
 * **단순 snake_case 변환이 아니다.** `employeeNonWageThreshold`의 DB 키는
 * `employee_non_wage_income_threshold`로 `income`이 들어간다. DOC-007 §2 표가
 * 의도적으로 기록한 대응이므로 자동 변환을 쓰지 않는다 — 자동 변환이면 이 한
 * 건이 조용히 어긋나고 직장가입자 산정 소득(DOC-007 §6.1)이 상수를 못 찾는다.
 *
 * `satisfies`가 양방향 완전성을 강제한다 — 키가 빠지면 타입 오류, 없는 키를
 * 적으면 초과 속성 오류다.
 */
export const TAX_CONSTANT_KEY_MAP = {
  separateTaxationRate: 'separate_taxation_rate',
  separateTaxationIncomeTaxRate: 'separate_taxation_income_tax_rate',
  comprehensiveTaxationThreshold: 'comprehensive_taxation_threshold',
  localIncomeTaxRate: 'local_income_tax_rate',
  longTermCareRate: 'long_term_care_rate',
  healthInsuranceRate: 'health_insurance_rate',
  regionalIncomeThreshold: 'regional_income_threshold',
  employeeNonWageThreshold: 'employee_non_wage_income_threshold', // ★ 단순 변환 아님
  dependentIncomeThreshold: 'dependent_income_threshold',
} as const satisfies Record<keyof TaxConstants, string>

/**
 * 키/값 행을 `TaxConstants`로 조립한다. **하나라도 없으면 던진다.**
 *
 * 기본값을 넣지 않는 이유: 요율이 빠진 채로 계산되면 보험료가 0이나 과소로
 * 나오고 화면은 정상으로 보인다. 절대 규칙 #5(요율을 코드에 두지 않는다)의
 * 반대편 위험이다 — 조회하지만 없을 때 조용히 넘어가면 하드코딩과 같은 결과가 된다.
 */
export function toTaxConstants(
  rows: ReadonlyArray<{ key: string; value: string }>,
  year: number,
): TaxConstants {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const missing: string[] = []

  const pick = (dbKey: string): string => {
    const value = byKey.get(dbKey)
    if (value == null) {
      missing.push(dbKey)
      return '0'
    }
    return value
  }

  const constants: TaxConstants = {
    separateTaxationRate: pick(TAX_CONSTANT_KEY_MAP.separateTaxationRate),
    separateTaxationIncomeTaxRate: pick(
      TAX_CONSTANT_KEY_MAP.separateTaxationIncomeTaxRate,
    ),
    comprehensiveTaxationThreshold: pick(
      TAX_CONSTANT_KEY_MAP.comprehensiveTaxationThreshold,
    ),
    localIncomeTaxRate: pick(TAX_CONSTANT_KEY_MAP.localIncomeTaxRate),
    healthInsuranceRate: pick(TAX_CONSTANT_KEY_MAP.healthInsuranceRate),
    longTermCareRate: pick(TAX_CONSTANT_KEY_MAP.longTermCareRate),
    regionalIncomeThreshold: pick(TAX_CONSTANT_KEY_MAP.regionalIncomeThreshold),
    employeeNonWageThreshold: pick(TAX_CONSTANT_KEY_MAP.employeeNonWageThreshold),
    dependentIncomeThreshold: pick(TAX_CONSTANT_KEY_MAP.dependentIncomeThreshold),
  }

  if (missing.length > 0) {
    throw new Error(
      `${year}년 세율 상수가 누락되었다: ${missing.join(', ')} (DOC-002 §4.10). ` +
        '기본값으로 대체하지 않는다 — 보험료·세액이 조용히 과소 산출된다.',
    )
  }
  return constants
}
