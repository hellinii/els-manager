import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { ProductDetailView } from '@/lib/db/queries/map'
import { PRICE_SOURCE_LABELS, korDate, percent, priceDisplay } from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * ② 기초자산별 기준가·현재가·비율 — SCR-202 (DOC-008 §5)
 *
 * ## `isWorst`는 계약의 답이다 — 화면이 최솟값을 다시 고르지 않는다
 *
 * §4.3: 「최저 비율인 기초자산. **동률이면 전부 `true`**, `worstOf`를 산출할 수
 * 없으면 전부 `false`」. 화면이 `Math.min`으로 다시 고르면 동률에서 하나만
 * 표시하게 되고, 어느 하나인지는 렌더 순서에 의존하는 임의값이 된다. 그리고
 * 비율 비교를 부동소수점으로 하게 된다(린트가 막지만 막힌 뒤에 갈 곳이 없다).
 *
 * ## 시세 없음은 이 표에서 자산 단위로 드러난다 (ST-01)
 *
 * 상품 수준의 「시세 없음」은 어느 자산이 원인인지 말하지 않는다. 워스트오브는
 * 하나라도 빠지면 `null`이므로(E-01), 사용자가 고칠 대상을 알려면 **어느 줄이
 * 비었는지**가 보여야 한다 — 그 줄에서 SCR-302로 보낸다(§7.3).
 */

export function UnderlyingTable({
  underlyings,
}: {
  underlyings: ProductDetailView['underlyings']
}) {
  if (underlyings.length === 0) {
    /*
     * `UNDERLYING_MISSING`이다. 여기서 「없음」만 적지 않는 이유는 ST-06이 결함을
     * 「시세 없음」과 다른 문구로 표시하고 수정 화면으로 유도하라고 요구하기
     * 때문이며, 상단 요약이 그 문구를 이미 들고 있으므로 여기서는 그 사실을
     * 반복하지 않고 표가 왜 비었는지만 적는다.
     */
    return (
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        기초자산이 0건이다 — 계약을 경유하는 조작으로는 만들 수 없는 상태다
        (DOC-002 I-07).
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200">
      <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 sm:grid">
        <span>기초자산</span>
        <span className="text-right">기준가</span>
        <span className="text-right">현재가</span>
        <span className="text-right">기준가 대비</span>
      </div>

      <ul className="divide-y divide-neutral-200">
        {underlyings.map((u) => (
          <li
            key={u.assetId}
            className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{u.assetName}</span>
                {u.isWorst && (
                  /*
                   * 동률이면 여기 둘 이상 붙는다 — 그것이 계약의 정의이므로
                   * 화면이 하나로 줄이지 않는다.
                   */
                  <Badge grade="caution">워스트오브</Badge>
                )}
              </p>
              {u.priceSource != null && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {PRICE_SOURCE_LABELS[u.priceSource]}
                  {u.priceAsOf != null && <> · {korDate(u.priceAsOf)}</>}
                </p>
              )}
            </div>

            <Cell label="기준가">{priceDisplay(u.basePrice)}</Cell>

            <Cell label="현재가">
              {u.currentPrice == null ? (
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  <span className="text-neutral-500">시세 없음</span>
                  {/* §7.3 — 폴백 경로가 그 줄에 있다 */}
                  <Link
                    href={PATHS.prices}
                    className="text-xs font-normal text-neutral-600 underline"
                  >
                    입력
                  </Link>
                </span>
              ) : (
                priceDisplay(u.currentPrice)
              )}
            </Cell>

            <Cell label="기준가 대비">
              {u.ratio == null ? (
                <span className="text-neutral-400">—</span>
              ) : (
                percent(u.ratio)
              )}
            </Cell>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 모바일에서는 라벨이 값과 함께 나오고 데스크톱에서는 열 머리글이 그 일을 한다. */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums sm:justify-end">
      <span className="text-xs font-normal text-neutral-500 sm:hidden">{label}</span>
      <span>{children}</span>
    </div>
  )
}
