import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FOREIGN_ONLY_REDEMPTION_FIELDS } from '@/lib/forms/redemption'
import { PATHS } from '@/lib/routes/paths'

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

beforeAll(async () => {
  jar = await authenticatedJar()
  product = await registerProduct(jar, {
    label: '달러',
    currency: 'USD',
    principal: '10,000.50',
  })
})

afterAll(async () => {
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

  it('★ 예상 과세 금융소득은 ST-07 한 상품 형태다 — 「0원」으로 적지 않는다 (E-09 · a2~a3 뒷절)', async () => {
    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain('환율이 없어 추정 과세 금융소득을 계산하지 않았다 — 환율 입력은 아직 없다')
  })

  it('홈 ②가 달러 원금을 원화와 더하지 않고 따로 적는다', async () => {
    const home = await (await get(PATHS.home, jar)).text()
    expect(home).toContain('$10,000.50')
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
