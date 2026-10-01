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
  it('컷 a3에서는 비어 있다 — 수동 입력이 정상 경로이고 `autoCollected`는 false다', () => {
    /*
     * 수집기는 ADR-010 게이트의 분기 A/A′에서 컷 c1·c2가 세운다. 그 컷이 이 단언을 고친다 — 이 줄이
     * 빨간불이 되는 것이 「화면의 「자동 수집 안 함」이 거짓이 되었다」의 신호다(문구는 레지스트리에서 파생된다).
     */
    expect(EXCHANGE_RATE_PROVIDERS).toEqual([])
  })

  it('시세 명부 셋 어디에도 환율 공급자 id가 없다 — V-21 오염을 막는다', () => {
    /*
     * ★ **지금은 0회 순회다 — 이 케이스는 아직 아무것도 판별하지 않는다.** 위 케이스가 「비어 있다」를
     * 단언하므로 그 공허함이 숨지 않는다: c1이 첫 항목을 넣으면 위가 빨간불이 되어 고치게 되고, 그 순간
     * 이 순회가 처음으로 값을 본다. 「초록이니 섞이지 않았다」로 읽지 않는다.
     */
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
