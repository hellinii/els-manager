/**
 * 기준일 — DOC-011 §4.0 Q-02
 *
 * **실행 환경은 UTC다**(Vercel·Node). `new Date().toISOString().slice(0, 10)`을
 * 쓰면 매일 **KST 00:00~09:00 동안 전날**이 기준일이 된다. 그 9시간 창에서:
 *
 * - D-Day가 하루 어긋난다
 * - "오늘"인 평가일이 미래로 분류된다(`isPast`가 `false`)
 * - `overdueEvaluations`가 경과 차수를 놓친다
 * - **1월 1일 KST에는 귀속연도가 전년**이 되어 세율 시드 연도까지 어긋난다
 *
 * `asOf`를 가짜로 주입하는 테스트로는 절대 잡히지 않는 종류의 결함이다 —
 * 결함은 "지금"을 날짜로 바꾸는 그 한 줄에만 있기 때문이다.
 */

const KST = 'Asia/Seoul'

/**
 * `Asia/Seoul` 기준 `YYYY-MM-DD`.
 *
 * 고정 오프셋(`+9시간`)을 더하지 않고 tz 데이터베이스를 경유한다. 한국은
 * 1988년 이후 서머타임이 없지만, 오프셋을 코드에 박으면 그것이 법령 사실의
 * 하드코딩이 되고 어긋나도 조용하다. `Intl`을 쓰면 ICU 데이터가 없는 런타임에서
 * 경계 테스트가 즉시 실패하므로 침묵이 없다.
 *
 * 로케일은 `en-CA`(ISO 형태)에 의존하지 않고 `formatToParts`로 조립한다 —
 * 로케일 데이터가 형식을 바꾸면 문자열 자르기는 조용히 틀린다.
 */
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function today(now: Date = new Date()): string {
  const parts = formatter.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type)
    if (part == null) {
      throw new Error(
        `기준일을 ${KST} 기준으로 산출할 수 없다 (${type} 누락). ` +
          'Intl 시간대 데이터가 없는 런타임이다.',
      )
    }
    return part.value
  }
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * 귀속연도의 기본값. `getDashboard.currentYearTax.year`가 쓴다.
 *
 * 기준일에서 파생시킨다 — `new Date().getFullYear()`를 따로 부르면 UTC 연도가
 * 되어 1월 1일 KST에 기준일과 연도가 갈린다.
 */
export function currentYear(asOf: string): number {
  const year = asOf.slice(0, 4)
  if (!/^\d{4}$/.test(year)) {
    throw new Error(`기준일 형식이 YYYY-MM-DD가 아니다: ${asOf}`)
  }
  // 연도는 금액·비율이 아니라 개수를 세는 정수다 — decimal.ts가 "차수·개월수·
  // 연도처럼 개수를 세는 값은 정수 number를 그대로 쓴다"로 이미 정했다.
  // 강제 변환 금지(Q-08)의 대상이 아니며, 린트도 Number.parseInt만 허용한다.
  return Number.parseInt(year, 10)
}
