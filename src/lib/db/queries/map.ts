import {
  amountString,
  dec,
  roundToUnit,
  type DecimalValue,
} from '@/lib/decimal'
import {
  asActive,
  dDay,
  evaluateCondition,
  grossExpected,
  isPast,
  isRedeemed,
  kiStatus,
  overdueEvaluations,
  realizedPnl,
  taxableIncome,
  underlyingRatio,
  worstOf,
  type ConditionResult,
  type KiObservation,
  type KiStatus,
  type RedemptionMark,
} from '@/lib/domain'

import { koreanAmount } from '@/lib/format/money'
import type { LizardTerm } from '@/lib/format/terms'
import {
  underlyingLines,
  type UnderlyingLine,
  type UnderlyingQuote,
  type UnderlyingTerm,
} from '@/lib/format/underlyings'
import { separateTaxationWithholding, type TaxConstants } from '@/lib/tax'

import { attributionOf, type Attribution } from './attribution'
import type {
  LatestPrice,
  ProductRow,
  ScheduleRow,
  UnderlyingRow,
} from './load'

/**
 * 행 → 뷰 매핑 — **순수**하다. 클라이언트를 모른다.
 *
 * ## `Active<T>` 브랜드는 이 파일을 벗어나지 않는다
 *
 * 브랜드는 `unique symbol`이므로 **직렬화를 넘지 못한다** — 서버 컴포넌트에서
 * 클라이언트로 넘어가는 순간 사라지고, 그러면 타입은 브랜드가 있다고 말하는데
 * 실제 값에는 없는 상태가 된다. 그래서 행을 판정 파라미터로 좁혀
 * `asActive(params, mark)`를 통과시킨 뒤 `evaluateCondition`·`kiStatus`에 넘기고,
 * **뷰에는 판정 결과만** 담는다. 브랜드된 값은 어떤 반환 타입에도 들어가지 않는다.
 *
 * ## 판정에는 전체 정밀도를, 표시에는 4자리를 쓴다
 *
 * `worstOf`는 나눗셈이라 40자리가 나올 수 있다(Q-07이 형식을 4자리로 고정한
 * 이유다). **판정은 반올림 전 값으로 한다** — 먼저 4자리로 접으면 배리어 경계에서
 * 판정이 뒤집힌다(`0.89996` → `0.9000` → 조기상환 충족으로 오판).
 */

// ---------------------------------------------------------------------------
// Q-07 — 문자열 형식
// ---------------------------------------------------------------------------

/**
 * 금액: 정수 문자열. DOC-007 §2의 "화면 표시 금액 원 단위 반올림"을 따른다.
 *
 * **정의는 `lib/decimal`에 있다** — 폼 계층이 같은 형식을 쓰는데 그쪽은 `lib/db`를
 * 값으로 import할 수 없다. 이름을 여기서 재수출해 기존 호출부(`queries/forecast.ts`·
 * `dashboard.ts`·`tax.ts`)가 그대로 산다.
 */
export { amountString }

/** 비율: 소수 4자리 고정. 저장 정밀도 `numeric(6,4)`와 일치한다. */
export function ratioString(value: DecimalValue): string {
  return value.toDecimalPlaces(4).toFixed(4)
}

/**
 * 「없으면 없다」 — 기실현 등재로 계약 조건이 빠지는 자리가 생겼다(DOC-002 D-07).
 *
 * `value == null ? null : xString(value)`를 호출부마다 적으면 어딘가 한 곳이
 * `?? '0'`이 되고, **0원은 「모른다」가 아니라 「0원이다」**를 말한다.
 */
function nullableAmount(value: DecimalValue | null): string | null {
  return value == null ? null : amountString(value)
}

function nullableRatio(value: string | null): string | null {
  return value == null ? null : ratioString(dec(value))
}

/**
 * 시세: 소수 6자리 고정. 저장 정밀도 `numeric(18,6)`과 일치한다.
 *
 * **금액도 비율도 아니다.** `amountString`으로 접으면 `412.55 → "413"`으로 값이
 * 망가지고, `ratioString`으로 접으면 저장 정밀도를 잃는다. Q-07이 v0.7까지 두
 * 분류만 두어 세 필드(§4.3 `basePrice`·`currentPrice`, §4.5 `latestPrice`)가
 * DB의 `::text` 원형을 그대로 통과하고 있었다.
 *
 * **DB 렌더링을 신뢰하지 않는다.** 지금 `numeric(18,6)`이 이미 6자리를 주므로
 * 출력값은 같지만, 원형을 통과시키면 **형식의 주인이 열 선언**이 되어 열을
 * `numeric(18,4)`로 바꾸는 순간 API 출력이 조용히 바뀐다. 비율이 `numeric(6,4)`인데도
 * `ratioString`을 거치는 것과 같은 논거다.
 */
export function priceString(value: DecimalValue): string {
  return value.toDecimalPlaces(6).toFixed(6)
}

// ---------------------------------------------------------------------------
// 무결성 결함 — D1, DOC-002 I-07
// ---------------------------------------------------------------------------

export type IntegrityIssue = 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING'

/**
 * 결함이 **파괴한 입력**. 억제 범위의 유일한 근거다 — DOC-011 §4.2 입력 기준.
 *
 * 억제를 결함 **이름**이 아니라 파괴된 **입력**에 매단다. 그래야 "무엇을 멈출
 * 것인가"가 결함마다 손으로 정하는 규율이 아니라, 결함을 등록할 때 자동으로
 * 따라오는 값이 된다.
 */
export type DestroyedInput = 'PRICES' | 'ROUNDS'

/**
 * **전수 사상이다.** 결함 종류를 늘리면 여기서 컴파일이 깨지므로, 새 결함이
 * 어느 입력을 파괴하는지 말하지 않고는 추가할 수 없다.
 */
const DESTROYED_BY: Record<IntegrityIssue, DestroyedInput> = {
  // 기초자산 0건 → 시세 입력이 없다. 차수·계약조건은 온전하다.
  UNDERLYING_MISSING: 'PRICES',
  // 평가일정 0건 → 차수 입력이 없다. 시세는 온전하다.
  SCHEDULE_MISSING: 'ROUNDS',
}

export function destroyedInputOf(
  issue: IntegrityIssue | null,
): DestroyedInput | null {
  return issue == null ? null : DESTROYED_BY[issue]
}

