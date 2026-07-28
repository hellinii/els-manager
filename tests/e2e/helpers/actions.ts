import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BASE_URL, cookieJar } from './server'

/**
 * 서버 액션을 실 HTTP로 호출한다 — **브라우저 없이** (P4 컷 1b)
 *
 * ## 인코딩을 손으로 만들지 않는다
 *
 * 서버가 렌더한 히든 필드(`$ACTION_REF_1`·`$ACTION_1:0`·`$ACTION_1:1`·`$ACTION_KEY`)를
 * **그대로 복제해** multipart로 POST한다. JS 없는 브라우저가 하는 것과 같은 요청이며,
 * React의 내부 형식을 우리가 재구현하지 않으므로 그 형식이 바뀌어도 이 코드는
 * 따라간다(폼에서 읽으니까).
 *
 * 시행에서 배운 것 둘:
 *  ① **`$ACTION_REF_1`에는 `value` 속성이 없다.** 값 있는 필드만 긁으면 그 필드가
 *     빠지고 액션 파싱이 **500**으로 죽는다.
 *  ② **값이 HTML 이스케이프되어 있다**(`&quot;`). 풀지 않고 보내면 역시 500이다.
 *
 * `Next-Action` 헤더를 붙이는 경로는 쓰지 않는다 — 그쪽은 React `encodeReply`의
 * 본문 형식을 요구하므로 손으로 만들어야 하고, 만드는 순간 위 장점이 사라진다.
 *
 * ## 이 스위트가 유일하게 쓸 수 있는 도구다
 *
 * 상시 스위트는 렌더하지 않고 PostgREST 스위트는 Next를 지나지 않는다. 폼 →
 * 어댑터 → 계약 → 화면의 **왕복 전체**가 실행되는 것을 볼 수 있는 층이 여기뿐이다.
 * 남는 공백은 브라우저 안의 일(ST-04의 숨김, 라우터 캐시)이며 AQ-32에 등재되어 있다.
 */

type Field = [name: string, value: string]

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** 액션 이름 → 빌드가 부여한 id. `.next`의 매니페스트가 이름을 들고 있다. */
export function actionIdOf(exportedName: string): string {
  const manifest = JSON.parse(
    readFileSync(
      join(process.cwd(), '.next', 'server', 'server-reference-manifest.json'),
      'utf8',
    ),
  ) as { node: Record<string, { workers: Record<string, { exportedName: string }> }> }

  const found = Object.entries(manifest.node).find(([, entry]) =>
    Object.values(entry.workers).some((w) => w.exportedName === exportedName),
  )
  if (found == null) {
    throw new Error(
      `서버 액션을 매니페스트에서 찾지 못했다: ${exportedName}\n` +
        '  이름이 바뀌었거나 빌드가 낡았다.',
    )
  }
  return found[0]
}

/**
 * 그 액션에 묶인 폼의 히든 필드.
 *
 * 한 화면에 폼이 여럿이므로(SCR-302는 자산 등록 + 줄마다 시세) **액션 id로**
 * 고른다. 순서로 고르면 줄이 늘어나는 순간 다른 폼을 잡는다.
 */
export function formFieldsFor(html: string, actionId: string): Field[] {
  return hiddenFieldsOf(formHtmlFor(html, actionId))
}

/** 그 액션에 묶인 `<form>` 태그 전체. 단계 폼은 그 안을 더 들여다봐야 한다 */
export function formHtmlFor(html: string, actionId: string): string {
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((candidate) => candidate.includes(actionId))

  if (form == null) {
    throw new Error(`액션 ${actionId}의 폼이 HTML에 없다 — 화면이 그 폼을 렌더하지 않았다`)
  }
  return form
}

/**
 * 히든 필드 — **속성 순서를 가정하지 않는다.**
 *
 * 종전 정규식은 `type="hidden" name=… value=…` 순서를 고정했다. React의 속성
 * 순서는 JSX 순서가 아니며(`prices.test.ts`가 `max`에서 같은 함정을 겪었다)
 * `value` 없는 필드도 있다(`$ACTION_REF_1`). 태그를 먼저 잡고 속성을 따로 읽으면
 * 두 가정이 사라진다 — SCR-204의 히든 이송은 필드가 스무 개를 넘으므로 하나만
 * 빠져도 **조용히 값이 없는 제출**이 된다.
 */
function hiddenFieldsOf(form: string): Field[] {
  return [...form.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\btype="hidden"/.test(tag))
    .map((tag): Field => {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1]
      const value = /\bvalue="([^"]*)"/.exec(tag)?.[1]
      return [unescapeHtml(name ?? ''), unescapeHtml(value ?? '')]
    })
    .filter(([name]) => name !== '')
}

/**
 * 제출 버튼이 나르는 `name`·`value` — **손으로 적지 않는다**
 *
 * ## 음성 대조가 이 함수를 만들었다
 *
 * 처음에는 테스트가 `['intent', 'NEXT']`를 직접 붙였다. 그 상태에서 `SubmitButton`의
 * `name`·`value` 전달을 지우는 음성 대조를 했더니 **전부 초록이었다** — 테스트가
 * 브라우저가 보낼 것을 흉내내면서 브라우저가 그것을 **어디서 얻는지**는 확인하지
 * 않았기 때문이다. 실제 JS 없는 제출에서는 `intent`가 아예 실리지 않아 아무 일도
 * 일어나지 않는데 스위트는 통과한다(컷 1b의 「JS 없이 동작하지 않는 폼」이 정확히
 * 그 형태였고, 그때는 e2e가 잡았다).
 *
 * 그래서 값을 **렌더된 버튼에서 읽는다.** 버튼이 그 값을 나르지 않으면 여기서
 * 던진다 — 픽스처가 두 구현을 가른다.
 */
