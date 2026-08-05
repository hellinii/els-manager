import type { FailureClass, ProviderFailureCode } from './types'

/**
 * 실패 세분류 → 부류의 **전사 사상** — DOC-011 §7.1 · DOC-002 DQ-02
 *
 * ## 왜 사상을 따로 두는가
 *
 * 호출 지점에서 `failure`를 **손으로 적지 않게** 하려는 것이다. 손으로 적으면 같은 원인이
 * 자리마다 다른 부류를 받을 수 있고, 그 어긋남은 **사용자에게 틀린 조치를 지시한다**
 * (「기다린다」로 분류된 심볼 오류는 영원히 기다리게 된다).
 *
 * ## `Record<ProviderFailureCode, …>`인 것이 방어다
 *
 * 세분류를 늘리면 **여기서 컴파일이 깨진다.** 즉 새 실패 모드를 「사용자가 무엇을 하는가」에
 * 답하지 않고 추가할 수 없다. `queries/map.ts`의 `DESTROYED_BY`가 같은 형태다.
 */
export const FAILURE_CLASS: Record<ProviderFailureCode, FailureClass> = {
  /*
   * ★ 심볼 표기 오류가 `NO_DATA`인 것은 «조치»가 같기 때문이다 — DOC-011 §7.1의 표가
   * 「데이터 없음」에 **심볼 오류**를 명시적으로 넣었다(사용자는 매핑을 고친다).
   * 다만 원인은 휴장과 전혀 다르므로 로그는 갈라야 한다 — 그것이 `code`가 있는 이유다.
   */
  SYMBOL_SCHEME: 'NO_DATA',
  EMPTY: 'NO_DATA',

  AUTH: 'CALL_FAILED',
  QUOTA: 'CALL_FAILED',
  HTTP: 'CALL_FAILED',
  NETWORK: 'CALL_FAILED',
  BLOCKED: 'CALL_FAILED',
  MALFORMED: 'CALL_FAILED',
  /*
   * ★ `BAD_VALUE`·`BAD_DATE`가 `CALL_FAILED`인 것은 «사용자가 고칠 것이 없다»는 뜻이다.
   * 매핑도 맞고 휴장도 아니며 **공급자가 이상한 값을 줬다** — 조치는 기다리는 것뿐이고,
   * 실제 대응은 로그를 보는 사람의 일이다. 그래서 이 둘은 절대 조용히 넘기지 않는다.
   */
  BAD_VALUE: 'CALL_FAILED',
  BAD_DATE: 'CALL_FAILED',
}

/**
 * 부류의 표시 문구 — DOC-011 §7.1 표의 두 이름.
 *
 * **`DOC-005 §6.1`에 축으로 등재되지 않았다** — 그 표는 `tests/app/labels.test.ts`가
 * `LABEL_AXES`와 **정확 일치**로 대조하므로, 렌더하는 화면이 서기 전에 등재하면 그 커밋이
 * 빨간불이다. 등재 시점은 P5a 컷 2b(SCR-302가 갱신 결과를 표시하는 컷)이며 그 사유가
 * DOC-005 v1.1에 적혀 있다. **여기 있는 것은 계약 문구이고 화면 라벨 레지스트리가 아니다.**
 */
export const FAILURE_LABEL: Record<FailureClass, string> = {
  NO_DATA: '데이터 없음',
  CALL_FAILED: '호출 실패',
}

/**
 * `failed[].reason`을 만든다 — 부류 라벨을 **앞에** 둔다.
 *
 * 두 부류가 층을 넘어 살아남는 자리이며, 라벨이 앞인 것은 화면이 문구를 자르더라도
 * 조치가 먼저 읽히게 하려는 것이다.
 */
export function failureReason(failure: FailureClass, detail: string): string {
  return `${FAILURE_LABEL[failure]} — ${detail}`
}
