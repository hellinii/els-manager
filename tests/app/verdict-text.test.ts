import { describe, expect, it } from 'vitest'

import type { EvaluationVerdictKind, EvaluationVerdictView } from '@/lib/db/queries/map'
import {
  EVALUATION_VERDICT_FRESH_DAYS,
  EVALUATION_VERDICT_FRESH_NOTE,
  EVALUATION_VERDICT_GRADES,
  EVALUATION_VERDICT_LABELS,
  EVALUATION_VERDICT_MONTHLY_NOTE,
  EVALUATION_VERDICT_WEEKEND_NOTE,
  evaluationVerdictSentence,
  korDate,
  percent,
  redeemPrefillNote,
  redemptionCheckNote,
} from '@/lib/format'

import { liveDoc, quoteBlock } from './docText'

/**
 * 평가일 판정의 안내 문장 — DOC-008 SCR-202 「평가일 판정 안내」 · SCR-101 ⑥ (P6 컷 7-3)
 *
 * 상세와 홈이 같은 함수를 쓴다 — 문장이 갈리면 한 사실을 두 화면이 다르게 부른다. ~~홈은 넷 모두에 문장을 낸다~~ →
 * 홈은 **말할 때만** 같은 문장이다(`redemptionCheckNote` — 홈 피드백 컷 K7 · 민서 결정(2026-10-12) D7). 문체는 해요체다
 * (DOC-005 §2.1 · 홈 피드백 컷 K7).
 */

function view(overrides: Partial<EvaluationVerdictView>): EvaluationVerdictView {
  return {
    kind: 'EARLY',
    roundNo: 2,
    evaluationDate: '2026-09-15',
    dDay: -26,
    worstOf: '0.8145',
    barrier: '0.8000',
    missingAssets: null,
    weekendEvaluation: false,
    ...overrides,
  }
}

const KRW = { couponPayout: 'AT_REDEMPTION' as const }

describe('evaluationVerdictSentence', () => {
  it('조건 충족 — 차수 · 평가일 · 평가일 W 대 배리어 · 「추정」 · 기록하라', () => {
    expect(evaluationVerdictSentence(view({}), KRW)).toBe(
      '2차 평가일(2026년 9월 15일) 종가로는 조기상환 조건을 충족했어요(워스트오브 81.45% ≥ 배리어 80% · 추정). 상환됐다면 기록하세요.',
    )
    expect(evaluationVerdictSentence(view({ kind: 'LIZARD', barrier: '0.6500' }), KRW)).toContain(
      '리자드상환 조건을 충족했어요(워스트오브 81.45% ≥ 배리어 65% · 추정)',
    )
  })

  it('만기 — 추정이 아니다(시세를 쓰지 않는다)', () => {
    const text = evaluationVerdictSentence(
      view({ kind: 'MATURITY_REACHED', roundNo: 6, evaluationDate: '2026-10-02', worstOf: null, barrier: null }),
      KRW,
    )
    expect(text).toBe('만기 평가일(2026년 10월 2일)이 지났어요. 만기상환을 기록하세요.')
    expect(text).not.toContain('추정')
  })

  it('종가 없음 — 결측 자산의 이름 · 증권사에서 직접 확인', () => {
    const text = evaluationVerdictSentence(
      view({
        kind: 'CLOSE_MISSING',
        roundNo: 1,
        evaluationDate: '2026-09-25',
        dDay: -16,
        worstOf: null,
        barrier: null,
        missingAssets: [{ assetId: 'a', assetName: '코스피200' }],
      }),
      KRW,
    )
    expect(text).toBe('1차 평가일(2026년 9월 25일) 종가가 없어 판정하지 못했어요(코스피200). 증권사에서 직접 확인하세요.')
  })

  it(`종가 없음 · 경과 ${EVALUATION_VERDICT_FRESH_DAYS}일 이내 — 「보통 다음 날 오후」(V0-ⓒ D+1 12/12)`, () => {
    const missing = { kind: 'CLOSE_MISSING' as const, worstOf: null, barrier: null, missingAssets: [{ assetId: 'a', assetName: 'S&P500' }] }
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -1 }), KRW)).toContain('평가일 종가는 보통 다음 날 오후에 들어와요.')
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -EVALUATION_VERDICT_FRESH_DAYS }), KRW)).toContain('보통 다음 날 오후')
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -EVALUATION_VERDICT_FRESH_DAYS - 1 }), KRW)).not.toContain('보통 다음 날 오후')
  })

  it('종가 없음 · 주말로 저장된 평가일 — 할 일은 일정 수정이다(「다음 날 오후」보다 먼저)', () => {
    const text = evaluationVerdictSentence(
      view({ kind: 'CLOSE_MISSING', dDay: -1, worstOf: null, barrier: null, missingAssets: [], weekendEvaluation: true }),
      KRW,
    )
    expect(text).toContain('저장된 평가일이 주말이에요. 일정에서 평가일을 고치세요.')
    expect(text).not.toContain('보통 다음 날 오후')
  })

  it('월지급식이면 판정의 종류와 무관하게 V-29를 잇는다', () => {
    for (const kind of ['EARLY', 'MATURITY_REACHED', 'CLOSE_MISSING'] as const) {
      expect(
        evaluationVerdictSentence(view({ kind, missingAssets: [] }), { couponPayout: 'MONTHLY' }).endsWith(
          ` ${EVALUATION_VERDICT_MONTHLY_NOTE}`,
        ),
        kind,
      ).toBe(true)
    }
    expect(evaluationVerdictSentence(view({}), KRW)).not.toContain('월수익')
  })

  it('지급방식을 모르면(null — 홈 ⑥) V-29 문장을 잇지 않는다 · 나머지는 상세와 같다', () => {
    expect(evaluationVerdictSentence(view({}), null)).toBe(evaluationVerdictSentence(view({}), KRW))
  })
})