/**
 * 결함을 **명시 상태로** 표시한다. `worstOf`에 0건을 넘기지 않는다.
 *
 * 넘기면 `RangeError`가 나고, 모든 SELECT가 `using (true)`이므로 **남의 결함
 * 상품 1건이 SCR-101·201·301을 전원에게 죽인다.** `getProduct`까지 죽으면
 * SCR-204(수정)도 같은 계약을 쓰므로 유일한 복구 경로가 함께 막혀 UI로는
 * 고칠 수 없는 상태가 된다.
 *
 * **순수 분류다 — 로그를 남기지 않는다.** 여러 계약이 같은 요청에서 이 함수를
 * 부르므로(§4.6의 과세 기여도 결함 표식을 붙인다) 여기서 기록하면 같은 결함이
 * 화면당 여러 번 찍혀 원인을 가린다. 기록은 판정 진입점 하나에서만 한다 —
 * `listSchedule`이 부모별로 한 번만 매핑하는 것과 같은 이유다.
 *
 * ## 기실현 등재는 그 0건이 결함이 아니다 (P6 컷 5, DOC-011 §4.2 셋째 축)
 *
 * `entry_mode = 'REALIZED_ONLY'`인 상품은 계약 조건을 갖지 않기로 등재된 것이므로
 * 하위 행 0건이 의도다(DOC-002 D-07).
 *
 * **★ 그런데 억제를 새로 만들 필요가 없었다 — 실측이 초안을 반증했다.** 이 자리에
 * 「부재를 따르는」 별 함수(`absentInputOf`)를 두었다가 **철회했다.** 근거로 적은
 * 것은 「`integrityIssue`만 `null`로 만들면 억제가 풀려 기초자산 0종에 `worstOf`를
 * 물고, 빈 집합의 `min()`이라 `RangeError`가 나 화면이 전원에게 죽는다」였고
 * **그것이 거짓이다.** 억제를 결함 이름에 되매단 구현으로 음성 대조를 돌렸더니
 * 그 시점의 **87건이 전부 초록**이었다. 이미 세 겹이 이 경우를 덮고 있었다.
 *
 * | 무엇 | 어디 |
 * |---|---|
 * | `worstOfRow`가 기초자산 0건을 **스스로** 가드한다 | 아래 함수 |
 * | `asActive`가 상환 완료에서 `ki`·`conditionResult`를 죽인다 | DOC-007 §9.1 |
 * | `attentionReasonsFor`가 `REDEEMED`에서 먼저 반환한다 | 이 파일 아래 |
 *
 * 기실현 등재는 **정의상 항상 상환 완료**이므로(D-07) 뒤의 둘이 언제나 걸린다.
 * 그래서 `destroyed`를 어느 쪽으로 계산해도 뷰의 값이 한 칸도 달라지지 않는다.
 *
 * **그래서 방어 코드가 아니라 케이스를 남겼다.** 지켜야 하는 것은 위 세 겹의
 * **도달 가능성**이고 그것을 단언하는 층이 없었다 — 셋 중 하나가 사라지면 기실현
 * 상품에 「시세 없음」이 붙어 사용자가 영원히 오지 않을 시세를 기다린다(ST-06).
 * `tests/db/map.test.ts`의 「조치 사유가 비어 있다」가 그 계기이며, 그 케이스를 넣은
 * 뒤 같은 변형이 **실제로 잡힌다**(초록이었던 대조가 빨간불이 된다 — 두 방향을 다
 * 실행해 확인했다). **없는 위험을 지키는 분기보다 있는 위험을 판별하는 단언이 싸다** —
 * 그 분기는 자기가 무엇을 막는지 말하면서 아무것도 막지 않으므로, 다음 사람이 그
 * 문장을 근거로 다른 결정을 한다.
 *
 * **판정이 `entry_mode` 단독이 아니라 상환 존재와 짝이다** — 아래 본문의 각주.
 */
export function integrityIssueOf(row: ProductRow): IntegrityIssue | null {
  // 기실현 등재는 계약 조건을 갖지 않기로 등재된 상품이므로 하위 행 0건이
  // 결함이 아니다(DOC-002 D-07). **판정이 `entry_mode` 단독이 아니라 상환 존재와
  // 짝인 것이 요점이다** — `deleteRedemption`이 그 상품을 보유중으로 되돌리면
  // 계약 조건도 상환도 없는 상태가 되고, 그것은 등재가 만들 수 없는 상태이며
  // 다음 행동이 상품 삭제이므로 화면이 그 사실을 말해야 한다. `entry_mode`만
  // 보면 판정 입력이 하나도 없는 보유중 상품이 정상으로 읽힌다.
  if (isRealizedEntry(row)) return null

  if (row.els_underlyings.length === 0) return 'UNDERLYING_MISSING'
  if (row.redemption_schedules.length === 0) return 'SCHEDULE_MISSING'
  return null
}

/** 기실현 등재인가 — **상환이 있어야 참이다.** 위 각주가 그 짝의 이유다 */
export function isRealizedEntry(row: ProductRow): boolean {
  return row.entry_mode === 'REALIZED_ONLY' && row.redemptions != null
}

/**
 * 결함을 **삼키지 않고 기록**한다. `judge`에서만 부른다.
 *
 * 순수 모듈은 그대로 던진다 — DB를 경유하는 다른 경로(AQ-14)의 최종 안전망이다.
 * 조회 계층은 그것을 상태로 바꾸되 조용히 넘기지는 않는다.
 */
function reportIntegrityIssue(
  row: ProductRow,
  issue: IntegrityIssue | null,
): void {
  if (issue == null) return

  const what =
    issue === 'UNDERLYING_MISSING' ? '기초자산이 0건이다' : '평가일정이 0건이다'
  console.error(
    `[무결성] 상품 ${row.id}에 ${what} (DOC-002 I-07). ` +
      `${DESTROYED_BY[issue] === 'PRICES' ? '시세' : '차수'} 입력이 없으므로 ` +
      '그 입력을 쓰는 판정을 생략하고 integrityIssue로 표시한다.',
  )
}

// ---------------------------------------------------------------------------
// 판정 입력 조립
// ---------------------------------------------------------------------------

export function redemptionMarkOf(row: ProductRow): RedemptionMark {
  return row.redemptions == null
    ? null
    : { redemptionDate: row.redemptions.redemption_date }
}

/**
 * 소유자 표시 이름 — **폴백 문자열이 한 곳에만 있어야 한다.**
 *
 * `users`가 `null`일 수 있는 것은 임베드가 to-one이라는 실측(위 `ProductRow` 각주)의
 * 다른 절반이다. 폴백을 호출부마다 적으면 뷰마다 다른 말이 나오고, 그 갈림은
 * **`users` 행이 실제로 없을 때에만** 드러난다 — 즉 평소에는 아무 테스트도 보지
 * 못한다. 지금 소비자가 여섯이다(§4.1의 두 목록 · §4.2 · §4.3 · §4.4).
 */
export function ownerNameOf(row: ProductRow): string {
  return row.users?.display_name ?? '(알 수 없음)'
}

/**
 * `sequence` 오름차순 — **세 뷰가 같은 순서를 쓴다.**
 *
 * 스텝다운처럼 순서가 곧 뜻인 값은 아니지만, 계약 측(`terms.underlyings`)과 관측 측
 * (`underlyingPrices`)이 다른 순서로 나가면 두 배열이 같은 자산을 다른 자리에 두게
 * 된다 — 화면은 `assetId`로 합치므로 표시가 깨지지는 않으나(`underlyingLines`),
 * 「같은 순서다」라고 적은 계약(§4.2)이 거짓이 된다.
 */
function sortedUnderlyings(row: ProductRow): UnderlyingRow[] {
  return row.els_underlyings.slice().sort((a, b) => a.sequence - b.sequence)
}

/**
 * 기초자산별 **관측** — §4.2 `underlyingPrices` · §4.4 `underlyings` (v3.4, P6 컷 7)
 *
 * 계약 조건(이름·기준가)을 담지 않는다. §4.2가 그 둘을 형제 필드로 가르는 이유가
 * D1이며(`ratio`·`isWorst`는 `UNDERLYING_MISSING`에 억제되는 값이고 `terms`는 아니다),
 * 여기에 이름을 실으면 한 뷰에 같은 값이 둘이 되어 갈리는 날 정본이 없어진다.
 *
 * **`worst`를 인자로 받는다.** 여기서 다시 최솟값을 고르면 `judge()`가 낸 워스트오브와
 * 갈릴 수 있고, 갈리면 ⑤가 적는 숫자와 표식이 붙은 줄이 서로 다른 것을 가리킨다.
 * 반올림 전 값끼리 비교하는 것도 그 이유다 — 4자리로 접은 뒤 비교하면 경계에서
 * 표식이 두 줄에 붙거나 한 줄에도 안 붙는다.
 */
function underlyingQuotesOf(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  worst: DecimalValue | null,
): UnderlyingQuote[] {
  return sortedUnderlyings(row).map((u) => {
    const current = prices.get(u.asset_id)?.price ?? null
    const ratio =
      current == null ? null : underlyingRatio(u.base_price, current.price)

    return {
      assetId: u.asset_id,
      currentPrice: current == null ? null : priceString(dec(current.price)),
      ratio: ratio == null ? null : ratioString(ratio),
      // 동률이면 전부 참이다(§4.3의 같은 규약). 하나만 고르면 그 선택이 표시
      // 순서에 의존하는 임의값이 되고, 워스트오브가 없으면 전부 거짓이다.
      isWorst: worst != null && ratio != null && ratio.equals(worst),
    }
  })
}

