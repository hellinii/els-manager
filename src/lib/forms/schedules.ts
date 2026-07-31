import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'

import { MAX_ROUNDS, countOf, roundCountOf } from './steps'

/**
 * 차수표의 파생값 — **평가일은 입력이 아니라 생성값이다** (DOC-008 §5 SCR-204 ④)
 *
 * 「생성될 평가일정 미리보기 후 저장」이므로 사용자는 발행일·평가주기·총 차수를
 * 적고 평가일은 보기만 한다. 생성 규칙은 `lib/domain`의 `generateEvaluationDates`
 * 하나이며(`issue_date + evaluation_period_months × n`, 말일 클램핑) 여기서 다시
 * 구현하지 않는다 — 화면이 자기 방식으로 날짜를 더하면 2월 클램핑에서 계약과
 * 다른 날을 저장한다.
 *
 * ## 왜 히든 필드로 나르지 않는가
 *
 * 값을 히든에 실으면 ①의 발행일을 고친 뒤 ③을 지나지 않고 저장할 경로가 생기고,
 * 그때 저장되는 평가일은 **고치기 전의 날짜**다. 폼에서 파생시키면 그 상태가
 * 존재할 수 없다 — 파서와 화면이 같은 함수를 같은 입력에 부른다.
 *
 * ## 던지지 않는다
 *
 * `generateEvaluationDates`는 형식·범위 위반에 `RangeError`를 던진다(순수 모듈의
 * 규약). 폼은 **아직 다 채우지 않은 상태로 렌더되는 것이 정상**이므로 여기서
 * 예외가 나가면 사용자가 발행일을 지우는 순간 화면이 오류 경계로 간다. 생성할 수
 * 없으면 빈 배열이고, 「왜 비었는가」는 계약의 오류 문구가 말한다(V-07·V-20) —
 * 검증을 여기서 다시 하지 않는 이유는 `parse.ts` 머리글과 같다.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function previewDates(input: {
  issueDate: string
  evaluationPeriodMonths: number
  totalRounds: number
}): string[] {
  if (!ISO_DATE.test(input.issueDate.trim())) return []
  if (!Number.isInteger(input.evaluationPeriodMonths) || input.evaluationPeriodMonths < 1) {
    return []
  }
  if (!Number.isInteger(input.totalRounds) || input.totalRounds < 1) return []

  try {
    return generateEvaluationDates({
      issueDate: input.issueDate.trim(),
      evaluationPeriodMonths: input.evaluationPeriodMonths,
      totalRounds: Math.min(input.totalRounds, MAX_ROUNDS),
      // 기산 규약을 여기서 다시 정하지 않는다 — 상수가 `lib/domain`에 있고
      // 인자가 필수이므로 새 호출부가 조용히 규약을 빠뜨릴 수 없다.
      offsetDays: EVALUATION_DATE_OFFSET_DAYS,
    })
  } catch {
    /*
     * 형식은 맞고 값이 틀린 경우가 남는다 — `2026-02-30`(존재하지 않는 날),
     * `2026-13-01`(월 범위). 정규식으로는 가릴 수 없고 순수 모듈이 던진다.
     * 삼키는 것이 아니라 **빈 목록으로 바꾸는 것**이며, 그 입력은 계약의
     * `requireIsoDate`가 같은 이유로 거부하므로 문구는 한 곳에서 나온다.
     */
    return []
  }
}

/**
 * 값 맵에서 바로 — **화면과 파서가 부르는 것이 이 함수 하나다.**
 *
 * 셋을 각자 뽑아 넘기면 한쪽이 `evaluationPeriodMonths`를 다르게 읽는 날이 오고,
 * 그때 ④의 미리보기와 저장되는 평가일이 **다른 날**이 된다. 사용자는 확인 화면에서
 * 본 날짜가 저장되었다고 믿는다.
 */
export function previewDatesOf(values: Record<string, string>): string[] {
  return previewDates({
    issueDate: values.issueDate ?? '',
    evaluationPeriodMonths: countOf(values.evaluationPeriodMonths),
    totalRounds: roundCountOf(values),
  })
}
