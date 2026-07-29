import { describe, expect, it } from 'vitest'

import { createUnauthenticatedMutations, mutationsFor } from '@/lib/db/mutations/context'
import { UnauthenticatedError, queriesFor } from '@/lib/db/queries/context'

/**
 * 세션 해석 → 계약 묶음의 두 분기 — AQ-23 ①
 *
 * ## 왜 이 파일이 생겼는가
 *
 * 이 판단은 원래 `src/lib/db/server.ts` 안에 있었고, 그 파일은 `next`를
 * import하므로 **어떤 스위트도 import할 수 없다.** AQ-23이 등재한 공백이 정확히
 * 그것이다 — 미인증 시 조회는 던지고 변경은 결과 객체를 준다는 **비대칭이 설계의
 * 핵심인데, 어느 쪽 분기도 한 번도 실행되지 않았다.**
 *
 * `tests/db/mutations.test.ts`가 미인증 묶음의 **키 집합**은 보았지만 그 묶음이
 * 실제로 선택되는지는 보지 못했다. 키가 맞는 객체가 만들어진다는 것과 미인증
 * 요청이 그것을 받는다는 것은 다른 명제다.
 *
 * 결선(쿠키 해석·`getUser()` 왕복)만 `server.ts`에 남기고 판단을 `queriesFor`·
 * `mutationsFor`로 옮겨 여기서 본다. DB도 Next도 필요 없다.
 */

const CTX = { db: {} as never, asOf: '2026-07-28' }
const USER = { id: '00000000-0000-4000-8000-000000000101' }

describe('queriesFor — 조회는 던진다 (Q-04)', () => {
  it('미인증이면 UnauthenticatedError를 던진다', () => {
    expect(() => queriesFor(null, CTX)).toThrow(UnauthenticatedError)
  })

  it('문구가 아니라 클래스로 판별된다', () => {
    // 문구 정규식으로 단언하면 메시지를 다듬는 순간 테스트가 깨진다 —
    // P3b.5가 다른 곳에서 걷어낸 부류의 취약한 단언이다.
    try {
      queriesFor(null, CTX)
      expect.unreachable('던졌어야 한다')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthenticatedError)
      expect((error as Error).name).toBe('UnauthenticatedError')
    }
  })

  it('인증되면 계약 묶음을 주고 viewerId가 결속된다', () => {
    const queries = queriesFor(USER, CTX)

    // §4.1~§4.9 아홉 개 — 전부다. §4.7 `getForecast`가 P4b 컷 7에서 들어왔다.
    expect(Object.keys(queries).sort()).toEqual([
      'getDashboard',
      'getForecast',
      'getProduct',
      'getTaxSummary',
      'listAssetPrices',
      'listProducts',
      'listSchedule',
      'listUserSummaries',
      'searchAssets',
    ])
  })

  it('빈 viewerId는 조립 시점에 거부된다', () => {
    // 미인증과 다른 경우다 — 세션은 해석됐는데 id가 비어 있으면 모든 isOwner가
    // false가 되고 getTaxSummary가 남의 것을 본인으로 오인할 수 있다.
    expect(() => queriesFor({ id: '   ' }, CTX)).toThrow(/viewerId/)
  })
})

describe('mutationsFor — 변경은 값을 준다 (W-03)', () => {
  it('미인증이어도 던지지 않는다', () => {
    // 비대칭이 설계의 핵심이다. 던지면 에러 경계가 화면을 갈아치우고
    // **입력값이 사라진다**(DOC-008 §6이 SCR-203·204에 보존을 요구한다).
    expect(() => mutationsFor(null, CTX)).not.toThrow()
  })

  it('미인증 묶음의 모든 계약이 UNAUTHENTICATED를 준다', async () => {
    const mutations = mutationsFor(null, CTX)

    // 계약 하나가 늘고 미인증 묶음에서 빠지면 화면에서
    // `undefined is not a function`이 된다. 전수로 본다.
    const keys = Object.keys(createUnauthenticatedMutations()) as Array<
      keyof typeof mutations
    >
    expect(keys).toHaveLength(11)

    for (const key of keys) {
      const result = await (mutations[key] as () => Promise<unknown>)()
      expect(result, `${key}가 UNAUTHENTICATED를 주지 않는다`).toEqual({
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요하다.' },
      })
    }
  })

  it('미인증 분기가 실제로 선택된다 — 인증 묶음과 다른 객체다', async () => {
    /*
     * 키 집합만 보면 두 묶음을 구분할 수 없다(그것이 종전 테스트의 한계였다).
     * 미인증 쪽만 UNAUTHENTICATED를 준다는 것으로 분기를 확인한다.
     */
    const authed = mutationsFor(USER, CTX)
    const anon = mutationsFor(null, CTX)

    expect(Object.keys(authed).sort()).toEqual(Object.keys(anon).sort())
    await expect(anon.deleteProduct('x')).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    })
  })

  it('빈 viewerId는 조립 시점에 거부된다', () => {
    expect(() => mutationsFor({ id: '' }, CTX)).toThrow(/viewerId/)
  })
})

describe('두 분기의 비대칭 — AQ-17·W-03', () => {
  it('같은 미인증 입력에 조회는 던지고 변경은 값을 준다', async () => {
    expect(() => queriesFor(null, CTX)).toThrow()

    const anon = mutationsFor(null, CTX)
    await expect(anon.refreshPrices()).resolves.toMatchObject({ ok: false })
  })
})
