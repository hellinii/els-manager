import type { AssetOption } from '@/lib/db/queries/prices'

/**
 * 자동완성의 표시 목록 — **검색은 표시를 좁히고 값을 바꾸지 않는다** (SCR-204 ②)
 *
 * ## 왜 순수 함수인가
 *
 * 이 한 줄이 조용한 데이터 오류를 만드는 자리다. 필터가 **선택된 항목을 숨기면**
 * `<select>`의 값이 브라우저에 의해 다른 자산으로 바뀐다 — 사용자는 검색어를
 * 지웠을 뿐인데 기초자산이 달라지고, 그 결과는 저장 후 상세 화면의 워스트오브로만
 * 드러난다(기준가는 그대로이므로 값이 그럴싸하다).
 *
 * 컴포넌트 안에 두면 그 불변식을 확인할 층이 없다 — 상시 스위트는 렌더하지 않고
 * e2e는 HTML 문자열만 본다(AQ-32). 여기 있으면 전수로 본다.
 *
 * 전량을 받아 여기서 좁히는 이유는 §1.2다(조회를 서버 액션으로 감싸지 않는다) —
 * 타이핑마다 서버에 묻는 경로가 없으므로 계약의 빈 질의가 전량이 되었다(§4.9 v1.5).
 */
export function narrowAssets(params: {
  assets: readonly AssetOption[]
  query: string
  /** 지금 선택된 자산의 id. 빈 문자열은 「선택 안 함」이다 */
  selected: string
}): AssetOption[] {
  const needle = params.query.trim().toLowerCase()
  if (needle === '') return [...params.assets]

  return params.assets.filter(
    (asset) =>
      // ★ 선택된 항목은 검색어와 무관하게 남는다. 이 절이 불변식 전체다.
      asset.id === params.selected || asset.name.toLowerCase().includes(needle),
  )
}