export function buttonField(form: string, value: string): Field {
  const button = [...form.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .find(
      (tag) =>
        /\btype="submit"/.test(tag) && new RegExp(`\\bvalue="${value}"`).test(tag),
    )

  if (button == null) {
    throw new Error(
      `value="${value}"를 나르는 제출 버튼이 없다 — 렌더된 폼에서 그 의도를 보낼 방법이 없다.\n` +
        '  버튼의 name·value가 빠지면 JS 없는 제출에서 아무 일도 일어나지 않는다.',
    )
  }

  const name = /\bname="([^"]*)"/.exec(button)?.[1]
  if (name == null || name === '') {
    throw new Error(`제출 버튼에 name이 없다: ${button}`)
  }
  return [unescapeHtml(name), value]
}

/**
 * **브라우저가 제출할 것 전부** — 히든 + 보이는 칸 (P4 컷 4b)
 *
 * ## 실측이 이 함수를 만들었다
 *
 * `formFieldsFor`는 히든 필드만 준다. 컷 4a의 단계 폼에서는 그것으로 충분했다 —
 * ①②의 칸 값을 테스트가 직접 얹었기 때문이다. ③이 붙자 **`다음`을 누르는 순간
 * ③의 값이 전부 사라졌다**(평가주기·총 차수·연쿠폰율·배리어). 원인은 앱이 아니라
 * 이 헬퍼였다: 실제 브라우저는 보이는 칸도 함께 보내는데 우리는 히든만 복제했다.
 *
 * 「테스트가 브라우저를 흉내내면서 브라우저가 실제로 무엇을 보내는지는 보지 않는다」의
 * 두 번째 사례다(첫 번째는 버튼의 `name`·`value`였고 `buttonField`가 그것을 닫았다).
 *
 * ## 규칙은 HTML 폼 제출 규약이다
 *
 * | 요소 | 보내는 값 |
 * |---|---|
 * | `input[type=checkbox|radio]` | `checked`일 때만 `value`(없으면 `on`) |
 * | `input[type=submit|button]` | 보내지 않는다 — 누른 버튼만이며 `buttonField`가 준다 |
 * | 그 밖의 `input` | `value`(없으면 `''`) |
 * | `select` | `selected`인 옵션, 없으면 **첫 옵션**(브라우저 기본값) |
 * | `textarea` | 태그 사이의 내용 |
 *
 * `name`이 없는 칸은 제출되지 않는다 — ②의 검색 상자가 그것이다(의도된 설계).
 */
export function formValuesFor(html: string, actionId: string): Field[] {
  const form = formHtmlFor(html, actionId)
  const fields: Field[] = []

  for (const tag of [...form.matchAll(/<input\b[^>]*>/g)].map((m) => m[0])) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1]
    if (name == null || name === '') continue

    const type = (/\btype="([^"]*)"/.exec(tag)?.[1] ?? 'text').toLowerCase()
    if (type === 'submit' || type === 'button' || type === 'reset') continue

    const value = /\bvalue="([^"]*)"/.exec(tag)?.[1]
    if (type === 'checkbox' || type === 'radio') {
      if (!/\bchecked(?:="[^"]*")?/.test(tag)) continue
      fields.push([unescapeHtml(name), unescapeHtml(value ?? 'on')])
      continue
    }
    fields.push([unescapeHtml(name), unescapeHtml(value ?? '')])
  }

  for (const tag of [...form.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map(
    (m) => m[0],
  )) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1]
    if (name == null || name === '') continue

    const options = [...tag.matchAll(/<option\b[^>]*>/g)].map((m) => m[0])
    const chosen =
      options.find((option) => /\bselected(?:="[^"]*")?/.test(option)) ?? options[0]
    const value = chosen == null ? '' : (/\bvalue="([^"]*)"/.exec(chosen)?.[1] ?? '')
    fields.push([unescapeHtml(name), unescapeHtml(value)])
  }

  for (const tag of [...form.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)]) {
    const name = /\bname="([^"]*)"/.exec(tag[0])?.[1]
    if (name == null || name === '') continue
    fields.push([unescapeHtml(name), unescapeHtml(tag[1] ?? '')])
  }

  return fields
}

/**
 * 그 폼이 렌더한 **모든** 입력의 `name` — 히든·보임 구분 없이.
 *
 * 단계 폼의 불변식이 「선언된 이름은 렌더되거나 이송된다」이고(`STEP_NAMES` +
 * `carryNames`), 그 합집합이 실제 DOM과 같은지는 **렌더된 문서에만** 있다.
 * 빠진 이름은 저장 버튼을 누를 때까지 증상이 없으므로 여기서 센다.
 */
export function inputNamesOf(form: string): Set<string> {
  const names = new Set<string>()
  for (const tag of [
    ...form.matchAll(/<(?:input|select|textarea)\b[^>]*>/g),
  ].map((m) => m[0])) {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1]
    if (name != null && name !== '') names.add(unescapeHtml(name))
  }
  return names
}

/** 같은 폼에 렌더된 `value` 있는 히든 필드 하나를 읽는다(예: `assetId`). */
export function hiddenValue(html: string, actionId: string, name: string): string {
  const field = formFieldsFor(html, actionId).find(([key]) => key === name)
  if (field == null) throw new Error(`히든 필드가 없다: ${name}`)
  return field[1]
}

/** 히든 필드 + 사용자 입력을 합쳐 제출한다. 응답은 재렌더된 문서다. */
export async function submitAction(
  path: string,
  jar: ReturnType<typeof cookieJar>,
  fields: Field[],
): Promise<Response> {
  const body = new FormData()
  for (const [name, value] of fields) body.append(name, value)

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: jar.header() },
    body,
  })
  jar.absorb(res)
  return res
}
