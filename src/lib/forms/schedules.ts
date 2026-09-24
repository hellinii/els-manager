import {
  EVALUATION_DATE_OFFSET_DAYS,
  dDay,
  generateEvaluationDates,
  shiftDays,
} from '@/lib/domain'

import { MAX_ROUNDS, countOf, roundCountOf } from './rounds'

/**
 * 차수표의 파생값 — **평가일은 입력이 아니라 생성값이다** (DOC-008 §5 SCR-204)
 *
 * 차수표가 그 값을 보여주므로 사용자는 발행일·평가주기·총 차수를
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

// ---------------------------------------------------------------------------
// 평가일 칸 — 산식이 움직여도 되는가 (DOC-008 §5 SCR-204 v2.8)
// ---------------------------------------------------------------------------

/**
 * 평가일 기준 — **지금 칸의 날짜가 어떤 발행일·주기의 산식으로 만들어졌는가** (DOC-005 v1.3)
 *
 * 폼 전용 히든 값이며 계약 필드가 아니다(`barriers`와 같은 자리). 형식은 `발행일|주기`다.
 *
 * ## 왜 필요한가 — 칸이 입력값이 되면서 생긴 함정 하나
 *
 * 평가일이 생성값이던 동안(v2.7까지)은 발행일을 고치면 저장이 날짜를 다시 만들었다.
 * 칸이 정본이 되면 그 재생성이 사라지고, 수정 화면에서 발행일을 고쳐 곧바로 저장하면
 * **옛 발행일 기준의 날짜가 경고 없이 저장된다** — 형식은 정상이고 값만 거짓이다
 * (DQ-02가 거부한 부류). 운영 11건이 전부 산식대로이므로 가장 흔한 수정 경로다.
 *
 * 그렇다고 발행일이 바뀔 때마다 무조건 재생성하면 **불러온 실제 날짜**(E04000의
 * 휴장일 조정)를 산식으로 덮는다. 그래서 「그 날짜들이 산식에서 왔는가」를 알아야
 * 하고, 날짜 자체로는 그것을 알 수 없다 — 옛 기준이 있어야 옛 산식과 대조할 수 있다.
 */
export const EVALUATION_DATE_BASIS_FIELD = 'evaluationDateBasis'

/** 차수표 칸의 하위 이름. 다음 커밋이 `SCHEDULE_SUBS`에 넣는다 */
const DATE_SUB = 'evaluationDate'

const dateCell = (index: number): string => `schedules[${index}].${DATE_SUB}`

/** 현재 값의 기준 문자열 — 저장이 끝나면 히든에 이 값이 실린다 */
export function evaluationDateBasisOf(values: Record<string, string>): string {
  return `${(values.issueDate ?? '').trim()}|${(values.evaluationPeriodMonths ?? '').trim()}`
}

/** 히든 기준 → 산식 입력. 형식이 아니면(조작·초기값 `''`) `null`이다 */
function parseBasis(raw: string | undefined): { issueDate: string; months: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2})\|(\d+)$/.exec((raw ?? '').trim())
  if (match == null) return null
  return { issueDate: match[1]!, months: Number.parseInt(match[2]!, 10) }
}

export type EvaluationDatePlan = {
  /** 현재 발행일·주기의 산식. 계산할 수 없으면 빈 배열이다 */
  formula: readonly string[]
  /**
   * 비어 있지 않은 칸이 **전부** 기준의 산식과 같은가 — 칸이 전부 비었으면 참이다.
   *
   * 기준이 없거나 쓸 수 없으면 현재 산식과 대조한다(첫 제출 · 기준이 비어 있던 입력).
   */
  formulaDerived: boolean
  /** 히든 기준이 있고 현재 발행일·주기와 다르다 */
  basisChanged: boolean
}

/**
 * 값 맵 → 이 제출에서 산식이 무엇을 해도 되는가. **저장·힌트가 이 함수 하나를 부른다.**
 *
 * 둘이 각자 판정하면 힌트가 「저장하면 채운다」고 말한 칸을 저장이 채우지 않는 날이 온다.
 */
