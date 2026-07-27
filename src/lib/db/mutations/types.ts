import type { HealthInsuranceType } from '@/lib/tax'

/**
 * 변경 계약의 입력 타입 — DOC-011 §5가 정본이다
 *
 * **문서의 서명을 그대로 옮긴다.** 스키마 검증 도구에서 타입을 추론하지 않는
 * 이유가 이것이다(AQ-10) — 추론하면 정본이 둘이 되고 문서와 어긋나도 컴파일이
 * 통과한다. 여기서는 문서 → 타입 → 파서 순서이며 파서가 타입을 만들지 않는다.
 *
 * 금액·비율은 **문자열**이다(§2, W-04). `number`를 받으면 그 값은 이미 float64를
 * 경유했으므로 경계에서 막을 방법이 없다. 차수·개월수·연도는 개수를 세는 정수이므로
 * `number`를 그대로 쓴다(`lib/decimal.ts`가 그 구분을 이미 정했다).
 */

export type ProductInput = {
  name: string
  issuer?: string
  issueDate: string
  principal: string
  evaluationPeriodMonths: number
  totalRounds: number
  annualCouponRate: string
  kiBarrier?: string
  kiObservation?: 'CONTINUOUS' | 'CLOSING'
  accountType: 'GENERAL' | 'TAX_FREE'
  note?: string
  underlyings: UnderlyingInput[]
  schedules: ScheduleInput[]
}

export type UnderlyingInput = {
  assetId: string
  basePrice: string
  sequence: number
}

export type ScheduleInput = {
  roundNo: number
  evaluationDate: string
  barrier: string
  lizardBarrier?: string
  lizardCouponRate?: string
  lizardRequiresNoKi?: boolean
}

export type RedemptionInput = {
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo?: number
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax?: string
  isConfirmed: boolean
  note?: string
}

export type TaxProfileInput = {
  year: number
  otherIncomeBase: string
  otherFinancialIncome: string
  healthInsuranceType: HealthInsuranceType
}

export type ManualPriceInput = {
  assetId: string
  asOfDate: string
  price: string
}

export type AssetInput = {
  name: string
  assetType: 'STOCK' | 'INDEX' | 'ETF'
  market?: string
  currency: string
}

/** §5.8 `refreshPrices`의 반환 */
export type RefreshPricesResult = {
  succeeded: number
  failed: Array<{ assetId: string; assetName: string; reason: string }>
}
