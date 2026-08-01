import { dec } from '@/lib/decimal'

import type {
  ProductInput,
  RedemptionInput,
  ScheduleInput,
  UnderlyingInput,
} from '../mutations/types'
import type { Problems, RuleId } from './primitives'

/**
 * 검증 규칙 — DOC-011 §6이 정본이다. **규칙 ID가 함수 이름이다.**
 *
 * 필드 단위 규칙(V-01·V-08·V-11·V-15·V-19·V-20)은 `inputs.ts`의 셰이프 파싱이
 * 같은 ID를 달아 기록한다 — 형식 검사와 범위 검사를 두 번 순회하지 않기 위함이다.
 * 이 파일은 **교차 필드 규칙**을 담는다. 어느 쪽이든 위반에는 ID가 붙으므로
 * 전수 열거 단언(`tests/db/validate.test.ts`)이 빠짐을 잡는다.
 */

/**
 * §6 표의 ID 전체 — **정의는 `primitives.ts`에 있고 여기서 재export한다.**
 *
 * `Problems.add`가 `RuleId`를 받으려면 수집기 쪽이 그 타입을 알아야 하는데
 * 이 파일은 이미 `Problems`를 import하므로 반대 방향을 더하면 순환이 된다.
 * 소비자(`tests/db/validate.test.ts`)의 import 경로를 바꾸지 않으려고
 * 이름은 여기 그대로 남긴다.
 */
export { RULE_IDS, type RuleId } from './primitives'

/** 각 규칙의 대상 — 문서 §6 표의 요약. 로그와 테스트 이름이 읽는다 */
export const RULE_TARGETS: Record<RuleId, string> = {
  'V-01': 'principal — 0보다 큰 정수',
  'V-02': 'underlyings — 1개 이상 (I-07)',
  'V-03': 'schedules — 1개 이상, 길이 = totalRounds (I-07)',
  'V-04': 'roundNo — 1부터 연속, 중복 없음 (I-03)',
  'V-05': 'lizardBarrier — barrier 이하 (I-04)',
  'V-06': 'lizardCouponRate — lizardBarrier 존재 시 필수 (I-10)',
  'V-07': 'evaluationDate — 차수 순 증가, 최초 차수 ≥ issueDate',
  'V-08': '비율 — 상한 2, 하한은 필드별',
  'V-09': 'assetId — 상품 내 중복 불가 (I-02)',
  'V-10': 'redemptionDate — issueDate 이후',
  'V-11': 'taxableIncome — 0 이상 (I-12)',
  'V-12': 'MATURITY_LOSS — taxableIncome = 0 (I-08)',
  'V-13': 'roundNo — EARLY·LIZARD인 경우 필수 (I-14)',
  'V-14': 'LIZARD — 해당 차수 실재 + 리자드 조건 정의 (I-13)',
  'V-15': 'price — 0보다 큼',
  'V-16': 'kiObservation — kiBarrier 존재 시 필수, 부재 시 입력 불가 (I-11)',
  'V-17': 'asOfDate — 미래 일자 거부',
  'V-18': 'kiTouchedAt — kiBarrier 부재 시 입력 불가 (I-15)',
  'V-19': '문자열 — 열 선언 길이 이내, currency는 정확히 3자',
  'V-20': '정수 — smallint 범위, evaluationPeriodMonths ≥ 1, year 4자리',
}

// ---------------------------------------------------------------------------
// 상품 — 교차 필드
// ---------------------------------------------------------------------------

/** V-02 — I-07. 계약을 경유하는 어떤 조작도 기초자산 0건을 만들 수 없다(§5.3) */
export function V02_underlyingsPresent(p: Problems, underlyings: readonly unknown[]): void {
  if (underlyings.length === 0) {
    p.add('V-02', 'underlyings', '기초자산을 1개 이상 입력한다.')
  }
}

/**
 * V-03 — 1개 이상 + **길이 = 입력의 `totalRounds`**.
 *
 * 저장된 값과 대조하지 않는다 — `total_rounds` 컬럼은 DQ-05로 삭제되었고 총 차수는
 * 입력 안에만 있다. 자기 검증처럼 보이지만 의미가 있다: 총 차수는 사용자가 직접
 * 입력하고 배리어 스케줄(`90-85-80-…`)은 일괄 파싱되므로, **파싱 결과의 길이가
 * 입력한 차수와 다르면 그것은 파서나 입력의 오류다.**
 */
