import type { ProductDetailView } from '@/lib/db/queries/map'

import { path } from './fieldPath'
import { ratioToPercent } from './parse'
import { BARRIERS_FIELD, SCHEDULE_SUBS, UNDERLYING_SUBS } from './steps'

/**
 * 상세 뷰 → 폼 값 맵 — **`parseProductForm`의 역이다** (SCR-204 수정 모드, P4 컷 5)
 *
 * ## 왕복이 닫혀야 하는 이유는 §5.2가 전체 교체라는 것이다
 *
 * `updateProduct`는 상품 열을 갱신하고 하위 배열을 **통째로 갈아치운다**. 그러므로
 * 폼이 다루지 않는 필드는 저장 시 **비워진다** — 누락이 곧 비움이고, 그 사실이
 * `productPayload`의 `?? null`에 드러나 있다. 여기서 한 칸을 빠뜨리면 수정 저장이
 * 그 값을 조용히 지우고, 증상은 저장 후 상세 화면에서야 보인다.
 *
 * 그래서 이름 목록을 여기 적지 않는다. 배열의 하위 이름은 `UNDERLYING_SUBS`·
 * `SCHEDULE_SUBS`를 쓰고, **빠짐은 테스트가 파생으로 잡는다** —
 * `productFieldNames(counts)`의 모든 이름이 이 함수의 반환에 있어야 한다
 * (`tests/app/values.test.ts`). 단언이 아니라 파생이므로 폼에 칸이 늘면 그쪽이
 * 먼저 빨간불이 된다.
 *
 * ## 비율은 퍼센트로 되돌린다
 *
 * 계약은 소수 4자리를 주고(`ratioString`) 폼의 모든 비율 칸은 퍼센트다. 옮기지
 * 않으면 화면이 `0.9`를 보여주고 저장이 그것을 다시 100으로 나눠 **배리어가
 * 0.009가 된다** — 값이 밀리는 부류이고 오류가 나지 않는다.
 *
 * ## 담지 않는 것 둘
 *
 * | 이름 | 왜 비우는가 |
 * |---|---|
 * | `barriers` | 계약의 필드가 아니라 **차수별 칸을 채우는 도구**다(SQ-04). 채워 두면 「일괄 적용」이 이미 눌린 것처럼 보이는데 그 값은 저장된 것이 아니다 |
 * | `step` | 폼이 정한다. 수정도 ①에서 시작한다 |
 *
 * **평가일도 담지 않는다.** 생성값이므로(DOC-008 §5 SCR-204 v0.5) 발행일·평가주기·
 * 총 차수에서 다시 나온다. 결과로 **수정 저장은 평가일을 재생성한다** — 저장된
 * 날짜가 그 산식과 다르면 수정이 그것을 산식대로 바꾼다. 히든으로 나르는 대안은
 * 발행일을 고친 뒤 ③을 지나지 않고 저장하는 경로에서 고치기 전 날짜를 저장하므로
 * 더 나쁘다(같은 각주가 등록 모드에서 이미 그 판단을 내렸다).
 */
export function productValuesOf(view: ProductDetailView): Record<string, string> {
  const { product } = view

  const values: Record<string, string> = {
    name: product.name,
    issuer: product.issuer ?? '',
    issueDate: product.issueDate,
    // 금액은 숫자만이다 — 파서가 쉼표를 지우므로 쉼표를 붙여도 왕복하지만, 저장된
    // 값을 그대로 보여주는 편이 「무엇이 저장되어 있는가」에 대한 답이다.
    principal: product.principal,
    accountType: product.accountType,
    note: product.note ?? '',

    evaluationPeriodMonths: String(product.evaluationPeriodMonths),
    // 정본은 **행 수**다(뷰의 `totalRounds`가 그렇게 만들어진다) — `max(round_no)`가
    // 아니다. DB는 차수 `1, 2, 99`를 허용하므로 두 값이 갈릴 수 있고, 그때 차수표가
    // 99행이 되면 사용자가 고칠 수 없는 화면이 된다.
    totalRounds: String(view.schedules.length),
    annualCouponRate: ratioToPercent(product.annualCouponRate),
    kiBarrier: product.kiBarrier == null ? '' : ratioToPercent(product.kiBarrier),
    kiObservation: product.kiObservation ?? '',
    [BARRIERS_FIELD]: '',
  }

  view.underlyings.forEach((underlying, index) => {
    values[path('underlyings', index, UNDERLYING_SUBS[0])] = underlying.assetId
    values[path('underlyings', index, UNDERLYING_SUBS[1])] = underlying.basePrice
  })

  view.schedules.forEach((schedule, index) => {
    const at = (sub: (typeof SCHEDULE_SUBS)[number]): string =>
      path('schedules', index, sub)

    values[at('barrier')] = ratioToPercent(schedule.barrier)
    values[at('lizardBarrier')] =
      schedule.lizardBarrier == null ? '' : ratioToPercent(schedule.lizardBarrier)
    values[at('lizardCouponRate')] =
      schedule.lizardCouponRate == null ? '' : ratioToPercent(schedule.lizardCouponRate)
    /*
     * 체크박스의 값은 존재 여부로 읽힌다(`checkbox()`가 빈 문자열도 거짓으로 본다).
     * `null`과 `false`가 같은 `''`가 되는데, 판정은 `lizard_requires_no_ki`를
     * 참인지만 보므로(DOC-007 §3) 두 값의 뜻이 같다 — 수정 저장이 `null`을
     * `false`로 정규화하는 것은 값의 상실이 아니다.
     */
    values[at('lizardRequiresNoKi')] = schedule.lizardRequiresNoKi === true ? 'on' : ''
  })

  return values
}