const DOC_008 = '08_정보구조_및_화면목록.md'

/** 판정 축의 값 전부 — 라벨 표가 축의 정본이다(`labels.test.ts`가 `LABEL_AXES`와 대조한다) */
const KINDS = Object.keys(EVALUATION_VERDICT_LABELS) as EvaluationVerdictKind[]

describe('문장 ↔ DOC-008 SCR-202 「평가일 판정 안내」 각주 (취소선 · 이력 행 밖 · 홈 피드백 컷 K7)', () => {
  /*
   * 문장의 정본은 그 각주다. 종전 문장이 취소선으로 남아 있으므로 원문에 걸면 코드를 되돌려도 초록이다 — 살아 있는 글
   * (`liveDoc`)의 **그 각주 블록 하나**에만 건다. 같은 문장을 SCR-101 ⑥ 「버튼」 항목도 인용하므로 문서 전체에 걸면
   * 정본에서 지워도 초록이다
   */
  const footnote = quoteBlock(liveDoc(DOC_008), '> **P6 컷 7-0 — 평가일 판정 안내')

  /** 함수 출력의 값 자리를 각주의 자리표시로 — 차수 · 날짜 · W · B · 유형 · 자산명. 바뀐 자리가 없으면 그대로 남는다 */
  function templated(text: string, v: EvaluationVerdictView): string {
    let t = text.replace(`${v.roundNo}차 평가일`, '{k}차 평가일').replace(korDate(v.evaluationDate), '{날짜}')
    if (v.worstOf != null) t = t.replace(percent(v.worstOf), '{W}')
    if (v.barrier != null) t = t.replace(percent(v.barrier), '{B}')
    t = t.replace(/(?:조기상환|리자드상환) 조건/, '{조기상환|리자드상환} 조건')
    if (v.missingAssets != null) t = t.replace(v.missingAssets.map((a) => a.assetName).join(' · '), '{자산명}')
    return t
  }

  it('충족 — 조기상환 · 리자드가 같은 틀이고 그 틀이 각주에 있다', () => {
    const early = templated(evaluationVerdictSentence(view({}), null), view({}))
    const lizardView = view({ kind: 'LIZARD', barrier: '0.6500' })
    // 전제 — 값 자리가 전부 자리표시가 됐다(안 됐으면 아래 결속은 우연히만 맞는다)
    for (const slot of ['{k}', '{날짜}', '{W}', '{B}', '{조기상환|리자드상환}']) expect(early).toContain(slot)
    expect(templated(evaluationVerdictSentence(lizardView, null), lizardView)).toBe(early)
    expect(footnote).toContain(`「${early}」`)
  })

  it('만기 · 종가 없음(자산 하나 · 여럿) — 각주에 있다', () => {
    const maturity = view({ kind: 'MATURITY_REACHED', roundNo: 6, worstOf: null, barrier: null })
    expect(footnote).toContain(`「${templated(evaluationVerdictSentence(maturity, null), maturity)}」`)

    const assets = [
      { assetId: 'a', assetName: '코스피200' },
      { assetId: 'b', assetName: 'S&P500' },
    ]
    for (const missingAssets of [assets.slice(0, 1), assets]) {
      const missing = view({ kind: 'CLOSE_MISSING', dDay: -10, worstOf: null, barrier: null, missingAssets })
      const text = templated(evaluationVerdictSentence(missing, null), missing)
      expect(text).toContain('{자산명}')
      expect(footnote).toContain(`「${text}」`)
    }
  })

  it.each([
    ['주말', EVALUATION_VERDICT_WEEKEND_NOTE],
    ['다음 날 오후', EVALUATION_VERDICT_FRESH_NOTE],
    ['월지급', EVALUATION_VERDICT_MONTHLY_NOTE],
  ])('덧붙임 %s — 상수가 각주에 「」째로 있다', (_name, note) => {
    expect(footnote).toContain(`「${note}」`)
  })

  it('덧붙임은 함수가 실제로 잇는 그 상수다 — 상수만 고치고 함수가 리터럴을 쓰면 위 결속이 헛돈다', () => {
    const missing = { kind: 'CLOSE_MISSING' as const, worstOf: null, barrier: null, missingAssets: [] }
    expect(evaluationVerdictSentence(view({ ...missing, weekendEvaluation: true }), null).endsWith(` ${EVALUATION_VERDICT_WEEKEND_NOTE}`)).toBe(true)
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -1 }), null).endsWith(` ${EVALUATION_VERDICT_FRESH_NOTE}`)).toBe(true)
  })
})

