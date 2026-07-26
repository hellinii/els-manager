import { expect } from 'vitest'
import type { QueryResult } from 'pg'

/**
 * 거부 형태별 단언
 *
 * **RLS의 거부는 명령마다 형태가 다르다.** 형태를 틀리게 단언하면 테스트가
 * 통과해도 아무것도 증명하지 못한다.
 *
 * | 상황 | 형태 |
 * |---|---|
 * | INSERT 정책 없음 / WITH CHECK 실패 | `42501` + "row-level security" |
 * | UPDATE·DELETE·SELECT의 USING이 행을 감춤 | **오류 없음. 영향 0행** |
 * | GRANT가 회수됨 | `42501` + "permission denied" |
 * | 제약 위반 | `23505`(UNIQUE) / `23503`(FK) / `23514`(CHECK) |
 *
 * 앞의 두 42501은 SQLSTATE가 같으므로 메시지로 구분해야 한다.
 *
 * **트리거 기반 거부도 제약 위반 형태로 온다.** I-16(시세 좌표 불변)은
 * `BEFORE UPDATE` 트리거가 `errcode = '23514'`로 던지므로 `CHECK`와 구별되지
 * 않는다. 형태 분류를 넷으로 늘리지 않는 것이 의도다 — 무결성 규칙은 계층이
 * 아니라 규칙 ID로 구분한다.
 */

type PgError = { code?: string; message: string; constraint?: string }

async function capture(run: () => Promise<unknown>): Promise<PgError> {
  try {
    await run()
  } catch (error) {
    return error as PgError
  }
  throw new Error(
    '거부되어야 할 문장이 성공했다. 정책이 비어 있거나 사용자 가장이 실패했다.',
  )
}

/** 정책 위반 — 정책은 있으나 통과하지 못했거나, 해당 명령의 정책이 없다 */
export async function expectRlsViolation(
  run: () => Promise<unknown>,
): Promise<void> {
  const error = await capture(run)
  expect(error.code, `SQLSTATE=${error.code} msg=${error.message}`).toBe('42501')
  expect(error.message).toMatch(/row-level security/i)
}

/** 권한 미부여 — REVOKE로 차단된 경우. 정책 이전 단계에서 막힌다 */
export async function expectPermissionDenied(
  run: () => Promise<unknown>,
): Promise<void> {
  const error = await capture(run)
  expect(error.code, `SQLSTATE=${error.code} msg=${error.message}`).toBe('42501')
  expect(error.message).toMatch(/permission denied/i)
}

/**
 * 제약 위반. RLS 거부가 제약 위반을 가리지 않는지 확인할 때 쓴다.
 *
 * **`constraint`를 함께 넘기면 "어느 규칙이 거부했는지"까지 고정된다.**
 * SQLSTATE만 단언하면 한 행이 두 제약을 동시에 위반할 때 어느 쪽이 보고되는지
 * 알 수 없고, 그 순서는 제약 이름 알파벳순이라는 PostgreSQL 구현 세부사항에
 * 의존한다. 그러면 테스트가 초록색인 채로 다른 규칙을 증명하게 된다.
 *
 * 기존 호출부를 깨지 않기 위해 선택 인자로 두었으나 **`constraints.test.ts`
 * 안에서는 전부 채운다** — 선택 인자는 잊히기 때문이다.
 */
export async function expectConstraintViolation(
  run: () => Promise<unknown>,
  code: '23505' | '23503' | '23514',
  constraint?: string,
): Promise<void> {
  const error = await capture(run)
  const where = `SQLSTATE=${error.code} constraint=${error.constraint} msg=${error.message}`

  expect(error.code, where).toBe(code)
  if (constraint !== undefined) {
    expect(error.constraint, where).toBe(constraint)
  }
}

/**
 * USING 필터에 의한 조용한 거부.
 *
 * 오류가 없으므로 행 수만이 신호다. 0행은 "권한 없음"과 "행 없음"을 구분하지
 * 못하므로, **호출부에서 반드시 `asOwner`로 원본을 재조회해 불변임을 함께
 * 단언한다.** 이 단언만 쓰고 재조회를 빠뜨리면 대상 행이 애초에 없어도
 * 통과한다.
 */
export function expectNoRowsAffected(result: QueryResult): void {
  expect(result.rowCount).toBe(0)
}
