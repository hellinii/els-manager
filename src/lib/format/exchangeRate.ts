import { ymd } from './date'
import { exchangeRateDisplay, won } from './money'

/**
 * 환율 문구 — DOC-008 §6 ST-07 명세 · 각 화면의 원화 환산 근거 줄 (P8 컷 a2 · a3)
 *
 * **ST-07 — 앞절은 컷 a2·a3에서 같고 뒷절만 바뀌었다.** a2(W1)와 a3(W2) 사이에는 환율 저장소도 입력 경로도
 * 없어서 뒷절이 「환율 입력은 아직 없다」였다(ST-07 ⓐ — 없는 화면을 가리키지 않는다). 컷 a3-3이 뒷절을 SCR-302
 * 환율 절로 가는 **링크**로 바꿨다 — 문구를 고정하는 테스트는 앞절을 잡으므로 그 교체가 테스트를 깨지 않았다.
 * 링크의 주소는 화면 층(`components/display/ExchangeRateMissingNotice`)이 `lib/routes`에서 얻는다.
 *
 * **n은 상품 수다**(ST-07 ⓑ). 달러 상품당 추정 건이 하나(적용 차수 상환)인 동안 E-09의 건수와
 * 같다 — 월지급 달러 상품이 들어오면(컷 b4) 갈리고 그때 무엇을 세는지는 컷 b1이 정한다.
 *
 * **근거 줄 — 화면마다 문장이 다르고 값은 하나다.** 여섯 자리(SCR-101 ②③ · SCR-202 ⑤ · SCR-203 힌트 ·
 * SCR-401 · SCR-402)가 같은 `ExchangeRateBasisView`를 다른 문장에 싣는다. 문장은 DOC-008의 것을 그대로
 * 쓰고(`tests/app/exchangeRate.test.ts`가 결속한다) 「 · 환율 오래됨」은 힌트를 뺀 모든 자리에 붙는다(v2.19).
 */

/** 뒷절 — SCR-302 환율 절로 가는 링크의 글자 (컷 a3) */
export const EXCHANGE_RATE_INPUT_LINK_LABEL = '시세 화면에서 환율을 입력한다'

/**
 * 앞절과 뒷절 사이 — 「 — 」. **화면(`ExchangeRateMissingNotice`)과 글자 함수가 이 하나를 쓴다** — 화면이 이음표를
 * 따로 적으면 그 글자는 어느 테스트도 보지 않는다(반박 검토 지적 — 화면이 이 모듈의 문장 함수를 부르지 않는다)
 */
export const EXCHANGE_RATE_MISSING_JOINER = ' — '

/** 경과 표식 — DOC-005 §6 「환율 경과」. 등급은 `STALE_GRADE`(caution)와 같다(DOC-005 §6.3 v1.9) */
export const EXCHANGE_RATE_STALE_LABEL = '환율 오래됨'

export type ExchangeRateMissing =
  /** SCR-101 ③ · SCR-401 ③ — 추정이 필요한 달러 상품 n건 */
  | { kind: 'COUNT'; count: number }
  /** SCR-202 ⑤ — 한 상품 형태 */
  | { kind: 'PRODUCT' }
  /** SCR-402 — 원화 합에서 빠진 상품 n건(비과세 · 상환된 상품도 센다 — ST-07 예외 행) */
  | { kind: 'FORECAST'; count: number }

/** 앞절 — 무엇이 빠졌는가. 화면이 뒷절(링크)을 잇는다 */
export function exchangeRateMissingLead(missing: ExchangeRateMissing): string {
  switch (missing.kind) {
    case 'COUNT':
      return `환율이 없어 달러 상품 ${missing.count}건의 추정 과세 금융소득이 빠졌다`
    case 'PRODUCT':
      return '환율이 없어 추정 과세 금융소득을 계산하지 않았다'
    case 'FORECAST':
      return `환율이 없어 달러 상품 ${missing.count}건의 원화 금액(세전 회수 · 잔여 원금)이 이 표에서 빠졌다`
  }
}

/** 한 줄 전체의 글자 — 앞절 — 뒷절. 화면은 뒷절을 링크로 그리고, 이 함수는 문구 대조에 쓴다 */
export function exchangeRateMissingNotice(missing: ExchangeRateMissing): string {
  return `${exchangeRateMissingLead(missing)}${EXCHANGE_RATE_MISSING_JOINER}${EXCHANGE_RATE_INPUT_LINK_LABEL}`
}

/** 근거 뷰에서 문장이 읽는 셋. `ExchangeRateBasisView`의 부분이다(값 import 없이 구조로 받는다) */
export type ExchangeRateBasisText = {
  rate: string
  asOfDate: string
  isStale: boolean
}

function staleTail(basis: ExchangeRateBasisText): string {
  return basis.isStale ? ` · ${EXCHANGE_RATE_STALE_LABEL}` : ''
}

/**
 * SCR-101 ② — 「원화 환산 합계 약 1,097,468,000원 (추정 · 1,392.40원/달러 · 2026-09-28 기준)」.
 * `activePrincipal`은 원화 정수다(DOC-011 Q-07 ⓑ)
 */
