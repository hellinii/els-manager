import { beforeAll, describe, expect, it } from 'vitest'

import { korDate, won } from '@/lib/format'
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
  formValuesFor,
  inputNamesOf,
  submitAction,
} from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-204 — **단계 전이와 저장이 Next를 지나야 존재한다** (P4 컷 4a·4b)
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

  /** 한 단계 제출. 의도는 **렌더된 버튼에서** 읽는다 */
  async function step(
    html: string,
    actionId2: string,
    intent: string,
    fields: Record<string, string>,
  ): Promise<string> {
    const res = await submitAction(PATHS.productNew, jar, [
      // 브라우저가 보내는 것과 같다 — 히든만 보내면 그 단계의 값이 사라진다.
      ...formValuesFor(html, actionId2),
      ...Object.entries(fields),
      buttonField(formHtmlFor(html, actionId2), intent),
    ])
    expect(res.status, `${intent} 제출`).toBe(200)
    return res.text()
  }

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

  it('네 단계가 전부 서 있다 — 원장이 비었다 (컷 4b)', async () => {
    /*
     * ★ **컷 4a에서 이 케이스는 「③④는 아직 없다」였다.** `PENDING_PARTS`에서 조각을
     * 지우자 빨간불이 되어 「이제 화면을 붙여라」고 말했고, 붙인 뒤 반대 방향으로
     * 고쳤다 — 각 단계가 자기 칸을 렌더하고 ④에 저장 버튼이 있다.
     *
     * 원장을 참조하는 형태는 유지한다: 다음에 화면 안의 조각을 미루는 컷이 오면
     * 표가 다시 채워지고 이 단언이 그 사실을 요구한다.
     */
    expect(PENDING_PARTS).toEqual({})

    let html = await (await get(PATHS.productNew, jar)).text()
    for (const id of ['UNDERLYINGS', 'CONDITIONS', 'CONFIRM'] as StepId[]) {
      html = await step(html, actionId, 'NEXT', {})
      const rendered = inputNamesOf(formHtmlFor(html, actionId))
      // ④는 입력이 없다 — 그것도 선언된 성질이다(`STEP_NAMES.CONFIRM`이 빈 배열).
      for (const name of STEP_NAMES[id]({ underlyings: 1, rounds: 0 })) {
        expect(rendered, `${id}의 ${name}`).toContain(name)
      }
    }

    expect(html).toMatch(/aria-current="step"[^>]*>④/)
    // 저장 버튼이 의도를 나른다 — 없으면 `buttonField`가 던진다.
    expect(buttonField(formHtmlFor(html, actionId), 'SUBMIT')).toEqual(['intent', 'SUBMIT'])
  })

  it('④가 저장될 값을 보여준다 — 미리보기와 저장이 같은 함수에서 나온다', async () => {
    /*
     * DOC-008 ④는 「생성될 평가일정 미리보기 후 저장」이다. 화면과 파서가
     * `previewDatesOf` 하나를 같은 값에 부르므로 「확인 화면에서 본 것과 다른 것이
     * 저장된다」가 구조적으로 불가능하다 — 그 성질을 여기서 실행으로 본다.
     */
    const actionId2 = actionIdOf('productFormAction')
    let html = await (await get(PATHS.productNew, jar)).text()

    html = await step(html, actionId2, 'NEXT', {
      name: `[E2E] 미리보기${STAMP}`,
      issueDate: '2026-01-31', // 말일 — 클램핑이 보이는 날짜다
      principal: '10,000,000',
      accountType: 'GENERAL',
    })
    html = await step(html, actionId2, 'NEXT', {}) // ② 건너뛴다(자산은 저장 때 본다)
    html = await step(html, actionId2, 'APPLY_BARRIERS', {
      evaluationPeriodMonths: '1',
      totalRounds: '',
      annualCouponRate: '8',
      barriers: '0.9/0.85',
    })

    // SQ-04 — 소수로 읽어 퍼센트로 바꿨고 총 차수를 개수로 채웠다.
    expect(html).toContain('소수로 읽어')
    const conditions = formHtmlFor(html, actionId2)
    expect(/<input[^>]*name="totalRounds"[^>]*>/.exec(conditions)?.[0]).toContain(
      'value="2"',
    )
    expect(
      /<input[^>]*name="schedules\[0\]\.barrier"[^>]*>/.exec(conditions)?.[0],
    ).toContain('value="90"')

    html = await step(html, actionId2, 'NEXT', {})
    expect(html).toMatch(/aria-current="step"[^>]*>④/)

    // 말일 클램핑이 미리보기에 보인다 — 1/31 + 1개월 = 2/28 (2026년은 평년)
    expect(html).toContain(korDate('2026-02-28'))
    expect(html).toContain(korDate('2026-03-31'))
    // 금액은 쉼표를 지운 뒤 표준 표기로 보인다.
    expect(html).toContain(won('10000000'))
  })

  it('검증 실패는 그 오류가 있는 단계로 되돌린다', async () => {
    /*
     * ★ ④에서 저장했는데 오류가 ①에 있으면 사용자는 그 문구를 **볼 수 없다**(그 칸이
     * 히든이다) — 「저장이 안 되는데 아무 표시도 없다」의 단계 폼 버전이다.
     * `stepForErrors`가 가장 앞 단계를 고르고 어댑터가 그 단계로 값을 옮긴다.
     *
     * 픽스처는 **상품명을 비운다**(V-19). ①의 칸이며 ④에서 제출하므로 두 구현이
     * 갈린다: 되돌리지 않으면 ④가 그대로 렌더되고 오류 문구가 어디에도 없다.
     */
    const actionId2 = actionIdOf('productFormAction')
    let html = await (await get(PATHS.productNew, jar)).text()

    html = await step(html, actionId2, 'NEXT', { name: '', accountType: 'GENERAL' })
    html = await step(html, actionId2, 'NEXT', {})
    html = await step(html, actionId2, 'APPLY_BARRIERS', {
      evaluationPeriodMonths: '6',
      totalRounds: '',
      annualCouponRate: '8',
      barriers: '90',
    })
    html = await step(html, actionId2, 'NEXT', {})

    const saved = await submitAction(PATHS.productNew, jar, [
      ...formValuesFor(html, actionId2),
      buttonField(formHtmlFor(html, actionId2), 'SUBMIT'),
    ])
    expect(saved.status).toBe(200) // 오류는 결과 객체다 — 화면을 갈아치우지 않는다
    const rendered = await saved.text()

    // ①로 되돌아왔고 그 칸에 오류가 붙었다.
    expect(rendered).toMatch(/aria-current="step"[^>]*>①/)
    expect(rendered).toContain('id="name-error"')
    // 입력값 보존 — 다른 단계의 값은 히든으로 남아 있다(W-03의 존재 이유).
    expect(formHtmlFor(rendered, actionId2)).toContain('value="90"')
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