/**
 * 기초자산별 **계약 조건** — 시세를 읽지 않는다.
 *
 * 인자가 `row` 하나인 것이 그 사실의 형태다(`termsOf`의 머리글과 같은 규약).
 * `assetId`는 표시값이 아니라 관측과 짝짓는 키다 — §4.2 v3.4.
 */
function contractUnderlyingsOf(row: ProductRow): UnderlyingTerm[] {
  return sortedUnderlyings(row).map((u) => ({
    assetId: u.asset_id,
    // 자산 임베드가 비는 것은 FK가 막으므로 도달하지 않는다. 그래도 상세와
    // **같은 문구**를 쓴다 — 두 화면이 같은 결함을 다르게 부르면 안 된다.
    assetName: u.assets?.name ?? '(알 수 없음)',
    basePrice: priceString(dec(u.base_price)),
  }))
}

/**
 * 워스트오브. **기초자산 0건이면 `worstOf`를 호출하지 않는다.**
 *
 * 0건에서 `null`을 반환하는 것이 아니라 호출 자체를 하지 않는 것이 요점이다 —
 * 그 상태는 `integrityIssue`가 담당하고, `worstOf`의 거부는 그대로 살려 둔다.
 */
export function worstOfRow(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
): DecimalValue | null {
  if (row.els_underlyings.length === 0) return null

  return worstOf(
    row.els_underlyings.map((u) => ({
      basePrice: u.base_price,
      currentPrice: prices.get(u.asset_id)?.price?.price ?? null,
    })),
  )
}

/**
 * 순수 모듈은 `{ roundNo, evaluationDate }`(camelCase)를 받고 행은 snake_case다.
 * 어댑터가 **행을 붙여서** 넘긴다 — `nextEvaluation`이 제네릭으로 입력 타입을
 * 그대로 반환하므로, 이렇게 하면 고른 차수의 나머지 열(배리어·리자드)을 다시
 * 찾지 않아도 된다. `round_no`로 되찾으면 그 조회가 또 하나의 실패 지점이 된다.
 */
type ScheduleForJudgment = {
  roundNo: number
  evaluationDate: string
  row: ScheduleRow
}

function forJudgment(s: ScheduleRow): ScheduleForJudgment {
  return { roundNo: s.round_no, evaluationDate: s.evaluation_date, row: s }
}

export type Judgment = {
  status: 'ACTIVE' | 'REDEEMED'
  integrityIssue: IntegrityIssue | null
  /** 결함이 파괴한 입력. 소비자가 결함 이름으로 억제 여부를 다시 유도하지 않게 한다 */
  destroyed: DestroyedInput | null
  worstOf: DecimalValue | null
  /**
   * 적용 차수와 귀속연도 — `./attribution`이 낸다. **`next`가 이 값에서 파생된다.**
   *
   * 둘을 따로 계산하면 같은 상품에 두 적용 차수가 생길 수 있고, 그 갈림은 화면 두
   * 곳의 숫자 차이로만 드러난다(§4.3의 `projection`과 §4.6의 과세 기여).
   */
  attribution: Attribution
  next: ScheduleRow | null
  conditionResult: ConditionResult | null
  ki: KiStatus | null
  /** 경과 미상환 차수(E-07). 차수 입력에서만 나오므로 시세 결함에 영향받지 않는다 */
  overdue: ScheduleRow[]
}

/**
 * 한 상품의 판정 일체. 세 계약(§4.1·§4.2·§4.4)이 같은 값을 써야 하므로 한곳에서 낸다.
 *
 * ## 억제는 결함이 파괴한 입력을 쓰는 값에만 미친다 (§4.2 입력 기준)
 *
 * v0.7까지는 `integrityIssue ≠ null`이면 **전부** 죽였다. 그래서 같은 결함
 * 상품이 계약마다 다르게 보였다 — §4.3은 `projection`을 `null`로 두면서 §4.6은
 * 같은 상품의 같은 계산으로 과세 기여를 냈고, `SCHEDULE_MISSING` 상품은 `ratio`가
 * 표시되는데 `isWorst`만 사라졌다. 멈추는 범위가 원인의 범위를 넘고 있었다(AQ-17).
 *
 * | 결함 | 파괴한 입력 | 죽는 값 | 사는 값 |
 * |---|---|---|---|
 * | `UNDERLYING_MISSING` | 시세 | `worstOf`·`ki`·`conditionResult` | `next`·`overdue`·`expectedGross`·`projection` |
 * | `SCHEDULE_MISSING` | 차수 | (자연히) `next`·`overdue`·`conditionResult` | `worstOf`·`ki` |
 *
 * ## E-05는 별개 축이다
 *
 * 위 표는 `integrityIssue` 축만 규정한다. 상환 완료는 **독립적으로** `asActive`를
 * 통해 `ki`·`conditionResult`를 죽이고 `next`를 `null`로 만든다. 두 축이 겹치면
 * 둘 다 걸린다 — `SCHEDULE_MISSING` + 상환 완료의 `ki`는 표의 "산다"가 아니라 `null`이다.
 */
export function judge(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
): Judgment {
  const mark = redemptionMarkOf(row)
  const status = isRedeemed(mark) ? 'REDEEMED' : 'ACTIVE'
  const integrityIssue = integrityIssueOf(row)
  const destroyed = destroyedInputOf(integrityIssue)
  reportIntegrityIssue(row, integrityIssue)

  // ── 차수 입력에서 나오는 값 ──────────────────────────────────────────────
  // ROUNDS가 파괴돼도 **끊지 않는다.** 일정이 0건이면 아래 두 함수가 이미 빈
  // 결과를 준다 — 억제가 아니라 자연 결과이며, 둘을 구분해야 차수가 생겼을 때
  // 무엇이 되살아나는지 알 수 있다.
  const schedules = row.redemption_schedules.map(forJudgment)
  // **적용 차수를 여기서 다시 고르지 않는다.** `attributionOf`가 상환 완료를 먼저
  // 잡으므로 `REDEEMED`에서 `next`가 `null`인 성질이 그 함수 안에 있다 —
  // 종전의 `status === 'REDEEMED' ? null : …` 삼항이 그 사실의 사본이었다.
  const attribution = attributionOf(row, asOf)
  const next = attribution.kind === 'ESTIMATED' ? attribution.round : null
  const overdue = overdueEvaluations({ schedules, asOf, redemption: mark }).map(
    (entry) => entry.schedule.row,
  )

  // ── 시세 입력에서 나오는 값 ──────────────────────────────────────────────
  // **자연 소멸에 기대면 안 된다.** kiStatus는 `kiBarrier == null`이면 시세를
  // 보기 전에 'NO_KI'를, `kiTouchedAt != null`이면 'TOUCHED'를 반환한다. 여기서
  // 끊지 않으면 기초자산 정의가 깨진 상품에 화면이 "노낙인 = 안전"을 말한다.
  if (destroyed === 'PRICES') {
    return {
      status,
      integrityIssue,
      destroyed,
      worstOf: null,
      attribution,
      next,
      conditionResult: null,
      ki: null,
      overdue,
    }
  }

  const w = worstOfRow(row, prices)

  // 2순위 — 상환 완료면 asActive가 null을 준다. 판정값으로 대체하지 않는다.
  const kiInput = asActive(
    { kiBarrier: row.ki_barrier, kiTouchedAt: row.ki_touched_at, worstOf: w },
    mark,
  )
  const ki = kiInput == null ? null : kiStatus(kiInput)

  // 조건 판정은 대상 차수가 있어야 한다 — 전 차수 경과 미상환이면 차수가 없다
  let conditionResult: ConditionResult | null = null
  if (next != null) {
    const conditionInput = asActive(
      {
        worstOf: w,
        barrier: next.barrier,
        lizardBarrier: next.lizard_barrier,
        lizardRequiresNoKi: next.lizard_requires_no_ki,
        kiBarrier: row.ki_barrier,
        kiTouchedAt: row.ki_touched_at,
      },
      mark,
    )
    conditionResult =
      conditionInput == null ? null : evaluateCondition(conditionInput)
  }

  return {
    status,
    integrityIssue,
    destroyed,
    worstOf: w,
    attribution,
    next,
    conditionResult,
    ki,
    overdue,
  }
}

