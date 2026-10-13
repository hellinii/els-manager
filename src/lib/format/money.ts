import { dec, roundToUnit, type DecimalValue } from '@/lib/decimal'
import type { ProductCurrency } from '@/lib/domain/currency'

/**
 * 금액 표시 — DOC-005 §9 표준 표기
 *
 * ## 문자열이 들어오고 문자열이 나간다
 *
 * 조회 계약이 금액을 정수 문자열로 준다(Q-07 `amountString`). 그것을 표시하려고
 * `Number(v).toLocaleString()`을 쓰는 것이 UI에서 가장 자연스러운 실수인데,
 * `numeric(15,0)` 금액은 **15자리까지 float64로 정확하므로 값 단언으로는 영원히
 * 드러나지 않는다** — 린트가 `Number()`·`parseFloat`·단항 `+`를 이 디렉터리에서
 * 막는 이유다(컷 0d 규칙 1). 여기서는 자릿수 삽입을 **문자열 조작으로만** 한다.
 */

/** 세 자리마다 쉼표. 숫자로 바꾸지 않으므로 자릿수 제한이 없다. */
export function withCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 금액 문자열 → 표시 문자열.
 *
 * 부호를 먼저 떼는 이유: `\B` 경계 규칙이 `-` 앞에서 어긋나 `-1,234`가
 * `-1,2,34` 같은 형태가 될 수 있다. 손익은 음수가 정상값이므로(DOC-005 §8.5
 * 포트폴리오 손익) 부호 경로가 예외가 아니다.
 */
export function won(amount: string): string {
  return `${signedCommas(amount)}원`
}

/** 단위 없는 형태. 「원」이 열 머리글에 있는 표에서 쓴다. */
export function amount(value: string): string {
  return signedCommas(value)
}

/**
 * 손익 표시 — 양수에 `+`를 붙인다.
 *
 * 0은 부호를 붙이지 않는다. 손익 0은 "손실 없음"이지 "이익 있음"이 아니다.
 */
export function signedWon(value: string): string {
  const trimmed = value.trim()
  const positive = !trimmed.startsWith('-') && !/^0+$/.test(trimmed.replace(/\D/g, ''))
  return `${positive ? '+' : ''}${signedCommas(trimmed)}원`
}

function signedCommas(value: string): string {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const digits = negative ? trimmed.slice(1) : trimmed
  return `${negative ? '-' : ''}${withCommas(digits)}`
}

/**
 * 만·억 단위 한글 금액 — `tax_brackets` 구간 표시명의 부품 (DOC-011 §4.6).
 *
 * **`lib/db/queries/map.ts`에서 이관했다** (컷 1a). 복제하지 않은 이유는 두 개의
 * 한글 금액 렌더러가 갈리면 그 갈림을 `bracketLabel` 테스트가 보지 못하기
 * 때문이다. `lib/db → lib/format` 방향의 import는 어느 규칙도 금지하지 않는다.
 *
 * 여기만 `DecimalValue`를 받는다 — 호출부(`bracketLabel`)가 이미 Decimal을 들고
 * 있고, 만·억 분해는 나눗셈이라 문자열 조작으로 할 수 없다.
 */
export function koreanAmount(value: DecimalValue): string {
  const eok = value.div('100000000').floor()
  const man = value.mod('100000000').div('10000').floor()

  if (eok.gt(0) && man.gt(0)) {
    return `${withCommas(eok.toFixed(0))}억 ${withCommas(man.toFixed(0))}만`
  }
  if (eok.gt(0)) return `${withCommas(eok.toFixed(0))}억`
  if (man.gt(0)) return `${withCommas(man.toFixed(0))}만`
  return '0'
}

/** 문자열 금액을 한글 단위로. 화면은 Decimal을 만들지 않는다. */
export function koreanWon(value: string): string {
  return `${koreanAmount(dec(value))}원`
}

/** 한글 금액이 서는 하한 — 만 원. `koreanAmount`는 그 아래를 버려 「0」을 낸다 */
const KOREAN_WON_UNIT = '10000'

/**
 * 한글 금액(`koreanWon`)으로 적을 만 단위가 있는가 — 1만 원 이상 (홈 피드백 컷 K13). **값으로 본다**(절대 규칙 #2).
 *
 * 거짓이면 `koreanWon`이 「0원」을 낸다 — 위 숫자와 모순으로 보이는 보조 표기다(음수도 같다 — `koreanAmount`는 양의 억 · 만만
 * 적는다). 한글 금액 보조 괄호(홈 ② 원화 줄 · SCR-401 금액 칸)와 원화 환산 합계의 만 원 접기(`krwEstimateLine`)가 이 판정 하나를
 * 쓴다. 종전에는 앞의 둘이 표시 문자열(`koreanWon(v) !== '0원'`)로, 뒤의 하나가 따로 둔 `dec` 비교로 봤다 — 같은 경계를 두 형태로
 * 적으면 한쪽이 바뀌는 날 「보조 괄호는 서는데 환산 줄은 원 단위」처럼 갈린다
 */
