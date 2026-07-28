'use client'

import { useActionState, useState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { REDEMPTION_TYPE_LABELS, korDate } from '@/lib/format'
import {
  REDEMPTION_ID_FIELD,
  taxableIncomeLocked,
  type RoundOption,
} from '@/lib/forms/redemption'
import { initialFormState, type FormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'

/**
 * §5.4·§5.5 상환 폼 — 처리(SCR-203)와 수정(SCR-202)이 **같은 컴포넌트다**
 *
 * 두 계약의 입력이 같은 `RedemptionInput`이므로 칸도 같다. 다른 것은 어느 id를
 * 나르는가(§5.4는 상품, §5.5는 상환)와 어느 액션을 부르는가뿐이다 — SCR-204의
 * 등록·수정과 같은 판단이며, 복제하면 「확정값 여부」 같은 칸이 한쪽에만 생긴다.
 *
 * ## 만기손실의 과세 금융소득은 0으로 고정된다 — JS가 있을 때
 *
 * DOC-008 §5는 「상환 유형이 만기상환(손실)이면 과세 금융소득을 `0`으로 고정하고
 * 수정 불가 처리」를 요구한다. 그 고정은 **선택에 반응해야** 하므로 클라이언트
 * 상태다(`useState`). 단계 전이를 상태로 두지 않은 것과 모순이 아니다 —
 *
 * | 무엇 | 상태인가 | 왜 |
 * |---|---|---|
 * | 단계 전이 | **아니다**(폼의 값) | JS 없이 동작해야 하고 규칙이 순수 모듈에 있어야 한다 |
 * | 이 고정 | 그렇다 | **표시의 향상**이다. JS가 없으면 칸이 열려 있고 V-12가 저장을 거부하며 그 문구가 이 칸에 붙는다 |
 *
 * 즉 JS 없는 경로에서 잃는 것은 「미리 알려 주는 것」이고 잘못된 저장은 계약이
 * 막는다(I-08의 DB `CHECK`가 최종 보장이다 — 절대 규칙 #8).
 *
 * `<select>`를 제어 컴포넌트로 두어도 JS 없는 제출은 그대로다 — React가 서버 렌더에
 * `selected`를 넣으므로 브라우저가 그 값을 보낸다.
 *
 * ## 증권사 용어를 인라인으로 안내한다
 *
 * DOC-008 §5의 「입력 지원」이며 DOC-005 §7의 대응표다: 거래금액 → 실수령액,
 * 과표 → 과세 금융소득, 제세금 → 원천징수세액. 사용자는 증권사 화면을 보며 옮겨
 * 적으므로 그 화면의 말이 여기 있어야 한다.
 */

export function RedemptionForm({
  action,
  initialValues,
  rounds,
  productId,
  redemptionId,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>
  initialValues: Record<string, string>
  rounds: readonly RoundOption[]
  /** §5.4 — 상환 처리. 상품 id를 나른다 */
  productId?: string
  /** §5.5 — 상환 수정. 상환 id를 나른다 */
  redemptionId?: string
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, initialFormState(initialValues))

  const values = state.values
  const { fieldErrors } = state

  /*
   * 초기값에서 시작한다 — 실패 후 재렌더에서도 사용자가 고른 유형이 유지되어야 하고
   * (`values`가 그것을 나른다) 그러지 않으면 만기손실 고정이 풀린다.
   */
  const [type, setType] = useState(values.redemptionType ?? '')
  const locked = taxableIncomeLocked(type)

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      {productId != null && (
        <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
      )}
      {redemptionId != null && (
        <input type="hidden" name={REDEMPTION_ID_FIELD} value={redemptionId} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="redemptionType"
          label="상환 유형"
          error={fieldErrors.redemptionType}
          hint="만기상환(손실)은 과세 금융소득이 0으로 고정된다"
        >
          {(props) => (
            <select
              {...props}
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">선택</option>
              {Object.entries(REDEMPTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/*
          V-13 — 조기·리자드 상환은 차수가 필수이고(I-14) 만기 상환은 차수가 없다.
          그래서 빈 선택지가 「해당 없음」이며 기본값이 아니라 **정상값**이다.
        */}
        <Field
          name="roundNo"
          label="차수"
          error={fieldErrors.roundNo}
          hint="조기·리자드 상환은 필수. 만기 상환은 비운다"
        >
          {(props) => (
            <select
              {...props}
              defaultValue={values.roundNo ?? ''}
              className={INPUT_CLASS}
            >
              <option value="">해당 없음 (만기)</option>
              {rounds.map((round) => (
                <option key={round.roundNo} value={String(round.roundNo)}>
                  {`${round.roundNo}차 · ${korDate(round.evaluationDate)}${
                    round.hasLizard ? ' · 리자드 있음' : ''
                  }`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="redemptionDate"
          label="상환일"
          error={fieldErrors.redemptionDate}
          hint="귀속연도와 원천징수 세율이 이 날짜에서 나온다"
        >
          {(props) => (
            <input
              {...props}
              type="date"
              defaultValue={values.redemptionDate ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          name="grossAmount"
          label="실수령액 (원)"
          error={fieldErrors.grossAmount}
          hint="증권사 거래내역의 「거래금액」. 원금을 포함한다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.grossAmount ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="taxableIncome"
          label="과세 금융소득 (원)"
          error={fieldErrors.taxableIncome}
          hint={
            locked
              ? '만기상환(손실)이므로 0이다 — ELS 손실은 다른 금융소득과 통산되지 않는다'
              : '증권사 거래내역의 「과표」. 실수령액 − 원금이다'
          }
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              /*
               * `key`를 유형에 묶는다 — `defaultValue`는 다시 읽히지 않으므로
               * 유형을 만기손실로 바꿔도 칸의 값이 그대로 남는다. 그러면 읽기
               * 전용인 칸에 0이 아닌 값이 보이고 저장이 V-12로 거부된다.
               */
              key={locked ? 'locked' : 'open'}
              defaultValue={locked ? '0' : (values.taxableIncome ?? '')}
              readOnly={locked}
              className={`${INPUT_CLASS}${locked ? ' bg-neutral-100 text-neutral-600' : ''}`}
            />
          )}
        </Field>

        <Field
          name="withholdingTax"
          label="원천징수세액 (원)"
          error={fieldErrors.withholdingTax}
          hint="증권사 거래내역의 「제세금」. 비우면 과세 금융소득 × 분리과세율로 산출한다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.withholdingTax ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </div>

      {/*
        ST-05 — 확정/추정의 구분이 이 체크박스다. 기본이 거짓인 이유는
        「증권사가 제공한 실제 값」이 기본이면 추정값이 확정값으로 저장되기 때문이다.
      */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="isConfirmed"
          value="on"
          defaultChecked={(values.isConfirmed ?? '') !== ''}
          className="mt-0.5 size-4"
        />
        <span>
          지급명세서로 확인한 확정값이다
          <span className="mt-0.5 block text-xs text-neutral-500">
            체크하지 않으면 추정값으로 표시된다. 세금 계산에는 어느 쪽이든 이 금액이 쓰인다
          </span>
        </span>
      </label>

      <Field name="note" label="비고" error={fieldErrors.note} hint="선택">
        {(props) => (
          <textarea
            {...props}
            rows={2}
            defaultValue={values.note ?? ''}
            className={INPUT_CLASS}
          />
        )}
      </Field>

      <div>
        <SubmitButton label={submitLabel} pendingLabel="저장 중…" />
      </div>
    </form>
  )
}
