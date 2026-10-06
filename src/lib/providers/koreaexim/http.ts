import type { ParseFailure } from './parse'

/**
 * 한국수출입은행의 HTTP 판정 규약 — DOC-010 ADR-010 측정 실행(2026-10-05 사건)
 *
 * ★ **302는 WAF 쿠키 챌린지였다**(실측, 다크 웨이크 중 — `Location`이 요청 경로를
 * 키째로 돌려줬다). `index.ts`가 `redirect: 'manual'`로 따라가지 않으므로 여기 오는
 * 3xx는 전부 같은 부류로 묶는다 — **헤더(`Location`)는 이 함수도, 호출부도 읽지 않는다.**
 */
export function httpFailure(status: number): ParseFailure {
  if (status === 429) return { code: 'QUOTA', detail: `한도 초과 (HTTP ${status})` }
  if (status === 401 || status === 403) {
    return { code: 'AUTH', detail: `접근이 거부됐다 (HTTP ${status})` }
  }
  if (status >= 300 && status < 400) {
    return {
      code: 'BLOCKED',
      detail: `리다이렉트 응답 — WAF 쿠키 챌린지일 수 있다 (HTTP ${status})`,
    }
  }
  return { code: 'HTTP', detail: `비2xx 응답 (HTTP ${status})` }
}

/** 던져진 값의 진단 문구. 사용자 표시 문구가 아니다 */
export function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
