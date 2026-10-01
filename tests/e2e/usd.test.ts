import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  EXCHANGE_RATE_MISSING_JOINER,
  EXCHANGE_RATE_SECTION_TEXT,
  FOREIGN_FORECAST_DISCLAIMER,
  FOREIGN_TAX_ASSUMPTION_NOTE,
  convertedTaxLine,
  exchangeRateMissingLead,
} from '@/lib/format'
import { TAX_KEYS } from '@/lib/forms/query'
import { FOREIGN_ONLY_REDEMPTION_FIELDS } from '@/lib/forms/redemption'
import { EXCHANGE_RATE_SECTION, PATHS } from '@/lib/routes/paths'

import { sql } from '../integration/helpers/seed'

import {
  actionIdOf,
  formFieldsFor,
  formHtmlFor,
  formValuesFor,
  inputNamesOf,
  submitAction,
} from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get, locationPath } from './helpers/server'

/**
 * 달러 ELS — 화면을 지나는 종단 (P8 컷 a2-3b · DOC-008 SCR-202 · 203 · 204 · DOC-001 S-13)
 *
 * 등록(달러 선택 · 센트 원금) → 상세(상품 통화 금액 · 원화 과세 · ST-07) → 상환(달러 칸 · 적용 환율 ·
 * 과세 미채움) → 상세(적용 환율) → 상환 수정 왕복(적용 환율 보존)을 **한 상품으로** 지난다.
 *
 * ## 이 파일은 스스로 정리한다 — 다른 e2e 파일과 다르다
 *
 * 기본 사용자(ITG_USER_A)를 다른 파일도 쓰고 파일 순서는 보장되지 않는다(`fileParallelism: false`는
 * 겹치지 않을 뿐 순서를 정하지 않는다). 미상환 달러 상품이 남으면 그 사용자의 세금 · 전망 화면에
 * ST-07 문구가 생기고 홈 ②에 「· $…」가 붙는다 — 다른 파일의 단언이 **이 파일이 먼저 돌았는가**에
 * 의존하게 된다. 그래서 `afterAll`이 상환 취소 → 삭제로 되돌린다(SCR-202의 2단계 삭제 그대로).
 *
 * 달러 원금은 **센트를 싣는다** — 센트가 0이면 원 단위로 접는 결함이 형식과 값 둘 다에서 보이지
 * 않는다(DOC-011 Q-07′의 「채워진 픽스처」).
 */

let jar: ReturnType<typeof cookieJar>
let product: RegisteredProduct
/** 이 파일이 저장한 환율의 기준일 — `afterAll`이 그 좌표만 지운다(사용자에게는 DELETE가 없다 — 소유자 커넥션) */
let savedRateDate: string | null = null

beforeAll(async () => {
  jar = await authenticatedJar()
  product = await registerProduct(jar, {
    label: '달러',
    currency: 'USD',
    principal: '10,000.50',
  })
})

afterAll(async () => {
  /*
   * 환율은 공용이고 사용자는 지울 수 없다(DQ-13). 남기면 다른 파일의 ST-07 · 세금 · 전망이 「환율이 있는 상태」에서
   * 돈다 — 이 파일이 먼저 돌았는가에 의존하게 된다. 소유자 커넥션으로 이 파일이 쓴 좌표 하나만 지운다.
   */
  if (savedRateDate != null) {
    await sql(`delete from public.exchange_rates where currency = 'USD' and as_of_date = $1`, [
      savedRateDate,
    ])
  }
  if (product == null) return
  const detailPath = PATHS.product(product.productId)
  const detail = await (await get(detailPath, jar)).text()
  if (detail.includes('>상환 실적<')) {
    await submitAction(detailPath, jar, formFieldsFor(detail, actionIdOf('deleteRedemptionAction')))
  }
  const active = await (await get(detailPath, jar)).text()
  await submitAction(detailPath, jar, formFieldsFor(active, actionIdOf('deleteProductAction')))
})

/** 렌더된 폼 값 위에 덮어 제출한다 — 사용자가 몇 칸만 고치는 형태다 */
async function submitOver(
  path: string,
  actionName: string,
  overrides: Record<string, string>,
): Promise<Response> {
  const html = await (await get(path, jar)).text()
  const rendered = formValuesFor(html, actionIdOf(actionName)).filter(
    ([name]) => !(name in overrides),
  )
  return submitAction(path, jar, [...rendered, ...Object.entries(overrides)])
}

