import type { ActionResult, ErrorCode } from '@/lib/db/mutations/result'

import { splitFieldErrors } from './fieldPath'

/**
 * 폼 왕복 상태 — `useActionState`가 서버·클라이언트 경계를 넘겨 나른다
 *
 * **직렬화 가능한 평범한 객체만 담는다.** 클래스·함수·`Symbol`은 경계를 넘지
 * 못하고, `undefined`는 넘기지만 `JSON` 왕복에서 사라진다 — 그래서 없음을
 * `null`로 표현한다(`tests/db/brand.test.ts`가 뷰에 같은 규율을 걸었다).
 *
 * ## `code`를 버리지 않는 이유
 *
 * §3.2의 화면 처리가 코드마다 다르고, 그중 하나는 **오류가 아니다** —
 * `PROVIDER_UNAVAILABLE`은 ST-03의 폴백 안내이고 빨간 박스로 그리면 사용자가
 * 자기 잘못이라고 읽는다. 문구만 남기면 그 판단을 문자열 비교로 하게 된다.
 *
 * ## `values`를 항상 돌려주는 이유
 *
 * DOC-008 §6이 SCR-203·204에 「입력값 보존」을 요구한다. W-03이 미인증에서도
 * 던지지 않는 이유가 그것이므로, 실패 경로에서 값을 잃으면 그 설계가 무의미해진다.
 */
export type FormState = {
  /** 제출 전(초기)·성공·실패를 구분한다. 초기 상태는 `'INITIAL'`이다. */
  status: 'INITIAL' | 'OK' | 'ERROR'
  /** 되살릴 입력값. 키는 입력의 `name`이다. */
  values: Record<string, string>
  /** 입력의 `name`과 짝지어진 오류. 그대로 `fieldErrors[name]`으로 읽는다. */
  fieldErrors: Record<string, string>
  /** 폼 상단에 표시할 문구. 성공 안내도 여기 온다. */
  message: string | null
  /** §3.2의 코드. 화면 처리 분기의 근거이며 `null`은 성공·초기다. */
  code: ErrorCode | null
  /**
   * 어느 입력과도 짝지어지지 않은 `fields` 키.
   *
   * **버리지 않는다.** 사용자가 배열 행을 지우고 재제출하면 서버가 사라진 인덱스를
   * 가리킬 수 있다(`underlyings[3].assetId`). 조용히 사라지면 "저장이 안 되는데
   * 아무 표시도 없다"가 된다 — 상단 요약에 모은다.
   */
  unmatched: Array<{ key: string; message: string }>
}

export function initialFormState(values: Record<string, string> = {}): FormState {
  return {
    status: 'INITIAL',
    values,
    fieldErrors: {},
    message: null,
    code: null,
    unmatched: [],
  }
}

/**
 * `ActionResult` → `FormState`.
 *
 * `knownNames`는 화면이 렌더한 입력의 `name` 목록이다. 그것을 받는 이유는 미매칭
 * 키의 판정이 **폼마다 다르기** 때문이다 — 배열 행이 셋인 폼에서 `[3]`은 미매칭이고
 * 넷인 폼에서는 매칭이다. 화면이 진실을 알고 있으므로 화면이 준다.
 */
export function toFormState<T>(
  result: ActionResult<T>,
  values: Record<string, string>,
  knownNames: readonly string[],
  okMessage?: string,
): FormState {
  if (result.ok) {
    return {
      status: 'OK',
      values,
      fieldErrors: {},
      message: okMessage ?? null,
      code: null,
      unmatched: [],
    }
  }

  const { matched, unmatched } = splitFieldErrors(result.error.fields, knownNames)

  return {
    status: 'ERROR',
    values,
    fieldErrors: matched,
    message: result.error.message,
    code: result.error.code,
    unmatched,
  }
}

/**
 * 제출된 값을 그대로 보존 맵으로.
 *
 * **비밀번호처럼 돌려주면 안 되는 값은 `exclude`로 뺀다** — SCR-001이 이메일만
 * 보존하고 비밀번호는 비우는 것과 같은 규칙이다(그 화면은 컷 0b에 이미 있다).
 */
export function valuesOf(
  form: FormData,
  exclude: readonly string[] = [],
): Record<string, string> {
  const excluded = new Set(exclude)
  const values: Record<string, string> = {}

  for (const [key, value] of form.entries()) {
    if (excluded.has(key)) continue
    // 파일은 우리 폼에 없다. 있더라도 상태에 담으면 직렬화 경계를 넘지 못한다.
    if (typeof value === 'string') values[key] = value
  }

  return values
}
