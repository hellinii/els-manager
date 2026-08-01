/**
 * 기초자산 표시 줄 — 계약(기준가)과 관측(현재가)을 **한 칸에** 놓는다
 * (DOC-008 §5 SCR-201 ⑧⑨ · SCR-301 ⑨, P6 컷 7)
 *
 * ## 왜 순수 모듈인가
 *
 * 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23). 「두 배열을 무엇으로 짝짓는가」와
 * 「관측이 빈 자산을 어떻게 다루는가」는 판단이고, 컴포넌트 안에서 zip하면 그 판단이
 * 영구 미검증이 된다 — `stepdownLabel`·`lizardLabel`이 같은 이유로 이 디렉터리에 있다.
 *
 * ## 순서가 아니라 `assetId`로 합친다
 *
 * DOC-011 §4.2는 두 배열을 **같은 `sequence` 순서**로 준다. 그래도 인덱스로 zip하지
 * 않는 이유는 그 성질이 **현재 구현의 성질**이지 계약의 보장이 아니라는 것이다 —
 * 어긋나면 A 자산의 기준가에 B 자산의 현재가가 붙고, 그 카드는 **그럴싸하다**
 * (`groupByProduct`가 이름이 아니라 `productId`로 묶는 것과 같은 부류의 함정).
 *
 * ## 줄 수를 정하는 것은 **계약 측**이다
 *
 * 관측에 없는 자산은 「현재가 없음」이지 「없는 자산」이 아니다. 계약 측을 훑으면
 * 기준가는 언제나 보이고, 그것이 억제 규칙(D1)이 `terms`에 미치지 않는다는 사실의
 * 표시 계층 판이다 — 시세가 없어도 사용자는 자기가 입력한 값을 본다.
 */

/** `terms.underlyings`의 원소 — 계약 조건이므로 기준일에 의존하지 않는다 */
export type UnderlyingTerm = {
  assetId: string
  assetName: string
  basePrice: string
}

/** `underlyingPrices`의 원소 — 관측이므로 기준일마다 달라진다 */
export type UnderlyingQuote = {
  assetId: string
  currentPrice: string | null
  ratio: string | null
  isWorst: boolean
}

/**
 * 한 자산의 표시 줄. **SCR-201과 SCR-301이 같은 타입을 렌더한다** —
 * DOC-008 §5가 두 화면의 표기를 바이트 동일로 요구하므로 렌더러가 하나다.
 *
 * SCR-301은 계약이 이 형태를 **그대로** 준다(§4.4에 계약/판정 축이 없다).
 * SCR-201은 두 필드로 갈려 오므로 아래 함수가 합친다.
 */
export type UnderlyingLine = {
  assetName: string
  /** 계약 조건 — 발행 시점에 확정된다 */
  basePrice: string
  /** 관측. `null` = E-01 시세 없음 */
  currentPrice: string | null
  /** 기준가 대비 비율. `currentPrice`와 **함께** 빈다 */
  ratio: string | null
  /** 워스트오브와 같은 비율인가. 동률이면 전부 참, 워스트오브가 없으면 전부 거짓 */
  isWorst: boolean
}

/**
 * 계약 조건 + 관측 → 표시 줄.
 *
 * 관측이 없는 자산은 **`null` 셋과 `false`**가 된다. `isWorst`의 기본값이 거짓인
 * 것이 중요하다 — 없는 관측을 「워스트오브가 아니다」로 읽는 것은 참이고,
 * 참으로 두면 화면이 **비교하지 않은 자산에 표식을 붙인다.**
 */
export function underlyingLines(
  terms: readonly UnderlyingTerm[],
  quotes: readonly UnderlyingQuote[],
): UnderlyingLine[] {
  const byAsset = new Map(quotes.map((quote) => [quote.assetId, quote]))

  return terms.map((term) => {
    const quote = byAsset.get(term.assetId)
    return {
      assetName: term.assetName,
      basePrice: term.basePrice,
      currentPrice: quote?.currentPrice ?? null,
      ratio: quote?.ratio ?? null,
      isWorst: quote?.isWorst ?? false,
    }
  })
}
