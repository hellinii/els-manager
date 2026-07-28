import { PendingScreen } from '@/components/system/PendingScreen'

/**
 * SCR-101 홈 · 대시보드 — 컷 9에서 선다.
 *
 * 모든 집계에 의존하는 화면이므로 마지막에 만든다(계획 §3). 조회 계약을 부르지
 * 않는 이유가 그것이다 — 지금 `getDashboard()`를 부르면 시세도 상품도 없는 상태의
 * 빈 카드를 만들고, 그 카드가 맞는지는 여덟 컷 뒤에나 안다.
 *
 * **로그아웃은 `/settings`로 옮겼다** (컷 0d). 컷 0b가 여기에 임시로 둔 것은
 * 화면이 하나뿐이어서였고, DOC-008 §5는 그 버튼을 SCR-502에 둔다. 이제 셸에
 * 「더보기 → 설정」이 있으므로 문서의 자리로 간다 — 여전히 **쿠키 삭제 경로의
 * 유일한 소비자**이며 미인증 상태로 가는 유일한 수단이다.
 */

export default function HomePage() {
  return <PendingScreen screen="SCR-101" title="홈 · 대시보드" cut="컷 9" />
}
