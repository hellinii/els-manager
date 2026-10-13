import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 문서의 **살아 있는 글** — 취소선과 변경 이력 행을 벗긴 본문 (홈 피드백 컷 K4 · 계획의 「취소선 함정」)
 *
 * ## 왜 필요한가
 *
 * 뒤집은 결정은 지우지 않고 `~~종전~~ → 새 값`으로 남긴다(DOC-000 U-01 ~ U-06). 그 문서에 `toContain(「…」)`을
 * 걸면 **종전 문구도 문서에 있으므로** 코드를 종전으로 되돌려도 결속이 초록이다 — 결속 테스트가 아무것도 묶지 않는
 * 경로다. 변경 이력 행도 같은 부류다(이력은 종전 문구를 인용할 수 있다). 그래서 화면 글자를 「」째로 문서에 묶는
 * 단언은 이 함수가 낸 글을 본다.
 *
 * ## 무엇을 벗기는가
 *
 * - **줄 안의 `~~…~~`** — 마크다운 취소선은 줄을 넘지 않는다. 한 줄에 여럿이면 각각 벗긴다
 * - **변경 이력 행** — `| 2.49 | 2026-10-13 | …`처럼 버전 · 날짜로 시작하는 표 행
 *
 * 자기 검증은 `emptyState.test.ts`의 「liveDoc」 describe다(실제 문서의 취소선 안에만 있는 문장이 벗겨지는가).
 *
 * ## 범위도 좁힌다 — `quoteBlock` (홈 피드백 컷 K7)
 *
 * 문서 전체에 `toContain`을 걸면 **같은 글자가 다른 자리에 있어도** 초록이다 — 홈 ① 빈 줄의 제목은 정본 각주 말고도
 * SQ-28 · K0 각주가 인용하므로, 정본만 고쳐도(또는 정본에서 지워도) 결속이 깨지지 않았다(K4 검증 지적). 그래서 결속은
 * 정본이 있는 **인용 블록 하나**(`>`로 시작하는 연속된 줄)를 잘라 그 안에서만 찾는다.
 */
export function liveDoc(file: string): string {
  return liveText(readFileSync(join(process.cwd(), 'docs', file), 'utf8'))
}

/** 이력 행 — 첫 두 칸이 버전과 날짜다(`docs-contract.test.ts`의 `historyMax`가 읽는 그 행) */
const HISTORY_ROW = /^\| \d+\.\d+ \| \d{4}-\d{2}-\d{2} \|/

/** `liveDoc`의 본체 — 문자열을 받는다(합성 입력으로 자기 검증하려고 뗐다) */
export function liveText(text: string): string {
  return text
    .split('\n')
    .filter((line) => !HISTORY_ROW.test(line))
    .map((line) => line.replace(/~~.*?~~/g, ''))
    .join('\n')
}

/**
 * `opening`으로 시작하는 줄부터 `>`로 시작하는 줄이 이어지는 동안의 인용 블록 — 문서의 각주 하나다.
 *
 * 여는 줄은 **정확히 하나**여야 한다 — 없거나 둘이면 던진다(0개를 자르고 초록이 되거나, 엉뚱한 블록을 자르는 것을 막는다).
 * 살아 있는 글(`liveText`)에 건다 — 블록 안의 취소선도 벗겨진 채다.
 */
export function quoteBlock(text: string, opening: string): string {
  const lines = text.split('\n')
  const starts = lines.flatMap((line, i) => (line.startsWith(opening) ? [i] : []))
  if (starts.length !== 1) throw new Error(`여는 줄이 ${starts.length}개다: ${opening}`)
  const from = starts[0]!
  let to = from
  while (to + 1 < lines.length && lines[to + 1]!.startsWith('>')) to++
  return lines.slice(from, to + 1).join('\n')
}