describe('redemptionCheckNote — 홈 ⑥ 행의 안내는 평가일 종가 없음일 때만 (D7 · 홈 피드백 컷 K7)', () => {
  const closeMissing = (overrides: Partial<EvaluationVerdictView>) =>
    view({
      kind: 'CLOSE_MISSING',
      worstOf: null,
      barrier: null,
      missingAssets: [{ assetId: 'a', assetName: '코스피200' }],
      ...overrides,
    })

  it('★ 충족 · 만기는 말하지 않는다 — 배지 · 수치 줄 · [상환 처리]가 이미 같은 말을 한다', () => {
    expect(redemptionCheckNote(view({}))).toBeNull()
    expect(redemptionCheckNote(view({ kind: 'LIZARD', barrier: '0.6500' }))).toBeNull()
    // W · B가 없는 충족(판정 근거가 빠진 행)도 같다 — 갈래는 판정의 종류만 본다
    expect(redemptionCheckNote(view({ worstOf: null, barrier: null }))).toBeNull()
    expect(redemptionCheckNote(view({ kind: 'MATURITY_REACHED', worstOf: null, barrier: null }))).toBeNull()
  })

  it('★ 종가 없음은 상세와 같은 함수의 같은 문장이다 — 평일 · 주말 · 다음 날 이내 셋 다', () => {
    for (const v of [
      closeMissing({ dDay: -10 }),
      closeMissing({ dDay: -1, weekendEvaluation: true }),
      closeMissing({ dDay: -1 }),
    ]) {
      const note = redemptionCheckNote(v)
      expect(note).toBe(evaluationVerdictSentence(v, null))
      // 행에 없는 사실 — 결측 자산의 이름
      expect(note).toContain('코스피200')
    }
  })

  it('지급방식을 모른다 — V-29(월지급) 문장을 잇지 않는다(그 문장은 SCR-203이 말한다)', () => {
    expect(redemptionCheckNote(closeMissing({}))).not.toContain(EVALUATION_VERDICT_MONTHLY_NOTE)
  })

  it('판정 축 전부 — 결과는 null이거나 상세의 문장 그대로이고, 말하는 판정은 종가 없음 하나다', () => {
    expect(KINDS).toHaveLength(4)
    const says = KINDS.filter((kind) => {
      const v = view({ kind, missingAssets: kind === 'CLOSE_MISSING' ? [] : null })
      const note = redemptionCheckNote(v)
      if (note != null) expect(note, kind).toBe(evaluationVerdictSentence(v, null))
      return note != null
    })
    expect(says).toEqual(['CLOSE_MISSING'])
  })
})