export function V03_schedulesMatchTotalRounds(
  p: Problems,
  schedules: readonly unknown[],
  totalRounds: number | undefined,
): void {
  if (schedules.length === 0) {
    p.add('V-03', 'schedules', '평가일정을 1개 이상 입력한다.')
    return
  }
  if (totalRounds != null && schedules.length !== totalRounds) {
    p.add(
      'V-03',
      'schedules',
      `평가일정 ${schedules.length}건이 총 차수 ${totalRounds}과 다르다. 배리어 스케줄 입력을 확인한다.`,
    )
  }
}

/**
 * V-04 — 1부터 연속, 중복 없음 (I-03).
 *
 * **연속성은 계약 계층에만 있다.** DB는 `UNIQUE(els_id, round_no)`로 중복만 막으므로
 * `1, 2, 99`가 저장될 수 있고, 그래서 DQ-05가 총 차수의 정본을 `max(round_no)`가
 * 아니라 **행 수**로 정했다. 쓰기 함수를 직접 부르면 이 검사를 지나지 않는다(AQ-29).
 */
export function V04_roundNoSequence(p: Problems, schedules: readonly ScheduleInput[]): void {
  const seen = new Set<number>()

  for (const [index, schedule] of schedules.entries()) {
    if (seen.has(schedule.roundNo)) {
      p.add('V-04', `schedules[${index}].roundNo`, `차수 ${schedule.roundNo}이(가) 중복된다.`)
      continue
    }
    seen.add(schedule.roundNo)
  }

  // 연속성은 집합으로 본다 — 입력 순서가 차수 순이라고 전제하지 않는다.
  for (let round = 1; round <= schedules.length; round += 1) {
    if (!seen.has(round)) {
      p.add('V-04', 'schedules', `차수 번호는 1부터 ${schedules.length}까지 연속이어야 한다.`)
      break
    }
  }
}

/** V-05 — 리자드 배리어는 해당 차수의 조기상환 배리어 이하 (I-04) */
export function V05_lizardBarrierWithinBarrier(
  p: Problems,
  schedules: readonly ScheduleInput[],
): void {
  for (const [index, schedule] of schedules.entries()) {
    if (schedule.lizardBarrier == null) continue
    if (dec(schedule.lizardBarrier).gt(dec(schedule.barrier))) {
      p.add(
        'V-05',
        `schedules[${index}].lizardBarrier`,
        '리자드 배리어는 해당 차수의 조기상환 배리어 이하여야 한다.',
      )
    }
  }
}

/**
 * V-06 — 리자드 배리어가 있으면 쿠폰율은 필수 (I-10).
 *
 * **원금상환형은 `0`으로 입력한다.** `null`을 0이나 연쿠폰율로 대체하면 수령액이
 * 실제와 어긋나므로(전자는 과소, 후자는 과대) 순수 모듈이 거부한다(DOC-007 §4.1).
 */
export function V06_lizardCouponRequired(
  p: Problems,
  schedules: readonly ScheduleInput[],
): void {
  for (const [index, schedule] of schedules.entries()) {
    if (schedule.lizardBarrier == null) continue
    if (schedule.lizardCouponRate == null) {
      p.add(
        'V-06',
        `schedules[${index}].lizardCouponRate`,
        '리자드 배리어가 있으면 리자드 쿠폰율이 필요하다. 원금상환형은 0으로 입력한다.',
      )
    }
  }
}

/**
 * V-07 — 평가일은 차수 순으로 증가하고 최초 차수는 발행일 이후다.
 *
 * **날짜를 문자열로 비교한다.** 형식이 이미 `YYYY-MM-DD`로 검증되었으므로 사전순이
 * 곧 시간순이며, 이 비교에는 예외 경로가 없다 — 순수 모듈에 날짜를 넘기면 그쪽의
 * `RangeError`를 §3.2.2로 변환하는 층이 하나 더 필요해진다.
 */
export function V07_evaluationDatesIncrease(
  p: Problems,
  schedules: readonly ScheduleInput[],
  issueDate: string | undefined,
): void {
  const ordered = [...schedules].sort((a, b) => a.roundNo - b.roundNo)

  for (const [index, schedule] of ordered.entries()) {
    const previous = ordered[index - 1]
    if (previous != null && schedule.evaluationDate <= previous.evaluationDate) {
      p.add(
        'V-07',
        `schedules[${index}].evaluationDate`,
        `${schedule.roundNo}차 평가일이 이전 차수보다 늦어야 한다.`,
      )
    }
  }

  const first = ordered[0]
  if (issueDate != null && first != null && first.evaluationDate < issueDate) {
    p.add('V-07', 'schedules[0].evaluationDate', '최초 평가일은 발행일 이후여야 한다.')
  }
}

