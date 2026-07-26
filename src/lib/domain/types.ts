/** 도메인 열거형 — DOC-002 §4, DOC-005 §3·§6 */

/** 계좌유형. `TAX_FREE`는 종합과세 합산에서 제외된다 */
export type AccountType = 'GENERAL' | 'TAX_FREE'

/** 상환 유형 — DOC-002 §4.9 */
export type RedemptionType =
  | 'EARLY'
  | 'LIZARD'
  | 'MATURITY_GAIN'
  | 'MATURITY_LOSS'

/** KI 관찰방식 */
export type KiObservation = 'CONTINUOUS' | 'CLOSING'

/** 조건 판정 결과 — DOC-011 §4.2 `conditionResult` */
export type ConditionResult = 'EARLY' | 'LIZARD' | 'CARRY_OVER'

/** KI 표시 등급 — DOC-011 §4.2 `kiStatus` */
export type KiStatus = 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED'
