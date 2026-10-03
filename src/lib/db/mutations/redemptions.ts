import { attributionYear, couponAttributionYear, isCouponBeforeRedemption } from '@/lib/domain'
import { separateTaxationWithholding } from '@/lib/tax'

import {
  TaxSeedRangeError,
  loadRedemptionRef,
  loadTaxYearContext,
  type ProductRow,
  type TaxYearContext,
} from '../queries/load'
import { toTaxConstants } from '../taxConstants'
import { parseRedemptionInput } from '../validate/inputs'
import { Problems, checkProductAmount, isUuid } from '../validate/primitives'
import {
  V10_redemptionAfterIssue,
  V14_lizardRoundDefined,
  V29_monthlyRedemptionPrincipalOnly,
} from '../validate/rules'
import {
  requireAffected,
  requireOwnedProduct,
  staleState,
  type Access,
} from './access'
import type { MutationContext } from './context'
import { couponMonthLabel, latestRecordedMonth } from './couponMonths'
import { failDb } from './errors'
import { guardInput, guardSystem, guardSystemAsync } from './guard'
import { toInsert, toUpdate } from './payload'
import { failWith, ok, okVoid, type ActionError, type ActionResult } from './result'
import type { RedemptionInput } from './types'

/** §5.4·§5.5 — 상환 처리·수정·취소 */

/**
 * 원천징수액 기본값 — §5.4.
 *
 * | 항목 | 확정 |
 * |---|---|
 * | 어느 상수 | `separate_taxation_rate`(15.4%). `separate_taxation_income_tax_rate`(14%)가 **아니다** — 원천징수액은 이미 지방소득세를 포함한 실제 징수액이다 |
 * | 어느 연도 | **`year(redemptionDate)`**. 기준일의 연도가 아니다 — 12월 상환을 1월에 입력하면 두 값이 갈린다 |
 * | 어떻게 접는가 | 원 단위 **절사**. `numeric(15,0)`이므로 접지 않으면 DB가 반올림한다 |
 *
 * **사용자가 덮어쓸 수 있는 기본값이다.** 증권사가 확정한 실제 징수액이 있으면
 * 그것이 정본이므로(A-04) 입력값이 있으면 산출하지 않는다 — 왕복 하나도 아낀다.
 */
/**
 * 세율 조회의 예외 → `ActionError` — **두 종을 갈라야 한다** (§5.4 v1.7, P4 컷 6)
 *
 * `guardSystemAsync`를 그대로 쓰면 어떤 예외든 `INTERNAL`이 된다. 그 접기가 옳은
 * 경우가 대부분이지만(시드 부재·상수 누락은 사용자가 고칠 수 없다) **한 가지가
 * 아니다**: 상환일이 시드 범위보다 과거인 것은 사용자가 고칠 수 있다 — 실제 징수액을
 * 적으면 이 조회 자체가 일어나지 않는다(A-04상 그 값이 정본이다).
 *
 * 가리키는 칸이 `withholdingTax`인 이유는 §5.4의 표에 있다. `redemptionDate`를
 * 가리키면 「그 해는 지원하지 않는다」가 되어 사용자가 **가진 사실**을 부정한다.
 *
 * **`TaxSeedRangeError`만 옮긴다.** 시드가 아예 없는 경우(마이그레이션 미적용)까지
 * 옮기면 진짜 장애가 「징수액을 입력하라」로 보고되고 사용자는 몇 번을 입력해도 같은
 * 오류를 본다 — §3.2가 `INTERNAL`을 「사용자가 고칠 수 없는 것」으로 정의한 이유다.
 *
 * ## 왜 내보내는가
 *
 * **가르는 쪽 절반은 통합 스위트로 관측할 수 없다.** 시드 없는 상태를 만들려면
 * 마이그레이션을 되돌려야 하고, 그러면 다른 216건이 함께 죽는다. 순수 함수로 떼어
 * 두면 양쪽 분기가 상시 스위트에서 보이며, 그러지 않으면 「전부 `VALIDATION_FAILED`로
 * 접는 구현」이 아무 단언도 깨지 않고 통과한다(음성 대조로 확인했다).
 */
