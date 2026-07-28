'use client'

import { useActionState } from 'react'

import { AssetForm } from '@/components/prices/AssetForm'
import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { ConditionStep } from '@/components/products/ConditionStep'
import { ConfirmStep } from '@/components/products/ConfirmStep'
import { UnderlyingRow } from '@/components/products/UnderlyingRow'
import type { AssetOption } from '@/lib/db/queries/prices'
import { ACCOUNT_TYPE_LABELS } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import { initialFormState, type FormState } from '@/lib/forms/state'
import {
  MAX_UNDERLYINGS,
  PRODUCT_ID_FIELD,
  PRODUCT_STEPS,
  STEP_FIELD,
  UNDERLYING_SUBS,
  carryNames,
  parseStep,
  roundCountOf,
  rowCountOf,
  type RowCounts,
  type StepId,
} from '@/lib/forms/steps'

/**
 * SCR-204 ELS 등록 — 단계형 폼 (DOC-008 §5·§7.1, P4 컷 4a·4b)
 *
 * ## 단계는 상태가 아니라 폼의 값이다
 *
 * 현재 단계는 `step` 히든 필드에 있고 전환은 **제출**이다(`lib/forms/steps.ts`).
 * `useState`로 하면 두 가지를 잃는다 — JS 없이 동작하지 않고(컷 1b가 실측한
 * 함정의 네 배다), 전이를 어느 스위트도 보지 못한다(AQ-32). 여기 있는 것은
 * 「어느 칸을 그리는가」뿐이고 「무엇이 다음인가」는 순수 모듈이 정한다.
 *
 * ## 비활성 단계의 값은 히든으로 실린다
 *
 * 사라진 입력은 제출되지 않으므로 활성 단계가 그리지 않는 이름을 전부 다시 싣는다
 * (`carryNames`). 목록을 여기서 적지 않는 이유는 배열 필드가 동적이라는 것이다 —
 * 두 곳에 적으면 한쪽이 뒤처져 **조용히 값이 사라지는 행**이 생기고, 증상은 저장
 * 버튼을 누를 때까지 없다.
 *
 * ## 자산 등록 폼은 이 폼의 **형제**다
 *
 * HTML은 폼 중첩을 허용하지 않는다. 그래서 `AssetForm`(§5.10, SCR-302의 그것)을
 * `<form>` 바깥에 두고 ② 단계에서만 보인다 — 「고를 자산이 없다」의 다음 행동이
 * 그 자리에 있어야 하기 때문이다(ST-02, DOC-008 §5 SCR-302 v0.3이 순환을 끊은
 * 것과 같은 이유).
 *
 * > **JS가 없으면 그 등록이 이 폼의 입력을 지운다.** 자산 등록은 별 폼이므로 제출
 * > 응답이 새 문서이고 `useActionState`의 상태가 초기값으로 돌아간다. 한 폼에
 * > 합치면(의도 `CREATE_ASSET`) 보존되지만 `name`이 상품의 `name`과 충돌하므로
 * > 접두사와 오류 키 재매핑이 필요하고, 그 대가를 「JS 없는 경로에서만 생기는
 * > 손실」이 정당화하지 않는다. 같은 등록이 SCR-302에도 있다.
 *
 * ## 등록과 수정이 **같은 컴포넌트**다 (P4 컷 5)
 *
 * 다른 것은 셋뿐이다 — 초기값이 비어 있지 않고, 대상 id를 히든으로 나르고, 저장이
 * `updateProduct`다. 그래서 그 셋만 props로 받는다: `initialValues`·`productId`·
 * `action`. 컴포넌트를 복제하는 대안은 단계 셸·히든 이송·오류 표시가 두 벌이 되고,
 * 갈리는 순간 **한쪽에서만 값이 사라진다**(§5.2가 전체 교체이므로 그 손실이 저장으로
 * 이어진다).
 *
 * `action`을 props로 받는 것이 서버 액션의 정상 경로다 — 서버 컴포넌트가 참조를
 * 내리므로 클라이언트 번들에 어댑터가 실리지 않고, 렌더된 폼에는 그 액션의
 * `$ACTION_*` 히든 필드가 남아 실 HTTP 검증이 가능하다.
 */

