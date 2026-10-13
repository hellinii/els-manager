import type { EvaluationVerdictView } from '@/lib/db/queries/map'
import type { CouponPayout } from '@/lib/domain'

import { korDate } from './date'
import { percent } from './ratio'

/**
 * 평가일 판정의 안내 문장 — DOC-008 SCR-202 「P6 컷 7-0 — 평가일 판정 안내」 · SCR-101 ⑥ (P6 컷 7-3)
 *
 * **한 사실을 두 화면이 같은 말로 부른다** — 상세(SCR-202)의 안내와 홈(SCR-101 ⑥)의 행이 이 함수를 쓴다. 페이지에
 * 두면 어느 스위트도 보지 못한다(AQ-23). ~~홈은 판정 넷 모두에 문장을 냈다~~ → 홈은 **말할 때만** 같은 문장을 낸다
 * *(홈 피드백 컷 K7 · 민서 결정(2026-10-12) D7)* — 그 판단은 `redemptionCheckNote`다.
 *
 * **문체는 해요체다**(DOC-005 §2.1 — 안내문 · 홈 피드백 컷 K7). 문장의 정본은 DOC-008 SCR-202 각주이고
 * `tests/app/verdict-text.test.ts`가 자리표시를 채운 형태로 「」째 결속한다(취소선 · 이력 행 밖의 글만 — `liveDoc`).
 * SCR-203의 `redeemPrefillNote`는 아직 다체다 — 그 화면은 이번 범위 밖이다(DOC-008 SQ-23).
 */

/**
 * 「다음 날 오후」 덧붙임(`EVALUATION_VERDICT_FRESH_NOTE`)을 붙이는 경과 일수의 상한 — **표시 상수다.**
 *
 * 근거는 운영 실측이다: 평가일 행 12/12가 D+1(14시 배치)이었고 그 밖의 자동 행도 최대 D+2였다(DOC-010 §6.2 V0-ⓒ).
 * 그 안의 결측은 «아직 안 왔을» 수 있고, 그 뒤의 결측은 휴장일 · 수집 실패 쪽이다(RD-21). 법령 요율이 아니므로
 * 주입 대상(절대 규칙 #5)이 아니다
 */
export const EVALUATION_VERDICT_FRESH_DAYS = 2

/*
 * 판정 문장 뒤의 덧붙임 셋 — 문장 하나씩이고 판정의 사실 뒤에 붙는다. export하는 것은 결속 테스트와 e2e가 리터럴을
 * 따로 두지 않게 하려는 것이다(문구가 바뀌는 날 음성 단언이 조용히 헛돌지 않게 — `emptyState.ts`의 같은 판단).
 */

/** 종가 없음 · 주말로 저장된 평가일 — 할 일이 시세 입력이 아니라 일정 수정이다(「다음 날 오후」보다 먼저) */
export const EVALUATION_VERDICT_WEEKEND_NOTE = '저장된 평가일이 주말이에요. 일정에서 평가일을 고치세요.'
/** 종가 없음 · 경과 `EVALUATION_VERDICT_FRESH_DAYS`일 이내 — 아직 안 왔을 수 있다(DOC-010 V0-ⓒ D+1 12/12) */
export const EVALUATION_VERDICT_FRESH_NOTE = '평가일 종가는 보통 다음 날 오후에 들어와요.'
/** 월지급식 상품 — SCR-203의 V-29 힌트와 같은 말을 미리 한다(판정의 종류와 무관) */
export const EVALUATION_VERDICT_MONTHLY_NOTE = '같은 날 월수익은 상환에 합치지 말고 월수익 기록에 적으세요.'

/**
 * SCR-203 — 판정(또는 `?round=k`)에서 온 첫 렌더의 안내 (DOC-008 SCR-203 v2.46).
 *
 * **실제로 채운 것을 말한다.** 한 문장으로 두었던 v2.44는 유형을 비운 경로(만기 · 종가 없음 · 요청 ≠ 판정)와 금액을 비운
 * 경로(KI 터치가 기록된 만기)에서 거짓이었다. 상환일 안내(「연휴면 하루이틀 밀릴 수 있다」)는 칸 힌트가 차수를 «바꿀» 때만
 * 내므로 첫 렌더에는 여기서 말한다. **차수 번호를 박지 않는다** — 서버 렌더라 사용자가 차수를 바꿔도 남는다(v2.7)
 */
export function redeemPrefillNote(outcome: { typeFilled: boolean; amountsBlankedByKiTouch: boolean }): string {
  return [
    '방금 지난 차수(상환 확인 필요) 기준으로 채웠다.',
    outcome.typeFilled ? '유형은 그 평가일 종가로 낸 판정(추정)이다.' : '유형은 비웠다 — 거래내역을 보고 고른다.',
    ...(outcome.amountsBlankedByKiTouch
      ? ['KI 터치가 기록된 만기라 실수령액 · 과세 금융소득을 비웠다 — 손실일 수 있다.']
      : []),
    '상환일은 그 평가일 + 5일이다 — 연휴에 걸리면 하루이틀 밀릴 수 있으니 거래내역의 날짜로 고친다.',
  ].join(' ')
}

