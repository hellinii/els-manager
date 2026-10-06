import { describe, expect, it } from 'vitest'

import {
  EXCHANGE_RATE_PROVIDERS,
  KNOWN_PROVIDER_IDS,
  PRICE_PROVIDERS,
  PROVIDER_CREDENTIALS,
} from '@/lib/providers/types'

/**
 * 환율 자동 수집 레지스트리 — DOC-010 ADR-010 · DOC-011 §4.11 (P8 컷 a3)
 *
 * 시세의 명부 셋(`PRICE_PROVIDERS`·`KNOWN_PROVIDER_IDS`·`PROVIDER_CREDENTIALS`)과 **섞이지 않는다**가
 * 이 파일의 명제다. 환율 공급자 id가 `KNOWN_PROVIDER_IDS`에 들어가면 V-21(§5.12 자산 매핑의 `provider`)이
 * 그 id를 시세 공급자로 받아들이고, `PRICE_PROVIDERS`에 들어가면 `refreshPrices`·배치가 그것으로 시세를 걷는다.
 */
describe('EXCHANGE_RATE_PROVIDERS — 시세 명부와 다른 목록', () => {
  it('P8 컷 c2(2026-10-06)부터 ECOS(주)·KOREAEXIM(폴백) 둘이다 — `autoCollected`가 true가 된다', () => {
    /*
     * ADR-010 게이트가 분기 A로 조기 확정됐고(민서, 2026-10-06) c1·c2가 어댑터를 세우고
     * 배선했다. 순서가 폴백 순서다 — [0]이 주 원천. 이 단언이 빨간불이면 「화면의
     * 「자동 수집 안 함」이 거짓이 되었다」가 아니라 **배선 자체가 바뀌었다**는 신호다.
     */
    expect(EXCHANGE_RATE_PROVIDERS.map((p) => p.id)).toEqual(['ECOS', 'KOREAEXIM'])
  })

  it('시세 명부 셋 어디에도 환율 공급자 id가 없다 — V-21 오염을 막는다', () => {
    const priceIds = new Set([
      ...PRICE_PROVIDERS.map((f) => f.id),
      ...KNOWN_PROVIDER_IDS,
      ...Object.keys(PROVIDER_CREDENTIALS),
    ])
    for (const provider of EXCHANGE_RATE_PROVIDERS) {
      expect(priceIds.has(provider.id), provider.id).toBe(false)
    }
  })
})
