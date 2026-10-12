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
