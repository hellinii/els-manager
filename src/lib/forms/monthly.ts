import { MAX_COUPON_SCHEDULES } from '@/lib/domain/coupon'
import { EVALUATION_DATE_OFFSET_DAYS, generateEvaluationDates, shiftBusinessDays } from '@/lib/domain/schedule'

import { parseFieldPath, path } from './fieldPath'
import { countOf } from './rounds'

/**
 * SCR-204 월지급 블록 — 칸 · 산식 · 일괄 채우기 (P8 컷 b3-4, DOC-008 SCR-204 「P8 월지급식」 · v2.29)
 *
 * ## 일정은 «옮기지 않는다» — 버튼이 채운다 (보류 규칙, SQ-21 ⓖ b3 개정)
 *
 * 차수 평가일은 「산식대로이던 날짜를 발행일을 따라 옮긴다」는 기계(`schedules.ts` — 기준 필드 · 자동 따라가기 ·
 * 저장 보류)를 갖는다. 월수익 일정은 그 기계를 쓰지 않는다 — 발행일 · 평가주기 · 총 차수를 바꿔도 칸은 그대로이고
 * 「평가일 산식으로 채우기」를 눌러야 다시 계산된다. 어긋난 채 저장하면 V-26(1..K 연속 · 만기 이하)이 거부한다.
 *
 * ## 「산식」 표식은 지금의 산식과 칸을 비교한다 (v2.29 — 기준 필드를 철회했다)
 *
 * 옮기지 않으므로 기준을 기억할 이유가 없고, 기억하면 발행일을 바꾼 뒤에도 옛 산식의 날짜에 표식이 붙는다. 지금의
 * 산식과 다르면 표식이 사라져 어긋남을 말한다.
 *
 * ## 순수하다 — `transition`(productForm.ts)이 부른다
 *
 * 값 맵을 받아 값 맵을 돌려준다. 어댑터는 어떤 스위트의 import 그래프에도 없으므로(AQ-23) 규칙은 전부 여기 있다.
 */

/** 월수익 연쿠폰율 칸 — 퍼센트로 적는다(「연 24.24%」 — 「월 2.02%」가 아니다) */
export const MONTHLY_RATE_FIELD = 'monthlyCouponAnnualRate'
/** 월수익 배리어 일괄 칸 — 채우는 도구다. 계약의 필드가 아니다(정본은 행마다의 칸) */
export const COUPON_BARRIERS_FIELD = 'couponBarriers'
/** 행 — 계약의 오류 키(`couponSchedules[i].…` — V-25 · V-26)와 같은 이름이라 오류가 그 행에 붙는다 */
export const COUPON_SCHEDULES_FIELD = 'couponSchedules'
export const COUPON_SCHEDULE_SUBS = ['evaluationDate', 'paymentDate', 'couponBarrier'] as const

/**
 * 기록된 마지막 월수익 순번 — 수정 화면의 잠금(`couponLock`)이 있을 때만 숨은 칸으로 싣는다(DOC-008 v2.41 · 민서 결정
 * 2026-10-03). 「평가일 산식으로 채우기」가 이 순번까지의 행을 그대로 두고 그 뒤만 다시 채운다 — 기록된 달의 날짜를 덮으면
 * 동결(DQ-14)과 부딪혀 저장이 `CONFLICT`가 되기 때문이다. **계약 필드가 아니다** — 조작해도 저장은 계약 · 트리거가 막는다
 */
export const COUPON_RECORDED_THROUGH_FIELD = 'couponRecordedThrough'

/** 월수익 지급일 = 평가일 + 3영업일(주말만 건너뛴다 — 휴장일은 모른다, RD-03) */
export const COUPON_PAYMENT_BUSINESS_DAYS = 3

export function couponCell(index: number, sub: (typeof COUPON_SCHEDULE_SUBS)[number]): string {
  return path(COUPON_SCHEDULES_FIELD, index, sub)
}

/** 지금 렌더가 월지급식인가 — 블록 · 이름 · 파서가 같은 판정을 쓴다 */
export function isMonthlyValues(values: Record<string, string>): boolean {
  return (values.couponPayout ?? '') === 'MONTHLY'
}

/**
 * 월수익 일정의 행 수 — **값에서 파생한다**(차수표 · 기초자산과 같은 규약). 최소 0이다 — 산식으로 채우기 전에는
 * 행이 없고 그 상태를 화면이 안내로 말한다(기초자산처럼 빈 행 하나를 두면 빈 칸 오류가 행 수만큼 붙는다).
 */