// ---------------------------------------------------------------------------
// §4.2 상품 목록
// ---------------------------------------------------------------------------

export type ProductListItem = {
  id: string
  name: string
  ownerId: string
  ownerName: string
  principal: string
  accountType: 'GENERAL' | 'TAX_FREE'
  status: 'ACTIVE' | 'REDEEMED'
  nextEvaluation: {
    roundNo: number
    date: string
    dDay: number
    barrier: string
  } | null
  worstOf: string | null
  conditionResult: ConditionResult | null
  kiStatus: KiStatus | null
  integrityIssue: IntegrityIssue | null
  /**
   * 기실현 등재 여부 — DOC-002 §4.6.
   *
   * **`integrityIssue`와 함께 담기는 것이 요점이다.** 둘은 같은 관측(하위 행 0건)에
   * 붙는 다른 이름이고, 화면이 그 둘을 **다르게 말해야** 한다 — 결함은 「수정 필요」,
   * 이쪽은 수정으로 해소할 것이 없다(DOC-005 §6). 하나만 담으면 화면이 정상 상품에
   * 「기초자산 없음 — 수정 필요」를 붙이거나, 결함을 조용히 정상으로 표시한다.
   */
  entryMode: 'FULL' | 'REALIZED_ONLY'
  isOwner: boolean
  /**
   * 기초자산별 **관측** — `terms.underlyings`의 형제다 (§4.2 v3.4, DOC-008 §5 ⑧)
   *
   * `terms` 안에 넣지 않는 이유는 D1 표의 첫 행이다 — `ratio`·`isWorst`는 거기서
   * `worstOf`와 한 줄에 묶여 `UNDERLYING_MISSING`에 억제되는 값이고, `terms`는
   * 「D1이 미치지 않는다」가 정의다. 넣으면 그 정의가 거짓이 된다.
   *
   * 화면은 `underlyingLines`로 둘을 `assetId`로 합쳐 한 칸에 렌더한다.
   */
  underlyingPrices: UnderlyingQuote[]
  terms: ProductListTerms
}

/**
 * 계약 조건 — **판정값이 아니다** (DOC-011 §4.2 v3.1, DOC-008 §5 SCR-201 ⑨~⑬)
 *
 * ## 왜 담아도 왕복이 늘지 않는가
 *
 * `PRODUCT_SELECT`가 **이미** `els_underlyings(+assets)`와 `redemption_schedules`를
 * 임베드한다(상품 + 하위 전부, 1 왕복) — 판정 삼종이 그 데이터를 쓰기 때문이다.
 * 이 매퍼는 v3.0까지 **그것을 읽고 버렸다.** 즉 이 필드는 조회를 넓히는 것이 아니라
 * 이미 온 것을 노출한다.
 *
 * ## 억제 규칙(D1)이 이쪽에는 미치지 않는다
 *
 * 결함 상품도 계약 조건은 있다 — 오히려 그때 화면이 보여줄 것이 이것뿐이다.
 * `worstOf`·`kiStatus`가 비는 것과 달리 `terms`는 언제나 상품이 가진 값이며,
 * 기초자산이 0종이면 `underlyings`가 빈 배열인 것이 그 사실의 표현이다.
 *
 * ## 상세(`ProductDetailView`)의 하위 형태를 재사용하지 않는다
 *
 * 그쪽 `underlyings`는 `currentPrice`·`ratio`·`isWorst`를, `schedules`는
 * `expectedGross`·`conditionResult`·`isPast`를 담고 **전부 차수별 판정**이다. 같은
 * 형태를 쓰면 목록이 쓰지 않는 값을 계산하게 되고, 무엇보다 「목록은 계약 조건 ·
 * 상세는 판정」이라는 구분이 타입에서 사라진다.
 */
export type ProductListTerms = {
  /** `null` = 기실현 등재. `entryMode`의 짝이며 I-18이 `FULL`에서 보장한다 */
  annualCouponRate: string | null
  /** `null` = 노낙인. `kiObservation`과 함께 있거나 함께 없다(I-11) */
  kiBarrier: string | null
  kiObservation: KiObservation | null
  /** `sequence` 순서. `assetId`는 `underlyingPrices`와 짝짓는 키다 — 표시값이 아니다 */
  underlyings: UnderlyingTerm[]
  /** 차수 순서. 스텝다운 표기의 정본이며 일괄 입력 형식(SQ-04)과 같은 순서다 */
  barriers: string[]
  /** 리자드가 붙은 차수만 */
  lizards: LizardTerm[]
}

export function toProductListItem(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
  viewerId: string,
): ProductListItem {
  const j = judge(row, prices, asOf)

  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerName: ownerNameOf(row),
    principal: amountString(dec(row.principal)),
    accountType: row.account_type,
    status: j.status,
    nextEvaluation:
      j.next == null
        ? null
        : {
            roundNo: j.next.round_no,
            date: j.next.evaluation_date,
            dDay: dDay({ from: asOf, evaluationDate: j.next.evaluation_date }),
            barrier: ratioString(dec(j.next.barrier)),
          },
    worstOf: j.worstOf == null ? null : ratioString(j.worstOf),
    conditionResult: j.conditionResult,
    kiStatus: j.ki,
    integrityIssue: j.integrityIssue,
    entryMode: row.entry_mode,
    isOwner: row.owner_id === viewerId,
    underlyingPrices: underlyingQuotesOf(row, prices, j.worstOf),
    terms: termsOf(row),
  }
}

/**
 * 계약 조건을 행에서 뽑는다 — **시세도 판정도 읽지 않는다.**
 *
 * 인자가 `row` 하나인 것이 그 사실의 형태다. `prices`·`asOf`·`viewerId`를 받지 않으므로
 * 이 함수는 **기준일에 의존하지 않고** 같은 상품에 언제나 같은 값을 낸다 — 계약 조건이
 * 판정값과 다른 점이 정확히 그것이다.
 *
 * 정렬 규약은 상세 매퍼와 같다(`sequence`·`round_no` 오름차순). 갈리면 목록의 스텝다운
 * 순서와 상세의 차수표 순서가 달라지고, 스텝다운은 **순서가 곧 뜻**이다(내려가는 수열).
 */
function termsOf(row: ProductRow): ProductListTerms {
  const schedules = row.redemption_schedules
    .slice()
    .sort((a, b) => a.round_no - b.round_no)

  return {
    // 기실현 등재는 `null`이다 — 그 상품에 연쿠폰율이 없다(D-07).
    annualCouponRate: nullableRatio(row.annual_coupon_rate),
    kiBarrier: row.ki_barrier == null ? null : ratioString(dec(row.ki_barrier)),
    kiObservation: row.ki_observation,

    underlyings: contractUnderlyingsOf(row),

    barriers: schedules.map((s) => ratioString(dec(s.barrier))),

    /*
     * 리자드가 **붙은 차수만** 담는다. 전 차수를 담고 화면이 걸러 내면 그 판단이
     * 컴포넌트로 내려가고, 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23).
     * 배리어가 리자드의 존재를 정의한다 — 파서가 같은 규칙을 쓴다(`parse.ts`).
     */
    lizards: schedules
      .filter((s) => s.lizard_barrier != null)
      .map((s) => ({
        roundNo: s.round_no,
        barrier: ratioString(dec(s.lizard_barrier!)),
        couponRate:
          s.lizard_coupon_rate == null
            ? null
            : ratioString(dec(s.lizard_coupon_rate)),
        requiresNoKi: s.lizard_requires_no_ki ?? false,
      })),
  }
}

// ---------------------------------------------------------------------------
// §4.3 상품 상세
// ---------------------------------------------------------------------------

export type RedemptionView = {
  id: string
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo: number | null
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax: string | null
  isConfirmed: boolean
  realizedPnl: string
  note: string | null
}