/**
 * 안내 한 문단. 첫 문장이 사실이고, 뒤는 그 사실에 따라 붙는 덧붙임이다.
 *
 * - 충족 — 「추정」을 붙인다: 리자드는 하루 판정의 근사이고(DOC-007 RD-07) 종가는 우리가 모은 값이다
 * - 만기 — 시세를 쓰지 않으므로 추정이 아니다(만기에는 이월이 없다)
 * - 종가 없음 — 결측 자산을 이름으로. 주말로 저장된 평가일이면 할 일이 시세 입력이 아니라 **일정 수정**이다
 * - 월지급식 — 상환을 기록하러 가는 문장이므로 SCR-203의 V-29 힌트와 같은 말을 미리 한다(판정의 종류와 무관)
 */
export function evaluationVerdictSentence(
  verdict: EvaluationVerdictView,
  /**
   * 상품의 쿠폰 지급방식 — 월지급식이면 V-29 문장을 잇는다. **`null` = 모른다**(홈 ⑥ — `redemptionChecks`는 지급방식을
   * 싣지 않는다). 그때는 잇지 않는다 — 그 문장은 기록하는 자리(SCR-203)의 힌트가 다시 말한다. 기본값을 두지 않는다
   */
  context: { couponPayout: CouponPayout } | null,
): string {
  const date = korDate(verdict.evaluationDate)
  const sentences: string[] = []

  switch (verdict.kind) {
    case 'EARLY':
    case 'LIZARD': {
      const what = verdict.kind === 'EARLY' ? '조기상환' : '리자드상환'
      const basis =
        verdict.worstOf != null && verdict.barrier != null
          ? `워스트오브 ${percent(verdict.worstOf)} ≥ 배리어 ${percent(verdict.barrier)} · 추정`
          : '추정'
      sentences.push(
        `${verdict.roundNo}차 평가일(${date}) 종가로는 ${what} 조건을 충족했어요(${basis}). 상환됐다면 기록하세요.`,
      )
      break
    }
    case 'MATURITY_REACHED':
      sentences.push(`만기 평가일(${date})이 지났어요. 만기상환을 기록하세요.`)
      break
    case 'CLOSE_MISSING': {
      const names = (verdict.missingAssets ?? []).map((asset) => asset.assetName).join(' · ')
      sentences.push(
        `${verdict.roundNo}차 평가일(${date}) 종가가 없어 판정하지 못했어요(${names}). 증권사에서 직접 확인하세요.`,
      )
      if (verdict.weekendEvaluation) {
        sentences.push(EVALUATION_VERDICT_WEEKEND_NOTE)
      } else if (-verdict.dDay <= EVALUATION_VERDICT_FRESH_DAYS) {
        sentences.push(EVALUATION_VERDICT_FRESH_NOTE)
      }
      break
    }
  }

  if (context?.couponPayout === 'MONTHLY') {
    sentences.push(EVALUATION_VERDICT_MONTHLY_NOTE)
  }
  return sentences.join(' ')
}

/**
 * 홈 ⑥의 행 안내 — **행에 없는 사실이 있을 때만 말한다** *(홈 피드백 컷 K7 · 민서 결정(2026-10-12) D7 · DOC-008 SCR-101
 * 「홈 피드백 컷 K0」 ⑥)*.
 *
 * 그런 판정은 평가일 종가 없음 하나다 — 결측 자산의 이름 · 주말로 저장된 평가일 · 「다음 날 오후」는 행의 어디에도 없다.
 * 충족은 배지와 수치 줄(평가일 워스트오브 · 배리어)이, 만기는 배지 · 「k차 · 평가일 · D+n」 · [상환 처리]가 이미 같은
 * 말을 한다(만기 문장은 남의 상품에서 버튼 없이 기록을 지시하게 된다 — ST-04). 충족의 「추정」은 블록 안내가 말한다
 * (ST-05 — 행의 문장이 빠져도 추정 표식은 남는다).
 *
 * **말할 때는 상세(SCR-202)와 같은 함수의 같은 문장이다** — 지급방식은 홈 계약에 없으므로 `null`(V-29 문장은 SCR-203이
 * 말한다). 상세는 이 함수를 쓰지 않는다 — 그 화면의 안내는 상품 하나의 유일한 판정 자리라 넷 모두에 문장을 낸다.
 */
const SAYS_ON_HOME: Record<EvaluationVerdictView['kind'], boolean> = {
  EARLY: false,
  LIZARD: false,
  MATURITY_REACHED: false,
  CLOSE_MISSING: true,
}

export function redemptionCheckNote(verdict: EvaluationVerdictView): string | null {
  return SAYS_ON_HOME[verdict.kind] ? evaluationVerdictSentence(verdict, null) : null
}