export function ProductForm({
  assets,
  action,
  initialValues,
  productId,
}: {
  assets: readonly AssetOption[]
  /** 이 폼을 받는 어댑터. 등록은 `productFormAction`, 수정은 `productEditFormAction` */
  action: (prev: FormState, form: FormData) => Promise<FormState>
  /** 등록은 `productDefaults()`, 수정은 `productValuesOf(view)` */
  initialValues: Record<string, string>
  /** 수정 모드에서만 있다. 히든으로 실려 어댑터가 대상을 안다 */
  productId?: string
}) {
  const [state, formAction] = useActionState(
    action,
    initialFormState({ ...initialValues, [STEP_FIELD]: 'BASIC' }),
  )

  const values = state.values
  const step = parseStep(values[STEP_FIELD])
  const counts: RowCounts = {
    underlyings: rowCountOf(values, 'underlyings'),
    rounds: roundCountOf(values),
  }

  return (
    <section className="flex flex-col gap-5">
      <StepNav active={step} />

      <form action={formAction} className="flex flex-col gap-5" noValidate>
        <FormMessage state={state} />

        {/*
          대상 id — **상태가 아니라 props에서 나온다.** `transition`이 값을 계약 입력의
          이름으로 좁히므로 이 칸은 상태에 남지 않고, 그것이 의도다: id의 정본은
          라우트 하나다(`PRODUCT_ID_FIELD`의 각주).
        */}
        {productId != null && (
          <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
        )}

        {/*
          히든 이송. `step`도 여기 실린다 — 활성 단계가 소유하는 이름이 아니므로
          `carryNames`가 그것을 포함한다(그 값은 전이가 정한 **다음** 단계다).
        */}
        {carryNames(counts, step).map((name) => (
          <input key={name} type="hidden" name={name} value={values[name] ?? ''} />
        ))}

        {step === 'BASIC' && <BasicStep state={state} />}
        {step === 'UNDERLYINGS' && (
          <UnderlyingStep assets={assets} state={state} count={counts.underlyings} />
        )}
        {step === 'CONDITIONS' && <ConditionStep state={state} />}
        {step === 'CONFIRM' && <ConfirmStep state={state} assets={assets} />}

        <StepButtons active={step} canSaveHere={productId != null} />
      </form>

      {step === 'UNDERLYINGS' && (
        <details className="rounded-lg border border-neutral-200 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            고를 자산이 없다 — 자산 등록
          </summary>
          <p className="mt-2 text-xs text-neutral-500">
            등록하면 위 목록에 나타난다. 시세는 「시세 관리」에서 입력한다.
          </p>
          <div className="mt-4 max-w-sm">
            <AssetForm />
          </div>
        </details>
      )}
    </section>
  )
}

