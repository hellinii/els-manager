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
 */

type PgError = { code?: string; message: string }

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

/** 제약 위반. RLS 거부가 제약 위반을 가리지 않는지 확인할 때 쓴다 */
export async function expectConstraintViolation(
  run: () => Promise<unknown>,
  code: '23505' | '23503' | '23514',
): Promise<void> {
  const error = await capture(run)
  expect(error.code, `SQLSTATE=${error.code} msg=${error.message}`).toBe(code)
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
