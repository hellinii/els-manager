import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  EXCHANGE_RATE_MISSING_JOINER,
  EXCHANGE_RATE_SECTION_TEXT,
  EXCHANGE_RATE_STALE_LABEL,
  FOREIGN_FORECAST_DISCLAIMER,
  FOREIGN_TAX_ASSUMPTION_NOTE,
  REDEMPTION_KRW_TAXABLE_HINT,
  SETTINGS_FOREIGN_DISCLAIMER,
  convertedIncludedLine,
  convertedTaxLine,
  exchangeRateMissingLead,
  exchangeRateMissingNotice,
  forecastBasisLine,
  krwEstimateLine,
  projectionBasisLine,
  redemptionTaxableHint,
} from '@/lib/format'
import { EXCHANGE_RATE_SECTION, PATHS } from '@/lib/routes/paths'

/**
 * ST-07 「환율 없음」 문구 ↔ DOC-008 §6 ST-07 명세 (P8 컷 a2)
 *
 * **앞절을 문서에 결속한다.** 뒷절은 a2~a3 구간의 「환율 입력은 아직 없다」였고 컷 a3-3이 SCR-302 링크로
 * 바꿨다(ST-07 ⓐ — 「문구를 고정하는 테스트는 앞절을 잡으므로 a3가 그것을 깨지 않는다」 — 실제로 첫 describe는
 * 한 줄도 바뀌지 않았다). 아래 describe들이 a3의 뒷절과 근거 줄을 문서에 결속한다.
 *
 * **화면은 이 모듈의 문장 함수를 부르지 않는다**(a3-3 — 뒷절이 링크라 `ExchangeRateMissingNotice`가 앞절 · 이음표 ·
 * 링크 글자를 따로 그린다). 그래서 결속은 **조각 단위**다 — 앞절(`exchangeRateMissingLead`) · 이음표
 * (`EXCHANGE_RATE_MISSING_JOINER`) · 뒷절 글자를 화면과 같은 상수로 조립해 문서와 대조하고, 렌더된 문장이 그
 * 조각들로 이어지는지는 `tests/e2e/usd.test.ts`가 본다(반박 검토 지적 — 종전 「네 화면이 이 함수 하나를 부른다」는
 * a3-3 이후 거짓이었다). 네 화면(SCR-101 ③ · SCR-202 ⑤ · SCR-401 ③ · SCR-402)이 이 함수 하나를 부르므로
 * 여기서 문구가 명세와 갈리면 네 화면이 함께 갈린다.
 *
 * 문서의 n은 `n`으로 적혀 있다 — 건수를 `n`으로 되돌려 문서에서 찾는다.
 */

const DOC_008 = readFileSync(join(process.cwd(), 'docs', '08_정보구조_및_화면목록.md'), 'utf8')

describe('ST-07 앞절이 DOC-008 명세의 문구 그대로다', () => {
  it.each([
    ['COUNT', exchangeRateMissingLead({ kind: 'COUNT', count: 2 }).replace('2건', 'n건')],
    ['PRODUCT', exchangeRateMissingLead({ kind: 'PRODUCT' })],
    ['FORECAST', exchangeRateMissingLead({ kind: 'FORECAST', count: 3 }).replace('3건', 'n건')],
  ])('%s', (_kind, lead) => {
    expect(DOC_008).toContain(`「${lead} — `)
  })

  it('건수가 문구에 들어간다 — 화면이 세지 않는다', () => {
    expect(exchangeRateMissingLead({ kind: 'COUNT', count: 2 })).toBe(
      '환율이 없어 달러 상품 2건의 추정 과세 금융소득이 빠졌다',
    )
    expect(exchangeRateMissingLead({ kind: 'FORECAST', count: 3 })).toBe(
      '환율이 없어 달러 상품 3건의 원화 금액(세전 회수 · 잔여 원금)이 이 표에서 빠졌다',
    )
  })
})

describe('ST-07 뒷절 — SCR-302 환율 절로 가는 링크 (컷 a3-3 · SQ-20)', () => {
  it('뒷절의 글자가 명세의 세 형태에 그대로 있다', () => {
    for (const kind of ['COUNT', 'PRODUCT', 'FORECAST'] as const) {
      const lead = exchangeRateMissingLead(
        kind === 'PRODUCT' ? { kind } : { kind, count: 2 },
      ).replace('2건', 'n건')
      expect(DOC_008).toContain(`「${lead}${EXCHANGE_RATE_MISSING_JOINER}${EXCHANGE_RATE_INPUT_LINK_LABEL}」`)
    }
    expect(exchangeRateMissingNotice({ kind: 'PRODUCT' })).toBe(
      `환율이 없어 추정 과세 금융소득을 계산하지 않았다 — ${EXCHANGE_RATE_INPUT_LINK_LABEL}`,
    )
  })

  it('링크가 절을 연다 — 쿼리가 열고 조각이 스크롤한다 (SQ-20 결정)', () => {
    expect(EXCHANGE_RATE_SECTION.href).toBe(
      `${PATHS.prices}?${EXCHANGE_RATE_SECTION.openParam}=${EXCHANGE_RATE_SECTION.openValue}#${EXCHANGE_RATE_SECTION.id}`,
    )
    expect(DOC_008).toContain(`\`${EXCHANGE_RATE_SECTION.href}\``)
  })
})

