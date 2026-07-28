import { dec, type DecimalValue } from '@/lib/decimal'

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
