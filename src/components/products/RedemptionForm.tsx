'use client'

import { useActionState, useState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { REDEMPTION_TYPE_LABELS, korDate } from '@/lib/format'
import {
  REDEMPTION_ID_FIELD,
  roundFillOf,
  taxableIncomeLocked,
  type RoundOption,
} from '@/lib/forms/redemption'
import { initialFormState, type FormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'

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
 * ~~`<select>`를 제어 컴포넌트로 두어도 JS 없는 제출은 그대로다~~ — 그 문장은 참이지만
 * **JS 있는 경로의 결함을 가렸다**(AQ-64). 서버 렌더가 `selected`를 넣는 것은 맞고
 * 그래서 JS 없는 제출은 무사하다. 그러나 하이드레이션 이후에는 제어 경로가
 * `updateOptions(…, setDefaultSelected = false)`로 호출되어 **어떤 옵션도 `selected`
 * 속성을 갖지 않게 되고**, 제출마다 도는 자동 폼 초기화가 일치하는 옵션을 찾지 못해
 * **첫 옵션으로 떨어진다.** 그래서 두 `<select>` 모두 `defaultValue` + 서버 값과 같은
 * 식의 `key`로 두고, `useState`는 DOM을 몰지 않고 **파생 표시(만기손실 고정)만**
 * 먹인다. 값의 정본은 DOM이고 서버 왕복 때 `key`가 둘을 함께 맞춘다.
 *
 * ## 차수를 고르면 세 칸을 다시 채운다 (v2.7)
 *
 * DOC-008 §5의 「차수를 고치면 다시 채운다」 각주다. **적용 차수는 정의상 「다음 도래」
 * 차수이므로**(DOC-007 RD-02) 평가가 일어난 뒤 기록하러 온 사용자에게 폼은 이미 다음
 * 차수를 가리킨다 — 차수를 옳게 고쳐도 금액이 따라오지 않으면 「차수 2 / 1차의 금액」이
 * 저장되고 그 행은 §4.6 집계의 입력이다.
 *
 * **산출은 여기 없다.** `roundFillOf`가 문자열을 골라 줄 뿐이고 이 파일에는 산술이 0이다
 * — 화면은 어떤 스위트의 import 그래프에도 없으므로(AQ-23) 세액에 닿는 판단을 여기 두면
 * 아무도 보지 못한다.
 *
 * ## 가드 셋이 «각각 다른 것»을 막는다
 *
 * | 가드 | 막는 것 |
 * |---|---|
 * | `picked != null` | **첫 렌더**가 `initialValues`를 덮지 않는다. SCR-202에서 그것은 증권사 확정값이고(A-04) 덮으면 조용한 변경이 된다 |
 * | `picked.on === values` | **서버 왕복**이 채움을 놓는다. 실패 응답의 `values`는 사용자가 실제로 보낸 값이며 그 위를 추정값이 덮으면 DOC-008 §6(입력값 보존)이 깨진다 |
 * | `locked`가 채움보다 세다 | 만기손실의 과세 금융소득이 `0`으로 남는다(V-12·I-08·절대 규칙 #8) |
 *
 * 둘째 가드가 `values` **참조**를 비교하는 이유: `toFormState`가 `valuesOf(form)`으로
 * 매번 새 객체를 만들고 그 객체는 경계를 넘어 역직렬화되므로, 왕복이 있었는지가
 * 참조 동일성 하나로 갈린다. 값 비교로는 「같은 값을 다시 보냈다」와 구분되지 않는다.
 *
 * ## `key`가 필요한 이유 — AQ-64의 «반대쪽 절반»
 *
 * AQ-64의 소스 대조는 `<select>`와 달리 **`<input>`은 갱신마다 `defaultValue` 속성이
 * 다시 쓰인다**고 적는다. 그래서 `key` 없이도 될 것 같지만 아니다 — 사용자가 한 번이라도
 * 타이핑한 `<input>`은 HTML의 **dirty value flag**가 서서 속성 변경이 표시를 바꾸지
 * 않는다. 결정이 「덮어쓴다(차수가 정본)」이므로 **고친 칸도 바뀌어야** 하고, 그것을
 * 하는 것은 remount뿐이다(새 요소는 flag가 내려간 채로 마운트된다).
 *
 * 그리고 AQ-64가 적은 **제출 시 자동 폼 초기화**가 둘째 가드와 맞물린다: 응답이 오면
 * 채움이 풀려 `defaultValue`가 사용자가 보낸 값이 되고, `form.reset()`이 그 값으로
 * 복원한다. 순서가 맞아 입력값 보존이 성립한다.
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

  /*
   * 「방금 고른 차수」 — 값만이 아니라 **그 선택이 어느 응답 위에서 일어났는가**를
   * 함께 담는다. 머리글의 가드 표 참조.
   */
  const [picked, setPicked] = useState<{
    on: Record<string, string>
    roundNo: string
  } | null>(null)

  const fill =
    picked != null && picked.on === values
      ? roundFillOf(rounds, picked.roundNo, type)
      : null

  const locked = taxableIncomeLocked(type)

  /*
   * 채우지 못하는 유형에서는 **비운다** — `values`로 되돌리면 직전 차수의 금액이
   * 이 차수에 붙는다(만기손실로 바꿨는데 2차의 이익 금액이 남는 형태).
   * 「채움이 서지 않았다」(`fill == null`)와 「채울 값이 없다」(`amounts == null`)는
   * 다른 상태이고, 그 둘을 가르는 것이 이 세 줄이다.
   */
  const dateValue = fill == null ? (values.redemptionDate ?? '') : fill.redemptionDate
  const grossValue =
    fill == null ? (values.grossAmount ?? '') : (fill.amounts?.grossAmount ?? '')
  const taxableValue =
    fill == null ? (values.taxableIncome ?? '') : (fill.amounts?.taxableIncome ?? '')

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

        {/*
          V-13 — 조기·리자드 상환은 차수가 필수이고(I-14) 만기 상환은 차수가 없다.
          그래서 빈 선택지가 「해당 없음」이며 기본값이 아니라 **정상값**이다.
        */}
        <Field
          name="roundNo"
          label="차수"
          error={fieldErrors.roundNo}
          hint={
            fill != null && type === 'LIZARD' && fill.amounts == null
              ? '이 차수에는 리자드 조건이 정의되어 있지 않다 — 저장이 거부된다(V-14)'
              : '조기·리자드 상환은 필수. 만기 상환은 비운다'
          }
        >
          {(props) => (
            <select
              {...props}
              key={values.roundNo ?? ''}
              defaultValue={values.roundNo ?? ''}
              /*
               * 제어 컴포넌트로 만들지 않는다 — AQ-64가 그것을 「해결이 아니라
               * 악화」로 실측했다(어떤 옵션도 `selected`를 받지 못해 제출마다 첫
               * 옵션으로 떨어진다). `onChange`는 DOM을 몰지 않고 파생 표시만 먹인다.
               */
              onChange={(event) =>
                setPicked({ on: values, roundNo: event.target.value })
              }
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
          hint={
            fill == null
              ? '귀속연도와 원천징수 세율이 이 날짜에서 나온다'
              : `${fill.roundNo}차 평가일 + 5일이다 — 연휴에 걸리면 하루이틀 밀릴 수 있으니 거래내역의 날짜로 고친다`
          }
        >
          {(props) => (
            <input
              {...props}
              type="date"
              key={dateValue}
              defaultValue={dateValue}
              className={INPUT_CLASS}
            />
          )}
        </Field>

        <Field
          name="grossAmount"
          label="실수령액 (원)"
          error={fieldErrors.grossAmount}
          hint={grossHint({ fill, type })}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              key={grossValue}
              defaultValue={grossValue}
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
               * `key`를 «표시할 값»에 묶는다 — 사용자가 타이핑한 `<input>`은
               * dirty value flag 때문에 `defaultValue` 속성이 바뀌어도 표시가
               * 따라오지 않는다(머리글의 AQ-64 절). remount만이 그것을 바꾼다.
               * 고정이 채움보다 세므로 `locked`일 때 key가 `'locked'`로 «고정»되어
               * 차수를 아무리 바꿔도 `'0'`이 유지된다.
               */
              key={locked ? 'locked' : `open:${taxableValue}`}
              defaultValue={locked ? '0' : taxableValue}
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

        ★ **채움이 서면 «끈다».** ST-05는 기본값만 끄고 이후 상호작용을 보지 않았다 —
        사용자가 체크해 둔 뒤 차수를 고르면 화면이 채운 추정값이 **확정 표식을 달고**
        저장된다. SCR-202(수정)에서는 저장된 `true`가 그대로 뒤집히는데, 그때 금액도
        추정값으로 바뀌었으므로 **표식과 값이 함께 움직이는 것이 맞다.**
      */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="isConfirmed"
          value="on"
          key={fill == null ? 'kept' : 'estimated'}
          defaultChecked={fill == null && (values.isConfirmed ?? '') !== ''}
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

/**
 * 실수령액 칸의 안내 — **어느 가정의 값인지 말한다.**
 *
 * 칸 이름은 「실수령액」(확정 축)이고 채운 수는 추정값이므로(DOC-005 §4가 두 용어를
 * 가른다) 그 구분을 문구가 진다. 새 합성어를 만들지 않는다(절대 규칙 #9).
 *
 * ★ **셋째 분기가 잔여 위험 하나를 덮는다.** 채움의 방아쇠는 차수 `<select>` 하나이므로
 * 차수를 한 번도 건드리지 않고 유형만 리자드로 바꾸면 칸에는 조기상환 가정의 금액이
 * 남는다(과대). 방아쇠를 유형에도 달면 SCR-202에서 「비고만 고치려다 유형을
 * 바로잡았는데 확정 금액이 바뀌었다」가 되므로, 방아쇠는 하나로 두고 **그 경우를
 * 말로 덮는다.**
 */
function grossHint({
  fill,
  type,
}: {
  fill: ReturnType<typeof roundFillOf>
  type: string
}): string {
  if (fill?.amounts != null) {
    const assumed = type === 'LIZARD' ? '리자드' : '조기'
    return `${fill.roundNo}차 ${assumed}상환 가정의 추정값이다 — 거래내역의 실제 값으로 고친다`
  }
  if (type === 'LIZARD') {
    return '리자드 상환은 금액이 다르다 — 차수를 다시 골라 채우거나 거래내역 값으로 고친다'
  }
  return '증권사 거래내역의 「거래금액」. 원금을 포함한다'
}
