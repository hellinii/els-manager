import type { ConditionResult, KiStatus } from '@/lib/domain'
import type { AttentionReason, IntegrityIssue, ProductListItem } from '@/lib/db/queries/map'

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
 * `attention`과 `defect`를 가르는 근거는 **조치의 종류**다 — 앞은 사용자 확인
 * (SCR-202)이고 뒤는 데이터 수정(SCR-204)이다. 묶으면 ST-06의 구분이 색에서
 * 사라진다.
 */

export type BadgeGrade = 'neutral' | 'positive' | 'caution' | 'attention' | 'defect'

export const STATUS_GRADES: Record<ProductListItem['status'], BadgeGrade> = {
  ACTIVE: 'neutral',
  REDEEMED: 'positive',
}

export const KI_STATUS_GRADES: Record<KiStatus, BadgeGrade> = {
  // 노낙인은 「없음」이지 「안전」이 아니다 — 판정 대상이 아니므로 중립이다.
  NO_KI: 'neutral',
  SAFE: 'positive',
  WARNING: 'caution',
  // D-04: 시스템이 자동 확정하지 않으므로 사용자가 해야 할 일이 있는 유일한 상태다.
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

export const INTEGRITY_ISSUE_GRADES: Record<IntegrityIssue, BadgeGrade> = {
  UNDERLYING_MISSING: 'defect',
  SCHEDULE_MISSING: 'defect',
}

export const ATTENTION_REASON_GRADES: Record<AttentionReason, BadgeGrade> = {
  KI_NEAR: 'caution',
  KI_BELOW: 'attention',
  KI_TOUCHED: 'attention',
  EVALUATION_PASSED: 'attention',
  // 시세 없음은 수집이 오면 해소된다 — 사용자가 할 일이 있으나(수동 입력) 폴백이다.
  PRICE_MISSING: 'caution',
  UNDERLYING_MISSING: 'defect',
  SCHEDULE_MISSING: 'defect',
}

/** 시세 경과 — 정상값이 매주 경고가 되지 않게 5일 기준이다(§4.5). 관찰이다. */
export const STALE_GRADE: BadgeGrade = 'caution'
