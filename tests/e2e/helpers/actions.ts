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
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((candidate) => candidate.includes(actionId))

  if (form == null) {
    throw new Error(`액션 ${actionId}의 폼이 HTML에 없다 — 화면이 그 폼을 렌더하지 않았다`)
  }

  return [
    ...form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\s*\/>/g),
  ].map((m) => [unescapeHtml(m[1]!), unescapeHtml(m[2] ?? '')])
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
