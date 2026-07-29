import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { UserSessionClient } from '@/lib/db/client'
import { POSTGREST_MAX_ROWS, TRUNCATION_PROBE_LIMIT } from '@/lib/db/select'

import { clientFor } from './helpers/auth'
import { FX, ITG_USER_A } from './helpers/fixtures'
import {
  closeSeedConnection,
  resetFixtures,
  seedAsset,
  seedPrice,
  seedProduct,
  seedSchedule,
  seedUnderlying,
} from './helpers/seed'

/**
 * PostgREST 읽기 경로 실측 — P2에서 이월된 스모크
 *
 * 이 파일은 **질의 코드보다 먼저** 작성·실행된다. ③(부모별 `limit`)의 결과에
 * 따라 설계가 갈리기 때문이다 — 2 왕복을 유지할 수 있는가, 아니면 뷰를 도입해야
 * 하는가. 뷰를 택하면 `security_invoker`·카탈로그 단언·권한 매트릭스·DOC-010 §7·
 * CLAUDE.md 절대 규칙 #6이 **한 묶음으로** 따라온다. 질의 코드를 먼저 쓰면 그
 * 비용을 짊어진 채 되돌리게 된다.
 */

const AS_OF = '2026-07-27'

let db: UserSessionClient

beforeAll(async () => {
  db = await clientFor(ITG_USER_A)
  await resetFixtures()

  // ③을 위한 최소 구조: 자산 3개 × 시세 여러 건 (부모마다 2건 이상)
  await seedAsset({ id: FX.assetPair1, name: '자산1' })
  await seedAsset({ id: FX.assetPair2, name: '자산2' })
  await seedAsset({ id: FX.assetNoPrice, name: '시세없는자산' })

  // 날짜를 섞어 넣는다 — 삽입 순서로 "최신"이 맞아떨어지면 정렬 결함이 숨는다
  await seedPrice({ assetId: FX.assetPair1, asOfDate: '2026-07-20', price: '100.000000' })
  await seedPrice({ assetId: FX.assetPair1, asOfDate: '2026-07-26', price: '110.000000' })
  await seedPrice({ assetId: FX.assetPair1, asOfDate: '2026-07-24', price: '105.000000' })
  // asOf 이후 일자 — D6(미래 시세 상한)의 대상
  await seedPrice({ assetId: FX.assetPair1, asOfDate: '2026-08-10', price: '999.000000' })

  await seedPrice({ assetId: FX.assetPair2, asOfDate: '2026-07-21', price: '200.000000' })
  await seedPrice({ assetId: FX.assetPair2, asOfDate: '2026-07-25', price: '220.000000' })

  // ④ 중첩 캐스팅용 — 상품 → 기초자산 → 자산
  await seedProduct({
    id: FX.productA,
    ownerId: ITG_USER_A,
    name: '스모크상품',
    principal: '123456789',
    kiBarrier: '0.5000',
    kiObservation: 'CLOSING',
  })
  await seedUnderlying({
    elsId: FX.productA,
    assetId: FX.assetPair1,
    basePrice: '412.550000',
    sequence: 1,
  })
  await seedUnderlying({
    elsId: FX.productA,
    assetId: FX.assetPair2,
    basePrice: '250.000000',
    sequence: 2,
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
})

afterAll(async () => {
  await closeSeedConnection()
})

describe('① PostgREST 읽기 경로', () => {
  it('사용자 세션(실제 JWT)으로 조회가 성립한다', async () => {
    const { data, error } = await db
      .from('els_products')
      .select('id, name')
      .eq('id', FX.productA)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].name).toContain('스모크상품')
  })

  it('service_role을 쓰지 않고도 참조 테이블을 읽는다', async () => {
    const { data, error } = await db.from('tax_brackets').select('tax_year')
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })
})