export function krwEstimateLine(activePrincipal: string, basis: ExchangeRateBasisText): string {
  return `원화 환산 합계 약 ${won(activePrincipal)} (추정 · ${exchangeRateDisplay(basis.rate)} · ${ymd(basis.asOfDate)} 기준${staleTail(basis)})`
}

/** SCR-101 ③ — 「달러 상품 n건의 추정을 원화로 환산해 포함했다 (1,392.40원/달러 · 2026-09-28 기준 추정 환율)」 */
export function convertedIncludedLine(count: number, basis: ExchangeRateBasisText): string {
  return `달러 상품 ${count}건의 추정을 원화로 환산해 포함했다 (${exchangeRateDisplay(basis.rate)} · ${ymd(basis.asOfDate)} 기준 추정 환율${staleTail(basis)})`
}

/** SCR-202 ⑤ — 「추정 · 1,392.40원/달러 · 2026-09-28 기준 추정 환율로 환산」 */
export function projectionBasisLine(basis: ExchangeRateBasisText): string {
  return `추정 · ${exchangeRateDisplay(basis.rate)} · ${ymd(basis.asOfDate)} 기준 추정 환율로 환산${staleTail(basis)}`
}

/** SCR-401 — 「달러 상품 n건의 추정을 1,392.40원/달러(2026-09-28 기준 추정 환율)로 환산했다」 */
export function convertedTaxLine(count: number, basis: ExchangeRateBasisText): string {
  return `달러 상품 ${count}건의 추정을 ${exchangeRateDisplay(basis.rate)}(${ymd(basis.asOfDate)} 기준 추정 환율)로 환산했다${staleTail(basis)}`
}

/** SCR-402 다섯째 표 밖 표식 — 「환율 1,392.40원/달러(2026-09-28 기준) 가정」. 표 아래 한 줄로 한 번 */
export function forecastBasisLine(basis: ExchangeRateBasisText): string {
  return `환율 ${exchangeRateDisplay(basis.rate)}(${ymd(basis.asOfDate)} 기준) 가정${staleTail(basis)}`
}

/** SCR-203 과세 칸 힌트의 뒷절 — 거래내역에서 옮긴다(U1). 근거 환율이 없으면 이것만 남는다 */
export const REDEMPTION_KRW_TAXABLE_HINT = '거래내역의 원화 금액을 적는다'

/**
 * SCR-203 — 「≈ (실수령액 − 투자원금) × 1,392.40원/달러 — 2026-09-28 기준 추정 환율이다. 거래내역의 원화 금액을
 * 적는다」. **계산한 숫자를 넣지 않는다** — 실수령액을 고치면 JS 없는 경로에서 그 숫자가 낡는다(DOC-008 SCR-203).
 * 「환율 오래됨」을 붙이지 않는다 — 힌트는 크기만 말한다(v2.19)
 */
export function redemptionTaxableHint(basis: ExchangeRateBasisText | null): string {
  if (basis == null) return REDEMPTION_KRW_TAXABLE_HINT
  return `≈ (실수령액 − 투자원금) × ${exchangeRateDisplay(basis.rate)} — ${ymd(basis.asOfDate)} 기준 추정 환율이다. ${REDEMPTION_KRW_TAXABLE_HINT}`
}

/** SCR-401 「표시 주의」 넷째 줄 — `income.convertedCount > 0`일 때만(DOC-008 v2.19) */
export const FOREIGN_TAX_ASSUMPTION_NOTE =
  '외화 추정은 최신 환율 하나를 모든 지급에 가정한다 — 실제는 지급일마다의 기준환율로 증권사가 산출한다'

/** SCR-402 「화면 전체가 추정」 고지의 면책 — 어느 행이든 `exchangeRateBasis ≠ null`일 때만(DOC-008 v2.19) */
export const FOREIGN_FORECAST_DISCLAIMER =
  '외화는 최신 환율 하나로 모든 연도를 환산한다 — 실제 과세표준은 지급일마다의 기준환율로 정해진다'

/** SCR-502 면책 고지 — 「세금 · 건강보험료도 추정이다」 문단 끝. **조건 없이** 적는다(정적 화면이다) */
export const SETTINGS_FOREIGN_DISCLAIMER =
  '달러 상품의 원화 금액(추정 과세 금융소득 · 원화 환산 합계)은 최신 환율 하나를 가정한 추정이며, 과세 금융소득의 정본은 거래내역의 원화 값이다.'

/** SCR-302 환율 절의 글자 — DOC-008 SCR-302 「환율 (원/달러)」 절 표 */
export const EXCHANGE_RATE_SECTION_TEXT = {
  title: '환율 (원/달러)',
  missing: '환율이 없다 — 달러 상품의 추정 과세 금융소득이 빠져 있다',
  /** 수집 상태 — `autoCollected = false`. 「(ADR-010)」은 문서의 인용이라 싣지 않는다(v2.19) */
  notCollected: '자동 수집 안 함 — 수동 입력이 정상 경로',
  estimateOnly: '추정용 — 과세 금융소득의 정본은 거래내역',
  refreshExcludes: '「전체 갱신」은 환율을 받지 않는다',
  rateLabel: '1달러당 원',
  saved: '환율을 저장했다.',
} as const