export type ProductDetailView = {
  product: {
    id: string
    name: string
    issuer: string | null
    ownerId: string
    ownerName: string
    isOwner: boolean
    /** `null` = 기실현 등재 (DOC-002 D-07). `FULL`이면 항상 있다(I-18) */
    issueDate: string | null
    principal: string
    evaluationPeriodMonths: number
    totalRounds: number
    /**
     * 판정 삼종 — **§4.2 우선순위표의 입력이다** (v1.4 신설, P4 컷 3)
     *
     * 셋은 `judge()`가 이미 내는 값이고 v1.3까지 이 매퍼가 **버렸다**. 담는
     * 근거는 편의가 아니라 `deriveDisplay()`가 단일 구현이라는 것이다 — 그
     * 함수의 입력이 정확히 `{status, worstOf, integrityIssue}`이므로 뷰가 셋을
     * 담지 않으면 SCR-202가 `status`를 `redemption == null`로, `worstOf`를
     * `underlyings.find(u => u.isWorst)?.ratio`로 **합성한 뒤** 부르게 된다.
     *
     * 두 합성은 오늘 옳다. 문제는 옳음을 확인할 층이 없다는 것이다 — 화면은
     * 어떤 스위트의 import 그래프에도 없다(AQ-23). 뷰가 담으면 두 화면이 같은
     * 함수에 같은 모양을 넘기고 그 동일성이 순수 모듈에서 대조된다.
     *
     * `kiStatus`는 합성조차 불가능하다. 등급 임계 배수와 `NO_KI`·`TOUCHED`·
     * `BELOW`의 순서를 요구하므로 `lib/domain`의 재구현이 된다.
     */
    status: 'ACTIVE' | 'REDEEMED'
    /** 기실현 등재 여부 — DOC-002 §4.6. 목록(§4.2)과 같은 필드다 */
    entryMode: 'FULL' | 'REALIZED_ONLY'
    worstOf: string | null
    kiStatus: KiStatus | null
    integrityIssue: IntegrityIssue | null
    /** `null` = 기실현 등재. `issueDate`와 같은 짝이며 I-18이 `FULL`에서 보장한다 */
    annualCouponRate: string | null
    kiBarrier: string | null
    kiObservation: 'CONTINUOUS' | 'CLOSING' | null
    kiTouchedAt: string | null
    accountType: 'GENERAL' | 'TAX_FREE'
    note: string | null
  }
  underlyings: Array<{
    assetId: string
    assetName: string
    basePrice: string
    currentPrice: string | null
    priceAsOf: string | null
    priceSource: 'AUTO' | 'MANUAL' | null
    ratio: string | null
    isWorst: boolean
  }>
  schedules: Array<{
    roundNo: number
    evaluationDate: string
    barrier: string
    lizardBarrier: string | null
    lizardCouponRate: string | null
    lizardRequiresNoKi: boolean | null
    /** `null` = 연쿠폰율이 없어 산출할 수 없다 — `expectedGrossOf`의 각주 */
    expectedGross: string | null
    conditionResult: ConditionResult | null
    isPast: boolean
  }>
  projection: {
    appliedRoundNo: number
    expectedGross: string
    expectedTaxableIncome: string
    attributionYear: number
  } | null
  redemption: RedemptionView | null
}

/**
 * 차수별 예상 수령액 — **판정과 무관하게 전 차수에 정의된다**(§4.3).
 *
 * "그 차수에 조기상환된다고 가정한 세전 수령액"이며 DOC-007 §4.1의 `EARLY`
 * 가정을 따른다. 상품의 계약 조건에서 나오는 값이므로 상환 완료 상품에서도
 * 의미가 있다 — 실제 수령액(`redemption.grossAmount`)과는 다른 값이다.
 */
function expectedGrossOf(
  row: ProductRow,
  roundNo: number,
): DecimalValue | null {
  // **쿠폰율이 없으면 산출하지 않는다** — 기실현 등재는 계약 조건이 없다(D-07).
  // 그 상품은 차수도 0건이므로 이 함수의 두 호출부(차수별 표·`projectionOf`)에
  // 도달하지 않는다. 그래도 `null`을 표현하는 이유는 **도달 경로가 계약 밖에
  // 하나 있기 때문**이다: 수동 SQL로 `REALIZED_ONLY` 상품에 차수를 넣으면 여기
  // 온다(AQ-14·AQ-65와 같은 자리). 그때 값을 지어내거나 죽는 것보다 비우는 편이 낫다.
  if (row.annual_coupon_rate == null) return null

  return grossExpected({
    principal: row.principal,
    couponRate: row.annual_coupon_rate,
    evaluationPeriodMonths: row.evaluation_period_months,
    roundNo,
  })
}

export function toProductDetailView(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
  viewerId: string,
): ProductDetailView {
  const j = judge(row, prices, asOf)
  /*
   * 세 값(`currentPrice`·`ratio`·`isWorst`)을 §4.2·§4.4와 **같은 함수**에서 얻는다.
   * 여기서 다시 계산하면 「동률이면 전부 true」와 「반올림 전 값으로 비교한다」가
   * 두 곳에 생기고, 그 갈림은 배리어 경계의 상품에서만 드러난다.
   */
  const quotes = new Map(
    underlyingQuotesOf(row, prices, j.worstOf).map((q) => [q.assetId, q]),
  )

  const schedules = [...row.redemption_schedules].sort(
    (a, b) => a.round_no - b.round_no,
  )

  return {
    product: {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      ownerId: row.owner_id,
      ownerName: ownerNameOf(row),
      isOwner: row.owner_id === viewerId,
      issueDate: row.issue_date,
      principal: amountString(dec(row.principal)),
      evaluationPeriodMonths: row.evaluation_period_months,
      // 정본은 **행 수**다. max(round_no)가 아니다 — 연속성(V-04)은 계약 계층에만
      // 있어 DB는 1,2,99를 허용하므로 두 값이 갈린다(DOC-002 §4.6).
      totalRounds: schedules.length,
      // 목록(§4.2)과 **같은 판정에서 나온다.** 두 뷰가 한 상품에 대해 다른
      // 표시 상태를 만들 수 없다는 것이 이 세 줄의 존재 이유다.
      status: j.status,
      worstOf: j.worstOf == null ? null : ratioString(j.worstOf),
      kiStatus: j.ki,
      integrityIssue: j.integrityIssue,
      entryMode: row.entry_mode,
      annualCouponRate: nullableRatio(row.annual_coupon_rate),
      kiBarrier: row.ki_barrier == null ? null : ratioString(dec(row.ki_barrier)),
      kiObservation: row.ki_observation,
      kiTouchedAt: row.ki_touched_at,
      accountType: row.account_type,
      note: row.note,
    },

    underlyings: sortedUnderlyings(row).map((u) => {
      const latest = prices.get(u.asset_id) ?? null
      // 위 `quotes`가 세 값을 낸다. 자산마다 반드시 있다 — 같은 행에서 같은
      // 순서로 나온 배열을 색인한 것이므로 부재는 도달 불가다.
      const quote = quotes.get(u.asset_id)
      return {
        assetId: u.asset_id,
        // **여기만 시세 임베드의 이름을 먼저 본다.** 이 화면은 자산 하나를 표의
        // 한 줄로 보여주므로 `assets` 임베드가 빈 경우에도 이름을 낼 길이 있으면
        // 쓴다(목록은 `terms`가 시세를 읽지 않아 그 길이 없다).
        assetName: latest?.asset.name ?? u.assets?.name ?? '(알 수 없음)',
        basePrice: priceString(dec(u.base_price)),
        currentPrice: quote?.currentPrice ?? null,
        priceAsOf: latest?.price?.as_of_date ?? null,
        priceSource: latest?.price?.source ?? null,
        ratio: quote?.ratio ?? null,
        isWorst: quote?.isWorst ?? false,
      }
    }),

    schedules: schedules.map((s) => ({
      roundNo: s.round_no,
      evaluationDate: s.evaluation_date,
      barrier: ratioString(dec(s.barrier)),
      lizardBarrier:
        s.lizard_barrier == null ? null : ratioString(dec(s.lizard_barrier)),
      lizardCouponRate:
        s.lizard_coupon_rate == null
          ? null
          : ratioString(dec(s.lizard_coupon_rate)),
      lizardRequiresNoKi: s.lizard_requires_no_ki,
      expectedGross: nullableAmount(expectedGrossOf(row, s.round_no)),
      // 판정은 **적용 차수 한 곳**에만 있다. 다른 차수의 배리어로 지금 시세를
      // 판정하면 그 차수가 도래했을 때의 결과인 척하는 값이 된다.
      conditionResult:
        j.next != null && j.next.round_no === s.round_no
          ? j.conditionResult
          : null,
      isPast: isPast({ evaluationDate: s.evaluation_date, asOf }),
    })),

    projection: projectionOf(row, j),

    redemption:
      row.redemptions == null
        ? null
        : {
            id: row.redemptions.id,
            redemptionType: row.redemptions.redemption_type,
            roundNo: row.redemptions.round_no,
            redemptionDate: row.redemptions.redemption_date,
            grossAmount: amountString(dec(row.redemptions.gross_amount)),
            taxableIncome: amountString(dec(row.redemptions.taxable_income)),
            withholdingTax:
              row.redemptions.withholding_tax == null
                ? null
                : amountString(dec(row.redemptions.withholding_tax)),
            isConfirmed: row.redemptions.is_confirmed,
            realizedPnl: amountString(
              realizedPnl({
                grossAmount: row.redemptions.gross_amount,
                principal: row.principal,
              }),
            ),
            note: row.redemptions.note,
          },
  }
}

