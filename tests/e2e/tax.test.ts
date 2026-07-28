import { beforeAll, describe, expect, it } from 'vitest'

import { HEALTH_INSURANCE_TYPE_LABELS, amount } from '@/lib/format'
import { TAX_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

import { actionIdOf, formFieldsFor, formHtmlFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-401 세금 계산 — **조정이 저장되지 않음을 화면에서 실측한다** (P4 컷 8)
 *
 * ## 이 파일이 여기 있는 이유
 *
 * DOC-011 §4.6은 `override`를 시뮬레이션 전용으로 정하고 저장을 §5.6으로 분리했다.
 * 그 분리가 지켜지는지는 **계약 계층에서 확인할 수 없다** — 통합 스위트는 계약을
 * 직접 부르므로 「화면이 어느 계약을 부르는가」를 보지 못하고, 화면이 실수로
 * `saveTaxProfile`을 부르면 슬라이더 조작이 저장된다. 그것은 렌더된 문서와 실제
 * 요청에만 있다.
 *
 * | 무엇을 | 어떻게 |
 * |---|---|
 * | 조정이 저장되지 않는다 | 조정 주소를 부른 뒤 **조정 없는 주소**를 다시 읽어 폴백 상태가 유지되는지 본다 |
 * | 조정 폼이 변경 계약으로 갈 수 없다 | 그 폼에 `$ACTION_*` 히든 필드가 **없음**을 본다(GET 폼이다) |
 * | 폴백이 「0원」이 아니라 「미입력」으로 읽힌다 | 건강보험료 절의 문구를 본다 |
 * | 저장은 눌러야 일어난다 | 저장 폼을 실제로 제출하고 그 뒤에 상태가 바뀌는지 본다 |
 *
 * ## 순서가 의미를 갖는다
 *
 * 저장 케이스가 **마지막**이다. `tax_profiles`는 `(user_id, tax_year)` 하나뿐이므로
 * 한 번 저장하면 「저장된 프로필이 없다」 상태를 되돌릴 수 없다(삭제 계약이 없다) —
 * 폴백 케이스들이 먼저 돌아야 한다. 실행 후에는 `db:reset`이 지운다(CLAUDE.md).
 *
 * **연도를 미래로 고른다.** 이 스위트가 쓰는 사용자는 다른 파일에서도 쓰이므로
 * 올해 프로필을 저장하면 그쪽 관측을 바꿀 수 있다. 미래 연도는 세율 근사 경로이며
 * (§4.6) `saveTaxProfile`이 시드 연도로 제한하지 않는 것이 그 결정이다(v0.9).
 *
 * ## 「조정이 저장되지 않는다」가 항진명제가 아닌 근거
 *
 * 저장이 **한 번도 일어나지 않는** 구현에서도 그 단언은 통과한다. 그래서 반대
 * 방향을 같은 파일에 둔다 — 마지막 케이스가 저장 폼을 실제로 제출하고 **폴백 문구가
 * 사라지는 것**을 본다. 즉 이 관측은 저장 여부에 민감하며, 두 케이스가 **같은
 * 관측 지점에 반대 결과**를 낸다는 것이 그 증거다.
 *
 * 그리고 두 케이스 모두 **실제 화면 요청**이다(브라우저 없이 HTTP로). 테스트가
 * `getTaxSummary`를 직접 부르거나 `tax_profiles`를 직접 읽으면 「화면이 무엇을
 * 부르는가」를 확인하지 못하고 프로덕션 경로를 재구현하게 된다 — 그것이 이 파일이
 * 통합 스위트에 있으면 안 되는 이유다.
 *
 * ## 음성 대조 4건 — 셋이 갈렸고 **하나는 갈리지 않았다**
 *
 * | 깨뜨린 것 | 결과 |
 * |---|---|
 * | `notEntered`에서 `&& !simulating` 제거(§4.6의 두 원인을 접는 순진한 구현) | 1건 — 조정 케이스 |
 * | 가입 유형 `NONE`에서도 금액을 렌더 | 2건 — 폴백 케이스 + 조정 케이스의 복귀 확인 |
 * | 조정 폼을 연도 폼과 합침 → **폼 개수만 보는 단언** | **갈리지 않았다** — 개수는 그대로 2다 |
 * | 같은 대조를 **「연도를 고르는 칸」** 기준으로 다시 | 1건 — 그 기준으로 바꾼 뒤 갈렸다 |
 *
 * 셋째·넷째 줄이 이 파일의 기록이다: 처음 쓴 단언(`forms.length === 2`)은 두 폼의
 * **분리**를 지키지 못했고, 그 사실이 대조에서만 드러났다. 지금 개수 단언이 남아
 * 있는 이유는 다른 것이다 — 0건을 찾고 조용히 통과하는 것을 막는다(`$ACTION`이 없다는
 * 단언은 빈 목록에 대해 참이다).
 */

/**
 * React가 넣는 빈 주석을 지운다 — `{amount(v)}원`은 `50,000,000<!-- -->원`으로
 * 렌더된다(인접한 표현식과 텍스트 사이에 경계가 생긴다). `products.test.ts`·
 * `schedule.test.ts`가 같은 것에 걸렸고 같은 이유로 같은 함수를 둔다 — **HTML
 * 문자열은 사용자가 보는 것과 같지 않다.**
 */
function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

const SIMULATING = '시뮬레이션 중이다'
const NOT_ENTERED = '과세 프로필이 저장되어 있지 않다'
const HEALTH_NOT_ENTERED = '가입 유형이 미입력이므로 산출하지 않는다'

/** 저장 케이스가 쓰는 연도 — 다른 파일의 관측과 겹치지 않게 미래로 둔다 */
const SAVE_YEAR = 2030

describe('SCR-401 세금 계산', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('200으로 서고 §5의 여섯 요소가 나온다', async () => {
    const res = await get(PATHS.tax, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('세금 계산')
    expect(html).not.toContain('아직 만들지 않은 화면이다')

    // ①~⑥ (①은 연도 선택 폼, ②는 프로필 폼)
    for (const heading of [
      '귀속연도',
      '과세 프로필',
      '금융소득 집계',
      '세액',
      '건강보험료',
      '구간별 실질 한계 부담률',
    ]) {
      expect(html, heading).toContain(heading)
    }

    // 「표시 주의」 셋 (DOC-008 §5)
    expect(html).toContain('0이 정상이다') // 추가납부 0
    expect(html).toContain('추정치다') // A-06 건보료
    expect(html).toContain('세무 신고 자료가 아니다') // C-04
  })

  it('연도 선택지가 시드 연도부터 시작한다 — 오류로 가는 선택지가 없다', async () => {
    /*
     * ★ **하한이 계약에서 온다**(§4.6 v1.9 `seededYears`). 화면이 범위를 추측하면
     * (「올해 − 5년」) 시드보다 과거인 항목이 생기고 **그것을 고르면 계약이 던진다** —
     * 사용자에게 제시된 선택지가 앱을 멈추는 형태다.
     *
     * 그래서 선택지 전부를 실제로 열어 본다. 하나라도 오류 화면이면 여기서 죽는다.
     */
    const html = await (await get(PATHS.tax, jar)).text()
    const select = /<select name="year"[\s\S]*?<\/select>/.exec(html)?.[0]
    expect(select, '연도 선택 상자가 없다').toBeDefined()

    const years = [...select!.matchAll(/value="(\d{4})"/g)].map((m) => m[1]!)
    expect(years.length).toBeGreaterThan(0)

    for (const year of years) {
      const res = await get(`${PATHS.tax}?${TAX_KEYS.year}=${year}`, jar)
      expect(res.status, `${year}년`).toBe(200)
      const body = await res.text()
      // 안내 화면(시드 범위 밖)이 아니라 실제 계산 화면이어야 한다.
      expect(body, `${year}년`).not.toContain('세율·요율이 없다')
      expect(body, `${year}년`).toContain('금융소득 집계')
    }
  })

  it('시드보다 과거인 연도는 오류 화면이 아니라 안내다', async () => {
    /*
     * 계약은 던진다(ADR-005의 재현성) — 뒤 연도의 법으로 과거를 계산하지 않는다.
     * 화면이 그 예외를 잡아 안내로 바꾸므로 오래된 링크가 앱을 멈추지 않는다
     * (SCR-202가 비-UUID id를 404로 바꾼 것과 같은 판단).
     */
    const res = await get(`${PATHS.tax}?${TAX_KEYS.year}=1999`, jar)
    expect(res.status).toBe(200)
    const html = visible(await res.text())

    expect(html).toContain('1999년의 세율·요율이 없다')
    // 다음 행동이 있다 — 가능한 가장 이른 연도로 가는 링크(예외가 그 값을 들고 있다)
    expect(html).toMatch(/href="\/tax\?year=\d{4}"/)
  })

  it('★ 프로필 폴백이 「0원」이 아니라 「미입력」으로 보인다', async () => {
    /*
     * ★ 계약의 폴백은 `NONE` + `0`이고(§4.6) 그 상태의 건강보험료는 **0**이다.
     * 금액으로 렌더하면 사용자는 **부과액이 0이라고 읽는다** — 실제로는 아무것도
     * 계산하지 않은 상태다. DOC-011 §4.6이 「계산 결과가 아니라 미입력으로 표시해야
     * 한다」고 요구하고 DOC-005 §6.1이 라벨을 「미입력」으로 정한 이유다.
     *
     * 그리고 세액에도 같은 성질이 있다 — 금융소득 외 종합소득이 0이면 종합과세
     * 세액이 실제보다 낮으므로 그 사실을 함께 적는다.
     */
    const html = visible(await (await get(PATHS.tax, jar)).text())

    expect(html).toContain(NOT_ENTERED)
    expect(html).toContain('세액이 실제보다 낮게 나온다')
    expect(html).toContain(HEALTH_NOT_ENTERED)
    /*
     * 「0원」을 건보료 자리에 적지 않는다 — 산정 소득·보험료 **칸이 아예 없다.**
     *
     * ★ 단언이 `>산정 소득<`인 것은 실측으로 고친 결과다. 문서 전체에 대한
     * `toContain('산정 소득')`은 **미입력 안내 문구 자체에** 맞는다(「유형에 따라
     * 문턱과 산정 소득이 다르다」) — 컷 5의 `>상환 실적<`와 같은 함정이다.
     */
    expect(html).not.toContain('>산정 소득<')
    // 폴백 상태이므로 조정 중이 아니다 — 두 문구가 함께 뜨면 원인이 흐려진다.
    expect(html).not.toContain(SIMULATING)
  })

  it('★ 조정 폼에 서버 액션이 없다 — 저장으로 가는 경로가 구조적으로 없다', async () => {
    /*
     * ★ **이것이 「저장되지 않는다」의 구조적 형태다.** 조정 폼이 `<form method="GET">`
     * 이므로 React가 `$ACTION_ID_*`·`$ACTION_REF_*` 히든 필드를 넣지 않는다 — 즉 그
     * 폼을 제출해도 변경 계약에 닿을 방법이 없다.
     *
     * 저장 폼은 반대다(서버 액션이므로 그 필드가 있다). 두 폼을 같은 문서에서
     * 대조하므로 「조정에는 없고 저장에는 있다」가 한 케이스에서 관측된다.
     */
    const html = await (await get(PATHS.tax, jar)).text()

    /*
     * ★ **속성 순서를 전제하지 않는다.** React는 `class`를 먼저 내보내므로
     * `<form method="GET" action="/tax"`로 찾으면 0건이고, 0건은 이 부류 단언에서
     * **조용한 통과**가 된다(`$ACTION`이 없다는 단언이 빈 목록에 대해 참이다).
     * 그래서 개수를 먼저 고정한다.
     */
    const forms = [...html.matchAll(/<form[^>]*action="\/tax"[^>]*>[\s\S]*?<\/form>/g)].map(
      (m) => m[0],
    )
    /*
     * 개수를 고정하는 것은 위 0건 함정 때문이고, **두 폼의 분리는 개수로 증명되지
     * 않는다**(실측: 조정 폼에 연도 select를 더해도 개수는 2다). 분리를 지키는 것은
     * 아래 단언이다 — 연도를 나르는 폼이 조정값을 함께 나르지 않는다.
     */
    expect(forms.length).toBe(2)

    /*
     * ★ **연도 변경이 조정이 되면 안 된다.** 한 폼에 합치면 연도만 바꿔도 세 입력이
     * 함께 제출되어 직전 연도의 조정값이 새 연도의 `override`가 되고, 그 상태가
     * 「저장된 프로필」과 구분되지 않는다(§4.6의 `isSaved`가 한 거짓으로 접는다).
     *
     * 판정 기준이 **「연도를 고르는 칸」**(visible `<select name="year">`)이라는 점이
     * 실측으로 정해졌다. 두 대조가 그것을 정했다.
     *
     * | 대조 | 결과 |
     * |---|---|
     * | 폼 개수만 본다 | **갈리지 않는다** — 조정 폼에 연도 select를 더해도 2다 |
     * | `name="year"`를 나르는 폼을 본다 | **정상 구현이 빨간불** — 조정 폼은 연도를 히든으로 나르는 것이 맞다(적용 후 같은 연도에 머물러야 한다) |
     *
     * 그래서 **고르는 칸**만 본다. 조정 폼이 연도를 나르는 것은 정상이고, 연도를
     * **고를 수 있는** 폼이 조정값을 함께 나르는 것이 결함이다.
     */
    const chooserForms = forms.filter((form) =>
      new RegExp(`<select[^>]*name="${TAX_KEYS.year}"`).test(form),
    )
    expect(chooserForms.length, '연도를 고르는 GET 폼이 하나가 아니다').toBe(1)
    for (const key of [TAX_KEYS.otherIncomeBase, TAX_KEYS.otherFinancialIncome]) {
      expect(chooserForms[0]!, `연도 폼이 ${key}를 나른다`).not.toContain(`name="${key}"`)
    }
    for (const form of forms) {
      expect(form, '조정 폼에 서버 액션 필드가 있다').not.toContain('$ACTION')
      expect(form).not.toContain('$ACTION_ID')
    }

    /*
     * 저장 폼에는 있다 — 그것이 유일한 저장 경로다.
     *
     * ★ 필드 이름이 `$ACTION_ID`가 **아니다**(실측). `useActionState`로 묶인 폼은
     * `$ACTION_REF_1` + `$ACTION_1:0`(값에 액션 id가 들어 있다) + `$ACTION_KEY`를
     * 낸다. 이름을 추측해 단언하면 **없는 것을 없다고 확인하는** 초록이 된다.
     */
    const saveForm = formHtmlFor(html, actionIdOf('saveTaxProfileAction'))
    expect(saveForm).toContain('$ACTION_REF_1')
    expect(saveForm).toContain('name="year"')
  })

  it('★ 조정이 계산을 바꾸고 **저장되지 않는다**', async () => {
    /*
     * ★ P3a가 계약에 그 분리를 넣은 이유를 화면에서 실측한다. 세 요청이다.
     *
     * ① 조정 주소 → 숫자가 바뀌고 「시뮬레이션 중 — 저장되지 않았다」가 뜬다
     * ② 조정 없는 주소 → **폴백으로 돌아간다.** 화면이 실수로 `saveTaxProfile`을
     *    불렀다면 이 요청에서 「저장되어 있지 않다」가 사라지고 조정값이 남는다
     * ③ 조정 주소를 다시 → 같은 결과(멱등). 조정이 누적되지 않는다
     */
    const base = '50000000'
    const query = `${PATHS.tax}?${TAX_KEYS.otherIncomeBase}=${base}&${TAX_KEYS.healthInsuranceType}=REGIONAL`

    const simulated = visible(await (await get(query, jar)).text())
    expect(simulated).toContain(SIMULATING)
    // 조정값이 계산에 쓰였다 — 적용값 요약에 그 금액이 있다.
    expect(simulated).toContain(`${amount(base)}원`)
    // 가입 유형이 들어왔으므로 건강보험료가 산출된다(미입력 문구가 사라진다).
    expect(simulated).toContain(HEALTH_INSURANCE_TYPE_LABELS.REGIONAL)
    expect(simulated).not.toContain(HEALTH_NOT_ENTERED)
    expect(simulated).toContain('>산정 소득<')
    // 폴백 경고는 사라진다 — 원인이 다른 두 문구가 함께 뜨지 않는다.
    expect(simulated).not.toContain(NOT_ENTERED)

    // ② ★ 조정 없는 주소 — 저장되지 않았으므로 폴백이다
    const after = visible(await (await get(PATHS.tax, jar)).text())
    expect(after, '조정이 저장되었다').toContain(NOT_ENTERED)
    expect(after).toContain(HEALTH_NOT_ENTERED)
    expect(after).not.toContain(SIMULATING)

    // ③ 멱등 — 같은 주소가 같은 결과를 낸다
    const again = visible(await (await get(query, jar)).text())
    expect(again).toContain(SIMULATING)
    expect(again).toContain(`${amount(base)}원`)
  })

  it('조정은 축별이다 — 하나만 조정하면 나머지는 저장값(폴백)이다', async () => {
    // 계약의 `override`가 필드별 선택이므로(§4.6) 부분 조정이 정상 경로다.
    const html = visible(
      await (
        await get(`${PATHS.tax}?${TAX_KEYS.healthInsuranceType}=EMPLOYEE`, jar)
      ).text(),
    )

    expect(html).toContain(SIMULATING)
    expect(html).toContain(HEALTH_INSURANCE_TYPE_LABELS.EMPLOYEE)
    // 금융소득 외 종합소득은 조정하지 않았으므로 폴백 0이다.
    expect(html).toContain('0원')
  })

  it('조작된 조정값이 오류가 되지 않는다', async () => {
    const res = await get(
      `${PATHS.tax}?${TAX_KEYS.healthInsuranceType}=GOLD&${TAX_KEYS.year}=abc`,
      jar,
    )
    expect(res.status).toBe(200)
    const html = visible(await res.text())
    // 인식하지 못한 축은 조정되지 않으므로 폴백이다 — 조정 중이 아니다.
    expect(html).not.toContain(SIMULATING)
    expect(html).toContain(NOT_ENTERED)
  })

  it('★ 저장은 저장 폼을 눌렀을 때만 일어난다 — 그 뒤 폴백이 사라진다', async () => {
    /*
     * ★ 위 케이스가 「조정만으로는 저장되지 않는다」를 고정했으므로 여기서는 그
     * 반대 방향을 고정한다: **저장 폼을 실제로 제출하면 저장된다.** 둘이 함께 있어야
     * 「저장 경로가 아예 없다」는 잘못된 구현도 걸린다.
     *
     * 히든 값을 손으로 적지 않는다(`formFieldsFor`가 렌더된 폼에서 읽는다) — 컷 4a의
     * 음성 대조가 드러낸 함정이다: 테스트가 값을 얹으면 **화면이 그 값을 어디서
     * 얻는지**를 확인하지 않게 된다. 그래서 조정 주소에서 폼을 읽어 제출한다 —
     * 그것이 「조정된 값으로 저장」의 실제 경로다.
     */
    const overrideQuery = `${PATHS.tax}?${TAX_KEYS.year}=${SAVE_YEAR}&${TAX_KEYS.otherIncomeBase}=30000000&${TAX_KEYS.healthInsuranceType}=DEPENDENT`
    const simulated = visible(await (await get(overrideQuery, jar)).text())
    expect(simulated).toContain(SIMULATING)

    const actionId = actionIdOf('saveTaxProfileAction')
    const saved = await submitAction(
      overrideQuery,
      jar,
      formFieldsFor(simulated, actionId),
    )
    expect(saved.status).toBe(200)
    const body = visible(await saved.text())
    expect(body).toContain('과세 프로필을 저장했다.')

    // ★ 새 요청에서 폴백이 사라진다 — 저장된 값이 그 연도의 기준이 되었다.
    const reloaded = visible(
      await (await get(`${PATHS.tax}?${TAX_KEYS.year}=${SAVE_YEAR}`, jar)).text(),
    )
    expect(reloaded).not.toContain(NOT_ENTERED)
    expect(reloaded).not.toContain(SIMULATING)
    /*
     * ★ 저장값이 **조정 폼의 초기값으로** 돌아온다. 금액을 `won()`으로 찾지 않는
     * 이유가 여기 있다(처음에 그렇게 적어 실패했다) — 조정하지 않은 상태에서 그
     * 값이 나타나는 곳은 입력 칸이고 **쉼표 없이** 렌더된다. 쉼표를 붙이면 그 문자열이
     * 다시 주소를 지나 계약으로 가고 V-19가 「정수로 입력한다」를 낸다
     * (`TaxOverrideForm`의 각주). 즉 이 단언이 그 결정을 고정한다.
     */
    expect(reloaded).toContain('value="30000000"')
    expect(reloaded).toMatch(/value="DEPENDENT"[^>]*selected/)

    // 다른 연도는 그대로 폴백이다 — 집계 키가 `(owner_id, year)`다(절대 규칙 #7).
    const otherYear = visible(
      await (await get(`${PATHS.tax}?${TAX_KEYS.year}=${SAVE_YEAR - 1}`, jar)).text(),
    )
    expect(otherYear).toContain(NOT_ENTERED)
  })
})
