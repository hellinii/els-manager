/**
 * 한국은행 ECOS Open API — 통계 731Y001(원/미국달러 매매기준율) — DOC-010 ADR-010
 *
 * 이 파일에는 상수만 둔다. 파싱은 `parse.ts`(순수), 호출은 `index.ts`다.
 */

const BASE = 'https://ecos.bok.or.kr/api'

/** 통계표코드 — 시장 평균환율(매매기준율) */
const STAT_CODE = '731Y001'

/** 통계항목코드1 — 원/미국달러 */
const ITEM_CODE_USD = '0000001'

/**
 * `StatisticSearch/{인증키}/{요청유형}/{언어}/{시작행}/{종료행}/{통계표코드}/{주기}/
 * {시작일자}/{종료일자}/{통계항목코드1}` — 일별(`D`) 단일일 조회(시작=종료=asOf).
 *
 * ★ 게이트 실측(`~/els-manager-gate/probe.sh`)과 같은 경로다.
 */
export function statisticSearchUrl(authKey: string, asOf: string): string {
  const d = asOf.replaceAll('-', '')
  return `${BASE}/StatisticSearch/${encodeURIComponent(authKey)}/json/kr/1/100/${STAT_CODE}/D/${d}/${d}/${ITEM_CODE_USD}`
}

/**
 * `RESULT.CODE` — **둘 다 HTTP 200으로 온다**(실측, ADR-010 측정 실행). 0행과 키 오류를
 * 가르는 신호가 이 코드다 — `RESULT` 블록의 유무로 가르면 안 된다(정상 응답에는
 * `RESULT`가 아예 없다).
 */
export const RESULT_CODE = {
  /** 그날 데이터가 없다(휴장 등) — 키 오류가 아니다 */
  NO_DATA: 'INFO-200',
  /** 인증키가 유효하지 않다 */
  BAD_KEY: 'INFO-100',
} as const

export const PROVIDER_ID = 'ECOS'