/**
 * `projection`은 **두 경우에 `null`**이다 (§4.3, v0.8에서 정정).
 *   ① 상환 완료
 *   ② **적용 차수가 없다** — 전 차수가 경과했는데 미상환이거나(DOC-007 §9.2),
 *      평가일정이 0건(`SCHEDULE_MISSING`)이다.
 *
 * **무결성 결함 자체는 사유가 아니다.** 이 값이 쓰는 입력은 원금·쿠폰율·평가주기·
 * 차수·계좌구분뿐이고 **시세를 하나도 쓰지 않으므로**, `UNDERLYING_MISSING`
 * 상품에서도 정의된다 — 바로 위 `expectedGross`가 판정과 무관하게 전 차수에
 * 정의되는 것과 같은 이유다.
 *
 * v0.6의 "② `integrityIssue ≠ null`"은 원인의 범위를 넘어 억제했고, 그 결과 같은
 * 상품이 §4.6에서는 과세에 기여하면서 여기서만 값을 잃어 두 화면이 모순되게 보였다.
 *
 * ## 넷째 분기가 사라졌다 — 삭제가 아니라 표현 불가다 (AQ-25 종결)
 *
 * 종전 구현에는 `attributionYear`가 `null`을 줄 때의 넷째 `null` 반환이 있었다.
 * P4.5가 그것을 **죽은 코드로 판별**했으나(`evaluation_date`가 널 불가임을 타입 탐침으로
 * 확정) 제거하지 않았다 — 순수 모듈의 반환 타입을 좁히는 일이라 다른 호출부와 함께
 * 보아야 했기 때문이다. 이제 `j.attribution`이 `kind`로 그 경우를 판별하므로 **그
 * 분기를 쓸 수 있는 자리가 없다.** 한 줄을 지운 것이 아니라 위 ①②가 곧 `kind` 둘이 된
 * 것이며, 그래서 이 각주의 「두 경우」와 코드의 분기 수가 처음으로 일치한다.
 */
function projectionOf(
  row: ProductRow,
  j: Judgment,
): ProductDetailView['projection'] {
  // ① 상환 완료 ② 적용 차수 없음 — 그 둘이 `ESTIMATED`의 여집합이다.
  if (j.attribution.kind !== 'ESTIMATED') return null

  const round = j.attribution.round
  const gross = expectedGrossOf(row, round.round_no)
  // ③ 계약 조건이 없다 — 쿠폰율 없이는 추정 자체가 정의되지 않는다(위 각주).
  // 「값을 비운 추정」을 만들지 않는 것이 §4.2 D1의 규약이다.
  if (gross == null) return null

  return {
    appliedRoundNo: round.round_no,
    expectedGross: amountString(gross),
    expectedTaxableIncome: amountString(
      taxableIncome({
        accountType: row.account_type,
        principal: row.principal,
        redemption: null,
        expectedGross: gross,
      }),
    ),
    attributionYear: j.attribution.year,
  }
}

// ---------------------------------------------------------------------------
// §4.4 평가일정
// ---------------------------------------------------------------------------

export type ScheduleItem = {
  productId: string
  productName: string
  /**
   * 소유자 필터의 **선택지 값** (v1.8, P4 컷 7)
   *
   * 이 계약은 `params.ownerId`로 좁히는데 v1.7까지 반환에는 `ownerName`만 있었다 —
   * 즉 **좁힐 값을 이 계약에서 얻을 수 없었다.** 화면이 선택지를 만들려면 이름을
   * UUID로 되돌려야 하고 그 대응은 어디에도 없다. AQ-24와 같은 부류의 비대칭이며
   * (그쪽은 파라미터가 반환보다 좁았다) §4.2는 처음부터 둘을 담고 있었다.
   */
  ownerId: string
  ownerName: string
  roundNo: number
  evaluationDate: string
  dDay: number
  barrier: string
  hasLizard: boolean
  /**
   * 상품 상태 — **§4.2 우선순위표의 E-05 단** (v1.8, P4 컷 7)
   *
   * `activeOnly`가 있는데도 필요한 이유는 **그 필터가 숨기는 수단**이라는 것이다.
   * 꺼진 상태(기본)에서는 상환 완료 상품의 남은 차수가 미상환 차수와 **같은
   * 모습으로** 내려가 「다가오는 평가일」에 도래하지 않을 날짜가 섞이고, 켜면
   * 사라지지만 사라진 것과 상환된 것도 구분되지 않는다.
   *
   * §4.3의 판정 삼종(v1.4)과 같은 부류이며 **한 단계 더 나쁜 상태였다** — 그쪽은
   * 화면이 `redemption == null`로 합성할 수 있었으나(그 합성을 볼 층이 없다는 것이
   * 문제였다) 여기는 상환 레코드도 상환일도 뷰에 없어 **합성할 입력조차 없다.**
   * `deriveDisplay`의 입력이 `{status, worstOf, integrityIssue}`이므로, 셋 중 하나가
   * 없으면 다섯 화면 중 이 화면만 그 판정을 하지 못한다.
   *
   * **`isPast`와 직교한다.** 상환 완료 + 미래 차수도 실재한다 — I-01은 상환을
   * 상품당 하나로 제한할 뿐 상환일 이후의 일정 행을 지우지 않는다.
   */
  status: 'ACTIVE' | 'REDEEMED'
  worstOf: string | null
  conditionResult: ConditionResult | null
  /** 일정 0건 상품은 이 목록에 **행 자체가 생기지 않으므로** SCHEDULE_MISSING은 도달 불가다 */
  integrityIssue: 'UNDERLYING_MISSING' | null
  isPast: boolean

  /**
   * 투자원금 — 카드 머리가 읽는다. 차수 손익의 기준선이다 (v3.3, P6 컷 6)
   *
   * 아래 넷과 함께 **차수마다 같은 값**이며 `productName`·`status`가 이미 그
   * 형태다. 상품 쪽 값이 왕복을 늘리지 않는 이유는 `PRODUCT_SELECT`가 이미
   * 싣고 판정이 쓰고 있었기 때문이다 — v3.2까지 매퍼가 **읽고 버렸다**.
   */
  principal: string
  /** 연쿠폰율. `null` = 계약 조건 없음(D-07)이며 `proceeds`와 **같은 조건**으로 빈다 */
  annualCouponRate: string | null
  /**
   * 원천징수 유무를 가르는 축 (DOC-007 §4.3).
   *
   * `expectedNet`만 담으면 화면이 「왜 세후 = 세전인가」를 말할 수 없다 —
   * 비과세 계좌와 「쿠폰율이 0이라 손익이 0」이 같게 보인다.
   */
  accountType: 'GENERAL' | 'TAX_FREE'
  /**
   * 그 상품의 **전체** 차수. 정본은 행 수이며 `max(round_no)`가 **아니다**(§4.3의 같은 규약).
   *
   * 기간 필터가 6차수 중 3~4차만 남기면 카드는 「3차부터 시작하는 상품」으로
   * 읽힌다. 화면이 `max(roundNo)`로 합성하면 그 경우 **4가 나와 틀린다.**
   */
  totalRounds: number
  /** `annualCouponRate == null`일 때만 `null`. 그 둘은 함께 빈다 */
  proceeds: ScheduleProceeds | null

  /**
   * 카드 머리의 계약 조건 둘 — DOC-008 §5 SCR-301 ⑩ (v3.4, P6 컷 7)
   *
   * `judge()`가 `kiStatus`에 쓰는 두 열이며 매퍼가 읽고 버리던 값이다.
   * 계약 조건이므로 어느 억제 축에도 걸리지 않는다.
   */
  kiBarrier: string | null
  kiObservation: KiObservation | null
  /**
   * 기초자산 표시 줄 — DOC-008 §5 SCR-301 ⑨ (v3.4)
   *
   * **§4.2와 달리 계약과 관측을 합쳐서 담는다.** 이 뷰에는 그 축이 애초에 없다
   * (`barrier`는 계약이고 `worstOf`는 판정인데 한 평면에 있다) — 없는 축을 만들면
   * `assetId` 짝짓기가 아무것도 지키지 않는 채로 화면에 노출된다. 대신 §4.2가
   * 화면에서 쓰는 것과 **같은 타입**이라 두 화면의 렌더러가 하나다.
   */
  underlyings: UnderlyingLine[]
}

