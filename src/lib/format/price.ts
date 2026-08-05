import type { RefreshPricesResult } from '@/lib/db/mutations/types'

import { PRICE_FAILURE_LABELS } from './labels'
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

/**
 * §5.8의 반환 → 사람이 읽는 한 줄 — SCR-302 (P5a 컷 3)
 *
 * ## 종전에는 이 결과가 «버려졌다»
 *
 * `refreshPricesAction`이 `toFormState(result, {}, [], '시세를 갱신했다.')`로 고정 문구를
 * 주었고, 그래서 `succeeded`·`skipped`·`unmapped`·`failed[]` 넷에 **표시 표면이 없었다.**
 * 공급자가 0개인 동안에는 무해했다(그 갈래에 닿지 않았다) — 즉 이것은 수집기가 오는
 * 순간 실재하는 결함이 되는 부류였고, 그래서 같은 컷에서 고친다.
 *
 * ## 0건을 «생략한다» — 그리고 그것이 이 함수의 핵심 판단이다
 *
 * 넷을 항상 적으면 정상적인 결과가 「새로 0건 · 이미 최신 6건 · 자동 수집 안 함 0건 ·
 * 실패 0건」이 되어 **0이 셋 보이고 사용자가 무엇을 볼지 정해지지 않는다.** 있는 것만
 * 적으면 흔한 경우가 「이미 최신 6건」 한 마디가 된다.
 *
 * ★ **전부 0이면 「대상이 없다」다.** 그 상태는 미상환 상품이 없거나 기초자산이 없는
 * 것이고 「갱신했다」로 적으면 거짓이다 — 사용자는 뭔가 됐다고 읽는다.
 *
 * ## 실패는 «부류 라벨»로 말한다 — `reason`을 그대로 쏟지 않는다
 *
 * `reason`은 HTTP 상태·SQLSTATE를 담는 진단 문자열이고 그것이 화면 문구가 되면
 * 「기다린다」와 「고친다」가 구별되지 않는다. `PRICE_FAILURE_LABELS`가 그 조치를 말한다
 * (DOC-005 §6.1). 자산 이름을 함께 적는 이유는 **어느 자산인지가 조치의 대상**이기 때문이다.
 */
export function refreshSummary(result: RefreshPricesResult): string {
  const parts = [
    result.succeeded > 0 ? `새로 ${result.succeeded}건` : null,
    result.skipped > 0 ? `이미 최신 ${result.skipped}건` : null,
    result.unmapped > 0 ? `자동 수집 안 함 ${result.unmapped}건` : null,
    result.failed.length > 0 ? `실패 ${result.failed.length}건` : null,
  ].filter((part): part is string => part != null)

  if (parts.length === 0) return '갱신 대상이 없다.'

  const detail = result.failed
    .map((f) => `${f.assetName}: ${PRICE_FAILURE_LABELS[f.failure]}`)
    .join(' · ')

  return detail === '' ? `${parts.join(' · ')}.` : `${parts.join(' · ')} — ${detail}`
}
