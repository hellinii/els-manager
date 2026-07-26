/**
 * 상품 시나리오 픽스처 — DOC-007 §10.5~§10.7
 *
 * 순수 모듈은 DB 레코드를 받지 않으므로(ADR-003) 여기서도 원시값만 구성한다.
 */

/**
 * TC-17·TC-18의 집계 키 — DOC-007 §7.1
 *
 * §10.5가 "동일 소유자·연도"를 전제하므로 두 케이스 모두 같은 키에 속한다.
 * 운영에서 `ownerId`는 UUID지만 픽스처는 읽기 쉬운 값을 쓴다.
 */
export const TC_OWNER = 'owner-tc'
export const TC_YEAR = 2026

/** TC-17 — 손실 통산 금지. A상품 −1,000만, B상품 +2,000만 (동일 소유자·연도) */
export const TC17_REDEMPTIONS = [
  {
    label: 'A상품 (만기·손실)',
    ownerId: TC_OWNER,
    year: TC_YEAR,
    redemptionType: 'MATURITY_LOSS' as const,
    accountType: 'GENERAL' as const,
    principal: '100000000',
    grossAmount: '90000000',
    /** 손실 상환의 과세 금융소득은 0이다 (I-08, §4.4) */
    taxableIncome: '0',
  },
  {
    label: 'B상품 (만기·이익)',
    ownerId: TC_OWNER,
    year: TC_YEAR,
    redemptionType: 'MATURITY_GAIN' as const,
    accountType: 'GENERAL' as const,
    principal: '100000000',
    grossAmount: '120000000',
    taxableIncome: '20000000',
  },
]

/** TC-18 — 비과세 계좌 상품, 이익 3,000만 */
export const TC18_REDEMPTION = {
  ownerId: TC_OWNER,
  year: TC_YEAR,
  redemptionType: 'MATURITY_GAIN' as const,
  accountType: 'TAX_FREE' as const,
  principal: '100000000',
  grossAmount: '130000000',
  /** 증권사 확정값이 있더라도 비과세 계좌는 종합과세 대상에서 제외된다 (§4.3) */
  taxableIncome: '30000000',
}

/** TC-22 — 기초자산 3종 중 1종 시세 없음 */
export const TC22_UNDERLYINGS = [
  { basePrice: '100', currentPrice: '95' },
  { basePrice: '200', currentPrice: null },
  { basePrice: '50', currentPrice: '48' },
]
