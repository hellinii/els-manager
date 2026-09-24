import type { ProductDetailView } from '@/lib/db/queries/map'

import { path } from './fieldPath'
import { ratioToPercent } from './parse'
import { BARRIERS_FIELD, SCHEDULE_SUBS, UNDERLYING_SUBS } from './productForm'
import { EVALUATION_DATE_BASIS_FIELD, evaluationDateBasisOf } from './schedules'

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
 * ## 담지 않는 것 하나
 *
 * | 이름 | 왜 비우는가 |
 * |---|---|
 * | `barriers` | 계약의 필드가 아니라 **차수별 칸을 채우는 도구**다(SQ-04). 채워 두면 「일괄 적용」이 이미 눌린 것처럼 보이는데 그 값은 저장된 것이 아니다 |
 *
 * ## ★ 평가일을 담는다 (DOC-008 v2.8) — 전체 교체가 날짜를 보존하는 근거가 이것이다
 *
 * 평가일이 차수별 입력값이 되었으므로(DOC-002 §4.8 v1.6) 저장된 날짜가 곧 초기값이다.
 * 담지 않으면 §5.2 전체 교체가 칸의 빈 값을 넣고, 저장 제출이 그 빈 칸을 산식으로
 * 채워 **불러온 실제 날짜(E04000의 휴장일 조정)가 조용히 산식으로 바뀐다.** 종전
 * (v2.7까지)의 근거였던 「재생성이 멱등」은 산식이 정본이던 동안만 참이었다.
 *
 * **평가일 기준도 담는다** — 저장된 발행일·주기다. 저장값이 그 기준의 산식과 같으면
 * (운영 11건) 발행일을 고친 저장이 날짜를 옮기고, 다르면(실제 날짜) 옮기지 않고
 * 보류한다(`applyEvaluationDates`). 기준을 비워 두면 그 판정이 **현재** 발행일과
 * 대조하게 되어, 발행일을 고친 순간 산식대로이던 날짜가 「실제 날짜」로 읽힌다.
 *
 * (`step` 행이 있었다. 단계 분리를 철회하며 그 이름이 사라졌다.)
 */
export function productValuesOf(view: ProductDetailView): Record<string, string> {
  const { product } = view

  const values: Record<string, string> = {
    name: product.name,
    issuer: product.issuer ?? '',
    // 기실현 등재는 `null`이다(D-07). 이 폼(SCR-204)은 그 상품의 저장을 이미
    // `CONFLICT`로 막으므로(상환 완료) 빈 칸이 보이는 것이 최종 상태다 — 채울
    // 값을 지어내면 「저장할 수 있다」는 거짓을 화면이 말한다.
    issueDate: product.issueDate ?? '',
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
    annualCouponRate:
      product.annualCouponRate == null
        ? ''
        : ratioToPercent(product.annualCouponRate),
    kiBarrier: product.kiBarrier == null ? '' : ratioToPercent(product.kiBarrier),
    kiObservation: product.kiObservation ?? '',
    [BARRIERS_FIELD]: '',
  }
  values[EVALUATION_DATE_BASIS_FIELD] = evaluationDateBasisOf(values)

  view.underlyings.forEach((underlying, index) => {
    values[path('underlyings', index, UNDERLYING_SUBS[0])] = underlying.assetId
    values[path('underlyings', index, UNDERLYING_SUBS[1])] = underlying.basePrice
  })

  view.schedules.forEach((schedule, index) => {
    const at = (sub: (typeof SCHEDULE_SUBS)[number]): string =>
      path('schedules', index, sub)

    values[at('evaluationDate')] = schedule.evaluationDate
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
