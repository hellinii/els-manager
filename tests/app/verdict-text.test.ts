import { describe, expect, it } from 'vitest'

import type { EvaluationVerdictView } from '@/lib/db/queries/map'
import {
  EVALUATION_VERDICT_FRESH_DAYS,
  EVALUATION_VERDICT_GRADES,
  EVALUATION_VERDICT_LABELS,
  evaluationVerdictSentence,
  redeemPrefillNote,
} from '@/lib/format'

/**
 * 평가일 판정의 안내 문장 — DOC-008 SCR-202 「평가일 판정 안내」 · SCR-101 ⑥ (P6 컷 7-3)
 *
 * 상세와 홈이 같은 함수를 쓴다 — 문장이 갈리면 한 사실을 두 화면이 다르게 부른다.
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
      '2차 평가일(2026년 9월 15일)의 종가로 판정하면 조기상환 조건을 충족했다(워스트오브 81.45% ≥ 배리어 80% · 추정). 상환되었으면 기록한다.',
    )
    expect(evaluationVerdictSentence(view({ kind: 'LIZARD', barrier: '0.6500' }), KRW)).toContain(
      '리자드상환 조건을 충족했다(워스트오브 81.45% ≥ 배리어 65% · 추정)',
    )
  })

  it('만기 — 추정이 아니다(시세를 쓰지 않는다)', () => {
    const text = evaluationVerdictSentence(
      view({ kind: 'MATURITY_REACHED', roundNo: 6, evaluationDate: '2026-10-02', worstOf: null, barrier: null }),
      KRW,
    )
    expect(text).toBe('만기 평가일(2026년 10월 2일)이 지났다. 만기상환을 기록한다.')
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
    expect(text).toBe('1차 평가일(2026년 9월 25일)의 종가가 없어 판정하지 못했다(코스피200) — 증권사에서 직접 확인한다.')
  })

  it(`종가 없음 · 경과 ${EVALUATION_VERDICT_FRESH_DAYS}일 이내 — 「보통 다음 날 오후」(V0-ⓒ D+1 12/12)`, () => {
    const missing = { kind: 'CLOSE_MISSING' as const, worstOf: null, barrier: null, missingAssets: [{ assetId: 'a', assetName: 'S&P500' }] }
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -1 }), KRW)).toContain('평가일 종가는 보통 다음 날 오후에 들어온다.')
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -EVALUATION_VERDICT_FRESH_DAYS }), KRW)).toContain('보통 다음 날 오후')
    expect(evaluationVerdictSentence(view({ ...missing, dDay: -EVALUATION_VERDICT_FRESH_DAYS - 1 }), KRW)).not.toContain('보통 다음 날 오후')
  })

  it('종가 없음 · 주말로 저장된 평가일 — 할 일은 일정 수정이다(「다음 날 오후」보다 먼저)', () => {
    const text = evaluationVerdictSentence(
      view({ kind: 'CLOSE_MISSING', dDay: -1, worstOf: null, barrier: null, missingAssets: [], weekendEvaluation: true }),
      KRW,
    )
    expect(text).toContain('저장된 평가일이 주말이다 — 일정의 평가일을 고친다.')
    expect(text).not.toContain('보통 다음 날 오후')
  })

  it('월지급식이면 판정의 종류와 무관하게 V-29를 잇는다', () => {
    for (const kind of ['EARLY', 'MATURITY_REACHED', 'CLOSE_MISSING'] as const) {
      expect(evaluationVerdictSentence(view({ kind, missingAssets: [] }), { couponPayout: 'MONTHLY' }), kind).toMatch(
        /같은 날의 월수익은 상환에 합치지 않고 월수익 기록에 적는다\.$/,
      )
    }
    expect(evaluationVerdictSentence(view({}), KRW)).not.toContain('월수익')
  })

  it('지급방식을 모르면(null — 홈 ⑥) V-29 문장을 잇지 않는다 · 나머지는 상세와 같다', () => {
    expect(evaluationVerdictSentence(view({}), null)).toBe(evaluationVerdictSentence(view({}), KRW))
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

