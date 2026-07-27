import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeSeedConnection, resetFixtures, seedTaxProfile } from './helpers/seed'
import { clientFor } from './helpers/auth'
import { FX, ITG_USER_A, ITG_USER_B } from './helpers/fixtures'
import { AS_OF, YEAR, setupScenario, type Scenario } from './helpers/scenario'
import type { UserSessionClient } from '@/lib/db/client'

/**
 * 정책이 **사용자 세션으로** 실제 작동하는가
 *
 * `tests/rls/`는 `set local role authenticated` + `set local request.jwt.claims`로
 * 사용자를 가장한다. 그것으로 정책 술어는 검증되지만 **GoTrue와 PostgREST를 한
 * 번도 지나지 않는다.** 여기서는 진짜 JWT로 같은 분리를 다시 확인한다 —
 * `auth.uid()`가 실제 토큰의 `sub`에서 나오는지, PostgREST가 그 클레임을 세션에
 * 제대로 싣는지는 이 경로만 증명할 수 있다.
 */

let s: Scenario
let dbA: UserSessionClient
let dbB: UserSessionClient

beforeAll(async () => {
  s = await setupScenario()
  dbA = await clientFor(ITG_USER_A)
  dbB = await clientFor(ITG_USER_B)

  // A의 과세 프로필. B는 이 행을 볼 수 없어야 한다.
  await seedTaxProfile({
    userId: ITG_USER_A,
    taxYear: YEAR,
    otherIncomeBase: '50000000',
    otherFinancialIncome: '3000000',
    healthInsuranceType: 'EMPLOYEE',
  })
})

afterAll(async () => {
  await resetFixtures()
  await closeSeedConnection()
})

describe('상품은 전체 조회 (S-10)', () => {
  it('B가 A의 상품을 본다', async () => {
    const { data, error } = await dbB
      .from('els_products')
      .select('id, owner_id')
      .eq('id', FX.productA)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].owner_id).toBe(ITG_USER_A)
  })

  it('B가 A의 하위 행도 본다 — 판정에 필요하다', async () => {
    const { data, error } = await dbB
      .from('els_underlyings')
      .select('els_id')
      .eq('els_id', FX.productA)

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })
})

describe('tax_profiles는 본인만 (DOC-010 §7)', () => {
  it('A는 자기 프로필을 본다', async () => {
    const { data, error } = await dbA
      .from('tax_profiles')
      .select('user_id, other_financial_income::text')
      .eq('user_id', ITG_USER_A)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].other_financial_income).toBe('3000000')
  })

  it('B는 A의 프로필에서 0행을 받는다 — 오류가 아니다', async () => {
    const { data, error } = await dbB
      .from('tax_profiles')
      .select('user_id')
      .eq('user_id', ITG_USER_A)

    // ★ 여기가 D3의 출발점이다. 거부가 아니라 **빈 결과**로 나타나므로,
    //   계약이 이 0행을 "없음"으로 해석하면 타인의 금융소득이 0이 되고
    //   종합과세 판정이 조용히 틀린다.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('필터 없이 조회해도 B에게는 A의 행이 보이지 않는다', async () => {
    const { data, error } = await dbB.from('tax_profiles').select('user_id')

    expect(error).toBeNull()
    expect(data!.some((row) => row.user_id === ITG_USER_A)).toBe(false)
  })
})

describe('anon 키만으로는 아무것도 읽지 못한다', () => {
  it('세션 없이 상품 조회가 거부된다', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const { resolveAnonKey, resolveApiUrl } = await import('./helpers/env')

    const anon = createClient(resolveApiUrl(), resolveAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await anon.from('els_products').select('id')

    // anon 롤에는 어떤 테이블 권한도 없다 — 42501이 나야 한다.
    // 0행이 오면 GRANT가 열려 있고 정책만 막는 상태이므로 방어가 한 겹뿐이다.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})

describe('조회 계약이 세션을 실제로 쓴다', () => {
  it('같은 계약이 조회자에 따라 다른 isOwner를 낸다', async () => {
    const fromA = await s.asA.listProducts({ ownerId: ITG_USER_A })
    const fromB = await s.asB.listProducts({ ownerId: ITG_USER_A })

    expect(fromA.length).toBe(fromB.length)
    expect(fromA.every((i) => i.isOwner)).toBe(true)
    expect(fromB.every((i) => !i.isOwner)).toBe(true)
  })

  it('A의 프로필이 A의 세금 요약에만 반영된다', async () => {
    const view = await s.asA.getTaxSummary({ ownerId: ITG_USER_A, year: YEAR })

    expect(view.profile.isSaved).toBe(true)
    expect(view.profile.otherFinancialIncome).toBe('3000000')
    expect(view.profile.healthInsuranceType).toBe('EMPLOYEE')
    // 9,200,000(ELS) + 3,000,000(기타) = 12,200,000
    expect(view.income.total).toBe('12200000')
  })

  it('B의 세금 요약에는 A의 기타 금융소득이 섞이지 않는다', async () => {
    const view = await s.asB.getTaxSummary({ ownerId: ITG_USER_B, year: YEAR })

    // 절대 규칙 #7 — 사용자 간 금융소득을 합산하지 않는다
    expect(view.profile.otherFinancialIncome).toBe('0')
    expect(view.profile.isSaved).toBe(false)
  })
})

describe('기준일이 컨텍스트에서 온다', () => {
  it('asOf를 바꾸면 판정이 바뀐다 — 계약이 기준일을 실제로 쓴다', async () => {
    const { createQueries } = await import('@/lib/db/queries/context')

    const atJune = createQueries({ db: dbA, asOf: AS_OF, viewerId: ITG_USER_A })
    const atDecember = createQueries({
      db: dbA,
      asOf: '2026-12-15',
      viewerId: ITG_USER_A,
    })

    const june = (await atJune.listProducts({ ownerId: ITG_USER_A })).find((i) =>
      i.name.includes('A정상'),
    )!
    const december = (await atDecember.listProducts({ ownerId: ITG_USER_A })).find(
      (i) => i.name.includes('A정상'),
    )!

    // 6월 기준: 1차(2026-07-02)가 다음 평가일
    expect(june.nextEvaluation?.roundNo).toBe(1)
    // 12월 기준: 1차는 경과했고 2차(2027-01-04)가 다음이다
    expect(december.nextEvaluation?.roundNo).toBe(2)

    // asOf 상한도 함께 움직인다 — 12월에는 2026-12-01 시세(500)가 최신이 된다
    expect(june.worstOf).toBe('0.9500')
    expect(december.worstOf).toBe('5.0000')
  })
})
