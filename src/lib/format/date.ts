/**
 * 날짜·D-Day 표시 — DOC-005 §6.2가 정본
 *
 * **오늘을 계산하지 않는다.** 기준일은 요청당 한 번 해석되고(Q-02) 여기 오는
 * 것은 그 결과이거나 저장된 날짜다. 린트가 이 디렉터리에서 `new Date()`·
 * `Date.now()`를 막는다(컷 0d 규칙 2) — 포매터가 자기 시각을 보면 자정을 걸친
 * 렌더에서 목록의 D-Day와 라벨의 D-Day가 다른 날을 가리키고, 그 결함은
 * 재현되지 않는다.
 *
 * `Date` 객체를 아예 만들지 않는다. `YYYY-MM-DD`는 문자열 조작으로 충분하고,
 * `new Date('2026-07-28')`은 **UTC 자정으로 해석**되므로 KST에서 하루 전으로
 * 표시되는 부류의 결함을 만든다.
 */

/** `YYYY-MM-DD` 형식 검사. 표시 함수들의 공통 전제다. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(iso: string): { y: string; m: string; d: string } {
  const matched = ISO_DATE.exec(iso.trim())
  if (matched == null) {
    // 표시 계층이 조용히 빈 문자열을 내면 화면에 날짜가 사라지고 원인을 알 수
    // 없다. §3.2.2의 기본값이 INTERNAL인 것과 같은 자리다.
    throw new RangeError(`YYYY-MM-DD 형식이 아니다: ${iso}`)
  }
  return { y: matched[1]!, m: matched[2]!, d: matched[3]! }
}

/**
 * 표·목록용 — 저장 형식 그대로. 검증만 한다.
 *
 * 열 폭이 좁고 사전순 정렬이 곧 시간순이므로 이 형태가 표의 기본이다.
 */
export function ymd(iso: string): string {
  const { y, m, d } = parts(iso)
  return `${y}-${m}-${d}`
}

/** 본문·강조용 — `2026년 7월 28일`. 월·일에 0을 채우지 않는다. */
export function korDate(iso: string): string {
  const { y, m, d } = parts(iso)
  return `${y}년 ${strip(m)}월 ${strip(d)}일`
}

/** 월 그룹(SCR-301) — `2026년 7월`. */
export function korMonth(iso: string): string {
  const { y, m } = parts(iso)
  return `${y}년 ${strip(m)}월`
}

/** 같은 달의 두 날짜를 한 그룹으로 묶기 위한 키. `2026-07` */
export function monthKey(iso: string): string {
  const { y, m } = parts(iso)
  return `${y}-${m}`
}

/**
 * D-Day 표기 — DOC-005 §6.2.
 *
 * `dDay`의 부호는 `기준일 → 평가일`이고 **과거가 음수**다(DOC-011 §4.1).
 * 통용 표기는 과거를 `D+`로 적으므로 뒤집음이 필요한데, 그 뒤집음을 화면마다
 * 하면 임박과 경과가 뒤바뀐다. 한 곳에 둔다.
 */
export function dDayLabel(dDay: number): string {
  if (dDay === 0) return 'D-DAY'
  return dDay > 0 ? `D-${dDay}` : `D+${-dDay}`
}

function strip(twoDigits: string): string {
  return twoDigits.replace(/^0/, '')
}
