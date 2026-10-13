import { dec } from '@/lib/decimal'
import type { ConditionResult } from '@/lib/domain'

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
 * **이 파일에서 Decimal을 쓰는 것은 여유폭 하나다** — 이 함수와 바로 아래 `gapTierOf`가 같은 `gapOf`를 지난다
 * (종전 「여기만」 — 단계가 같은 뺄셈을 쓰게 되어 둘이 됐다 · 홈 피드백 컷 K6). 뺄셈은 자리 이동으로 할 수 없고
 * (`percent`가 곱셈을 자리 이동으로 대체한 것과 다르다) `numeric(6,4)` 두 값의
 * 차는 4자리에서 정확하다. `money.ts`의 `koreanAmount`가 같은 이유로 Decimal을
 * 쓴다 — 만·억 분해가 나눗셈이라 문자열 조작이 불가능하다.
 *
 * 부호는 **워스트오브 − 배리어**다. 양수면 그 차수의 조기상환 배리어를 이미
 * 넘었다는 뜻이고, 음수면 그만큼 부족하다. 뒤집으면 여유와 미달이 뒤바뀐다.
 * **양수가 곧 충족은 아니다** — 리자드상환은 음수여도 충족이다(DOC-005 「여유폭」). 그래서 색은 부호가 아니라
 * `gapTierOf`의 단계가 정한다.
 */
export function barrierGap(worstOf: string, barrier: string): string {
  return percentPoint(gapOf(worstOf, barrier).toFixed(4))
}

/** 여유폭 — 계약의 4자리 두 값의 차를 4자리로. 표시(`barrierGap`)와 단계(`gapTierOf`)가 **같은 수**를 본다 */
function gapOf(worstOf: string, barrier: string) {
  return dec(worstOf).minus(dec(barrier)).toDecimalPlaces(4)
}

// ---------------------------------------------------------------------------
// 여유폭 단계 — 홈 피드백 컷 K6 · 민서 결정(2026-10-12) D3
// ---------------------------------------------------------------------------

/**
 * 「예상 근소 충족」의 폭 — **5%p 미만**(정확히 5%p는 「예상 충족」). 정본은 DOC-008 §5 머리 「예상 근소 충족」 블록이다.
 *
 * 문자열이다 — 비교는 `dec`로 한다(절대 규칙 #2). 화면 계층은 린트가 `Number()`를 막는다.
 */
export const NARROW_GAP = '0.0500'

/** 여유폭 단계 — DOC-005 §6 「여유폭 단계」. 열거값이 아니라 파생이다(§6.1 밖 · 라벨은 `GAP_TIER_LABELS`) */
export type GapTier = 'MET' | 'NARROW' | 'UNMET'

/**
 * 조건 판정 → 충족 여부. 홈의 `willMeet`(DOC-011 §4.1 — 「`conditionResult`가 `EARLY` · `LIZARD`」)과 같은 정의를
 * 목록 · 일정의 `conditionResult`에 건다 — 세 화면이 `gapTierOf`에 같은 입력을 넣게 하려는 다리다(DOC-008 SQ-29가
 * 이 두 이름을 등재했다). 판정이 없으면 `null` — 「미충족」이 아니다.
 */
export function conditionMeets(result: ConditionResult | null): boolean | null {
  return result == null ? null : result !== 'CARRY_OVER'
}

/**
 * 여유폭 단계 — SCR-101 ① · SCR-201 · SCR-301이 **이 함수 하나**를 부른다(한 사실을 화면마다 다르게 부르지 않는다).
 *
 * - 워스트오브나 판정이 없으면 `null` — 단계도 없다
 * - **미충족이면 `UNMET` — 판정이 정한다.** 여유폭이 반올림으로 0%p여도 이월이면 미충족이다
 * - 충족이면 여유폭(`barrierGap`이 보이는 바로 그 수)이 `NARROW_GAP` **미만**이면 `NARROW`, 아니면 `MET`.
 *   **리자드(여유폭 음수 + 충족)도 `NARROW`다** — W가 내려갈 때 단계가 MET → NARROW → UNMET으로만 움직인다
 *   (조기상환 배리어 바로 밑에서 안전 쪽으로 되돌아가지 않는다 · DOC-005 GQ-11)
 *
 * float로 비교하면 `0.9500 − 0.9000`이 `0.04999999999999993`이 되어 정확히 5%p가 근소로 떨어진다 — 그 경계가
 * `tests/app/gapTier.test.ts`의 첫 픽스처다.
 */
export function gapTierOf(input: {
  worstOf: string | null
  barrier: string
  meets: boolean | null
}): GapTier | null {
  if (input.worstOf == null || input.meets == null) return null
  if (!input.meets) return 'UNMET'
  return gapOf(input.worstOf, input.barrier).lt(dec(NARROW_GAP)) ? 'NARROW' : 'MET'
}
