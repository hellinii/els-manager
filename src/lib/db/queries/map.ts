import {
  dec,
  roundToUnit,
  type DecimalValue,
} from '@/lib/decimal'
import {
  asActive,
  attributionYear,
  dDay,
  evaluateCondition,
  grossExpected,
  isPast,
  isRedeemed,
  kiStatus,
  nextEvaluation,
  overdueEvaluations,
  realizedPnl,
  taxableIncome,
  underlyingRatio,
  worstOf,
  type ConditionResult,
  type KiStatus,
  type RedemptionMark,
} from '@/lib/domain'

import type { LatestPrice, ProductRow, ScheduleRow } from './load'

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

/** 금액: 정수 문자열. DOC-007 §2의 "화면 표시 금액 원 단위 반올림"을 따른다. */
export function amountString(value: DecimalValue): string {
  return roundToUnit(value, '1').toFixed(0)
}

/** 비율: 소수 4자리 고정. 저장 정밀도 `numeric(6,4)`와 일치한다. */
export function ratioString(value: DecimalValue): string {
  return value.toDecimalPlaces(4).toFixed(4)
}

// ---------------------------------------------------------------------------
// 무결성 결함 — D1, DOC-002 I-07
// ---------------------------------------------------------------------------

export type IntegrityIssue = 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING'

/**
 * 결함을 **명시 상태로** 표시한다. `worstOf`에 0건을 넘기지 않는다.
 *
 * 넘기면 `RangeError`가 나고, 모든 SELECT가 `using (true)`이므로 **남의 결함
 * 상품 1건이 SCR-101·201·301을 전원에게 죽인다.** `getProduct`까지 죽으면
 * SCR-204(수정)도 같은 계약을 쓰므로 유일한 복구 경로가 함께 막혀 UI로는
 * 고칠 수 없는 상태가 된다.
 *
 * 순수 모듈은 그대로 던진다 — DB를 경유하는 다른 경로(AQ-14)의 최종 안전망이다.
 * 조회 계층은 그것을 **삼키지 않고** 기록한다.
 */
export function integrityIssueOf(row: ProductRow): IntegrityIssue | null {
  if (row.els_underlyings.length === 0) {
    console.error(
      `[무결성] 상품 ${row.id}에 기초자산이 0건이다 (DOC-002 I-07). ` +
        '조건 판정을 생략하고 integrityIssue로 표시한다.',
    )
    return 'UNDERLYING_MISSING'
  }
  if (row.redemption_schedules.length === 0) {
    console.error(
      `[무결성] 상품 ${row.id}에 평가일정이 0건이다 (DOC-002 I-07). ` +
        '조건 판정을 생략하고 integrityIssue로 표시한다.',
    )
    return 'SCHEDULE_MISSING'
  }
  return null
}

// ---------------------------------------------------------------------------
// 판정 입력 조립
// ---------------------------------------------------------------------------

export function redemptionMarkOf(row: ProductRow): RedemptionMark {
  return row.redemptions == null
    ? null
    : { redemptionDate: row.redemptions.redemption_date }
}

/** 기초자산별 비율. 시세가 하나라도 없으면 `null`을 담는다. */
function ratiosOf(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
): Array<{ assetId: string; ratio: DecimalValue | null }> {
  return row.els_underlyings.map((u) => {
    const current = prices.get(u.asset_id)?.price ?? null
    return {
      assetId: u.asset_id,
      ratio:
        current == null ? null : underlyingRatio(u.base_price, current.price),
    }
  })
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
  worstOf: DecimalValue | null
  next: ScheduleRow | null
  conditionResult: ConditionResult | null
  ki: KiStatus | null
}

/**
 * 한 상품의 판정 일체. 세 계약(§4.1·§4.2·§4.4)이 같은 값을 써야 하므로 한곳에서 낸다.
 *
 * **`conditionResult`·`ki`의 `null`은 세 원인을 갖고, 판정 순서가 있다** (§4.2).
 *   1. `integrityIssue ≠ null` — 시세를 기다려도 해소되지 않는다
 *   2. 상환 완료(E-05) — 영구적이다
 *   3. 시세 없음(E-01) — 시세가 수집되면 값이 생긴다
 *
 * 순서가 필요한 이유: 무결성 결함 상품은 `status = 'ACTIVE'`이고 `worstOf = null`
 * 이므로 **3순위 조건을 그대로 만족한다.** 순서가 없으면 화면이 "시세 없음"을
 * 표시하며 영원히 오지 않을 시세를 기다린다 — DOC-007 §3.1이 막으려던 상태다.
 */
