import { Client, type QueryResult, type QueryResultRow } from 'pg'
import { resolveDatabaseUrl } from './env'

/**
 * 사용자 가장 하네스 — PostgREST가 요청마다 하는 일을 트랜잭션 안에서 재현한다.
 *
 * ```
 * set_config('request.jwt.claims', …, is_local)  →  auth.uid()의 원천
 * set local role authenticated                   →  롤 권한 + RLS 적용 대상
 * ```
 *
 * `postgres` 롤은 BYPASSRLS이므로 역할을 바꾸지 않으면 정책이 적용되지 않고,
 * 모든 거부 테스트가 잘못된 이유로 통과한다. `catalog.test.ts`의 자기검사가
 * 이 전환이 실제로 일어나는지 확인한다.
 *
 * **NUMERIC 파서를 등록하지 않는다.** `pg`는 기본적으로 NUMERIC을 문자열로
 * 돌려주며, parseFloat 파서를 붙이면 금액이 부동소수점을 경유한다
 * (DOC-002 M-03, 절대 규칙 #2).
 */

let client: Client | null = null
let probeSequence = 0

function connection(): Client {
  if (client === null) {
    throw new Error('커넥션이 열려 있지 않다. tests/rls/setup.ts를 확인한다.')
  }
  return client
}

async function raw<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return connection().query<T>(sql, params as unknown[])
}

export async function openClient(): Promise<void> {
  client = new Client({ connectionString: resolveDatabaseUrl() })
  await client.connect()
}

export async function closeClient(): Promise<void> {
  await client?.end()
  client = null
}

export async function begin(): Promise<void> {
  await raw('begin')
}

/** 모든 테스트는 롤백으로 끝난다. 이 모듈에 commit 경로는 존재하지 않는다. */
export async function rollback(): Promise<void> {
  await raw('rollback')
}

/**
 * 소유자(`postgres`) 권한으로 실행한다. RLS를 우회하므로 **준비와 사후 확인
 * 전용**이다.
 *
 * 거부가 "영향 0행"으로 나타나는 경우, 0행이 권한 없음인지 행이 애초에
 * 없음인지 구분하려면 이 경로로 원본을 다시 읽어야 한다.
 */
export async function asOwner<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  await raw('reset role')
  return raw<T>(sql, params)
}

export type Actor = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>
}

/**
 * 지정 사용자로 문장 하나를 실행한다.
 *
 * **SAVEPOINT로 감싸는 것이 이 하네스의 핵심이다.** RLS 거부는 42501을
 * 던지고, Postgres에서 오류가 나면 트랜잭션 전체가 abort 상태가 되어 이후
 * 모든 문장이 25P02로 실패한다. 그러면 우리 테스트의 표준 형태인
 *
 *   ① B가 A의 데이터를 변경 시도 → 오류
 *   ② 소유자 권한으로 원본이 그대로인지 확인
 *
 * 에서 ②를 같은 테스트 안에서 할 수 없다. 서브트랜잭션을 되감으면
 * `set local role`과 `set_config(..., true)`도 함께 복원된다.
 */
export function actingAs(userId: string | null): Actor {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<T>> {
      const savepoint = `rls_probe_${(probeSequence += 1)}`

      await raw('reset role')
      await raw(`savepoint ${savepoint}`)

      const claims = JSON.stringify(
        userId === null
          ? { role: 'anon', aud: 'authenticated' }
          : { sub: userId, role: 'authenticated', aud: 'authenticated' },
      )
      await raw(`select set_config('request.jwt.claims', $1, true)`, [claims])
      await raw(
        userId === null ? 'set local role anon' : 'set local role authenticated',
      )

      try {
        const result = await raw<T>(sql, params)
        await raw('reset role')
        await raw(`release savepoint ${savepoint}`)
        return result
      } catch (error) {
        await raw(`rollback to savepoint ${savepoint}`)
        throw error
      }
    },
  }
}

/** 미인증 접근 (`anon` 롤) — SEC-03 검증용 */
export const anonymously: Actor = actingAs(null)
