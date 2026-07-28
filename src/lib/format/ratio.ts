/**
 * 비율 표시 — DOC-002 M-04 (비율은 소수로 정규화되어 저장된다)
 *
 * 조회 계약은 비율을 **소수 4자리 고정 문자열**로 준다(Q-07 `ratioString`,
 * `numeric(6,4)`와 일치). 화면은 퍼센트로 보여야 하므로 소수점을 두 칸 옮긴다.
 *
 * **곱하지 않고 옮긴다.** `dec(v).mul(100)`이면 정확하기는 하나 Decimal을 표시
 * 계층에 끌어들이고, `Number(v) * 100`은 `0.8850 → 88.50000000000001`이 되는
 * 부류다(린트가 이 디렉터리에서 막는다). 소수점 이동은 **문자열 자리 이동**이므로
 * 어느 정밀도에서도 정확하다.
 */

/**
 * `'0.9000'` → `'90%'`, `'0.8850'` → `'88.5%'`, `'1.0000'` → `'100%'`
 *
 * 뒤따르는 0을 지운다 — 배리어는 5% 단위가 대부분이라 `90.00%`가 표의 폭만
 * 늘린다. 유효 숫자는 지우지 않는다(`'0.8825'` → `'88.25%'`).
 */
export function percent(ratio: string): string {
  const trimmed = ratio.trim()
  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1) : trimmed

  const [intPart = '0', fracPart = ''] = body.split('.')
  // 소수점을 두 칸 오른쪽으로: 정수부는 소수부의 앞 두 자리를 흡수한다.
  const padded = `${fracPart}00`.slice(0, Math.max(2, fracPart.length))
  const shiftedInt = `${intPart}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const shiftedFrac = padded.slice(2).replace(/0+$/, '')

  return `${negative ? '-' : ''}${shiftedInt}${shiftedFrac === '' ? '' : `.${shiftedFrac}`}%`
}

/**
 * 비율의 **차이**를 표시한다 — 워스트오브가 배리어보다 얼마나 위/아래인가.
 *
 * SCR-201·301이 "충족까지 얼마"를 보여주려면 두 비율의 차가 필요하다. 부호를
 * 명시하는 이유: `-5%p`와 `5%p`는 조기상환 여부가 갈리는 반대 상황이다.
 * 단위는 `%p` — 비율의 차이는 퍼센트가 아니라 퍼센트포인트다.
 */
export function percentPoint(diff: string): string {
  const shown = percent(diff).replace('%', '%p')
  // 0에는 부호를 붙이지 않는다 — `+0%p`는 "조금 위"로 읽히지만 실제로는 경계 위다.
  if (shown === '0%p' || shown === '-0%p') return '0%p'
  return shown.startsWith('-') ? shown : `+${shown}`
}
