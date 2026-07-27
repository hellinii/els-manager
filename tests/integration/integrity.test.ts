import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { worstOf } from '@/lib/domain'

import { FX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { closeSeedConnection, resetFixtures } from './helpers/seed'
import { setupScenario, type Scenario } from './helpers/scenario'

/**
 * 무결성 결함이 목록 전체를 죽이지 않는다 — D1, AQ-17의 조회 부분
 *
 * §3.1의 "예외 전파"를 문자대로 두면 `worstOf([])`의 `RangeError`가 그대로
 * 올라온다. 그리고 **모든 SELECT가 `using (true)`이므로 남의 결함 상품 1건이
 * SCR-101·201·301을 전원에게 죽인다.** `getProduct`까지 죽으면 SCR-204(수정)도
 * 같은 계약을 쓰므로 **유일한 복구 경로가 함께 막혀** UI로는 고칠 수 없다.
 *
 * 이 스위트가 확인하는 것은 그 상태가 실제 DB·실제 HTTP 경로에서 재현되고,
 * 계약이 그것을 행 단위로 격리한다는 사실이다.
 */

let s: Scenario

beforeAll(async () => {
  s = await setupScenario()
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('순수 모듈은 여전히 거부한다', () => {
  it('worstOf([])는 던진다 — 안전망을 약화시키지 않았다', () => {
    // 조회 계층이 이 호출을 하지 않는 것이지, 거부를 없앤 것이 아니다.
    // DB를 경유하는 다른 경로(AQ-14)의 최종 안전망으로 남는다.
    expect(() => worstOf([])).toThrow(/기초자산이 없다/)
  })
})

describe('listProducts — 결함 상품이 목록을 죽이지 않는다', () => {
  it('던지지 않고 전체 목록을 반환한다', async () => {
    const items = await s.asA.listProducts()

    expect(items.length).toBeGreaterThan(3)
    // 정상 상품이 함께 나온다 — 결함 1건이 목록을 비우지 않는다
    expect(items.some((i) => i.name.includes('A정상'))).toBe(true)
  })

  it('결함 행만 integrityIssue로 표시된다', async () => {
    const items = await s.asA.listProducts()
    const byName = new Map(
      items.map((i) => [i.name.replace('[ITG] ', ''), i]),
    )

    expect(byName.get('A기초자산없음')!.integrityIssue).toBe('UNDERLYING_MISSING')
    expect(byName.get('A일정없음')!.integrityIssue).toBe('SCHEDULE_MISSING')
    // 나머지는 null
    expect(byName.get('A정상')!.integrityIssue).toBeNull()
    expect(byName.get('A상환완료')!.integrityIssue).toBeNull()
  })

  it('결함 행은 "시세 없음"과 구분된다 — 우선순위', async () => {
    const items = await s.asA.listProducts()
    const broken = items.find((i) => i.name.includes('A기초자산없음'))!

    // status·worstOf만 보면 E-01과 동일하다. integrityIssue가 유일한 구분자다.
    expect(broken.status).toBe('ACTIVE')
    expect(broken.worstOf).toBeNull()
    expect(broken.integrityIssue).not.toBeNull()
    expect(broken.conditionResult).toBeNull()
    expect(broken.kiStatus).toBeNull()
  })

  it('타인(B)의 목록에서도 A의 결함 상품이 죽이지 않는다', async () => {
    // ★ 여기가 핵심이다. 조회 정책이 using (true)이므로 B는 A의 결함 상품을
    //   보게 되고, 예외 전파를 두었다면 **B의 화면이 A의 데이터 때문에** 죽는다.
    const items = await s.asB.listProducts()

    expect(items.some((i) => i.name.includes('A기초자산없음'))).toBe(true)
    expect(items.some((i) => i.name.includes('B하회'))).toBe(true)
  })
})

describe('getProduct — 복구 경로가 열려 있다', () => {
  it('결함 상품의 상세가 반환된다', async () => {
    const view = await s.asA.getProduct(FX.productNoUnderlying)

    // null도 예외도 아니다 — SCR-202가 렌더링되고 SCR-204로 갈 수 있다
    expect(view).not.toBeNull()
    expect(view!.product.integrityIssue).toBe('UNDERLYING_MISSING')
    expect(view!.underlyings).toEqual([])
    // ★ v0.8 — projection은 시세를 쓰지 않으므로 기초자산 0건과 무관하다.
    // 종전에는 null이었고, 그 탓에 §4.6이 같은 상품의 과세 기여를 내는 것과
    // 어긋나 있었다(§4.2 입력 기준). 원금 3천만 × (1 + 0.08 × 6/12) = 31,200,000
    expect(view!.projection).not.toBeNull()
    expect(view!.projection!.appliedRoundNo).toBe(1)
    expect(view!.projection!.expectedGross).toBe('31200000')
    expect(view!.projection!.expectedTaxableIncome).toBe('1200000')
    expect(view!.projection!.attributionYear).toBe(2026)
  })

  it('일정 0건 상품도 상세가 열린다', async () => {
    const view = await s.asA.getProduct(FX.productNoSchedule)

    expect(view).not.toBeNull()
    expect(view!.product.integrityIssue).toBe('SCHEDULE_MISSING')
    expect(view!.product.totalRounds).toBe(0)
    expect(view!.schedules).toEqual([])
    expect(view!.projection).toBeNull()
    // 기초자산은 있으므로 표시된다 — 수정 화면이 현재 상태를 보여줄 수 있다
    expect(view!.underlyings).toHaveLength(1)
  })

  it('소유자에게 수정 권한이 보인다 — SCR-204 유도의 전제', async () => {
    const view = await s.asA.getProduct(FX.productNoUnderlying)
    expect(view!.product.isOwner).toBe(true)
  })
})

describe('listSchedule·getDashboard도 살아 있다', () => {
  it('listSchedule이 결함 상품의 차수를 UNDERLYING_MISSING으로 표시한다', async () => {
    const items = await s.asA.listSchedule()
    const broken = items.filter((i) => i.productName.includes('A기초자산없음'))

    expect(broken.length).toBeGreaterThan(0)
    expect(broken.every((i) => i.integrityIssue === 'UNDERLYING_MISSING')).toBe(true)
    expect(broken.every((i) => i.worstOf === null)).toBe(true)
  })

  it('getDashboard가 두 결함을 조치 목록에 올린다', async () => {
    const view = await s.asA.getDashboard({ scope: 'ALL' })
    const reasons = view.attentionItems.map((i) => i.reason)

    expect(reasons).toContain('UNDERLYING_MISSING')
    expect(reasons).toContain('SCHEDULE_MISSING')
  })

  it('listAssetPrices도 결함 상품 때문에 죽지 않는다', async () => {
    const rows = await s.asA.listAssetPrices()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('getTaxSummary도 죽지 않는다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: 2026 })
    expect(view.income.total).not.toBe('')
  })

  it('listUserSummaries도 죽지 않는다', async () => {
    const rows = await s.asA.listUserSummaries()
    expect(rows.some((r) => r.userId === ITG_USER_A)).toBe(true)
    expect(rows.some((r) => r.userId === ITG_USER_B)).toBe(true)
  })
})