export function taxSeedError(error: unknown, year: number): ActionError {
  if (error instanceof TaxSeedRangeError) {
    const message =
      `${year}년의 세율이 없어 원천징수세액을 자동 산출할 수 없다. ` +
      '지급명세서의 실제 징수액을 입력한다.'
    return { code: 'VALIDATION_FAILED', message, fields: { withholdingTax: message } }
  }

  // §3.2.2 4행 — 그 밖은 전부 시스템 전제의 위반이다. 원문은 로그에만 남긴다.
  console.error(
    `[시스템] ${year}년 원천징수 산출용 세율 조회 — ` +
      (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
  )
  return { code: 'INTERNAL', message: '처리 중 오류가 발생했다.' }
}

async function taxYearForWithholding(
  ctx: MutationContext,
  year: number,
): Promise<Access<TaxYearContext>> {
  try {
    return { ok: true, value: await loadTaxYearContext(ctx, year) }
  } catch (error) {
    return { ok: false, error: taxSeedError(error, year) }
  }
}

/**
 * 원천징수 기본값이 귀속연도를 읽는 **날짜 칸** — 오류가 붙는 칸의 이름이기도 하다 (P8 컷 b0).
 *
 * 지금은 상환일 하나다. 월수익 지급 기록(컷 b2~b4)이 지급일을 더한다 — 그 사건도 지급일의 연도에 귀속되고
 * (DOC-007 §7.2 예정) 같은 기본값 규칙(분리과세 원천징수, 세율 조회)을 지난다(설계 원자료 G13). 칸 이름을 열린
 * `string`으로 두지 않는 이유는 오류 문구 · 귀속 규칙을 칸마다 정해야 하기 때문이다 — 아래 두 표가 그 정의이고,
 * 칸을 더하면 두 표가 함께 컴파일을 요구한다.
 */
export type WithholdingDateField = 'redemptionDate' | 'paymentDate'

/**
 * 날짜 칸 → 귀속연도. 상환일은 그 날짜의 연도다(DOC-007 §7.2). **월수익 지급일도 그 날짜의 연도다**(P8 컷 b2 —
 * DOC-011 §5.14 · DOC-005 「월수익 지급일」) — 평가일이 아니다(12월 평가 · 1월 지급이면 다음 해)
 */
const ATTRIBUTION_BY_FIELD: Readonly<Record<WithholdingDateField, (date: string) => number>> = {
  redemptionDate: (date) => attributionYear({ redemptionDate: date }),
  paymentDate: (date) => couponAttributionYear(date),
}

/** 날짜 칸 → 형식 오류 문구(§3.2.2 1행) */
const DATE_MESSAGE_BY_FIELD: Readonly<Record<WithholdingDateField, string>> = {
  redemptionDate: '상환일을 YYYY-MM-DD 형식으로 입력한다.',
  paymentDate: '월수익 지급일을 YYYY-MM-DD 형식으로 입력한다.',
}

/**
 * 연도별 세율 조회의 캐시 — **한 요청 안에서만** 산다 (§5.14 「연도별로 세율을 한 번씩 읽는다」 · P8 컷 b2).
 *
 * 월수익 일괄 기록은 원천징수를 비운 행마다 이 기본값을 지나는데, 행마다 세율을 읽으면 12월 · 1월에 걸친 60건이 60
 * 왕복이 된다. 값은 옳다 — 그래서 이 캐시가 지키는 것은 §5.0.1의 왕복 예산뿐이다. 실패(시드 없는 해)도 캐시한다 —
 * 같은 해의 둘째 행이 같은 오류를 다시 묻지 않는다.
 */
export type TaxYearCache = Map<number, Promise<Access<TaxYearContext>>>

/**
 * **§5.11이 이 함수를 공유한다.** 산출을 복제하면 두 계약이 다른 상수·다른 연도·
 * 다른 접기를 쓸 수 있고, 그 갈림은 원천징수세액을 비운 채 저장할 때에만 드러난다
 * — 즉 평소에는 보이지 않는다. 인자를 `RedemptionInput`이 아니라 **실제로 읽는 값**으로
 * 좁힌 것이 그 공유의 형태다(V-12와 같은 판단).
 *
 * **날짜를 칸 이름과 함께 받는다 (P8 컷 b0)** — 종전에는 `RedemptionInput`의 `redemptionDate`를 직접 읽어
 * 상환에 묶여 있었다. 월수익 지급 기록이 같은 기본값을 지급일로 쓴다(설계 원자료 G13). 동작은 같다.
 */
export async function withholdingFor(
  ctx: MutationContext,
  input: { date: string; taxableIncome: string; withholdingTax?: string },
  dateField: WithholdingDateField,
  cache?: TaxYearCache,
): Promise<Access<string>> {
  if (input.withholdingTax != null) return { ok: true, value: input.withholdingTax }

  // §3.2.2 1행 — 날짜를 받는 순수 함수의 RangeError는 해당 날짜 필드의 검증 오류다.
  // (형식은 이미 V-10 파싱이 봤으므로 정상 경로에서는 여기가 던지지 않는다.)
  const year = guardInput(() => ATTRIBUTION_BY_FIELD[dateField](input.date), {
    field: dateField,
    message: DATE_MESSAGE_BY_FIELD[dateField],
  })
  if (!year.ok) return { ok: false, error: year.error }
  // **`null` 방어가 없다 — 타입이 그것을 표현할 수 없다** (AQ-25).
  // `attributionYear`는 근거를 하나라도 확실히 받으면 `number`를 준다(오버로드 셋 중
  // 첫째). 종전에는 여기에 `console.error` + `INTERNAL` 반환이 있었고 **어느 스위트도
  // 그 분기를 실행하지 않았다** — `input.redemptionDate`가 `string`이므로 도달할 수
  // 없었기 때문이다. 형식 오류는 위 `guardInput`이 `RangeError`로 잡는다.
  const attributionTo = year.value

  // 예외 두 종이 다른 코드로 간다 — 위 함수의 각주(§5.4 v1.7).
  let pending = cache?.get(attributionTo)
  if (pending == null) {
    pending = taxYearForWithholding(ctx, attributionTo)
    cache?.set(attributionTo, pending)
  }
  const context = await pending
  if (!context.ok) return { ok: false, error: context.error }

  const constants = guardSystem(
    () => toTaxConstants(context.value.constants, attributionTo),
    `${attributionTo}년 원천징수 산출용 상수`,
  )
  if (!constants.ok) return { ok: false, error: constants.error }

  // 같은 식이 §5.5(비교과세의 `withheld`)와 §4.5(차수별 세후)에도 있으므로 순수
  // 함수 하나를 공유한다 — DOC-010 AQ-67. 절사와 「둘 중 어느 요율인가」가 그
  // 함수의 몫이 되었고, 여기서는 상수 묶음을 그대로 넘긴다.
  const amount = separateTaxationWithholding({
    taxableIncome: input.taxableIncome,
    constants: constants.value,
  })
  return { ok: true, value: amount.toString() }
}

/** 상환 입력 → `withholdingFor`가 읽는 셋. §5.4 · §5.5 · §5.11이 같은 사상을 지난다 */
export function withholdingInputOf(
  input: Pick<RedemptionInput, 'redemptionDate' | 'taxableIncome' | 'withholdingTax'>,
): { date: string; taxableIncome: string; withholdingTax?: string } {
  return {
    date: input.redemptionDate,
    taxableIncome: input.taxableIncome,
    ...(input.withholdingTax == null ? {} : { withholdingTax: input.withholdingTax }),
  }
}

/**
 * 상품을 읽어야 검사되는 두 규칙 — V-10·V-14.
 *
 * 둘 다 DB에 없다. V-10은 상환일과 발행일이 **다른 테이블**에 있어 단일 행
 * `CHECK`로 표현할 수 없고(DOC-002 DQ-06), V-14의 "그 차수에 리자드 조건이
 * 정의되어 있는가"는 어떤 제약도 보지 않는다 — 조건 없는 차수에 리자드 상환을
 * 붙이면 `applicableCouponRate`가 쿠폰율을 찾지 못해 수령액을 산출할 수 없다.
 */
function validateAgainstProduct(
  p: Problems,
  input: RedemptionInput,
  product: ProductRow,
): RedemptionInput {
  // V-23 — 실수령액의 자릿수는 **부모 상품의** 통화가 정한다(§5.4 v4.9). 통과하면 보조단위
  // 고정 자릿수로 정규화한다 — DB의 scale()이 끝의 0을 세므로 정규화 없이 보내면 이름 있는
  // 제약이 거부한다(primitives `checkProductAmount`)
  const grossAmount = checkProductAmount(
    p,
    'grossAmount',
    input.grossAmount,
    product.currency,
    '실수령액',
  )
  // V-24 ⓐ — 「외화 상품에만」. 원화 상품에 적용 환율을 받으면 저장되지 않을 값을 조용히 버린다
  if (input.exchangeRate != null && product.currency === 'KRW') {
    p.add('V-24', 'exchangeRate', '원화 상품에는 적용 환율을 적지 않는다.')
  }

  // V-27 양방향 (P8 컷 b2 — DOC-011 §5.4 · §5.5) — 상환일 ≥ 기록된 달(지급 · 미지급)들의 월수익 평가일 최댓값.
  // 상환 뒤에 평가되는 월수익은 없다 — 기록 쪽(§5.14)과 같은 사실을 반대에서 본다. DB 겹 `redemptions_before_coupon_payment`
  const latest = latestRecordedMonth(product)
  if (
    latest != null &&
    !isCouponBeforeRedemption({ evaluationDate: latest.evaluationDate, redemptionDate: input.redemptionDate })
  ) {
    p.add(
      'V-27',
      'redemptionDate',
      `상환일이 기록된 달의 월수익 평가일보다 앞설 수 없다 — ${couponMonthLabel(latest.couponNo, latest.evaluationDate)}의 기록이 있다.`,
    )
  }

  // V-29 (P8 컷 b4) — 월지급식 상품의 상환은 원금만이다. 지급방식은 사전 조회의 부모에서 온다(왕복 불변 — §5.4)
  if (product.coupon_payout === 'MONTHLY') {
    V29_monthlyRedemptionPrincipalOnly(p, { grossAmount, taxableIncome: input.taxableIncome }, product.principal)
  }

  // V-10은 **비교 대상이 있을 때만** 검사한다. 기실현 등재는 발행일을 입력받지
  // 않으므로(DOC-011 §5.11) 비교할 값이 없고, 그 부재가 이 계약의 정의다 —
  // 규칙에 예외를 두는 것이 아니라 전제가 없다.
  if (product.issue_date != null) {
    V10_redemptionAfterIssue(p, input.redemptionDate, product.issue_date)
  }

  const schedule =
    product.redemption_schedules.find((row) => row.round_no === input.roundNo) ?? null
  V14_lizardRoundDefined(
    p,
    input,
    schedule == null
      ? null
      : {
          lizardBarrier: schedule.lizard_barrier,
          lizardCouponRate: schedule.lizard_coupon_rate,
        },
  )

  return grossAmount == null ? input : { ...input, grossAmount }
}

/** 상환 `id` → 부모 상품. §5.5의 두 계약은 상품이 아니라 상환을 받는다 */
async function requireOwnedRedemption(
  ctx: MutationContext,
  id: unknown,
  what: string,
): Promise<Access<{ redemptionId: string; product: ProductRow }>> {
  if (!isUuid(id)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '대상을 찾을 수 없다.' } }
  }

  const ref = await guardSystemAsync(() => loadRedemptionRef(ctx, id), `${what} 사전 조회`)
  if (!ref.ok) return { ok: false, error: ref.error }
  if (ref.value == null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '대상 상환을 찾을 수 없다.' } }
  }

  // 소유자 판정은 부모 상품을 경유한다 — 정책이 `exists (select 1 from
  // els_products …)`로 판정하는 것과 같은 경로다(§5.5).
  const access = await requireOwnedProduct(ctx, ref.value.elsId, what)
  if (!access.ok) return { ok: false, error: access.error }

  return { ok: true, value: { redemptionId: ref.value.id, product: access.value } }
}

