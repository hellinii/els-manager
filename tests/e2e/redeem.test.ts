import { beforeAll, describe, expect, it } from 'vitest'

import {
  REDEMPTION_TYPE_LABELS,
  STATUS_LABELS,
  korDate,
  signedWon,
  won,
} from '@/lib/format'
import { REDEMPTION_FIELDS, REDEMPTION_ID_FIELD } from '@/lib/forms/redemption'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'
import { PATHS } from '@/lib/routes/paths'

import { ITG_USER_B } from '../integration/helpers/fixtures'

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
 * SCR-203 상환 처리 · SCR-202의 상환 액션 — **상태 전이가 Next를 지나야 존재한다**
 * (P4 컷 6)
 *
 * ## 여기서만 보이는 것 넷
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | 상환 저장이 상품을 상환완료로 **전이**시킨다 | 상태는 열이 아니라 레코드의 존재다(D-01) — 그 유도가 화면에 닿는지는 렌더된 문서에만 있다 |
 * | **2단계 삭제**가 실제로 두 단계다 | `CONFLICT` → 취소 → 삭제 성공의 순서는 세 요청의 상호작용이다 |
 * | 원천징수액이 수정에서 **보존된다** | A-04를 뒤집는 조용한 변경이고, 계약 계층만 봐서는 화면이 무엇을 보내는지 알 수 없다 |
 * | §5.4의 시드 범위 오류가 **그 칸에** 붙는다 | 컷 6의 코드 결정(v1.7)이 사용자에게 닿는 형태다 |
 *
 * 브라우저는 쓰지 않는다(`helpers/actions.ts`). 정리하지 않고 이름에 타임스탬프를
 * 붙이며 실행 후 `db:reset`이 지운다 — 다른 e2e 파일과 같은 규율이다.
 */

/** 판정과 무관하게 저장할 수 있는 최소 입력. 만기 상환이므로 차수가 없다 */
function maturityGain(redemptionDate: string): Record<string, string> {
  return {
    redemptionType: 'MATURITY_GAIN',
    roundNo: '',
    redemptionDate,
    grossAmount: '104,000,000',
    taxableIncome: '4,000,000',
    withholdingTax: '',
    isConfirmed: 'on',
    note: '지급명세서 확인',
  }
}

/** 상환 폼을 그 화면에서 읽어 제출한다 — 값은 렌더된 폼에서 나온다 */
async function submitRedemption(
  path: string,
  jar: ReturnType<typeof cookieJar>,
  actionName: string,
  overrides: Record<string, string>,
): Promise<Response> {
  const html = await (await get(path, jar)).text()
  const actionId = actionIdOf(actionName)
  const rendered = formValuesFor(html, actionId).filter(
    ([name]) => !(name in overrides),
  )
  return submitAction(path, jar, [...rendered, ...Object.entries(overrides)])
}

