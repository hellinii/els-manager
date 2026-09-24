import type { ListedAsset } from './parse'
import type { LookupOutcome } from '../types'

/**
 * 키움 상품 조건 원천의 **타입 전부** — DOC-010 ADR-009 · DOC-011 §4.10
 *
 * ## 값은 전부 «페이지의 단위»다
 *
 * 백분율은 `'85'`이지 `0.85`가 아니다. `numeric(6,4)` 비율로 바꾸는 것과 누적 수익률에서
 * 연 쿠폰율을 유도하는 것(`r = 누적 × 12 / (m × n)`)은 **사상 층**(`lib/forms`)의 일이다.
 * 이 층이 단위를 바꾸면 「어디서 100으로 나눴는가」가 두 층에 흩어진다.
 *
 * ## 금액·비율은 문자열이다 (절대 규칙 #2)
 *
 * 검증된 토큰에서 쉼표만 지운 원문이다. `Decimal`을 왕복시키지 않는다 — 왕복은 지수 표기와
 * 뒤 0 처리를 끌어들이고, 이 층의 약속은 「페이지가 적은 그대로」다.
 */

/** 백분율 토큰 — `'85'` · `'16.05'` · `'32.10'`. 소수 둘째 자리까지 (`terms-endpoints.ts` `DISPLAY_SCALE`) */
export type PctString = string
/** 가격 토큰 — 쉼표를 지운 원문. `'317000'` · `'128.3325'` */
export type PriceString = string
/** `YYYY-MM-DD` — 실재하는 날짜만 */
export type IsoDate = string

/** 사다리의 한 계단. `75(L50)`이면 `{ barrierPct: '75', lizardPct: '50' }` */
export type LadderStep = { barrierPct: PctString; lizardPct: PctString | null }

/**
 * `상환조건` 자유 문장을 푼 것 — `ladder.ts`. **전부 선택적이다**: 문장에 없으면 `null`·`false`.
 *
 * 헤더(팝업)와 목록(es020 `type_cntn`)이 **같은 함수**를 지난다. 둘이 다를 수 있고(⑩)
 * 정본은 팝업이다.
 */
export type KiwoomLadder = {
  /** `(85-85-80)`의 계단. 마지막 계단이 **만기** 상환조건이다. 없거나 둘 이상이면 `null` */
  steps: LadderStep[] | null
  /** `KI35`·`25KI`의 비율 */
  kiPct: PctString | null
  /** `NoKI`·`NO KI` */
  noKi: boolean
  /** 비율 없는 맨 `KI` — EM2048 목록의 `…) KI`. 비율을 알 수 없다 */
  kiUnspecified: boolean
  /** KI 표기가 서로 모순된다(`NoKI`와 `KI35`가 함께 · 비율이 둘) */
  kiConflict: boolean
  /** `리자드` 낱말이 있다(`리자드형`·`★리자드1배★`) */
  lizard: boolean
  /** `리자드N배`의 N. `리자드형`처럼 배수를 적지 않으면 `null` */
  lizardMultiple: number | null
  /** `월지급` 낱말이 있다 */
  monthly: boolean
  /** `월지급배리어 50` */
  monthlyBarrierPct: PctString | null
  /** `달러청약` */
  dollar: boolean
  /** `3년/ 6개월` → 36 · `만기2년` → 24 */
  tenorMonths: number | null
  /** `3년/ 6개월` → 6 */
  periodMonths: number | null
  /** `조기상환기회 총5회` — 계단이 없는 옛 표기(E00795) */
  earlyChances: number | null
  /** 어느 규칙에도 맞지 않은 낱말. **보고만 하고 실패시키지 않는다** */
  unrecognized: string[]
}

