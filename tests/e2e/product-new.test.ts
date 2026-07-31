import { beforeAll, describe, expect, it } from 'vitest'

import { productDefaults } from '@/lib/forms/defaults'
import {
  PENDING_PARTS,
  productFieldNames,
  type RowCounts,
} from '@/lib/forms/productForm'
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
 * SCR-204 — **폼의 조작과 저장이 Next를 지나야 존재한다** (P4 컷 4a·4b, P6 컷 1)
 *
 * ## 여기서만 보이는 것
 *
 * 상시 스위트가 폼 규칙(`lib/forms/productForm.ts`)을 전수로 본다. 그런데 그 규칙이
 * **화면에 닿는지**는 렌더된 문서에만 있다 — 셋이다.
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | 선언된 이름이 전부 DOM에 있다 | 선언만 하고 렌더하지 않은 칸은 저장할 때까지 증상이 없다 |
 * | 버튼이 JS 없이 동작한다 | `intent`는 버튼의 `value`다(컷 1b가 실측한 함정) |
 * | 저장이 리다이렉트로 끝난다 | `redirect()`의 303은 실 HTTP 응답에만 있다 |
 *
 * 브라우저는 쓰지 않는다(`helpers/actions.ts`) — 서버가 렌더한 `$ACTION_*` 히든
 * 필드를 복제하면 JS 없는 폼 제출과 같은 요청이 된다.
 *
 * ## 단계 축이 사라졌다 (P6 컷 1, DOC-008 v1.8)
 *
 * 종전에는 케이스 대부분이 ①→②→③→④를 걸었다. 단일 페이지가 되면서 그 걸음이
 * 사라지고 **각 케이스가 짧아졌다** — 「값이 단계를 건너 살아 있다」는 축은 축 자체가
 * 없어졌다(이송할 것이 없다).
 *
 * 대신 **새 축 하나가 생겼다**: 차수표는 마지막으로 제출된 총 차수를 보고 그려지므로
 * 강제되는 제출이 없는 단일 페이지에서는 「전부 타이핑 → 저장」이 보이지 않는 칸의
 * 오류가 될 수 있다. 저장 제출이 일괄 칸을 스스로 펼치는 것이 그 답이고, 그 경로를
 * 아래 「저장이 일괄 칸을 스스로 펼친다」가 실행으로 본다.
 *
 * ## 이 스위트는 DB 상태를 전제하지 않는다
 *
 * 자산 목록은 「있으면 고른다 / 없으면 등록한다」 두 갈래이므로 건수 단언을 두지
 * 않는다. 자산을 **만드는** 경로는 이 화면 안에 있으므로(§5.10, ST-02) 그것을 실행해
 * 확인한다 — 이름에 타임스탬프를 붙이고 정리는 `db:reset`이 한다(`prices.test.ts`와
 * 같은 규율. 자산에는 삭제 계약이 없다).
 */

const STAMP = String(Date.now()).slice(-6)
const ASSET_NAME = `e2e등록${STAMP}`

/** 값이 살아 있는지 보는 픽스처 */
const BASIC = {
  name: `[E2E] 한페이지${STAMP}`,
  issuer: 'E2E증권',
  issueDate: '2026-01-02',
  principal: '100,000,000',
  accountType: 'GENERAL',
  note: '단일 페이지 확인',
}

const ONE_ROW: RowCounts = { underlyings: 1, rounds: 0 }

