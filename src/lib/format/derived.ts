import type { IntegrityIssue } from '@/lib/db/queries/map'

import { INTEGRITY_ISSUE_LABELS } from './labels'
import { INTEGRITY_ISSUE_GRADES, type BadgeGrade } from './badges'

/**
 * 판정값이 왜 없는가 — **DOC-011 §4.2 우선순위표의 단일 구현**
 *
 * | 순위 | 원인 | 조건 | 표시 |
 * |---|---|---|---|
 * | 1 | 무결성 결함 (I-07) | `integrityIssue ≠ null` | "기초자산 없음 — 수정 필요" |
 * | 2 | E-05 상환 완료 | `status = 'REDEEMED'` | 판정 생략 — 표시값은 상환 실적 |
 * | 3 | E-01 시세 없음 | `ACTIVE` 이고 `worstOf = null` | "시세 없음" |
 *
 * ## 순서가 이 함수의 존재 이유다
 *
 * 결함 상품은 `status = 'ACTIVE'`이고 `worstOf = null`이므로 **3순위 조건을 그대로
 * 만족한다.** 순서를 정하지 않으면 화면이 「시세 없음」을 표시하고 사용자는
 * **영원히 오지 않을 시세를 기다린다**(DOC-007 §3.1 각주가 막으려던 상태).
 *
 * 이 판정을 하는 화면이 다섯이다(SCR-101·201·202·301·401). 화면마다 `if`를 쓰면
 * 다섯 중 하나가 순서를 뒤집는 날이 오고, 그 화면만 조용히 틀린다. 판별 유니온으로
 * 돌려주므로 호출부는 `kind`를 분기할 뿐 순서를 다시 정하지 않는다.
 */

export type DisplayState =
  | { kind: 'INTEGRITY'; issue: IntegrityIssue; label: string; grade: BadgeGrade }
  | { kind: 'REDEEMED' }
  | { kind: 'PRICE_MISSING'; label: string }
  | { kind: 'VALUED'; worstOf: string }

/** 「시세 없음」 — DOC-007 E-01. DOC-005 §6 `integrityIssue`와 다른 문구여야 한다. */
export const PRICE_MISSING_LABEL = '시세 없음'

export function deriveDisplay(item: {
  status: 'ACTIVE' | 'REDEEMED'
  worstOf: string | null
  integrityIssue: IntegrityIssue | null
}): DisplayState {
  // 1순위 — 상환 완료보다 앞이다. 상환은 결함을 해소하지 않는다(§4.1의 표).
  if (item.integrityIssue != null) {
    return {
      kind: 'INTEGRITY',
      issue: item.integrityIssue,
      label: INTEGRITY_ISSUE_LABELS[item.integrityIssue],
      grade: INTEGRITY_ISSUE_GRADES[item.integrityIssue],
    }
  }

  // 2순위 — 판정을 생략한다. 표시값은 상환 실적이며 영구적이다.
  if (item.status === 'REDEEMED') return { kind: 'REDEEMED' }

  // 3순위 — 시세가 수집되면 값이 생긴다. 결함과 달리 일시적이다.
  if (item.worstOf == null) {
    return { kind: 'PRICE_MISSING', label: PRICE_MISSING_LABEL }
  }

  return { kind: 'VALUED', worstOf: item.worstOf }
}

/**
 * > **`REDEEMED`에 `worstOf`를 담지 않는 것은 그 값이 없다는 뜻이 아니다.**
 * > 없는 것은 **판정값**(조건 충족·KI)이다 — §4.2 v0.8 각주가 "`worstOf`·`ratio`·
 * > `isWorst`는 두 축 어디에도 막히지 않는다"고 확인했고, 상환 완료 상품도
 * > 워스트오브를 표시한다. 그 값이 필요한 화면은 `item.worstOf`를 그대로 읽는다 —
 * > 여기서 되돌려주는 함수를 두면 "이 함수를 지나야 한다"는 규칙처럼 보이는데
 * > 실제로는 아무 판단도 하지 않는 껍데기가 된다.
 */