export function hasKoreanWonUnit(value: string): boolean {
  return dec(value).gte(KOREAN_WON_UNIT)
}

// ---------------------------------------------------------------------------
// 상품 통화 — DOC-005 §9 (GQ-05 해결) · P8 컷 a2
//
// ★ 원화 경로는 `won`·`signedWon`을 **그대로 부른다** — 기존 화면 문자열(e2e `'616,000원'`)이
//   바이트 단위로 같아야 하고, 사본을 만들면 두 원화 렌더러가 갈릴 수 있다.
// ★ 달러는 계약이 소수 두 자리 고정 문자열로 준다(Q-07′). 여기서는 반올림하지 않고 자릿수만
//   끼운다 — 정수부에만 쉼표를 넣는다(`withCommas`는 소수부 네 자리 이상에서 틀린다).
// ---------------------------------------------------------------------------

/** 금액 → 표시. 원화 `1,234원` · 달러 `$1,234.56` / `-$1,234.56` */
export function money(value: string, currency: ProductCurrency): string {
  if (currency === 'KRW') return won(value)
  const { negative, body } = splitSign(value)
  return `${negative ? '-' : ''}$${dollarBody(body)}`
}

/**
 * 손익 표시 — 양수에 `+`. 원화는 `signedWon`과 같고, 달러는 `+$1,234.56` · `-$1,234.56` ·
 * 0은 부호 없이 `$0.00`(0은 「이익 있음」이 아니다 — `signedWon`과 같은 규칙).
 */
export function signedMoney(value: string, currency: ProductCurrency): string {
  if (currency === 'KRW') return signedWon(value)
  const { negative, body } = splitSign(value)
  const zero = /^0*(\.0*)?$/.test(body)
  const sign = negative && !zero ? '-' : !negative && !zero ? '+' : ''
  return `${sign}$${dollarBody(body)}`
}

/**
 * 금액이 음수인가 — 손익 색의 판정 (홈 피드백 컷 K11). **값으로 본다**(절대 규칙 #2 — 표기가 판정을 정하지 않는다).
 *
 * 종전 화면은 첫 글자(`startsWith('-')`)로 봤다 — `'-0'` · `'-0.00'`이 붉게 칠해진다. 오늘 계약은 그 표기를 내지
 * 않는다(`moneyString`의 `toFixed`가 음의 0에서 부호를 떨어뜨린다 — `'-0.001'` → `'0.00'`, 2026-10-13 실측). 그래도 값으로
 * 보는 이유는 ②의 0 숨김(`shownCurrencyRows`)이 `dec`로 0을 가르기 때문이다 — 두 판정이 표기에 따라 갈리면 「0인데
 * 붉은 줄」이 생긴다. `signedMoney`가 0에 부호를 붙이지 않는 규칙과 같은 판단이다.
 */
export function isNegativeAmount(value: string): boolean {
  return dec(value).lt(0)
}

/** 단위 없는 금액 — 열 머리글에 통화가 있는 표에서 쓴다(원화 `amount`와 같은 자리) */
export function moneyAmount(value: string, currency: ProductCurrency): string {
  if (currency === 'KRW') return amount(value)
  const { negative, body } = splitSign(value)
  return `${negative ? '-' : ''}${dollarBody(body)}`
}

/**
 * 환율 표시 — `1,392.40원/달러` (DOC-005 §9). 저장은 소수 여섯 자리(`numeric(18,6)`)이고
 * **표시만 두 자리로 반올림한다**(DOC-008 §5 머리 표). 쉼표는 정수부에만 넣는다.
 */
export function exchangeRateDisplay(rate: string): string {
  const rounded = roundToUnit(dec(rate), '0.01').toFixed(2)
  const [intPart = '0', fracPart = '00'] = rounded.split('.')
  return `${withCommas(intPart)}.${fracPart}원/달러`
}

function splitSign(value: string): { negative: boolean; body: string } {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  return { negative, body: negative ? trimmed.slice(1) : trimmed }
}

function dollarBody(body: string): string {
  const [intPart = '0', fracPart = ''] = body.split('.')
  return `${withCommas(intPart)}.${fracPart.padEnd(2, '0')}`
}