describe('SCR-204 단일 페이지 폼', () => {
  let jar: ReturnType<typeof cookieJar>
  let actionId: string

  beforeAll(async () => {
    jar = await authenticatedJar()
    actionId = actionIdOf('productFormAction')
  })

  /** 한 번 제출. 의도는 **렌더된 버튼에서** 읽는다 */
  async function submit(
    html: string,
    intent: string,
    fields: Record<string, string>,
  ): Promise<string> {
    const res = await submitAction(PATHS.productNew, jar, [
      // 브라우저가 보내는 것과 같다 — 히든만 보내면 보이는 칸의 값이 사라진다.
      ...formValuesFor(html, actionId),
      ...Object.entries(fields),
      buttonField(formHtmlFor(html, actionId), intent),
    ])
    expect(res.status, `${intent} 제출`).toBe(200)
    return res.text()
  }

  it('세 구획이 한 문서에 있고 번호가 없다', async () => {
    const res = await get(PATHS.productNew, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('ELS 등록')
    for (const title of ['기본 정보', '기초자산', '평가 조건']) {
      expect(html, title).toContain(title)
    }

    /*
     * ★ **음성 대조.** 번호(①②③④)와 단계 표시가 사라졌음을 요구한다 — 이 단언이
     * 없으면 단계 셸이 되살아나도 위의 세 제목 단언은 그대로 초록이다. `aria-current`
     * 는 단계 표시기의 표식이었고 이 화면에 다른 용도가 없다.
     */
    for (const ordinal of ['①', '②', '③', '④']) {
      expect(html, `${ordinal}가 남아 있다`).not.toContain(ordinal)
    }
    expect(html).not.toContain('aria-current="step"')
  })

  it('★ 선언된 모든 이름이 DOM에 있고 히든이 아니다', async () => {
    /*
     * ★ `productFieldNames`가 정본이고 컴포넌트가 그것을 그린다. 한쪽에만 칸을
     * 추가하면 계약의 오류가 그 칸에 붙지 않는다. 그래서 좌변을 순수 모듈에서 읽어
     * 온다 — 테스트에 이름을 다시 적으면 목록이 세 번째 사본이 된다.
     *
     * ★★ **「히든이 아니다」가 이 컷의 새 단언이다.** 종전에는 활성 단계의 것만 진짜
     * 컨트롤이고 나머지는 히든이었다(`carryNames`). 이제 전부 진짜 컨트롤이며, 그것이
     * 「선언은 했는데 이송을 빠뜨려 조용히 값이 사라지는」 상태가 존재할 수 없는
     * 이유다. 히든으로 되돌아가면 이 단언이 빨간불이 된다.
     */
    const form = formHtmlFor(await (await get(PATHS.productNew, jar)).text(), actionId)
    const rendered = inputNamesOf(form)

    for (const name of productFieldNames(ONE_ROW)) {
      expect(rendered, `${name}이 렌더되지 않았다`).toContain(name)
      const tag = new RegExp(`<(?:input|select|textarea)[^>]*name="${name.replace(/[[\]]/g, '\\$&')}"[^>]*>`).exec(form)?.[0] ?? ''
      expect(tag, `${name}이 히든이다`).not.toContain('type="hidden"')
    }
  })

  it('기본값이 화면에 닿는다 — 평가주기 6', async () => {
    // DOC-005 §3이 「통상 6」으로 등재한 유일한 기본값이다.
    const form = formHtmlFor(await (await get(PATHS.productNew, jar)).text(), actionId)
    const tag = /<input[^>]*name="evaluationPeriodMonths"[^>]*>/.exec(form)?.[0] ?? ''
    expect(tag).toContain(`value="${productDefaults().evaluationPeriodMonths}"`)
  })

  it('행 추가·삭제가 제출로 동작한다 — 삭제는 뒤의 행을 당긴다', async () => {
    const first = await (await get(PATHS.productNew, jar)).text()

    // 행 추가 — 1행 → 2행. 첫 행에 값을 남겨 두고 두 번째 행을 만든다.
    const added = await submit(first, 'ADD_UNDERLYING', {
      'underlyings[0].basePrice': '111',
    })
    expect(added).toContain('기초자산 2')

    // 첫 행 삭제 — 두 번째 행의 값이 첫 행으로 당겨진다.
    const removed = await submit(added, 'REMOVE_UNDERLYING:0', {
      'underlyings[0].basePrice': '111',
      'underlyings[1].basePrice': '222',
    })

    expect(removed).not.toContain('기초자산 2')
    const form = formHtmlFor(removed, actionId)
    const tag = /<input[^>]*name="underlyings\[0\]\.basePrice"[^>]*>/.exec(form)?.[0] ?? ''
    expect(tag, '삭제가 뒤의 행을 당기지 않았다').toContain('value="222"')
  })

  it('자산을 등록하면 그 목록에 나타난다 — ST-02의 다음 행동', async () => {
    /*
     * 빈 상태의 다음 행동이 **그 자리의 폼**이다(SCR-302 v0.3이 순환을 끊은 것과
     * 같은 이유). 폼 중첩이 불가하므로 자산 등록은 상품 폼의 **형제**이며, 그래서
     * 두 폼이 한 문서에 있다 — 액션 id로 골라야 순서에 의존하지 않는다.
     *
     * v1.8에서 그 폼이 **항상** 문서에 있다(종전에는 ② 단계에서만 있었다). 그래서
     * 이 케이스가 단계를 지나가는 걸음 넷을 잃었다.
     */
    const before = await (await get(PATHS.productNew, jar)).text()
    const createAssetId = actionIdOf('createAssetAction')
    expect(before).not.toContain(ASSET_NAME)

    const after = await (
      await submitAction(PATHS.productNew, jar, [
        ...formFieldsFor(before, createAssetId),
        ['name', ASSET_NAME],
        ['assetType', 'INDEX'],
        ['currency', 'KRW'],
      ])
    ).text()

    expect(after).toContain('자산을 등록했다.')

    // 새 문서에서 상품 폼의 선택 상자에 그 자산이 있다 — 같은 페이지다
    const reloaded = await (await get(PATHS.productNew, jar)).text()
    expect(reloaded).toContain(ASSET_NAME)
    expect(formHtmlFor(reloaded, actionId)).toMatch(
      new RegExp(`<option value="[0-9a-f-]{36}">${ASSET_NAME}`),
    )
  })

  it('이 화면의 조각이 원장에 없고 저장 버튼이 하나다', async () => {
    /*
     * ★ 원장의 건수는 `tests/app/invalidation.test.ts`가 세 원장을 함께 세며 지키고,
     * 여기서는 **이 화면의 조각이 없다**만 요구한다(컷 5가 좁힌 범위).
     */
    const mine = Object.keys(PENDING_PARTS).filter((key) => key.startsWith('SCR-204'))
    expect(mine).toEqual([])

    const form = formHtmlFor(await (await get(PATHS.productNew, jar)).text(), actionId)

    // 저장 버튼이 의도를 나른다 — 없으면 `buttonField`가 던진다.
    expect(buttonField(form, 'SUBMIT')).toEqual(['intent', 'SUBMIT'])
    // ★ 이전·다음이 없다 — 있으면 단계 셸이 되살아난 것이다
    expect(form).not.toContain('value="NEXT"')
    expect(form).not.toContain('value="BACK"')
  })

  it('일괄 적용이 차수표를 채우고 평가일이 규약대로 생성된다', async () => {
    /*
     * SQ-04 — 일괄 칸은 채우는 도구이고 정본은 차수별 칸이다. 그리고 화면과 파서가
     * `previewDatesOf` 하나를 같은 값에 부르므로 「본 것과 다른 것이 저장된다」가
     * 구조적으로 불가능하다.
     *
     * 발행일을 **말일**로 두어 두 성질을 한 케이스에서 본다 —
     * 1/31 + 1개월 = 2/28(클램프) → −1일 = **2/27**, 그리고 + 2개월 = 3/31 → **3/30**.
     * 일 이동이 클램프보다 먼저면 2/28이 되므로 이 값이 순서까지 고정한다
     * (DOC-002 §4.8의 대조표).
     */
    const first = await (await get(PATHS.productNew, jar)).text()

    const html = await submit(first, 'APPLY_BARRIERS', {
      issueDate: '2026-01-31',
      evaluationPeriodMonths: '1',
      totalRounds: '',
      annualCouponRate: '8',
      barriers: '0.9/0.85',
    })

    // 소수로 읽어 퍼센트로 바꿨고 총 차수를 개수로 채웠다.
    expect(html).toContain('소수로 읽어')
    const form = formHtmlFor(html, actionId)
    expect(/<input[^>]*name="totalRounds"[^>]*>/.exec(form)?.[0]).toContain('value="2"')
    expect(/<input[^>]*name="schedules\[0\]\.barrier"[^>]*>/.exec(form)?.[0]).toContain(
      'value="90"',
    )

    // 차수표가 생성된 평가일을 보여준다 — 기산 규약(−1일)이 실려 있다
    expect(html).toContain('2026-02-27')
    expect(html).toContain('2026-03-30')
    // 음성 대조 — 규약이 실리지 않았다면 이 둘이 나온다
    expect(html).not.toContain('2026-02-28')
    expect(html).not.toContain('2026-03-31')
  })

  it('★ 저장이 일괄 칸을 스스로 펼친다 — 제출 한 번으로 저장된다', async () => {
    /*
     * ★★ **단일 페이지가 만든 함정을 닫는 케이스다.** 차수표는 마지막으로 제출된
     * 총 차수를 보고 그려지므로, 사용자가 전부 타이핑하고 곧바로 저장을 누르면
     * 배리어 칸이 DOM에 없다. 저장 제출이 일괄 칸을 펼치지 않으면 **보이지 않던
     * 칸에 「배리어를 입력한다」 오류가 뜬다** — 값을 다 맞게 넣었는데도.
     *
     * 단계형에서는 ③→④ 이동이 제출이라 저장 전에 표가 반드시 한 번 그려졌고 그
     * 함정이 가려져 있었다. 그래서 이것은 **여기서만 관측되는 새 성질**이다.
     *
     * 자산이 필요하므로 위 케이스가 만든 것을 쓴다(같은 파일이 순서대로 돈다).
     */
    const first = await (await get(PATHS.productNew, jar)).text()
    const assetId =
      /<option value="([0-9a-f-]{36})"/.exec(formHtmlFor(first, actionId))?.[1] ?? ''
    expect(assetId, '고를 자산이 없다 — 앞 케이스가 만들었어야 한다').toMatch(
      /^[0-9a-f-]{36}$/,
    )

    const saved = await submitAction(PATHS.productNew, jar, [
      ...formValuesFor(first, actionId),
      ...Object.entries({
        ...BASIC,
        'underlyings[0].assetId': assetId,
        'underlyings[0].basePrice': '1000',
        evaluationPeriodMonths: '6',
        // 차수표가 렌더된 적이 없다 — `schedules[*].barrier`가 DOM에 없다
        totalRounds: '3',
        annualCouponRate: '8',
        barriers: '90-85-80',
      }),
      buttonField(formHtmlFor(first, actionId), 'SUBMIT'),
    ])

    expect(
      saved.status,
      `저장이 리다이렉트로 끝나지 않았다 — 펼침이 없으면 200 + 배리어 오류다`,
    ).toBe(303)
    expect(saved.headers.get('location')).toMatch(/^\/products\/[0-9a-f-]{36}$/)
  })

  it('검증 실패는 그 칸에 오류를 붙인다 — 되돌릴 단계가 없다', async () => {
    /*
     * 종전에는 「오류가 있는 가장 앞 단계로 되돌린다」였고 그 장치는 **보이지 않는
     * 칸의 오류를 화면에 가져오는** 수단이었다. 모든 칸이 동시에 렌더되므로 보이지
     * 않는 칸이 없고, 오류는 그 자리에 붙는다.
     *
     * 픽스처는 **상품명을 비운다**(V-19). 자산도 비우므로 V-02도 함께 나온다 —
     * 종전 구현이라면 그 둘이 다른 단계에 있어 하나만 보였을 자리다.
     */
    const first = await (await get(PATHS.productNew, jar)).text()

    const saved = await submitAction(PATHS.productNew, jar, [
      ...formValuesFor(first, actionId),
      ...Object.entries({
        name: '',
        accountType: 'GENERAL',
        evaluationPeriodMonths: '6',
        totalRounds: '1',
        annualCouponRate: '8',
        barriers: '90',
      }),
      buttonField(formHtmlFor(first, actionId), 'SUBMIT'),
    ])
    expect(saved.status).toBe(200) // 오류는 결과 객체다 — 화면을 갈아치우지 않는다
    const rendered = await saved.text()

    // 오류가 그 칸에 붙었다
    expect(rendered).toContain('id="name-error"')
    // 입력값 보존 — 다른 구획의 값도 그대로다(W-03의 존재 이유)
    expect(formHtmlFor(rendered, actionId)).toContain('value="90"')
  })

  it('조작된 의도가 폼을 막지 않는다', async () => {
    const html = await (await get(PATHS.productNew, jar)).text()
    const res = await submitAction(PATHS.productNew, jar, [
      ...formFieldsFor(html, actionId),
      // 철회된 단계 이름과 알 수 없는 의도 — 둘 다 `NONE`으로 떨어진다
      ['step', 'ZZZ'],
      ['intent', 'DROP TABLE'],
    ])

    expect(res.status).toBe(200)
    const rendered = await res.text()
    expect(rendered).toContain('기본 정보')
    expect(rendered).not.toContain('aria-current="step"')
  })
})
