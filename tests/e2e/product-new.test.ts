import { beforeAll, describe, expect, it } from 'vitest'

import { productDefaults } from '@/lib/forms/defaults'
import {
  PENDING_PARTS,
  PRODUCT_STEPS,
  STEP_FIELD,
  STEP_NAMES,
  carryNames,
  type RowCounts,
  type StepId,
} from '@/lib/forms/steps'
import { PATHS } from '@/lib/routes/paths'

import {
  actionIdOf,
  buttonField,
  formFieldsFor,
  formHtmlFor,
  inputNamesOf,
  submitAction,
} from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-204 ① ② — **단계 전이가 Next를 지나야 존재한다** (P4 컷 4a)
 *
 * ## 여기서만 보이는 것
 *
 * 상시 스위트가 전이 규칙(`lib/forms/steps.ts`)을 전수로 본다. 그런데 그 규칙이
 * **화면에 닿는지**는 렌더된 문서에만 있다 — 특히 셋이다.
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | 선언된 이름이 전부 DOM에 있다 | 렌더도 이송도 되지 않는 이름은 저장할 때까지 증상이 없다 |
 * | 값이 단계를 건너 살아 있다 | `carryNames`가 옳아도 컴포넌트가 그리지 않으면 사라진다 |
 * | 버튼이 JS 없이 동작한다 | `intent`는 버튼의 `value`다. 컷 1b가 실측한 함정의 네 배다 |
 *
 * 브라우저는 쓰지 않는다(`helpers/actions.ts`) — 서버가 렌더한 `$ACTION_*` 히든
 * 필드를 복제하면 JS 없는 폼 제출과 같은 요청이 된다.
 *
 * ## 이 스위트는 DB 상태를 전제하지 않는다
 *
 * ②의 자산 목록은 「있으면 고른다 / 없으면 등록한다」 두 갈래이므로 건수 단언을
 * 두지 않는다. 자산을 **만드는** 경로는 이 화면 안에 있으므로(§5.10, ST-02) 그것을
 * 실행해 확인한다 — 이름에 타임스탬프를 붙이고 정리는 `db:reset`이 한다
 * (`prices.test.ts`와 같은 규율. 자산에는 삭제 계약이 없다).
 */

const STAMP = String(Date.now()).slice(-6)
const ASSET_NAME = `e2e등록${STAMP}`

/** 값이 살아 있는지 보는 픽스처. **`+ 등록` 직후의 ①이 전부 비어 있음**과 갈린다 */
const BASIC = {
  name: `[E2E] 단계상품${STAMP}`,
  issuer: 'E2E증권',
  issueDate: '2026-01-02',
  principal: '100,000,000',
  accountType: 'GENERAL',
  note: '단계 이송 확인',
}

const ONE_ROW: RowCounts = { underlyings: 1, rounds: 0 }