/** es020 검색 결과 한 행. **표시와 링크용**이다 — 정본은 상세 팝업이다 */
export type KiwoomProductCandidate = {
  productCode: string
  isin: string | null
  name: string
  /** `(\d+)[회호]$` — 「회차」다(차수가 아니다, DOC-005). 정확 일치 정렬은 화면의 일이다 */
  roundNumber: string | null
  issueDate: IsoDate | null
  maturityDate: IsoDate | null
  subscriptionStart: IsoDate | null
  subscriptionEnd: IsoDate | null
  ladderText: string
  ladder: KiwoomLadder
  headlineText: string
  headlineAnnualPct: PctString | null
  underlyingNames: string[]
  currency: string | null
  monthlyPay: boolean
  redeemed: boolean
}

/**
 * 조기상환 평가정보 한 행.
 *
 * `3-1`·`3-2`는 같은 차수 3의 두 행이다 — `-2`가 **리자드** 행이고 배리어가 낮다.
 */
export type KiwoomRound = {
  label: string
  round: number
  variant: 1 | 2 | null
  evaluationDate: IsoDate
  paymentDate: IsoDate
  /** ★ **누적**이다 — 연율이 아니다. E04000 1차 `16.05` = 연 32.10% × 6/12 (DOC-005 키움 「수익률」) */
  cumulativeYieldPct: PctString
  /** 조기상환 배리어(상환조건 %) */
  barrierPct: PctString
  /** 자산 순서와 같다. 청약 중에는 행 자체가 없다 */
  barrierPrices: PriceString[]
}

/**
 * 만기상환 평가정보.
 *
 * ★ 필드 이름이 차수 행과 **같다**(`barrierPct`·`cumulativeYieldPct`) — 앱은 만기를
 * `redemption_schedules`의 **마지막 행**으로 저장하기 때문이다(DOC-005: 만기 = 마지막 차수의
 * 평가일). 다만 이 `barrierPct`는 조기상환 배리어가 아니라 **만기 상환조건**이다 — 수식어 없는
 * 「배리어」로 부르지 않는다(DOC-005 §8.2). 사상 층이 그 행의 `barrier`로 옮긴다.
 */
export type KiwoomMaturity = {
  /** 사흘 평균이면 셋(DQ-10). 엄격히 증가한다 */
  evaluationDates: IsoDate[]
  paymentDate: IsoDate
  cumulativeYieldPct: PctString
  barrierPct: PctString
  /** 청약 중에는 `null`(가격이 `0`으로 온다 — ②) */
  barrierPrices: (PriceString | null)[]
}

export type KiwoomAssetTerms = {
  /** 기초자산정보 표의 이름 — 헤더의 이름과 다를 수 있다(⑪) */
  name: string
  /** 해외기초자산 정보 표의 거래소 행(⑯). 읽을 수 없으면 `null` */
  ticker: string | null
  /** 최초기준가격. **`0`은 `null`이다** — `'0'`은 「형식은 정상이고 값만 거짓」이다 */
  basePrice: PriceString | null
  /** `0`이면 `null`. 노낙인인지 미확정인지는 이 칸이 아니라 `ladder`·`status`가 말한다 */
  kiPrice: PriceString | null
}

export type KiwoomDocumentKind = 'KEY' | 'PROSPECTUS' | 'SIMPLE' | 'GUIDE'

export type KiwoomDocument = {
  kind: KiwoomDocumentKind
  /** `data-filenm` 원문 — 한글일 수 있다 */
  fileName: string
  /** `documentBase + encodeURIComponent(fileName)` */
  url: string
}

/**
 * - `ISSUED` — 기준가격이 정해졌다
 * - `PRE_ISSUANCE` — 기준가격이 **전부** `0`이고 조기상환 표가 비었다. **날짜로 가르지 않는다**(②)
 */
export type KiwoomTermsStatus = 'ISSUED' | 'PRE_ISSUANCE'

