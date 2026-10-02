import { MAX_COUPON_SCHEDULES } from '@/lib/domain/coupon'

import { loadCouponPaymentRef, type ProductRow } from '../queries/load'
import {
  parseCouponPaymentEntries,
  parseCouponPaymentFields,
  type CouponPaymentFields,
} from '../validate/inputs'
import { Problems, checkProductAmount, isPlainObject, isUuid } from '../validate/primitives'
import { requireAffected, requireOwnedProduct, staleState, type Access } from './access'
import type { MutationContext } from './context'
import { couponMonthLabel } from './couponMonths'
import { failDb } from './errors'
import { guardSystemAsync } from './guard'
import { toInsert, toUpdate } from './payload'
import { withholdingFor, type TaxYearCache } from './redemptions'
import { failWith, ok, okVoid, type ActionError, type ActionResult } from './result'
import type { CouponPaymentInput } from './types'

/**
 * §5.14 · §5.15 — 월수익 기록 · 수정 · 삭제 (P8 컷 b2 · DOC-011 · DOC-002 §4.14)
 *
 * ## 세 계약 모두 쓰기 함수가 없다
 *
 * 일괄 기록은 **다행 INSERT 한 번**이고(한 문장 = 한 트랜잭션 — 한 행이라도 DB가 거부하면 아무 행도 남지 않는다),
 * 수정은 한 행 UPDATE, 삭제는 `DELETE … WHERE els_id = $1 AND id = ANY($2)` 한 문장이다. §5.4의 「행이 하나이므로 요청
 * 하나로 원자적」과 같은 근거다.
 *
 * ## 계약 계층의 검사는 UX다 — DB가 최종 보장이다
 *
 * 아래 사전 검사(V-27 · V-28 · V-23 · V-24 ⓐ)는 **행 단위 키**(`entries[i].…`)로 어느 행을 고칠지 말하기 위한 것이다.
 * 같은 사실을 DB가 다시 본다 — 형태 `CHECK` · `UNIQUE` 둘 · 복합 FK · 부모 트리거 셋(I-26 · I-27). 사전 검사와 쓰기
 * 사이의 경합은 DB가 막고(부모 행 잠금 — DOC-010 AQ-93) 그 응답은 색인 없는 키다(DOC-002 §8 「DB 오류의 필드 키」).
 */

export type Checked = CouponPaymentFields & { couponNo: number | null }

/**
 * 부모 상품을 읽어야 보이는 규칙 — V-27 · V-28의 나머지 · V-23 · V-24 ⓐ (§5.14 · §5.15).
 *
 * `selfId`는 §5.15의 그 기록 자신이다 — 「아직 기록되지 않았다」 · 「지급일이 겹치지 않는다」에서 자기 자신을 뺀다.
 * 통과한 세전은 부모 통화의 보조단위 고정 자릿수로 정규화한다(V-23 — DB의 `scale()`이 끝의 0을 센다).
 */