/** V-09 — 상품 내 기초자산 중복 불가 (I-02) */
export function V09_underlyingAssetsUnique(
  p: Problems,
  underlyings: readonly UnderlyingInput[],
): void {
  const seen = new Set<string>()
  for (const [index, underlying] of underlyings.entries()) {
    if (seen.has(underlying.assetId)) {
      p.add('V-09', `underlyings[${index}].assetId`, '같은 기초자산을 두 번 넣을 수 없다.')
      continue
    }
    seen.add(underlying.assetId)
  }
}

/**
 * V-16 — `kiBarrier`와 `kiObservation`은 짝이다 (I-11).
 *
 * 배리어만 있으면 보조 판정이 `CONTINUOUS`(장중)와 `CLOSING`(종가) 중 무엇으로
 * 관측할지 결정할 수 없고, 두 방식은 요구하는 데이터가 다르므로 임의로 하나를
 * 가정할 수 없다(D-04).
 */
export function V16_kiPair(
  p: Problems,
  input: { kiBarrier?: string; kiObservation?: string },
): void {
  if (input.kiBarrier != null && input.kiObservation == null) {
    p.add('V-16', 'kiObservation', 'KI 배리어가 있으면 관찰 방식을 선택한다.')
  }
  if (input.kiBarrier == null && input.kiObservation != null) {
    p.add('V-16', 'kiObservation', '노낙인 상품에는 관찰 방식을 둘 수 없다.')
  }
}

/** 상품 입력의 교차 필드 규칙 전체 */
export function validateProductCrossFields(p: Problems, input: ProductInput): void {
  V02_underlyingsPresent(p, input.underlyings)
  V03_schedulesMatchTotalRounds(p, input.schedules, input.totalRounds)
  V04_roundNoSequence(p, input.schedules)
  V05_lizardBarrierWithinBarrier(p, input.schedules)
  V06_lizardCouponRequired(p, input.schedules)
  V07_evaluationDatesIncrease(p, input.schedules, input.issueDate)
  V09_underlyingAssetsUnique(p, input.underlyings)
  V16_kiPair(p, input)
}

// ---------------------------------------------------------------------------
// 상환
// ---------------------------------------------------------------------------

/**
 * V-12 — `MATURITY_LOSS`의 과세 금융소득은 `0`이다 (I-08, 절대 규칙 #8).
 *
 * ELS 손실은 다른 금융소득과 통산되지 않으므로 음수도 양수도 될 수 없다. DB `CHECK`가
 * 최종 보장이며 이 규칙은 **필드별 오류 표시**를 위한 것이다 — 두 층의 역할이 다르다.
 */
export function V12_maturityLossZero(
  p: Problems,
  // **`RedemptionInput`으로 좁히지 않는다.** §5.11 기실현 등재도 같은 규칙을
  // 지나야 하고(절대 규칙 #8) 그 입력에는 `roundNo`·`note`가 없다. 이 규칙이
  // 실제로 읽는 두 필드만 요구하면 두 계약이 **같은 함수**를 부를 수 있다 —
  // 복제하면 한쪽만 고쳐지는 날이 오고, 그때 틀리는 것은 세액이다.
  input: { redemptionType: RedemptionInput['redemptionType']; taxableIncome: string },
): void {
  if (input.redemptionType !== 'MATURITY_LOSS') return
  if (!dec(input.taxableIncome).eq(0)) {
    p.add('V-12', 'taxableIncome', '만기상환(손실)의 과세 금융소득은 0이어야 한다.')
  }
}

/** V-13 — 조기·리자드 상환은 차수를 갖는다 (I-14) */
export function V13_roundNoRequired(p: Problems, input: RedemptionInput): void {
  const needsRound = input.redemptionType === 'EARLY' || input.redemptionType === 'LIZARD'
  if (needsRound && input.roundNo == null) {
    p.add('V-13', 'roundNo', '조기상환·리자드 상환은 차수를 선택한다.')
  }
}

