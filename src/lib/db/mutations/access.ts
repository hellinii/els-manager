import { loadProduct, type ProductRow } from '../queries/load'
import { isUuid } from '../validate/primitives'
import type { MutationContext } from './context'
import { guardSystemAsync } from './guard'
import type { ActionError } from './result'

/**
 * 사전 조회와 영향 행 확인 — DOC-011 §5.0 W-05
 *
 * ## 두 겹이 필요하다
 *
 * RLS의 `USING`은 UPDATE·DELETE에서 **오류 없이 0행**으로 거부한다. 그 0행을
 * 성공으로 넘기면 사용자는 "저장됐다"는 화면을 보고 데이터는 그대로다.
 *
 * 그렇다고 사전 조회 하나로 대신할 수도 없다 — 사전 조회와 변경 사이에 다른
 * 요청이 상태를 바꿀 수 있고(상환 등록·삭제), 그 창에서 RLS가 막으면 사전 조회는
 * 이미 통과한 상태다. 둘의 역할이 다르다: **사전 조회는 오류를 구분**하기 위한
 * 것이고(`NOT_FOUND` ↔ `FORBIDDEN`, §3.3의 UX 목적), **영향 행 확인은 성공을
 * 주장하지 않기** 위한 것이다.
 */

export type Access<T> = { ok: true; value: T } | { ok: false; error: ActionError }

function denied(code: ActionError['code'], message: string): Access<never> {
  return { ok: false, error: { code, message } }
}

/**
 * 상품을 읽고 소유자인지 판정한다.
 *
 * **`getProduct`가 아니라 `loadProduct`를 쓴다.** 뷰로 접는 과정에는 조건 판정과
 * 순수 모듈 호출이 들어 있고(§4.3), 그것들은 결함 상품에서 예외를 던지거나
 * `integrityIssue`로 접힌다. 변경 계약이 필요한 것은 **행의 사실**(소유자·발행일·
 * 상환 존재·KI 배리어)이지 판정 결과가 아니며, 결함 상품이라고 해서 상환 기록이나
 * 수정을 막지 않는 것이 §5.4·§5.3의 결정이다.
 */
export async function requireOwnedProduct(
  ctx: MutationContext,
  id: unknown,
  what: string,
): Promise<Access<ProductRow>> {
  // 형태가 아닌 id는 존재할 수 없다. 질의에 넘기면 `22P02`가 되고 그 코드로는
  // 필드를 지목할 수 없다 — 애초에 사용자가 고칠 수 있는 필드도 아니다.
  if (!isUuid(id)) return denied('NOT_FOUND', '대상을 찾을 수 없다.')

  const loaded = await guardSystemAsync(() => loadProduct(ctx, id), `${what} 사전 조회`)
  if (!loaded.ok) return { ok: false, error: loaded.error }

  const row = loaded.value
  if (row == null) return denied('NOT_FOUND', '대상 상품을 찾을 수 없다.')

  // 조회 정책이 `using (true)`이므로 **남의 상품도 읽힌다.** 그래서 소유자 판정이
  // 여기서 일어나고, 이것이 없으면 RLS가 0행으로 막아 `NOT_FOUND`와 구분되지 않는다.
  if (row.owner_id !== ctx.viewerId) {
    return denied('FORBIDDEN', '본인 소유 상품만 변경할 수 있다.')
  }
  return { ok: true, value: row }
}

/**
 * 영향 행 0을 성공으로 넘기지 않는다 — W-05.
 *
 * 사전 조회가 이미 존재와 소유를 확인했으므로, 그 뒤의 0행은 **그 사이에 상태가
 * 바뀌었다**는 뜻이다(다른 요청이 지웠거나 상환을 붙였다). `NOT_FOUND`도
 * `FORBIDDEN`도 아닌 `CONFLICT`인 이유가 그것이다 — 사용자가 할 일은 입력을
 * 고치는 것도 권한을 얻는 것도 아니고 **화면을 갱신하는 것**이다.
 */
export function requireAffected(rows: readonly unknown[] | null): ActionError | null {
  return rows != null && rows.length > 0 ? null : staleState()
}

/**
 * 영향 행 0의 오류. 쓰기 함수의 `NULL` 반환도 **같은 사실**이므로 같은 값을 쓴다
 * (§5.2 각주) — 두 경로가 다른 문구를 내면 화면이 같은 상황을 두 가지로 설명한다.
 */
export function staleState(): ActionError {
  return {
    code: 'CONFLICT',
    message: '대상의 상태가 그 사이에 바뀌었다. 화면을 갱신한 뒤 다시 시도한다.',
  }
}
