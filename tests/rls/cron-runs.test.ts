import { describe, expect, it } from 'vitest'
import { actingAs, anonymously, asOwner } from './helpers/client'
import { USER_A, USER_B } from './helpers/fixtures'
import { expectPermissionDenied, expectRlsViolation } from './helpers/expect'

/**
 * `cron_runs` — 배치 실행 기록 (P5a 컷 2a)
 * DOC-002 §4.11 · I-19 · I-20 · DOC-013 §7.2 (AQ-51 종결)
 *
 * ## 이 테이블의 성질은 다른 열두 개와 다르다
 *
 * 도메인 사실이 아니라 **시스템이 자기 실행에 대해 남기는 기록**이다. 그래서
 * ⓐ 조회는 공용이고 ⓑ **INSERT만 되며** ⓒ 귀속이 위조 불가여야 한다.
 * 셋 다 여기서 본다.
 */

const RUN = {
  caller: 'BATCH',
  outcome: 'OK',
  started_at: '2026-08-05T05:00:00Z',
  finished_at: '2026-08-05T05:00:03Z',
  target_count: 6,
  succeeded: 4,
  skipped: 1,
  unmapped: 1,
} as const

const insert = (actor: string, over: Partial<Record<string, unknown>> = {}) => {
  const row = { actor_id: actor, ...RUN, ...over }
  const keys = Object.keys(row)
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
  return {
    sql: `insert into public.cron_runs (${keys.join(', ')}) values (${placeholders})`,
    values: keys.map((k) => (row as Record<string, unknown>)[k]),
  }
}

describe('cron_runs — 조회는 공용, 쓰기는 INSERT 뿐', () => {
  it('본인 id로 실행 기록을 남길 수 있다', async () => {
    const { sql, values } = insert(USER_A)
    await actingAs(USER_A).query(sql, values)

    const seen = await actingAs(USER_A).query('select id from public.cron_runs')
    expect(seen.rowCount).toBeGreaterThan(0)
  })

  it('B가 A의 실행 기록을 «조회»한다 — 관측 기록은 공용이다', async () => {
    const { sql, values } = insert(USER_A)
    await actingAs(USER_A).query(sql, values)

    const seen = await actingAs(USER_B).query(
      'select id from public.cron_runs where actor_id = $1',
      [USER_A],
    )
    expect(seen.rowCount).toBeGreaterThan(0)
  })

  it('★ 남의 id로는 남길 수 없다 — actor_id가 위조 불가다', async () => {
    /*
     * `caller`는 요청이 스스로 주장하는 값이라 판별자가 아니고, **위조 불가한 것은 이
     * 열뿐이다.** 이 케이스는 그 성질을 고정한다.
     *
     * ★ 이 성질은 AQ-57의 답에 «의존한다» — `service_role`은 `rolbypassrls = t`라서 이
     * 정책이 **아예 적용되지 않는다.** ⓐ(GoTrue 사용자)를 택했기 때문에 이 케이스가
     * 뜻을 갖는다. **그 절반은 그대로다.**
     *
     * ★★ **그러나 「근거 ②를 닫는다」는 종전 문장은 «철회한다» — AQ-69 (P5a 컷 5).**
     * 운영이 ⓐ′(배치가 민서 자신의 계정을 쓴다)로 정해졌으므로 `actor_id`가 모든 행에서
     * 같고, 「배치가 썼는가」를 위조 불가로 말하는 열이 **없다.** 즉 이 케이스가 증명하는
     * 것은 **「남의 id로 쓸 수 없다」이지 「배치와 사람이 갈린다」가 아니다.**
     *
     * 그 구분이 중요하다 — 단언은 그대로 참이고 **그것을 근거로 삼은 서술만 거짓**이
     * 됐다. 여기서 케이스를 지우면 정책 자체가 무방비가 되므로 남기고, 무엇을 증명하는지를
     * 좁혀 적는다. (DOC-002 §4.11 · DOC-013 §11 별항 ④가 같은 철회를 적는다.)
     */
    const { sql, values } = insert(USER_B) // A가 B의 id로 쓴다
    /*
     * ★ `expectRlsViolation`이다 — `expectPermissionDenied`가 아니다. 둘은 **SQLSTATE가
     * 같고(42501) 메시지로만 갈린다**(`helpers/expect.ts`의 표). 여기서 막는 것은 GRANT가
     * 아니라 INSERT 정책의 `WITH CHECK`이므로 「row-level security」쪽이다.
     * 처음에 후자를 썼고 그래서 빨간불이 났다 — **거부의 «형태»를 틀리면 통과해도
     * 아무것도 증명하지 못한다**는 그 파일의 경고가 실제로 작동한 자리다.
     */
    await expectRlsViolation(() => actingAs(USER_A).query(sql, values))
  })

  it('UPDATE·DELETE는 권한 자체가 없다 — 고칠 수 있는 기록은 기록이 아니다', async () => {
    const { sql, values } = insert(USER_A)
    await actingAs(USER_A).query(sql, values)

    await expectPermissionDenied(() =>
      actingAs(USER_A).query(`update public.cron_runs set succeeded = 999`),
    )
    await expectPermissionDenied(() => actingAs(USER_A).query('delete from public.cron_runs'))
  })

  it('anon은 아무것도 못 한다', async () => {
    // `anonymously`는 «const Actor»다(함수가 아니다). anon에는 GRANT가 없으므로
    // 정책 이전 단계에서 막히고 그래서 「permission denied」쪽이다
    await expectPermissionDenied(() => anonymously.query('select id from public.cron_runs'))
  })
})

