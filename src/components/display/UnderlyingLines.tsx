import { percent, priceDisplay, type UnderlyingLine } from '@/lib/format'

/**
 * 기초자산 한 칸 — `기준가 → 현재가 비율`을 자산마다 (DOC-008 §5 SCR-201 ⑧⑨ · SCR-301 ⑨)
 *
 * ## 두 화면이 **같은 마크업**을 쓴다
 *
 * DOC-008 §5가 두 화면의 표기를 **바이트 동일**로 요구한다 — 한 사실을 다르게 적으면
 * 사용자가 두 개의 다른 값으로 읽는다(셋째 빈 상태의 문구를 보기마다 다르게 두지 않는
 * 것과 같은 규율). 계약이 두 화면에 같은 타입(`UnderlyingLine`)을 주므로 여기가 그
 * 요구의 구조적 형태다.
 *
 * ## 한 칸에 두 성질이 나란히 있다
 *
 * 기준가는 발행 시점에 확정된 **계약**이고 현재가·비율은 기준일마다 달라지는 **관측**이다.
 * 계약은 그 둘을 다른 필드로 주며(§4.2의 `terms` ↔ `underlyingPrices`) 합치는 일은
 * 순수 함수(`underlyingLines`)가 한다 — 이 컴포넌트는 **합쳐진 것을 그리기만 한다.**
 *
 * ## 워스트오브 표식을 화면이 고르지 않는다
 *
 * 값은 계약의 `isWorst`다. 동률이면 둘 이상 붙는 것이 그 필드의 정의이므로 하나로
 * 줄이지 않는다(SCR-202 `UnderlyingTable`의 같은 규약). 말도 그쪽과 같다 —
 * DOC-005 §9가 「최저 기초자산」을 비권장 표기로 둔다.
 *
 * 뱃지가 아니라 **글자**인 것이 SCR-202와 다른 점이다. 이 칸은 한 줄 안에 여러 자산이
 * 오는 조밀한 자리이고, 뱃지를 자산마다 붙이면 그 색이 카드에서 가장 강한 신호가 되어
 * 판정 뱃지(⑥⑦)보다 앞서 읽힌다.
 *
 * ## 자산이 **한 종이면 표식을 붙이지 않는다**
 *
 * ST-05가 요구하는 것은 **차이**의 시각화다. 비교 대상이 없으면 그 자산이 워스트오브인
 * 것은 자명하고, 그때 붙는 표식은 아무것도 구분하지 않은 채 줄만 길게 한다 —
 * `ProductRow`가 「보유중」 뱃지를 달지 않는 것과 **같은 판단**이다(목록의 기본값에
 * 라벨을 붙이면 그 라벨이 신호가 아니다). 실보유 상품은 대부분 여기 해당한다.
 *
 * **`isWorst` 자체를 무시하는 것이 아니다** — 자산이 둘 이상이면 계약이 준 값을 그대로
 * 따른다. 억제되는 것은 표식이지 판정이 아니다.
 */

export function UnderlyingLines({ lines }: { lines: readonly UnderlyingLine[] }) {
  if (lines.length === 0) {
    /*
     * `UNDERLYING_MISSING`(I-07) 또는 기실현 등재다. 여기서 이유를 적지 않는 이유는
     * 두 화면 모두 무결성 표식을 **다른 칸**에 이미 들고 있기 때문이다 — 같은 사실을
     * 두 자리에 적으면 한쪽만 고쳐지는 날이 온다.
     */
    return <span className="text-neutral-400">없음</span>
  }

  // 비교 대상이 있을 때만 표식이 뜻을 갖는다 — 위 머리글의 ST-05 규율.
  const marksWorst = lines.length > 1

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {lines.map((line, index) => (
        // 자산 이름은 중복될 수 있다(V-09는 계약 계층에만 있다) — 위치가 정체다.
        <span key={index} className="whitespace-nowrap tabular-nums">
          <span className="text-neutral-700">{line.assetName}</span>{' '}
          {priceDisplay(line.basePrice)}
          <span className="text-neutral-400"> → </span>
          {line.currentPrice == null ? (
            /*
             * 자산 단위의 E-01. 상품 수준의 「시세 없음」(⑤)은 **어느 자산이 원인인지**
             * 말하지 않으므로, 워스트오브가 하나 때문에 비었을 때 고칠 대상이 이 줄에서만
             * 드러난다(ST-01 · SCR-202 ②와 같은 근거).
             */
            <span className="text-neutral-400">시세 없음</span>
          ) : (
            priceDisplay(line.currentPrice)
          )}
          {line.ratio != null && (
            /*
             * 앞의 공백이 **문자열 안에** 있다. `{' '}`로 떼면 형제 노드가 하나 늘고
             * React가 그 사이에 주석을 넣어 「값 앞의 공백」이 HTML에서 두 조각이 된다 —
             * 문자열 단언이 그것에 걸린다(`UnderlyingRow`의 「기초자산 1」과 같은 함정).
             */
            <span
              className={
                marksWorst && line.isWorst
                  ? 'font-semibold text-neutral-900'
                  : 'text-neutral-500'
              }
            >
              {` ${percent(line.ratio)}`}
            </span>
          )}
          {marksWorst && line.isWorst && (
            <span className="ml-1 text-neutral-500">워스트오브</span>
          )}
        </span>
      ))}
    </span>
  )
}