describe('SCR-204 → SCR-202 — 달러 상품이 상품 통화로 저장되고 보인다', () => {
  it('원금이 센트까지 저장되고 「상품 통화 달러」가 붙는다', async () => {
    // 헬퍼가 쉼표를 지운 형태가 아니라 **계약이 준 형태**를 본다 — 달러는 소수 두 자리 고정이다
    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain('상품 통화')
    expect(detail).toContain('달러')
    expect(detail).toContain('$10,000.50')
  })

  it('차수표의 예상 수령액이 달러이고 머리글에 「(원)」이 없다 (SCR-202 ③)', async () => {
    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    // 10000.50 × (1 + 0.08 × 6/12) = 10400.52 — 1차. 원 단위로 접으면 $10,401이다
    expect(detail).toContain('$10,400.52')
    expect(detail).not.toContain('예상 수령액 (원)')
  })

  it('★ 예상 과세 금융소득은 ST-07 한 상품 형태다 — 「0원」으로 적지 않는다 (E-09 · 뒷절은 환율 절 링크)', async () => {
    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    /*
     * **세 조각이 한 문장으로 이어지는지** 본다 — 앞절 · 이음표 · 링크(주소와 글자). 조각을 따로 찾으면 화면이 이음표를
     * 지우거나 바꿔도 초록이다(반박 검토 지적). React가 인접 텍스트 사이에 넣는 `<!-- -->`를 걷어 내고 본다.
     * `#`·`?`·`=`는 속성 값에서 이스케이프되지 않는다
     */
    const joined = detail.replace(/<!-- -->/g, '')
    expect(joined).toMatch(
      new RegExp(
        `${exchangeRateMissingLead({ kind: 'PRODUCT' })}${EXCHANGE_RATE_MISSING_JOINER}<a\\b[^>]*href="${EXCHANGE_RATE_SECTION.href.replace(/[?]/g, '\\?')}"[^>]*>${EXCHANGE_RATE_INPUT_LINK_LABEL}</a>`,
      ),
    )
  })

  it('홈 ②가 달러 원금을 원화와 더하지 않고 따로 적는다', async () => {
    const home = await (await get(PATHS.home, jar)).text()
    expect(home).toContain('$10,000.50')
  })
})

/** `<details id="exchange-rate" …>` 태그 — 속성 순서에 기대지 않는다 */
function rateSectionTag(html: string): string {
  const tag = /<details\b[^>]*\bid="exchange-rate"[^>]*>/.exec(html)?.[0]
  if (tag == null) throw new Error('환율 절이 렌더되지 않았다')
  return tag
}

/*
 * P8 컷 a3-3 — 환율을 화면에서 넣고 그 값이 화면들을 지난다. **상환(아래 SCR-203)보다 먼저다** — 상품이 미상환이어야
 * 적용 차수의 추정이 있고 그 추정을 환산한다.
 */
