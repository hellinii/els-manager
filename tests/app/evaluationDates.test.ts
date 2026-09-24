import { describe, expect, it } from 'vitest'

import {
  EVALUATION_DATE_BASIS_FIELD,
  applyEvaluationDates,
  evaluationDateBasisOf,
  evaluationDateHintsOf,
  evaluationDatePlanOf,
  previewDates,
} from '@/lib/forms/schedules'

/**
 * 평가일 칸 — 산식이 움직여도 되는가 (DOC-008 §5 SCR-204 v2.8 · DOC-002 §4.8 v1.6)
 *
 * 평가일이 생성값에서 차수별 입력값으로 바뀌면서 산식은 **채우는 도구**가 됐다. 이 파일이
 * 지키는 것은 그 도구가 **실제 날짜를 덮지 않는다**는 것과, 산식에서 온 날짜는 **발행일을
 * 따라간다**는 것 — 둘이 같은 제출 안에서 갈린다.
 *
 * ## 픽스처는 실측이다
 *
 * E04000(키움 ELS 4000회)의 실제 평가일은 키움 공개 상품 페이지에서 받았다
 * (`fndElsDetailPopup?salFundCd=E04000`, 2026-09-23). 산식 날짜는 **리터럴로** 적는다 —
 * `previewDates`로 기대값을 만들면 산식이 틀려도 초록이다.
 */

const E04000 = {
  issueDate: '2026-05-29',
  months: '6',
  /** 1~5차 + 만기(마지막 평균일, DQ-10) */
  actual: ['2026-11-30', '2027-05-31', '2027-11-29', '2028-05-29', '2028-11-29', '2029-05-29'],
  /** `발행일 + n × 6개월 − 1일` */
  formula: ['2026-11-28', '2027-05-28', '2027-11-28', '2028-05-28', '2028-11-28', '2029-05-28'],
}

function valuesWith(input: {
  issueDate: string
  months: string
  dates: readonly string[]
  basis?: string
  totalRounds?: string
}): Record<string, string> {
  const values: Record<string, string> = {
    issueDate: input.issueDate,
    evaluationPeriodMonths: input.months,
    totalRounds: input.totalRounds ?? String(input.dates.length),
    [EVALUATION_DATE_BASIS_FIELD]: input.basis ?? '',
  }
  input.dates.forEach((date, index) => {
    values[`schedules[${index}].evaluationDate`] = date
  })
  return values
}

const datesOf = (values: Record<string, string>): string[] => {
  const out: string[] = []
  for (let index = 0; values[`schedules[${index}].evaluationDate`] != null; index += 1) {
    out.push(values[`schedules[${index}].evaluationDate`]!)
  }
  return out
}

describe('전제 — 픽스처가 퇴화하지 않았다', () => {
  it('E04000의 실제 날짜는 산식과 여섯 차수 전부가 다르다', () => {
    expect(
      previewDates({ issueDate: E04000.issueDate, evaluationPeriodMonths: 6, totalRounds: 6 }),
    ).toEqual(E04000.formula)
    E04000.actual.forEach((date, index) => expect(date).not.toBe(E04000.formula[index]))
  })

  it('기준 문자열은 발행일|주기다', () => {
    expect(
      evaluationDateBasisOf({ issueDate: ' 2026-05-29 ', evaluationPeriodMonths: '6' }),
    ).toBe('2026-05-29|6')
  })
})

describe('저장 — 산식에서 온 날짜는 발행일을 따라간다 (운영 11건의 경로)', () => {
  it('칸이 전부 비었으면 산식으로 채우고 기준을 올린다', () => {
    const { values, held, notice } = applyEvaluationDates(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: ['', '', '', '', '', ''] }),
      'SUBMIT',
    )
    expect(datesOf(values)).toEqual(E04000.formula)
    expect(values[EVALUATION_DATE_BASIS_FIELD]).toBe('2026-05-29|6')
    expect([held, notice]).toEqual([false, null])
  })

  it('★ 옛 기준의 산식 그대로인 날짜는 새 발행일로 옮겨진다', () => {
    // 수정 화면: 저장값이 산식대로이고 발행일을 하루 당겨 고쳤다.
    const before = valuesWith({
      issueDate: '2026-05-28',
      months: '6',
      dates: E04000.formula,
      basis: '2026-05-29|6',
    })
    const { values, held } = applyEvaluationDates(before, 'SUBMIT')

    const moved = ['2026-11-27', '2027-05-27', '2027-11-27', '2028-05-27', '2028-11-27', '2029-05-27']
    expect(datesOf(values)).toEqual(moved)
    expect(held).toBe(false)
    // 음성 대조 — 옮기지 않았다면 옛 날짜가 남는다
    expect(moved).not.toEqual(E04000.formula)
  })

  it('기준이 없고 칸이 현재 산식과 같으면 산식에서 온 것으로 본다', () => {
    const plan = evaluationDatePlanOf(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: E04000.formula }),
    )
    expect(plan.formulaDerived).toBe(true)
  })
})

