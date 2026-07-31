import { assertPositiveInteger } from '@/lib/decimal'
import type { RedemptionMark } from './redemption'

/**
 * 평가일정 — S-02, DOC-007 §7.2
 *
 * **날짜는 연·월·일 정수로 직접 계산한다.** `new Date('2026-01-15')`는 UTC로
 * 파싱되고 로컬 타임존에서 읽으면 하루가 밀린다. 서버·클라이언트에서 동일
 * 결과를 보장해야 하므로(ADR-003) 타임존이 개입할 여지를 두지 않는다.
 *
 * **기산 규약은 적용하고 영업일 조정은 하지 않는다** — 둘은 다른 것이다(RD-03).
 * 규약은 `발행일 + n × 주기 − 1일`이며 실보유 11건 65차수 전부에서 일정하게
 * 그 형태였다. 휴장일 단위의 조정은 여전히 수단이 없다(자료원이 없다).
 *
 * **평가일에는 화면 입력 칸이 없고 만들지 않는다.** 규약이 전역이므로 재생성이
 * 멱등이고(저장값이 이미 이 산식의 결과다) 그래서 DOC-011 §5.2의 전체 교체와
 * 충돌하지 않는다 — DOC-002 §4.8이 그 판단과 뒤집힐 조건을 적는다.
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
 * `toEpochDay`의 역. **UTC 게터만 쓴다** — `getMonth()`·`getDate()`는 로컬
 * 타임존에서 읽어 하루가 밀린다(이 파일 머리글의 그 함정이다). 정방향이
 * `Date.UTC`이므로 역방향도 UTC여야 왕복이 항등이다.
 */
function fromEpochDay(epochDay: number): YearMonthDay {
  const at = new Date(epochDay * 86_400_000)
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
  }
}

/**
 * 일 가산 — 월·연 넘김과 윤년을 에포크 일 수로 흡수한다.
 *
 * 월 가산(`addMonths`)과 달리 클램핑이 없다. 「3월 32일」이 만들어질 여지가
 * 없으므로 보정할 것이 없다.
 */
export function shiftDays(iso: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`일 가산은 정수여야 한다: ${days}`)
  }
  return formatIsoDate(fromEpochDay(toEpochDay(parseIsoDate(iso)) + days))
}

/**
 * 평가일 기산 규약 — `발행일 + n × 주기` **에서 하루 앞**이다 (DOC-007 §11 RD-03)
 *
 * 증권사 통지서의 평가일이 그 형태였다. 실보유 ELS 11건 65차수 전부에서
 * **일정하게** −1일이며, 그 균일성이 이것을 영업일 조정과 가르는 근거다 —
 * 휴장일 조정이면 휴일에 걸린 일부 차수만 움직이고 방향도 통상 `+`다.
 *
 * **전역 규약이므로 상품별 차이를 표현하지 못한다.** 다른 규약의 상품이 오면
 * 그 상품의 전 차수가 하루씩 틀리고 화면에 그 사실을 말할 자리가 없다 —
 * RD-03의 잔여 ⓑ로 등재되어 있다.
 */
export const EVALUATION_DATE_OFFSET_DAYS = -1

/**
 * 차수별 평가일을 생성한다 — `issue_date + evaluation_period_months × n + offsetDays`
 *
 * 반환 배열의 인덱스 `i`가 차수 `i + 1`에 대응한다.
 *
 * ## 순서가 월말에서 갈린다 — 월 이동 → 클램프 → 일 이동이다
 *
 * `발행일 2026-08-31`, 주기 6개월, `offsetDays = -1`:
 *
 * - **채택** — `+6개월 → 2027-02-28`(클램프) `→ −1일 → 2027-02-27`
 * - 기각 — `−1일 → 2026-08-30 → +6개월 → 2027-02-28`
 *
 * 「n개월 후의 전일」의 자연스러운 읽기가 앞쪽이고, **클램프가 먼저인 것이
 * `addMonths`의 성질을 보존한다**(항상 발행일 기준 가산으로 클램프 전파를 막는
 * 것 — 일 이동을 먼저 하면 기준 자체가 바뀌어 그 성질이 깨진다).
 *
 * ## `offsetDays`가 필수 인자인 이유
 *
 * 기본값을 주면 새 호출부가 **조용히 규약을 안 따를 수 있다.** 필수면
 * 컴파일러가 잡고, 기존 호출부 전부가 무엇을 쓰는지 명시하게 된다. 상수는
 * `EVALUATION_DATE_OFFSET_DAYS`이며 달력 사실만 원하는 호출부는 `0`을 넘긴다.
 */
