import type { ParseFailure } from './parse'

/**
 * 키움 공개 엔드포인트의 **HTTP 판정 규약** — es040(ADR-008)과 조건 원천(ADR-009)이 공유한다
 *
 * ## 왜 파일을 따로 두는가
 *
 * 「400 = WAF 차단」은 **이 사이트의 사실**이지 한 어댑터의 사실이 아니다. 두 어댑터가
 * 각자 사본을 가지면 한쪽이 그 규약을 잊는 날 같은 400이 한 자리에서는 `BLOCKED`(호출
 * 방식을 본다)이고 다른 자리에서는 `HTTP`(경로·스키마를 본다)가 된다 — **같은 원인이
 * 자리마다 다른 조치를 지시한다**(`failures.ts`의 `FAILURE_CLASS`가 막으려는 것과 같은 형태).
 *
 * 순수하다. `fetch`를 모르고 상태 코드와 본문 문자열만 본다.
 */

/**
 * 상태 코드를 부류로 가른다. **429·401·403을 `HTTP`로 뭉개지 않는다** — 조치가 다르다
 * (한도는 기다리고, 인증은 사람이 보고, 그 밖은 스키마·경로를 본다).
 */
export function httpFailure(status: number): ParseFailure {
  if (status === 429) return { code: 'QUOTA', detail: `한도 초과 (HTTP ${status})` }
  if (status === 401 || status === 403) {
    return { code: 'AUTH', detail: `접근이 거부됐다 (HTTP ${status})` }
  }
  /*
   * ★ 400은 이 공급자에서 **WAF 차단의 표식**이다(쿠키를 싣거나 헤더가 어긋나면 400
   * `{"eversafeThreat":true}`가 온다 — 실측). 일반적인 「잘못된 요청」으로 읽으면
   * 원인에서 먼 곳을 보게 된다.
   */
  if (status === 400) {
    return { code: 'BLOCKED', detail: `요청이 차단됐다 (HTTP 400 — WAF일 수 있다)` }
  }
  return { code: 'HTTP', detail: `비2xx 응답 (HTTP ${status})` }
}

/**
 * 본문이 WAF 차단 페이지인가.
 *
 * ★ **`evfw`는 표식이 «아니다».** 정상 상세 팝업(ADR-009)도 `evfw=` WAF 스크립트를 싣는다 —
 * 그것을 표식으로 쓰면 모든 정상 응답이 `BLOCKED`가 된다. 차단 응답에만 오는 두 낱말만 본다.
 */
export function bodyLooksBlocked(text: string): boolean {
  return text.includes('eversafeThreat') || text.includes('EvCrypto')
}

/** 던져진 값의 진단 문구. 사용자 표시 문구가 아니다 */
export function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