describe('저장 — 실제 날짜는 산식이 건드리지 않는다', () => {
  it('★ 기준이 그대로면 실제 날짜를 그대로 저장한다', () => {
    const before = valuesWith({
      issueDate: E04000.issueDate,
      months: '6',
      dates: E04000.actual,
      basis: '2026-05-29|6',
    })
    const { values, held, notice } = applyEvaluationDates(before, 'SUBMIT')
    expect(datesOf(values)).toEqual(E04000.actual)
    expect([held, notice]).toEqual([false, null])
  })

  it('★ 발행일이 바뀌면 옮기지 않고 저장을 한 번 보류한다 — 재제출하면 저장된다', () => {
    const before = valuesWith({
      issueDate: '2026-05-28',
      months: '6',
      dates: E04000.actual,
      basis: '2026-05-29|6',
    })
    const first = applyEvaluationDates(before, 'SUBMIT')
    expect(first.held).toBe(true)
    expect(first.notice).toContain('평가일은 옮기지 않았다')
    expect(datesOf(first.values)).toEqual(E04000.actual)
    expect(first.values[EVALUATION_DATE_BASIS_FIELD]).toBe('2026-05-28|6')

    const second = applyEvaluationDates(first.values, 'SUBMIT')
    expect(second.held).toBe(false)
    expect(datesOf(second.values)).toEqual(E04000.actual)
  })

  it('주기만 바뀌어도 보류한다', () => {
    const { held } = applyEvaluationDates(
      valuesWith({ issueDate: E04000.issueDate, months: '3', dates: E04000.actual, basis: '2026-05-29|6' }),
      'SUBMIT',
    )
    expect(held).toBe(true)
  })

  it('★ 실제 날짜가 섞인 상품의 빈 칸은 채우지 않는다 — 한 상품에 규약이 섞이지 않는다', () => {
    const dates = [...E04000.actual.slice(0, 5), '']
    const { values, held } = applyEvaluationDates(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates, basis: '2026-05-29|6' }),
      'SUBMIT',
    )
    expect(datesOf(values)).toEqual(dates)
    expect(held).toBe(false)
    // 음성 대조 — 산식이었다면 −1일 날짜가 끼어든다
    expect(E04000.formula[5]).toBe('2029-05-28')
  })

  it('조작된 기준은 없는 것으로 보고 현재 산식과 대조한다', () => {
    for (const basis of ['garbage', '2026-05-29', '2026-05-29|x', '|6']) {
      const plan = evaluationDatePlanOf(
        valuesWith({ issueDate: E04000.issueDate, months: '6', dates: E04000.formula, basis }),
      )
      expect(plan.formulaDerived, basis).toBe(true)
    }
  })
})

describe('「산식으로 다시 채우기」 — 전 차수를 덮는다', () => {
  it('실제 날짜를 덮고 그 수를 알린다', () => {
    const { values, notice, held } = applyEvaluationDates(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: E04000.actual, basis: '2026-05-29|6' }),
      'OVERWRITE',
    )
    expect(datesOf(values)).toEqual(E04000.formula)
    expect(notice).toBe('평가일 6개를 산식으로 채웠다 — 산식과 다르던 6개를 덮었다.')
    expect(held).toBe(false)
  })

  it('이미 산식대로면 덮은 수를 말하지 않는다', () => {
    const { notice } = applyEvaluationDates(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: ['', ...E04000.formula.slice(1)] }),
      'OVERWRITE',
    )
    expect(notice).toBe('평가일 6개를 산식으로 채웠다.')
  })

  it('산식을 계산할 수 없으면 값을 바꾸지 않고 이유를 말한다', () => {
    const before = valuesWith({ issueDate: '', months: '6', dates: E04000.actual, basis: '2026-05-29|6' })
    const { values, notice } = applyEvaluationDates(before, 'OVERWRITE')
    expect(values).toBe(before)
    expect(notice).toBe('발행일·평가주기·총 차수를 먼저 입력한다.')
  })
})