export function couponRowCountOf(values: Record<string, string>): number {
  let max = -1
  for (const key of Object.keys(values)) {
    const parsed = parseFieldPath(key)
    if (parsed?.field !== COUPON_SCHEDULES_FIELD || parsed.index == null) continue
    if (parsed.index > max) max = parsed.index
  }
  return Math.min(max + 1, MAX_COUPON_SCHEDULES)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 산식 — K = 평가주기 × 총 차수 행의 (평가일, 지급일). 계산할 수 없으면 `null`(발행일 · 주기 · 총 차수 중 빈 칸 ·
 * 형식 오류 · K가 1..60 밖).
 */
export function couponFormulaOf(
  values: Record<string, string>,
): Array<{ evaluationDate: string; paymentDate: string }> | null {
  const issueDate = (values.issueDate ?? '').trim()
  const period = countOf(values.evaluationPeriodMonths)
  const rounds = countOf(values.totalRounds)
  if (!ISO_DATE.test(issueDate) || !Number.isInteger(period) || !Number.isInteger(rounds)) return null
  const months = period * rounds
  if (period < 1 || rounds < 1 || months > MAX_COUPON_SCHEDULES) return null
  try {
    return generateEvaluationDates({
      issueDate,
      evaluationPeriodMonths: 1,
      totalRounds: months,
      offsetDays: EVALUATION_DATE_OFFSET_DAYS,
    }).map((evaluationDate) => ({
      evaluationDate,
      paymentDate: shiftBusinessDays(evaluationDate, COUPON_PAYMENT_BUSINESS_DAYS),
    }))
  } catch {
    // 달력에 없는 날짜(2026-02-30) — 산식이 없다. 형식 오류의 문구는 계약이 발행일 칸에 붙인다
    return null
  }
}

/** 그 행의 두 날짜가 지금의 산식과 같은가 — 「산식」 표식 */
export function isFormulaCouponRow(
  values: Record<string, string>,
  index: number,
  formula: ReturnType<typeof couponFormulaOf>,
): boolean {
  const expected = formula?.[index]
  if (expected == null) return false
  return (
    (values[couponCell(index, 'evaluationDate')] ?? '') === expected.evaluationDate &&
    (values[couponCell(index, 'paymentDate')] ?? '') === expected.paymentDate
  )
}

/**
 * 「평가일 산식으로 채우기」 — 행을 K개로 맞추고 두 날짜를 산식으로 덮는다. 남는 행의 월수익 배리어는 그대로 두고,
 * 새 행은 일괄 칸의 값(없으면 빈칸)이다. 산식이 없으면 값을 바꾸지 않고 안내만 한다.
 *
 * **기록이 있으면(`COUPON_RECORDED_THROUGH_FIELD` = M > 0) 「기록 뒤 달」만 채운다** (P8.5 · DOC-008 v2.41): 1..M번째 행은
 * 날짜를 그대로 두고 M+1번째부터 산식이다. 산식의 행 수가 M보다 적으면(총 차수를 줄여 기록된 달이 만기 뒤가 된다) 값을 바꾸지
 * 않고 안내한다 — 기록된 달을 잘라 내면 저장이 사전 검사(`CONFLICT`)로 거부된다.
 */
export function applyCouponDates(values: Record<string, string>): {
  values: Record<string, string>
  notice: string
} {
  const formula = couponFormulaOf(values)
  if (formula == null) {
    return {
      values,
      notice: `발행일 · 평가주기 · 총 차수를 먼저 입력한다(월수익은 만기까지 ${MAX_COUPON_SCHEDULES}개월 이하).`,
    }
  }
  const through = recordedThroughOf(values)
  if (through > formula.length) {
    return {
      values,
      notice: `기록된 ${through}번째 달까지는 줄일 수 없다 — 총 차수를 확인한다(지금 만기까지 ${formula.length}개월).`,
    }
  }
  const before = couponRowCountOf(values)
  const fill = (values[COUPON_BARRIERS_FIELD] ?? '').trim()
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    // 행이 아닌 이름은 그대로, 행은 K개 안의 것만 남긴다(줄어든 만기의 잔재를 남기지 않는다)
    const parsed = parseFieldPath(key)
    if (parsed?.field === COUPON_SCHEDULES_FIELD && parsed.index != null && parsed.index >= formula.length) continue
    next[key] = value
  }
  formula.forEach((dates, index) => {
    // 기록된 달까지는 그대로 — 날짜도 배리어도 덮지 않는다
    if (index < through) return
    next[couponCell(index, 'evaluationDate')] = dates.evaluationDate
    next[couponCell(index, 'paymentDate')] = dates.paymentDate
    if (index >= before) next[couponCell(index, 'couponBarrier')] = fill
  })
  if (through > 0) {
    return {
      values: next,
      notice:
        through === formula.length
          ? `기록된 ${through}번째 달이 만기까지다 — 산식으로 채울 기록 뒤 달이 없다.`
          : `기록된 ${through}번째 달까지는 그대로 두고 ${through + 1}~${formula.length}번째를 산식으로 채웠다(지급일 = 평가일 + ${COUPON_PAYMENT_BUSINESS_DAYS}영업일). ` +
            '휴장일은 모른다 — 투자설명서의 실제 날짜로 고친다.',
    }
  }
  return {
    values: next,
    notice:
      `월수익 일정 ${formula.length}행을 산식으로 채웠다(평가일 = 발행일 + k개월 − 1일 · 지급일 = 평가일 + ${COUPON_PAYMENT_BUSINESS_DAYS}영업일). ` +
      '휴장일은 모른다 — 투자설명서의 실제 날짜로 고친다.',
  }
}