export function evaluationDatePlanOf(values: Record<string, string>): EvaluationDatePlan {
  const rounds = roundCountOf(values)
  const formula = previewDatesOf(values)
  const basisRaw = (values[EVALUATION_DATE_BASIS_FIELD] ?? '').trim()
  const basis = parseBasis(basisRaw)

  const reference =
    basis == null
      ? formula
      : previewDates({
          issueDate: basis.issueDate,
          evaluationPeriodMonths: basis.months,
          totalRounds: rounds,
        })

  let formulaDerived = true
  for (let index = 0; index < rounds; index += 1) {
    const cell = (values[dateCell(index)] ?? '').trim()
    if (cell === '') continue
    if (cell !== reference[index]) {
      formulaDerived = false
      break
    }
  }

  return {
    formula,
    formulaDerived,
    basisChanged: basisRaw !== '' && basisRaw !== evaluationDateBasisOf(values),
  }
}

/**
 * 평가일 칸에 산식을 적용한다 — 배리어의 `applyBarriers`와 같은 짝이다
 *
 * | 모드 | 부르는 곳 | 동작 |
 * |---|---|---|
 * | `SUBMIT` | 저장 제출 | 날짜가 산식에서 왔으면(`formulaDerived`) **전 차수 재생성** — 오늘의 동작. 실제 날짜가 섞였으면 **옮기지 않고** 빈 칸도 채우지 않는다. 그 상태에서 기준이 바뀌었으면 **저장 보류**(`held`) |
 * | `OVERWRITE` | 「산식으로 다시 채우기」 | 전 차수를 덮는다. 산식과 다르던 칸의 수를 알린다 |
 *
 * **빈 칸을 채우는 조건도 `formulaDerived`다.** 실제 날짜가 있는 상품의 빈 칸을 전역
 * 산식으로 채우면 한 상품 안에 규약이 섞인다(E04000에 −1일 날짜가 끼어든다). 비워 두면
 * 계약의 V-07이 그 칸에 붙어 「날짜를 적는다」를 말한다.
 *
 * **저장 보류가 경고만이 아닌 이유** — 저장이 성공하면 리다이렉트로 화면이 바뀌므로 안내가
 * 남을 자리가 없다. 보류한 제출은 기준을 현재 값으로 올려 두므로 **재제출하면 저장된다.**
 *
 * 두 모드 모두 끝에 기준을 현재 값으로 올린다 — 이 제출 뒤의 칸이 그 기준에서 나온
 * 것이거나(재생성·덮기) 사용자가 그 기준 아래에서 확인한 것이기 때문이다.
 */
export function applyEvaluationDates(
  values: Record<string, string>,
  mode: 'SUBMIT' | 'OVERWRITE',
): { values: Record<string, string>; notice: string | null; held: boolean } {
  const rounds = roundCountOf(values)
  const plan = evaluationDatePlanOf(values)
  const next: Record<string, string> = {
    ...values,
    [EVALUATION_DATE_BASIS_FIELD]: evaluationDateBasisOf(values),
  }
  const computable = rounds > 0 && plan.formula.length === rounds

  if (mode === 'OVERWRITE') {
    if (!computable) {
      return {
        values,
        notice: '발행일·평가주기·총 차수를 먼저 입력한다.',
        held: false,
      }
    }
    let overwritten = 0
    for (let index = 0; index < rounds; index += 1) {
      const cell = (values[dateCell(index)] ?? '').trim()
      if (cell !== '' && cell !== plan.formula[index]) overwritten += 1
      next[dateCell(index)] = plan.formula[index]!
    }
    return {
      values: next,
      notice:
        overwritten === 0
          ? `평가일 ${rounds}개를 산식으로 채웠다.`
          : `평가일 ${rounds}개를 산식으로 채웠다 — 산식과 다르던 ${overwritten}개를 덮었다.`,
      held: false,
    }
  }

  if (plan.formulaDerived) {
    if (computable) {
      for (let index = 0; index < rounds; index += 1) {
        next[dateCell(index)] = plan.formula[index]!
      }
    }
    return { values: next, notice: null, held: false }
  }

  if (plan.basisChanged) {
    return {
      values: next,
      notice:
        '발행일·평가주기가 바뀌었지만 평가일은 옮기지 않았다 — 산식과 다른 날짜가 있기 때문이다. ' +
        '칸의 날짜를 확인하고 다시 저장한다. 산식대로 바꾸려면 「산식으로 다시 채우기」를 누른다.',
      held: true,
    }
  }

  return { values: next, notice: null, held: false }
}

