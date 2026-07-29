import type { ProductDetailView, RedemptionView } from '@/lib/db/queries/map'

/**
 * SCR-203 상환 처리의 폼 값 — **순수**하다 (P4 컷 6, DOC-008 §5·DOC-011 §5.4·§5.5)
 *
 * ## 초기값이 이 파일의 이유다
 *
 * DOC-008은 「조건 판정 결과에 따라 유형·차수·예상 수령액을 자동 채움」을 요구한다.
 * 그 산출을 화면 안에 두면 어떤 스위트도 보지 못하고(AQ-23), 무엇보다 **자동 채움이
 * 틀리면 사용자가 그것을 확정값으로 저장한다** — 상환 실적은 세금 집계의 입력이므로
 * (§4.6) 틀린 기본값 하나가 그 해의 세액을 바꾼다.
 *
 * ## 채우는 것과 비우는 것을 나눈다
 *
 * | 칸 | 기본값 | 근거 |
 * |---|---|---|
 * | `roundNo`·`grossAmount`·`taxableIncome` | 적용 차수의 추정값 | §4.3 `projection`. 적용 차수가 없으면 비운다 |
 * | `redemptionType` | 판정이 **확정적일 때만**(`EARLY`·`LIZARD`) **그리고 적용 차수가 마지막이 아닐 때만** | `CARRY_OVER`는 「상환이 아니다」이므로 채우면 없는 판단을 지어낸다. 마지막 차수는 `isFinalRound`의 머리글 |
 * | `redemptionDate` | 기준일 | 계약이 미래 일자를 거부하지 않으므로(V-10은 발행일 이후만 본다) `max`도 두지 않는다 |
 * | `withholdingTax` | **비운다** | 계약이 `taxableIncome × 분리과세율`로 산출한다(§5.4). 채우면 그 산출이 영원히 실행되지 않는다 |
 * | `isConfirmed` | 거짓 | 「증권사가 제공한 실제 값」이므로(DOC-005 §6) 기본 참이면 추정값이 확정값으로 저장된다(ST-05) |
 *
 * `note`는 비운다 — 안내 문구(§7 용어 대응)는 화면에 있고 값이 아니다.
 */

/** 상환 폼의 칸. `toFormState`가 미매칭 오류를 가르는 기준이다 */
export const REDEMPTION_FIELDS = [
  'redemptionType',
  'roundNo',
  'redemptionDate',
  'grossAmount',
  'taxableIncome',
  'withholdingTax',
  'isConfirmed',
  'note',
] as const

/**
 * 대상 상환 id — 수정·취소가 나른다.
 *
 * §5.5의 두 계약은 상품이 아니라 **상환 id**를 받는다(소유 판정은 부모 상품을
 * 경유한다). `PRODUCT_ID_FIELD`와 다른 이름인 이유가 그것이며, 무효화 맵이
 * 종전에 `/products/{id}`를 적을 수 없었던 이유와 같은 사실이다(컷 1b).
 */
export const REDEMPTION_ID_FIELD = 'redemptionId'

/**
 * 차수 선택지 — 계약이 요구하는 것만 담는다.
 *
 * `hasLizard`가 필요한 이유는 V-14다: 리자드 상환은 **그 차수에 리자드 조건이
 * 정의되어 있어야** 한다. 화면이 그 사실을 보여주지 않으면 사용자가 조건 없는 차수에
 * 리자드를 붙이고, 오류 문구(「해당 차수에는 리자드 조건이 정의되어 있지 않다」)를
 * 받은 뒤에야 어느 차수를 골라야 하는지 알게 된다.
 */
export type RoundOption = {
  roundNo: number
  evaluationDate: string
  hasLizard: boolean
}

export function roundOptionsOf(view: ProductDetailView): RoundOption[] {
  return view.schedules.map((schedule) => ({
    roundNo: schedule.roundNo,
    evaluationDate: schedule.evaluationDate,
    hasLizard: schedule.lizardBarrier != null,
  }))
}

