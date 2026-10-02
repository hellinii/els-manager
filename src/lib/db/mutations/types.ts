import type { CouponOutcome, CouponPayout } from '@/lib/domain/coupon'
import type { ForeignCurrency, ProductCurrency } from '@/lib/domain/currency'
import type { HealthInsuranceType } from '@/lib/tax'
import type { FailureClass } from '@/lib/providers/types'

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
  /** 상품 통화 금액 — `currency`의 보조단위 이내(V-23). 파서가 고정 자릿수로 정규화한다 */
  principal: string
  /** 상품 통화 — 필수, 기본값 없음 (V-22 · DOC-011 §5.1 v4.9) */
  currency: ProductCurrency
  evaluationPeriodMonths: number
  totalRounds: number
  /** 월지급식이면 `'0'` — 수익은 전부 월수익 연쿠폰율에서 나온다 (V-08′ · DOC-002 DQ-11) */
  annualCouponRate: string
  /** 쿠폰 지급방식 — 필수, 기본값 없음 (V-25 · DOC-011 §5.1 v4.16) */
  couponPayout: CouponPayout
  /** 월수익 연쿠폰율(비율 문자열) — `MONTHLY`면 필수, `AT_REDEMPTION`이면 없다 (V-25) */
  monthlyCouponAnnualRate?: string
  /** 월수익 일정 — `MONTHLY`면 1..60행 (V-25 · V-26), `AT_REDEMPTION`이면 없다 */
  couponSchedules?: CouponScheduleInput[]
  kiBarrier?: string
  kiObservation?: 'CONTINUOUS' | 'CLOSING'
  accountType: 'GENERAL' | 'TAX_FREE'
  note?: string
  underlyings: UnderlyingInput[]
  schedules: ScheduleInput[]
}

/** 월수익 일정 한 행 (DOC-011 §5.1 · DOC-002 §4.13). 날짜는 칸의 값이고 산식은 입력 계층의 도구다 */
export type CouponScheduleInput = {
  couponNo: number
  evaluationDate: string
  paymentDate: string
  couponBarrier: string
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
  /** 부모 상품의 통화 — 자릿수는 부모 통화로 본다(V-23, §5.4) */
  grossAmount: string
  /** 과세 축 — 언제나 원화 정수(A-04 · M-08) */
  taxableIncome: string
  withholdingTax?: string
  /** 적용 환율 — 참고값, 외화 상품에만(V-24). 어떤 계산에도 쓰지 않는다 */
  exchangeRate?: string
  isConfirmed: boolean
  note?: string
}

/**
 * §5.11 기실현 등재 — 상품과 상환을 한 입력으로 받는다
 *
 * `ProductInput` + `RedemptionInput`의 교집합이 아니라 **거래내역 한 줄**이다.
 * 그래서 없는 것이 둘이다 —
 *
 * | 없는 것 | 왜 |
 * |---|---|
 * | 계약 조건 여섯(발행일·연쿠폰율·평가주기·기초자산·차수·배리어·KI) | 거래내역에 없다. 지어내지 않는다(DOC-002 D-07) |
 * | `roundNo` | 일정이 0건이라 실재하는 차수가 없다(I-13). **위반을 표현할 수 없게** 만드는 것이 V-13에 예외를 두는 것보다 낫다 |
 *
 * 두 타입을 합성(`ProductInput & RedemptionInput`)하지 않는 이유가 그것이다 —
 * 합성하면 없는 필드를 `Omit`으로 깎아 내야 하고, 그 목록이 계약의 정의가 아니라
 * **차집합의 부산물**이 된다.
 */
export type RealizedProductInput = {
  name: string
  issuer?: string
  principal: string
  /** 상품 통화 — 필수, 기본값 없음(V-22). `principal`·`grossAmount`의 자릿수가 이것을 따른다 */
  currency: ProductCurrency
  /** 쿠폰 지급방식 — 필수, 기본값 없음(V-25). 기실현은 지급방식 하나만 받는다 — 율도 일정도 없다(D-07) */
  couponPayout: CouponPayout
  accountType: 'GENERAL' | 'TAX_FREE'
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax?: string
  /** 적용 환율 — 참고값, 외화 상품에만(V-24) */
  exchangeRate?: string
  isConfirmed: boolean
  note?: string
}

