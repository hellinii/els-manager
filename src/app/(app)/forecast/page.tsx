import { PendingScreen } from '@/components/system/PendingScreen'

/**
 * SCR-402 다년도 전망 — **P4b**에서 선다.
 *
 * 다른 자리표시와 성격이 다르다. 이 화면은 조회 계약 자체가 없다(DOC-011 §4.7
 * 미구현) — RD-02와 DOC-007 §7.5가 선행 조건이므로 화면이 아니라 **계약 신설**이
 * 남은 일이다. 그래서 P4가 아니라 P4b다.
 *
 * 라우트를 지금 두는 이유: 무효화 맵(§8)이 `/forecast`를 가리키고, 컷 1b의 대조
 * 테스트가 "맵의 모든 경로가 실재 라우트"를 단언한다. 라우트가 없으면 맵에서
 * 빼야 하고, 그러면 P4b에서 그 줄을 되살리는 것을 기억해야 한다 —
 * 기억에 의존하는 대신 자리를 만든다.
 */

export default function ForecastPage() {
  return <PendingScreen screen="SCR-402" title="다년도 전망" cut="P4b" />
}
