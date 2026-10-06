/**
 * 한국수출입은행 현재환율 API(AP01) — DOC-010 ADR-010
 *
 * 이 파일에는 상수만 둔다. 파싱은 `parse.ts`(순수), 호출은 `index.ts`다.
 */

const BASE = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'

/**
 * `authkey` · `searchdate`(`YYYYMMDD`) · `data=AP01` — 게이트 실측
 * (`~/els-manager-gate/probe.sh`)과 같은 경로.
 *
 * ★ 옛 도메인 `www.koreaexim.go.kr`은 2026-04-30 종료됐다(`data.go.kr` 공지, 실측) —
 * `oapi.koreaexim.go.kr`만 쓴다.
 */
export function exchangeJsonUrl(authKey: string, asOf: string): string {
  const d = asOf.replaceAll('-', '')
  return `${BASE}?authkey=${encodeURIComponent(authKey)}&searchdate=${d}&data=AP01`
}

/**
 * `result` 필드 — 공개 API 문서 기준(이 프로젝트가 실측한 것은 1·3뿐이다 — 아래 각주).
 * `QUOTA`(일일 호출 한도 초과)는 게이트 측정 기간에 관측되지 않았다.
 */
export const RESULT = {
  /** 조회 성공 */
  OK: 1,
  /** DATA코드 오류 */
  DATA_CODE_ERROR: 2,
  /** 인증코드(authkey) 오류 — ADR-010 실측(2026-10-03) */
  AUTH_CODE_ERROR: 3,
  /** 일일 호출 한도 초과 — 공개 문서 기준, 게이트 기간에 실측되지 않았다 */
  QUOTA_EXCEEDED: 4,
} as const

export const PROVIDER_ID = 'KOREAEXIM'
