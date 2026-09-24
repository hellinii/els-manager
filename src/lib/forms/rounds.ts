/**
 * 차수·개월수의 계수 — **값 맵에서 몇 행인가**를 한 곳에서 정한다
 *
 * `productForm.ts`에서 옮겨 왔고 그 파일이 재수출한다(DOC-008 v2.8). 옮긴 이유는
 * import 순환이다 — `schedules.ts`(평가일 산식)가 이 셋을 쓰고, `transition`이
 * `schedules.ts`의 평가일 채움을 쓴다. 이 파일은 아무것도 import하지 않으므로 두
 * 쪽이 모두 여기서 가져간다.
 */

/**
 * 차수 상한 — **미리보기와 차수표의 행 수**다.
 *
 * V-20이 `smallint` 범위까지 허용하므로 조작된 값(`32767`)이 오면 그만큼의 행을
 * 렌더하게 된다. 계약이 거부하기 **전에** 우리 렌더가 죽으므로 화면 쪽 상한이
 * 따로 필요하다. 60은 5년 만기 매월 평가이며, 그보다 긴 상품이 나오면 이 값을
 * 올린다 — 계약의 상한이 아니라 표의 상한이다.
 */
export const MAX_ROUNDS = 60

/**
 * 차수표의 행 수 — `totalRounds` 입력에서 나온다.
 *
 * 키에서 파생시키지 않는 이유는 잔재다(총 차수를 6→3으로 줄이면 `schedules[3..5]`의
 * 키가 남는다). 사용자가 지운 것을 우리가 되살리면 V-03이 「6건이 총 차수 3과
 * 다르다」를 내고 원인이 화면에 없다. `parse.ts`가 같은 규칙을 쓴다.
 */
export function roundCountOf(values: Record<string, string>): number {
  const parsed = countOf(values.totalRounds)
  return Number.isNaN(parsed) ? 0 : Math.min(parsed, MAX_ROUNDS)
}

/**
 * 개수를 세는 정수의 단일 해석 — 차수·개월수. **금액이 아니다.**
 *
 * `parse.ts`(FormData)와 화면(값 맵)이 같은 함수를 쓴다. 갈리면 화면이 6행을 그리는데
 * 파서가 다른 수를 읽는 상태가 되고, 그 어긋남은 저장 시점에야 V-03으로 드러난다.
 *
 * 형식이 아니면 `NaN`이다 — 오류 문구는 계약이 낸다(V-20).
 */
export function countOf(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim()
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN
}