describe('② numeric 캐스팅 실측 — Q-08', () => {
  it('미캐스팅은 JS number로 온다 (float64 위험)', async () => {
    const { data, error } = await db
      .from('els_products')
      .select('principal, annual_coupon_rate, ki_barrier')
      .eq('id', FX.productA)
      .single()

    expect(error).toBeNull()
    expect(typeof data!.principal).toBe('number')
    expect(typeof data!.annual_coupon_rate).toBe('number')
    expect(typeof data!.ki_barrier).toBe('number')
  })

  it('::text 캐스팅은 문자열로 온다', async () => {
    const { data, error } = await db
      .from('els_products')
      .select('principal::text, annual_coupon_rate::text, ki_barrier::text')
      .eq('id', FX.productA)
      .single()

    expect(error).toBeNull()
    expect(typeof data!.principal).toBe('string')
    expect(typeof data!.annual_coupon_rate).toBe('string')
    // 저장 정밀도가 문자열에 그대로 드러난다 — numeric(6,4)
    expect(data!.principal).toBe('123456789')
    expect(data!.annual_coupon_rate).toBe('0.0800')
  })

  it('NULL은 캐스팅해도 null이다 — 추론 타입(string)이 사실과 다르다', async () => {
    // 노낙인 상품: ki_barrier IS NULL
    await seedProduct({
      id: FX.productB,
      ownerId: ITG_USER_A,
      name: '노낙인',
      kiBarrier: null,
      kiObservation: null,
    })

    const { data, error } = await db
      .from('els_products')
      .select('ki_barrier::text')
      .eq('id', FX.productB)
      .single()

    expect(error).toBeNull()
    // postgrest-js는 이 필드를 `string`으로 추론한다(널 허용 소실).
    // 런타임은 null을 준다 — select.ts가 생성 타입에서 널 허용을 복원하는 근거다.
    expect(data!.ki_barrier).toBeNull()
  })
})

describe('③ ★ 부모별 limit — 설계 분기점', () => {
  it('임베드 limit(1)은 부모마다 1행이다 (전체 1행이 아니다)', async () => {
    const { data, error } = await db
      .from('assets')
      .select('id, asset_prices(as_of_date, price::text)')
      .in('id', [FX.assetPair1, FX.assetPair2, FX.assetNoPrice])
      .order('as_of_date', { referencedTable: 'asset_prices', ascending: false })
      .limit(1, { referencedTable: 'asset_prices' })

    expect(error).toBeNull()

    // 부모는 3건 전부 온다 — 시세 없는 자산도 빈 배열로 온다
    expect(data).toHaveLength(3)

    const byId = new Map(data!.map((row) => [row.id, row.asset_prices]))

    // ★ 이 단언이 설계를 결정한다.
    //   부모별이면 각 1건, 전역이면 하나만 1건이고 나머지는 0건이다.
    expect(byId.get(FX.assetPair1)).toHaveLength(1)
    expect(byId.get(FX.assetPair2)).toHaveLength(1)
    expect(byId.get(FX.assetNoPrice)).toHaveLength(0)

    // 정렬도 부모별로 적용된다 — 삽입 순서가 아니라 날짜 내림차순
    expect(byId.get(FX.assetPair1)![0].as_of_date).toBe('2026-08-10')
    expect(byId.get(FX.assetPair2)![0].as_of_date).toBe('2026-07-25')
  })

  it('임베드 필터로 asOf 상한을 걸 수 있다 — D6', async () => {
    const { data, error } = await db
      .from('assets')
      .select('id, asset_prices(as_of_date, price::text)')
      .in('id', [FX.assetPair1, FX.assetPair2])
      .lte('asset_prices.as_of_date', AS_OF)
      .order('as_of_date', { referencedTable: 'asset_prices', ascending: false })
      .limit(1, { referencedTable: 'asset_prices' })

    expect(error).toBeNull()
    const byId = new Map(data!.map((row) => [row.id, row.asset_prices]))

    // 상한이 없으면 2026-08-10(미래 시세)이 "최신"이 된다 — 미래에서 온 판정이다
    expect(byId.get(FX.assetPair1)![0].as_of_date).toBe('2026-07-26')
    expect(byId.get(FX.assetPair1)![0].price).toBe('110.000000')
    expect(byId.get(FX.assetPair2)![0].as_of_date).toBe('2026-07-25')
  })
})

