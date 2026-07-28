import { withCommas } from './money'

/**
 * 시세 표시 — 조회 계약은 **소수 6자리 고정 문자열**을 준다(Q-07 `priceString`).
 *
 * 6자리를 그대로 보여주면 `70,000.000000`이 되어 표에서 읽히지 않는다. 그런데
 * 자릿수를 고정해 자르면 자산 종류마다 틀린다 — 지수는 `350.12`, 개별 종목은
 * `70,000`, 환산 지수는 `1.0825`가 자연스럽다.
 *
 * **뒤따르는 0만 지운다.** 유효 숫자를 버리지 않으므로 어떤 자산에서도 값이
 * 망가지지 않고, 소수부가 필요한 자산에서만 소수점이 보인다. 「몇 자리까지
 * 보여줄까」를 정하지 않는 것이 핵심이다 — 그 결정은 자산별 정보를 요구하는데
 * 그것이 없다.
 */
export function priceDisplay(price: string): string {
  const trimmed = price.trim()
  const negative = trimmed.startsWith('-') // 시세에 음수는 없으나 형식을 잃지 않는다
  const body = negative ? trimmed.slice(1) : trimmed

  const [intPart = '0', fracPart = ''] = body.split('.')
  const fraction = fracPart.replace(/0+$/, '')

  return `${negative ? '-' : ''}${withCommas(intPart)}${
    fraction === '' ? '' : `.${fraction}`
  }`
}

/**
 * 기준가 대비 현재가의 비율은 계약이 이미 준다(`ratio`) — 여기서 나누지 않는다.
 * 시세 두 개를 받아 비율을 만들려면 Decimal이 필요하고, 그것은 표시 계층의 일이
 * 아니다(§4.3이 `ratio`를 뷰에 담는 이유).
 */
