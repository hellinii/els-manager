/**
 * 필드 경로 — 입력의 `name`과 `ActionError.fields`의 키를 **하나의 문법으로** 묶는다
 *
 * 계약은 배열 원소의 오류를 `underlyings[1].assetId` 형태로 준다(§3.2.1 "배열
 * 인덱스는 계약 계층이 담당한다"). 화면이 그 키로 오류를 찾으려면 입력의 `name`이
 * 같은 문자열이어야 하는데, 두 곳에서 각자 조립하면 **한쪽이 `underlyings.1.assetId`
 * 같은 형태를 쓰는 날이 온다.** 그러면 오류가 표시되지 않고, 표시되지 않는 오류는
 * "저장이 안 되는데 아무 말도 없다"가 된다.
 *
 * 생성기(`path`)와 파서(`parseFieldPath`)를 한 파일에 두고 왕복 테스트로 고정한다.
 */

/** `path('underlyings', 1, 'assetId')` → `'underlyings[1].assetId'` */
export function path(field: string, index?: number, sub?: string): string {
  const base = index == null ? field : `${field}[${index}]`
  return sub == null ? base : `${base}.${sub}`
}

export type FieldPath = {
  field: string
  index: number | null
  sub: string | null
}

const PATH = /^([A-Za-z][A-Za-z0-9_]*)(?:\[(\d+)\])?(?:\.([A-Za-z][A-Za-z0-9_]*))?$/

/**
 * 역방향. `null`은 "우리 문법이 아니다"이며 **버리라는 뜻이 아니다** — 미매칭 키는
 * 상단 요약에 모은다(계획 §6). 사용자가 행을 지우고 재제출하면 서버가 사라진
 * 인덱스를 가리킬 수 있고, 그것을 조용히 삼키면 원인 없는 실패가 된다.
 */
export function parseFieldPath(raw: string): FieldPath | null {
  const matched = PATH.exec(raw)
  if (matched == null) return null

  return {
    field: matched[1]!,
    // Number.parseInt는 개수를 세는 정수에 허용된다(린트 주석 참조) — 금액·비율이
    // 아니다. 인덱스는 배열 첨자이며 Decimal의 대상이 아니다.
    index: matched[2] == null ? null : Number.parseInt(matched[2], 10),
    sub: matched[3] ?? null,
  }
}

/**
 * 오류 키가 그 폼에 실재하는 입력을 가리키는가.
 *
 * 화면은 렌더한 `name`의 집합을 알고 있으므로, 그 집합에 없는 키를 골라 상단
 * 요약으로 보낸다. 「어느 필드와도 매칭되지 않는 키를 버리지 않는다」는 규칙의
 * 구현 지점이 여기다.
 */
export function splitFieldErrors(
  fields: Record<string, string> | undefined,
  knownNames: readonly string[],
): { matched: Record<string, string>; unmatched: Array<{ key: string; message: string }> } {
  const known = new Set(knownNames)
  const matched: Record<string, string> = {}
  const unmatched: Array<{ key: string; message: string }> = []

  for (const [key, message] of Object.entries(fields ?? {})) {
    if (known.has(key)) matched[key] = message
    else unmatched.push({ key, message })
  }

  return { matched, unmatched }
}
