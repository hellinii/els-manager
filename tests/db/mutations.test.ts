import { describe, expect, it } from 'vitest'

import { requireAffected, staleState } from '@/lib/db/mutations/access'
import { collectAndRecord } from '@/lib/db/mutations/collect'
import type { UserSessionClient } from '@/lib/db/client'
import {
  createMutations,
  createUnauthenticatedMutations,
  type MutationContext,
} from '@/lib/db/mutations/context'

/**
 * 변경 계층 — DB 없이 볼 수 있는 것 (DOC-011 §5.0)
 *
 * 계약의 **왕복**은 `tests/integration/mutations.test.ts`가 실제 JWT·PostgREST로
 * 본다. 여기서는 그 앞의 세 가지만 본다: 계약 집합이 문서와 같은가, 미인증 묶음이
 * 그 집합을 빠짐없이 덮는가, 컨텍스트의 전제가 조립 시점에 걸리는가.
 */

const VIEWER = '00000000-0000-4000-8000-0000000000aa'

/**
 * 조립만 하므로 클라이언트는 호출되지 않는다 — 팩토리는 `ctx`를 클로저에 담을 뿐
 * 생성 시점에 질의하지 않는다. 그 사실 자체가 이 파일이 DB 없이 도는 근거다.
 */
const STUB_DB = {} as UserSessionClient

const CONTEXT: MutationContext = { db: STUB_DB, asOf: '2026-06-30', viewerId: VIEWER }

/** DOC-011 §5의 계약. **문서의 절 번호와 함께 적는다** — 목록이 정본과 갈리면 드러난다 */
const CONTRACTS = [
  ['§5.1', 'createProduct'],
  ['§5.2', 'updateProduct'],
  ['§5.3', 'deleteProduct'],
  ['§5.4', 'createRedemption'],
  ['§5.5', 'updateRedemption'],
  ['§5.5', 'deleteRedemption'],
  ['§5.6', 'saveTaxProfile'],
  ['§5.7', 'saveManualPrice'],
  ['§5.8', 'refreshPrices'],
  ['§5.9', 'setKiTouched'],
  ['§5.10', 'createAsset'],
  ['§5.11', 'createRealizedProduct'],
  ['§5.12', 'saveProviderSymbol'],
] as const

describe('계약 집합이 §5와 일치한다', () => {
  it('13개이며 이름이 문서와 같다', () => {
    const mutations = createMutations(CONTEXT)
    expect(Object.keys(mutations).sort()).toEqual(CONTRACTS.map(([, name]) => name).sort())
  })

  it('전부 함수다 — 스프레드로 합치므로 키가 덮이면 조용히 사라진다', () => {
    const mutations = createMutations(CONTEXT) as Record<string, unknown>
    for (const [section, name] of CONTRACTS) {
      expect(typeof mutations[name], `${section} ${name}`).toBe('function')
    }
  })
})

describe('미인증은 던지지 않고 결과 객체를 준다 (W-03)', () => {
  /**
   * **키 집합이 같은지를 본다.** 타입도 이것을 강제하지만(`Mutations` 반환 선언),
   * 런타임 비교를 함께 두는 이유는 계약이 하나 늘었을 때 화면이 보는 실패
   * 형태가 `UNAUTHENTICATED`가 아니라 `undefined is not a function`이 되기
   * 때문이다 — 그 차이는 입력값 보존이 되느냐 마느냐다.
   */
  it('인증 묶음과 같은 키를 갖는다', () => {
    expect(Object.keys(createUnauthenticatedMutations()).sort()).toEqual(
      Object.keys(createMutations(CONTEXT)).sort(),
    )
  })

  it('전 계약이 UNAUTHENTICATED를 반환한다 — 예외가 아니다', async () => {
    const mutations = createUnauthenticatedMutations() as unknown as Record<
      string,
      () => Promise<{ ok: boolean; error?: { code: string; message: string } }>
    >

    for (const [section, name] of CONTRACTS) {
      const result = await mutations[name]()
      expect(result.ok, `${section} ${name}`).toBe(false)
      expect(result.error?.code, `${section} ${name}`).toBe('UNAUTHENTICATED')
      // 화면이 그대로 보여주는 문자열이므로 비어 있으면 안 된다
      expect(result.error?.message, `${section} ${name}`).not.toBe('')
    }
  })
})

describe('컨텍스트의 전제는 조립 시점에 걸린다', () => {
  /**
   * 빈 `viewerId`로 조립되면 **모든 소유자 판정이 실패**해 본인 상품에도
   * `FORBIDDEN`이 나온다. 조회의 `assertContext`와 같은 이유이며 쓰기에서 더 무겁다.
   */
  it('viewerId가 비면 던진다', () => {
    expect(() => createMutations({ ...CONTEXT, viewerId: '   ' })).toThrow(/viewerId/)
  })

  it('미인증 경로가 따로 있다는 것을 오류가 말한다', () => {
    expect(() => createMutations({ ...CONTEXT, viewerId: '' })).toThrow(
      /createUnauthenticatedMutations/,
    )
  })

  it('기준일 형식이 깨지면 던진다 — V-17이 이 값을 쓴다', () => {
    expect(() => createMutations({ ...CONTEXT, asOf: '2026-6-30' })).toThrow(/기준일/)
    expect(() => createMutations({ ...CONTEXT, asOf: '' })).toThrow(/기준일/)
  })
})

