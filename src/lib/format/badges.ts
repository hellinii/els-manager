import type { ConditionResult, ContributionBasis, CouponConditionResult, CouponState, KiStatus } from '@/lib/domain'
import type { AttentionReason, EvaluationVerdictKind, IntegrityIssue, ProductListItem } from '@/lib/db/queries/map'

import type { GapTier } from './ratio'

/**
 * 시각 등급 — **DOC-005 §6.3이 정본이다**
 *
 * 표시 문자열과 등급을 분리하는 이유는 ST-05다: 같은 문자열이 맥락에 따라 다른
 * 강조를 받는다. `conditionResult.EARLY`(추정)와 `redemptionType.EARLY`(확정)는
 * 라벨이 같지만 하나는 「그럴 것이다」이고 하나는 「그랬다」이므로 같은 색으로
 * 칠하면 ST-05가 요구한 구분이 사라진다.
 *
 * **여기는 등급 토큰만 낸다. CSS 클래스는 `components/display/Badge.tsx`가 정한다.**
 * 순수 모듈이 Tailwind 클래스를 들고 있으면 표시 규칙과 디자인 결정이 한 파일에
 * 섞이고, 디자인 시스템을 역작성할 때(DOC-001 §10) 어느 쪽이 정본인지 알 수 없다.
 *
 * `record` · `attention` · `defect`를 가르는 근거는 **조치의 종류**다 *(홈 피드백 컷 K3 · DOC-005 v1.24)*:
 * - `record` 「기록 필요」 — 거래내역을 보고 옮겨 적으면 풀린다(SCR-203 상환 처리 · SCR-206 월수익 기록)
 * - `attention` — 원금 위험(KI)을 사용자가 들여다볼 일이다(SCR-202)
 * - `defect` — 데이터 수정(SCR-204)
 *
 * 묶으면 ST-06의 구분이 색에서 사라진다. `record`를 `attention`과 같은 색으로 두면 「조건 충족」 같은 좋은
 * 소식이 경고로 읽히고(피드백 #1), `positive`로 올리면 추정이 확정된 상환 실적과 같은 색이 된다(GQ-09).
 * **색이 길흉을 말하지 않는다** — 만기 평가일 경과는 손실일 수 있다. 등급은 「무엇을 해야 하는가」다.
 * 이 축의 뜻을 적을 때 「확인 필요」 낱말을 쓰지 않는다 — 그 말은 조치 표시이고 `KI_BELOW` 칩에만 붙는다(DOC-005 §6.1 아래 문단).
 */

export type BadgeGrade = 'neutral' | 'positive' | 'caution' | 'record' | 'attention' | 'defect'

export const STATUS_GRADES: Record<ProductListItem['status'], BadgeGrade> = {
  ACTIVE: 'neutral',
  REDEEMED: 'positive',
}

export const KI_STATUS_GRADES: Record<KiStatus, BadgeGrade> = {
  // 노낙인은 「없음」이지 「안전」이 아니다 — 판정 대상이 아니므로 중립이다.
  NO_KI: 'neutral',
  SAFE: 'positive',
  WARNING: 'caution',
  // D-04: 시스템이 자동 확정하지 않으므로 이 축에서 사용자가 해야 할 일이 있는 유일한 상태다 — 원금 위험의 판단이라
  // 기록(`record`)이 아니라 `attention`이다(홈 피드백 컷 K3).
  BELOW: 'attention',
  TOUCHED: 'attention',
}

/**
 * 판정 결과 — **추정이다.** `CARRY_OVER`가 `caution`인 것은 나쁜 소식이라서가
 * 아니라 "이번 차수에는 조건을 못 맞춘다"가 관찰 대상이기 때문이다.
 */
export const CONDITION_RESULT_GRADES: Record<ConditionResult, BadgeGrade> = {
  EARLY: 'positive',
  LIZARD: 'positive',
  CARRY_OVER: 'caution',
}

/**
 * 평가일 판정 (P6 컷 7 · DOC-005 §6.3) — **충족을 `positive`로 두지 않는다.** `positive`는 확정된 상환(상환 실적 ·
 * `status.REDEEMED`)의 등급이고, 이 값은 사용자가 거래내역을 보고 기록해야 풀리는 **기록**이다(`couponState.UNRECORDED`와
 * 같은 부류 — 그래서 같은 `record`). 추정 충족을 확정과 같은 색으로 칠하면 GQ-09의 혼동이 커진다. ~~`attention`~~ →
 * `record` *(홈 피드백 컷 K3 · 민서 결정(2026-10-12) D1)* — 빨강이 조건 충족을 경고로 읽게 했다(피드백 #1). 종가 없음은
 * 수집이 오면 풀리기도 하므로 `attentionReason.PRICE_MISSING`과 같은 `caution`이다(판정 보류)
 */