describe('칸 힌트 — 저장 규칙이 그 칸에 무엇을 할지 미리 말한다', () => {
  it('빈 칸: 산식에서 온 상품이면 채울 날짜를, 실제 날짜가 섞였으면 채우지 않는다고 말한다', () => {
    const empty = evaluationDateHintsOf(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: ['', ''] , totalRounds: '2' }),
    )
    expect(empty.map((h) => h.kind)).toEqual(['EMPTY_FILLS', 'EMPTY_FILLS'])
    expect(empty[0]!.text).toBe('저장하면 산식 2026-11-28')

    const mixed = evaluationDateHintsOf(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: [E04000.actual[0]!, ''] }),
    )
    expect(mixed.map((h) => h.kind)).toEqual(['DIFFERS', 'EMPTY_STAYS'])
    expect(mixed[0]!.text).toBe('산식은 2026-11-28')
  })

  it('옛 기준의 산식이면 「저장하면 바뀐다」', () => {
    const hints = evaluationDateHintsOf(
      valuesWith({ issueDate: '2026-05-28', months: '6', dates: [E04000.formula[0]!], basis: '2026-05-29|6' }),
    )
    expect(hints[0]).toEqual({
      kind: 'MOVES',
      formula: '2026-11-27',
      text: '저장하면 바뀐다 · 산식 2026-11-27',
    })
  })

  it('한 달 넘게 다르면 연·월 오타를 의심한다 — 경계는 31일', () => {
    const at = (date: string) =>
      evaluationDateHintsOf(
        valuesWith({ issueDate: E04000.issueDate, months: '6', dates: [date], basis: '2026-05-29|6' }),
      )[0]!.kind
    expect(at('2026-12-29')).toBe('DIFFERS') // +31일
    expect(at('2026-12-30')).toBe('FAR') // +32일
    expect(at('2027-11-28')).toBe('FAR') // 연 오타
  })

  it('산식과 같으면 말하지 않는다', () => {
    const hints = evaluationDateHintsOf(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: E04000.formula }),
    )
    expect(hints.every((h) => h.kind === 'MATCHES' && h.text == null)).toBe(true)
  })

  it('형식이 아니거나 달력에 없는 날은 INVALID이고 문구는 계약이 낸다', () => {
    const hints = evaluationDateHintsOf(
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: ['2026-02-30', 'garbage', '2026-13-01'] }),
    )
    expect(hints.map((h) => [h.kind, h.text])).toEqual([
      ['INVALID', null],
      ['INVALID', null],
      ['INVALID', null],
    ])
  })

  it('★ 힌트와 저장이 갈리지 않는다 — 「채운다」고 말한 칸만 저장이 채운다', () => {
    const cases = [
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: ['', '', ''] }),
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: [E04000.actual[0]!, '', ''] }),
      valuesWith({ issueDate: E04000.issueDate, months: '6', dates: [E04000.formula[0]!, '', ''], basis: '2026-05-29|6' }),
      valuesWith({ issueDate: '', months: '6', dates: ['', '', ''] }),
    ]
    for (const values of cases) {
      const hints = evaluationDateHintsOf(values)
      const after = datesOf(applyEvaluationDates(values, 'SUBMIT').values)
      hints.forEach((hint, index) => {
        const before = values[`schedules[${index}].evaluationDate`]!
        if (hint.kind === 'EMPTY_FILLS') expect(after[index]).toBe(hint.formula)
        if (hint.kind === 'EMPTY_STAYS' || hint.kind === 'NO_FORMULA') expect(after[index]).toBe(before)
      })
    }
  })
})

describe('던지지 않는다 — 폼은 덜 채운 상태로 렌더되는 것이 정상이다', () => {
  it('쓰레기 입력에도 값이 나온다', () => {
    const garbage: Record<string, string>[] = [
      { issueDate: 'x', evaluationPeriodMonths: 'abc', totalRounds: '3' },
      { issueDate: '2026-02-30', evaluationPeriodMonths: '6', totalRounds: '2', 'schedules[0].evaluationDate': '????' },
      { totalRounds: '99999' },
      {},
    ]
    for (const values of garbage) {
      expect(() => evaluationDateHintsOf(values)).not.toThrow()
      expect(() => applyEvaluationDates(values, 'SUBMIT')).not.toThrow()
      expect(() => applyEvaluationDates(values, 'OVERWRITE')).not.toThrow()
    }
  })
})
