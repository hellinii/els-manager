'use client'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { KI_OBSERVATION_LABELS } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import {
  EVALUATION_DATE_BASIS_FIELD,
  evaluationDateHintsOf,
  previewDatesOf,
  type EvaluationDateHint,
} from '@/lib/forms/schedules'
import type { FormState } from '@/lib/forms/state'
import { BARRIERS_FIELD, MAX_ROUNDS, roundCountOf } from '@/lib/forms/productForm'

/**
 * 평가 조건 구획 — 일괄 배리어와 차수표 (SCR-204, DOC-008 §5·§9 SQ-04)
 *
 * ## 일괄 입력은 **채우는 도구**이고 정본은 차수별 칸이다
 *
 * 배리어를 일괄 칸에만 두면 계약이 돌려주는 `schedules[2].barrier` 오류가 어느
 * 칸과도 짝지어지지 않아 상단 요약으로 밀린다 — 가장 흔한 오류가 가장 먼 자리에
 * 표시된다. 「일괄 적용」이 차수별 칸을 채우고(`applyBarriers`, 제출이다) 그 뒤에는
 * 차수마다 고칠 수 있다. 스텝다운이 아닌 구조도 같은 칸에서 입력된다.
 *
 * ## 평가일은 차수별 입력 칸이다 (DOC-008 v2.8)
 *
 * 증권사의 실제 평가일이 전역 산식과 상품마다 다르게 어긋나므로(DOC-002 §4.8 v1.6 —
 * E04000 5/5) 칸이 정본이고 산식은 **채우는 도구**다: 저장이 빈 칸을 채우고
 * 「산식으로 다시 채우기」가 전 차수를 덮는다(일괄 배리어와 같은 짝). 산식이 움직여도
 * 되는지는 칸 옆 힌트와 저장이 **같은 판정**(`evaluationDatePlanOf`)에서 받는다 —
 * 힌트가 「저장하면 채운다」고 말한 칸만 저장이 채운다.
 *
 * 평가일 기준(`evaluationDateBasis`)은 히든이다. 사용자가 고칠 값이 아니라 「지금 칸의
 * 날짜가 어떤 발행일·주기에서 나왔는가」의 기록이며, 수정 화면에서 발행일을 고친 저장이
 * 산식대로이던 날짜를 옮기고 실제 날짜는 옮기지 않게 한다.
 *
 * ## 모든 비율 칸이 퍼센트다
 *
 * 연쿠폰율·KI 배리어·배리어·리자드가 같은 단위이므로 사용자가 단위를 바꿔 생각할
 * 자리가 없다. 소수 변환은 `percentToRatio`가 파싱 계층에서 한 번만 한다
 * (CLAUDE.md 코딩 규약: 「비율은 입력 계층에서 변환」).
 */

