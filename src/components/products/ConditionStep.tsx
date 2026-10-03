'use client'

import { Field, INPUT_CLASS, hintWith } from '@/components/form/Field'
import { LockedChoice } from '@/components/products/LockedChoice'
import { COUPON_PAYOUT_LABELS, KI_OBSERVATION_LABELS } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import {
  COUPON_BARRIERS_FIELD,
  MONTHLY_RATE_FIELD,
  couponCell,
  couponFormulaOf,
  couponRowCountOf,
  isFormulaCouponRow,
  isMonthlyValues,
  type CouponLock,
} from '@/lib/forms/monthly'
import {
  EVALUATION_DATE_BASIS_FIELD,
  evaluationDateHintsOf,
  previewDatesOf,
  type EvaluationDateHint,
} from '@/lib/forms/schedules'
import type { FormState } from '@/lib/forms/state'
import {
  BARRIERS_FIELD,
  MAX_ROUNDS,
  couponPayoutOptionsOf,
  roundCountOf,
} from '@/lib/forms/productForm'

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

export function ConditionStep({
  state,
  fieldNotes,
  couponLock,
}: {
  state: FormState
  /** 불러오기의 칸 안내(관찰방식 등) — `ProductForm`의 각주 */
  fieldNotes?: Readonly<Record<string, string>>
  /** 월수익 지급 기록이 있는 상품의 잠금(수정 화면) — `couponLockOf` */
  couponLock?: CouponLock | null
}) {
  const { values, fieldErrors } = state
  const monthly = isMonthlyValues(values)
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

      {/*
        쿠폰 지급 — 평가 조건 구획의 맨 위(DOC-008 SCR-204 · P8 컷 b2). **기본값이 없다(U7)** — 「선택」에서
        시작하고 고르지 않으면 V-25가 이 칸에 붙는다. 「월지급식」은 b4에서 연다 — 그 전에는 저장값이 월지급식인
        상품에서만 선택지에 나타난다(`couponPayoutOptionsOf`). `key`는 아래 관찰방식과 같은 규약이다(AQ-64)
      */}
      {couponLock != null && values.couponPayout != null && values.couponPayout !== '' ? (
        // 기록이 있는 상품 — 바꿀 수 없다(DQ-14). 값 글자 + 숨은 입력이 저장값을 되돌려 보낸다(SQ-21 ⓖ b3 개정)
        <LockedChoice
          name="couponPayout"
          label="쿠폰 지급"
          value={values.couponPayout}
          shown={COUPON_PAYOUT_LABELS[values.couponPayout as keyof typeof COUPON_PAYOUT_LABELS] ?? values.couponPayout}
          error={fieldErrors.couponPayout}
        />
      ) : (
        <Field
          name="couponPayout"
          label="쿠폰 지급"
          error={fieldErrors.couponPayout}
          hint={hintWith(undefined, fieldNotes, 'couponPayout')}
        >
          {(props) => (
            <select
              {...props}
              key={values.couponPayout ?? ''}
              defaultValue={values.couponPayout ?? ''}
              className={INPUT_CLASS}
            >
              <option value="">선택</option>
              {couponPayoutOptionsOf(values.couponPayout).map((payout) => (
                <option key={payout} value={payout}>
                  {COUPON_PAYOUT_LABELS[payout]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          name="evaluationPeriodMonths"
          label="평가주기 (개월)"
          error={fieldErrors.evaluationPeriodMonths}
          hint={hintWith('통상 6', fieldNotes, 'evaluationPeriodMonths')}
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
          hint={
            monthly
              ? '월지급식은 0 — 수익은 월수익 연쿠폰율'
              : hintWith('연 환산', fieldNotes, 'annualCouponRate')
          }
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              // 월지급식이면 0으로 고정한다 — 전이가 값을 0으로 두고 칸은 고칠 수 없다(DOC-011 V-08′ · DOC-008 v2.29 (4))
              key={monthly ? 'monthly' : 'open'}
              defaultValue={monthly ? '0' : (values.annualCouponRate ?? '')}
              readOnly={monthly}
              placeholder="예: 8"
              className={`${INPUT_CLASS}${monthly ? ' bg-neutral-100 text-neutral-600' : ''}`}
            />
          )}
        </Field>
      </div>

      {monthly && (
        <MonthlyBlock values={values} fieldErrors={fieldErrors} couponLock={couponLock ?? null} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="kiBarrier"
          label="KI 배리어 (%)"
          error={fieldErrors.kiBarrier}
          hint={hintWith('노낙인 상품은 비운다', fieldNotes, 'kiBarrier')}
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
          hint={hintWith('KI 배리어가 있으면 고른다', fieldNotes, 'kiObservation')}
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

/**
 * 월지급 블록 — 월수익 연쿠폰율 · 월수익 배리어 일괄 채우기 · 평가일 산식으로 채우기 · 행마다 평가일 · 지급일 · 배리어
 * (P8 컷 b3-4, DOC-008 SCR-204 「P8 월지급식」 · v2.29).
 *
 * **b3에서는 지급방식 값이 월지급식인 렌더에만 선다**(부모의 `monthly`) — 「월지급식」 선택지가 b4이므로 지금 이 블록에
 * 닿는 것은 저장값이 월지급식인 상품의 수정 화면뿐이다. b4가 늘 그린다(닫힌 채).
 *
 * 일정은 옮기지 않는다 — 발행일 · 주기 · 총 차수를 바꿔도 칸은 그대로이고 버튼이 다시 채운다(보류 규칙). 「산식」 표식은
 * 지금의 산식과 칸을 비교한다 — 어긋나면 사라진다(v2.29 (2)).
 */
function MonthlyBlock({
  values,
  fieldErrors,
  couponLock,
}: {
  values: Record<string, string>
  fieldErrors: Record<string, string>
  couponLock: CouponLock | null
}) {
  const rows = couponRowCountOf(values)
  const formula = couponFormulaOf(values)
  const recorded = new Set(couponLock?.recordedCouponNos ?? [])

  return (
    <details open className="rounded-lg border border-neutral-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold">월지급 — 월수익 연쿠폰율 · 월수익 일정</summary>
      <p className="mt-2 text-xs text-neutral-600">기본형만 등록한다 — 다른 변형은 v2</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field
          name={MONTHLY_RATE_FIELD}
          label="월수익 연쿠폰율 (%)"
          error={fieldErrors[MONTHLY_RATE_FIELD]}
          hint="투자설명서의 「연 24.24%」 — 월 비율이 아니다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              defaultValue={values[MONTHLY_RATE_FIELD] ?? ''}
              placeholder="예: 24.24"
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <Field
            name={COUPON_BARRIERS_FIELD}
            label="월수익 배리어 일괄 (%)"
            error={fieldErrors[COUPON_BARRIERS_FIELD]}
            hint="한 값을 모든 행에 채운다 — 정본은 행마다의 칸이다"
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                defaultValue={values[COUPON_BARRIERS_FIELD] ?? ''}
                placeholder="예: 50"
                className={INPUT_CLASS}
              />
            )}
          </Field>
          <button
            type="submit"
            name="intent"
            value="APPLY_COUPON_BARRIERS"
            className="self-start rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
          >
            월수익 배리어 일괄 채우기
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {couponLock != null ? (
          // 기록된 달은 칸이 readOnly라 산식이 덮은 값을 되돌릴 수 없고 저장은 CONFLICT다(DOC-008 v2.29 (3))
          <p className="text-xs text-neutral-600">
            월수익 지급 기록이 있어 산식으로 다시 채우지 않는다 — 기록 없는 달의 날짜는 칸에서 직접 고친다.
          </p>
        ) : (
          <button
            type="submit"
            name="intent"
            value="APPLY_COUPON_DATES"
            className="self-start rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
          >
            평가일 산식으로 채우기
          </button>
        )}
        {fieldErrors.couponSchedules != null && (
          // V-26의 행 전체 오류(1..K 연속 · 만기 이하 · 개수)와 DB 제약의 일정 오류가 이 자리에 온다
          <p className="text-sm text-red-700">{fieldErrors.couponSchedules}</p>
        )}
      </div>

      {rows === 0 ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          월수익 일정이 없다 — 발행일 · 평가주기 · 총 차수를 적고 「평가일 산식으로 채우기」를 누르면 행이 생긴다.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {Array.from({ length: rows }, (_, index) => {
            const locked = recorded.has(index + 1)
            const fromFormula = isFormulaCouponRow(values, index, formula)
            return (
              <li key={index} className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,0.6fr)_repeat(3,minmax(0,1fr))] sm:items-start">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {index + 1}번째
                  {fromFormula && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">산식</span>}
                  {locked && <span className="text-xs text-neutral-500">기록됨</span>}
                </div>
                {(['evaluationDate', 'paymentDate'] as const).map((sub) => (
                  <Field
                    key={sub}
                    name={couponCell(index, sub)}
                    label={sub === 'evaluationDate' ? '월수익 평가일' : '월수익 지급일'}
                    error={fieldErrors[couponCell(index, sub)]}
                    hint={locked ? '기록된 달 — 바꿀 수 없다' : undefined}
                  >
                    {(props) => (
                      <input
                        {...props}
                        type="date"
                        key={`${index}:${sub}:${values[couponCell(index, sub)] ?? ''}`}
                        defaultValue={values[couponCell(index, sub)] ?? ''}
                        readOnly={locked}
                        className={`${INPUT_CLASS}${locked ? ' bg-neutral-100 text-neutral-600' : ''}`}
                      />
                    )}
                  </Field>
                ))}
                <Field
                  name={couponCell(index, 'couponBarrier')}
                  label="월수익 배리어 (%)"
                  error={fieldErrors[couponCell(index, 'couponBarrier')]}
                >
                  {(props) => (
                    <input
                      {...props}
                      type="text"
                      inputMode="decimal"
                      key={`${index}:barrier:${values[couponCell(index, 'couponBarrier')] ?? ''}`}
                      defaultValue={values[couponCell(index, 'couponBarrier')] ?? ''}
                      className={INPUT_CLASS}
                    />
                  )}
                </Field>
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}