/**
 * V-10 — 상환일은 발행일 이후다.
 *
 * **DB에 없는 검사다.** 상환일은 `redemptions`에 있고 발행일은 `els_products`에
 * 있으므로 단일 행 `CHECK`로 표현할 수 없다(DOC-002 DQ-06의 서술 오류를 v0.6에서
 * 정정했다). 계약 계층이 유일한 방어이며 그래서 상품을 먼저 읽는다.
 */
export function V10_redemptionAfterIssue(
  p: Problems,
  redemptionDate: string,
  issueDate: string,
): void {
  if (redemptionDate < issueDate) {
    p.add('V-10', 'redemptionDate', '상환일은 발행일 이후여야 한다.')
  }
}

/**
 * V-14 — 리자드 상환은 해당 차수에 **리자드 조건이 정의되어 있어야** 한다.
 *
 * 차수의 실재는 I-13(복합 FK)이 DB에서도 막지만, "그 차수에 리자드 조건이 있는가"는
 * 어떤 제약도 보지 않는다 — 리자드 조건 없는 차수에 리자드 상환을 붙이면
 * `applicableCouponRate`가 쿠폰율을 찾지 못해 수령액을 산출할 수 없다(DOC-007 §4.1).
 */
export function V14_lizardRoundDefined(
  p: Problems,
  input: RedemptionInput,
  schedule: { lizardBarrier: string | null; lizardCouponRate: string | null } | null,
): void {
  if (input.redemptionType !== 'LIZARD') return

  if (schedule == null) {
    p.add('V-14', 'roundNo', '해당 차수가 이 상품에 없다.')
    return
  }
  if (schedule.lizardBarrier == null || schedule.lizardCouponRate == null) {
    p.add('V-14', 'roundNo', '해당 차수에는 리자드 조건이 정의되어 있지 않다.')
  }
}

/** 상환 입력의 교차 필드 규칙 — 상품을 읽지 않고 볼 수 있는 것만 */
export function validateRedemptionCrossFields(p: Problems, input: RedemptionInput): void {
  V12_maturityLossZero(p, input)
  V13_roundNoRequired(p, input)
}

// ---------------------------------------------------------------------------
// 시세 · KI 터치
// ---------------------------------------------------------------------------

/**
 * V-17 — 기준일 이후의 시세는 존재할 수 없다.
 *
 * **DB `CHECK`로 만들 수 없다.** `current_date`는 `IMMUTABLE`이 아니므로 CHECK 표현식에
 * 쓸 수 없고, 넣더라도 오늘 유효했던 행이 내일 제약을 위반하는 상태가 된다. 미래 일자
 * 시세는 워스트오브를 실제와 다르게 만들어 **존재하지 않는 조기상환을 표시**하므로
 * 입력 시점이 유일한 방어다. 조회 계층의 `asOf` 상한(D6)은 이미 저장된 미래 시세를
 * 판정에서 배제하는 별개의 방어다.
 */
export function V17_notFuture(p: Problems, asOfDate: string, asOf: string): void {
  if (asOfDate > asOf) {
    p.add('V-17', 'asOfDate', `기준일(${asOf}) 이후의 시세는 입력할 수 없다.`)
  }
}

/**
 * V-18 — `kiTouchedAt`은 `kiBarrier`가 있을 때만 존재한다 (I-15).
 *
 * 노낙인 상품에 터치 이력이 붙으면 **저장된 사실이 계산에서 사라진다** — 판정은
 * `ki_barrier IS NULL`을 노낙인으로 보고 터치 이력을 아예 읽지 않으므로(E-06),
 * `lizardRequiresNoKi`인 차수가 KI 터치에도 충족으로 판정되어 수령액이 틀린다.
 */
export function V18_kiTouchedRequiresBarrier(
  p: Problems,
  touchedAt: string | null,
  product: { kiBarrier: string | null },
): void {
  if (touchedAt != null && product.kiBarrier == null) {
    // ★ 키는 `kiTouchedAt`이다 — 파라미터 이름(`touchedAt`)이 아니다. 같은 규칙을
    //   DB가 잡을 때(`els_products_ki_touched_check`)도 같은 키이며, 층에 따라
    //   다른 칸을 가리키면 화면이 같은 위반에 두 곳을 표시한다(§5.9 v1.1 각주).
    p.add('V-18', 'kiTouchedAt', '노낙인 상품에는 KI 터치를 설정할 수 없다.')
  }
}