export function makeRedemptionMutations(ctx: MutationContext) {
  /**
   * §5.4 — 행이 하나이므로 **요청 하나로 원자적이다.** 쓰기 함수가 필요하지 않다.
   *
   * **결함 상품에도 상환을 기록할 수 있다.** 상환 실적은 증권사가 확정한 외부
   * 사실이고(A-04) 결함은 우리 쪽 데이터의 문제이므로, 사실의 기록을 우리 결함이
   * 막으면 과세 이력이 누락된다. 단 `EARLY`·`LIZARD`는 `round_no`가 실재해야
   * 하므로(I-13) 일정 0건 상품에서는 DB가 `23503`으로 거부한다 — 그때 사용자가
   * 할 일은 상환을 포기하는 것이 아니라 일정을 먼저 복구하는 것이다.
   */
  async function createRedemption(
    productId: string,
    input: RedemptionInput,
  ): Promise<ActionResult<{ id: string }>> {
    const p = new Problems()
    const parsed = parseRedemptionInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const access = await requireOwnedProduct(ctx, productId, '상환 처리')
    if (!access.ok) return failWith(access.error)

    // I-01 — 상품당 상환 1건. `UNIQUE(els_id)`가 최종 보장이고 사전 조회는
    // "이미 상환됨"을 화면이 말할 수 있게 한다.
    if (access.value.redemptions != null) {
      return failWith({
        code: 'CONFLICT',
        message: '이미 상환 처리된 상품이다.',
      })
    }

    const checked = validateAgainstProduct(p, parsed, access.value)
    if (!p.isEmpty) return failWith(p.toError())

    const withholding = await withholdingFor(ctx, withholdingInputOf(checked), 'redemptionDate')
    if (!withholding.ok) return failWith(withholding.error)

    const { data, error } = await ctx.db
      .from('redemptions')
      .insert(
        toInsert('redemptions', {
          els_id: productId,
          redemption_type: parsed.redemptionType,
          round_no: parsed.roundNo ?? null,
          redemption_date: checked.redemptionDate,
          gross_amount: checked.grossAmount,
          taxable_income: checked.taxableIncome,
          withholding_tax: withholding.value,
          exchange_rate: checked.exchangeRate ?? null,
          is_confirmed: checked.isConfirmed,
          note: checked.note ?? null,
        }),
      )
      .select('id')
    if (error != null) return failDb(error, '상환 처리')

    const created = data?.[0]
    return created == null ? failWith(staleState()) : ok({ id: created.id })
  }

  /**
   * §5.5 — **확정된 과세 이력을 고치는 일이다.**
   *
   * `taxableIncome`·`redemptionDate`를 고치면 §4.6의 연도별 집계가 그대로 바뀐다.
   * `roundNo` 변경은 I-13의 복합 FK가 새 차수의 실재를 요구하며, 이미 상환된
   * 건의 귀속연도는 상환일에서 나오므로 차수를 바꿔도 귀속연도는 움직이지 않는다
   * — 바뀌는 것은 "어느 차수에서 상환되었는가"라는 사실 기록이다.
   */
  async function updateRedemption(
    id: string,
    input: RedemptionInput,
  ): Promise<ActionResult<void>> {
    const p = new Problems()
    const parsed = parseRedemptionInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const access = await requireOwnedRedemption(ctx, id, '상환 수정')
    if (!access.ok) return failWith(access.error)

    const checked = validateAgainstProduct(p, parsed, access.value.product)
    if (!p.isEmpty) return failWith(p.toError())

    // 생성과 **같은 산출**을 쓴다. 다르게 두면 원천징수액을 비운 채 수정할 때
    // 값이 사라지거나 옛 값이 남고, 어느 쪽이든 화면에 드러나지 않는다.
    const withholding = await withholdingFor(ctx, withholdingInputOf(checked), 'redemptionDate')
    if (!withholding.ok) return failWith(withholding.error)

    const { data, error } = await ctx.db
      .from('redemptions')
      .update(
        toUpdate('redemptions', {
          redemption_type: checked.redemptionType,
          round_no: checked.roundNo ?? null,
          redemption_date: checked.redemptionDate,
          gross_amount: checked.grossAmount,
          taxable_income: checked.taxableIncome,
          withholding_tax: withholding.value,
          // 전체 교체(§5.5) — 빠지면 비운다. 원화 상품은 V-24가 이미 거부했으므로 여기서 null이다
          exchange_rate: checked.exchangeRate ?? null,
          is_confirmed: checked.isConfirmed,
          note: checked.note ?? null,
        }),
      )
      .eq('id', id)
      .select('id')
    if (error != null) return failDb(error, '상환 수정')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  /**
   * §5.5 — **상품 삭제 2단계의 첫 단계다.**
   *
   * §5.3이 상환 완료 상품의 삭제를 `CONFLICT`로 막으므로 상품을 지우려는
   * 사용자는 반드시 이 계약을 먼저 통과한다. 그 순서가 우연이 아니라 설계다 —
   * 2단계로 쪼개면 사용자가 **과세 이력을 지운다는 사실을 명시적으로 확인**한다.
   */
  async function deleteRedemption(id: string): Promise<ActionResult<void>> {
    const access = await requireOwnedRedemption(ctx, id, '상환 취소')
    if (!access.ok) return failWith(access.error)

    const { data, error } = await ctx.db
      .from('redemptions')
      .delete()
      .eq('id', id)
      .select('id')
    if (error != null) return failDb(error, '상환 취소')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  return { createRedemption, updateRedemption, deleteRedemption }
}
