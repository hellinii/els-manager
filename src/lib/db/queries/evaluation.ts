import {
  asActive,
  evaluationVerdictOf,
  roundToJudge,
  type EvaluationVerdict,
  type RedemptionMark,
} from '@/lib/domain'

import { kstDateOf } from '../today'
import type { EvaluationClosePair, EvaluationCloses, ProductCoreRow, ScheduleRow } from './load'

/**
 * 평가일 판정의 행 어댑터 — DOC-007 §3.6 · DOC-011 §4.1 `redemptionChecks` · §4.3 `evaluationVerdict` (P6 컷 7)
 *
 * ## 왜 별 파일인가
 *
 * `./attribution`과 같은 이유다 — 판정이지 뷰가 아니고, 두 계약(`getDashboard` · `getProduct`)과 로더의 쌍 선택이
 * 같은 규칙을 써야 한다. 의존은 `@/lib/domain` + `../today` + `import type … from './load'`뿐이라 `./map`과 순환이 없다.
 *
 * ## 쌍 선택과 판정이 같은 함수를 지난다
 *
 * 로더에 넘길 `(자산, 평가일)` 쌍은 `roundToJudge`로 고르고, 판정 함수도 안에서 같은 `roundToJudge`를 부른다. 두
 * 곳에서 각자 거르면 하나만 어긋나도 판정이 요청하지 않은 날짜를 보게 되고, 그 결과는 오류가 아니라 조용한
 * 「평가일 종가 없음」이다(형식은 정상이고 값만 거짓인 부류).
 */

/** 순수 모듈은 camelCase를 받는다 — 행을 붙여 넘겨 결과의 `schedule.row`로 되찾는다(`nextEvaluation`의 「행을 붙여 넘긴다」 패턴) */
export type ScheduleForVerdict = {
  roundNo: number
  evaluationDate: string
  barrier: string
  lizardBarrier: string | null
  lizardRequiresNoKi: boolean | null
  row: ScheduleRow
}

export type ProductVerdict = EvaluationVerdict<ScheduleForVerdict>

function forVerdict(s: ScheduleRow): ScheduleForVerdict {
  return {
    roundNo: s.round_no,
    evaluationDate: s.evaluation_date,
    barrier: s.barrier,
    lizardBarrier: s.lizard_barrier,
    lizardRequiresNoKi: s.lizard_requires_no_ki,
    row: s,
  }
}

/** `attributionOf`와 같은 규칙 — 상환 레코드의 존재가 상태다(D-01) */
function markOf(row: ProductCoreRow): RedemptionMark {
  return row.redemptions == null ? null : { redemptionDate: row.redemptions.redemption_date }
}

/** 등록일 — `created_at`의 Asia/Seoul 날짜 (D3) */
export function registrationDateOf(row: ProductCoreRow): string {
  return kstDateOf(row.created_at)
}

function targetOf(row: ProductCoreRow, asOf: string) {
  return roundToJudge({
    schedules: row.redemption_schedules.map(forVerdict),
    registrationDate: registrationDateOf(row),
    asOf,
    redemption: markOf(row),
  })
}

/**
 * 로더에 넘길 쌍 — 판정할 차수(`JUDGE`)의 평가일 × 그 상품의 기초자산. 만기 갈래는 시세를 보지 않으므로 쌍이 없다.
 * 같은 쌍이 여러 상품에서 나오면 한 번만 싣는다.
 */
export function evaluationClosePairsOf(
  rows: readonly ProductCoreRow[],
  asOf: string,
): EvaluationClosePair[] {
  const pairs = new Map<string, EvaluationClosePair>()
  for (const row of rows) {
    const target = targetOf(row, asOf)
    if (target?.kind !== 'JUDGE') continue
    for (const u of row.els_underlyings) {
      const date = target.schedule.evaluationDate
      pairs.set(`${u.asset_id}@${date}`, { assetId: u.asset_id, date })
    }
  }
  return [...pairs.values()]
}

/**
 * 한 상품의 평가일 판정. 물을 것이 없으면 `null`.
 *
 * - **상환 완료면 `null`**(E-05) — `asActive`가 판정 입력을 만들지 않는다.
 * - **기초자산이 0건이면 만기 갈래만 산다.** `worstOfRow`와 같은 가드다 — `worstOf`의 거부(I-07)는 살려 두고 호출하지
 *   않는다. 그 상태는 `integrityIssue`(`UNDERLYING_MISSING`)가 담당하고, 결함은 그것이 파괴한 입력(시세)을 쓰는
 *   값에만 미친다(DOC-011 §4.2 입력 기준) — 만기 평가일 경과는 시세를 쓰지 않는다.
 */
export function evaluationVerdictFor(
  row: ProductCoreRow,
  closes: EvaluationCloses,
  asOf: string,
): ProductVerdict | null {
  const mark = markOf(row)
  if (mark != null) return null

  if (row.els_underlyings.length === 0) {
    const target = targetOf(row, asOf)
    return target?.kind === 'MATURITY' ? { kind: 'MATURITY_REACHED', schedule: target.schedule } : null
  }

  return evaluationVerdictOf(
    asActive(
      {
        schedules: row.redemption_schedules.map(forVerdict),
        underlyings: row.els_underlyings
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((u) => ({ assetId: u.asset_id, basePrice: u.base_price })),
        closeOn: (assetId: string, date: string) => closes.get(assetId)?.get(date)?.price ?? null,
        kiBarrier: row.ki_barrier,
        kiTouchedAt: row.ki_touched_at,
        registrationDate: registrationDateOf(row),
        asOf,
      },
      mark,
    ),
  )
}