describe('SCR-203 상환 처리', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('200으로 서고 판정이 폼을 채운다 — DOC-008 「초기값」', async () => {
    const product = await registerProduct(jar, { label: '상환폼' })
    const res = await get(PATHS.productRedeem(product.productId), jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    const form = formHtmlFor(html, actionIdOf('redemptionFormAction'))
    const rendered = inputNamesOf(form)

    // 좌변을 순수 모듈에서 읽는다 — 칸 목록이 세 번째 사본이 되지 않는다.
    for (const name of REDEMPTION_FIELDS) {
      expect(rendered, `${name}이 렌더되지 않았다`).toContain(name)
    }
    expect(rendered).toContain(PRODUCT_ID_FIELD)

    /*
     * 워스트오브 1.2 ≥ 1차 배리어 0.9이므로 조기상환 판정이고, 그 유형이 선택되어
     * 있다. 판정이 확정적일 때만 채우는 결정이 여기서 관측된다.
     */
    expect(form).toMatch(/<option value="EARLY"[^>]*selected/)
    /*
     * 적용 차수도 채워진다. **어느 차수인지는 단언하지 않는다** — `registerProduct`가
     * 올해 1월 발행 + 6개월 주기이므로 오늘이 언제인지에 따라 1차 또는 2차이고
     * (실측: 2026-07-28에는 2차다), 그 수를 박으면 「시각이 데이터인 테스트」가 된다.
     * 지켜야 하는 성질은 **빈 선택지가 아닌 것이 선택되어 있다**는 것이다.
     */
    const roundSelect = /<select[^>]*name="roundNo"[\s\S]*?<\/select>/.exec(form)?.[0] ?? ''
    expect(roundSelect).toMatch(/<option value="\d+"[^>]*selected/)
    expect(roundSelect).not.toMatch(/<option value=""[^>]*selected/)
    /*
     * ★ 원천징수세액은 **비어 있다.** 채우면 계약의 산출(§5.4)이 영원히 실행되지
     * 않는다 — 값이 아니라 부재가 그 경로를 여는 조건이다.
     */
    const tag = /<input[^>]*name="withholdingTax"[^>]*>/.exec(form)?.[0] ?? ''
    expect(tag).toContain('value=""')
  })

  it('★ 저장이 상품을 상환완료로 전이시킨다 — 열이 아니라 레코드다', async () => {
    /*
     * ★ **전이의 관측이다.** `els_products`에 `status` 열이 없으므로(절대 규칙 #4)
     * 상태는 `redemptions` 1건의 존재로 유도된다. 그 유도가 뷰를 지나 화면에 닿는지는
     * 렌더된 문서에만 있다 — 상환 실적 절이 생기고 예상 수령액 절이 E-05 문구로
     * 바뀌는 것이 그 관측이다.
     */
    const product = await registerProduct(jar, { label: '전이' })
    const redeemPath = PATHS.productRedeem(product.productId)

    const saved = await submitRedemption(
      redeemPath,
      jar,
      'redemptionFormAction',
      maturityGain(`${product.issueDate.slice(0, 4)}-07-02`),
    )

    // 성공은 상세로 가는 리다이렉트다 — DOC-008 §7.1의 「[저장] → SCR-202」.
    expect([302, 303]).toContain(saved.status)
    expect(locationPath(saved)).toBe(PATHS.product(product.productId))

    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain(STATUS_LABELS.REDEEMED)
    expect(detail).toContain('>상환 실적<')
    expect(detail).toContain(REDEMPTION_TYPE_LABELS.MATURITY_GAIN)
    expect(detail).toContain(won('104000000'))
    // E-05 — 상환이 완료되면 추정하지 않는다.
    expect(detail).toContain('상환이 완료되어 추정하지 않는다')
    // 확정값 체크가 실렸다(ST-05).
    expect(detail).toContain('확정값')

    /*
     * ★ 원천징수세액이 **산출되었다.** 4,000,000 × 0.154 = 616,000. 폼이 그 칸을
     * 비워 보냈으므로 §5.4의 산출 경로가 실행되었다는 뜻이다 — 채워 보냈다면 이
     * 값이 우리 추정이 아니라 폼의 값이 된다.
     */
    expect(detail).toContain('616,000원')

    // 상환된 상품에는 상환 처리 링크가 없다(I-01).
    expect(detail).not.toContain(`href="${redeemPath}"`)
  })

  it('이미 상환된 상품의 상환 화면은 폼을 그리지 않는다 — I-01', async () => {
    /*
     * 계약이 `CONFLICT`를 주지만 그것을 저장 시점에 처음 알려 주면 사용자가 채운
     * 입력이 버려진다. 그리고 이 경우의 다음 행동은 상세의 수정·취소다.
     */
    const product = await registerProduct(jar, { label: '중복' })
    await submitRedemption(
      PATHS.productRedeem(product.productId),
      jar,
      'redemptionFormAction',
      maturityGain(`${product.issueDate.slice(0, 4)}-07-02`),
    )

    const html = await (await get(PATHS.productRedeem(product.productId), jar)).text()
    expect(html).toContain('이미 상환 처리된 상품이다')
    expect(inputNamesOf(html).has(REDEMPTION_FIELDS[0])).toBe(false)
  })

  it('★ 타인의 상환 주소는 SCR-902다 — 소유자 전용 라우트 둘째', async () => {
    // 계획 §5가 902의 도달 경로를 둘로 셌다: 수정(컷 5)과 이 화면이다.
    const product = await registerProduct(jar, { label: '권한' })
    const otherJar = await authenticatedJar(ITG_USER_B)
    const res = await get(PATHS.productRedeem(product.productId), otherJar)

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('권한이 없다')
    expect(html).toContain('이 상품의 상환을 처리할')
    expect(inputNamesOf(html).has(PRODUCT_ID_FIELD)).toBe(false)
  })

  it('없는 상품·오타 id는 404다', async () => {
    expect(
      (await get('/products/00000000-0000-4000-8000-0000000000fe/redeem', jar)).status,
    ).toBe(404)
    expect((await get('/products/abc/redeem', jar)).status).toBe(404)
  })

  it('★ 시드 이전 연도는 `withholdingTax` 칸의 오류다 — §5.4 v1.7', async () => {
    /*
     * ★ **컷 6의 코드 결정이 사용자에게 닿는 형태를 여기서 본다.** 종전 구현은
     * `INTERNAL`이었고 화면은 「처리 중 오류가 발생했다」만 보여 주었다 — 사용자가
     * 할 수 있는 일이 있는데 시스템 오류로 보고하는 상태였다.
     *
     * 픽스처가 2025년인 이유는 세율 시드가 2026년부터라는 것이다(ADR-005는 뒤 연도의
     * 법으로 과거를 계산하는 것을 금지한다). 발행일도 2025년이어야 V-10을 통과한다.
     */
    const product = await registerProduct(jar, {
      label: '과거연도',
      issueDate: '2025-01-02',
    })
    const redeemPath = PATHS.productRedeem(product.productId)

    const res = await submitRedemption(redeemPath, jar, 'redemptionFormAction', {
      ...maturityGain('2025-12-31'),
      withholdingTax: '', // 비운다 → 산출을 요구한다 → 2025년 시드가 없다
    })

    // 오류는 결과 객체다 — 화면을 갈아치우지 않는다(입력값 보존).
    expect(res.status).toBe(200)
    const html = await res.text()

    // 그 칸에 붙었다. `Field`가 `<p id="{name}-error">`로 렌더한다.
    expect(html).toContain('id="withholdingTax-error"')
    expect(html).toContain('실제 징수액')
    // `redemptionDate`를 가리키지 않는다 — 사용자가 가진 사실을 부정하지 않는다.
    expect(html).not.toContain('id="redemptionDate-error"')
    /*
     * 입력값이 보존되었다(§6) — **쉼표까지 원문 그대로다.** 파서가 쉼표를 지우는 것은
     * 계약으로 보내는 값이고 화면에 남는 것은 사용자가 적은 문자열이다(SCR-204의
     * 원금 칸이 같은 성질이며 컷 4a가 그 사실을 케이스로 박았다).
     */
    expect(html).toContain('value="104,000,000"')

    // 실제 징수액을 적으면 같은 상환이 통과한다 — A-04의 양성 대조다.
    const retry = await submitRedemption(redeemPath, jar, 'redemptionFormAction', {
      ...maturityGain('2025-12-31'),
      withholdingTax: '616,000',
    })
    expect([302, 303]).toContain(retry.status)
    expect(await (await get(PATHS.product(product.productId), jar)).text()).toContain(
      '616,000원',
    )
  })
})