/** 진행 표시 — 링크가 아니다. 이동은 이전·다음 버튼(제출)이 한다 */
function StepNav({ active }: { active: StepId }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {PRODUCT_STEPS.map((step) => {
        const current = step.id === active
        return (
          <li
            key={step.id}
            aria-current={current ? 'step' : undefined}
            className={`rounded-md px-3 py-1.5 ${
              current
                ? 'bg-neutral-900 font-medium text-white'
                : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            {/*
              **한 문자열로 렌더한다.** `{a} {b}`는 자식이 셋이 되어 React가
              사이에 빈 주석을 넣으므로(하이드레이션이 경계를 알아야 한다) 렌더된
              HTML에 `① 기본 정보`라는 문자열이 존재하지 않는다 — 컷 2·3의
              `예상 조기상환`이 같은 함정이었다.
            */}
            {`${step.ordinal} ${step.title}`}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * 이전·다음, 그리고 저장. 버튼의 `value`가 의도를 나른다
 *
 * ## 수정 모드는 **어느 단계에서도 저장된다** (컷 5, 실측이 정했다)
 *
 * 처음에는 등록과 같이 ④에서만 저장하게 두었고, e2e가 「①에 저장 버튼이 없다」로
 * 빨간불이 되었다 — 한 칸을 고치려면 `다음`을 세 번 눌러야 한다. 등록에서 그 순서가
 * 옳은 이유는 폼이 **비어 있는 상태에서 시작**하므로 ①에서 저장하면 거의 전부가
 * 검증 오류가 되고 사용자가 단계 사이를 튕겨 다니게 되기 때문이다.
 *
 * 수정은 반대다. 폼은 **처음부터 완전하고**(초기값이 저장된 값이다) 히든 이송이 전
 * 단계의 값을 싣고 있으므로, 어느 단계에서 눌러도 저장되는 것은 「지금 화면에 보이는
 * 것 + 나머지 그대로」다. 단계 표시는 그때 「무엇을 보고 있는가」의 선택기가 된다.
 *
 * 검증 오류는 여전히 그 오류가 있는 단계로 되돌린다(`submitState`) — 어느 단계에서
 * 저장했는지와 무관하다.
 */
function StepButtons({
  active,
  canSaveHere,
}: {
  active: StepId
  /** 수정 모드. 등록은 ④에서만 저장한다 — 위 각주 */
  canSaveHere: boolean
}) {
  const at = PRODUCT_STEPS.findIndex((step) => step.id === active)
  const last = at === PRODUCT_STEPS.length - 1

  return (
    <div className="flex flex-wrap gap-2">
      {at > 0 && (
        <SubmitButton
          label="이전"
          pendingLabel="이동 중…"
          variant="secondary"
          name="intent"
          value="BACK"
        />
      )}
      {!last && (
        <SubmitButton label="다음" pendingLabel="이동 중…" name="intent" value="NEXT" />
      )}
      {(last || canSaveHere) && (
        /*
         * DOC-008 §6은 SCR-204의 로딩 상태를 「저장 중」으로 규정한다. `useFormStatus`가
         * 폼의 자손에서만 동작하므로 `SubmitButton`이 별 컴포넌트다 — 두 번 누르면
         * 상품이 둘 생긴다(§5.1에 멱등성이 없다).
         */
        <SubmitButton
          label="저장"
          pendingLabel="저장 중…"
          variant={last ? 'primary' : 'secondary'}
          name="intent"
          value="SUBMIT"
        />
      )}
    </div>
  )
}

type StepProps = { state: FormState }

/** ① 기본 정보 — DOC-008 §5의 입력 항목 + 비고(아래 각주) */
function BasicStep({ state }: StepProps) {
  const { values, fieldErrors } = state

  return (
    <div className="flex flex-col gap-4">
      <Field name="name" label="상품명" error={fieldErrors.name}>
        {(props) => (
          <input
            {...props}
            type="text"
            defaultValue={values.name ?? ''}
            placeholder="예: OO증권 ELS 12345회"
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
          name="issueDate"
          label="발행일"
          error={fieldErrors.issueDate}
          hint="평가일 생성의 기준이다"
        >
          {(props) => (
            <input
              {...props}
              type="date"
              defaultValue={values.issueDate ?? ''}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="principal"
          label="투자원금 (원)"
          error={fieldErrors.principal}
          hint="쉼표를 적어도 된다"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={values.principal ?? ''}
              placeholder="예: 100,000,000"
              className={INPUT_CLASS}
            />
          )}
        </Field>

        {/*
          기본 선택이 없다 — 일반/비과세는 세액이 갈리는 선택이므로(DOC-007 §5)
          기본값을 주면 「비과세 계좌의 상품을 일반으로 등록」이 조용히 통과하고
          그 결과는 SCR-401의 숫자로만 드러난다. `assetType`과 같은 판단이다.
        */}
        <Field name="accountType" label="계좌유형" error={fieldErrors.accountType}>
          {(props) => (
            <select
              {...props}
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

      {/*
        **비고는 DOC-008 §5의 단계 표에 없다.** 그런데 §5.2가 전체 교체이므로
        폼에 없는 필드는 **수정 시 비워진다** — 등록 화면에만 없으면 수정 화면에서
        기존 비고가 조용히 사라진다(컷 5). 문서에 등재하고 여기 둔다.
      */}
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
    </div>
  )
}

/** ② 기초자산 — 행 추가로 N종 */
function UnderlyingStep({
  assets,
  state,
  count,
}: StepProps & { assets: readonly AssetOption[]; count: number }) {
  const rows = Array.from({ length: count }, (_, index) => index)

  return (
    <div className="flex flex-col gap-4">
      {assets.length === 0 ? (
        /*
         * 빈 상태의 다음 행동이 아래 「자산 등록」이다(ST-02). 링크로 시세 관리로
         * 보내면 입력 중인 폼을 떠나게 되므로 그 자리에 폼을 둔다.
         */
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          등록된 기초자산이 없다. 아래 「자산 등록」으로 먼저 등록한다.
        </p>
      ) : (
        <p className="text-sm text-neutral-600">
          자산 {assets.length}종 중에서 고른다. 워스트오브는 여기 적은 기준가격을
          분모로 계산된다.
        </p>
      )}

      {/*
        배열 오류 중 행에 붙지 않는 것(`underlyings` 자체)은 `FormMessage`가 아니라
        여기 온다 — V-02의 「1개 이상」이 그 형태다.
      */}
      {state.fieldErrors.underlyings != null && (
        <p className="text-sm text-red-700">{state.fieldErrors.underlyings}</p>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((index) => (
          /*
           * `key`에 기본값을 함께 넣는다 — 행 삭제가 뒤의 행을 앞으로 당기므로
           * 같은 인덱스에 다른 자산이 온다. 인덱스만 키로 쓰면 `useState`가 초기값을
           * 다시 읽지 않아 **선택이 지워진 행에 남는다.**
           */
          <UnderlyingRow
            key={`${index}:${state.values[path('underlyings', index, UNDERLYING_SUBS[0])] ?? ''}`}
            index={index}
            assets={assets}
            values={state.values}
            fieldErrors={state.fieldErrors}
            removable={count > 1}
          />
        ))}
      </ul>

      {count < MAX_UNDERLYINGS && (
        <div>
          <button
            type="submit"
            name="intent"
            value="ADD_UNDERLYING"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
          >
            + 기초자산 추가
          </button>
        </div>
      )}
    </div>
  )
}
