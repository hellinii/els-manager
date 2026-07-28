/**
 * 폼 기본값 — 화면이 아니라 여기서 정한다
 *
 * 기본값은 검증 규칙과 짝을 이룬다. V-17이 `asOfDate ≤ 기준일`을 요구하므로 시세
 * 입력의 기본값과 `max` 속성이 **같은 값**이어야 하고, 그 값은 요청당 한 번
 * 해석된 기준일이다(Q-02). 화면이 각자 정하면 한 화면이 `new Date()`를 부르고
 * 자정을 걸친 렌더에서 계약이 거부하는 기본값을 내놓는다.
 */

/** §5.7 수동 시세 입력의 기본값. `asOf`는 `getAsOf()`가 준다(프레임워크 배선). */
export function manualPriceDefaults(asOf: string): Record<string, string> {
  return { asOfDate: asOf, price: '' }
}

/**
 * §5.10 자산 등록의 기본값.
 *
 * `currency`가 `'KRW'`인 것은 A-01 규모의 실제 사용 때문이다 — 국내 지수·종목이
 * 대부분이고, 틀린 경우 사용자가 고친다. `char(3)`이므로 정확히 3자여야 한다(V-19).
 * `assetType`은 비워 둔다 — 셋 중 하나를 고르는 것이 등록의 실제 결정이고,
 * 기본값을 주면 「지수」를 「종목」으로 등록하는 실수가 조용히 통과한다.
 */
export function assetDefaults(): Record<string, string> {
  return { name: '', assetType: '', market: '', currency: 'KRW' }
}
