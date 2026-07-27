/**
 * 변경 계약의 결과 타입 — DOC-011 §3.1, §3.2
 *
 * **변경 계약은 예외를 던지지 않는다.** 예외 기반 흐름은 클라이언트에서 필드별
 * 오류 표시를 어렵게 하고, 에러 경계가 화면을 갈아치우면 **입력값이 사라진다**
 * (DOC-008 §6이 SCR-203·204에 "입력값 보존"을 요구한다).
 *
 * 조회 계약과 대칭이 아닌 것이 의도다 — 조회는 미존재에 `null`, 시스템 오류에
 * 예외를 쓰고(§3.1) 미인증에서도 던진다(§4.0 Q-04). 조회에는 보존할 입력이 없다.
 */

/** §3.2의 에러 코드. HTTP 대응과 화면 처리는 그 표가 정본이다. */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL'

export type ActionError = {
  code: ErrorCode
  /** 사용자 표시용 (한글) */
  message: string
  /** 필드별 검증 오류. 키는 **계약 입력의 필드 이름**이다(열 이름이 아니다) */
  fields?: Record<string, string>
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError }

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

/**
 * `void` 계약(§5.3·§5.5·§5.6·§5.7·§5.9)의 성공.
 *
 * `ok(undefined)`를 호출부마다 쓰면 `ActionResult<void>`와 `ActionResult<undefined>`가
 * 섞이므로 이름을 준다.
 */
export function okVoid(): ActionResult<void> {
  return { ok: true, data: undefined }
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
): ActionResult<T> {
  // fields를 항상 넣지 않는다 — 빈 객체는 "필드 오류가 있다"로 읽히고,
  // 화면이 그것을 순회해 아무것도 표시하지 않는 상태가 된다.
  return fields == null || Object.keys(fields).length === 0
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, fields } }
}

/**
 * 이미 만들어진 `ActionError`를 결과로 감싼다.
 *
 * 사전 조회(`access.ts`)·검증(`Problems.toError()`)·순수 모듈 가드(`guard.ts`)가
 * 전부 `ActionError`를 만들어 돌려주므로, 계약 함수는 그것을 **다시 풀어 쓰지
 * 않는다** — 풀어 쓰면 `fields`를 빠뜨리는 자리가 계약 수만큼 생긴다.
 */
export function failWith<T = never>(error: ActionError): ActionResult<T> {
  return fail<T>(error.code, error.message, error.fields)
}

/**
 * 미인증 — W-03.
 *
 * `server.ts`가 세션을 해석하지 못했을 때 **던지지 않고** 이 값을 준다. 계약
 * 함수마다 같은 문장을 쓰지 않도록 한 곳에 둔다.
 */
export function unauthenticated<T = never>(): ActionResult<T> {
  return fail<T>('UNAUTHENTICATED', '로그인이 필요하다.')
}