describe('W-05 둘째 겹 — 영향 행 0을 성공으로 넘기지 않는다', () => {
  /**
   * **여기서는 함수의 계약만 본다.** "계약 9곳이 실제로 이것을 부르는가"는
   * `tests/integration/mutations.test.ts`가 RLS 0행을 만들어 확인한다 — 그쪽이
   * 없으면 이 파일은 쓰이지 않는 함수를 검증하는 셈이 된다.
   */
  it('0행은 CONFLICT다 — null과 빈 배열 둘 다', () => {
    // PostgREST는 `.select()`가 붙으면 배열을, 안 붙으면 null을 준다. 둘 다 0행이다
    expect(requireAffected(null)?.code).toBe('CONFLICT')
    expect(requireAffected([])?.code).toBe('CONFLICT')
  })

  it('1행 이상은 통과다', () => {
    expect(requireAffected([{ id: 'x' }])).toBeNull()
    expect(requireAffected([{ id: 'x' }, { id: 'y' }])).toBeNull()
  })

  /**
   * **NOT_FOUND도 FORBIDDEN도 아닌 이유.** 사전 조회가 이미 존재와 소유를
   * 확인했으므로 그 뒤의 0행은 **그 사이에 상태가 바뀌었다**는 뜻이다. 사용자가
   * 할 일은 입력을 고치는 것도 권한을 얻는 것도 아니고 화면을 갱신하는 것이다.
   */
  it('메시지가 화면 갱신을 지시한다 — 고칠 필드를 주지 않는다', () => {
    const error = staleState()
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toContain('화면을 갱신')
    expect(error.fields).toBeUndefined()
  })

  /**
   * **쓰기 함수의 `NULL` 반환도 같은 사실이므로 같은 값을 쓴다** (§5.2 각주).
   * 두 경로가 다른 문구를 내면 화면이 같은 상황을 두 가지로 설명한다.
   */
  it('rpc의 NULL 경로와 같은 오류를 쓴다', () => {
    expect(requireAffected([])).toEqual(staleState())
  })

  /**
   * **네 계약은 이 방어에 도달할 수 없다** — 등재해 둔다.
   *
   * `saveTaxProfile`·`saveManualPrice`는 UPSERT, `createRedemption`·`createAsset`은
   * INSERT다. RLS가 그 둘을 막을 때는 `WITH CHECK` 위반이라 **`42501`을 던지지
   * 0행을 내지 않는다**(`tests/rls/helpers/expect.ts`의 형태 표). 그래서 네 곳의
   * `requireAffected`·`staleState` 호출은 방어라기보다 **전제가 깨졌을 때 없는
   * id를 화면에 넘기지 않기 위한 것**이며, 통합 스위트가 재현할 수 있는 경로가
   * 아니다. 도달 가능한 다섯(§5.2·§5.3·§5.5 둘·§5.9)은 그쪽에서 본다.
   */
  it('도달 가능한 계약은 UPDATE·DELETE를 하는 다섯이다', () => {
    const reachable = [
      'updateProduct',
      'deleteProduct',
      'updateRedemption',
      'deleteRedemption',
      'setKiTouched',
    ]
    const mutations = createMutations(CONTEXT) as Record<string, unknown>
    for (const name of reachable) {
      expect(typeof mutations[name], name).toBe('function')
    }
  })
})

describe('§5.8 refreshPrices — 레지스트리 게이트', () => {
  /**
   * ★ **이 블록의 형태가 컷 3에서 뒤집혔다.**
   *
   * 종전에는 「공급자 0개 → `PROVIDER_UNAVAILABLE`」을 `createMutations(CONTEXT)`로
   * 직접 확인했고, 그것이 가능했던 이유는 **레지스트리가 실제로 비어 있었기 때문**이다.
   * 컷 3이 키움을 등재하면서 그 호출은 이제 `STUB_DB.from`을 부르려 하고 —
   * 실제로 `TypeError: ctx.db.from is not a function`으로 빨간불이 됐다 —
   * 그것이 「등재됐다」의 정직한 신호였다.
   *
   * 게이트 자체는 살아 있다(레지스트리를 비우고 배포하는 경로가 있다). 그래서 그것을
   * **`collectAndRecord`의 `factories` 인자**로 본다 — 모듈 상수를 mock하지 않고,
   * 그러면 `PROVIDER_CREDENTIALS`까지 가짜가 되는 부작용도 없다.
   */
  it('공급자 0개 — PROVIDER_UNAVAILABLE이고 DB에 닿지 않는다', async () => {
    const result = await collectAndRecord(CONTEXT, 'MANUAL_REFRESH', {
      startedAt: '2026-06-30T05:00:00.000Z',
      finishedAt: () => '2026-06-30T05:00:01.000Z',
      factories: [],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    /*
     * `ok: true` + `succeeded: 0`이 아니다. 둘의 차이는 화면 처리다 — 전자는
     * ST-03(수동 입력 폴백)으로 유도하고 후자는 「갱신했으나 대상이 없었다」로 읽힌다.
     * `STUB_DB`에 `from`이 없으므로 **DB에 닿지 않았다는 것이 값이 아니라 구조로** 참이다.
     */
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('★ 둘 이상 — 조용히 첫 것을 쓰지 않고 INTERNAL이다 (컷 1c의 강제 장치)', async () => {
    /*
     * 대조 원천이 등재되는 날 이 갈래가 실제로 발화한다. 그때 「주 원천만 쓴다」를
     * 명시하지 않으면 배치가 멈추고, 그것이 **조용히 첫 것만 쓰는 것보다 낫다** —
     * 후자는 컷 1c의 등재가 아무 일도 하지 않으면서 초록인 상태다.
     */
    const stub = { id: 'X', create: () => { throw new Error('불려서는 안 된다') } }
    const result = await collectAndRecord(CONTEXT, 'BATCH', {
      startedAt: '2026-06-30T05:00:00.000Z',
      finishedAt: () => '2026-06-30T05:00:01.000Z',
      factories: [stub, { ...stub, id: 'Y' }],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INTERNAL')
  })
})
