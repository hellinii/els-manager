import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { EvaluationVerdictView } from '@/lib/db/queries/map'
import type { CouponPayout } from '@/lib/domain'
import {
  EVALUATION_VERDICT_GRADES,
  EVALUATION_VERDICT_LABELS,
  evaluationVerdictSentence,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-202 평가일 판정 안내 — DOC-008 SCR-202 「P6 컷 7-0 — 평가일 판정 안내」 (P6 컷 7-3)
 *
 * `Summary` 아래에 둔다. 판정이 `null`이면 그리지 않는다(경과 차수 없음 · 등록일 전 · 이월 · 상환됨). 배지와 문장은
 * SCR-101 ⑥과 같은 함수에서 온다 — 한 사실을 두 화면이 다르게 부르지 않는다.
 *
 * **남의 상품에도 보인다** — 사실이다. 버튼([상환 처리])은 이 안내에 두지 않는다: 머리의 기존 링크가 `?round=k`를 달고
 * 소유자에게만 보인다(입구가 둘이면 어느 것을 눌러야 하는지 화면이 답해야 한다). 「시세 관리」 링크는 모두에게 보인다 —
 * 시세는 공용 데이터다. 주말로 저장된 평가일에는 그 링크를 내지 않는다 — 할 일은 시세 입력이 아니라 일정 수정이고
 * 주말 날짜의 종가는 「관측하지 않은 관측」이다(DOC-007 RD-21 · DOC-010 AQ-100).
 */
export function EvaluationVerdictNotice({
  verdict,
  couponPayout,
}: {
  verdict: EvaluationVerdictView | null
  couponPayout: CouponPayout
}) {
  if (verdict == null) return null

  const askPrice = verdict.kind === 'CLOSE_MISSING' && !verdict.weekendEvaluation

  return (
    <section
      aria-label="상환 확인 필요"
      className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-sm text-neutral-800"
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">상환 확인 필요</span>
        <Badge grade={EVALUATION_VERDICT_GRADES[verdict.kind]}>
          {EVALUATION_VERDICT_LABELS[verdict.kind]}
        </Badge>
      </p>
      <p>{evaluationVerdictSentence(verdict, { couponPayout })}</p>
      {askPrice && (
        <Link href={PATHS.prices} className="self-start font-medium underline">
          시세 관리에서 그날 종가 넣기
        </Link>
      )}
    </section>
  )
}
