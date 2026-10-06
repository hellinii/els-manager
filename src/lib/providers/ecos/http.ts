import type { ParseFailure } from './parse'

/**
 * 한국은행 ECOS의 HTTP 판정 규약 — DOC-010 ADR-010
 *
 * 키움(`src/lib/providers/kiwoom/http.ts`)과 분리해 둔다 — 「429 = 한도」는 일반적이지만
 * 사이트별 특이 사항(키움의 400=WAF 같은 것)이 측정되면 이 파일에만 더한다. ECOS는
 * 측정 기간 동안 그런 특이 사항이 관측되지 않았다(키 오류·휴장 모두 HTTP 200으로 온다 —
 * `parse.ts`가 본다).
 */
export function httpFailure(status: number): ParseFailure {
  if (status === 429) return { code: 'QUOTA', detail: `한도 초과 (HTTP ${status})` }
  if (status === 401 || status === 403) {
    return { code: 'AUTH', detail: `접근이 거부됐다 (HTTP ${status})` }
  }
  return { code: 'HTTP', detail: `비2xx 응답 (HTTP ${status})` }
}

/** 던져진 값의 진단 문구. 사용자 표시 문구가 아니다 */
export function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
