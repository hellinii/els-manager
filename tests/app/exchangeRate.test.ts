import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EXCHANGE_RATE_INPUT_TAIL,
  exchangeRateMissingLead,
  exchangeRateMissingNotice,
} from '@/lib/format'

/**
 * ST-07 「환율 없음」 문구 ↔ DOC-008 §6 ST-07 명세 (P8 컷 a2)
 *
 * **앞절을 문서에 결속한다 — 뒷절은 결속하지 않는다.** 뒷절은 a2~a3 구간의 「환율 입력은 아직 없다」이고
 * 컷 a3의 코드 커밋이 SCR-302 링크로 바꾼다(ST-07 ⓐ — 「문구를 고정하는 테스트는 앞절을 잡으므로 a3가
 * 그것을 깨지 않는다」). 네 화면(SCR-101 ③ · SCR-202 ⑤ · SCR-401 ③ · SCR-402)이 이 함수 하나를 부르므로
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

describe('ST-07 뒷절 — a2~a3 구간은 없는 화면을 가리키지 않는다 (ⓐ)', () => {
  it('뒷절이 명세의 a2~a3 문구이고 전체는 앞절 — 뒷절이다', () => {
    expect(DOC_008).toContain(`**「${EXCHANGE_RATE_INPUT_TAIL}」**`)
    expect(exchangeRateMissingNotice({ kind: 'PRODUCT' })).toBe(
      `환율이 없어 추정 과세 금융소득을 계산하지 않았다 — ${EXCHANGE_RATE_INPUT_TAIL}`,
    )
  })
})
