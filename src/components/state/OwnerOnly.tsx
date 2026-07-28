/**
 * 소유자 전용 영역 — **ST-04를 구조로 굳힌다**
 *
 * DOC-008 ST-04: 「권한 부족 시 버튼을 비활성화하지 않고 **숨긴다.** 비활성화는
 * 타인 데이터에 대한 조작 가능성을 암시한다.」
 *
 * **`disabled` prop이 아예 없다.** 있으면 언젠가 쓰이고, 쓰이는 순간 규칙이
 * 깨지는데 화면은 정상으로 보인다. 선택지를 제공하지 않는 것이 이 컴포넌트의
 * 전부이며 마크업은 없다 — `<div>`로 감싸지도 않는다(레이아웃을 바꾸면 호출부가
 * 이것을 피해 직접 `isOwner &&`를 쓰게 된다).
 *
 * > **숨김 여부는 브라우저 없이 증명할 수 없다** — DOM에 요소가 **없음**을 봐야
 * > 하는데 상시 스위트는 렌더하지 않고 e2e는 HTML 문자열만 본다(`hidden` 클래스와
 * > 구분되지 않는다). AQ-32로 등재된 공백이며 종결 수단은 Playwright뿐이다.
 * > 그래서 관찰 대신 **구조**로 지킨다: 비활성화라는 표현 수단 자체를 없앤다.
 */

export function OwnerOnly({
  isOwner,
  children,
}: {
  isOwner: boolean
  children: React.ReactNode
}) {
  if (!isOwner) return null
  return <>{children}</>
}