export function ConditionStep({ state }: { state: FormState }) {
  const { values, fieldErrors } = state
  const rounds = roundCountOf(values)
  // 산식을 계산할 수 있는가 — 차수표 위 안내에만 쓴다(칸별 판정은 힌트가 한다)
  const computable = previewDatesOf(values).length > 0
  const hints = evaluationDateHintsOf(values)

  return (
    <div className="flex flex-col gap-4">
      {/*
        평가일 기준 — 차수표가 없어도 그린다(총 차수 0에서도 제출마다 다음 렌더로 이어져야 한다).
        설계상 히든이며 그 예외는 `HIDDEN_FIELD_NAMES` 원장에 있다.
      */}
      <input
        type="hidden"
        name={EVALUATION_DATE_BASIS_FIELD}
        value={values[EVALUATION_DATE_BASIS_FIELD] ?? ''}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          name="evaluationPeriodMonths"
          label="평가주기 (개월)"
          error={fieldErrors.evaluationPeriodMonths}
          hint="통상 6"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.evaluationPeriodMonths ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          name="totalRounds"
          label="총 차수"
          error={fieldErrors.totalRounds}
          hint={`${MAX_ROUNDS}까지`}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.totalRounds ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          name="annualCouponRate"
          label="연쿠폰율 (%)"
          error={fieldErrors.annualCouponRate}
          hint="연 환산"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              defaultValue={values.annualCouponRate ?? ''}
              placeholder="예: 8"
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="kiBarrier"
          label="KI 배리어 (%)"
          error={fieldErrors.kiBarrier}
          hint="노낙인 상품은 비운다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              defaultValue={values.kiBarrier ?? ''}
              placeholder="예: 50"
              className={INPUT_CLASS}
            />
          )}
        </Field>

        {/*
          V-16 — 배리어와 관찰방식은 짝이다(I-11). 배리어가 있으면 필수이고 없으면
          입력 불가이므로 「선택」이 곧 노낙인이다. 기본값을 주면 노낙인 상품에
          관찰방식이 붙어 계약이 거부한다.
        */}
        <Field
          name="kiObservation"
          label="관찰방식"
          error={fieldErrors.kiObservation}
          hint="KI 배리어가 있으면 고른다"
        >
          {(props) => (
            <select
              {...props}
              /*
               * `key`가 `defaultValue`와 같은 식이다 — AQ-64. 이 칸이 실사용에서
               * 관측된 자리다: 「일괄 적용」은 같은 폼에 머무는 제출이므로 비제어
               * `<select>`가 remount되지 않고, 자동 폼 초기화가 마운트 시점의
               * 낡은 속성(빈 값 = 「선택」)으로 표시를 되돌렸다. 내부 값은 남아
               * 있으므로 사용자는 안 들어간 줄 알고 다시 고르게 된다.
               */
              key={values.kiObservation ?? ''}
              defaultValue={values.kiObservation ?? ''}
              className={INPUT_CLASS}
            >
              <option value="">선택</option>
              {Object.entries(KI_OBSERVATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {/* SQ-04 — 구분자는 숫자·점이 아닌 모든 연속이다. `90-85-80`·`90 85 80`·`90/85/80` */}
      <div className="rounded-lg border border-neutral-200 p-4">
        <Field
          name={BARRIERS_FIELD}
          label="배리어 스케줄 일괄 입력 (%)"
          error={fieldErrors[BARRIERS_FIELD]}
          hint="구분자는 아무 기호나 공백이어도 된다. 「일괄 적용」이 차수표를 채운다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              defaultValue={values[BARRIERS_FIELD] ?? ''}
              placeholder="예: 90-85-80-75-70-65"
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <button
          type="submit"
          name="intent"
          value="APPLY_BARRIERS"
          className="mt-3 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          일괄 적용
        </button>
      </div>

      {fieldErrors.schedules != null && (
        // V-03의 「개수가 총 차수와 다르다」가 이 자리에 온다 — 차수표 위다.
        <p className="text-sm text-red-700">{fieldErrors.schedules}</p>
      )}

      {rounds === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          총 차수를 입력하거나 배리어를 일괄 적용하면 차수표가 생긴다.
        </p>
      ) : (
        <RoundTable
          rounds={rounds}
          computable={computable}
          hints={hints}
          values={values}
          fieldErrors={fieldErrors}
        />
      )}
    </div>
  )
}

/**
 * 차수표 — 차수 · 평가일 · 배리어 · 리자드 조건.
 *
 * 리자드 세 칸은 `<details>` 안에 있다. DOC-008 §8이 차수별 조건표를 「우선순위 낮은
 * 열을 접고 상세 펼치기로 제공」하라고 지목했고, `<details>`는 JS가 필요 없으며
 * 접힌 내용이 **DOM에 있으므로** 값이 제출된다 — 상태로 접으면 접힌 차수의 리자드
 * 조건이 저장되지 않는다.
 */
function RoundTable({
  rounds,
  computable,
  hints,
  values,
  fieldErrors,
}: {
  rounds: number
  computable: boolean
  hints: readonly EvaluationDateHint[]
  values: Record<string, string>
  fieldErrors: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-neutral-600">
          {computable
            ? '평가일은 증권사 통지서의 날짜를 적는다. 빈 칸은 저장할 때 산식(발행일 + n × 평가주기 − 1일)으로 채워진다.'
            : '발행일과 평가주기를 입력하면 빈 평가일은 저장할 때 산식으로 채워진다.'}
        </p>
        <button
          type="submit"
          name="intent"
          value="APPLY_EVALUATION_DATES"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          산식으로 다시 채우기
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {Array.from({ length: rounds }, (_, index) => {
          const dateName = path('schedules', index, 'evaluationDate')
          const hint = hints[index]
          const barrierName = path('schedules', index, 'barrier')
          const lizardBarrierName = path('schedules', index, 'lizardBarrier')
          const lizardRateName = path('schedules', index, 'lizardCouponRate')
          const noKiName = path('schedules', index, 'lizardRequiresNoKi')
          const hasLizard = (values[lizardBarrierName] ?? '') !== ''

          return (
            <li
              key={index}
              className="rounded-lg border border-neutral-200 px-4 py-3"
            >
              <div className="flex flex-wrap items-end gap-3">
                <span className="w-14 text-sm font-medium">{`${index + 1}차`}</span>

                <div className="w-44">
                  <Field
                    name={dateName}
                    label="평가일"
                    error={fieldErrors[dateName]}
                    hint={hint?.text ?? undefined}
                    hintTone={hint?.kind === 'FAR' ? 'warn' : 'muted'}
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="date"
                        defaultValue={values[dateName] ?? ''}
                        className={`${INPUT_CLASS} w-full`}
                      />
                    )}
                  </Field>
                </div>

                <div className="w-32">
                  <Field
                    name={barrierName}
                    label="배리어 (%)"
                    error={fieldErrors[barrierName]}
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="text"
                        inputMode="decimal"
                        defaultValue={values[barrierName] ?? ''}
                        className={`${INPUT_CLASS} w-full`}
                      />
                    )}
                  </Field>
                </div>
              </div>

              <details className="mt-2" open={hasLizard}>
                <summary className="cursor-pointer text-xs text-neutral-600">
                  리자드 조건
                </summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <Field
                    name={lizardBarrierName}
                    label="리자드 배리어 (%)"
                    error={fieldErrors[lizardBarrierName]}
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="text"
                        inputMode="decimal"
                        defaultValue={values[lizardBarrierName] ?? ''}
                        className={INPUT_CLASS}
                      />
                    )}
                  </Field>

                  <Field
                    name={lizardRateName}
                    label="리자드 쿠폰율 (%)"
                    error={fieldErrors[lizardRateName]}
                    hint="원금상환형은 0"
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="text"
                        inputMode="decimal"
                        defaultValue={values[lizardRateName] ?? ''}
                        className={INPUT_CLASS}
                      />
                    )}
                  </Field>

                  <label className="flex items-center gap-2 self-end text-sm">
                    {/*
                      체크박스는 체크될 때만 전송된다. `formOfValues`가 값 맵을
                      폼으로 만들 때 체크 안 된 칸을 `''`로 싣으므로 `checkbox()`가
                      빈 문자열도 거짓으로 읽는다 — 부재만 보면 「풀었는데 켜져
                      있다」가 된다.
                    */}
                    <input
                      type="checkbox"
                      name={noKiName}
                      value="on"
                      defaultChecked={(values[noKiName] ?? '') !== ''}
                      className="size-4"
                    />
                    KI 미터치 요구
                  </label>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