/** 숨은 칸의 M — 정수가 아니거나 없으면 0(잠금 없음) */
function recordedThroughOf(values: Record<string, string>): number {
  const raw = (values[COUPON_RECORDED_THROUGH_FIELD] ?? '').trim()
  return /^\d{1,2}$/.test(raw) ? Number.parseInt(raw, 10) : 0
}

/** 「월수익 배리어 일괄 채우기」 — 한 값을 모든 행에 펼친다(차수표의 일괄 배리어와 같은 짝 — 정본은 행마다의 칸) */
export function applyCouponBarriers(values: Record<string, string>): {
  values: Record<string, string>
  notice: string
} {
  const fill = (values[COUPON_BARRIERS_FIELD] ?? '').trim()
  const rows = couponRowCountOf(values)
  if (fill === '') return { values, notice: '월수익 배리어를 적고 「일괄 채우기」를 누른다. 예: 50' }
  if (rows === 0) return { values, notice: '월수익 일정 행이 없다 — 「평가일 산식으로 채우기」를 먼저 누른다.' }
  const next = { ...values }
  for (let index = 0; index < rows; index += 1) next[couponCell(index, 'couponBarrier')] = fill
  return { values: next, notice: `월수익 배리어 ${fill}%를 ${rows}행에 채웠다.` }
}

/** 월지급 블록의 모든 이름 — 월지급식 렌더에서만 폼의 이름이다(`productFieldNames`) */
export function monthlyFieldNames(couponRows: number): string[] {
  const names: string[] = [MONTHLY_RATE_FIELD, COUPON_BARRIERS_FIELD]
  for (let index = 0; index < couponRows; index += 1) {
    for (const sub of COUPON_SCHEDULE_SUBS) names.push(couponCell(index, sub))
  }
  return names
}

/**
 * 월수익 지급 기록이 있는 상품의 잠금 — 수정 화면(SCR-204 · DQ-14 · 민서 결정(2026-10-02) ④).
 *
 * 기록이 하나라도 있으면 상품 통화 · 쿠폰 지급방식을 바꿀 수 없고(트리거 `els_products_coupon_recorded_immutable`),
 * 기록된 달의 평가일 · 지급일 · 순번도 바꿀 수 없다(`monthly_coupon_schedules_recorded_immutable`). 화면은 그 사실을
 * 칸에서 말한다 — 두 선택 상자는 값 글자 + 숨은 입력(`<select>`에는 `readOnly`가 없고 `disabled`는 제출되지 않는다 —
 * DOC-008 SQ-21 ⓖ b3 개정), 기록된 달의 두 날짜는 `readOnly`, 「평가일 산식으로 채우기」 대신 「기록 뒤 달 산식으로
 * 채우기」를 그린다(v2.29 (3) → v2.41 — 기록 뒤 달만 채운다).
 * `null` = 잠금 없음(기록 없음 · 등록 화면).
 */
export type CouponLock = { recordedCouponNos: readonly number[] }

export function couponLockOf(view: {
  coupons: ReadonlyArray<{ couponNo: number; record: unknown }> | null
  unnumberedCouponRecords: readonly unknown[]
}): CouponLock | null {
  const recordedCouponNos = (view.coupons ?? []).filter((c) => c.record != null).map((c) => c.couponNo)
  if (recordedCouponNos.length === 0 && view.unnumberedCouponRecords.length === 0) return null
  return { recordedCouponNos }
}
