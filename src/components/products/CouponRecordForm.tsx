'use client'

import { useActionState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import type { ProductCurrency } from '@/lib/domain/currency'
import {
  COUPON_OUTCOME_LABELS,
  UNNUMBERED_COUPON_LABEL,
  couponTaxableHint,
  ymd,
  type ExchangeRateBasisText,
} from '@/lib/format'
import {
  ADD_ROW_INTENT,
  COUPON_INTENT_FIELD,
  COUPON_NO_FIELD,
  COUPON_PAYMENT_ID_FIELD,
  COUPON_ROW_COUNT_FIELD,
  rowName,
} from '@/lib/forms/coupons'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'
import { initialFormState, type FormState } from '@/lib/forms/state'

/**
 * SCR-206 월수익 기록 — 다행 폼 · 한 행 수정 폼 (P8 컷 b3, DOC-008 SCR-206)
 *
 * ## 한 행이 한 카드다 — 좁은 화면에서 쌓인다
 *
 * 행마다 칸이 여덟이라 표로 두면 좁은 화면에서 가로 스크롤이 된다. 카드(`fieldset`)로 쌓고 넓은 화면에서 칸을 격자로
 * 놓는다(§8 — DOC-008 SQ-21 ⓘ b3 개정). 머리는 월수익 표기 1(「5번째 · 2027-02-16」)이고 순번 없는 기실현 행은
 * 「순번 없음」이다.
 *
 * ## 기본값은 서버가 정했다 — 화면은 다시 계산하지 않는다
 *
 * 세전의 기본값은 계약의 `expectedAmount`(보조단위 절사값)이고 과세 · 원천징수의 규칙은 `couponDefaultsOf`가 정했다.
 * 달러 상품의 과세 칸은 비어 있고 힌트가 크기만 말한다(U1). 결과 칸은 **빈칸에서 시작한다** — 지난 달의 결과를
 * 시세로 제안하지 않는다(DOC-007 RD-14).
 */

type RowHead = {
  /** 「5번째 · 2027-02-16」. 순번 없는 기실현 행은 `null` */
  label: string | null
  /** 그 달의 일정 지급일 — 힌트 */
  scheduledPaymentDate: string | null
}

export function CouponRecordForm({
  action,
  initialValues,
  heads,
  growable,
  productId,
  currency,
  taxableHintBasis,
  taxFree,
  editId,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>
  initialValues: Record<string, string>
  /**
   * 행의 머리 — 기본 목록(FULL)이면 행마다 하나. `growable`이면 비워 두고 행 수(`rowCount`)만큼 「순번 없음」을 그린다
   */
  heads: readonly RowHead[]
  /** 기실현 월지급 — 「빈 행 추가」가 있고 결과는 지급뿐이다(I-27 — 순번 없는 미지급은 받지 않는다) */
  growable: boolean
  productId: string
  currency: ProductCurrency
  /** 달러 과세 힌트의 추정 환율 — `remainingCoupons.exchangeRateBasis`(DOC-008 v2.41 — 월지급 상품은 `projection`이 늘 없다). 없으면 숫자 없는 힌트 */
  taxableHintBasis: ExchangeRateBasisText | null
  /**
   * 비과세 계좌 — 과세 칸은 통화와 무관하게 0으로 채워지므로(DOC-008 v2.41) 힌트도 같은 순서다: 달러 환산 산식을
   * 말하지 않고 원화 상품과 같은 힌트다(DOC-008 v2.42 SCR-206)
   */
  taxFree: boolean
  /** §5.15 수정이면 그 기록 id — 한 행 폼이다 */
  editId?: string
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, initialFormState(initialValues))
  const values = state.values
  const fieldErrors = state.fieldErrors
  const foreign = currency !== 'KRW'

  // 「빈 행 추가」가 늘린 행 수는 상태가 나른다 — 서버 왕복 뒤에도 같은 수가 그려진다(JS 없이 동작)
  const rowCount = growable
    ? Math.max(1, Number.parseInt(values[COUPON_ROW_COUNT_FIELD] ?? '1', 10) || 1)
    : heads.length
  const rows: RowHead[] = growable
    ? Array.from({ length: rowCount }, () => ({ label: null, scheduledPaymentDate: null }))
    : [...heads]
  // 순번 없는 행(기실현 — 빈 행 추가 · 그 기록의 수정)은 지급뿐이다(I-27 — 순번 없는 미지급은 늘 거부된다. DOC-008 v2.41)
  const paidOnly = growable || rows.every((head) => head.label == null)
  const outcomes = paidOnly ? (['PAID'] as const) : (['PAID', 'UNPAID'] as const)

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
      <input type="hidden" name={COUPON_ROW_COUNT_FIELD} value={String(rowCount)} />
      {editId != null && <input type="hidden" name={COUPON_PAYMENT_ID_FIELD} value={editId} />}

      <FormMessage state={state} />

      {rows.map((head, r) => (
        <fieldset key={r} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
          <legend className="px-1 text-sm font-semibold">{head.label ?? UNNUMBERED_COUPON_LABEL}</legend>
          <input type="hidden" name={rowName(r, COUPON_NO_FIELD)} value={values[rowName(r, COUPON_NO_FIELD)] ?? ''} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              name={rowName(r, 'outcome')}
              label="결과"
              error={fieldErrors[rowName(r, 'outcome')]}
              hint={editId != null ? undefined : '빈칸이면 이 행을 건너뛴다'}
            >
              {(props) => (
                <select
                  {...props}
                  // `key`가 `defaultValue`와 같은 식이다 — AQ-64. 같은 폼에 머무는 제출(「빈 행 추가」 · 검증 실패) 뒤 자동
                  // 폼 초기화가 비제어 `<select>`를 마운트 때의 값으로 되돌려, 앞 행에 고른 「지급」이 「선택 안 함」으로
                  // 보이고 그대로 저장하면 그 행이 조용히 빠졌다(P8.5 반박 검토 — DOC-008 v2.41)
                  key={values[rowName(r, 'outcome')] ?? ''}
                  defaultValue={values[rowName(r, 'outcome')] ?? ''}
                  className={INPUT_CLASS}
                >
                  {editId == null && <option value="">선택 안 함</option>}
                  {outcomes.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {COUPON_OUTCOME_LABELS[outcome]}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              name={rowName(r, 'paymentDate')}
              label="월수익 지급일"
              error={fieldErrors[rowName(r, 'paymentDate')]}
              hint={
                head.scheduledPaymentDate == null
                  ? '거래내역의 지급일'
                  : `일정 ${ymd(head.scheduledPaymentDate)} — 거래내역의 날짜로 고친다`
              }
            >
              {(props) => (
                <input {...props} type="date" defaultValue={values[rowName(r, 'paymentDate')] ?? ''} className={INPUT_CLASS} />
              )}
            </Field>

            <Field
              name={rowName(r, 'grossAmount')}
              label={foreign ? '세전 (달러)' : '세전 (원)'}
              error={fieldErrors[rowName(r, 'grossAmount')]}
              hint={foreign ? '센트까지 — 투자원금 × 월수익 연쿠폰율 ÷ 12(센트 미만 절사)' : '투자원금 × 월수익 연쿠폰율 ÷ 12(원 미만 절사)'}
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode={foreign ? 'decimal' : 'numeric'}
                  defaultValue={values[rowName(r, 'grossAmount')] ?? ''}
                  className={INPUT_CLASS}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              name={rowName(r, 'taxableIncome')}
              label="과세 금융소득 (원)"
              error={fieldErrors[rowName(r, 'taxableIncome')]}
              hint={foreign && !taxFree ? couponTaxableHint(taxableHintBasis) : '증권사 거래내역의 「과표」'}
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode="numeric"
                  defaultValue={values[rowName(r, 'taxableIncome')] ?? ''}
                  className={INPUT_CLASS}
                />
              )}
            </Field>

            <Field
              name={rowName(r, 'withholdingTax')}
              label="원천징수세액 (원)"
              error={fieldErrors[rowName(r, 'withholdingTax')]}
              hint="거래내역의 「제세금」. 비우면 지급일 연도의 분리과세율로 산출한다"
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode="numeric"
                  defaultValue={values[rowName(r, 'withholdingTax')] ?? ''}
                  className={INPUT_CLASS}
                />
              )}
            </Field>

            {/* 적용 환율 — 달러 상품에만 그린다. 원화에 두면 저장이 늘 거부되는 칸이다(V-24 ⓐ) */}
            {foreign && (
              <Field
                name={rowName(r, 'exchangeRate')}
                label="적용 환율 (선택)"
                error={fieldErrors[rowName(r, 'exchangeRate')]}
                hint="거래내역의 지급일 환율 — 참고값이며 계산에 쓰지 않는다"
              >
                {(props) => (
                  <input
                    {...props}
                    type="text"
                    inputMode="decimal"
                    defaultValue={values[rowName(r, 'exchangeRate')] ?? ''}
                    className={INPUT_CLASS}
                  />
                )}
              </Field>
            )}
          </div>

          <p className="text-xs text-neutral-500">
            미지급을 고르면 금액 · 지급일 · 과세 칸은 저장하지 않는다 — 미지급은 소득 사건이 아니다
          </p>

          {/* ST-05 — 기본은 끈다(SCR-203과 같다). 확정은 표시 축이고 세금 계산에는 어느 쪽이든 이 금액이 쓰인다 */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={rowName(r, 'isConfirmed')}
              value="on"
              defaultChecked={(values[rowName(r, 'isConfirmed')] ?? '') !== ''}
              className="mt-0.5 size-4"
            />
            <span>지급명세서로 확인한 확정값이다</span>
          </label>

          <Field name={rowName(r, 'note')} label="비고" error={fieldErrors[rowName(r, 'note')]} hint="선택">
            {(props) => (
              <input {...props} type="text" defaultValue={values[rowName(r, 'note')] ?? ''} className={INPUT_CLASS} />
            )}
          </Field>
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-2">
        <SubmitButton label={submitLabel} pendingLabel="저장 중…" />
        {/* 페이지 안의 조작 — 제출이다(SCR-204 「남는 조작」). 입력값은 서버 왕복 뒤에도 남는다 */}
        {growable && editId == null && (
          <button
            type="submit"
            name={COUPON_INTENT_FIELD}
            value={ADD_ROW_INTENT}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
          >
            빈 행 추가
          </button>
        )}
      </div>
    </form>
  )
}