export function judge(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
): Judgment {
  const mark = redemptionMarkOf(row)
  const status = isRedeemed(mark) ? 'REDEEMED' : 'ACTIVE'
  const integrityIssue = integrityIssueOf(row)

  const next =
    status === 'REDEEMED'
      ? null
      : (nextEvaluation({
          schedules: row.redemption_schedules.map(forJudgment),
          asOf,
        })?.row ?? null)

  // 1순위 — 결함이면 판정하지 않는다
  if (integrityIssue != null) {
    return {
      status,
      integrityIssue,
      worstOf: null,
      next,
      conditionResult: null,
      ki: null,
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

  return { status, integrityIssue, worstOf: w, next, conditionResult, ki }
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
  isOwner: boolean
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
    ownerName: row.users?.display_name ?? '(알 수 없음)',
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
    isOwner: row.owner_id === viewerId,
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
    issueDate: string
    principal: string
    evaluationPeriodMonths: number
    totalRounds: number
    integrityIssue: IntegrityIssue | null
    annualCouponRate: string
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
    expectedGross: string
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
function expectedGrossOf(row: ProductRow, roundNo: number): DecimalValue {
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
  const ratios = ratiosOf(row, prices)

  // isWorst — 최저 비율이 동률이면 전부 true. worstOf가 null이면 전부 false.
  // 동률에서 하나만 고르면 그 선택이 표시 순서에 의존하는 임의값이 된다(§4.3).
  const worstRatio = j.worstOf
  const isWorstOf = (ratio: DecimalValue | null): boolean =>
    worstRatio != null && ratio != null && ratio.equals(worstRatio)

  const schedules = [...row.redemption_schedules].sort(
    (a, b) => a.round_no - b.round_no,
  )

  return {
    product: {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      ownerId: row.owner_id,
      ownerName: row.users?.display_name ?? '(알 수 없음)',
      isOwner: row.owner_id === viewerId,
      issueDate: row.issue_date,
      principal: amountString(dec(row.principal)),
      evaluationPeriodMonths: row.evaluation_period_months,
      // 정본은 **행 수**다. max(round_no)가 아니다 — 연속성(V-04)은 계약 계층에만
      // 있어 DB는 1,2,99를 허용하므로 두 값이 갈린다(DOC-002 §4.6).
      totalRounds: schedules.length,
      integrityIssue: j.integrityIssue,
      annualCouponRate: ratioString(dec(row.annual_coupon_rate)),
      kiBarrier: row.ki_barrier == null ? null : ratioString(dec(row.ki_barrier)),
      kiObservation: row.ki_observation,
      kiTouchedAt: row.ki_touched_at,
      accountType: row.account_type,
      note: row.note,
    },

    underlyings: row.els_underlyings
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((u) => {
        const latest = prices.get(u.asset_id) ?? null
        const ratio = ratios.find((r) => r.assetId === u.asset_id)?.ratio ?? null
        return {
          assetId: u.asset_id,
          assetName: latest?.asset.name ?? u.assets?.name ?? '(알 수 없음)',
          basePrice: u.base_price,
          currentPrice: latest?.price?.price ?? null,
          priceAsOf: latest?.price?.as_of_date ?? null,
          priceSource: latest?.price?.source ?? null,
          ratio: ratio == null ? null : ratioString(ratio),
          isWorst: isWorstOf(ratio),
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
      expectedGross: amountString(expectedGrossOf(row, s.round_no)),
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
 * `projection`은 **세 경우에 `null`**이다 (§4.3).
 *   ① 상환 완료 ② `integrityIssue ≠ null`
 *   ③ **전 차수가 경과했는데 미상환** — DOC-007 §9.2가 이 경우 적용 차수를
 *      결정할 수 없다고 규정한다. v0.5의 주석("상환완료 시 null")은 ③을 놓쳤다.
 */
function projectionOf(
  row: ProductRow,
  j: Judgment,
): ProductDetailView['projection'] {
  if (j.status === 'REDEEMED') return null
  if (j.integrityIssue != null) return null
  if (j.next == null) return null

  const gross = expectedGrossOf(row, j.next.round_no)
  const year = attributionYear({ evaluationDate: j.next.evaluation_date })
  if (year == null) return null

  return {
    appliedRoundNo: j.next.round_no,
    expectedGross: amountString(gross),
    expectedTaxableIncome: amountString(
      taxableIncome({
        accountType: row.account_type,
        principal: row.principal,
        redemption: null,
        expectedGross: gross,
      }),
    ),
    attributionYear: year,
  }
}

// ---------------------------------------------------------------------------
// §4.4 평가일정
// ---------------------------------------------------------------------------

export type ScheduleItem = {
  productId: string
  productName: string
  ownerName: string
  roundNo: number
  evaluationDate: string
  dDay: number
  barrier: string
  hasLizard: boolean
  worstOf: string | null
  conditionResult: ConditionResult | null
  /** 일정 0건 상품은 이 목록에 **행 자체가 생기지 않으므로** SCHEDULE_MISSING은 도달 불가다 */
  integrityIssue: 'UNDERLYING_MISSING' | null
  isPast: boolean
}

export function toScheduleItems(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
): ScheduleItem[] {
  const j = judge(row, prices, asOf)

  return row.redemption_schedules
    .slice()
    .sort((a, b) => a.round_no - b.round_no)
    .map((s) => ({
      productId: row.id,
      productName: row.name,
      ownerName: row.users?.display_name ?? '(알 수 없음)',
      roundNo: s.round_no,
      evaluationDate: s.evaluation_date,
      dDay: dDay({ from: asOf, evaluationDate: s.evaluation_date }),
      barrier: ratioString(dec(s.barrier)),
      hasLizard: s.lizard_barrier != null,
      worstOf: j.worstOf == null ? null : ratioString(j.worstOf),
      conditionResult:
        j.next != null && j.next.round_no === s.round_no
          ? j.conditionResult
          : null,
      integrityIssue:
        j.integrityIssue === 'UNDERLYING_MISSING' ? 'UNDERLYING_MISSING' : null,
      isPast: isPast({ evaluationDate: s.evaluation_date, asOf }),
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
 */
export function attentionReasonsOf(
  row: ProductRow,
  prices: Map<string, LatestPrice>,
  asOf: string,
): AttentionReason[] {
  const j = judge(row, prices, asOf)
  const reasons: AttentionReason[] = []

  // 무결성 결함이 최우선 — 시세를 기다려도 해소되지 않는다
  if (j.integrityIssue != null) return [j.integrityIssue]

  // 상환이 끝난 상품은 조치 대상이 아니다(E-05)
  if (j.status === 'REDEEMED') return []

  if (j.ki === 'TOUCHED') reasons.push('KI_TOUCHED')
  else if (j.ki === 'BELOW') reasons.push('KI_BELOW')
  else if (j.ki === 'WARNING') reasons.push('KI_NEAR')

  if (j.worstOf == null) reasons.push('PRICE_MISSING')

  const overdue = overdueEvaluations({
    schedules: row.redemption_schedules.map(forJudgment),
    asOf,
    redemption: redemptionMarkOf(row),
  })
  if (overdue.length > 0) reasons.push('EVALUATION_PASSED')

  return reasons
}

// ---------------------------------------------------------------------------
// §4.6 bracketLabel 합성
// ---------------------------------------------------------------------------

function withCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 만·억 단위 한글 금액. `tax_brackets`에는 하한만 있고 표시 문자열의 원천이
 * 없으므로 계약 계층이 합성한다(§4.6).
 */
export function koreanAmount(value: DecimalValue): string {
  const eok = value.div('100000000').floor()
  const man = value.mod('100000000').div('10000').floor()

  if (eok.gt(0) && man.gt(0)) {
    return `${withCommas(eok.toFixed(0))}억 ${withCommas(man.toFixed(0))}만`
  }
  if (eok.gt(0)) return `${withCommas(eok.toFixed(0))}억`
  if (man.gt(0)) return `${withCommas(man.toFixed(0))}만`
  return '0'
}

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
