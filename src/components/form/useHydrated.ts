import { useSyncExternalStore } from 'react'

/**
 * 하이드레이션이 끝났는가 — 서버 렌더 · 하이드레이션 중에는 `false`, 그 뒤에는 `true` (P8.5 · DOC-008 v2.41)
 *
 * ## 화면 상태에서 오는 고정은 JS가 있을 때만 그린다
 *
 * 폼의 칸 고정 중 **화면의 선택(상환 유형 · 쿠폰 지급방식)에서 오는 것**은 그 선택을 읽는 상태(`useState`)가 있어야 풀린다.
 * JS가 없으면 그 상태가 없으므로, 서버가 그린 고정(실패한 제출이 돌려준 값으로 다시 그린 폼)은 선택을 되돌려도 풀리지 않고
 * `readOnly`의 `0`이 그대로 저장됐다 — 이익 상환의 과세 0이 오류 없이 들어갔다(반박 검토가 실재로 찾았다). 그래서 그런 고정은
 * 이 값이 참일 때만 그린다 — JS가 없으면 칸은 늘 열려 있고 계약(V-12 · V-29)이 저장에서 거부한다.
 *
 * **저장된 상품의 사실에서 오는 고정**(SCR-203의 월지급식 — 서버가 렌더 시점에 안다)은 이 훅을 쓰지 않는다 — JS와 무관하게 맞다.
 *
 * `useSyncExternalStore`의 서버 스냅샷이 하이드레이션 동안 쓰이므로 서버 HTML과 첫 클라이언트 렌더가 같고(불일치 경고 없음),
 * 하이드레이션 뒤 한 번 다시 그린다. effect에서 상태를 바꾸지 않는다.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
}

function subscribe(): () => void {
  return () => undefined
}

function clientSnapshot(): boolean {
  return true
}

function serverSnapshot(): boolean {
  return false
}