describe('SCR-204 단계 폼', () => {
  let jar: ReturnType<typeof cookieJar>
  let actionId: string

  beforeAll(async () => {
    jar = await authenticatedJar()
    actionId = actionIdOf('productFormAction')
  })

  it('①로 서고 네 단계가 보인다', async () => {
    const res = await get(PATHS.productNew, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('ELS 등록')
    for (const step of PRODUCT_STEPS) {
      expect(html, `${step.ordinal} ${step.title}`).toContain(
        `${step.ordinal} ${step.title}`,
      )
    }
    // 첫 단계가 활성이다 — `aria-current`가 그 표시다.
    expect(html).toMatch(/aria-current="step"[^>]*>①/)
  })

  it('①이 선언한 이름이 전부 DOM에 있다', async () => {
    /*
     * ★ `STEP_NAMES`가 정본이고 컴포넌트가 그것을 그린다. 한쪽에만 칸을 추가하면
     * 그 값은 **다음 단계로 가면 사라지고** 저장 버튼을 누를 때까지 증상이 없다.
     * 그래서 좌변을 순수 모듈에서 읽어 온다 — 테스트에 이름을 다시 적으면 목록이
     * 세 번째 사본이 된다.
     */
    const form = formHtmlFor(await (await get(PATHS.productNew, jar)).text(), actionId)
    const rendered = inputNamesOf(form)

    for (const name of STEP_NAMES.BASIC(ONE_ROW)) {
      expect(rendered, `①의 ${name}`).toContain(name)
    }
    // 나머지 단계의 이름은 히든으로 실린다 — 합집합이 폼의 전체 이름이다.
    for (const name of carryNames(ONE_ROW, 'BASIC')) {
      expect(rendered, `이송된 ${name}`).toContain(name)
    }
  })

  it('기본값이 화면에 닿는다 — 평가주기 6', async () => {
    // DOC-005 §3이 「통상 6」으로 등재한 유일한 기본값이다. 히든으로 실려야 한다.
    const form = formHtmlFor(await (await get(PATHS.productNew, jar)).text(), actionId)
    const tag = /<input[^>]*name="evaluationPeriodMonths"[^>]*>/.exec(form)?.[0] ?? ''
    expect(tag).toContain(`value="${productDefaults().evaluationPeriodMonths}"`)
  })

  it('①에서 적은 값이 ②로 살아서 넘어간다', async () => {
    const html = await (await get(PATHS.productNew, jar)).text()

    const res = await submitAction(PATHS.productNew, jar, [
      ...formFieldsFor(html, actionId),
      ...Object.entries(BASIC),
      // ★ 의도를 손으로 적지 않는다 — 렌더된 버튼에서 읽는다(helpers/actions.ts 각주).
      buttonField(formHtmlFor(html, actionId), 'NEXT'),
    ])
    expect(res.status).toBe(200)
    const next = await res.text()

    // ②가 활성이다.
    expect(next).toMatch(/aria-current="step"[^>]*>②/)
    expect(next).toContain('기초자산 1')

    /*
     * ★ 값이 **히든으로** 남아 있다. 여기서 이름별로 확인하는 이유는 문서 전체에
     * 대한 `toContain`이 다른 자리(예: 상단 안내 문구)에 맞을 수 있기 때문이다.
     */
    const form = formHtmlFor(next, actionId)
    for (const [name, value] of Object.entries(BASIC)) {
      const tag = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(form)?.[0] ?? ''
      expect(tag, `${name}이 이송되지 않았다`).toContain('type="hidden"')
      // 쉼표는 그대로 남는다 — 파서가 지우고 표시는 원문을 보존한다.
      expect(tag, `${name}의 값`).toContain(`value="${value}"`)
    }
    expect(form).toContain(`value="UNDERLYINGS"`)
  })

  it('행 추가·삭제가 제출로 동작한다 — 삭제는 뒤의 행을 당긴다', async () => {
    const first = await (await get(PATHS.productNew, jar)).text()

    // ② 단계로 이동
    const atSecond = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(first, actionId),
        buttonField(formHtmlFor(first, actionId), 'NEXT'),
      ])
    ).text()

    // 행 추가 — 1행 → 2행. 첫 행에 값을 남겨 두고 두 번째 행을 만든다.
    const added = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(atSecond, actionId),
        ['underlyings[0].basePrice', '111'],
        buttonField(formHtmlFor(atSecond, actionId), 'ADD_UNDERLYING'),
      ])
    ).text()
    expect(added).toContain('기초자산 2')

    // 첫 행 삭제 — 두 번째 행의 값이 첫 행으로 당겨진다.
    const removed = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(added, actionId),
        ['underlyings[0].basePrice', '111'],
        ['underlyings[1].basePrice', '222'],
        buttonField(formHtmlFor(added, actionId), 'REMOVE_UNDERLYING:0'),
      ])
    ).text()

    expect(removed).not.toContain('기초자산 2')
    const form = formHtmlFor(removed, actionId)
    const tag = /<input[^>]*name="underlyings\[0\]\.basePrice"[^>]*>/.exec(form)?.[0] ?? ''
    expect(tag, '삭제가 뒤의 행을 당기지 않았다').toContain('value="222"')
  })

  it('②에서 자산을 등록하면 그 목록에 나타난다 — ST-02의 다음 행동', async () => {
    /*
     * 빈 상태의 다음 행동이 **그 자리의 폼**이다(SCR-302 v0.3이 순환을 끊은 것과
     * 같은 이유). 폼 중첩이 불가하므로 자산 등록은 상품 폼의 **형제**이며, 그래서
     * 두 폼이 한 문서에 있다 — 액션 id로 골라야 순서에 의존하지 않는다.
     */
    const atFirst = await (await get(PATHS.productNew, jar)).text()
    const atSecond = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(atFirst, actionId),
        buttonField(formHtmlFor(atFirst, actionId), 'NEXT'),
      ])
    ).text()

    const createAssetId = actionIdOf('createAssetAction')
    expect(atSecond).not.toContain(ASSET_NAME)

    const after = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(atSecond, createAssetId),
        ['name', ASSET_NAME],
        ['assetType', 'INDEX'],
        ['currency', 'KRW'],
      ])
    ).text()

    expect(after).toContain('자산을 등록했다.')
    // 새 문서에서도 목록에 있다 — 선택 상자의 옵션으로 나온다.
    const reloaded = await (await get(PATHS.productNew, jar)).text()
    const nextStep = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(reloaded, actionId),
        buttonField(formHtmlFor(reloaded, actionId), 'NEXT'),
      ])
    ).text()
    expect(nextStep).toContain(ASSET_NAME)
    expect(nextStep).toMatch(
      new RegExp(`<option value="[0-9a-f-]{36}">${ASSET_NAME}`),
    )
  })

  it('③④는 아직 없다 — 원장이 그 사실을 들고 있다', async () => {
    /*
     * ★ **컷 4b가 이 단언을 빨간불로 만든다.** `PENDING_PARTS`에서 조각을 지우면
     * 여기가 실패해 「이제 화면을 붙여라」고 말한다 — `NOT_YET_BUILT` 원장과 같은
     * 형태이며, 문구를 테스트에 적지 않고 원장에서 읽으므로 사본이 생기지 않는다.
     */
    let html = await (await get(PATHS.productNew, jar)).text()
    for (const step of ['UNDERLYINGS', 'CONDITIONS', 'CONFIRM'] as StepId[]) {
      html = await (
        await submitAction(PATHS.productNew, jar, [
          ...formFieldsFor(html, actionId),
          buttonField(formHtmlFor(html, actionId), 'NEXT'),
        ])
      ).text()

      const pending = PENDING_PARTS[step]
      if (pending == null) continue
      expect(html, `${step}의 자리표시`).toContain(pending)
    }

    // ④에는 저장이 없다. 그 사실도 원장이 정한다.
    expect(html).toMatch(/aria-current="step"[^>]*>④/)
    if (PENDING_PARTS.SUBMIT != null) {
      expect(html).toContain(PENDING_PARTS.SUBMIT)
      expect(html).not.toContain('value="SUBMIT"')
    }
  })

  it('조작된 단계·의도가 폼을 막지 않는다', async () => {
    const html = await (await get(PATHS.productNew, jar)).text()
    const res = await submitAction(PATHS.productNew, jar, [
      ...formFieldsFor(html, actionId).filter(([name]) => name !== STEP_FIELD),
      [STEP_FIELD, 'ZZZ'],
      ['intent', 'DROP TABLE'],
    ])

    expect(res.status).toBe(200)
    // 인식하지 못한 단계는 ①이고 인식하지 못한 의도는 아무것도 하지 않는다.
    expect(await res.text()).toMatch(/aria-current="step"[^>]*>①/)
  })
})
