import Link from 'next/link'

import type { ScheduleItem } from '@/lib/db/queries/map'
import { groupByProduct, percent, taxBasisOf } from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

import { ProductScheduleCard } from './ProductScheduleCard'

/**
 * 상품별 보기의 카드 목록 — SCR-301 (DOC-008 §5, P6 컷 6)
 *
 * ## 카드를 `page.tsx`에 두지 않는 이유
 *
 * 시간순 경로의 `Section`은 그 파일 지역이고 **그대로 두는 것이 요구사항**이다
 * (그 경로가 손상되지 않았음을 e2e가 단언한다). 대칭을 맞추려고 상품별도 그 파일에
 * 넣으면 화면 하나가 두 배가 되므로, 새 쪽만 컴포넌트로 뺀다.
 *
 * ## 각주가 목록에 하나다
 *
 * 카드마다 적으면 N번 반복되고, 값이 전부 같으므로 정보량이 0이다. 대신 세율은
 * **계약이 준 것을 렌더한다** — 절대 규칙 #5가 「15.4%」를 코드에 적는 것을 막는다.
 */
export function ProductScheduleList({
  items,
  /** 셋째 빈 상태가 화면 단위로 떠 있으면 카드가 같은 말을 반복하지 않는다 */
  noteMissingUpcoming,
}: {
  items: readonly ScheduleItem[]
  noteMissingUpcoming: boolean
}) {
  const groups = groupByProduct(items)
  // 목록 전체의 세율 근거. 지금은 전 행이 같지만 최대값으로 접는다 — 계약이
  // 차수별로 세율을 가르는 날이 와도 문장이 거짓이 되지 않는다(AQ-66 잔여 ⓐ).
  const taxLawYear = taxBasisOf(items)
  // 첫 항목의 세율이 곧 목록의 세율이다(위와 같은 근거). 금액이 하나도 없으면
  // 각주 자체를 렌더하지 않으므로 이 값도 필요 없다.
  const rate = items.find((i) => i.proceeds != null)?.proceeds?.separateTaxationRate

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-600">
        상품 {groups.length}개 · {items.length}건
      </p>

      {/* 카드 몸통이 표이므로 태블릿에서 2열로 가지 않는다 — 폭을 반으로 접으면
          그 표가 죽는다(DOC-008 §8의 셋째 예외) */}
      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <ProductScheduleCard
            key={group.productId}
            group={group}
            noteMissingUpcoming={noteMissingUpcoming}
          />
        ))}
      </ul>

      {rate != null && (
        <p className="text-xs text-neutral-500">
          예상 세전 · 세후 예상 · 예상 손익은{' '}
          <strong className="font-medium">그 차수에 조기상환된다고 가정한</strong> 값이다.
          세후는 <strong className="font-medium">{percent(rate)} 분리과세 기준</strong>
          이며(비과세 계좌는 차감하지 않는다) 비교과세를 반영하지 않는다 —{' '}
          <Link href={PATHS.tax} className="underline">
            종합과세 반영 세후
          </Link>
          는 세금 계산 화면에 있다.
          {taxLawYear != null && ` 적용 세율은 ${taxLawYear}년 기준이다.`}
        </p>
      )}
    </div>
  )
}
