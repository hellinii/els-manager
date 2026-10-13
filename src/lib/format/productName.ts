/**
 * 상품명의 회차 — 이름 끝의 `{숫자}회` · `{숫자}호` (DOC-005 「회차」 · 홈 피드백 컷 K5)
 *
 * 같은 회사의 상품명은 앞부분이 같다(「키움 뉴글로벌 100조 ELS 2047회」 · 「… 2048회」) — 상품을 가르는 것은 끝의
 * 회차다(2026-10-12 피드백 #9). 화면은 그 부분을 굵게 하고 **앞부분만 말줄임한다** — 끝을 자르면 정확히 회차가
 * 잘린다(DOC-008 SCR-101 「홈 피드백 컷 K0」 ①).
 *
 * ## 저장하지 않는다 — 이름 문자열에서 화면이 가른다
 *
 * 회차는 불러오기의 검색어이고 열이 없다(DOC-005 v1.4). 패턴은 불러오기의 검색 결과 파서
 * (`providers/kiwoom/search-parse.ts`의 `roundNumber`)와 같다 — 그 계층을 import하지 않고(lib/format은 순수 표시
 * 모듈이다) 같은 글자를 여기 둔다.
 *
 * ## 가르지 않는 셋
 *
 * - **끝이 아니다** — 「… 2047회 (USD)」 · 「… 2047회 」(끝 공백). 이름은 저장된 그대로 보이므로 다듬지 않는다
 * - **이름 전체가 회차다** — 「2047회」. 앞부분이 없으면 굵게 할 «나머지»가 없다
 * - **「n차」** — 차수는 회차가 아니다(DOC-005 §8.3). 차수는 화면이 상품명과 다른 줄에 둔다
 */

/** 이름 끝의 회차 — 숫자는 **끝에서부터** 이어진 것 전부다(`(주) …100조 ELS 1740회`의 `100`이 아니다) */
const SERIES_AT_END = /(\d+)[회호]$/

export type ProductNameParts = {
  /** 회차 앞의 글자 — 끝 공백을 그대로 둔다(화면이 `whitespace-pre`로 보인다) */
  lead: string
  /** 이름 끝의 회차. 가르지 않으면 `null`이고 `lead`가 이름 전체다 */
  series: string | null
}

/**
 * `'키움 ELS 2047회'` → `{ lead: '키움 ELS ', series: '2047회' }` · `'키움 ELS 3차'` → `{ lead: '키움 ELS 3차', series: null }`
 *
 * 불변식: `lead + (series ?? '') === name` — 화면의 링크 텍스트가 늘 전체 상품명인 근거다.
 */
export function splitProductName(name: string): ProductNameParts {
  const m = SERIES_AT_END.exec(name)
  if (m == null || m.index === 0) return { lead: name, series: null }
  return { lead: name.slice(0, m.index), series: m[0] }
}