export function checkAgainstProduct(
  p: Problems,
  rows: ReadonlyArray<{ at: string; entry: Checked }>,
  product: ProductRow,
  asOf: string,
  selfId: string | null,
): Checked[] {
  const checked: Checked[] = []
  const evaluationOf = new Map(
    product.monthly_coupon_schedules.map((s) => [s.coupon_no, s.evaluation_date]),
  )
  const others = product.monthly_coupon_payments.filter((payment) => payment.id !== selfId)
  const recordedNos = new Set(others.map((payment) => payment.coupon_no).filter((n) => n != null))
  const paidDates = new Set(
    others
      .filter((payment) => payment.outcome === 'PAID' && payment.payment_date != null)
      .map((payment) => payment.payment_date as string),
  )
  const redemptionDate = product.redemptions?.redemption_date ?? null
  const seenNos = new Set<number>()
  const seenDates = new Set<string>()

  for (const { at, entry } of rows) {
    // ── V-27 — 기록 대상 ───────────────────────────────────────────────
    if (product.entry_mode === 'FULL') {
      if (entry.couponNo == null) {
        p.add('V-27', `${at}couponNo`, '월수익 순번을 고른다.')
      } else {
        const evaluationDate = evaluationOf.get(entry.couponNo)
        const label = couponMonthLabel(entry.couponNo, evaluationDate)
        if (evaluationDate == null) {
          p.add('V-27', `${at}couponNo`, `이 상품의 월수익 일정에 없는 순번이다 — ${entry.couponNo}번째.`)
        } else {
          if (evaluationDate > asOf) {
            p.add('V-27', `${at}couponNo`, `아직 평가되지 않은 달이다 — ${label}.`)
          }
          // 비교 키는 그 달의 월수익 평가일이다(지급일이 아니다 — DOC-007 RD-18). 결과를 가리지 않는다
          if (redemptionDate != null && evaluationDate > redemptionDate) {
            p.add('V-27', `${at}couponNo`, `상환일(${redemptionDate}) 뒤에 평가되는 달이다 — ${label}.`)
          }
          // V-28 — 지급일 ≥ 그 달 평가일(FULL만 — 기실현은 평가일이 없다)
          if (entry.paymentDate != null && entry.paymentDate < evaluationDate) {
            p.add('V-28', `${at}paymentDate`, `월수익 지급일은 그 달 월수익 평가일(${evaluationDate}) 이후여야 한다.`)
          }
        }
        if (recordedNos.has(entry.couponNo) || seenNos.has(entry.couponNo)) {
          p.add('V-27', `${at}couponNo`, `이미 기록된 달이다 — ${label}. 정정은 그 기록을 수정한다.`)
        }
        seenNos.add(entry.couponNo)
      }
    } else {
      // 기실현 — 일정이 없으므로 적을 「달」이 없다. 순번 없는 지급만 받는다(I-27)
      if (entry.couponNo != null) {
        p.add('V-27', `${at}couponNo`, '기실현 상품의 기록에는 월수익 순번이 없다.')
      }
      if (entry.outcome !== 'PAID') {
        p.add('V-27', `${at}outcome`, '기실현 상품에는 미지급을 적지 않는다 — 적을 달이 없다.')
      }
    }

    // ── V-28 — 지급의 형태 중 기준일 · 중복 ─────────────────────────────
    if (entry.outcome === 'PAID' && entry.paymentDate != null) {
      // 아직 오지 않은 지급은 기록하지 않는다(V-17과 같은 이유로 DB 제약이 아니다 — current_date는 CHECK에 쓸 수 없다)
      if (entry.paymentDate > asOf) {
        p.add('V-28', `${at}paymentDate`, `아직 오지 않은 지급은 기록하지 않는다 — 기준일 ${asOf}.`)
      }
      // 같은 지급일 — DB의 UNIQUE(els_id, payment_date)는 경합에서만 닿게 한다(행 키 없는 CONFLICT가 된다)
      if (paidDates.has(entry.paymentDate) || seenDates.has(entry.paymentDate)) {
        p.add('V-28', `${at}paymentDate`, '같은 지급일의 월수익 기록이 이미 있다.')
      }
      seenDates.add(entry.paymentDate)
    }

    // ── V-24 ⓐ — 적용 환율은 외화 상품에만 ───────────────────────────────
    if (entry.exchangeRate != null && product.currency === 'KRW') {
      p.add('V-24', `${at}exchangeRate`, '원화 상품에는 적용 환율을 적지 않는다.')
    }

    // ── V-23 — 세전은 부모 상품의 통화 보조단위 이내. 통과하면 고정 자릿수로 정규화한다 ─────
    const grossAmount =
      entry.grossAmount == null
        ? undefined
        : checkProductAmount(p, `${at}grossAmount`, entry.grossAmount, product.currency, '월수익(세전)')
    checked.push(grossAmount == null ? entry : { ...entry, grossAmount })
  }

  // V-27 — 기실현의 순번 없는 기록은 상품당 60건 이하(일괄 기록 · 「전부 지우기」의 1..60과 맞춘다). 계약에만 있다.
  // 기록(§5.14)만 본다 — 수정(§5.15)은 건수를 늘리지 않는다. 키는 새 행이 하나여도 `entries`다: 위반은 행의 칸이
  // 아니라 건수다(v4.21 — 종전에는 한 행이면 `outcome`이었다)
  if (
    selfId == null &&
    product.entry_mode === 'REALIZED_ONLY' &&
    others.length + rows.length > MAX_COUPON_SCHEDULES
  ) {
    p.add('V-27', 'entries', `기실현 상품의 월수익 기록은 ${MAX_COUPON_SCHEDULES}건까지다.`)
  }
  return checked
}

