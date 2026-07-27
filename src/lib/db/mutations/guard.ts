import type { ActionError } from './result'

/**
 * 순수 모듈의 예외 → `ErrorCode` — DOC-011 §3.2.2 (AQ-17 종결)
 *
 * ## 예외 클래스로는 분류할 수 없다
 *
 * `lib/domain`·`lib/tax`·`lib/decimal`은 전제 위반을 전부 `RangeError`로 거부한다.
 * 그런데 같은 클래스가 **사용자 입력의 오류**(`dec('abc')`)와 **저장된 상태의
 * 결함**(`worstOf([])`) 양쪽에서 나오고, 둘의 화면 처리는 정반대다. 그래서 변환의
 * 주체를 예외가 아니라 **호출 지점**으로 옮긴다 — 문맥을 아는 것은 항상 부르는
 * 쪽이며, `RangeError`는 자기가 어느 상품의 어느 입력에서 났는지 모른다.
 *
 * ## `CONFLICT`는 이 경로에서 나오지 않는다
 *
 * 순수 모듈은 자기가 받은 인자만 보므로 "이미 상환됨"·"기초자산 0건"을 알 수 있는
 * 위치에 없다. 상태 충돌은 계약 계층의 사전 조회와 DB 오류(§3.2.1)가 판정한다.
 *
 * ## 예상 밖의 예외는 `INTERNAL`이다
 *
 * `guardInput`에 `RangeError`가 아닌 예외가 오면 그것은 §6의 검증 규칙이 아니라
 * **코드의 결함**이다. `VALIDATION_FAILED`로 내면 사용자에게 고칠 수 없는 것을
 * 고치라고 요구하게 되고, 그 화면은 몇 번을 다시 입력해도 같은 오류를 낸다.
 */

export type Guarded<T> =
  | { ok: true; value: T }
  | { ok: false; error: ActionError }

const INTERNAL_MESSAGE = '처리 중 오류가 발생했다.'

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * 입력에서 유래하는 거부 — §3.2.2의 1~3행.
 *
 * `dDay`·`isPast`(날짜 형식), `dec()`(유한한 수), `assertPositiveInteger`가 이
 * 자리다. 호출 지점이 **어느 필드**의 문제인지 함께 선언한다.
 */
export function guardInput<T>(
  run: () => T,
  at: { field: string; message: string },
): Guarded<T> {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    if (error instanceof RangeError) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: at.message,
          fields: { [at.field]: at.message },
        },
      }
    }
    // RangeError가 아니면 전제 위반이 아니라 결함이다.
    console.error(
      `[순수 모듈] ${at.field}에서 예상 밖의 예외 — ${describe(error)}. ` +
        'RangeError가 아니므로 입력 오류로 보고하지 않는다 (DOC-011 §3.2.2).',
    )
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } }
  }
}

/**
 * 시스템 전제에서 유래하는 거부 — §3.2.2의 4행.
 *
 * 세율 시드 부재·상수 누락(`loadTaxYearContext`·`toTaxConstants`)이 이 자리다.
 * 사용자가 고칠 수 없으므로 **어떤 예외든** `INTERNAL`이며, 원문은 로그에만 남긴다.
 */
export function guardSystem<T>(run: () => T, what: string): Guarded<T> {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    console.error(`[시스템] ${what} — ${describe(error)}`)
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } }
  }
}

/** `await`가 필요한 경로(로더 호출)의 `guardSystem`. */
export async function guardSystemAsync<T>(
  run: () => Promise<T>,
  what: string,
): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    console.error(`[시스템] ${what} — ${describe(error)}`)
    return { ok: false, error: { code: 'INTERNAL', message: INTERNAL_MESSAGE } }
  }
}
