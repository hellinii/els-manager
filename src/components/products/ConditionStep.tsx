'use client'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { KI_OBSERVATION_LABELS } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import { previewDatesOf } from '@/lib/forms/schedules'
import type { FormState } from '@/lib/forms/state'
import { BARRIERS_FIELD, MAX_ROUNDS, roundCountOf } from '@/lib/forms/steps'

/**
 * ③ 평가 조건 — 일괄 배리어와 차수표 (SCR-204, DOC-008 §5·§9 SQ-04)
 *
 * ## 일괄 입력은 **채우는 도구**이고 정본은 차수별 칸이다
 *
 * 배리어를 일괄 칸에만 두면 계약이 돌려주는 `schedules[2].barrier` 오류가 어느
 * 칸과도 짝지어지지 않아 상단 요약으로 밀린다 — 가장 흔한 오류가 가장 먼 자리에
 * 표시된다. 「일괄 적용」이 차수별 칸을 채우고(`applyBarriers`, 제출이다) 그 뒤에는
 * 차수마다 고칠 수 있다. 스텝다운이 아닌 구조도 같은 칸에서 입력된다.
 *
 * ## 평가일은 여기 입력이 없다
 *
 * 생성값이며(DOC-008 ④) 표에 **표시만** 한다. 히든으로 나르지 않는 이유는 발행일을
 * 고친 뒤 이 단계를 지나지 않고 저장하는 경로에서 고치기 전 날짜가 저장되기
 * 때문이다 — 화면과 파서가 `previewDatesOf` 하나를 같은 값에 부른다.
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
  const dates = previewDatesOf(values)

  return (
    <div className="flex flex-col gap-4">
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
          dates={dates}
          values={values}
          fieldErrors={fieldErrors}
        />
      )}
    </div>
  )
}

/**
 * 차수표 — 차수 · 평가일(생성값) · 배리어 · 리자드 조건.
 *
 * 리자드 세 칸은 `<details>` 안에 있다. DOC-008 §8이 차수별 조건표를 「우선순위 낮은
 * 열을 접고 상세 펼치기로 제공」하라고 지목했고, `<details>`는 JS가 필요 없으며
 * 접힌 내용이 **DOM에 있으므로** 값이 제출된다 — 상태로 접으면 접힌 차수의 리자드
 * 조건이 저장되지 않는다.
 */
function RoundTable({
  rounds,
  dates,
  values,
  fieldErrors,
}: {
  rounds: number
  dates: readonly string[]
  values: Record<string, string>
  fieldErrors: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-3">
      {dates.length === 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          발행일과 평가주기를 입력하면 평가일이 생성된다. 지금은 비어 있다.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {Array.from({ length: rounds }, (_, index) => {
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
                <span className="w-28 text-sm text-neutral-600">
                  {dates[index] ?? '평가일 미정'}
                </span>

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
                      체크박스는 체크될 때만 전송된다. 히든 이송이 값 없는 이름을
                      실을 수 있으므로 `checkbox()`가 빈 문자열도 거짓으로 읽는다 —
                      그러지 않으면 「풀었는데 단계를 지나면 켜져 있다」가 된다.
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
