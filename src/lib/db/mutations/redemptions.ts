import { dec, truncateToUnit } from '@/lib/decimal'
import { attributionYear } from '@/lib/domain'
import { DEFAULT_ROUNDING } from '@/lib/tax'

import { loadRedemptionRef, loadTaxYearContext, type ProductRow } from '../queries/load'
import { toTaxConstants } from '../taxConstants'
import { parseRedemptionInput } from '../validate/inputs'
import { Problems, isUuid } from '../validate/primitives'
import { V10_redemptionAfterIssue, V14_lizardRoundDefined } from '../validate/rules'
import {
  requireAffected,
  requireOwnedProduct,
  staleState,
  type Access,
} from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { guardInput, guardSystem, guardSystemAsync } from './guard'
import { toInsert, toUpdate } from './payload'
import { failWith, ok, okVoid, type ActionResult } from './result'
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
async function withholdingFor(
  ctx: MutationContext,
  input: RedemptionInput,
): Promise<Access<string>> {
  if (input.withholdingTax != null) return { ok: true, value: input.withholdingTax }

  // §3.2.2 1행 — 날짜를 받는 순수 함수의 RangeError는 해당 날짜 필드의 검증 오류다.
  // (형식은 이미 V-10 파싱이 봤으므로 정상 경로에서는 여기가 던지지 않는다.)
  const year = guardInput(() => attributionYear({ redemptionDate: input.redemptionDate }), {
    field: 'redemptionDate',
    message: '상환일을 YYYY-MM-DD 형식으로 입력한다.',
  })
  if (!year.ok) return { ok: false, error: year.error }
  if (year.value == null) {
    console.error('[순수 모듈] attributionYear가 상환일을 받고도 null을 반환했다.')
    return { ok: false, error: { code: 'INTERNAL', message: '처리 중 오류가 발생했다.' } }
  }
  const attributionTo = year.value

  // §3.2.2 4행 — 시드 부재·상수 누락은 사용자가 고칠 수 없다. INTERNAL이다.
  const context = await guardSystemAsync(
    () => loadTaxYearContext(ctx, attributionTo),
    `${attributionTo}년 원천징수 산출용 세율 조회`,
  )
  if (!context.ok) return { ok: false, error: context.error }

  const constants = guardSystem(
    () => toTaxConstants(context.value.constants, attributionTo),
    `${attributionTo}년 원천징수 산출용 상수`,
  )
  if (!constants.ok) return { ok: false, error: constants.error }

  const amount = truncateToUnit(
    dec(input.taxableIncome).times(dec(constants.value.separateTaxationRate)),
    DEFAULT_ROUNDING.unit,
  )
  return { ok: true, value: amount.toString() }
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
): void {
  V10_redemptionAfterIssue(p, input.redemptionDate, product.issue_date)

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

    validateAgainstProduct(p, parsed, access.value)
    if (!p.isEmpty) return failWith(p.toError())

    const withholding = await withholdingFor(ctx, parsed)
    if (!withholding.ok) return failWith(withholding.error)

    const { data, error } = await ctx.db
      .from('redemptions')
      .insert(
        toInsert('redemptions', {
          els_id: productId,
          redemption_type: parsed.redemptionType,
          round_no: parsed.roundNo ?? null,
          redemption_date: parsed.redemptionDate,
          gross_amount: parsed.grossAmount,
          taxable_income: parsed.taxableIncome,
          withholding_tax: withholding.value,
          is_confirmed: parsed.isConfirmed,
          note: parsed.note ?? null,
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

    validateAgainstProduct(p, parsed, access.value.product)
    if (!p.isEmpty) return failWith(p.toError())

    // 생성과 **같은 산출**을 쓴다. 다르게 두면 원천징수액을 비운 채 수정할 때
    // 값이 사라지거나 옛 값이 남고, 어느 쪽이든 화면에 드러나지 않는다.
    const withholding = await withholdingFor(ctx, parsed)
    if (!withholding.ok) return failWith(withholding.error)

    const { data, error } = await ctx.db
      .from('redemptions')
      .update(
        toUpdate('redemptions', {
          redemption_type: parsed.redemptionType,
          round_no: parsed.roundNo ?? null,
          redemption_date: parsed.redemptionDate,
          gross_amount: parsed.grossAmount,
          taxable_income: parsed.taxableIncome,
          withholding_tax: withholding.value,
          is_confirmed: parsed.isConfirmed,
          note: parsed.note ?? null,
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
