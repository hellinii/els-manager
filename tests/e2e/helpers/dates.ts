import {
  dDay,
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
  isWeekendDate,
  shiftDays,
} from '@/lib/domain'

/**
 * 발행일을 기준일에서 거꾸로 만든다 — `home.test.ts`에서 옮겼다 (P6 컷 7-5 — 평가일 판정 흐름이 같은 역산을 쓴다)
 *
 * `shiftDays` · `generateEvaluationDates`는 `lib/domain`에서 온다 — 사본을 두면 앱과 갈릴 수 있고, 이 함수의 전제가
 * 「앱이 저장할 때 쓴 함수와 같은 것으로 검산한다」다.
 */

function monthsBefore(iso: string, months: number): string {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCMonth(t.getUTCMonth() - months)
  return t.toISOString().slice(0, 10)
}

/**
 * 첫 평가일이 `[min, max]`일 뒤에 오는 발행일 — **앱의 함수로 검산한다.** 음수 창은 「이미 지난」 첫 평가일이다.
 *
 * `발행일 + 6개월 = 목표일`의 역산이 정확히 성립하지 않을 수 있으므로(월말 보정) 후보를 하루씩 밀며
 * `generateEvaluationDates`가 낸 첫 평가일의 D-Day를 본다. `weekday`면 첫 평가일이 토 · 일인 후보를 건너뛴다 — 주말로
 * 저장된 평가일은 평가일 판정이 다른 갈래(주말 표식)로 가므로, 실행 요일에 따라 흐름이 갈리지 않게 한다.
 */
export function issueDateForFirstRound(
  asOf: string,
  window: { min: number; max: number },
  options: { weekday?: boolean } = {},
): string {
  const base = monthsBefore(shiftDays(asOf, window.min), 6)
  for (let shift = 0; shift <= window.max - window.min + 3; shift += 1) {
    const candidate = shiftDays(base, shift)
    const [first] = generateEvaluationDates({
      issueDate: candidate,
      evaluationPeriodMonths: 6,
      totalRounds: 3,
      offsetDays: EVALUATION_DATE_OFFSET_DAYS,
    })
    const d = dDay({ from: asOf, evaluationDate: first! })
    if (d < window.min || d > window.max) continue
    if (options.weekday === true && isWeekendDate(first!)) continue
    return candidate
  }
  throw new Error(
    `첫 평가일이 ${window.min}~${window.max}일 뒤에 오는 발행일을 찾지 못했다 (기준일 ${asOf}).`,
  )
}

/** 그 발행일의 첫 평가일 — 화면이 저장할 때 쓴 함수다 */
export function firstEvaluationDateOf(issueDate: string): string {
  return generateEvaluationDates({
    issueDate,
    evaluationPeriodMonths: 6,
    totalRounds: 3,
    offsetDays: EVALUATION_DATE_OFFSET_DAYS,
  })[0]!
}
