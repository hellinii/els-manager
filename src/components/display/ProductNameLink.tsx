import Link from 'next/link'

import { splitProductName } from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * 상품명 — SCR-202 상세로 가는 링크이고 **끝의 회차를 굵게 한다** (홈 피드백 컷 K5 · DOC-005 「회차」)
 *
 * 홈 ⑥ ① ④ ⑤가 함께 쓴다 — 같은 상품이 ⑥ + ①, ① + ④에 함께 나오고 「앞부분이 같다」(피드백 #9)는 네 절에 똑같다.
 * SCR-201 · 301은 아직 쓰지 않는다(DOC-008 SQ-25 ⓐ).
 *
 * - **말줄임은 앞부분에만 생긴다** — 끝을 자르면 정확히 회차가 잘린다. 회차는 줄지 않는다(`shrink-0`)
 * - **앞부분은 `whitespace-pre`다** — `truncate`(nowrap)는 앞부분 끝의 공백을 지워 「ELS2047회」처럼 붙여 보인다
 * - **링크 텍스트는 늘 전체 상품명이다** — 두 조각을 이으면 이름이다(`splitProductName`의 불변식). 글자를 덧붙이거나
 *   빼지 않는다
 * - 회차가 없으면(끝이 아니거나 이름 전체가 회차) 이름이 **한 조각**으로 종전 모양 그대로다
 */
export function ProductNameLink({ productId, name }: { productId: string; name: string }) {
  const { lead, series } = splitProductName(name)

  return (
    <Link
      href={PATHS.product(productId)}
      className="flex min-w-0 items-baseline text-sm hover:underline"
    >
      {series == null ? (
        <span className="truncate font-medium text-neutral-900">{name}</span>
      ) : (
        <>
          <span className="overflow-hidden text-ellipsis whitespace-pre text-neutral-700">{lead}</span>
          <span className="shrink-0 font-semibold text-neutral-900">{series}</span>
        </>
      )}
    </Link>
  )
}
