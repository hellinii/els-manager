import { describe, expect, it } from 'vitest'

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
] as const

describe('계약 집합이 §5와 일치한다', () => {
  it('11개이며 이름이 문서와 같다', () => {
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

describe('§5.8 refreshPrices — 공급자 0개', () => {
  /**
   * `ok: true` + `succeeded: 0`이 아니다. 둘의 차이는 화면 처리다 — 전자는
   * ST-03(수동 입력 폴백)으로 유도하고 후자는 "갱신했으나 대상이 없었다"로 읽힌다.
   * DB에 닿지 않으므로 이 스위트에서 본다.
   */
  it('PROVIDER_UNAVAILABLE을 반환하고 DB에 닿지 않는다', async () => {
    const result = await createMutations(CONTEXT).refreshPrices()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE')
  })
})
