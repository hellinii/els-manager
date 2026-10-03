import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { TaxSummaryView } from '@/lib/db/queries/tax'
import {
  MONTHLY_COUPON_ESTIMATE_NOTE,
  PARTIAL_RATE_MISSING_NOTE,
  contributionBreakdownLine,
} from '@/lib/format/coupons'

/**
 * 세금 · 전망의 월수익 문구 (P8 컷 b4 — DOC-008 SQ-21 ⓚ · ⓛ · SCR-401)
 *
 * 문장 상수는 문서의 문구와 **같은 문자열**이어야 한다 — 한 가정을 SCR-502 · SCR-401 · SCR-101 ③이 같은 상수로 말하는데
 * 그 상수가 문서와 갈리면 정본이 둘이 된다. 표 밖 표식 문구는 `forecast.test.ts`가 같은 방식으로 묶는다.
 */
const DOC_008 = readFileSync(join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md'), 'utf8')

describe('문장 상수 ↔ DOC-008', () => {
  it('월지급 면책 문장(SQ-21 ⓛ)이 문서의 문구 그대로다', () => {
    expect(DOC_008).toContain(`「${MONTHLY_COUPON_ESTIMATE_NOTE}」`)
  })

  it('일부 빠짐 문구(SQ-21 ⓚ (a))가 문서의 문구 그대로다', () => {
    expect(DOC_008).toContain(`「${PARTIAL_RATE_MISSING_NOTE}」`)
  })
})

type Breakdown = TaxSummaryView['contributingProducts'][number]['breakdown']

describe('기여 상품 행의 내역 한 줄 (SCR-401)', () => {
  it('★ 상환 시 지급 상품은 내역이 없다 — 행이 종전과 같다', () => {
    const plain: Breakdown = { redemption: { taxableIncome: '4000000', isEstimated: true }, coupons: null }
    expect(contributionBreakdownLine(plain)).toBeNull()
  })

  it('월지급 — 상환(추정) · 월수익 확정 · 추정', () => {
    const b: Breakdown = {
      redemption: { taxableIncome: '0', isEstimated: true },
      coupons: { confirmedCount: 1, confirmedTaxableIncome: '600000', estimatedCount: 4, estimatedTaxableIncome: '2400000' },
    }
    expect(contributionBreakdownLine(b)).toBe('상환 0원 (추정) · 월수익 확정 1건 600,000원 · 추정 4건 2,400,000원')
  })

  it('추정분이 환율로 빠졌으면 「환율 없음」 — 0원으로 적지 않는다 · 상환이 없는 해는 월수익만', () => {
    const b: Breakdown = {
      redemption: null,
      coupons: { confirmedCount: 1, confirmedTaxableIncome: '279810', estimatedCount: 5, estimatedTaxableIncome: null },
    }
    expect(contributionBreakdownLine(b)).toBe('월수익 확정 1건 279,810원 · 추정 5건 환율 없음')
  })
})
