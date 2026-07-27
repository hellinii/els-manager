import { createQueries, type Queries } from '@/lib/db/queries/context'

import { clientFor } from './auth'
import { FX, ITG_USER_A, ITG_USER_B } from './fixtures'
import {
  resetFixtures,
  seedAsset,
  seedPrice,
  seedProduct,
  seedRedemption,
  seedSchedule,
  seedUnderlying,
} from './seed'

/**
 * 공통 시나리오 — 계약 8개가 같은 데이터를 본다.
 *
 * 계약마다 다른 픽스처를 세우면 "이 계약에서만 통과하는 데이터"가 생기고,
 * 계약 간 불일치(같은 상품을 목록과 상세가 다르게 판정하는 종류)가 드러나지 않는다.
 *
 * 기준일은 **고정**한다. `today()`를 쓰면 하루가 지나면 D-Day와 경과 여부가
 * 바뀌어 테스트가 스스로 부서진다 — `today()` 자체는 `tests/db/today.test.ts`가
 * 경계로 검증하므로 여기서 다시 볼 필요가 없다.
 */
export const AS_OF = '2026-06-30'
export const YEAR = 2026

export type Scenario = {
  asA: Queries
  asB: Queries
}

/**
 * 시나리오 구성 — 각 상품이 **하나의 판정 상태**를 대표한다.
 *
 * | 상품 | 상태 |
 * |---|---|
 * | productA (A 소유) | 미상환, 시세 있음, KI 안전. 1차 배리어 충족(EARLY) |
 * | productB (B 소유) | 미상환, 시세 있음, KI 배리어 하회(BELOW) |
 * | productRedeemed (A) | 상환 완료 — 판정 생략, 실현손익 존재 |
 * | productNoUnderlying (A) | 기초자산 0건 — UNDERLYING_MISSING |
 * | productNoSchedule (A) | 일정 0건 — SCHEDULE_MISSING |
 */
export async function setupScenario(): Promise<Scenario> {
  await resetFixtures()

  // 자산 — 이름 대역을 예약해 assets_name_market_key 충돌을 피한다
  await seedAsset({ id: FX.assetSolo, name: '단독자산' })
  await seedAsset({ id: FX.assetPair1, name: '쌍자산1' })
  await seedAsset({ id: FX.assetPair2, name: '쌍자산2' })
  await seedAsset({ id: FX.assetNoPrice, name: '시세없음' })
  await seedAsset({ id: FX.assetStale, name: '경과자산' })

  // 시세 — 최신은 asOf 이전, 그리고 asOf 이후 일자도 하나 넣는다(D6 대상)
  await seedPrice({ assetId: FX.assetSolo, asOfDate: '2026-06-29', price: '95.000000' })
  await seedPrice({ assetId: FX.assetSolo, asOfDate: '2026-06-20', price: '80.000000' })
  await seedPrice({ assetId: FX.assetSolo, asOfDate: '2026-12-01', price: '500.000000' })

  await seedPrice({ assetId: FX.assetPair1, asOfDate: '2026-06-29', price: '90.000000' })
  await seedPrice({ assetId: FX.assetPair2, asOfDate: '2026-06-29', price: '45.000000' })

  // assetNoPrice — 시세 행을 만들지 않는다 (E-01)
  // assetStale — 5일 이상 경과 (isStale)
  await seedPrice({ assetId: FX.assetStale, asOfDate: '2026-06-20', price: '70.000000' })

  // productA — 정상 경로
  await seedProduct({
    id: FX.productA,
    ownerId: ITG_USER_A,
    name: 'A정상',
    principal: '100000000',
    kiBarrier: '0.5000',
    kiObservation: 'CLOSING',
  })
  await seedUnderlying({
    elsId: FX.productA,
    assetId: FX.assetSolo,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productA,
    roundNo: 1,
    evaluationDate: '2026-07-02',
    barrier: '0.9000',
  })
  await seedSchedule({
    elsId: FX.productA,
    roundNo: 2,
    evaluationDate: '2027-01-04',
    barrier: '0.8500',
    lizardBarrier: '0.8000',
    lizardCouponRate: '0.0200',
    lizardRequiresNoKi: true,
  })

  // productB — B 소유, KI 하회
  await seedProduct({
    id: FX.productB,
    ownerId: ITG_USER_B,
    name: 'B하회',
    principal: '50000000',
    kiBarrier: '0.5000',
    kiObservation: 'CLOSING',
  })
  await seedUnderlying({
    elsId: FX.productB,
    assetId: FX.assetPair2,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productB,
    roundNo: 1,
    evaluationDate: '2026-08-03',
    barrier: '0.9000',
  })

  // productRedeemed — 상환 완료
  await seedProduct({
    id: FX.productRedeemed,
    ownerId: ITG_USER_A,
    name: 'A상환완료',
    principal: '100000000',
  })
  await seedUnderlying({
    elsId: FX.productRedeemed,
    assetId: FX.assetPair1,
    basePrice: '100.000000',
    sequence: 1,
  })
  await seedSchedule({
    elsId: FX.productRedeemed,
    roundNo: 1,
    evaluationDate: '2026-05-04',
    barrier: '0.9000',
  })
  await seedRedemption({
    elsId: FX.productRedeemed,
    roundNo: 1,
    redemptionType: 'EARLY',
    redemptionDate: '2026-05-04',
    grossAmount: '104000000',
    taxableIncome: '4000000',
    withholdingTax: '616000',
  })

  // productNoUnderlying — I-07 위반 상태. 계약 경유로는 만들 수 없고 DB에서는
  // 도달 가능하다(DOC-010 AQ-14). 그래서 픽스처를 pg로 직접 만든다.
  await seedProduct({
    id: FX.productNoUnderlying,
    ownerId: ITG_USER_A,
    name: 'A기초자산없음',
    principal: '30000000',
  })
  await seedSchedule({
    elsId: FX.productNoUnderlying,
    roundNo: 1,
    evaluationDate: '2026-09-01',
    barrier: '0.9000',
  })

  // productNoSchedule — 일정 0건
  await seedProduct({
    id: FX.productNoSchedule,
    ownerId: ITG_USER_A,
    name: 'A일정없음',
    principal: '20000000',
  })
  await seedUnderlying({
    elsId: FX.productNoSchedule,
    assetId: FX.assetNoPrice,
    basePrice: '100.000000',
    sequence: 1,
  })

  const [dbA, dbB] = await Promise.all([
    clientFor(ITG_USER_A),
    clientFor(ITG_USER_B),
  ])

  return {
    asA: createQueries({ db: dbA, asOf: AS_OF, viewerId: ITG_USER_A }),
    asB: createQueries({ db: dbB, asOf: AS_OF, viewerId: ITG_USER_B }),
  }
}

/**
 * REST 요청 수를 센다 — 왕복 예산 검증용.
 *
 * `fetch`를 감싸 `/rest/v1/` 요청만 센다. GoTrue 왕복(`/auth/v1/`)은 요청당
 * 1회이고 `cache()`로 중복 제거되므로 따로 센다.
 */
export function countRequests(): {
  rest: () => number
  auth: () => number
  reset: () => void
  restore: () => void
} {
  const original = globalThis.fetch
  let rest = 0
  let auth = 0

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/rest/v1/')) rest += 1
    if (url.includes('/auth/v1/')) auth += 1
    return original(input, init)
  }) as typeof fetch

  return {
    rest: () => rest,
    auth: () => auth,
    reset: () => {
      rest = 0
      auth = 0
    },
    restore: () => {
      globalThis.fetch = original
    },
  }
}