/**
 * 다행 INSERT의 결과 행을 **입력 순서**의 id로 — 결과 행의 순서가 아니라 키로 짝짓는다(§5.14 v4.21). 키는 상품 안에서
 * UNIQUE인 것이다 — `FULL`은 `coupon_no`, 기실현은 `payment_date`(I-26). 행 수 · 키가 짝지어지지 않으면 `null`이다 —
 * 호출부가 성공을 주장하지 않는다(W-05).
 */
export function idsInInputOrder(
  entryMode: ProductRow['entry_mode'],
  entries: ReadonlyArray<Pick<Checked, 'couponNo' | 'paymentDate'>>,
  rows: ReadonlyArray<{ id: string; coupon_no: number | null; payment_date: string | null }>,
): string[] | null {
  const keyOf = (couponNo: number | null, paymentDate: string | null | undefined) =>
    entryMode === 'FULL' ? `no:${couponNo}` : `date:${paymentDate ?? null}`
  if (rows.length !== entries.length) return null
  const idByKey = new Map(rows.map((row) => [keyOf(row.coupon_no, row.payment_date), row.id]))
  if (idByKey.size !== entries.length) return null
  const ids: string[] = []
  for (const entry of entries) {
    const id = idByKey.get(keyOf(entry.couponNo, entry.paymentDate))
    if (id == null) return null
    ids.push(id)
  }
  return ids
}

/** 원천징수 기본값의 오류를 그 행의 키로 옮긴다 — `withholdingFor`는 색인 없는 칸(`paymentDate` · `withholdingTax`)을 낸다 */
function prefixed(error: ActionError, at: string): ActionError {
  if (error.fields == null || at === '') return error
  return {
    ...error,
    fields: Object.fromEntries(Object.entries(error.fields).map(([key, value]) => [`${at}${key}`, value])),
  }
}

/** 지급(`PAID`)이고 원천징수를 비웠으면 지급일 연도의 분리과세율로 채운다(§5.14 — 상환과 같은 함수) */
async function withWithholding(
  ctx: MutationContext,
  entry: Checked,
  at: string,
  cache: TaxYearCache,
): Promise<Access<Checked>> {
  if (entry.outcome !== 'PAID' || entry.withholdingTax != null) return { ok: true, value: entry }
  const withholding = await withholdingFor(
    ctx,
    { date: entry.paymentDate!, taxableIncome: entry.taxableIncome! },
    'paymentDate',
    cache,
  )
  if (!withholding.ok) return { ok: false, error: prefixed(withholding.error, at) }
  return { ok: true, value: { ...entry, withholdingTax: withholding.value } }
}

/** DB 행 — 지급 · 미지급 모두 같은 열이다. 미지급은 다섯 열이 NULL이다(I-26) */
function rowValues(entry: Checked) {
  return {
    coupon_no: entry.couponNo,
    outcome: entry.outcome,
    payment_date: entry.paymentDate ?? null,
    gross_amount: entry.grossAmount ?? null,
    taxable_income: entry.taxableIncome ?? null,
    withholding_tax: entry.withholdingTax ?? null,
    exchange_rate: entry.exchangeRate ?? null,
    is_confirmed: entry.isConfirmed,
    note: entry.note ?? null,
  }
}

