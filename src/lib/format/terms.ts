import { percent } from './ratio'

/**
 * 계약 조건의 표시 — SCR-201의 카드 둘째 줄 (DOC-008 §5 ⑪⑫, P6 컷 2)
 *
 * ## 왜 순수 모듈인가
 *
 * 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23). 「스텝다운을 어떻게 적는가」와
 * 「리자드가 붙은 차수를 어떻게 요약하는가」는 판단이고, 컴포넌트 안에 두면 그 판단이
 * 영구 미검증이 된다 — `deriveDisplay`·`barrierGap`이 같은 이유로 여기 있다.
 *
 * ## 표시만 바꾼다
 *
 * 입력은 계약이 준 비율 문자열(`numeric(6,4)`의 `::text`)이고 `percent` 하나가 그것을
 * 사람이 읽는 표기로 옮긴다. **여기서 산술을 하지 않는다** — 이 디렉터리는 `Number()`·
 * `parseFloat`·단항 `+`가 린트로 금지되어 있고, 그것이 금액·비율이 float64를 경유하지
 * 않는다는 보장의 형태다.
 */

/** 리자드가 붙은 차수 하나 — `ProductListItem.terms.lizards`의 원소 */
export type LizardTerm = {
  roundNo: number
  barrier: string
  /** `'0.0000'`이면 원금상환형이다(Q-04). `null`은 I-10이 막으므로 결함 신호다 */
  couponRate: string | null
  requiresNoKi: boolean
}

/**
 * 스텝다운 표기 — **입력 형식과 같은 모양이다** (`90-85-80-75-70-65`)
 *
 * SQ-04의 일괄 입력이 그 형식이므로 사용자가 **적은 것과 같은 모양으로** 되돌려
 * 받는다. `%`는 마지막에 한 번만 붙인다 — 차수마다 붙이면 `90%-85%-…`가 되어 길이가
 * 두 배가 되고 스텝다운의 모양(내려가는 수열)이 기호에 묻힌다.
 *
 * **자르지 않는다.** 신호 없는 자름은 DOC-010 AQ-22가 등재한 형태이고, 차수 수는
 * 사용자의 데이터이므로 긴 것이 정상이다(화면이 줄바꿈으로 흡수한다).
 *
 * 차수가 0건이면 `null`이다 — 그 상태는 `SCHEDULE_MISSING`(I-07)이며 화면의 무결성
 * 표식이 이미 그것을 말하므로 여기서 문구를 지어내지 않는다.
 */
export function stepdownLabel(barriers: readonly string[]): string | null {
  if (barriers.length === 0) return null
  // `percent`가 붙이는 `%`를 떼고 마지막에 한 번만 쓴다.
  const parts = barriers.map((barrier) => percent(barrier).replace('%', ''))
  return `${parts.join('-')}%`
}

/**
 * 리자드 요약 — **붙은 차수만 적는다.**
 *
 * 전 차수를 나열하면 대부분이 「없음」이 되어 신호가 사라진다. 그래서 0건은 `null`이고
 * 화면이 그 칸을 그리지 않는다(「리자드 없음」을 적지 않는다 — 목록의 기본값에 라벨을
 * 붙이면 그 라벨이 아무것도 구분하지 않는다. `ProductRow`가 「보유중」 뱃지를 달지
 * 않는 것과 같은 판단).
 *
 * | 경우 | 표기 |
 * |---|---|
 * | 1건 | `2차 60% · 쿠폰 3%` |
 * | 1건, 원금상환형 | `2차 60% · 원금상환형` |
 * | 1건, KI 미터치 요구 | `2차 60% · 쿠폰 3% · KI 미터치` |
 * | 2건 이상 | `2·4차` — 차수만 적는다 |
 *
 * **2건 이상에서 배리어·쿠폰을 생략하는 것이 판단이다.** 차수마다 값이 다를 수 있어
 * 나열하면 한 줄이 두 줄이 되고, 그때 필요한 것은 「어느 차수에 있는가」다(상세가 그
 * 값을 차수표로 보여준다). 실제 상품의 리자드는 한두 차수에만 있다.
 */
export function lizardLabel(lizards: readonly LizardTerm[]): string | null {
  if (lizards.length === 0) return null

  const rounds = lizards.map((lizard) => lizard.roundNo).join('·')
  if (lizards.length > 1) return `${rounds}차`

  const only = lizards[0]!
  const parts = [`${only.roundNo}차 ${percent(only.barrier)}`]

  /*
   * 쿠폰율이 `null`인 것은 I-10이 막는 조합이다(리자드 배리어가 있으면 쿠폰율은
   * NOT NULL). 그래도 분기를 두는 이유는 타입이 `null`을 허용하기 때문이고, 없는
   * 값을 `0%`로 적으면 **원금상환형과 구별되지 않는다** — 그쪽은 값이 0인 것이고
   * 이쪽은 값이 없는 것이다.
   */
  if (only.couponRate == null) {
    parts.push('쿠폰율 미입력')
  } else if (isZeroRatio(only.couponRate)) {
    // Q-04 — 원금만 상환되는 변형. SCR-202의 차수표와 같은 말을 쓴다.
    parts.push('원금상환형')
  } else {
    parts.push(`쿠폰 ${percent(only.couponRate)}`)
  }

  if (only.requiresNoKi) parts.push('KI 미터치')

  return parts.join(' · ')
}

/**
 * KI 조건 표기 — **`null`이 노낙인이다** (I-11의 짝)
 *
 * 배리어와 관찰방식은 함께 있거나 함께 없다. 배리어만 넘기면 관찰방식을 지어내지
 * 않고 배리어만 적는다 — 계약이 그 조합을 막으므로 도달하지 않지만, 그때 화면이
 * 「종가」를 기본값으로 그리면 **없는 조건을 있는 것처럼** 보여준다.
 */
export function kiTermLabel(
  kiBarrier: string | null,
  observationLabel: string | null,
): string {
  if (kiBarrier == null) return '노낙인'
  return observationLabel == null
    ? percent(kiBarrier)
    : `${percent(kiBarrier)} ${observationLabel}`
}

/** `'0.0000'`·`'0'`·`'0.00'`이 전부 0이다. 문자열 비교로는 갈리므로 형태를 벗긴다 */
function isZeroRatio(ratio: string): boolean {
  return /^-?0*(?:\.0*)?$/.test(ratio.trim())
}