export const EVALUATION_VERDICT_GRADES: Record<EvaluationVerdictKind, BadgeGrade> = {
  EARLY: 'record',
  LIZARD: 'record',
  MATURITY_REACHED: 'record',
  CLOSE_MISSING: 'caution',
}

/**
 * 월수익 상태 (P8 컷 b3 · DOC-005 §6.3). 「미기록」만 사용자 조치다 — 거래내역에서 옮겨 적어야 풀린다(「상환 확인 필요」와
 * 같은 부류, 홈의 `COUPON_UNRECORDED`와 같은 등급 — `record` *(홈 피드백 컷 K3)*). 「미지급」은 조건을 못 맞춘 달이라
 * 관찰이다(차수의 이월과 같다)
 */
export const COUPON_STATE_GRADES: Record<CouponState, BadgeGrade> = {
  PAID: 'positive',
  UNPAID: 'caution',
  UNRECORDED: 'record',
  SCHEDULED: 'neutral',
  BEYOND_ASSUMPTION: 'neutral',
  ENDED: 'neutral',
}

/** 다음 한 행의 판정 — 차수의 `conditionResult`와 같은 짝(충족 positive · 못 맞춤 caution · 시세 없음 caution) */
export const COUPON_CONDITION_RESULT_GRADES: Record<CouponConditionResult, BadgeGrade> = {
  EXPECTED_PAID: 'positive',
  EXPECTED_UNPAID: 'caution',
  UNKNOWN: 'caution',
}

/**
 * 기여 근거 (P8 컷 b4 · DOC-005 §6.3) — 종전 행 배지와 같은 짝: 확정 neutral · 추정 caution. 둘이 섞이면 추정이 낀
 * 것이므로 caution이다(ST-05 — 추정을 확정처럼 보이지 않게)
 */
export const CONTRIBUTION_BASIS_GRADES: Record<ContributionBasis, BadgeGrade> = {
  CONFIRMED: 'neutral',
  ESTIMATED: 'caution',
  MIXED: 'caution',
}

export const INTEGRITY_ISSUE_GRADES: Record<IntegrityIssue, BadgeGrade> = {
  UNDERLYING_MISSING: 'defect',
  SCHEDULE_MISSING: 'defect',
  COUPON_SCHEDULE_MISSING: 'defect',
}

export const ATTENTION_REASON_GRADES: Record<AttentionReason, BadgeGrade> = {
  KI_NEAR: 'caution',
  KI_BELOW: 'attention',
  KI_TOUCHED: 'attention',
  // 시세 없음은 수집이 오면 해소된다 — 사용자가 할 일이 있으나(수동 입력) 폴백이다.
  PRICE_MISSING: 'caution',
  UNDERLYING_MISSING: 'defect',
  SCHEDULE_MISSING: 'defect',
  // 셋째 결함도 데이터 수정이다(SCR-204) — 원금 위험(attention) · 기록(record)과 다른 등급이어야 ST-06의 구분이 색에 남는다
  COUPON_SCHEDULE_MISSING: 'defect',
  // 사용자가 거래내역에서 옮겨 적을 지난 사실 — 「상환 확인 필요」(`evaluationVerdict`)와 같은 부류(DOC-008 SQ-21 ⓓ b3 개정).
  // 원금 위험(KI_BELOW · KI_TOUCHED)과 다른 등급이다 — 할 일이 기록이다(홈 피드백 컷 K3 · 민서 결정(2026-10-12) D1)
  COUPON_UNRECORDED: 'record',
}

/** 시세 경과 — 정상값이 매주 경고가 되지 않게 5일 기준이다(§4.5). 관찰이다. */
export const STALE_GRADE: BadgeGrade = 'caution'

/**
 * 여유폭 단계 (홈 피드백 컷 K6 · DOC-005 §6.3 「쓰는 곳」의 백틱 밖 낱말 셋). **근소는 충족과 다른 등급이다** — 같으면
 * 「+3%p」와 「+30%p」가 다시 같은 색이 된다(피드백 #2). 근소와 미충족이 같은 `caution`인 것은 둘 다 「관찰할 차수」라서다
 * (`conditionResult.CARRY_OVER`와 같은 판단). 둘은 낱말이 가르고, 여유폭 숫자의 색도 이 등급을 따른다(부호가 아니다)
 */
export const GAP_TIER_GRADES: Record<GapTier, BadgeGrade> = {
  MET: 'positive',
  NARROW: 'caution',
  UNMET: 'caution',
}
