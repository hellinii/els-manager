import type { UserSessionClient } from '@/lib/db/client'
import { createMutations, type Mutations } from '@/lib/db/mutations/context'
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
 * 공통 시나리오 — 계약 9개가 같은 데이터를 본다.
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
 * 조회·변경 계약을 **같은 세션·같은 기준일**로 묶어서 준다 — DOC-011 §5.0 W-02.
 *
 * 두 계약면이 컨텍스트를 공유한다는 것 자체가 규약이며, 여기서 갈라 놓으면
 * V-17(미래 시세 거부)이 쓰는 기준일과 조회의 `asOf`가 어긋난 상태를 테스트가
 * 정상으로 취급하게 된다. `db`도 함께 주는 이유는 **계약을 우회하는 경로**
 * (쓰기 함수 직접 호출 = AQ-29)를 같은 권한으로 재현해야 하기 때문이다.
 */
export type Contracts = {
  db: UserSessionClient
  read: Queries
  write: Mutations
}

export async function contractsFor(
  userId: typeof ITG_USER_A | typeof ITG_USER_B,
): Promise<Contracts> {
  const db = await clientFor(userId)
  return {
    db,
    read: createQueries({ db, asOf: AS_OF, viewerId: userId }),
    write: createMutations({ db, asOf: AS_OF, viewerId: userId }),
  }
}

const REST_MARKER = '/rest/v1/'

/**
 * PostgREST 경로에서 테이블명을 꺼낸다 — `/rest/v1/els_products?select=…` → `els_products`.
 *
 * RPC는 접두어로 구분한다. 도입되면 왕복 예산의 성격이 달라지므로(노출면과
 * `search_path` 관리가 새로 생긴다, DOC-011 §4.8) 테이블과 섞이면 안 된다.
 */
function restTableOf(url: string): string | null {
  const at = url.indexOf(REST_MARKER)
  if (at < 0) return null

  const path = url.slice(at + REST_MARKER.length).split('?')[0].split('#')[0]
  if (path === '') return '(root)'

  const [head, ...rest] = path.split('/')
  return head === 'rpc' ? `rpc:${rest.join('/')}` : head
}

/** 계수기가 활성인 동안 다시 만들면 원본 `fetch`를 잃는다 — §countRequests의 주석 참조 */
let counterActive = false

/**
 * REST 요청 수와 **테이블별 경로**를 센다 — 왕복 예산·N+1 검증용.
 *
 * `fetch`를 감싸 `/rest/v1/` 요청만 센다. GoTrue 왕복(`/auth/v1/`)은 요청당
 * 1회이고 `cache()`로 중복 제거되므로 따로 센다.
 *
 * ## 수만 세면 N+1이 드러나지 않는다
 *
 * 총합은 "상품 2회"와 "상품 1회 + 시세 1회"를 구분하지 못한다. 사용자별·자산별
 * N+1은 픽스처가 작을 때 **총합이 우연히 예산과 같아** 지나가고, 그때 틀리는 것은
 * 값이 아니라 질의 수이므로 어떤 값 단언에도 걸리지 않는다. 그래서 **테이블
 * 다중집합을 정본으로 둔다** — `listUserSummaries`의 `tax_profiles`가 1인지
 * 사용자 수만큼인지는 그 항목만이 말한다(DOC-011 §4.8 D3의 전제).
 *
 * ## 중첩 금지
 *
 * `countRequests()`는 **호출 시점의** `globalThis.fetch`를 원본으로 잡는다. 두
 * 계수기가 동시에 살아 있다가 LIFO가 아닌 순서로 복원하면 원본이 **영구히
 * 사라지고** 이후 모든 파일이 조용히 계수된 fetch로 돈다 — 실패가 이 파일이
 * 아니라 *다음* 파일에서 엉뚱한 숫자로 나타난다. 그래서 중첩을 막고, 복원할 때
 * 자기가 건 패치가 맞는지 확인한다.
 */
export function countRequests(): {
  rest: () => number
  auth: () => number
  paths: () => string[]
  reset: () => void
  restore: () => void
} {
  if (counterActive) {
    throw new Error(
      'countRequests()가 이미 활성이다. 중첩하면 원본 fetch를 잃고 이후 파일이 조용히 계수된 fetch로 돈다.',
    )
  }
  counterActive = true

  const original = globalThis.fetch
  let rest = 0
  let auth = 0
  let paths: string[] = []

  const patched = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const table = restTableOf(url)
    if (table != null) {
      rest += 1
      paths.push(table)
    }
    if (url.includes('/auth/v1/')) auth += 1
    return original(input, init)
  }) as typeof fetch

  globalThis.fetch = patched

  return {
    rest: () => rest,
    auth: () => auth,
    // 복사본을 준다 — restore() 뒤에도 읽히고, 호출부가 내부 배열을 흔들 수 없다
    paths: () => [...paths],
    reset: () => {
      rest = 0
      auth = 0
      paths = []
    },
    restore: () => {
      counterActive = false
      // 우리가 건 패치가 아니면 남의 패치를 지우는 것이다 — 조용히 넘기지 않는다
      if (globalThis.fetch !== patched) {
        throw new Error(
          'countRequests() 복원 실패 — 그 사이 누군가 fetch를 바꿨다(중첩 또는 누수).',
        )
      }
      globalThis.fetch = original
    },
  }
}

/** 경로 배열 → 테이블별 요청 수. 순서가 아니라 다중집합으로 비교하기 위함이다. */
export function tallyPaths(paths: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const path of paths) out[path] = (out[path] ?? 0) + 1
  return out
}