describe('근거 줄 — 각 화면의 문장이 DOC-008의 예시 그대로다 (컷 a3-3)', () => {
  /** 문서의 예시 값 — 1,392.40원/달러 · 2026-09-28 기준 */
  const BASIS = { rate: '1392.400000', asOfDate: '2026-09-28', isStale: false }
  const STALE = { ...BASIS, isStale: true }

  it.each([
    ['SCR-101 ②', krwEstimateLine('1097468000', BASIS)],
    ['SCR-101 ③', convertedIncludedLine(2, BASIS).replace('2건', 'n건')],
    ['SCR-202 ⑤', projectionBasisLine(BASIS)],
    ['SCR-401 기준 줄', convertedTaxLine(2, BASIS).replace('2건', 'n건')],
    ['SCR-402 다섯째 표식', forecastBasisLine(BASIS)],
    ['SCR-203 힌트', redemptionTaxableHint(BASIS)],
  ])('%s', (_where, line) => {
    expect(DOC_008).toContain(`「${line}」`)
  })

  it('SCR-203 힌트는 근거가 없으면 뒷절만이다 — 환율을 지어내지 않는다', () => {
    expect(redemptionTaxableHint(null)).toBe(REDEMPTION_KRW_TAXABLE_HINT)
    expect(redemptionTaxableHint(BASIS).endsWith(REDEMPTION_KRW_TAXABLE_HINT)).toBe(true)
  })

  it('「환율 오래됨」은 힌트를 뺀 근거 줄 다섯에 붙는다 (v2.19)', () => {
    const tail = ` · ${EXCHANGE_RATE_STALE_LABEL}`
    expect(krwEstimateLine('1097468000', STALE)).toBe(
      `원화 환산 합계 약 1,097,468,000원 (추정 · 1,392.40원/달러 · 2026-09-28 기준${tail})`,
    )
    expect(convertedIncludedLine(1, STALE)).toContain(`추정 환율${tail})`)
    expect(projectionBasisLine(STALE).endsWith(tail)).toBe(true)
    expect(convertedTaxLine(1, STALE).endsWith(tail)).toBe(true)
    expect(forecastBasisLine(STALE).endsWith(tail)).toBe(true)
    expect(redemptionTaxableHint(STALE)).toBe(redemptionTaxableHint(BASIS))
    // 표시어는 DOC-005 §6 「환율 경과」의 등재다
    expect(readFileSync(join(process.cwd(), 'docs', '05_용어_사전.md'), 'utf8')).toContain(
      `**"${EXCHANGE_RATE_STALE_LABEL}"**`,
    )
  })

  it('환율은 두 자리로 접어 보이고 저장 6자리를 그대로 싣지 않는다', () => {
    expect(forecastBasisLine({ ...BASIS, rate: '1392.405000' })).toBe(
      '환율 1,392.41원/달러(2026-09-28 기준) 가정',
    )
  })
})

describe('면책 · 절의 고정 문구가 DOC-008 그대로다 (컷 a3-3)', () => {
  /*
   * **「」로 감싸 결속한다** — 맨 부분 문자열이면 문구를 잘라도(「환율이 없다」 · 「자동 수집 안 함」) 문서 어딘가에
   * 그 조각이 있어 초록이다(반박 검토 지적). 잘림을 「」만으로 못 가르는 둘은 문서의 앞말까지 붙인다.
   */
  it.each([
    ['SCR-401 표시 주의 넷째 줄', '', FOREIGN_TAX_ASSUMPTION_NOTE],
    ['SCR-402 면책', '', FOREIGN_FORECAST_DISCLAIMER],
    ['SCR-502 면책', '', SETTINGS_FOREIGN_DISCLAIMER],
    ['SCR-302 최신 값 없음', '', EXCHANGE_RATE_SECTION_TEXT.missing],
    ['SCR-302 안내', '', EXCHANGE_RATE_SECTION_TEXT.estimateOnly],
    ['SCR-302 안내 (SQ-19)', '', EXCHANGE_RATE_SECTION_TEXT.refreshExcludes],
    ['SCR-302 수집 상태', '또는 ', EXCHANGE_RATE_SECTION_TEXT.notCollected],
    ['SCR-302 제목', '제목 ', EXCHANGE_RATE_SECTION_TEXT.title],
    ['SCR-302 입력 칸', '', EXCHANGE_RATE_SECTION_TEXT.rateLabel],
  ])('%s', (_where, prefix, text) => {
    expect(DOC_008).toContain(`${prefix}「${text}」`)
  })

  it('수집 상태 문구에 문서의 인용 「(ADR-010)」을 싣지 않는다 (v2.19)', () => {
    expect(EXCHANGE_RATE_SECTION_TEXT.notCollected).not.toContain('ADR-010')
  })
})