/** 판정이 상환 유형을 확정하는 두 경우. `CARRY_OVER`·`null`은 채우지 않는다 */
const DECISIVE: Record<string, string> = { EARLY: 'EARLY', LIZARD: 'LIZARD' }

/**
 * 마지막 차수인가 — **행 수(`totalRounds`)로 판정하지 않는다**
 *
 * `product.totalRounds`는 `schedules.length`이고(DQ-05가 정본을 행 수로 정했다)
 * DB는 차수 번호 `1, 2, 99`를 허용한다 — V-04(연속성)는 **계약 계층에만** 있고
 * 쓰기 함수는 보지 않는다(DOC-011 AQ-29). 그 상품에서 `totalRounds`는 3이므로
 * `appliedRoundNo === totalRounds`로 판정하면 **99차(실제 마지막)를 마지막이 아니라고
 * 답한다** — 아래 가드가 통째로 새는 형태다. 최대 차수와 비교한다.
 *
 * 차수가 아니라 평가일로 판정할 수도 있으나(V-07이 둘의 순서를 일치시킨다) DOC-002는
 * 만기일을 「**마지막 차수** 평가일」로 정의하므로 차수를 정본으로 둔다. 두 값이
 * 갈리는 상품은 계약을 우회해 만들어진 것이며 그때도 이 판정은 문서의 정의를 따른다.
 */
function isFinalRound(roundNo: number, schedules: readonly { roundNo: number }[]): boolean {
  // 도달 불가 가드 — 호출부가 `round != null`일 때만 부르고 그 `round`는
  // `view.schedules.find(...)`의 결과이므로 배열이 비어 있으면 `round`가 `null`이다.
  // `Math.max()`가 `-Infinity`를 내는 것을 막는 값싼 방어로 남긴다.
  if (schedules.length === 0) return false
  // 스프레드의 인자 수 상한이 문제되지 않는다. **`MAX_ROUNDS`(=60)가 근거가 아니다** —
  // 그것은 폼 계층의 렌더·미리보기 상한일 뿐이고 계약도 조회도 `schedules.length`를
  // 묶지 않는다(V-03은 `totalRounds`와의 일치만 보고 `max`가 없으며, 임베드 배열이라
  // Q-06의 행 상한도 세지 않는다). 실제 상한은 **스키마**가 준다: `round_no`가
  // `smallint`이고 `unique (els_id, round_no)`이므로 상품당 최대 32,767차다 —
  // 실측으로 그 수의 스프레드가 정상이고 파열점(약 20만)의 1/6이다.
  return roundNo === Math.max(...schedules.map((s) => s.roundNo))
}

/**
 * §5.4 상환 처리의 기본값 — 조건 판정에서 나온다.
 *
 * `asOf`를 인자로 받는다 — 화면이 `new Date()`를 부르면 요청당 한 번이라는 규약이
 * 깨진다(Q-02). `getAsOf()`가 계약과 같은 값을 준다.
 */