describe('④ 임베드 안쪽 캐스팅 — 중첩 깊이별', () => {
  it('깊이 1 (상품 → 기초자산)', async () => {
    const { data, error } = await db
      .from('els_products')
      .select('id, els_underlyings(base_price::text, sequence)')
      .eq('id', FX.productA)
      .single()

    expect(error).toBeNull()
    expect(data!.els_underlyings).toHaveLength(2)
    for (const u of data!.els_underlyings) {
      expect(typeof u.base_price).toBe('string')
      // sequence는 개수를 세는 정수이므로 캐스팅하지 않는다
      expect(typeof u.sequence).toBe('number')
    }
  })

  it('깊이 2 (상품 → 기초자산 → 자산 → 시세)', async () => {
    const { data, error } = await db
      .from('els_products')
      .select(
        'id, els_underlyings(base_price::text, assets(id, name, asset_prices(as_of_date, price::text)))',
      )
      .eq('id', FX.productA)
      .lte('els_underlyings.assets.asset_prices.as_of_date', AS_OF)
      .order('as_of_date', {
        referencedTable: 'els_underlyings.assets.asset_prices',
        ascending: false,
      })
      .limit(1, { referencedTable: 'els_underlyings.assets.asset_prices' })
      .single()

    expect(error).toBeNull()
    const underlyings = data!.els_underlyings
    expect(underlyings).toHaveLength(2)

    for (const u of underlyings) {
      expect(typeof u.base_price).toBe('string')
      const prices = u.assets!.asset_prices
      expect(prices).toHaveLength(1)
      expect(typeof prices[0].price).toBe('string')
    }
  })

  it('여러 차수를 임베드해도 부모당 전량이 온다 (limit을 걸지 않은 경우)', async () => {
    const { data, error } = await db
      .from('els_products')
      .select('id, redemption_schedules(round_no, barrier::text)')
      .eq('id', FX.productA)
      .single()

    expect(error).toBeNull()
    expect(data!.redemption_schedules).toHaveLength(2)
    expect(typeof data!.redemption_schedules[0].barrier).toBe('string')
  })
})

/**
 * ⑤ 절단 감지의 전제 — **요청 상한이 거부되지 않는다** (AQ-40 ③으로 제목을 좁혔다)
 *
 * 종전 제목은 「`max_rows`가 **임베드 배열에도** 적용되는가」였는데 질의는 임베드 없는
 * **평면 select**였고, 단언(`length <= 상한`)은 감지 조건의 **정확한 부정**이라 어떤
 * 구현에서도 통과했다(행수와 무관하게 서버 상한의 정의상 참이다). 이름을 본문에 맞춘다.
 *
 * **임베드 배열에 `max_rows`가 적용되는지는 여전히 측정되지 않았다** — 확인에는 부모
 * 하나에 1,000행을 넘는 자식이 필요하고 P4.5의 1,201행 픽스처는 측정 후 삭제했다
 * (잔여 0). DOC-011 §9 AQ-22의 잔여 ④로 등재했다. `assertNotTruncated`는 최상위
 * 행수만 보므로 그 축은 지금 어떤 가드도 덮지 않는다.
 *
 * **상수와 `[api].max_rows`의 관계는 여기서 보지 않는다.** DB 없이 도는
 * `tests/db/select.test.ts`가 `config.toml`을 파싱해 부등호 사슬을 단언한다 — Docker를
 * 요구하는 스위트에 두면 CI에서 조용히 건너뛰는 자리가 생긴다.
 */
describe('⑤ 요청 상한이 거부되지 않는다 — 절단 감지의 전제', () => {
  it('limit = TRUNCATION_PROBE_LIMIT 요청이 오류가 아니다', async () => {
    // 로더 7개가 실제로 보내는 값 그대로다. 이 값은 서버 상한과 같으므로 서버가
    // 깎을 것이 없다.
    const { data, error } = await db
      .from('asset_prices')
      .select('id')
      .limit(TRUNCATION_PROBE_LIMIT)

    expect(error).toBeNull()
    // 여기서 확인하는 것은 행수가 아니라 **요청이 400이 되지 않는다는 사실**이다.
    // `length <= 상한`은 서버 상한의 정의상 항상 참이므로 단언하지 않는다.
    expect(data).not.toBeNull()
  })

  it('요청 상한이 서버 상한을 넘지 않는다 — 넘겨 봐야 깎인다', () => {
    // 실측(P4.5): 1,201행에 limit=1001·1200 → 둘 다 1000행, 200, 0-999/*.
    // 그래서 「하나 더 요청한다」는 상한 **안쪽**에서 해야 한다(DOC-011 §4.0 Q-06).
    expect(TRUNCATION_PROBE_LIMIT).toBe(POSTGREST_MAX_ROWS)
  })
})