/**
 * §5.14 월수익 한 달의 지급 기록 (DOC-005 「월수익 지급 기록」 · DOC-002 §4.14 · P8 컷 b2). `RedemptionInput`의 짝이다.
 *
 * 금액은 상환과 같은 두 부류다(M-08) — `grossAmount`는 **부모 상품의** 통화(V-23), 과세 둘은 원화 정수(V-11 · V-19).
 * 지급(`PAID`)은 지급일 · 세전 · 과세가 필수이고 미지급(`UNPAID`)은 그 다섯이 없다(V-28 · I-26).
 */
export type CouponPaymentInput = {
  /** 월수익 순번. `FULL`이면 일정에 있는 순번, 기실현이면 `null` (V-27) */
  couponNo: number | null
  outcome: CouponOutcome
  /** `PAID`면 필수 · `UNPAID`면 없다 (V-28). 귀속연도의 기준이다 */
  paymentDate?: string
  grossAmount?: string
  taxableIncome?: string
  /** `PAID`이고 없으면 계약이 지급일 연도의 분리과세율로 채운다(§5.14) */
  withholdingTax?: string
  /** 적용 환율(참고) — 외화 상품의 `PAID`만 (V-24 ⓐ). 어떤 계산에도 쓰지 않는다 */
  exchangeRate?: string
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

/**
 * §5.13 — 수동 환율 (P8 컷 a3). `source`·`provider`는 입력이 아니다 — 계약이 `MANUAL`·`null`로 박는다.
 * 금액이 아니라 **환율**이다(1단위 외화당 원 · 소수 6자리 — Q-07′). 숫자로 받지 않는다(절대 규칙 #2)
 */
export type ExchangeRateInput = {
  currency: ForeignCurrency
  asOfDate: string
  rate: string
}

export type AssetInput = {
  name: string
  assetType: 'STOCK' | 'INDEX' | 'ETF'
  market?: string
  currency: string
}

/**
 * §5.12 공급자 심볼 매핑 — SCR-302.
 *
 * ★ `providerSymbol: null`이 «해제»다 — §5.9 `setKiTouched`가 같은 형태이며 근거도 같다:
 * 좌표(`assetId`·`provider`)가 하나이고 화면의 조작도 하나(그 칸을 비우는 것)다.
 * 둘로 쪼개면 계약 수가 13에서 14가 되고 `MutationName`을 세는 원장이 두 번 움직인다.
 */
export type ProviderSymbolInput = {
  assetId: string
  provider: string
  providerSymbol: string | null
}

/** §5.8 `refreshPrices`의 반환 */
export type RefreshPricesResult = {
  succeeded: number
  /** 기준일 행이 이미 있어 건너뛴 수 (CR-05). v3.6 — 아래 ★ */
  skipped: number
  /** 공급자 매핑이 없는 수. **실패가 아니다** (ADR-007) */
  unmapped: number
  failed: Array<{
    assetId: string
    assetName: string
    reason: string
    /** 두 부류가 층을 넘어 살아남는 자리 — 화면이 문구를 파싱하지 않게 한다 */
    failure: FailureClass
  }>
}

/**
 * ★ `skipped`·`unmapped`가 없으면 화면이 「정상」과 「고장」을 가르지 못한다 (DOC-011 §5.8).
 *
 * `{succeeded, failed}`만으로는 「이미 최신이다」와 「아무 일도 하지 못했다」가 **둘 다**
 * `succeeded: 0, failed: []`다. 그리고 CR-05가 뒤집힌 뒤로 그것이 SCR-302의 **흔한** 경우다 —
 * 배치가 14:00~14:59 KST에 돌고 사용자는 그 뒤에 누른다.
 */
export type CronResult = {
  /** ISO 8601. **인자로 받는다** — 순수 모듈이 시계를 읽지 않는다 */
  executedAt: string
  targetCount: number
  succeeded: number
  skipped: number
  unmapped: number
  failed: Array<{ assetId: string; reason: string; failure: FailureClass }>
}