export type KiwoomTermsHeader = {
  headlineText: string | null
  /** `최대 연 32.10%` → `'32.10'` */
  headlineAnnualPct: PctString | null
  ladderText: string
  /** 헤더의 이름 목록 — 표의 이름과 다를 수 있다(⑪) */
  underlyingNames: string[]
  maxLossText: string | null
  issueDate: IsoDate
  maturityDate: IsoDate
  tenorText: string
  subscription: { start: IsoDate; end: IsoDate } | null
  redeemedText: string | null
}

export type KiwoomProductTerms = {
  productCode: string
  name: string
  status: KiwoomTermsStatus
  header: KiwoomTermsHeader
  /** `header.ladderText`를 푼 것 — 팝업이 정본이다 */
  ladder: KiwoomLadder
  assets: KiwoomAssetTerms[]
  /** 청약 중에는 `[]` */
  rounds: KiwoomRound[]
  /** `null` = 구획이 **없다**(옛 상품, ③). 실패가 아니다 */
  maturity: KiwoomMaturity | null
  documents: KiwoomDocument[]
  /** 공지 `<tr data-sqno>` — 뒤의 공지 조각을 위해 싣는다 */
  noticeIds: string[]
  /** 같은 상품의 es020 행 — 월지급·외화·ISIN. **최선 노력**이며 없어도 조건은 실패하지 않는다 */
  listing: KiwoomProductCandidate | null
  listingMiss: 'NOT_FOUND' | 'CALL_FAILED' | null
}

/**
 * 대조가 낸 불일치 하나 — `terms-check.ts`.
 *
 * ★ **사용자 문구를 담지 않는다.** 판별값(`kind`)과 두 값만 싣고 문장은 폼 층이 만든다 —
 * 문장을 여기서 만들면 용어 사전(DOC-005)의 표준 용어가 두 층에 흩어진다.
 */
export type TermsDiscrepancyKind =
  /** 사다리에 계단이 없다(`조기상환기회 총5회`) — 표의 배리어에 두 번째 증인이 없다 */
  | 'LADDER_STEPS_ABSENT'
  /** 계단 수 ≠ 조기상환 차수 + 1(만기) */
  | 'LADDER_STEP_COUNT'
  /** 계단 ≠ 표의 상환조건 — E03060 */
  | 'LADDER_BARRIER'
  /** `(Lxx)` 계단과 `n-2` 행이 짝이 맞지 않는다 */
  | 'LIZARD_POSITION'
  /** `n-2` 행 수익률 ≠ 배수 × 정확한 `n` 차 누적 수익률 */
  | 'LIZARD_MULTIPLE'
  /** 리자드 행이 있는데 배수가 적혀 있지 않다 — 표의 값만 있다(NOTE) */
  | 'LIZARD_MULTIPLE_UNSTATED'
  /** KI 비율을 알 수 없다(맨 `KI` · 표기 없음) */
  | 'KI_PCT_UNKNOWN'
  /** KI 표기가 모순된다 */
  | 'KI_CONFLICT'
  /** KI 가격 ≠ 기준가 × KI 비율(표시 절사) · 노낙인인데 KI 가격이 있다 */
  | 'KI_PRICE'
  /** 배리어 가격 ≠ 기준가 × 상환조건(표시 절사) */
  | 'BARRIER_PRICE'
  /** 헤드라인 연 수익률을 읽지 못했다 */
  | 'HEADLINE_UNKNOWN'
  /** 평가 주기를 알 수 없다 */
  | 'PERIOD_UNKNOWN'
  /** 만기 개월 ≠ 주기 × (차수 + 1) */
  | 'TENOR'
  /** 누적 수익률 ≠ 연 수익률 × 경과 개월 / 12 (표시 절사) */
  | 'CUMULATIVE_YIELD'
  /**
   * 월지급식 — **거부**(DOC-005 §월지급식 · DOC-008 SCR-204). 차수별 수익률이 전부 0이라(⑨)
   * 누적 수익률 대조도 하지 않는다 — 쿠폰이 투자설명서에만 있다
   */
  | 'MONTHLY_PAY'
  /**
   * 외화 상품(`달러청약` · 목록 통화 ≠ `KRW`) — **거부**(DOC-008 SCR-204). `expected`는 `'KRW'`,
   * `actual`은 목록의 통화 코드다 — 목록이 없으면 `null`이고 사다리의 `달러청약`이 유일한 증인이다
   */
  | 'FOREIGN_CURRENCY'
  /**
   * KI 배리어 ≥ 리자드 배리어 — **거부**(DOC-002 DQ-09). 불러오기가 `lizard_requires_no_ki`를
   * 켜는 근거(K < L이면 T ⊆ A_t)가 성립하지 않는다. `expected` = L, `actual` = K
   */
  | 'KI_NOT_BELOW_LIZARD'
  /** 헤더 기초자산 개수 ≠ 표의 자산 개수 */
  | 'HEADER_ASSET_COUNT'
  /** 헤더 기초자산명 ≠ 표의 자산명(NOTE — ⑪) */
  | 'HEADER_ASSET_NAME'
  /**
   * 만기 구획이 없다(③) — **거부**(DOC-008 SCR-204). 만기는 `redemption_schedules`의 마지막
   * 행인데 그 평가일·상환조건·수익률이 페이지에 없다. 마지막 계단도 대조하지 못한다
   */
  | 'MATURITY_ABSENT'
  /** 만기 상환지급일 ≠ 헤더 만기일(NOTE) */
  | 'MATURITY_PAYMENT_DATE'
  /** 목록 발행일 ≠ 팝업 발행일 */
  | 'LISTING_ISSUE_DATE'
  /** 목록 만기일 ≠ 팝업 만기일 */
  | 'LISTING_MATURITY_DATE'
  /** 목록 사다리 문장 ≠ 팝업 사다리 문장(NOTE — ⑩) */
  | 'LISTING_LADDER_TEXT'