/** 기록 id → 부모 상품(소유자 판정 포함). §5.5의 `requireOwnedRedemption`과 같은 경로다 */
async function requireOwnedCouponPayment(
  ctx: MutationContext,
  id: unknown,
  what: string,
): Promise<Access<{ paymentId: string; couponNo: number | null; product: ProductRow }>> {
  if (!isUuid(id)) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '대상을 찾을 수 없다.' } }
  }
  const ref = await guardSystemAsync(() => loadCouponPaymentRef(ctx, id), `${what} 사전 조회`)
  if (!ref.ok) return { ok: false, error: ref.error }
  if (ref.value == null) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '대상 월수익 기록을 찾을 수 없다.' } }
  }
  const access = await requireOwnedProduct(ctx, ref.value.elsId, what)
  if (!access.ok) return { ok: false, error: access.error }
  return {
    ok: true,
    value: { paymentId: ref.value.id, couponNo: ref.value.couponNo, product: access.value },
  }
}

export function makeCouponMutations(ctx: MutationContext) {
  /**
   * §5.14 — 1..60건을 **다행 INSERT 한 번**으로. 전부 아니면 전무다.
   *
   * 반환은 만든 기록의 id이고 **입력 순서**다(통합 스위트가 순서로 단언한다). 결과 행의 순서에 기대지 않고 **키로**
   * 짝짓는다 — `FULL`은 `coupon_no`, 기실현은 `payment_date`(둘 다 상품 안에서 UNIQUE — I-26). PostgreSQL은 다행
   * INSERT의 `RETURNING` 순서를 문서로 보장하지 않는다(DOC-011 v4.21). 왕복은 사전 조회 1 + INSERT 1 + 원천징수
   * 기본값이 필요한 지급일 연도마다 1이다(§5.0.1).
   */
  async function recordCouponPayments(
    productId: string,
    input: { entries: CouponPaymentInput[] },
  ): Promise<ActionResult<{ ids: string[] }>> {
    const p = new Problems()
    const entries = parseCouponPaymentEntries(p, input)
    if (entries == null) return failWith(p.toError())

    const access = await requireOwnedProduct(ctx, productId, '월수익 기록')
    if (!access.ok) return failWith(access.error)
    const product = access.value

    // V-27 — 부모가 월지급식이어야 한다. 상환 시 지급 상품의 기록은 금융소득 합계에 들어간다(DB 겹 `*_monthly_required`)
    if (product.coupon_payout !== 'MONTHLY') {
      p.add('V-27', 'entries', '월지급식 상품에만 월수익을 기록할 수 있다.')
      return failWith(p.toError())
    }

    const rows = entries.map((entry, index) => ({ at: `entries[${index}].`, entry }))
    const checked = checkAgainstProduct(p, rows, product, ctx.asOf, null)
    if (!p.isEmpty) return failWith(p.toError())

    // 행 단위 오류는 전부 모은다 — 세율 시드가 없는 해가 여러 행이면 그 행 전부를 말한다(§5.14 v4.21 — 첫 행에서
    // 멈추지 않는다). 검증 오류가 아닌 것(시드 전체 부재 · 조회 실패 — INTERNAL)은 그 자리에서 돌려준다
    const cache: TaxYearCache = new Map()
    const completed: Checked[] = []
    let invalid: ActionError | null = null
    const invalidFields: Record<string, string> = {}
    for (const [index, entry] of checked.entries()) {
      const filled = await withWithholding(ctx, entry, `entries[${index}].`, cache)
      if (filled.ok) {
        completed.push(filled.value)
        continue
      }
      if (filled.error.code !== 'VALIDATION_FAILED') return failWith(filled.error)
      invalid ??= filled.error
      Object.assign(invalidFields, filled.error.fields)
    }
    if (invalid != null) return failWith({ ...invalid, fields: invalidFields })

    const { data, error } = await ctx.db
      .from('monthly_coupon_payments')
      .insert(
        completed.map((entry) =>
          toInsert('monthly_coupon_payments', { els_id: productId, ...rowValues(entry) }),
        ),
      )
      .select('id, coupon_no, payment_date')
    if (error != null) return failDb(error, '월수익 기록')

    // 한 문장이므로 일부만 남을 수 없다 — 그래도 행 수가 다르거나 키가 짝지어지지 않으면 성공을 주장하지 않는다(W-05)
    const ids = data == null ? null : idsInInputOrder(product.entry_mode, completed, data)
    if (ids == null) return failWith(staleState())
    return ok({ ids })
  }

  /**
   * §5.15 — 한 기록의 **전체 교체**. 순번과 상품은 입력에 없다(바꿀 수 없다). 결과는 바꿀 수 있다 — 미지급 ↔ 지급
   * 정정이 이 계약이다(I-26의 형태를 새 결과로 다시 지난다).
   */
  async function updateCouponPayment(
    id: string,
    input: Omit<CouponPaymentInput, 'couponNo'>,
  ): Promise<ActionResult<void>> {
    const p = new Problems()
    if (!isPlainObject(input)) {
      p.add('V-28', 'outcome', '입력 형식이 올바르지 않다.')
      return failWith(p.toError())
    }
    const fields = parseCouponPaymentFields(p, input, '')
    if (fields == null) return failWith(p.toError())

    const access = await requireOwnedCouponPayment(ctx, id, '월수익 기록 수정')
    if (!access.ok) return failWith(access.error)

    const entry: Checked = { couponNo: access.value.couponNo, ...fields }
    const [checked] = checkAgainstProduct(
      p,
      [{ at: '', entry }],
      access.value.product,
      ctx.asOf,
      access.value.paymentId,
    )
    if (!p.isEmpty || checked == null) return failWith(p.toError())

    const filled = await withWithholding(ctx, checked, '', new Map())
    if (!filled.ok) return failWith(filled.error)

    const { coupon_no: _unchanged, ...values } = rowValues(filled.value)
    const { data, error } = await ctx.db
      .from('monthly_coupon_payments')
      .update(toUpdate('monthly_coupon_payments', values))
      .eq('id', access.value.paymentId)
      .select('id')
    if (error != null) return failDb(error, '월수익 기록 수정')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  /**
   * §5.15 — 한 상품의 기록 1..60건을 **한 문장**으로 지운다. 「월수익 기록 전부 지우기」도 이 계약이다.
   *
   * 사전 조회가 `ids` 전부가 그 상품의 기록인지 먼저 본다 — 다른 상품의 id가 섞이면 지우기 전에 거부한다. 영향 행 수가
   * `ids`의 길이와 다르면 `CONFLICT`다 — 그 사이에 다른 요청이 지웠거나 옮겼다(W-05). `els_id = $1` 조건이 있으므로 그 사이
   * 다른 상품으로 옮겨진 기록은 지우지 않는다.
   */
  async function deleteCouponPayments(
    productId: string,
    input: { ids: string[] },
  ): Promise<ActionResult<void>> {
    const p = new Problems()
    const ids = isPlainObject(input) && Array.isArray(input.ids) ? input.ids : null
    if (ids == null || ids.length === 0 || ids.length > MAX_COUPON_SCHEDULES) {
      p.add('V-27', 'ids', `지울 기록을 1~${MAX_COUPON_SCHEDULES}건 고른다.`)
      return failWith(p.toError())
    }
    if (!ids.every(isUuid) || new Set(ids).size !== ids.length) {
      p.add('V-27', 'ids', '지울 기록의 목록이 올바르지 않다 — 같은 기록을 두 번 고를 수 없다.')
      return failWith(p.toError())
    }

    const access = await requireOwnedProduct(ctx, productId, '월수익 기록 삭제')
    if (!access.ok) return failWith(access.error)

    const owned = new Set(access.value.monthly_coupon_payments.map((payment) => payment.id))
    if (!ids.every((id) => owned.has(id))) {
      return failWith({ code: 'NOT_FOUND', message: '이 상품의 월수익 기록이 아닌 것이 섞여 있다.' })
    }

    const { data, error } = await ctx.db
      .from('monthly_coupon_payments')
      .delete()
      .eq('els_id', productId)
      .in('id', ids)
      .select('id')
    if (error != null) return failDb(error, '월수익 기록 삭제')

    if (data == null || data.length !== ids.length) return failWith(staleState())
    return okVoid()
  }

  return { recordCouponPayments, updateCouponPayment, deleteCouponPayments }
}