export function redemptionDefaults(
  view: ProductDetailView,
  asOf: string,
): Record<string, string> {
  const applied = view.projection
  const round =
    applied == null
      ? null
      : (view.schedules.find((s) => s.roundNo === applied.appliedRoundNo) ?? null)

  /*
   * ★ **마지막 차수에서는 유형을 비운다** (P4.5, DOC-008 §5 SCR-203의 별 각주).
   *
   * 두 축의 값 집합이 다르다 — 판정 축 `conditionResult`는 셋(`EARLY`·`LIZARD`·
   * `CARRY_OVER`)이고 실적 축 `redemptionType`은 **넷**이다(+ `MATURITY_GAIN`·
   * `MATURITY_LOSS`). DOC-005 §2는 두 축이 같은 코드 값을 갖는 것이 의도라고 적지만
   * **값 집합이 같다고는 적지 않는다.** v0.7의 이 줄은 그 차이를 보지 않고 확정 판정
   * 둘을 항등으로 옮겼다.
   *
   * `evaluateCondition`(DOC-007 §3.2)은 차수가 마지막인지 보지 않으므로 마지막 차수에서
   * `W ≥ B(n)`이면 `EARLY`를 낸다. DOC-005는 `EARLY`를 「만기 **전** 평가일에」로
   * 정의하므로 그 상환은 정의상 `MATURITY_GAIN`이고, 기본값을 그대로 저장하면
   * **만기상환이 조기상환으로 기록된다** — 그 기록은 §4.6 집계의 입력이다.
   *
   * **채우지 않고 비운다.** 마지막 차수에서 `MATURITY_GAIN`·`MATURITY_LOSS`를 가르는
   * 것은 손익 판정이므로 실수령액을 알아야 하고, 그 값은 사용자가 입력할 칸에 있다 —
   * 화면이 미리 알 수 없으므로 비우는 것이 차선이 아니라 정확한 답이다.
   *
   * **판정 축은 건드리지 않는다.** 만기 개념을 `evaluateCondition`에 넣는 것은
   * DOC-007의 변경이고 TC-01~22가 정본이다(절대 규칙 #1). 두 축의 차이를 실적 축으로
   * 옮기는 이 자리에서 흡수한다.
   */
  const finalRound = round != null && isFinalRound(round.roundNo, view.schedules)

  return {
    // 판정이 확정적일 때만, 그리고 마지막 차수가 아닐 때만 채운다 —
    // 없는 판단을 지어내지 않는다.
    redemptionType: finalRound ? '' : (DECISIVE[round?.conditionResult ?? ''] ?? ''),
    roundNo: applied == null ? '' : String(applied.appliedRoundNo),
    redemptionDate: asOf,
    grossAmount: applied?.expectedGross ?? '',
    taxableIncome: applied?.expectedTaxableIncome ?? '',
    // 비운다 — 계약이 산출한다(§5.4). 채우면 그 산출이 영원히 실행되지 않는다.
    withholdingTax: '',
    isConfirmed: '',
    note: '',
  }
}

/**
 * §5.5 상환 수정의 초기값 — **저장된 값이다. 추정이 아니다.**
 *
 * `updateRedemption`도 전체 교체이므로(모든 열을 실어 보낸다) 여기서 한 칸을
 * 빠뜨리면 수정이 그 값을 지운다 — `productValuesOf`와 같은 위험이며 같은 방식으로
 * 파생 테스트가 잡는다(`REDEMPTION_FIELDS` 전수).
 *
 * **`withholdingTax`는 저장된 값을 그대로 보여준다.** 비우면 재산출되는데, 사용자가
 * 「비고만 고치려던」 수정에서 증권사가 확정한 징수액이 우리 산출값으로 바뀐다 —
 * A-04를 뒤집는 조용한 변경이다.
 */
export function redemptionValuesOf(redemption: RedemptionView): Record<string, string> {
  return {
    redemptionType: redemption.redemptionType,
    roundNo: redemption.roundNo == null ? '' : String(redemption.roundNo),
    redemptionDate: redemption.redemptionDate,
    grossAmount: redemption.grossAmount,
    taxableIncome: redemption.taxableIncome,
    withholdingTax: redemption.withholdingTax ?? '',
    isConfirmed: redemption.isConfirmed ? 'on' : '',
    note: redemption.note ?? '',
  }
}

/**
 * 만기손실은 과세 금융소득이 **0으로 고정**된다 — DOC-008 §5, V-12, 절대 규칙 #8.
 *
 * 화면이 그 칸을 읽기 전용으로 만드는 판단이 여기 있다. 컴포넌트에 두면 「어느
 * 유형이 고정인가」가 마크업 안의 문자열 비교가 되고, 유형이 늘면 한쪽만 고쳐진다.
 */
export function taxableIncomeLocked(redemptionType: string): boolean {
  return redemptionType === 'MATURITY_LOSS'
}