describe('cron_runs — I-19·I-20', () => {
  it('I-19 — 합이 대상 수를 넘으면 거부된다', async () => {
    const { sql, values } = insert(USER_A, { target_count: 2, succeeded: 2, skipped: 1, unmapped: 0 })
    await expect(actingAs(USER_A).query(sql, values)).rejects.toMatchObject({ code: '23514' })
  })

  it('I-19 — 음수는 거부된다', async () => {
    const { sql, values } = insert(USER_A, { succeeded: -1 })
    await expect(actingAs(USER_A).query(sql, values)).rejects.toMatchObject({ code: '23514' })
  })

  it('I-19 — 합이 대상 수와 «같은» 것은 통과한다 (경계)', async () => {
    const { sql, values } = insert(USER_A, {
      target_count: 3,
      succeeded: 1,
      skipped: 1,
      unmapped: 1,
    })
    await actingAs(USER_A).query(sql, values)
  })

  it('★ I-19가 «부등식»이므로 failed를 세지 않는다 — 그 사실을 고정한다', async () => {
    /*
     * DOC-011 §7.1의 불변식은 등식이다(`target_count = succeeded + skipped + unmapped
     * + failed.length`). `failed`가 JSONB라 단일 행 CHECK에서 그 길이를 세면 제약이
     * JSON 구조에 의존하므로 **DB는 바닥만 잡는다.**
     *
     * 그래서 「합이 대상 수보다 «작고» failed가 비어 있는」 행이 **DB를 통과한다** —
     * 즉 등식은 어느 DB 층도 강제하지 않는다. 이 케이스가 그 공백을 기록하며,
     * 등식을 단언하는 자리는 수집기의 순수 모듈(P5a 컷 3)이다.
     */
    const { sql, values } = insert(USER_A, {
      target_count: 10,
      succeeded: 1,
      skipped: 0,
      unmapped: 0,
      failed: '[]',
    })
    await actingAs(USER_A).query(sql, values) // 통과한다 — 그것이 이 케이스의 요점이다
  })

  it('I-20 — finished_at이 started_at보다 앞이면 거부된다', async () => {
    const { sql, values } = insert(USER_A, {
      started_at: '2026-08-05T05:00:03Z',
      finished_at: '2026-08-05T05:00:00Z',
    })
    await expect(actingAs(USER_A).query(sql, values)).rejects.toMatchObject({ code: '23514' })
  })

  it('열거형이 어휘를 강제한다 — DOC-011 §3.2의 것만 쓴다', async () => {
    const bad = insert(USER_A, { outcome: 'MAYBE' })
    await expect(actingAs(USER_A).query(bad.sql, bad.values)).rejects.toMatchObject({
      code: '22P02',
    })
  })
})

describe('cron_runs — 카탈로그', () => {
  it('RLS가 켜져 있다 (절대 규칙 #6)', async () => {
    const r = await asOwner<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname = 'cron_runs'`,
    )
    expect(r.rows[0]?.relrowsecurity).toBe(true)
  })

  it('numeric 열이 없다 — 드리프트 원장이 그대로인 근거', async () => {
    /*
     * DOC-013 §7.2가 「이 테이블은 비용이 닫혀 있다」고 적은 근거 절반이다.
     * `numeric` 열이 생기면 `tests/integration/types-drift.test.ts`의 17행 원장과
     * `*_COLUMNS` 사양(`::text` 캐스팅)이 함께 움직여야 한다.
     */
    const r = await asOwner<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'cron_runs' and data_type = 'numeric'`,
    )
    expect(r.rows).toEqual([])
  })

  it('트리거가 없다 — functions.test.ts의 세 축을 건드리지 않는 근거', async () => {
    const r = await asOwner<{ tgname: string }>(
      `select t.tgname from pg_trigger t
        where t.tgrelid = 'public.cron_runs'::regclass and not t.tgisinternal`,
    )
    expect(r.rows).toEqual([])
  })
})
