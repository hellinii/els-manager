import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
    expect(error.fields?.touchedAt).toBeDefined()

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
