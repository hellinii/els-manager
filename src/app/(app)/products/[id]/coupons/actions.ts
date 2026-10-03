'use server'

import { redirect } from 'next/navigation'

import { recordCouponPayments, updateCouponPayment } from '@/app/actions'
import type { ActionResult } from '@/lib/db/mutations/result'
import {
  ADD_ROW_INTENT,
  COUPON_INTENT_FIELD,
  COUPON_ROW_FIELDS,
  COUPON_PAYMENT_ID_FIELD,
  COUPON_ROW_COUNT_FIELD,
  couponFieldNames,
  EMPTY_RECORD_MESSAGE,
  parseCouponEditForm,
  parseCouponRecordForm,
  toRowErrors,
} from '@/lib/forms/coupons'
import { text } from '@/lib/forms/parse'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'
import { countOf } from '@/lib/forms/rounds'
import { initialFormState, toFormState, valuesOf, type FormState } from '@/lib/forms/state'
import { COUPON_SECTION } from '@/lib/routes/paths'

/**
 * SCR-206의 어댑터 — 일괄 기록(§5.14) · 한 기록 수정(§5.15) (P8 컷 b3)
 *
 * `src/app/actions.ts`가 아닌 이유는 SCR-203 · 204의 어댑터와 같다: 그 파일은 §5의 변경 계약을 1:1로 노출하는 것이
 * 불변식이다. 여기는 폼 → 입력의 번역과 오류의 자리를 맡는다.
 *
 * ## 성공하면 상세의 ⑦로 간다 — 실패하면 입력값이 남는다
 *
 * 저장 뒤 도착은 SCR-202의 ⑦(`#coupons`)이다(DOC-008 SQ-21 ⓘ b3 개정 — 상환 처리가 저장 뒤 상세로 가는 선례). 방금
 * 적은 달의 상태를 그 자리에서 본다. 한 트랜잭션이므로 한 행이라도 거부되면 아무것도 저장되지 않고(§5.14 — 전부
 * 아니면 전무) **입력값이 보존된다**(§6 「저장 실패(입력값 보존)」).
 */

/**
 * §5.14 일괄 기록 — 결과를 고른 행만 `entries`로 싣는다. 「빈 행 추가」는 계약을 부르지 않는다(페이지 안의 조작).
 *
 * 오류의 자리: 계약의 `entries[i].…`를 실은 순서의 화면 행으로 되돌려 붙이고(`toRowErrors`), 색인 없는 키(DB 제약의
 * 마지막 그물)는 상단 오류 요약으로 둔다 — 어느 행의 것인지 말하지 않는 오류에 행을 지어내지 않는다.
 */
export async function recordCouponPaymentsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const productId = text(form, PRODUCT_ID_FIELD)
  const rowCount = countOf(text(form, COUPON_ROW_COUNT_FIELD))
  const values = valuesOf(form)

  if (text(form, COUPON_INTENT_FIELD) === ADD_ROW_INTENT) {
    // 행 하나를 더한 같은 화면 — 계약을 부르지 않는다. 입력값은 그대로 남는다(SCR-204 「남는 조작」)
    return initialFormState({ ...values, [COUPON_ROW_COUNT_FIELD]: String(rowCount + 1) })
  }

  const { entries, rowOf } = parseCouponRecordForm(form, rowCount)
  if (entries.length === 0) {
    // 결과를 고른 행이 없다 — 계약의 배열 오류(「entries 월수익 기록은 한 번에 1~60건이다」)를 내부 키째로 보이지 않는다
    // (DOC-008 v2.41 — P8.5). 계약을 부르지 않는다
    return {
      ...initialFormState(values),
      status: 'ERROR',
      code: 'VALIDATION_FAILED',
      message: EMPTY_RECORD_MESSAGE,
    }
  }
  const result = await recordCouponPayments(productId, { entries })

  if (result.ok) redirect(COUPON_SECTION.detailHref(productId))

  return toFormState(toRowErrors(result, rowOf), values, couponFieldNames(rowCount))
}

/**
 * §5.15 한 기록 수정 — 한 기록 전체 교체이고 순번 · 상품은 입력에 없다. 폼은 행 번호 0의 한 행이다.
 * 결과를 비우면 계약을 부르지 않고 그 칸의 오류다(수정은 지울 수 없다 — 지우기는 ⑦의 「삭제」).
 */
export async function updateCouponPaymentAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const productId = text(form, PRODUCT_ID_FIELD)
  const values = valuesOf(form)
  const input = parseCouponEditForm(form)

  if (input == null) {
    return {
      ...initialFormState(values),
      status: 'ERROR',
      code: 'VALIDATION_FAILED',
      message: '결과를 고른다 — 기록을 지우려면 상세의 「삭제」를 쓴다.',
      fieldErrors: { 'rows[0].outcome': '지급 또는 미지급을 고른다.' },
    }
  }

  const result = await updateCouponPayment(text(form, COUPON_PAYMENT_ID_FIELD), input)
  if (result.ok) redirect(COUPON_SECTION.detailHref(productId))

  // 수정의 키는 색인이 없다(§5.15 — 한 행). 한 행 폼이므로 그 칸에 그대로 붙인다(일괄 기록과 달리 행을 지어내는 것이 아니다)
  return toFormState(toSingleRowErrors(result), values, couponFieldNames(1))
}

function toSingleRowErrors<T>(result: ActionResult<T>): ActionResult<T> {
  if (result.ok || result.error.fields == null) return result
  const fields = Object.fromEntries(
    Object.entries(result.error.fields).map(([key, message]) => [
      (COUPON_ROW_FIELDS as readonly string[]).includes(key) ? `rows[0].${key}` : key,
      message,
    ]),
  )
  return { ...result, error: { ...result.error, fields } }
}