export type TermsDiscrepancy = {
  kind: TermsDiscrepancyKind
  /**
   * `BLOCKING`이 하나라도 있으면 폼 층이 채우지 않는다 — DOC-008 SCR-204 「거부」 중 **이 페이지만으로
   * 판정되는 것은 전부 여기서 `BLOCKING`이 된다**(`terms-check.ts` 머리 주석의 대응표). 역은
   * 아니다: 앱의 평가일 산식과의 대조는 사상 층이 더한다
   */
  severity: 'BLOCKING' | 'NOTE'
  /** 차수 라벨(`'3-2'`) 또는 `'MATURITY'` */
  round?: string
  /** 자산명(표의 이름) */
  asset?: string
  expected: string | null
  actual: string | null
}

/**
 * 조건 원천 — `createKiwoomProductSource`가 만든다.
 *
 * 셋 다 **던지지 않는다.** 실패는 `LookupOutcome`의 값이다.
 */
export interface KiwoomProductSource {
  /** 청약 종료 상품의 이름 부분 일치 검색 (es020) */
  searchKiwoomProducts(query: string): Promise<LookupOutcome<KiwoomProductCandidate[]>>
  /** 상세 팝업 + 같은 상품의 목록 행(최선 노력) */
  getKiwoomProductTerms(productCode: string): Promise<LookupOutcome<KiwoomProductTerms>>
  /** es040 기초자산 목록(지수·국내·해외 셋) — 불러온 자산명을 `provider_symbol`로 푸는 데 쓴다 */
  listKiwoomAssets(): Promise<LookupOutcome<ListedAsset[]>>
}

export type KiwoomProductSourceDeps = {
  /** 주입한다 — 상시 스위트에 네트워크가 없다(ADR-003) */
  fetchImpl: typeof fetch
  /** 요청당 상한(ms). 기본 8초 */
  timeoutMs?: number
  /** 전체 데드라인(epoch ms). 주지 않으면 조회마다 15초로 잡는다 */
  deadlineAt?: number
}