export function generateEvaluationDates(params: {
  issueDate: string
  evaluationPeriodMonths: number
  totalRounds: number
  offsetDays: number
}): string[] {
  assertPositiveInteger(params.evaluationPeriodMonths, '평가주기(개월)')
  assertPositiveInteger(params.totalRounds, '총 평가 차수')
  if (!Number.isInteger(params.offsetDays)) {
    throw new RangeError(`평가일 기산 보정은 정수여야 한다: ${params.offsetDays}`)
  }

  const issue = parseIsoDate(params.issueDate)

  return Array.from({ length: params.totalRounds }, (_, index) =>
    formatIsoDate(
      fromEpochDay(
        toEpochDay(
          addMonths(issue, params.evaluationPeriodMonths * (index + 1)),
        ) + params.offsetDays,
      ),
    ),
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

/** 경과 미상환 차수 1건 — DOC-007 §9.2 */
export type OverdueEvaluation<T> = {
  schedule: T
  /** 경과 일수. 항상 양수다 */
  daysOverdue: number
}

/**
 * 경과 미상환 차수 — DOC-007 §9.2 (E-07)
 *
 * ```
 * = []                                                  if redemption ≠ NULL
 * = [ (schedule, daysOverdue) | evaluation_date < asOf ] otherwise (평가일 오름차순)
 * ```
 *
 * **상환 완료 상품은 빈 배열이다.** E-05가 우선한다 — 상환 처리로 확인이
 * 완결되었으므로 경과 차수를 다시 묻지 않는다.
 *
 * 경과한 차수를 **전부** 반환한다. 최근 1건만 반환하면 여러 차수가 연속으로
 * 경과한 상품에서 앞 차수의 확인이 누락된다.
 *
 * `nextEvaluation`과 서로 배타적인 두 구간을 담당한다. 평가일 당일은 경과로
 * 보지 않으므로 어느 쪽에도 중복 포함되지 않는다.
 *
 * 결과가 비어 있지 않은 상품은 "상환 처리 또는 이월 확인" 대상이다. 시스템이
 * 이월을 자동 확정하지 않는다. 확인 이력을 저장하지 않으므로 조회마다
 * 재산출된다(RD-06).
 */
export function overdueEvaluations<
  T extends { roundNo: number; evaluationDate: string },
>(params: {
  schedules: readonly T[]
  asOf: string
  /** 상환 레코드. 존재하면 E-05에 따라 빈 배열을 반환한다 */
  redemption: RedemptionMark
}): OverdueEvaluation<T>[] {
  if (params.redemption != null) return []

  const asOfDay = toEpochDay(parseIsoDate(params.asOf))

  return params.schedules
    .map((schedule) => ({
      schedule,
      daysOverdue: asOfDay - toEpochDay(parseIsoDate(schedule.evaluationDate)),
    }))
    .filter((entry) => entry.daysOverdue > 0)
    .sort(
      (a, b) =>
        b.daysOverdue - a.daysOverdue || a.schedule.roundNo - b.schedule.roundNo,
    )
}

/**
 * 귀속연도 — DOC-007 §7.2
 *
 * ```
 * 상환 완료: year( redemptions.redemption_date )
 * 미상환   : year( 적용 차수의 evaluation_date )
 * ```
 *
 * ## 근거가 하나라도 있으면 `null`이 아니다 — 오버로드로 그것을 말한다 (AQ-25)
 *
 * 반환 타입이 `number | null`이라 호출부마다 「그럴 수 없는 `null`」을 방어했고,
 * 그 방어가 **어느 스위트도 실행하지 않는 죽은 분기**로 남았다(DOC-011 §9 AQ-25 —
 * `projectionOf`의 넷째 분기, `mutations/redemptions.ts`의 `console.error`). 원인은
 * 함수가 아니라 **서명**이다: 두 근거가 모두 없을 때만 `null`인데 타입이 그 조건을
 * 말하지 않았다.
 *
 * 그래서 셋째 오버로드만 `| null`을 갖는다 — 날짜를 하나라도 **확실히** 넘기면
 * `number`이고, 방어를 쓸 자리가 아예 없어진다. 함수 본문은 바뀌지 않았다
 * (동작 불변이며, `redemptionDate`가 이긴다는 우선순위도 그대로다).
 */
export function attributionYear(params: {
  redemptionDate: string
  evaluationDate?: string | null
}): number
export function attributionYear(params: {
  redemptionDate?: string | null
  evaluationDate: string
}): number
export function attributionYear(params: {
  redemptionDate?: string | null
  evaluationDate?: string | null
}): number | null
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
