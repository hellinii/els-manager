import { attributionYear, nextEvaluation } from '@/lib/domain'

import type { ProductRow, RedemptionRow, ScheduleRow } from './load'

/**
 * 적용 차수와 귀속연도의 **단일 원천** — DOC-007 §7.2, RD-02
 *
 * ## 왜 별 파일인가
 *
 * 이 판정은 세 곳에 흩어져 있었다 — `queries/tax.ts`의 `contributionOf`, `queries/map.ts`의
 * `judge`와 `projectionOf`. 셋이 같은 규칙을 각자 구현하고 **각자의 독블록에 그 근거를
 * 적었다.** 값이 갈리면 그 사실이 화면 두 곳의 숫자 차이로만 드러난다.
 *
 * `queries/tax.ts`에 둘 수 없다 — 그 파일이 이미 `./map`에서 값을 import하므로 `map.ts`가
 * 되받으면 **값 순환**이 된다. `queries/map.ts`에도 두지 않는다 — 그 파일은 스스로 「행 →
 * 뷰 매핑」이라 선언하고 이것은 뷰가 아니라 **판정**이다. 새 파일의 의존은 `@/lib/domain` +
 * `import type … from './load'`뿐이라 어느 쪽으로도 순환이 없다.
 *
 * ## 세 `kind`가 §7.2의 두 경우와 「정할 수 없음」을 가른다
 *
 * | `kind` | 뜻 | 귀속연도 |
 * |---|---|---|
 * | `REDEEMED` | 상환 완료. 증권사 확정값을 쓴다(A-04) | `redemption_date`의 연도 |
 * | `ESTIMATED` | 미상환 + 적용 차수 있음. **다음 도래 평가일**을 가정한다(RD-02) | 그 평가일의 연도 |
 * | `NO_ROUND` | 적용 차수를 정할 수 없다 | **없다** (`null`) |
 *
 * `NO_ROUND`가 **셋을 함께 흡수하는 것이 요점이다.**
 *   ① E-07 — 전 차수가 경과했는데 미상환이다(DOC-007 §9.2가 적용 차수를 결정할 수 없다고
 *      규정한다).
 *   ② `SCHEDULE_MISSING` — 평가일정이 0건이다.
 *   ③ **만기 상환인데 일정이 0건** — 이 경우는 `REDEEMED`가 먼저 잡는다. I-13 FK가
 *      `MATCH SIMPLE`이라 `round_no IS NULL`인 만기 상환은 일정 행이 전부 지워져도
 *      `ON DELETE RESTRICT`에 걸리지 않으므로, **상환 완료이면서 `SCHEDULE_MISSING`인
 *      상품이 실재한다.** 상환 분기가 일정 검사보다 먼저 반환하는 것이 그 처리다.
 *
 * ①과 ②를 **한 `kind`로 묶는 것도 결정이다.** 둘은 원인이 다르지만(경과 vs 입력 부재)
 * 이 판정이 답하는 물음 — 「적용 차수가 무엇인가」 — 에는 같은 답을 준다. 원인을 알아야
 * 하는 소비자는 `integrityIssue`(§4.2~§4.4)와 `overdue`(E-07)를 따로 읽는다. 여기서
 * 가르면 그 두 축과 세 번째 이름이 생겨 어느 것이 정본인지 알 수 없게 된다.
 *
 * ## 결함이라서 빼는 것이 아니다
 *
 * `NO_ROUND`는 **무결성 결함의 이름이 아니다.** 차수 입력이 없어 적용 차수를 정할 수 없을
 * 뿐이며, 그 구분이 DOC-011 §4.2 「입력 기준」의 요점이다 — 결함이 파괴한 입력을 쓰는 값만
 * 죽고, `expectedGross`처럼 원금·쿠폰율만 쓰는 값은 산다.
 *
 * ## `scenario`는 여기 셋째 인자로 온다 (P4c)
 *
 * RD-02는 기본값을 「다음 도래 평가일」로 **확정 유지**하고 사용자 조정을 `getForecast`
 * 전용 비영속 `scenario` 인자로 두기로 닫혔다. 그 조정이 바꾸는 것은 정확히 이 함수의
 * `ESTIMATED` 분기이며, **그래서 자리를 여기 하나로 만들어 둔다** — 지금 세 곳에 흩어진
 * 채로 그 인자를 받으면 세 곳이 각자 다른 차수를 고를 수 있다. 구현은 P4c다
 * (DOC-008 §9의 SQ 참조).
 */
export type Attribution =
  | { kind: 'REDEEMED'; year: number; redemption: RedemptionRow }
  | { kind: 'ESTIMATED'; year: number; round: ScheduleRow }
  | { kind: 'NO_ROUND'; year: null }

/**
 * **`year`가 `null`인 경우가 `kind`로 판별된다** — 그것이 AQ-25를 닫는 형태다.
 *
 * 종전 구현은 `attributionYear`의 `number | null`을 그대로 흘려보내 호출부마다 「그럴 수
 * 없는 `null`」을 방어했고, 그 분기를 실행하는 층이 없었다. 이제 `REDEEMED`·`ESTIMATED`의
 * `year`는 `number`이므로 **방어를 쓸 자리가 없다**(`attributionYear`의 오버로드가 그
 * 사실을 타입으로 말한다).
 */
export function attributionOf(row: ProductRow, asOf: string): Attribution {
  // 상환 완료가 먼저다 — 위 ③(만기 상환 + 일정 0건)이 이 순서에 달려 있다.
  if (row.redemptions != null) {
    return {
      kind: 'REDEEMED',
      year: attributionYear({ redemptionDate: row.redemptions.redemption_date }),
      redemption: row.redemptions,
    }
  }

  const next = nextEvaluation({
    schedules: row.redemption_schedules.map((s) => ({
      roundNo: s.round_no,
      evaluationDate: s.evaluation_date,
      row: s,
    })),
    asOf,
  })
  if (next == null) return { kind: 'NO_ROUND', year: null }

  return {
    kind: 'ESTIMATED',
    year: attributionYear({ evaluationDate: next.evaluationDate }),
    round: next.row,
  }
}
