import { assertPositiveInteger } from '@/lib/decimal'

/**
 * 평가일정 — S-02, DOC-007 §7.2
 *
 * **날짜는 연·월·일 정수로 직접 계산한다.** `new Date('2026-01-15')`는 UTC로
 * 파싱되고 로컬 타임존에서 읽으면 하루가 밀린다. 서버·클라이언트에서 동일
 * 결과를 보장해야 하므로(ADR-003) 타임존이 개입할 여지를 두지 않는다.
 *
 * 평가일 영업일 조정은 수행하지 않는다(RD-03 보류). 생성값은 계약 조건의
 * 초기값이며 사용자가 수정한다(DOC-002 §4.8).
 */

type YearMonthDay = { year: number; month: number; day: number }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(iso: string): YearMonthDay {
  const matched = ISO_DATE.exec(iso)
  if (matched === null) {
    throw new RangeError(`날짜는 YYYY-MM-DD 형식이어야 한다: ${iso}`)
  }

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])

  if (month < 1 || month > 12) {
    throw new RangeError(`월이 범위를 벗어났다: ${iso}`)
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`존재하지 않는 날짜다: ${iso}`)
  }

  return { year, month, day }
}

function formatIsoDate({ year, month, day }: YearMonthDay): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    default:
      return 31
  }
}

/**
 * 월 가산. 대상 월에 해당 일이 없으면 그 월의 마지막 날로 클램핑한다.
 *
 * 항상 **발행일을 기준으로** 가산한다. 직전 차수 결과에 누적 가산하면 클램핑이
 * 전파되어 기준일을 잃는다 — 1/31 기준 매월 평가에서 2/28로 클램핑된 뒤
 * 3월이 3/28이 되어 계약 조건과 어긋난다.
 */
function addMonths(base: YearMonthDay, months: number): YearMonthDay {
  const totalMonths = base.year * 12 + (base.month - 1) + months
  const year = Math.floor(totalMonths / 12)
  const month = (totalMonths % 12) + 1
  const day = Math.min(base.day, daysInMonth(year, month))

  return { year, month, day }
}

/** 1970-01-01을 0으로 하는 일 수. 일자 차이 계산에만 쓴다. */
function toEpochDay({ year, month, day }: YearMonthDay): number {
  if (year < 1000) {
    throw new RangeError(`연도가 범위를 벗어났다: ${year}`)
  }
  // Date.UTC는 결정적이며 타임존에 의존하지 않는다
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/**
 * 차수별 평가일을 생성한다 — `issue_date + evaluation_period_months × n`
 *
 * 반환 배열의 인덱스 `i`가 차수 `i + 1`에 대응한다.
 */
export function generateEvaluationDates(params: {
  issueDate: string
  evaluationPeriodMonths: number
  totalRounds: number
}): string[] {
  assertPositiveInteger(params.evaluationPeriodMonths, '평가주기(개월)')
  assertPositiveInteger(params.totalRounds, '총 평가 차수')

  const issue = parseIsoDate(params.issueDate)

  return Array.from({ length: params.totalRounds }, (_, index) =>
    formatIsoDate(addMonths(issue, params.evaluationPeriodMonths * (index + 1))),
  )
}

/**
 * D-Day — 기준일부터 평가일까지 남은 일수.
 *
 * 양수는 미래, 0은 당일, 음수는 경과를 뜻한다.
 */
export function dDay(params: { from: string; evaluationDate: string }): number {
  return (
    toEpochDay(parseIsoDate(params.evaluationDate)) -
    toEpochDay(parseIsoDate(params.from))
  )
}

/** 평가일이 기준일보다 앞서는지. 당일은 경과로 보지 않는다. */
export function isPast(params: {
  evaluationDate: string
  asOf: string
}): boolean {
  return dDay({ from: params.asOf, evaluationDate: params.evaluationDate }) < 0
}

/**
 * 적용 차수 — DOC-007 §7.2
 *
 * 사용자가 지정하지 않은 경우 **다음 도래 평가일의 차수**로 가정한다(RD-02).
 * 모든 평가일이 경과했으면 `null`이며, 호출부는 E-07(상환 처리 또는 이월 확인
 * 요청)로 처리한다.
 */
export function nextEvaluation<
  T extends { roundNo: number; evaluationDate: string },
>(params: { schedules: readonly T[]; asOf: string }): T | null {
  const asOfDay = toEpochDay(parseIsoDate(params.asOf))

  let next: T | null = null
  let nextDay = Number.POSITIVE_INFINITY

  for (const schedule of params.schedules) {
    const day = toEpochDay(parseIsoDate(schedule.evaluationDate))
    if (day < asOfDay) continue

    if (day < nextDay || (day === nextDay && next !== null && schedule.roundNo < next.roundNo)) {
      next = schedule
      nextDay = day
    }
  }

  return next
}

/**
 * 귀속연도 — DOC-007 §7.2
 *
 * ```
 * 상환 완료: year( redemptions.redemption_date )
 * 미상환   : year( 적용 차수의 evaluation_date )
 * ```
 */
export function attributionYear(params: {
  redemptionDate?: string | null
  evaluationDate?: string | null
}): number | null {
  if (params.redemptionDate != null) {
    return parseIsoDate(params.redemptionDate).year
  }
  if (params.evaluationDate != null) {
    return parseIsoDate(params.evaluationDate).year
  }
  return null
}