describe('SCR-202 상환 수정·취소', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  /** 상환까지 마친 상품 하나 */
  async function redeemed(label: string): Promise<RegisteredProduct> {
    const product = await registerProduct(jar, { label })
    await submitRedemption(
      PATHS.productRedeem(product.productId),
      jar,
      'redemptionFormAction',
      maturityGain(`${product.issueDate.slice(0, 4)}-07-02`),
    )
    return product
  }

  it('★ 수정이 원천징수액을 보존한다 — A-04를 뒤집지 않는다', async () => {
    /*
     * ★ 비고만 고친다. 그런데 `updateRedemption`도 모든 열을 실어 보내고 §5.4의
     * 산출은 `withholdingTax`가 **미입력일 때** 일어난다 — 초기값이 저장된 값을
     * 담지 않으면 이 수정이 증권사가 확정한 징수액을 **우리 산출값으로 바꾼다.**
     * 여기 픽스처는 산출값과 저장값이 같아지지 않게 고른다(616,000 → 500,000).
     */
    const product = await redeemed('수정')
    const detailPath = PATHS.product(product.productId)

    // 먼저 실제 징수액을 우리 산출과 다른 값으로 바꾼다.
    await submitRedemption(detailPath, jar, 'updateRedemptionAction', {
      withholdingTax: '500,000',
    })
    let detail = await (await get(detailPath, jar)).text()
    expect(detail).toContain('500,000원')

    // 이제 비고만 고친다 — 징수액 칸은 손대지 않는다(렌더된 값이 그대로 실린다).
    const res = await submitRedemption(detailPath, jar, 'updateRedemptionAction', {
      note: '비고만 고쳤다',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('상환 실적을 고쳤다')

    detail = await (await get(detailPath, jar)).text()
    expect(detail).toContain('비고만 고쳤다')
    // ★ 산출값(616,000)으로 되돌아가지 않았다.
    expect(detail).toContain('500,000원')
    expect(detail).not.toContain('616,000원')
  })

  it('★ 삭제는 2단계다 — 취소 없이는 상품이 지워지지 않는다', async () => {
    /*
     * ★ **P2.5가 세금 이력 보호를 위해 만든 경로를 화면에서 실측한다.**
     * §5.3이 상환 완료 상품의 삭제를 `CONFLICT`로 막으므로 상품을 지우려는 사용자는
     * 반드시 `deleteRedemption`을 먼저 통과한다. 그 순서가 우연이 아니라 설계이며
     * (DQ-01을 도입하지 않은 결정의 짝) 두 단계의 문구가 서로 다른 것을 말한다.
     *
     * 세 요청의 상호작용이므로 계약 계층만으로는 「화면에서 그 순서가 성립하는가」를
     * 알 수 없다 — 컷 5의 삭제 폼과 컷 6의 취소 폼이 같은 문서에 있어야 하고, 첫
     * 시도의 `CONFLICT` 문구가 그 취소를 가리켜야 한다.
     */
    const product = await redeemed('2단계')
    const detailPath = PATHS.product(product.productId)

    // ── 1차 시도: 취소 없이 삭제 → CONFLICT
    const before = await (await get(detailPath, jar)).text()
    const deleteId = actionIdOf('deleteProductAction')
    const blocked = await submitAction(detailPath, jar, formFieldsFor(before, deleteId))

    expect(blocked.status).toBe(200) // 리다이렉트가 아니다 — 지워지지 않았다
    const blockedHtml = await blocked.text()
    expect(blockedHtml).toContain('상환 실적이 있는 상품은 삭제할 수 없다')
    // 문구가 가리키는 다음 행동이 **같은 문서에 있다**(컷 5에서는 없었다).
    expect(blockedHtml).toContain('상환을 취소한다')
    // 상품은 그대로다.
    expect((await get(detailPath, jar)).status).toBe(200)

    // ── 2차: 상환 취소 → 보유중으로 돌아간다
    const cancelId = actionIdOf('deleteRedemptionAction')
    const cancelled = await submitAction(
      detailPath,
      jar,
      formFieldsFor(await (await get(detailPath, jar)).text(), cancelId),
    )
    expect(cancelled.status).toBe(200)
    const cancelledHtml = await cancelled.text()
    expect(cancelledHtml).toContain('상환을 취소했다')

    const active = await (await get(detailPath, jar)).text()
    expect(active).toContain(STATUS_LABELS.ACTIVE)
    expect(active).not.toContain('>상환 실적<')
    // 상환 처리 링크가 돌아왔다 — 상태가 실제로 되돌아갔다는 뜻이다.
    expect(active).toContain(`href="${PATHS.productRedeem(product.productId)}"`)

    // ── 3차: 이제 삭제가 성공한다
    const deleted = await submitAction(
      detailPath,
      jar,
      formFieldsFor(active, actionIdOf('deleteProductAction')),
    )
    expect([302, 303]).toContain(deleted.status)
    expect(locationPath(deleted)).toBe(PATHS.products)
    expect((await get(detailPath, jar)).status).toBe(404)
  })

  it('두 확인 문구가 서로 다른 것을 말한다 — §5.5', async () => {
    // 첫 단계는 「이 해의 금융소득이 바뀐다」, 둘째는 「상품이 사라진다」.
    const product = await redeemed('문구')
    const html = await (await get(PATHS.product(product.productId), jar)).text()

    expect(html).toContain('이 해의 금융소득이 바뀐다')
    expect(html).toContain('되돌릴 수 없다')
    // 취소 폼이 상환 id를 나른다 — 두 계약이 상품이 아니라 상환을 받는다(§5.5).
    expect(inputNamesOf(html)).toContain(REDEMPTION_ID_FIELD)
  })

  it('타인에게는 상환 액션이 없다 — ST-04', async () => {
    const product = await redeemed('타인')
    const otherJar = await authenticatedJar(ITG_USER_B)
    const html = await (await get(PATHS.product(product.productId), otherJar)).text()

    // 읽기는 된다.
    expect(html).toContain('>상환 실적<')
    // 액션은 없다.
    expect(html).not.toContain('상환 실적 저장')
    expect(html).not.toContain('상환을 취소한다')
  })
})

describe('★ `supabase/dev/` 표본의 상환 상태를 앱으로 만들 수 있는가 (④⑦⑧⑫)', () => {
  /**
   * ★ **계획의 질문에 실측으로 답한다.**
   *
   * 컷 4b의 인계는 「표본 12건 중 ④⑦⑧⑫는 상환·KI 계약이 화면을 얻는 컷 6 이후」라고
   * 적었다. 그 넷은 `supabase/dev/01_sample_portfolio.sql`이 **직접 SQL로** 만드는
   * 것들이다 — `create_els_product`의 페이로드에 `kiTouchedAt`도 상환도 없기 때문이다.
   *
   * | 표본 | 무엇 | 어디서 확인되는가 |
   * |---|---|---|
   * | ④ | `ki_touched_at` 설정 | 아래 「KI 터치 확정」의 케이스 |
   * | ⑦ | `EARLY` + 차수 | 이 절의 첫 케이스 |
   * | ⑧ | `MATURITY_LOSS` · 과세소득 0 · 실현손익 음수 | 두 번째 |
   * | ⑫ | `MATURITY_GAIN` · **확정값 아님** | 세 번째 |
   *
   * 네 상태가 전부 화면으로 도달 가능하면 그 파일의 §3(직접 SQL)이 **유일한 경로가
   * 아니게 된다.** 그 사실이 파일을 지울 이유가 되는지는 별 판단이며 계획 인계에 적는다 —
   * 여기서 고정하는 것은 **도달 가능성**뿐이다.
   */
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('⑦ 조기상환 + 차수 — 채워진 기본값을 그대로 저장한다', async () => {
    /*
     * 표본 ⑦은 `EARLY` + `round_no = 1`이다. 화면에서는 **아무것도 고치지 않고**
     * 저장하는 것이 그 형태가 된다 — 판정이 유형과 차수를 채우기 때문이다. 그래서
     * 이 케이스는 두 가지를 함께 본다: ⑦의 도달 가능성과 「기본값이 그대로 저장된다」.
     */
    const product = await registerProduct(jar, { label: '조기' })
    const redeemPath = PATHS.productRedeem(product.productId)

    // 실수령액·과세소득도 판정이 채운 값 그대로다 — 아무 칸도 덮어쓰지 않는다.
    const html = await (await get(redeemPath, jar)).text()
    const saved = await submitAction(
      redeemPath,
      jar,
      formValuesFor(html, actionIdOf('redemptionFormAction')),
    )
    expect([302, 303]).toContain(saved.status)

    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain(REDEMPTION_TYPE_LABELS.EARLY)
    // 차수가 실렸다 — I-13의 복합 FK가 그 차수의 실재를 요구한다.
    expect(detail).toMatch(/\d차/)
    expect(detail).toContain(STATUS_LABELS.REDEEMED)
  })

  it('⑧ 만기손실 — 과세소득 0 · 실현손익 음수 (I-08)', async () => {
    /*
     * 표본 ⑧의 성질 둘. 과세 금융소득이 0이어야 하고(V-12·I-08·절대 규칙 #8)
     * 실현손익이 **음수**로 표시되어야 한다(`signedWon`). 후자는 표시 계층의
     * 성질이므로 화면에서만 확인된다 — 계약은 `realizedPnl`을 문자열로 줄 뿐이다.
     */
    const product = await registerProduct(jar, { label: '만기손실' })
    const redeemPath = PATHS.productRedeem(product.productId)

    const saved = await submitRedemption(redeemPath, jar, 'redemptionFormAction', {
      redemptionType: 'MATURITY_LOSS',
      roundNo: '',
      redemptionDate: `${product.issueDate.slice(0, 4)}-07-02`,
      grossAmount: '62,000,000',
      taxableIncome: '0',
      withholdingTax: '',
      isConfirmed: 'on',
      note: '기초자산이 만기 배리어를 하회했다.',
    })
    expect([302, 303]).toContain(saved.status)

    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain(REDEMPTION_TYPE_LABELS.MATURITY_LOSS)
    /*
     * 실현손익 = 62,000,000 − 123,456,789,012,345. **기대값을 손으로 적지 않는다** —
     * 표기는 포매터가 정하고, 실제로 손으로 적었다가 부호 문자를 틀렸다(`−`는
     * U+2212이고 `signedWon`은 ASCII `-`를 쓴다). 다른 파일들이 같은 이유로
     * `percent(percentToRatio(...))`를 쓴다.
     */
    expect(detail).toContain(signedWon('-123456727012345'))
    // 과세 금융소득은 0이다 — 음수가 될 수 없다(절대 규칙 #8). 원천징수도 0×15.4% = 0.
    expect(detail).toContain(`>${won('0')}<`)
  })

  it('⑫ 만기이익 · 확정값 아님 — ST-05가 두 무게를 가른다', async () => {
    const product = await registerProduct(jar, { label: '미확정' })
    const redeemPath = PATHS.productRedeem(product.productId)

    const saved = await submitRedemption(redeemPath, jar, 'redemptionFormAction', {
      ...maturityGain(`${product.issueDate.slice(0, 4)}-07-02`),
      isConfirmed: '', // 체크하지 않는다 → 추정값이다
      note: '지급명세서 미수령 — 추정값이다.',
    })
    expect([302, 303]).toContain(saved.status)

    const detail = await (await get(PATHS.product(product.productId), jar)).text()
    expect(detail).toContain('추정값 — 지급명세서 미확인')
    expect(detail).not.toContain('>확정값<')
  })
})

describe('SCR-202 KI 터치 확정 (§5.9)', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('★ 확정과 해제가 같은 폼의 값으로 갈린다', async () => {
    /*
     * ★ 해제는 버튼이 아니라 **빈 값**이다. `''`를 계약에 그대로 넘기면 「YYYY-MM-DD
     * 형식으로 입력한다」가 되어 해제할 방법이 없어지므로, 그 변환(`parseTouchedAtForm`)이
     * 실제로 지나는지를 여기서 본다 — 상시 스위트는 함수만 보고 화면이 그것을 쓰는지는
     * 보지 못한다.
     *
     * `registerProduct`는 KI 배리어 50%를 넣으므로 이 폼이 렌더된다(노낙인이면 없다).
     */
    const product = await registerProduct(jar, { label: 'KI' })
    const detailPath = PATHS.product(product.productId)
    const touched = '2026-06-15'

    const set = await submitRedemption(detailPath, jar, 'setKiTouchedAction', {
      kiTouchedAt: touched,
    })
    expect(set.status).toBe(200)
    expect(await set.text()).toContain('KI 터치를 확정했다')

    let detail = await (await get(detailPath, jar)).text()
    expect(detail).toContain(korDate(touched))
    expect(detail).not.toContain('미확정')

    // 비우고 저장하면 해제된다.
    const cleared = await submitRedemption(detailPath, jar, 'setKiTouchedAction', {
      kiTouchedAt: '',
    })
    expect(cleared.status).toBe(200)
    expect(await cleared.text()).toContain('KI 터치를 해제했다')

    detail = await (await get(detailPath, jar)).text()
    expect(detail).toContain('미확정')
  })
})
