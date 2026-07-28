import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMutations, type Mutations } from '@/lib/db/mutations/context'
import { toInsert } from '@/lib/db/mutations/payload'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { ProductInput, RedemptionInput } from '@/lib/db/mutations/types'

import { FX, FX_NAME_PREFIX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures } from './helpers/seed'
import {
  AS_OF,
  contractsFor,
  countRequests,
  setupScenario,
  tallyPaths,
  type Contracts,
} from './helpers/scenario'

/**
 * 변경 계약 11개 — 실제 JWT · PostgREST 왕복 (DOC-011 §5)
 *
 * ## 이 스위트만 증명할 수 있는 것
 *
 * `tests/db/`는 DB 없이 검증 규칙과 매핑을 본다. 그것으로는 **계약이 실제로
 * 도는가**를 알 수 없다 — 열 이름이 틀렸는지, RLS가 막는지, 금액이 문자열로
 * 왕복하는지, 그리고 **쓰기 함수가 실패했을 때 정말 아무것도 남지 않는지**는
 * 여기서만 드러난다. 마지막 항목이 쓰기 함수를 도입한 유일한 이유다.
 *
 * ## 픽스처 정리
 *
 * `createProduct`는 서버가 만든 UUID를 쓰므로 고정 UUID 목록으로 지울 수 없다.
 * 이름을 전부 `FX_NAME_PREFIX`로 시작시키고 `resetFixtures()`가 그 대역을 지운다.
 */

const NAME = {
  created: `${FX_NAME_PREFIX} 변경-생성`,
  updated: `${FX_NAME_PREFIX} 변경-수정됨`,
  atomicity: `${FX_NAME_PREFIX} 변경-원자성`,
  stale: `${FX_NAME_PREFIX} 변경-영향0행`,
  staleRedeemed: `${FX_NAME_PREFIX} 변경-영향0행-상환`,
  asset1: `${FX_NAME_PREFIX} 변경자산1`,
  asset2: `${FX_NAME_PREFIX} 변경자산2`,
} as const

/**
 * **float64로 왕복하면 값이 바뀌는 금액을 일부러 쓴다.**
 *
 * `principal`은 `numeric(15,0)`의 상한인 15자리, `basePrice`는 `numeric(18,6)`에서
 * 17유효자릿수다. 후자를 JSON 수치로 실으면 `100000000000.000000`으로 저장된다는
 * 것을 P3b 7단계에서 실측했다 — 그 경로를 지나지 않았음을 값으로 증명한다.
 */
const PRINCIPAL = '123456789012345'
const BASE_PRICE = '99999999999.999999'

function productInput(overrides: Partial<ProductInput> & { assetId: string }): ProductInput {
  const { assetId, ...rest } = overrides
  return {
    name: NAME.created,
    issuer: '테스트증권',
    issueDate: '2026-01-02',
    principal: PRINCIPAL,
    evaluationPeriodMonths: 6,
    totalRounds: 2,
    annualCouponRate: '0.0800',
    accountType: 'GENERAL',
    underlyings: [{ assetId, basePrice: BASE_PRICE, sequence: 1 }],
    schedules: [
      { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9000' },
      {
        roundNo: 2,
        evaluationDate: '2027-01-04',
        barrier: '0.8500',
        lizardBarrier: '0.8000',
        // 원금상환형 리자드 — V-08의 하한이 필드별인 이유(DOC-007 §4.1)
        lizardCouponRate: '0',
        lizardRequiresNoKi: true,
      },
    ],
    ...rest,
  }
}

/** 실패 결과에서 오류를 꺼낸다. 성공이면 그 사실을 메시지에 담아 던진다 */
function errorOf<T>(result: ActionResult<T>): { code: string; message: string; fields?: Record<string, string> } {
  if (result.ok) {
    throw new Error(`실패를 기대했으나 성공했다: ${JSON.stringify(result.data)}`)
  }
  return result.error
}

function dataOf<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    throw new Error(`성공을 기대했으나 실패했다: ${JSON.stringify(result.error)}`)
  }
  return result.data
}

let a: Contracts
let b: Contracts
let assetId: string
let assetId2: string