describe('SCR-302 환율 절 → 추정 환율이 화면을 지난다 (P8 컷 a3-3)', () => {
  it('환율 절이 있고 미상환 달러 상품이 있으니 열려 온다 · 값이 없으면 그 자리에서 말한다', async () => {
    const html = await (await get(PATHS.prices, jar)).text()
    expect(rateSectionTag(html)).toMatch(/\bopen\b/)
    expect(html).toContain(EXCHANGE_RATE_SECTION_TEXT.title)
    expect(html).toContain(EXCHANGE_RATE_SECTION_TEXT.missing)
    // 수집 상태는 필드에서 파생된다 — 레지스트리가 비어 있다(컷 a3)
    expect(html).toContain(EXCHANGE_RATE_SECTION_TEXT.notCollected)
    expect(html).toContain(EXCHANGE_RATE_SECTION_TEXT.refreshExcludes)
  })

  it('ST-07 링크의 주소로 오면 열린 채로 그린다 — JS 없이 (SQ-20)', async () => {
    const res = await get(EXCHANGE_RATE_SECTION.href.split('#')[0]!, jar)
    expect(res.status).toBe(200)
    expect(rateSectionTag(await res.text())).toMatch(/\bopen\b/)
  })

  it('수동 환율을 JS 없이 저장한다 — 같은 화면에 「환율을 저장했다」', async () => {
    const html = await (await get(PATHS.prices, jar)).text()
    const rendered = formValuesFor(html, actionIdOf('saveExchangeRateAction'))
    // 기준일 칸의 기본값이 조회 기준일이다(V-17) — 그 좌표를 기억해 `afterAll`이 지운다
    savedRateDate = rendered.find(([name]) => name === 'asOfDate')?.[1] ?? null
    expect(savedRateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const res = await submitAction(PATHS.prices, jar, [
      ...rendered.filter(([name]) => name !== 'rate'),
      ['rate', '1392.40'],
    ])
    /*
     * **태그 안에서 찾는다** — 문구의 첫 등장은 `$ACTION_*` 히든 필드에 직렬화된 FormState일 수 있다(prices.test.ts의
     * 같은 함정 — 반박 검토 지적). 히든 값은 `&lt;`로 이스케이프된 JSON이라 `<p>` 태그를 갖지 않는다
     */
    expect(await res.text()).toContain(`<p>${EXCHANGE_RATE_SECTION_TEXT.saved}</p>`)

    const after = await (await get(PATHS.prices, jar)).text()
    expect(after).toContain('1,392.40원/달러')
    expect(after).not.toContain(EXCHANGE_RATE_SECTION_TEXT.missing)
  })

  it('상세 ⑤가 원화 과세와 근거를 보이고 ST-07이 사라진다', async () => {
    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain(`추정 · 1,392.40원/달러 · ${savedRateDate} 기준 추정 환율로 환산`)
    expect(detail).not.toContain(exchangeRateMissingLead({ kind: 'PRODUCT' }))
  })

  it('상환 화면의 과세 칸 힌트가 산식과 추정 환율을 말한다 — 숫자를 넣지 않는다', async () => {
    const html = await (await get(PATHS.productRedeem(product.productId), jar)).text()
    expect(html).toContain(
      `≈ (실수령액 − 투자원금) × 1,392.40원/달러 — ${savedRateDate} 기준 추정 환율이다. 거래내역의 원화 금액을 적는다`,
    )
  })

  it('SCR-401 — 환율 기준 줄과 표시 주의 넷째 줄이 그 상품의 귀속연도에 뜬다 (convertedCount > 0)', async () => {
    // 귀속연도는 오늘에 따라 달라진다 — 상세의 「귀속연도」에서 읽어 그 해를 연다(시각에 의존하지 않는 단언)
    const detail = (await (await get(PATHS.product(product.productId), jar)).text()).replace(/<!-- -->/g, '')
    const year = /귀속연도<\/dt><dd[^>]*>(\d{4})년/.exec(detail)?.[1]
    expect(year, '상세에 귀속연도가 없다 — 적용 차수의 추정이 있어야 환산이 일어난다').toBeDefined()

    const tax = await (await get(`${PATHS.tax}?${TAX_KEYS.year}=${year}`, jar)).text()
    expect(tax).toContain(
      convertedTaxLine(1, { rate: '1392.400000', asOfDate: savedRateDate!, isStale: false }),
    )
    expect(tax).toContain(FOREIGN_TAX_ASSUMPTION_NOTE)
    expect(tax).not.toContain(exchangeRateMissingLead({ kind: 'COUNT', count: 1 }))
  })

  it('홈 ②에 원화 환산 합계 줄 · 전망에 다섯째 표식과 면책', async () => {
    const home = await (await get(PATHS.home, jar)).text()
    expect(home).toContain('원화 환산 합계 약')
    const forecast = await (await get(PATHS.forecast, jar)).text()
    expect(forecast).toContain(`환율 1,392.40원/달러(${savedRateDate} 기준) 가정`)
    expect(forecast).toContain(FOREIGN_FORECAST_DISCLAIMER)
  })
})

describe('SCR-203 — 달러 상품의 상환 칸', () => {
  it('실수령액이 달러 칸이고 적용 환율 칸이 있으며 과세 금융소득을 채우지 않는다 (U1)', async () => {
    const html = await (await get(PATHS.productRedeem(product.productId), jar)).text()
    const form = formHtmlFor(html, actionIdOf('redemptionFormAction'))

    expect(form).toContain('실수령액 (달러)')
    for (const name of FOREIGN_ONLY_REDEMPTION_FIELDS) {
      expect(inputNamesOf(form).has(name), `${name}이 달러 상품에 없다`).toBe(true)
    }
    // ★ 채우면 사용자가 우리 추정을 증권사 확정값으로 저장한다 — 달러 이익을 원화 칸에 넣으면 1/1,400이다
    const taxable = /<input[^>]*name="taxableIncome"[^>]*>/.exec(form)?.[0] ?? ''
    expect(taxable).toContain('value=""')
  })

  it('저장 → 상세가 실수령액 · 손익은 달러, 과세는 원화, 적용 환율은 원/달러로 적는다', async () => {
    const redeemPath = PATHS.productRedeem(product.productId)
    const saved = await submitOver(redeemPath, 'redemptionFormAction', {
      redemptionType: 'MATURITY_GAIN',
      roundNo: '',
      redemptionDate: `${product.issueDate.slice(0, 4)}-07-02`,
      grossAmount: '10,400.52',
      // 거래내역의 **원화** 과표를 옮긴다 — 환율을 곱해 만든 값이 아니다(U1)
      taxableIncome: '580,029',
      withholdingTax: '',
      exchangeRate: '1,450',
      isConfirmed: 'on',
      note: '달러 상환',
    })
    expect([302, 303]).toContain(saved.status)
    expect(locationPath(saved)).toBe(PATHS.product(product.productId))

    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain('$10,400.52')
    expect(detail).toContain('+$400.02')
    expect(detail).toContain('580,029원')
    expect(detail).toContain('적용 환율')
    expect(detail).toContain('1,450.00원/달러')
    // 원천징수는 원화 과세 × 분리과세율 — 580,029 × 0.154 = 89,324.466 → 89,324원(원 단위 절사)
    expect(detail).toContain('89,324원')
  })

  it('★ 상환 수정이 적용 환율을 보존한다 — 전체 교체(§5.5)가 칸 없는 값을 지우지 않는다', async () => {
    const detailPath = PATHS.product(product.productId)
    const before = await (await get(detailPath, jar)).text()
    const editForm = formHtmlFor(before, actionIdOf('updateRedemptionAction'))
    expect(/<input[^>]*name="exchangeRate"[^>]*>/.exec(editForm)?.[0] ?? '').toContain(
      'value="1450.000000"',
    )

    const res = await submitOver(detailPath, 'updateRedemptionAction', { note: '비고만 고쳤다' })
    expect(res.status).toBe(200)

    const after = await (await get(detailPath, jar)).text()
    expect(after).toContain('비고만 고쳤다')
    expect(after).toContain('1,450.00원/달러')
  })
})

/*
 * ★ SQ-20의 바로 그 경우 — 위에서 상환했으므로 이 시점의 달러 상품은 **상환된 것뿐**이고 미상환 수가 0이다. 위
 * 「ST-07 링크의 주소로 오면 열린 채로」는 미상환 상품이 있을 때라 그 단언만으로는 링크가 여는지 갈리지 않았다.
 */
describe('★ SQ-20 — 미상환 달러 상품이 0건이면 절은 접혀 오고, 링크 주소는 연다', () => {
  it('그냥 오면 접혀 있다 · 링크 주소로 오면 열려 있다', async () => {
    const plain = await (await get(PATHS.prices, jar)).text()
    expect(rateSectionTag(plain)).not.toMatch(/\bopen\b/)
    const linked = await (await get(EXCHANGE_RATE_SECTION.href.split('#')[0]!, jar)).text()
    expect(rateSectionTag(linked)).toMatch(/\bopen\b/)
  })

  it('★ 접힌 절에서 JS 없이 저장해도 열린 절로 돌아온다 — 폼의 permalink가 절을 연 주소다', async () => {
    /*
     * 손으로 펼쳐 저장하면 응답이 새 문서이고 펼침은 서버가 다시 정한다 — permalink가 없으면 절이 다시 접혀 성공 문구가
     * 그 안에 숨는다(반박 검토 지적). 폼의 `action`이 ST-07 링크와 같은 주소이고, 그 주소로 낸 응답에서 절이 열려 있다.
     */
    const plain = await (await get(PATHS.prices, jar)).text()
    const actionId = actionIdOf('saveExchangeRateAction')
    expect(formHtmlFor(plain, actionId)).toContain(`action="${EXCHANGE_RATE_SECTION.href}"`)

    const rendered = formValuesFor(plain, actionId).filter(([name]) => name !== 'rate')
    const res = await submitAction(EXCHANGE_RATE_SECTION.href.split('#')[0]!, jar, [
      ...rendered,
      ['rate', '1393.10'],
    ])
    const body = await res.text()
    expect(rateSectionTag(body)).toMatch(/\bopen\b/)
    expect(body).toContain(`<p>${EXCHANGE_RATE_SECTION_TEXT.saved}</p>`)
  })
})