/**
 * 차수별 금액 — **여섯이 함께 있거나 함께 없다** (v3.3).
 *
 * 독립 nullable로 흩으면 「다섯은 있고 하나만 없다」가 타입상 표현 가능해지는데
 * 그 조합은 실재하지 않는다. §4.3의 `projection: {…} | null`과 같은 형태다.
 */
export type ScheduleProceeds = {
  /** 세전. DOC-007 §4.1의 `EARLY` 가정 — §4.3의 같은 이름 필드와 같은 값이다 */
  expectedGross: string
  /** 예상 원천징수. `TAX_FREE`는 `'0'` */
  expectedWithholding: string
  /** 세후 예상 수령액 = 세전 − 예상 원천징수. **잔차다** */
  expectedNet: string
  /** 예상 손익 = 세전 − 투자원금. 현 산식에서 음수가 될 수 없다(`r ≥ 0`) */
  expectedPnl: string
  /**
   * 위 셋에 **실제로 쓰인** 분리과세율.
   *
   * 화면의 고지(「15.4% 분리과세 기준」)가 절대 규칙 #5에 따라 이 숫자를 코드에
   * 적을 수 없다. 값을 만든 세율이 값과 **함께 이동**하므로 둘이 갈릴 수 없다.
   */
  separateTaxationRate: string
  /** 그 세율의 연도. 기준일의 연도와 다르면 근사다 */
  taxLawYear: number
}

/**
 * 세후 값의 세율 근거 — **요청당 하나다** (v3.3).
 *
 * `listSchedule`이 `year(ctx.asOf)`로 한 번 풀어 전 차수에 같은 값을 싣는다.
 * 차수의 귀속연도로 풀지 않는 이유는 `resolveTaxYear`가 시드 이전 연도를
 * **던지기** 때문이다 — 이 화면은 지난 차수를 반드시 렌더하므로 2025년 평가일
 * 하나가 화면 전체를 500으로 만든다(DOC-010 AQ-66). `asOf`는 과거가 될 수 없어
 * 그 분기가 **구조적으로 도달 불가**가 된다.
 */
export type ScheduleTaxBasis = {
  constants: TaxConstants
  taxLawYear: number
}

/**
 * 차수별 금액 — DOC-007 §4.5.
 *
 * **세 값이 한 반올림값에서 파생된다.** 각각 반올림하면 화면에서
 * `세후 + 원천징수 ≠ 세전`이 되고 사용자가 뺄셈으로 그것을 본다. §5.3이
 * 지방소득세를 잔차로 두는 것과 같은 판단이며, §4.6의 과세 집계는 그와 달리
 * **반올림하지 않은** 값을 계속 쓴다(반올림하면 2천만 원 경계가 움직인다).
 *
 * `redemption: null`을 넘기는 것이 중요하다 — 이 축 전체가 「예상」이므로
 * 상환 확정값을 섞지 않는다. 그래서 상환 완료 상품에서도 **계약 조건이 내는
 * 반사실**이 나오며, 그것을 표시할지는 화면의 결정이다(억제는 여기서 하지 않는다).
 */
function proceedsOf(
  row: ProductRow,
  roundNo: number,
  tax: ScheduleTaxBasis,
): ScheduleProceeds | null {
  const gross = expectedGrossOf(row, roundNo)
  if (gross == null) return null

  const shown = roundToUnit(gross, '1')

  const taxable = taxableIncome({
    accountType: row.account_type,
    principal: row.principal,
    redemption: null,
    expectedGross: shown,
  })

  const withheld = separateTaxationWithholding({
    taxableIncome: taxable,
    constants: tax.constants,
  })

  return {
    expectedGross: amountString(shown),
    expectedWithholding: amountString(withheld),
    expectedNet: amountString(shown.minus(withheld)),
    expectedPnl: amountString(shown.minus(dec(row.principal))),
    separateTaxationRate: ratioString(dec(tax.constants.separateTaxationRate)),
    taxLawYear: tax.taxLawYear,
  }
}

export function toScheduleItems(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
  /**
   * **필수 인자다.** 선택으로 두면 잊은 호출부가 조용히 `proceeds: null`을
   * 만들고, 그 화면은 금액 칸이 전부 「—」인 채로 정상처럼 보인다.
   */
  tax: ScheduleTaxBasis,
): ScheduleItem[] {
  const j = judge(row, prices, asOf)
  // 정본은 **행 수**다. V-04(차수 연속성)가 계약 계층에만 있으므로 DB는
  // `max(round_no)`가 행 수보다 큰 상태를 허용한다(CLAUDE.md · DOC-011 AQ-29).
  const totalRounds = row.redemption_schedules.length
  /*
   * 상품 단위 값이므로 **차수 밖에서 한 번** 만든다. 안에서 부르면 6차수 상품이
   * 같은 배열을 여섯 벌 만들고, 그중 어느 것도 다르지 않다 — `judge()`를 부모별로
   * 한 번만 부르는 `listSchedule`의 규율과 같은 자리다.
   */
  const underlyings = underlyingLines(
    contractUnderlyingsOf(row),
    underlyingQuotesOf(row, prices, j.worstOf),
  )

  return row.redemption_schedules
    .slice()
    .sort((a, b) => a.round_no - b.round_no)
    .map((s) => ({
      productId: row.id,
      productName: row.name,
      // `users` 임베드가 없어도 소유자 id는 상품 행에 있다 — 이름과 달리
      // 폴백이 필요하지 않다(`owner_id`는 `not null`이다).
      ownerId: row.owner_id,
      ownerName: ownerNameOf(row),
      roundNo: s.round_no,
      evaluationDate: s.evaluation_date,
      dDay: dDay({ from: asOf, evaluationDate: s.evaluation_date }),
      barrier: ratioString(dec(s.barrier)),
      hasLizard: s.lizard_barrier != null,
      // 차수마다 같은 값이다 — `productName`·`ownerName`과 같은 형태이며, 상품별로
      // 접어 내려보내면 §4.4가 루트를 차수로 둔 근거(날짜 범위가 루트 열 조건)가
      // 무너진다.
      status: j.status,
      worstOf: j.worstOf == null ? null : ratioString(j.worstOf),
      conditionResult:
        j.next != null && j.next.round_no === s.round_no
          ? j.conditionResult
          : null,
      integrityIssue:
        j.integrityIssue === 'UNDERLYING_MISSING' ? 'UNDERLYING_MISSING' : null,
      isPast: isPast({ evaluationDate: s.evaluation_date, asOf }),

      /*
       * v3.3의 다섯. **억제 규칙 D1이 미치지 않는다** — 결함 상품도 계약 조건은
       * 온전하고 이 값들은 시세를 하나도 쓰지 않는다. §4.3이 v0.6에서 정확히 이
       * 실수를 했고 v0.8이 되돌렸다(원인의 범위를 넘어 억제하면 같은 상품이
       * §4.6에서는 과세에 기여하면서 여기서만 값을 잃는다).
       */
      principal: amountString(dec(row.principal)),
      annualCouponRate: nullableRatio(row.annual_coupon_rate),
      accountType: row.account_type,
      totalRounds,
      proceeds: proceedsOf(row, s.round_no, tax),

      // v3.4의 셋. 계약 조건 둘은 억제되지 않고, 기초자산 줄은 관측이 빈 자산만
      // 빈다 — 배열 자체가 비는 것은 `UNDERLYING_MISSING`뿐이다.
      kiBarrier: row.ki_barrier == null ? null : ratioString(dec(row.ki_barrier)),
      kiObservation: row.ki_observation,
      underlyings,
    }))
}