beforeAll(async () => {
  await setupScenario()
  ;[a, b] = await Promise.all([contractsFor(ITG_USER_A), contractsFor(ITG_USER_B)])

  assetId = dataOf(
    await a.write.createAsset({
      name: NAME.asset1,
      assetType: 'STOCK',
      market: 'NASDAQ',
      currency: 'USD',
    }),
  ).id
  assetId2 = dataOf(
    await a.write.createAsset({
      name: NAME.asset2,
      assetType: 'INDEX',
      market: 'KRX',
      currency: 'KRW',
    }),
  ).id
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

// ---------------------------------------------------------------------------
// §5.10 · §5.1 · §5.2 — 등록하고 조회 계약으로 되읽는다
// ---------------------------------------------------------------------------

describe('§5.1 createProduct — 등록 후 조회 계약이 같은 값을 준다', () => {
  it('금액·비율이 문자열 그대로 왕복한다 (W-04, AQ-30)', async () => {
    const created = dataOf(await a.write.createProduct(productInput({ assetId })))

    const view = await a.read.getProduct(created.id)
    expect(view).not.toBeNull()

    // ★ float64를 경유했다면 두 값 모두 달라진다. 값 비교가 여기서만 의미를 갖는
    //   이유는 자릿수를 일부러 경계에 두었기 때문이다.
    expect(view!.product.principal).toBe(PRINCIPAL)
    expect(view!.underlyings[0].basePrice).toBe(BASE_PRICE)

    expect(view!.product.name).toBe(NAME.created)
    expect(view!.product.issuer).toBe('테스트증권')
    // owner_id는 payload가 아니라 auth.uid()에서 왔다 (§5.1)
    expect(view!.product.ownerId).toBe(ITG_USER_A)
    expect(view!.product.isOwner).toBe(true)
    expect(view!.product.integrityIssue).toBeNull()
    expect(view!.schedules).toHaveLength(2)
    // 원금상환형 리자드가 '0'으로 저장된다 — V-08 세분의 실효 확인
    expect(view!.schedules[1].lizardCouponRate).toBe('0.0000')

    await dataOf(await a.write.deleteProduct(created.id))
  })

  it('payload가 ownerId를 주장해도 무시된다 — 함수가 auth.uid()로 박는다', async () => {
    const input = productInput({ assetId }) as ProductInput & { ownerId?: string }
    input.ownerId = ITG_USER_B

    const created = dataOf(await a.write.createProduct(input))
    const view = await a.read.getProduct(created.id)

    expect(view!.product.ownerId).toBe(ITG_USER_A)
    await a.write.deleteProduct(created.id)
  })

  it('V-02 — 기초자산 0건은 계약 계층에서 거부되고 DB에 닿지 않는다', async () => {
    const counter = countRequests()
    try {
      const error = errorOf(
        await a.write.createProduct(productInput({ assetId, underlyings: [] })),
      )
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.fields?.underlyings).toBeDefined()
      // 검증이 앞에서 잡으므로 왕복이 **0**이다 — 이것이 계약 계층의 값이다
      expect(counter.rest()).toBe(0)
    } finally {
      counter.restore()
    }
  })

  it('V-03 — 평가일정 수가 totalRounds와 다르면 거부된다', async () => {
    const error = errorOf(
      await a.write.createProduct(productInput({ assetId, totalRounds: 3 })),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.schedules).toContain('총 차수')
  })
})

describe('§5.2 updateProduct — 하위 배열 전체 교체', () => {
  let productId: string

  beforeAll(async () => {
    productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
  })

  afterAll(async () => {
    await a.write.deleteProduct(productId)
  })

  it('기초자산을 교체하면 옛 행이 남지 않는다', async () => {
    dataOf(
      await a.write.updateProduct(
        productId,
        productInput({
          assetId: assetId2,
          name: NAME.updated,
          principal: '50000000',
        }),
      ),
    )

    const view = await a.read.getProduct(productId)
    expect(view!.product.name).toBe(NAME.updated)
    expect(view!.product.principal).toBe('50000000')
    expect(view!.underlyings).toHaveLength(1)
    expect(view!.underlyings[0].assetId).toBe(assetId2)
  })

  it('타인은 수정할 수 없다 → FORBIDDEN (사전 조회가 구분한다)', async () => {
    const error = errorOf(await b.write.updateProduct(productId, productInput({ assetId })))
    expect(error.code).toBe('FORBIDDEN')
  })

  it('없는 id → NOT_FOUND. 형태가 아닌 id도 같다', async () => {
    const missing = errorOf(
      await a.write.updateProduct(
        '00000000-0000-4000-8000-0000000009ff',
        productInput({ assetId }),
      ),
    )
    expect(missing.code).toBe('NOT_FOUND')

    const malformed = errorOf(
      await a.write.updateProduct('not-a-uuid', productInput({ assetId })),
    )
    expect(malformed.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// ★ 원자성 실측 — 쓰기 함수를 도입한 유일한 이유
// ---------------------------------------------------------------------------

describe('★ 원자성 — 함수가 실패하면 상품 행이 남지 않는다', () => {
  /**
   * **계약 계층을 우회해 함수를 직접 부른다 (AQ-29).**
   *
   * V-02·V-09가 앞에서 잡으므로 계약을 경유해서는 이 경로에 닿을 수 없다. 그러나
   * 그것은 계약 계층의 방어이고, 여기서 보려는 것은 **DB 층이 스스로 되돌리는가**다.
   * 계약만 검증하면 함수를 도입한 이유(§5.1 각주)가 한 번도 확인되지 않는다 —
   * "요청 3개로는 성립하지 않는다"를 고쳤다고 주장하면서 그 고침을 측정하지 않는 셈이다.
   */
  async function productsNamed(name: string): Promise<string[]> {
    const { data, error } = await a.db.from('els_products').select('id').eq('name', name)
    if (error != null) throw new Error(`상품 조회 실패: ${error.message}`)
    return data.map((row) => row.id)
  }

  function rawPayload(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      name: NAME.atomicity,
      issuer: null,
      issueDate: '2026-01-02',
      principal: '10000000',
      evaluationPeriodMonths: 6,
      annualCouponRate: '0.08',
      kiBarrier: null,
      kiObservation: null,
      accountType: 'GENERAL',
      note: null,
      underlyings: [{ assetId, basePrice: '100', sequence: 1 }],
      schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' }],
      ...overrides,
    }
  }

  /**
   * **양성 대조 — 이것이 없으면 아래 셋이 공허하게 통과한다.**
   *
   * `productsNamed`가 (열 이름이 틀렸거나 이름이 어긋나) 항상 빈 배열을 준다면
   * ①②③의 "0건" 단언은 전부 초록색이 되고 원자성에 대해 **아무것도 증명하지
   * 않는다.** 그래서 같은 이름으로 실제 행을 만들어 계수기가 그것을 본다는 사실을
   * 먼저 고정한다 — 층이 아니라 전제를 검증한다.
   */
  it('⓪ 계수기가 실제로 행을 센다 (양성 대조)', async () => {
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)

    const created = dataOf(
      await a.write.createProduct(productInput({ assetId, name: NAME.atomicity })),
    )
    expect(await productsNamed(NAME.atomicity)).toEqual([created.id])

    dataOf(await a.write.deleteProduct(created.id))
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)
  })

  it('① 기초자산 0건 — 말미 검사가 걸리고 상품 행이 되돌아간다 (I-07)', async () => {
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)

    const { error } = await a.db.rpc('create_els_product', {
      payload: rawPayload({ underlyings: [] }) as never,
    })

    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')
    // plpgsql RAISE의 이름은 details 첫 줄로 온다 (P3b 2단계 실측)
    expect(error!.details).toBe('constraint=els_products_underlyings_required')

    // ★ 여기가 핵심이다 — 상품 INSERT는 이미 실행된 뒤에 예외가 났다
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)
  })

  it('② 평가일정 0건 — 같은 형태로 되돌아간다', async () => {
    const { error } = await a.db.rpc('create_els_product', {
      payload: rawPayload({ schedules: [] }) as never,
    })

    expect(error!.code).toBe('23514')
    expect(error!.details).toBe('constraint=els_products_schedules_required')
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)
  })

  /**
   * **중간 실패가 더 강한 증거다.** ①·②는 말미 검사이므로 "함수가 스스로 던진다"만
   * 보이지만, 여기서는 두 번째 INSERT가 제약 위반으로 죽는다 — 요청 3개로 나눴을
   * 때 정확히 남았을 상태(기초자산 1건만 들어간 상품)가 만들어지지 않음을 본다.
   */
  it('③ 자산 중복 — 하위 INSERT 도중에 죽어도 상품 행이 남지 않는다 (I-02)', async () => {
    const { error } = await a.db.rpc('create_els_product', {
      payload: rawPayload({
        underlyings: [
          { assetId, basePrice: '100', sequence: 1 },
          { assetId, basePrice: '200', sequence: 2 },
        ],
      }) as never,
    })

    expect(error!.code).toBe('23505')
    expect(error!.message).toContain('els_underlyings_els_id_asset_id_key')
    expect(await productsNamed(NAME.atomicity)).toHaveLength(0)
  })

  /**
   * **update가 가장 위험하다** — 삭제와 삽입 사이에 끊기면 되돌릴 원본이 없다(§5.2).
   * 이 케이스는 그 구간에서 실패시키고 **원본이 그대로인지**를 본다.
   */
  it('④ update 도중 실패 — 지운 하위 행이 되살아난다 (되돌릴 원본이 없는 구간)', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id

    const { error } = await a.db.rpc('update_els_product', {
      p_id: productId,
      payload: {
        name: `${FX_NAME_PREFIX} 변경-교체시도`,
        issuer: null,
        issueDate: '2026-01-02',
        principal: '1',
        evaluationPeriodMonths: 6,
        annualCouponRate: '0.08',
        kiBarrier: null,
        kiObservation: null,
        accountType: 'GENERAL',
        note: null,
        underlyings: [
          { assetId: assetId2, basePrice: '1', sequence: 1 },
          { assetId: assetId2, basePrice: '2', sequence: 2 },
        ],
        schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' }],
      } as never,
    })
    expect(error!.code).toBe('23505')

    // 상품 열도, 하위 행도 손대기 전 그대로다 — UPDATE·DELETE가 모두 되돌았다
    const view = await a.read.getProduct(productId)
    expect(view!.product.name).toBe(NAME.created)
    expect(view!.product.principal).toBe(PRINCIPAL)
    expect(view!.underlyings).toHaveLength(1)
    expect(view!.underlyings[0].assetId).toBe(assetId)
    expect(view!.underlyings[0].basePrice).toBe(BASE_PRICE)
    expect(view!.schedules).toHaveLength(2)

    await a.write.deleteProduct(productId)
  })

  /**
   * **④와 짝이다 — 같은 구간에서 다른 이유로 죽는다.**
   *
   * ④는 하위 INSERT 도중 `23505`로 죽는 경우이고, 이것은 **말미 검사**로
   * 죽는 경우다. 둘 다 삭제와 삽입 사이를 지난 뒤이므로 되돌리지 않으면
   * 0건 상태가 남고 원본은 이미 없다.
   *
   * update 쪽 I-07은 P3b.5 전까지 세 스위트 어디에도 없었다. 계약을 경유하면
   * V-02가 앞에서 잡으므로(왕복 0) 이 경로는 함수 직접 호출로만 닿는다(AQ-29).
   */
  it('④-2 update 말미 검사 — 기초자산 0건 교체가 되돌아간다 (I-07)', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id

    const { error } = await a.db.rpc('update_els_product', {
      p_id: productId,
      payload: {
        name: `${FX_NAME_PREFIX} 변경-말미검사`,
        issuer: null,
        issueDate: '2026-01-02',
        principal: '1',
        evaluationPeriodMonths: 6,
        annualCouponRate: '0.08',
        kiBarrier: null,
        kiObservation: null,
        accountType: 'GENERAL',
        note: null,
        underlyings: [],
        schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' }],
      } as never,
    })

    expect(error!.code).toBe('23514')
    // plpgsql RAISE의 이름은 details 첫 줄로 온다 — create 쪽 ①②와 같은 채널이다
    expect(error!.details).toBe('constraint=els_products_underlyings_required')

    // ★ 상품 열도, **이미 지워졌던 하위 행도** 그대로다
    const view = await a.read.getProduct(productId)
    expect(view!.product.name).toBe(NAME.created)
    expect(view!.product.principal).toBe(PRINCIPAL)
    expect(view!.underlyings).toHaveLength(1)
    expect(view!.underlyings[0].basePrice).toBe(BASE_PRICE)
    expect(view!.schedules).toHaveLength(2)

    await a.write.deleteProduct(productId)
  })

  /**
   * **대조군 — 함수를 쓰지 않았다면 무엇이 남는가.**
   *
   * ①~④는 "아무것도 남지 않는다"를 보인다. 그러나 그것이 함수 덕분인지, 애초에
   * 남을 일이 없었던 것인지는 그 단언만으로 갈리지 않는다. 여기서 v0.8까지의
   * 설계(요청 3개 = 트랜잭션 3개)를 그대로 재현해 **정확히 그 상태가 남는 것**을
   * 측정한다 — §5.1 각주의 주장이 실재함을 스위트가 스스로 보인다.
   */
  it('⑥ 대조군 — 요청 3개로 나누면 기초자산 0건 상품이 실제로 남는다 (§5.1 각주)', async () => {
    const orphanName = `${FX_NAME_PREFIX} 변경-대조군`

    // ① 상품만 먼저 커밋된다 (PostgREST는 요청당 1 트랜잭션이다)
    const inserted = await a.db
      .from('els_products')
      .insert(
        toInsert('els_products', {
          owner_id: ITG_USER_A,
          name: orphanName,
          issue_date: '2026-01-02',
          principal: '10000000',
          evaluation_period_months: 6,
          annual_coupon_rate: '0.08',
          account_type: 'GENERAL',
        }),
      )
      .select('id')
    expect(inserted.error).toBeNull()
    const orphanId = inserted.data![0].id

    // ② 두 번째 요청이 자산 중복으로 실패한다
    const children = await a.db.from('els_underlyings').insert([
      toInsert('els_underlyings', {
        els_id: orphanId,
        asset_id: assetId,
        base_price: '100',
        sequence: 1,
      }),
      toInsert('els_underlyings', {
        els_id: orphanId,
        asset_id: assetId,
        base_price: '200',
        sequence: 2,
      }),
    ])
    expect(children.error!.code).toBe('23505')

    // ★ 상품은 커밋된 채 남았다 — §5.3이 "계약을 경유하는 어떤 조작도 만들 수
    //   없다"고 단언한 바로 그 상태이고, 조회 계층은 이것을 결함으로 표시한다.
    const view = await a.read.getProduct(orphanId)
    expect(view).not.toBeNull()
    expect(view!.underlyings).toHaveLength(0)
    expect(view!.product.integrityIssue).toBe('UNDERLYING_MISSING')

    await a.db.from('els_products').delete().eq('id', orphanId)
    expect(await a.read.getProduct(orphanId)).toBeNull()
  })

  it('⑤ 계약을 경유하면 ①③에 닿지 않는다 — 두 층이 다른 일을 한다 (AQ-29)', async () => {
    const zero = errorOf(await a.write.createProduct(productInput({ assetId, underlyings: [] })))
    expect(zero.code).toBe('VALIDATION_FAILED')

    const duplicate = errorOf(
      await a.write.createProduct(
        productInput({
          assetId,
          underlyings: [
            { assetId, basePrice: '100', sequence: 1 },
            { assetId, basePrice: '200', sequence: 2 },
          ],
        }),
      ),
    )
    // V-09가 인덱스까지 붙여 말한다. DB는 배열의 몇 번째인지 말하지 못한다
    expect(duplicate.code).toBe('VALIDATION_FAILED')
    expect(duplicate.fields?.['underlyings[1].assetId']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// ★ W-05 둘째 겹 — 사전 조회는 통과하고 RLS가 0행을 낸다
// ---------------------------------------------------------------------------

describe('★ W-05 둘째 겹 — 영향 행 0을 성공으로 넘기지 않는다', () => {
  /**
   * **세션과 `viewerId`가 어긋난 이 조합은 프로덕션에서 발생하지 않는다** —
   * `server.ts`가 둘을 같은 `getUser()`에서 뽑는다. 경쟁 창(사전 조회와 변경
   * 사이에 다른 요청이 상태를 바꾸는)의 **결과 상태를 결정적으로 만들기 위한
   * 장치**이며, 경쟁 자체는 비결정적이라 그대로는 테스트할 수 없다.
   *
   * ```
   * 사전 조회  loadProduct → els_products_select_all이 using(true) → A의 상품 보임
   *            row.owner_id(A) === ctx.viewerId(A) → 통과
   * 변경       DELETE/UPDATE ... auth.uid() = B → USING이 감춤 → 0행, 오류 없음
   * 결과       requireAffected([]) → staleState() → CONFLICT
   * ```
   *
   * **W-05 인용문이 말한 그 상태다** — "그 0행을 성공으로 넘기면 사용자는
   * '저장됐다'는 화면을 보고 데이터는 그대로다." P3b.5 전까지 이 방어는 호출
   * 지점 9곳에 테스트가 0건이었다.
   *
   * **`CONFLICT`만 보지 않고 메시지까지 본다.** 이 계약들은 다른 이유로도
   * `CONFLICT`를 내므로("이미 상환 처리된 상품이다", "상환 실적이 있는 상품은
   * 삭제할 수 없다") 코드만 단언하면 사전 조회가 낸 거부와 구분되지 않는다.
   */
  let mismatched: Mutations
  let productId: string
  let redeemedProductId: string
  let redemptionId: string

  /** 사전 조회를 통과한 뒤 RLS가 0행을 내는지 — 그 신호는 문구가 특정한다 */
  function expectStale(result: ActionResult<unknown>, what: string): void {
    const error = errorOf(result)
    expect(error.code, what).toBe('CONFLICT')
    expect(error.message, `${what}: 사전 조회의 CONFLICT와 구분되어야 한다`).toContain(
      '상태가 그 사이에 바뀌었다',
    )
  }

  beforeAll(async () => {
    // B의 세션인데 자기가 A라고 주장하는 컨텍스트
    mismatched = createMutations({ db: b.db, asOf: AS_OF, viewerId: ITG_USER_A })

    productId = dataOf(
      await a.write.createProduct(productInput({ assetId, name: NAME.stale })),
    ).id

    redeemedProductId = dataOf(
      await a.write.createProduct(productInput({ assetId, name: NAME.staleRedeemed })),
    ).id
    redemptionId = dataOf(
      await a.write.createRedemption(redeemedProductId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2027-07-02',
        grossAmount: '110000000',
        taxableIncome: '10000000',
        withholdingTax: '1540000',
        isConfirmed: true,
      }),
    ).id
  })

  afterAll(async () => {
    await a.write.deleteRedemption(redemptionId)
    await a.write.deleteProduct(redeemedProductId)
    await a.write.deleteProduct(productId)
  })

  /**
   * **양성 대조 — 이것이 없으면 아래 다섯이 공허하게 통과한다.**
   *
   * 조작 자체가 어떤 이유로든 늘 실패한다면 "0행이라 CONFLICT"라는 단언은
   * 아무것도 증명하지 않는다. 같은 조작이 **일치하는** 컨텍스트에서 성공함을
   * 먼저 고정한다.
   */
  it('⓪ 일치하는 컨텍스트로는 같은 조작이 성공한다 (양성 대조)', async () => {
    dataOf(await a.write.setKiTouched(productId, null))
    dataOf(await a.write.updateProduct(productId, productInput({ assetId, name: NAME.stale })))
  })

  it('① deleteProduct — 0행이 CONFLICT가 되고 상품은 그대로 남는다', async () => {
    expectStale(await mismatched.deleteProduct(productId), 'deleteProduct')

    // 0행은 "권한 없음"과 "행 없음"을 구분하지 못한다 — 원본을 재조회해
    // 불변임을 함께 단언한다(tests/rls/helpers/expect.ts의 규약)
    const view = await a.read.getProduct(productId)
    expect(view, '거부됐는데 상품이 사라졌다면 0행의 원인이 다른 것이다').not.toBeNull()
    expect(view!.product.name).toBe(NAME.stale)
  })

  it('② setKiTouched — UPDATE의 0행도 같은 형태다', async () => {
    // `null`(해제)을 쓴다 — 이 상품은 노낙인이라 날짜를 넣으면 V-18이 앞에서
    // 잡아 UPDATE에 닿지 못한다
    expectStale(await mismatched.setKiTouched(productId, null), 'setKiTouched')
  })

  /**
   * **rpc의 `NULL` 반환은 별개 경로다.** `requireAffected`가 아니라 §5.2 각주의
   * `string | null` 복원이 그 0행을 잡는다 — 생성 타입이 `Returns: string`이라
   * 복원하지 않으면 `null`이 성공한 id로 읽힌다.
   */
  it('③ updateProduct — 함수의 NULL이 staleState로 복원된다 (§5.2 각주)', async () => {
    expectStale(
      await mismatched.updateProduct(productId, productInput({ assetId, name: NAME.updated })),
      'updateProduct',
    )

    // 하위 행 교체까지 진행되지 않았다 — 함수가 삭제 전에 NULL로 빠진다
    const view = await a.read.getProduct(productId)
    expect(view!.product.name).toBe(NAME.stale)
    expect(view!.underlyings).toHaveLength(1)
    expect(view!.schedules).toHaveLength(2)
  })

  it('④ updateRedemption — 부모를 경유한 소유자 판정을 통과한 뒤 0행이다', async () => {
    expectStale(
      await mismatched.updateRedemption(redemptionId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2027-07-02',
        grossAmount: '999',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: false,
      }),
      'updateRedemption',
    )

    const view = await a.read.getProduct(redeemedProductId)
    expect(view!.redemption!.grossAmount).toBe('110000000')
  })

  it('⑤ deleteRedemption — 상환이 그대로 남는다', async () => {
    expectStale(await mismatched.deleteRedemption(redemptionId), 'deleteRedemption')

    const view = await a.read.getProduct(redeemedProductId)
    expect(view!.redemption).not.toBeNull()
  })

  /**
   * **사전 조회가 먼저 잡는 거부와 섞이지 않는다.** 위 다섯이 전부 사전 조회를
   * **통과한** 경우다. 통과하지 못하는 경우(진짜 타인)는 `FORBIDDEN`이며 그것이
   * W-05 첫째 겹이다 — 두 겹이 서로 다른 코드를 낸다는 사실 자체를 고정한다.
   */
  it('⑥ 첫째 겹과 둘째 겹이 다른 코드를 낸다', async () => {
    // viewerId까지 B인 정직한 컨텍스트 — 사전 조회에서 걸린다
    expect(errorOf(await b.write.deleteProduct(productId)).code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// §5.4 · §5.5 · §5.3 — 상환과 삭제의 2단계
// ---------------------------------------------------------------------------

describe('§5.4 createRedemption', () => {
  let productId: string

  beforeAll(async () => {
    productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
  })

  afterAll(async () => {
    const view = await a.read.getProduct(productId)
    if (view?.redemption != null) await a.write.deleteRedemption(view.redemption.id)
    await a.write.deleteProduct(productId)
  })

  const input: RedemptionInput = {
    redemptionType: 'EARLY',
    roundNo: 1,
    redemptionDate: '2026-07-02',
    grossAmount: '104000000',
    taxableIncome: '4000000',
    isConfirmed: true,
  }

  it('원천징수액 미입력 → 상환일 연도의 분리과세율로 산출하고 원 단위 절사한다', async () => {
    dataOf(await a.write.createRedemption(productId, input))

    const view = await a.read.getProduct(productId)
    // 4,000,000 × 0.154 = 616,000. 2026년 separate_taxation_rate다(기준일 연도가 아니다)
    expect(view!.redemption!.withholdingTax).toBe('616000')
    expect(view!.redemption!.taxableIncome).toBe('4000000')
    expect(view!.product.integrityIssue).toBeNull()
  })

  /**
   * **소수부가 남는 값을 쓴다.** 종전 검증값은 전부 요율의 정확한 배수라
   * (`4,000,000 × 0.154 = 616,000`) `truncateToUnit`를 `roundToUnit`으로 바꿔도
   * 초록이었다 — §5.4 각주가 "접는 규칙을 DB에 맡기면 절사가 조용히 반올림이
   * 된다(AQ-16과 같은 부류)"고 적은 결정만 미측정이었다.
   */
  it('절사다 — 반올림이 아니다 (원 단위, DOC-007 §2)', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id

    // 1,000,005 × 0.154 = 154,000.77 → 절사 154,000 / 반올림 154,001
    dataOf(
      await a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '101000005',
        taxableIncome: '1000005',
        isConfirmed: true,
      }),
    )

    const view = await a.read.getProduct(productId)
    expect(view!.redemption!.withholdingTax).toBe('154000')

    await a.write.deleteRedemption(view!.redemption!.id)
    await a.write.deleteProduct(productId)
  })

  /**
   * **어느 연도의 상수인가 — 거부/성공으로 구분한다.**
   *
   * §5.4 각주는 `year(redemptionDate)`이지 기준일의 연도가 아니라고 규정한다.
   * 그런데 스위트의 상환일이 전부 2026년이고 `AS_OF`도 2026이라 두 구현이
   * 같은 값을 냈다. **`asOf`만 미래로 두는 접근은 무효다** —
   * `loadTaxYearContext`가 미시드 미래 연도를 최신 시드로 **근사**하므로 잘못된
   * 구현이 근사에 가려진다. 시드보다 **과거**는 거부되므로(ADR-005, 재현성)
   * 그쪽이 두 구현을 가른다.
   *
   * ```
   * 올바른 구현  year('2025-12-31') = 2025 → 시드 이전 → throw → INTERNAL
   * 깨진 구현    year(asOf)        = 2026 → 정확 매치 → ok, 값이 나온다
   * ```
   *
   * **현재는 거부/성공으로 구분하며, 다른 연도 시드가 추가되면 값 단언으로
   * 강화한다.** 2025·2026의 실제 분리과세율이 둘 다 15.4%라 값으로 가르려면
   * 없는 요율을 지어내야 하므로 지금은 하지 않는다. 시드가 늘면 이 케이스를
   * `expect(withholdingTax).toBe(<그 해의 값>)`으로 바꾼다.
   *
   * 이 테스트가 고정하는 "과거 상환 + 원천징수 미입력 = `INTERNAL`"은 §5.4
   * v1.1 각주가 먼저 명시한 상태다 — 옳은 코드인지는 P4에서 정한다.
   */
  it('상환일의 연도다 — 기준일의 연도가 아니다 (시드 이전 연도는 거부된다)', async () => {
    const productId = dataOf(
      await a.write.createProduct(
        productInput({
          assetId,
          name: `${FX_NAME_PREFIX} 변경-과거연도`,
          issueDate: '2025-01-02',
          schedules: [
            { roundNo: 1, evaluationDate: '2025-07-02', barrier: '0.9000' },
            { roundNo: 2, evaluationDate: '2026-01-05', barrier: '0.8500' },
          ],
        }),
      ),
    ).id

    const past: RedemptionInput = {
      redemptionType: 'MATURITY_GAIN',
      redemptionDate: '2025-12-31',
      grossAmount: '104000000',
      taxableIncome: '4000000',
      isConfirmed: true,
    }

    // 미입력이면 2025년 상수를 찾다가 거부된다. 기준일(2026) 연도를 썼다면 통과한다
    expect(errorOf(await a.write.createRedemption(productId, past)).code).toBe('INTERNAL')

    /**
     * **양성 대조 — 산출은 미입력 시에만 일어난다 (A-04).**
     *
     * 이것이 없으면 위 `INTERNAL`이 세율 조회가 아니라 다른 이유(상품·상환
     * 자체의 결함)에서 왔을 수 있다. 실제 징수액을 적으면 같은 상환이 통과하므로
     * 거부의 원인이 **세율 조회 하나**임이 고정된다.
     */
    const redemptionId = dataOf(
      await a.write.createRedemption(productId, { ...past, withholdingTax: '616000' }),
    ).id
    const view = await a.read.getProduct(productId)
    expect(view!.redemption!.withholdingTax).toBe('616000')

    await a.write.deleteRedemption(redemptionId)
    await a.write.deleteProduct(productId)
  })

  it('I-01 — 두 번째 상환은 CONFLICT다', async () => {
    const error = errorOf(await a.write.createRedemption(productId, input))
    expect(error.code).toBe('CONFLICT')
  })

  it('상환 완료 상품은 수정할 수 없다 → CONFLICT', async () => {
    const error = errorOf(await a.write.updateProduct(productId, productInput({ assetId })))
    expect(error.code).toBe('CONFLICT')
  })

  it('상환 완료 상품은 삭제할 수 없다 → CONFLICT (§5.3)', async () => {
    const error = errorOf(await a.write.deleteProduct(productId))
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toContain('상환을 먼저 취소')
  })
})

describe('§5.5 → §5.3 — 상품 삭제는 2단계다', () => {
  it('deleteRedemption 후에야 deleteProduct가 성공한다', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const redemptionId = dataOf(
      await a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2027-07-02',
        grossAmount: '110000000',
        taxableIncome: '10000000',
        withholdingTax: '1540000',
        isConfirmed: true,
      }),
    ).id

    // ① 상품 삭제가 막힌다
    expect(errorOf(await a.write.deleteProduct(productId)).code).toBe('CONFLICT')

    // ② 상환을 먼저 취소한다 — 타인은 못 한다
    expect(errorOf(await b.write.deleteRedemption(redemptionId)).code).toBe('FORBIDDEN')
    dataOf(await a.write.deleteRedemption(redemptionId))

    // ③ 이제 삭제된다
    dataOf(await a.write.deleteProduct(productId))
    expect(await a.read.getProduct(productId)).toBeNull()
  })

  it('updateRedemption — 과세소득을 고치면 원천징수 기본값이 함께 움직인다', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const redemptionId = dataOf(
      await a.write.createRedemption(productId, {
        redemptionType: 'EARLY',
        roundNo: 1,
        redemptionDate: '2026-07-02',
        grossAmount: '104000000',
        taxableIncome: '4000000',
        isConfirmed: true,
      }),
    ).id

    dataOf(
      await a.write.updateRedemption(redemptionId, {
        redemptionType: 'EARLY',
        roundNo: 1,
        redemptionDate: '2026-07-02',
        grossAmount: '103000000',
        taxableIncome: '3000000',
        isConfirmed: true,
      }),
    )

    const view = await a.read.getProduct(productId)
    // 3,000,000 × 0.154 = 462,000
    expect(view!.redemption!.withholdingTax).toBe('462000')
    expect(view!.redemption!.grossAmount).toBe('103000000')

    await a.write.deleteRedemption(redemptionId)
    await a.write.deleteProduct(productId)
  })

  it('V-10 — 상환일이 발행일보다 앞서면 거부된다 (DB에 없는 검사다)', async () => {
    const error = errorOf(
      await a.write.createRedemption(FX.productA, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2025-12-31',
        grossAmount: '1',
        taxableIncome: '0',
        isConfirmed: false,
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.redemptionDate).toContain('발행일')
  })

  it('V-12 — 만기상환(손실)의 과세 금융소득은 0이어야 한다 (절대 규칙 #8)', async () => {
    const error = errorOf(
      await a.write.createRedemption(FX.productA, {
        redemptionType: 'MATURITY_LOSS',
        redemptionDate: '2026-07-02',
        grossAmount: '80000000',
        taxableIncome: '1',
        isConfirmed: true,
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.taxableIncome).toContain('0이어야')
  })

  it('V-14 — 리자드 조건이 없는 차수에는 리자드 상환을 붙일 수 없다', async () => {
    const error = errorOf(
      await a.write.createRedemption(FX.productA, {
        redemptionType: 'LIZARD',
        roundNo: 1,
        redemptionDate: '2026-07-02',
        grossAmount: '100000000',
        taxableIncome: '0',
        isConfirmed: true,
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.roundNo).toContain('리자드 조건')
  })
})

// ---------------------------------------------------------------------------
// §5.9 · §5.7 · §5.6 · §5.10
// ---------------------------------------------------------------------------

describe('§5.9 setKiTouched', () => {
  it('낙인형 상품에 설정하고 해제한다', async () => {
    dataOf(await a.write.setKiTouched(FX.productA, '2026-06-15'))
    expect((await a.read.getProduct(FX.productA))!.product.kiTouchedAt).toBe('2026-06-15')

    dataOf(await a.write.setKiTouched(FX.productA, null))
    expect((await a.read.getProduct(FX.productA))!.product.kiTouchedAt).toBeNull()
  })

  it('V-18 — 노낙인 상품에는 설정할 수 없다. 해제는 허용된다 (I-15)', async () => {
    // productRedeemed는 ki_barrier가 없다
    const error = errorOf(await a.write.setKiTouched(FX.productRedeemed, '2026-06-15'))
    expect(error.code).toBe('VALIDATION_FAILED')
    // 키는 파라미터 이름(`touchedAt`)이 아니라 `kiTouchedAt`이다 — DB가 같은
    // 규칙을 잡을 때(`els_products_ki_touched_check`)와 같은 칸을 가리킨다
    expect(error.fields?.kiTouchedAt).toBeDefined()
    expect(error.fields?.touchedAt).toBeUndefined()

    // 이미 없는 것을 없애는 요청은 거부할 이유가 없다
    dataOf(await a.write.setKiTouched(FX.productRedeemed, null))
  })

  it('타인 상품에는 설정할 수 없다 → FORBIDDEN', async () => {
    expect(errorOf(await b.write.setKiTouched(FX.productA, '2026-06-15')).code).toBe(
      'FORBIDDEN',
    )
  })
})

describe('§5.7 saveManualPrice', () => {
  it('같은 좌표에 다시 넣으면 값이 갱신된다 — I-16 트리거를 통과한다', async () => {
    dataOf(
      await a.write.saveManualPrice({
        assetId,
        asOfDate: '2026-06-20',
        price: '123.456789',
      }),
    )
    dataOf(
      await a.write.saveManualPrice({
        assetId,
        asOfDate: '2026-06-20',
        price: '222.222222',
      }),
    )

    const prices = await a.read.listAssetPrices()
    const row = prices.find((item) => item.assetId === assetId)
    expect(row!.latestPrice).toBe('222.222222')
    expect(row!.source).toBe('MANUAL')
  })

  it('V-17 — 기준일 이후의 시세는 거부된다', async () => {
    const error = errorOf(
      await a.write.saveManualPrice({ assetId, asOfDate: '2026-07-01', price: '100' }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.asOfDate).toContain(AS_OF)
  })

  it('I-16 — 좌표를 바꾸는 UPDATE는 DB가 막고 fields가 붙는다', async () => {
    // 계약에는 좌표를 바꾸는 경로가 없다(UPSERT뿐이다). 트리거가 살아 있고
    // details 채널이 fields까지 이어지는지를 직접 확인한다.
    const { error } = await a.db
      .from('asset_prices')
      .update({ as_of_date: '2026-06-21' })
      .eq('asset_id', assetId)
      .eq('as_of_date', '2026-06-20')

    expect(error!.code).toBe('23514')
    expect(error!.details).toBe('constraint=asset_prices_coordinates_immutable')
  })
})

describe('§5.6 saveTaxProfile', () => {
  it('UPSERT이며 본인 것으로 저장된다', async () => {
    dataOf(
      await a.write.saveTaxProfile({
        year: 2026,
        otherIncomeBase: '50000000',
        otherFinancialIncome: '3000000',
        healthInsuranceType: 'EMPLOYEE',
      }),
    )
    const first = await a.read.getTaxSummary({ ownerId: ITG_USER_A, year: 2026 })
    expect(first.profile.isSaved).toBe(true)
    expect(first.profile.otherIncomeBase).toBe('50000000')

    // 같은 연도에 다시 저장하면 갱신이다 — I-06으로 23505가 나지 않는다
    dataOf(
      await a.write.saveTaxProfile({
        year: 2026,
        otherIncomeBase: '60000000',
        otherFinancialIncome: '3000000',
        healthInsuranceType: 'REGIONAL',
      }),
    )
    const second = await a.read.getTaxSummary({ ownerId: ITG_USER_A, year: 2026 })
    expect(second.profile.otherIncomeBase).toBe('60000000')
    expect(second.profile.healthInsuranceType).toBe('REGIONAL')

    // B의 프로필은 별개다 — user_id는 서버가 박는다
    dataOf(
      await b.write.saveTaxProfile({
        year: 2026,
        otherIncomeBase: '10000000',
        otherFinancialIncome: '0',
        healthInsuranceType: 'NONE',
      }),
    )
    expect((await a.read.getTaxSummary({ ownerId: ITG_USER_A, year: 2026 })).profile.otherIncomeBase).toBe('60000000')
  })

  it('시드보다 미래 연도도 저장된다 — tax_year에 FK가 없는 것이 의도다', async () => {
    dataOf(
      await a.write.saveTaxProfile({
        year: 2030,
        otherIncomeBase: '0',
        otherFinancialIncome: '0',
        healthInsuranceType: 'NONE',
      }),
    )
  })

  it('V-20 — 연도는 4자리다', async () => {
    const error = errorOf(
      await a.write.saveTaxProfile({
        year: 999,
        otherIncomeBase: '0',
        otherFinancialIncome: '0',
        healthInsuranceType: 'NONE',
      }),
    )
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.year).toBeDefined()
  })
})

describe('§5.10 createAsset', () => {
  it('UNIQUE(name, market) 위반 → CONFLICT', async () => {
    const error = errorOf(
      await a.write.createAsset({
        name: NAME.asset1,
        assetType: 'STOCK',
        market: 'NASDAQ',
        currency: 'USD',
      }),
    )
    expect(error.code).toBe('CONFLICT')
    expect(error.fields?.name).toBeDefined()
  })

  it('V-19 — currency는 정확히 3자 대문자다 (char(3)이 짧은 값을 공백으로 채운다)', async () => {
    for (const currency of ['US', 'USDD', 'usd']) {
      const error = errorOf(
        await a.write.createAsset({
          name: `${FX_NAME_PREFIX} 통화검사${currency}`,
          assetType: 'STOCK',
          currency,
        }),
      )
      expect(error.code, currency).toBe('VALIDATION_FAILED')
      expect(error.fields?.currency, currency).toBeDefined()
    }
  })

  it('market이 null이어도 중복으로 판정된다 (nulls not distinct)', async () => {
    const name = `${FX_NAME_PREFIX} 시장없음`
    dataOf(await a.write.createAsset({ name, assetType: 'INDEX', currency: 'KRW' }))

    const error = errorOf(
      await a.write.createAsset({ name, assetType: 'INDEX', currency: 'KRW' }),
    )
    expect(error.code).toBe('CONFLICT')
  })
})

// ---------------------------------------------------------------------------
// 왕복 수 — 계약별 실측
// ---------------------------------------------------------------------------

describe('계약별 왕복 수', () => {
  /**
   * **테이블 다중집합을 정본으로 둔다** — 총합만 세면 "상품 2회"와 "상품 1회 +
   * 시세 1회"가 구분되지 않는다(§4.0 예산 계수와 같은 규약). 사전 조회가 한 겹
   * 늘어난 것이 어느 계약인지도 여기서만 드러난다.
   */
  async function measure(run: () => Promise<unknown>): Promise<Record<string, number>> {
    const counter = countRequests()
    try {
      await run()
      return tallyPaths(counter.paths())
    } finally {
      counter.restore()
    }
  }

  it('§5.1 createProduct — rpc 1', async () => {
    let createdId = ''
    const paths = await measure(async () => {
      createdId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    })
    expect(paths).toEqual({ 'rpc:create_els_product': 1 })
    await a.write.deleteProduct(createdId)
  })

  it('§5.2 updateProduct — 사전 조회 1 + rpc 1', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const paths = await measure(() =>
      a.write.updateProduct(productId, productInput({ assetId })),
    )
    expect(paths).toEqual({ els_products: 1, 'rpc:update_els_product': 1 })
    await a.write.deleteProduct(productId)
  })

  it('§5.3 deleteProduct — 사전 조회 1 + 삭제 1', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const paths = await measure(() => a.write.deleteProduct(productId))
    expect(paths).toEqual({ els_products: 2 })
  })

  it('§5.4 createRedemption — 원천징수 입력 시 2, 미입력 시 3 (세율 조회가 붙는다)', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id

    const given = await measure(() =>
      a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '1',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: false,
      }),
    )
    expect(given).toEqual({ els_products: 1, redemptions: 1 })

    const view = await a.read.getProduct(productId)
    await a.write.deleteRedemption(view!.redemption!.id)

    const derived = await measure(() =>
      a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '1',
        taxableIncome: '0',
        isConfirmed: false,
      }),
    )
    expect(derived).toEqual({ els_products: 1, tax_years: 1, redemptions: 1 })

    const after = await a.read.getProduct(productId)
    await a.write.deleteRedemption(after!.redemption!.id)
    await a.write.deleteProduct(productId)
  })

  it('§5.5 updateRedemption — 상환 참조 1 + 상품 1 + 갱신 1 (+ 세율 1)', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const redemptionId = dataOf(
      await a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '1',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: false,
      }),
    ).id

    const given = await measure(() =>
      a.write.updateRedemption(redemptionId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '2',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: false,
      }),
    )
    expect(given).toEqual({ redemptions: 2, els_products: 1 })

    const derived = await measure(() =>
      a.write.updateRedemption(redemptionId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '3',
        taxableIncome: '0',
        isConfirmed: false,
      }),
    )
    expect(derived).toEqual({ redemptions: 2, els_products: 1, tax_years: 1 })

    await a.write.deleteRedemption(redemptionId)
    await a.write.deleteProduct(productId)
  })

  it('§5.5 deleteRedemption — 상환 참조 1 + 상품 1 + 삭제 1', async () => {
    const productId = dataOf(await a.write.createProduct(productInput({ assetId }))).id
    const redemptionId = dataOf(
      await a.write.createRedemption(productId, {
        redemptionType: 'MATURITY_GAIN',
        redemptionDate: '2026-07-02',
        grossAmount: '1',
        taxableIncome: '0',
        withholdingTax: '0',
        isConfirmed: false,
      }),
    ).id

    const paths = await measure(() => a.write.deleteRedemption(redemptionId))
    // 상환 id에서 출발하므로 부모를 얻는 왕복이 하나 더 있다 (§5.5)
    expect(paths).toEqual({ redemptions: 2, els_products: 1 })

    await a.write.deleteProduct(productId)
  })

  it('§5.6·§5.7·§5.10 — 사전 조회가 없으므로 1', async () => {
    expect(
      await measure(() =>
        a.write.saveTaxProfile({
          year: 2026,
          otherIncomeBase: '60000000',
          otherFinancialIncome: '3000000',
          healthInsuranceType: 'REGIONAL',
        }),
      ),
    ).toEqual({ tax_profiles: 1 })

    expect(
      await measure(() =>
        a.write.saveManualPrice({ assetId, asOfDate: '2026-06-19', price: '1' }),
      ),
    ).toEqual({ asset_prices: 1 })

    expect(
      await measure(() =>
        a.write.createAsset({
          name: `${FX_NAME_PREFIX} 왕복계수자산`,
          assetType: 'ETF',
          currency: 'USD',
        }),
      ),
    ).toEqual({ assets: 1 })
  })

  it('§5.8 refreshPrices — 공급자 0개이므로 왕복 0', async () => {
    expect(await measure(() => a.write.refreshPrices())).toEqual({})
  })

  it('§5.9 setKiTouched — 사전 조회 1 + 갱신 1', async () => {
    const paths = await measure(() => a.write.setKiTouched(FX.productA, null))
    expect(paths).toEqual({ els_products: 2 })
  })
})
