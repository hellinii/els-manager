/**
 * ST-07 「환율 없음」 문구 — DOC-008 §6 ST-07 명세 (P8 컷 a2)
 *
 * **앞절은 컷 a2·a3에서 같고 뒷절만 바뀐다.** a2(W1)와 a3(W2) 사이에는 환율 저장소도 입력 경로도
 * 없으므로 뒷절이 없는 화면을 가리키지 않는다(ST-07 ⓐ). 컷 a3의 코드 커밋이 `TAIL` 한 줄을 SCR-302
 * 환율 절로 가는 링크로 바꾼다 — 문구를 고정하는 테스트는 앞절을 잡으므로 그 교체가 테스트를 깨지 않는다.
 *
 * **n은 상품 수다**(ST-07 ⓑ). 달러 상품당 추정 건이 하나(적용 차수 상환)인 동안 E-09의 건수와
 * 같다 — 월지급 달러 상품이 들어오면(컷 b4) 갈리고 그때 무엇을 세는지는 컷 b1이 정한다.
 */

/** 뒷절 — a2~a3 구간. 없는 화면을 가리키지 않는다 */
export const EXCHANGE_RATE_INPUT_TAIL = '환율 입력은 아직 없다'

export type ExchangeRateMissing =
  /** SCR-101 ③ · SCR-401 ③ — 추정이 필요한 달러 상품 n건 */
  | { kind: 'COUNT'; count: number }
  /** SCR-202 ⑤ — 한 상품 형태 */
  | { kind: 'PRODUCT' }
  /** SCR-402 — 원화 합에서 빠진 상품 n건(비과세 · 상환된 상품도 센다 — ST-07 예외 행) */
  | { kind: 'FORECAST'; count: number }

/** 앞절 — 무엇이 빠졌는가. 화면이 뒷절을 잇는다 */
export function exchangeRateMissingLead(missing: ExchangeRateMissing): string {
  switch (missing.kind) {
    case 'COUNT':
      return `환율이 없어 달러 상품 ${missing.count}건의 추정 과세 금융소득이 빠졌다`
    case 'PRODUCT':
      return '환율이 없어 추정 과세 금융소득을 계산하지 않았다'
    case 'FORECAST':
      return `환율이 없어 달러 상품 ${missing.count}건의 원화 금액(세전 회수 · 잔여 원금)이 이 표에서 빠졌다`
  }
}

/** 한 줄 전체 — 앞절 — 뒷절 */
export function exchangeRateMissingNotice(missing: ExchangeRateMissing): string {
  return `${exchangeRateMissingLead(missing)} — ${EXCHANGE_RATE_INPUT_TAIL}`
}
