'use client'

import { useActionState, useState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import {
  ACCOUNT_TYPE_LABELS,
  REDEMPTION_TYPE_LABELS,
  signedWon,
} from '@/lib/format'
import {
  attributionYearOf,
  realizedPnlOf,
} from '@/lib/forms/realized'
import { taxableIncomeLocked } from '@/lib/forms/redemption'
import { initialFormState, type FormState } from '@/lib/forms/state'

/**
 * SCR-205 기실현 등재 폼 — DOC-008 §5 · DOC-011 §5.11
 *
 * ## SCR-204·203의 폼을 재사용하지 않는다
 *
 * 두 폼과 칸이 겹치지만 **집합이 다르다** — SCR-204의 기초자산·평가 조건 구획이
 * 통째로 없고, SCR-203의 차수 칸도 없다(일정이 0건이라 실재하는 차수가 없다).
 * 조건부로 칸 절반을 숨기는 폼을 만들면 그 조건이 JS 없이도 동작해야 하고
 * (v1.8이 단계 기계를 철회한 이유) 서버 왕복이 하나 더 붙는다.
 *
 * ## 파생 표시 둘은 JS가 있을 때만 갱신된다
 *
 * 귀속연도와 실현손익은 **표시의 향상**이다(`RedemptionForm`의 만기손실 고정과 같은
 * 자리). JS가 없으면 빈 채로 있고, 저장되는 값은 어느 쪽에서도 같다 — 두 값은
 * 계약이 받지 않으므로 폼에 실리지 않는다.
 *
 * **그래서 이 둘을 히든으로도 보내지 않는다.** 보내면 계약이 그것을 무시하거나
 * 받아야 하고, 받으면 상환일과 갈릴 수 있는 열이 하나 생긴다(DOC-005 §7의 각주).
 *
 * ## `<select>` 셋에 `key`를 붙인다
 *
 * AQ-64 — React가 제출마다 폼을 초기화하는데 `<select>`의 갱신 경로는 옵션을 다시
 * 쓰지 않으므로, `defaultValue`가 마운트 시점에 얼어붙어 표시가 첫 옵션으로
 * 떨어진다. 값과 같은 식의 `key`가 그것을 remount로 바꾼다.
 */

export function RealizedProductForm({
  action,
  initialValues,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>
  initialValues: Record<string, string>
}) {
  const [state, formAction] = useActionState(action, initialFormState(initialValues))

  const values = state.values
  const { fieldErrors } = state

  const [type, setType] = useState(values.redemptionType ?? '')
  const [gross, setGross] = useState(values.grossAmount ?? '')
  const [principal, setPrincipal] = useState(values.principal ?? '')
  const [date, setDate] = useState(values.redemptionDate ?? '')

  const locked = taxableIncomeLocked(type)
  const year = attributionYearOf(date)
  const pnl = realizedPnlOf(gross, principal)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />

      {/* ── 상품 정보 ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-neutral-900">상품 정보</h2>

        <Field
          name="name"
          label="상품명"
          error={fieldErrors.name}
          hint="증권사 거래내역의 「종목명」"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              defaultValue={values.name ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="issuer" label="발행사" error={fieldErrors.issuer} hint="선택">
            {(props) => (
              <input
                {...props}
                type="text"
                defaultValue={values.issuer ?? ''}
                className={INPUT_CLASS}
              />
            )}
          </Field>

          <Field
            name="accountType"
            label="계좌유형"
            error={fieldErrors.accountType}
            hint="비과세 계좌는 종합과세 합산에서 제외된다"
          >
            {(props) => (
              <select
                {...props}
                key={values.accountType ?? ''}
                defaultValue={values.accountType ?? ''}
                className={INPUT_CLASS}
              >
                <option value="">선택</option>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field
          name="principal"
          label="투자원금 (원)"
          error={fieldErrors.principal}
          hint="실현손익을 이 값에서 뺀다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.principal ?? ''}
              onChange={(event) => setPrincipal(event.target.value)}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </section>

      {/* ── 상환 실적 ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold text-neutral-900">상환 실적</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="redemptionType"
            label="상환 유형"
            error={fieldErrors.redemptionType}
            hint="조기상환도 고를 수 있다 — 차수는 기록하지 않는다"
          >
            {(props) => (
              <select
                {...props}
                key={values.redemptionType ?? ''}
                defaultValue={values.redemptionType ?? ''}
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

          <Field
            name="redemptionDate"
            label="상환일"
            error={fieldErrors.redemptionDate}
            hint={
              year == null
                ? '귀속연도와 원천징수 세율이 이 날짜에서 나온다'
                : `귀속연도 ${year}년 — 이 해의 금융소득에 합산된다`
            }
          >
            {(props) => (
              <input
                {...props}
                type="date"
                defaultValue={values.redemptionDate ?? ''}
                onChange={(event) => setDate(event.target.value)}
                className={INPUT_CLASS}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="grossAmount"
            label="실수령액 (원)"
            error={fieldErrors.grossAmount}
            hint="거래내역의 「거래금액」. 원금을 포함한다"
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                defaultValue={values.grossAmount ?? ''}
                onChange={(event) => setGross(event.target.value)}
                className={INPUT_CLASS}
              />
            )}
          </Field>

          <Field
            name="taxableIncome"
            label="과세 금융소득 (원)"
            error={fieldErrors.taxableIncome}
            hint={
              locked
                ? '만기상환(손실)이므로 0이다 — ELS 손실은 다른 금융소득과 통산되지 않는다'
                : '거래내역의 「과표」'
            }
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                key={locked ? 'locked' : 'open'}
                defaultValue={locked ? '0' : (values.taxableIncome ?? '')}
                readOnly={locked}
                className={`${INPUT_CLASS}${locked ? ' bg-neutral-100 text-neutral-600' : ''}`}
              />
            )}
          </Field>
        </div>

        <Field
          name="withholdingTax"
          label="원천징수세액 (원)"
          error={fieldErrors.withholdingTax}
          hint="거래내역의 「제세금」. 비우면 과세 금융소득 × 분리과세율로 산출한다"
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

        {/*
          파생 표시 — 칸이 아니다. 히든으로도 보내지 않는다(머리글의 각주).
          `pnl`이 `null`인 동안 자리를 만들지 않는 이유는 그 자리가 「0원」으로
          읽히기 때문이다.
        */}
        {pnl != null && (
          <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            실현손익 <strong className="tabular-nums">{signedWon(pnl)}</strong> —
            실수령액 − 투자원금이다. 저장하지 않고 두 값에서 계산한다.
          </p>
        )}

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
              체크하지 않으면 추정값으로 표시된다. 세금 계산에는 어느 쪽이든 이
              금액이 쓰인다
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
      </section>

      <div>
        <SubmitButton label="등재" pendingLabel="저장 중…" />
      </div>
    </form>
  )
}
