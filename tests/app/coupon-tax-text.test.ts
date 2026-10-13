import { describe, expect, it } from 'vitest'

import type { TaxSummaryView } from '@/lib/db/queries/tax'
import {
  MONTHLY_COUPON_ESTIMATE_NOTE,
  PARTIAL_RATE_MISSING_NOTE,
  contributionBreakdownLine,
} from '@/lib/format/coupons'

import { liveDoc, quoteBlock } from './docText'

/**
 * 세금 · 전망의 월수익 문구 (P8 컷 b4 — DOC-008 SQ-21 ⓚ · ⓛ · SCR-401)
 *
 * 문장 상수는 문서의 문구와 **같은 문자열**이어야 한다 — 한 가정을 SCR-502 · SCR-401 · SCR-101 ③이 같은 상수로 말하는데
 * 그 상수가 문서와 갈리면 정본이 둘이 된다. 표 밖 표식 문구는 `forecast.test.ts`가 같은 방식으로 묶는다.
 *
 * **살아 있는 글을 본다**(`liveDoc` — 홈 피드백 컷 K8). 월지급 면책이 해요체가 되며 종전 다체 문장이 문서에 취소선으로
 * 남았다 — 원문 전체에 걸면 코드를 종전으로 되돌려도 그 취소선이 초록을 만든다. 그리고 바꾼 문장은 **정본 블록 하나**에서
 * 찾는다 — SCR-401 「P8 월지급식 — ③」 블록의 SQ-21 ⓚ (c) 항목이 그 문장을 「」째로 싣고, §9 SQ-21 행도 같은 문장을
 * 인용하므로 문서 전체에 걸면 정본만 낡아도 초록이다.
 */
const DOC_008 = liveDoc('08_정보구조_및_화면목록.md')
/** 월지급 면책의 정본 — SCR-401 「P8 월지급식 — ③ 금융소득 집계」 블록(SQ-21 ⓚ (c) 항목) */
const SCR401_MONTHLY = quoteBlock(DOC_008, '> **P8 월지급식 — ③ 금융소득 집계')

describe('문장 상수 ↔ DOC-008', () => {
  it('월지급 면책 문장(SQ-21 ⓛ)이 문서의 문구 그대로다 — 해요체(DOC-005 §2.1 · 홈 피드백 컷 K8)', () => {
    expect(SCR401_MONTHLY).toContain(`「${MONTHLY_COUPON_ESTIMATE_NOTE}」`)
    expect(MONTHLY_COUPON_ESTIMATE_NOTE).toBe(
      '월지급식 — 기록 없는 지난 월수익은 지급된 것으로, 미상환 상품은 적용 차수까지 매월 지급된다고 가정한 추정이에요. 확정값은 월수익 지급 기록(거래내역)이에요',
    )
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
