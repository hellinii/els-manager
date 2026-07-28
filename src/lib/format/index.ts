/**
 * 표시 형식 — 서버 컴포넌트와 클라이언트 컴포넌트가 함께 쓴다.
 *
 * **`lib/tax`·`lib/domain`에 두지 않은 이유**(DOC-010 §5): 그쪽에 넣는 것은 린트상
 * 합법이지만 계산과 표시 규칙이 섞여 TC-01~22의 경계가 흐려진다. `components/`에
 * 두면 서버 컴포넌트가 클라이언트 디렉터리를 import하게 된다. 어느 쪽도 아닌
 * 자리가 옳다.
 *
 * 이 모듈은 **오늘을 계산하지 않고**(ADR-003 · Q-02) **숫자로 강제 변환하지
 * 않는다**(Q-08). 둘 다 린트로 강제한다(컷 0d 규칙 1·2).
 */

export { amount, koreanAmount, koreanWon, signedWon, withCommas, won } from './money'
export { barrierGap, percent, percentPoint } from './ratio'
export { priceDisplay } from './price'
export { dDayLabel, korDate, korMonth, monthKey, ymd } from './date'
export {
  ACCOUNT_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  ATTENTION_REASON_LABELS,
  CONDITION_RESULT_LABELS,
  HEALTH_INSURANCE_TYPE_LABELS,
  INTEGRITY_ISSUE_LABELS,
  KI_OBSERVATION_LABELS,
  KI_STATUS_LABELS,
  LABEL_AXES,
  PRICE_SOURCE_LABELS,
  REDEMPTION_TYPE_LABELS,
  STALE_LABEL,
  STATUS_LABELS,
} from './labels'
export {
  ATTENTION_REASON_GRADES,
  CONDITION_RESULT_GRADES,
  INTEGRITY_ISSUE_GRADES,
  KI_STATUS_GRADES,
  STALE_GRADE,
  STATUS_GRADES,
  type BadgeGrade,
} from './badges'
export { deriveDisplay, PRICE_MISSING_LABEL, type DisplayState } from './derived'
export { groupByMonth, splitByPast, type MonthGroup } from './schedule'
