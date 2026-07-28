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

/**
 * §5.1 상품 등록의 기본값 — SCR-204.
 *
 * **기본값을 주는 것은 `evaluationPeriodMonths` 하나다.** DOC-005 §3이 평가주기를
 * 「통상 6」으로 등재했으므로 문서가 근거를 준 자리이고, 틀리면 사용자가 고친다.
 *
 * `accountType`은 비운다 — `assetType`과 같은 판단이다(그쪽 각주). 일반/비과세는
 * 세액이 갈리는 선택이므로(DOC-007 §5) 기본값을 주면 「비과세 계좌의 상품을 일반으로
 * 등록」이 조용히 통과하고, 그 결과는 SCR-401의 숫자로만 드러난다.
 *
 * `issueDate`도 비운다 — 오늘이 아니다. 발행일은 증권사 서류에 적힌 과거 날짜이며,
 * 오늘을 채우면 평가일 전체가 그만큼 밀린 채 ④ 미리보기가 그럴듯해 보인다.
 *
 * 기초자산은 **한 행**으로 시작한다(V-02는 1개 이상을 요구한다).
 */
export function productDefaults(): Record<string, string> {
  return {
    name: '',
    issuer: '',
    issueDate: '',
    principal: '',
    accountType: '',
    note: '',
    evaluationPeriodMonths: '6',
    totalRounds: '',
    annualCouponRate: '',
    kiBarrier: '',
    kiObservation: '',
    barriers: '',
    'underlyings[0].assetId': '',
    'underlyings[0].basePrice': '',
  }
}
