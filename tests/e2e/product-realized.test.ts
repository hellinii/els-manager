import { beforeAll, describe, expect, it } from 'vitest'

import { REALIZED_FIELDS } from '@/lib/forms/realized'
import { PATHS } from '@/lib/routes/paths'

import {
  actionIdOf,
  formFieldsFor,
  formHtmlFor,
  inputNamesOf,
  submitAction,
} from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-205 기실현 등재 — **Next를 지나야 존재하는 것만** (P6 컷 5)
 *
 * 상시 스위트가 폼 규칙(`lib/forms/realized.ts`)과 파서를, 통합 스위트가 계약 왕복을
 * 이미 전수로 본다. 여기 남는 것은 넷이다.
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | 라우트가 실재하고 200을 낸다 | 새 라우트의 404는 다른 층에서 보이지 않는다 |
 * | 선언된 이름이 전부 DOM에 있다 | 선언만 하고 렌더하지 않은 칸은 저장할 때까지 증상이 없다 |
 * | **없어야 하는 칸이 없다** | 남아 있으면 사용자 입력이 조용히 버려진다 |
 * | 저장이 리다이렉트로 끝난다 | `redirect()`의 303은 실 HTTP 응답에만 있다 |
 *
 * **미인증 307은 `proxy.test.ts`가 본다** — 그 파일이 매처 축의 정본이므로 경로 목록을
 * 여기서 복제하지 않는다.
 *
 * ## `formValuesFor`가 아니라 `formFieldsFor`(히든만)로 조립한다
 *
 * **실측으로 정한 것이다.** `formValuesFor`는 렌더된 **모든** 칸을 그 값(신규 폼이므로
 * 전부 `''`)으로 내고, `submitAction`이 `body.append`를 쓰므로 뒤에 덧붙인 값과 **중복
 * 키**가 된다 — 그리고 파서의 `text()`는 `form.get()`이라 **첫 값이 이긴다.** 즉 빈
 * 문자열이 이겨서 저장이 「상품명을 입력한다 · 계좌유형을 선택한다 …」 여덟 칸 오류로
 * 200을 돌려준다(그 응답 본문을 직접 찍어 확인했다). 이 폼에는 액션 히든 외의 히든이
 * 없으므로 `formFieldsFor` + 명시한 값이 **브라우저 제출과 정확히 같은 집합**이다.
 *
 * ## `beforeAll`이 아무것도 만들지 않는다
 *
 * 계약 조건을 입력받지 않으므로 자산도 상품도 필요 없다 — **폼 스위트 중 유일하다.**
 * 그 부재가 SCR-204와 갈리는 자리의 관측이기도 하다. 만들어지는 상품은 이름에
 * 타임스탬프를 붙이고 정리는 `db:reset`이 한다(상품 삭제 계약은 이 화면에 없다).
 */

const STAMP = String(Date.now()).slice(-6)
const NAME = `[E2E] 기실현${STAMP}`

/** 그림(사용자의 스프레드시트) 한 줄. 쉼표를 붙여 파서의 제거까지 함께 본다 */
const ROW = {
  issuer: '키움증권',
  principal: '19,390,000',
  accountType: 'GENERAL',
  redemptionType: 'EARLY',
  redemptionDate: '2026-06-04',
  grossAmount: '20,788,019',
  taxableIncome: '1,398,019',
  withholdingTax: '215,295',
  isConfirmed: 'on',
}

describe('SCR-205 기실현 등재', () => {
  let jar: ReturnType<typeof cookieJar>
  let actionId: string

  beforeAll(async () => {
    jar = await authenticatedJar()
    actionId = actionIdOf('realizedFormAction')
  })

  async function pageHtml(): Promise<string> {
    const res = await get(PATHS.productRealizedNew, jar)
    expect(res.status).toBe(200)
    return res.text()
  }

  it('라우트가 서고 입력받지 않는 것을 화면이 말한다', async () => {
    const html = await pageHtml()

    expect(html).toContain('기실현 등재')
    for (const section of ['상품 정보', '상환 실적']) {
      expect(html, section).toContain(section)
    }
    // 「없는 칸을 찾지 않게」 하는 문장 — DOC-008 SCR-205의 요구다
    expect(html).toContain('계약 조건은 입력받지 않는다')
  })

  it('★ 선언된 모든 이름이 DOM에 있고 히든이 아니다', async () => {
    const form = formHtmlFor(await pageHtml(), actionId)
    const rendered = inputNamesOf(form)

    for (const name of REALIZED_FIELDS) {
      expect(rendered, `${name}이 렌더되지 않았다`).toContain(name)
      const tag =
        new RegExp(`<(?:input|select|textarea)[^>]*name="${name}"[^>]*>`).exec(form)?.[0] ??
        ''
      expect(tag, `${name}이 히든이다`).not.toContain('type="hidden"')
    }
  })

  /**
   * ★★ **없어야 하는 칸이 없는 것을 여기서 본다.**
   *
   * 계약 타입에 없고 파서도 읽지 않지만, **폼에 그 칸이 남아 있으면** 사용자가 값을
   * 넣고 그것이 조용히 버려진다 — 「입력했는데 저장되지 않았다」가 되고 어느 층도
   * 그 사실을 말하지 않는다. 상시 스위트는 `REALIZED_FIELDS`만 보므로 컴포넌트가
   * 목록 밖의 칸을 그려도 초록이다.
   */
  it('차수 칸과 계약 조건 칸이 DOM에 없다', async () => {
    const rendered = inputNamesOf(formHtmlFor(await pageHtml(), actionId))

    for (const absent of [
      'roundNo',
      'issueDate',
      'annualCouponRate',
      'evaluationPeriodMonths',
      'totalRounds',
      'kiBarrier',
      'kiObservation',
    ]) {
      expect(rendered, `${absent} 칸이 남아 있다`).not.toContain(absent)
    }
  })

  it('저장이 상세로 리다이렉트하고 그 화면이 기실현임을 말한다', async () => {
    const html = await pageHtml()

    const res = await submitAction(PATHS.productRealizedNew, jar, [
      ...formFieldsFor(html, actionId),
      ['name', NAME],
      ...Object.entries(ROW),
    ])

    expect(res.status, '저장이 리다이렉트로 끝나지 않았다').toBe(303)
    const location = res.headers.get('location') ?? ''
    expect(location).toMatch(/^\/products\/[0-9a-f-]{36}$/)

    const detail = await get(location, jar)
    expect(detail.status).toBe(200)
    const detailHtml = await detail.text()

    expect(detailHtml).toContain(NAME)
    // DOC-008 SCR-205 — 결함의 「수정 필요」와 다른 말이어야 한다
    expect(detailHtml).toContain('기실현 등재')
    expect(detailHtml).not.toContain('수정 필요')
    // 쉼표가 제거되어 저장됐다 — 19,390,000원이 그대로 보인다
    expect(detailHtml).toContain('19,390,000')
  })

  it('검증 실패는 입력값과 함께 돌아온다 (§6)', async () => {
    const html = await pageHtml()
    const failName = `${NAME}-실패`

    const res = await submitAction(PATHS.productRealizedNew, jar, [
      ...formFieldsFor(html, actionId),
      ['name', failName],
      ...Object.entries({ ...ROW, principal: '0' }), // V-01 위반
    ])

    expect(res.status).toBe(200)
    const body = await res.text()
    // 입력값 보존 — 상품명이 그대로 돌아온다
    expect(body).toContain(failName)
  })
})
