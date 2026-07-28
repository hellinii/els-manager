import { dec } from '@/lib/decimal'

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

/**
 * 워스트오브가 배리어보다 얼마나 위/아래인가 — SCR-201·301 (P4 컷 2)
 *
 * `percentPoint`의 소비자다. 두 값을 받는 형태로 두는 이유는 화면에서 뺄셈이
 * 일어나지 않게 하는 것이다 — 그 자리에서 `Number(w) - Number(b)`를 쓰는 것이
 * 가장 자연스러운 실수이고 린트가 막지만, 막힌 뒤에 갈 곳이 없으면 값을 안
 * 보여주게 된다.
 *
 * **여기만 이 파일에서 Decimal을 쓴다.** 뺄셈은 자리 이동으로 할 수 없고
 * (`percent`가 곱셈을 자리 이동으로 대체한 것과 다르다) `numeric(6,4)` 두 값의
 * 차는 4자리에서 정확하다. `money.ts`의 `koreanAmount`가 같은 이유로 Decimal을
 * 쓴다 — 만·억 분해가 나눗셈이라 문자열 조작이 불가능하다.
 *
 * 부호는 **워스트오브 − 배리어**다. 양수면 그 차수의 조기상환 조건을 이미
 * 넘었다는 뜻이고, 음수면 그만큼 부족하다. 뒤집으면 임박과 미달이 뒤바뀐다.
 */
export function barrierGap(worstOf: string, barrier: string): string {
  return percentPoint(dec(worstOf).minus(dec(barrier)).toDecimalPlaces(4).toFixed(4))
}