// ---------------------------------------------------------------------------
// §4.5 시세 — isStale
// ---------------------------------------------------------------------------

/**
 * 경과 임계값 — §4.5.
 *
 * **3일은 틀린다.** 수집은 일 1회이고(ADR-006) 시장은 주말에 닫히므로, 월요일
 * 기준으로 금요일 종가는 3일 경과다 — 정상값이 매주 경고가 되고 신호가 죽는다.
 * 주말 2일 + 연휴 여유로 5일. 금요일 종가가 다음 주 수요일까지 정상으로 남는다.
 *
 * 법령 상수가 아니라 **표시 임계값**이므로 `tax_constants`가 아니라 여기 둔다 —
 * `ki.ts`의 `DEFAULT_WARNING_MULTIPLIER`와 같은 부류다(절대 규칙 #5의 대상이 아니다).
 */
export const STALE_DAYS = 5

export function isStale(params: {
  asOfDate: string | null
  asOf: string
}): boolean {
  // 시세 행이 없으면 경과 판단의 대상이 아니다. 화면은 E-01("시세 없음")로
  // 표시하며 그 표시가 경과 여부보다 앞선다.
  if (params.asOfDate == null) return false

  const elapsed = dDay({ from: params.asOfDate, evaluationDate: params.asOf })
  return elapsed >= STALE_DAYS
}

// ---------------------------------------------------------------------------
// §4.1 조치 목록
// ---------------------------------------------------------------------------

export type AttentionReason =
  | 'KI_NEAR'
  | 'KI_BELOW'
  | 'KI_TOUCHED'
  | 'EVALUATION_PASSED'
  | 'PRICE_MISSING'
  | 'UNDERLYING_MISSING'
  | 'SCHEDULE_MISSING'

/**
 * 한 상품이 만드는 조치 사유. 여러 개일 수 있다.
 *
 * `KI_BELOW`는 **사용자 확인이 필요한 유일한 상태**다 — 시스템이 `ki_touched_at`을
 * 자동 확정하지 않으므로(D-04) 조치 목록의 존재 이유에 가장 가깝다. `KI_NEAR`로
 * 접으면 확인 요청이 경고로 격하되고, `KI_TOUCHED`로 접으면 확정되지 않은 사실을
 * 확정으로 표시한다.
 *
 * ## 결함은 다른 사유를 가리지 않는다 (§4.1, v0.8)
 *
 * 종전에는 결함이면 그것 하나만 반환했다. 그러나 사유는 저마다 다른 입력에서
 * 나오므로 결함이 파괴하지 않은 입력에서 나오는 사유는 함께 보고한다.
 *
 * **일정 0건 상품에는 이 목록이 유일한 창구다** — §4.4는 행 자체를 만들지 않고
 * (`toScheduleItems`가 0행) §4.1 `upcomingEvaluations`는 `next == null`로
 * 제외한다. 억제하면 그 상품의 KI 하회가 시스템 어디에서도 보이지 않으며,
 * 결함 수정(SCR-204)과 KI 확인은 서로 다른 조치다.
 *
 * ## 순서는 결함 우선으로 고정한다
 *
 * 결함은 사용자가 직접 고쳐야 해소되고 나머지는 시장 상황이므로 조치의 성격이
 * 다르다. 정하지 않으면 구현이 임의로 정하고, 화면은 첫 사유를 대표값으로 읽는다.
 */
export function attentionReasonsFor(j: Judgment): AttentionReason[] {
  const reasons: AttentionReason[] = []

  // 결함이 먼저 온다. 상환으로도 시세로도 해소되지 않는다.
  if (j.integrityIssue != null) reasons.push(j.integrityIssue)

  // 상환이 끝난 상품은 그 밖의 조치 대상이 아니다(E-05)
  if (j.status === 'REDEEMED') return reasons

  if (j.ki === 'TOUCHED') reasons.push('KI_TOUCHED')
  else if (j.ki === 'BELOW') reasons.push('KI_BELOW')
  else if (j.ki === 'WARNING') reasons.push('KI_NEAR')

  // 시세 입력이 파괴된 경우의 `worstOf == null`은 E-01이 **아니다.** 여기서
  // PRICE_MISSING을 내면 화면이 영원히 오지 않을 시세를 기다린다(DOC-007 §3.1).
  // 결함 이름이 아니라 `destroyed`로 판별한다 — 이름으로 가르면 시세 입력을
  // 파괴하는 세 번째 결함이 생겼을 때 조용히 틀린다.
  if (j.destroyed !== 'PRICES' && j.worstOf == null) reasons.push('PRICE_MISSING')

  if (j.overdue.length > 0) reasons.push('EVALUATION_PASSED')

  return reasons
}

/**
 * §4.1의 서명. 판정을 이미 들고 있으면 `attentionReasonsFor`를 직접 쓴다 —
 * 그러지 않으면 같은 상품을 두 번 판정하게 되고 결함 로그가 두 번 찍힌다.
 */
export function attentionReasonsOf(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
): AttentionReason[] {
  return attentionReasonsFor(judge(row, prices, asOf))
}

// ---------------------------------------------------------------------------
// §4.6 bracketLabel 합성
// ---------------------------------------------------------------------------

/**
 * 만·억 단위 한글 금액은 **`lib/format/money.ts`로 이관했다** (P4 컷 1a).
 *
 * 화면도 같은 렌더러가 필요하고(SCR-401의 구간 표, SCR-101의 요약) 복제하면 두
 * 개가 갈리는데 그 갈림을 `bracketLabel` 테스트가 보지 못한다. `lib/db →
 * lib/format` 방향은 어느 의존 규칙도 금지하지 않는다 — 금지는 `lib/tax`·
 * `lib/domain`이 **밖으로** 나가는 것뿐이다(DEP-01).
 */

/**
 * 구간 표시 문자열. 하한과 **다음 구간의 하한**으로 합성한다.
 *
 * 최하단(하한 0)은 `"1,400만 이하"`, 최상단은 `"10억 초과"` 형태다 — §4.6이
 * 중간 구간과 최상단만 정했으므로 최하단은 P3a에서 정하고 문서에 등재했다.
 */
export function bracketLabel(params: {
  lowerBound: DecimalValue
  nextLowerBound: DecimalValue | null
}): string {
  if (params.nextLowerBound == null) {
    return `${koreanAmount(params.lowerBound)} 초과`
  }
  if (params.lowerBound.lte(0)) {
    return `${koreanAmount(params.nextLowerBound)} 이하`
  }
  return `${koreanAmount(params.lowerBound)}~${koreanAmount(params.nextLowerBound)}`
}