export type EvaluationDateHint = {
  kind:
    | 'NO_FORMULA'
    | 'EMPTY_FILLS'
    | 'EMPTY_STAYS'
    | 'INVALID'
    | 'MATCHES'
    | 'MOVES'
    | 'DIFFERS'
    | 'FAR'
  /** 그 차수의 산식 날짜. 계산할 수 없으면 `null` */
  formula: string | null
  /** 칸 아래에 붙일 문구. 붙일 것이 없으면 `null` */
  text: string | null
}

/** 산식과 이만큼 넘게 다르면 날짜 자체보다 연·월 오타를 의심한다 — 실측 차이는 0~4일이다 */
const FAR_DAYS = 31

/**
 * 차수마다 칸 아래에 붙일 힌트 — **마지막으로 제출된 값**에서 나온다.
 *
 * 정확성이 이 힌트에 의존하지 않는다(저장 규칙은 `applyEvaluationDates`가 정한다). 이
 * 함수가 하는 일은 그 규칙이 이 칸에 무엇을 할지를 **미리 말하는 것**이다 — 그래서
 * 판정을 `evaluationDatePlanOf` 하나에서 받는다.
 *
 * 문구가 조사를 피한다(「{날짜}로」는 끝 숫자에 따라 「으로」가 된다).
 *
 * 던지지 않는다 — 형식이 아닌 칸은 `INVALID`이고 문구는 계약(V-07)이 낸다.
 */
export function evaluationDateHintsOf(
  values: Record<string, string>,
): EvaluationDateHint[] {
  const rounds = roundCountOf(values)
  const plan = evaluationDatePlanOf(values)
  const hints: EvaluationDateHint[] = []

  for (let index = 0; index < rounds; index += 1) {
    const cell = (values[dateCell(index)] ?? '').trim()
    const formula = plan.formula[index] ?? null

    if (cell === '') {
      if (!plan.formulaDerived) {
        hints.push({
          kind: 'EMPTY_STAYS',
          formula,
          text: '비어 있다 · 다른 차수가 산식과 달라 저장이 채우지 않는다',
        })
      } else if (formula == null) {
        hints.push({ kind: 'NO_FORMULA', formula, text: null })
      } else {
        hints.push({ kind: 'EMPTY_FILLS', formula, text: `저장하면 산식 ${formula}` })
      }
      continue
    }

    if (!ISO_DATE.test(cell) || !isCalendarDate(cell)) {
      hints.push({ kind: 'INVALID', formula, text: null })
      continue
    }
    if (formula == null) {
      hints.push({ kind: 'NO_FORMULA', formula, text: null })
      continue
    }
    if (cell === formula) {
      hints.push({ kind: 'MATCHES', formula, text: null })
      continue
    }
    if (plan.formulaDerived) {
      // 옛 기준의 산식 그대로다 — 저장이 새 기준으로 옮긴다.
      hints.push({ kind: 'MOVES', formula, text: `저장하면 바뀐다 · 산식 ${formula}` })
      continue
    }

    const gap = Math.abs(dDay({ from: formula, evaluationDate: cell }))
    hints.push(
      gap > FAR_DAYS
        ? {
            kind: 'FAR',
            formula,
            text: `산식 ${formula} · 한 달 넘게 차이 난다 — 연·월을 확인한다`,
          }
        : { kind: 'DIFFERS', formula, text: `산식은 ${formula}` },
    )
  }

  return hints
}

/** `2026-02-30`처럼 형식은 맞고 달력에 없는 날 — 순수 모듈이 던지는 것을 값으로 바꾼다 */
function isCalendarDate(iso: string): boolean {
  try {
    return shiftDays(iso, 0) === iso
  } catch {
    return false
  }
}
