import type { EvaluationVerdictView } from '@/lib/db/queries/map'
import type { CouponPayout } from '@/lib/domain'

import { korDate } from './date'
import { percent } from './ratio'

/**
 * 평가일 판정의 안내 문장 — DOC-008 SCR-202 「P6 컷 7-0 — 평가일 판정 안내」 · SCR-101 ⑥ (P6 컷 7-3)
 *
 * **한 사실을 두 화면이 같은 말로 부른다** — 상세(SCR-202)의 안내와 홈(SCR-101 ⑥)의 행이 이 함수를 쓴다. 페이지에
 * 두면 어느 스위트도 보지 못한다(AQ-23).
 */

/**
 * 「평가일 종가는 보통 다음 날 오후에 들어온다」를 붙이는 경과 일수의 상한 — **표시 상수다.**
 *
 * 근거는 운영 실측이다: 평가일 행 12/12가 D+1(14시 배치)이었고 그 밖의 자동 행도 최대 D+2였다(DOC-010 §6.2 V0-ⓒ).
 * 그 안의 결측은 «아직 안 왔을» 수 있고, 그 뒤의 결측은 휴장일 · 수집 실패 쪽이다(RD-21). 법령 요율이 아니므로
 * 주입 대상(절대 규칙 #5)이 아니다
 */
export const EVALUATION_VERDICT_FRESH_DAYS = 2

/**
 * SCR-203 — 판정(또는 `?round=k`)에서 온 첫 렌더의 안내. **차수 번호를 박지 않는다** — 서버 렌더라 사용자가 차수를
 * 바꿔도 그대로 남는다(v2.7 각주 · 종전 안내와 같은 이유)
 */
export const REDEEM_PREFILL_NOTE =
  '방금 지난 차수(상환 확인 필요) 기준의 추정값을 채웠다 — 유형은 평가일 종가로 낸 판정이고 상환일은 그 평가일 + 5일이다.'

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
  context: { couponPayout: CouponPayout },
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
        `${verdict.roundNo}차 평가일(${date})의 종가로 판정하면 ${what} 조건을 충족했다(${basis}). 상환되었으면 기록한다.`,
      )
      break
    }
    case 'MATURITY_REACHED':
      sentences.push(`만기 평가일(${date})이 지났다. 만기상환을 기록한다.`)
      break
    case 'CLOSE_MISSING': {
      const names = (verdict.missingAssets ?? []).map((asset) => asset.assetName).join(' · ')
      sentences.push(
        `${verdict.roundNo}차 평가일(${date})의 종가가 없어 판정하지 못했다(${names}) — 증권사에서 직접 확인한다.`,
      )
      if (verdict.weekendEvaluation) {
        sentences.push('저장된 평가일이 주말이다 — 일정의 평가일을 고친다.')
      } else if (-verdict.dDay <= EVALUATION_VERDICT_FRESH_DAYS) {
        sentences.push('평가일 종가는 보통 다음 날 오후에 들어온다.')
      }
      break
    }
  }

  if (context.couponPayout === 'MONTHLY') {
    sentences.push('같은 날의 월수익은 상환에 합치지 않고 월수익 기록에 적는다.')
  }
  return sentences.join(' ')
}