describe('평가일 판정의 표시 · 등급', () => {
  it('「예상」을 붙이지 않는다 — 지난 평가일이다(DOC-005 §8.12)', () => {
    for (const label of Object.values(EVALUATION_VERDICT_LABELS)) expect(label).not.toContain('예상')
  })

  it('★ 충족은 positive가 아니다 — positive는 확정된 상환의 등급이다(GQ-09)', () => {
    expect(Object.values(EVALUATION_VERDICT_GRADES)).not.toContain('positive')
    expect(EVALUATION_VERDICT_GRADES.CLOSE_MISSING).toBe('caution')
  })

  it('★ 충족 · 만기는 attention도 아니다 — 할 일이 기록이다(record · 홈 피드백 컷 K3 · 민서 결정(2026-10-12) D1)', () => {
    // 위 단언(positive 금지)은 attention으로 되돌려도 초록이다 — 빨강이 조건 충족을 경고로 읽게 한 것(피드백 #1)을
    // 다시 들이지 않게 여기서 따로 막는다
    expect(Object.values(EVALUATION_VERDICT_GRADES)).not.toContain('attention')
    expect(EVALUATION_VERDICT_GRADES.EARLY).toBe('record')
    expect(EVALUATION_VERDICT_GRADES.LIZARD).toBe('record')
    expect(EVALUATION_VERDICT_GRADES.MATURITY_REACHED).toBe('record')
  })
})

describe('redeemPrefillNote — SCR-203 안내는 실제로 채운 것을 말한다 (DOC-008 SCR-203 v2.46)', () => {
  it('유형을 채웠으면 「평가일 종가로 낸 판정(추정)」 · 상환일 안내에 연휴 문장', () => {
    const text = redeemPrefillNote({ typeFilled: true, amountsBlankedByKiTouch: false })
    expect(text).toContain('유형은 그 평가일 종가로 낸 판정(추정)이다.')
    expect(text).toContain('연휴에 걸리면 하루이틀 밀릴 수 있으니 거래내역의 날짜로 고친다.')
    expect(text).not.toContain('비웠다')
  })

  it('유형을 비웠으면(만기 · 종가 없음 · 요청 ≠ 판정) 판정이라고 말하지 않는다', () => {
    const text = redeemPrefillNote({ typeFilled: false, amountsBlankedByKiTouch: false })
    expect(text).toContain('유형은 비웠다 — 거래내역을 보고 고른다.')
    expect(text).not.toContain('판정(추정)')
  })

  it('KI 터치 만기로 금액을 비웠으면 그 사실과 이유를 말한다', () => {
    expect(redeemPrefillNote({ typeFilled: false, amountsBlankedByKiTouch: true })).toContain(
      'KI 터치가 기록된 만기라 실수령액 · 과세 금융소득을 비웠다 — 손실일 수 있다.',
    )
  })

  it('차수 번호를 박지 않는다 — 서버 렌더라 사용자가 차수를 바꿔도 남는다(v2.7)', () => {
    for (const typeFilled of [true, false]) {
      expect(redeemPrefillNote({ typeFilled, amountsBlankedByKiTouch: !typeFilled })).not.toMatch(/\d+차/)
    }
  })
})

