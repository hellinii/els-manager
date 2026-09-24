'use client'

import { useActionState } from 'react'

import { AssetForm } from '@/components/prices/AssetForm'
import { Field, INPUT_CLASS, hintWith } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { ConditionStep } from '@/components/products/ConditionStep'
import { UnderlyingRow } from '@/components/products/UnderlyingRow'
import type { AssetOption } from '@/lib/db/queries/prices'
import { ACCOUNT_TYPE_LABELS } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import { initialFormState, type FormState } from '@/lib/forms/state'
import {
  MAX_UNDERLYINGS,
  PRODUCT_ID_FIELD,
  UNDERLYING_SUBS,
  roundCountOf,
  rowCountOf,
  type RowCounts,
} from '@/lib/forms/productForm'

/**
 * SCR-204 ELS 등록 — **단일 페이지 폼** (DOC-008 §5·§7.1 v1.8, P6 컷 1)
 *
 * ## 단계 분리를 철회했다
 *
 * v0.5부터 이 화면은 네 단계였고 현재 단계가 `step` 히든 필드에 있었다. 실사용
 * 11건이 그 설계를 뒤집었다 — 반복이 측정값으로 있고(기초자산 조합 5회 · 발행일
 * 3회 · 배리어 세트 4회 재입력) 단계형은 「어느 칸이 어느 단계에 있는가」를
 * 기억하게 만들어 왕복을 늘렸다. 근거 전체는 DOC-008 §5 SCR-204의 각주에 있다.
 *
 * 사라진 것: `StepNav`(①②③④) · 이전·다음 버튼 · `ConfirmStep`(④ 확인) ·
 * **히든 이송 전체**(`carryNames`). 마지막이 가장 크다 — 모든 칸이 동시에
 * 렌더되므로 전부 진짜 컨트롤이고 전부 제출된다. 「선언은 했는데 이송을 빠뜨려
 * 조용히 값이 사라지는」 상태가 존재할 수 없다.
 *
 * 남은 것: 행 추가 · 행 삭제 · 배리어 일괄 적용이 **제출**이라는 것. 그것이
 * v0.5의 근거 중 철회되지 않은 절반이다(JS 없이 동작한다 — 컷 1b 실측).
 *
 * ## 구획은 남기고 번호는 빼다
 *
 * 65줄짜리 폼에 구분이 없으면 「한눈에」가 「어디가 어딘지 모르겠다」가 된다. 그래서
 * `<section>` 셋에 제목을 둔다. **번호(①②③④)는 붙이지 않는다** — 번호는 「이
 * 순서로 지나야 한다」를 뜻하고 그것이 철회된 것이다.
 *
 * ## 자산 등록 폼은 이 폼의 **형제**다
 *
 * HTML은 폼 중첩을 허용하지 않는다. 그래서 `AssetForm`(§5.10, SCR-302의 그것)을
 * `<form>` 바깥에 두고 **기초자산 구획 아래에 항상 둔다**(종전에는 ② 단계에서만
 * 보였다). 「고를 자산이 없다」의 다음 행동이 그 자리에 있어야 하기 때문이다
 * (ST-02, DOC-008 §5 SCR-302 v0.3이 순환을 끊은 것과 같은 이유).
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
 * `action`. **v1.8에서 그 「같다」가 더 강해졌다** — 단계 기계가 사라져 두 모드가
 * 구조적으로 동일하다(수정은 원래 처음부터 완전한 폼이었으므로 단계로 쪼개는 것이
 * 이득이 없었다).
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
  fieldNotes,
}: {
  assets: readonly AssetOption[]
  /** 이 폼을 받는 어댑터. 등록은 `productFormAction`, 수정은 `productEditFormAction` */
  action: (prev: FormState, form: FormData) => Promise<FormState>
  /** 등록은 `productDefaults()`, 수정은 `productValuesOf(view)` */
  initialValues: Record<string, string>
  /** 수정 모드에서만 있다. 히든으로 실려 어댑터가 대상을 안다 */
  productId?: string
  /**
   * 불러오기(S-12)가 스칼라 칸에 붙이는 안내 — 그 칸의 힌트 뒤에 덧붙는다(DOC-008 v2.9).
   * 배열 행에는 붙이지 않는다 — 행은 사용자가 지우면 번호가 밀린다.
   */
  fieldNotes?: Readonly<Record<string, string>>
}) {
  const [state, formAction] = useActionState(action, initialFormState(initialValues))

  const values = state.values
  const counts: RowCounts = {
    underlyings: rowCountOf(values, 'underlyings'),
    rounds: roundCountOf(values),
  }

  return (
    <section className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6" noValidate>
        <FormMessage state={state} />

        {/*
          대상 id — **상태가 아니라 props에서 나온다.** `transition`이 값을 계약 입력의
          이름으로 좁히므로 이 칸은 상태에 남지 않고, 그것이 의도다: id의 정본은
          라우트 하나다(`PRODUCT_ID_FIELD`의 각주).
        */}
        {productId != null && (
          <input type="hidden" name={PRODUCT_ID_FIELD} value={productId} />
        )}

        <FormSection title="기본 정보">
          <BasicFields state={state} fieldNotes={fieldNotes} />
        </FormSection>

        <FormSection title="기초자산">
          <UnderlyingFields
            assets={assets}
            state={state}
            count={counts.underlyings}
          />
        </FormSection>

        <FormSection title="평가 조건">
          <ConditionStep state={state} fieldNotes={fieldNotes} />
        </FormSection>

        <div className="flex flex-wrap gap-2">
          {/*
            DOC-008 §6은 SCR-204의 로딩 상태를 「저장 중」으로 규정한다. `useFormStatus`가
            폼의 자손에서만 동작하므로 `SubmitButton`이 별 컴포넌트다 — 두 번 누르면
            상품이 둘 생긴다(§5.1에 멱등성이 없다 — DOC-010 AQ-62).
          */}
          <SubmitButton
            label="저장"
            pendingLabel="저장 중…"
            name="intent"
            value="SUBMIT"
          />
        </div>
      </form>

      {/*
        형제 폼이며 **항상 보인다**(종전에는 ② 단계에서만 보였다). 접혀 있으므로
        처음 등록하는 사용자에게 방해가 되지 않고, 「고를 자산이 없다」의 다음 행동이
        폼을 떠나지 않고 그 자리에 있다.
      */}
      <details className="rounded-lg border border-neutral-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          고를 자산이 없다 — 자산 등록
        </summary>
        <p className="mt-2 text-xs text-neutral-500">
          등록하면 위 「기초자산」의 목록에 나타난다. 시세는 「시세 관리」에서 입력한다.
        </p>
        <div className="mt-4 max-w-sm">
          <AssetForm />
        </div>
      </details>
    </section>
  )
}

/**
 * 구획 — 제목만 있고 번호가 없다.
 *
 * 번호(①②③④)를 붙이면 「이 순서로 지나야 한다」를 뜻하고 그것이 v1.8에서 철회된
 * 것이다. 구분 자체는 남긴다 — 차수가 많은 상품은 폼이 길어지고, 구분이 없으면
 * 「한눈에」가 「어디가 어딘지 모르겠다」가 된다.
 */
function FormSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-neutral-200 pb-2 text-sm font-semibold text-neutral-900">
        {title}
      </h2>
      {children}
    </section>
  )
}

type StepProps = { state: FormState; fieldNotes?: Readonly<Record<string, string>> }

/** 기본 정보 — DOC-008 §5의 입력 항목 + 비고(아래 각주) */
function BasicFields({ state, fieldNotes }: StepProps) {
  const { values, fieldErrors } = state

  return (
    <div className="flex flex-col gap-4">
      <Field
        name="name"
        label="상품명"
        error={fieldErrors.name}
        hint={hintWith(undefined, fieldNotes, 'name')}
      >
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
        <Field
          name="issuer"
          label="발행사"
          error={fieldErrors.issuer}
          hint={hintWith('선택', fieldNotes, 'issuer')}
        >
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
          hint={hintWith('평가일 산식의 기준이다', fieldNotes, 'issueDate')}
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
              // `key`가 `defaultValue`와 같은 식이다 — AQ-64. 비제어 `<select>`는
              // 마운트 때만 `selected` 속성을 얻으므로 서버 값이 바뀌어도 표시가
              // 따라오지 않고, 제출마다 도는 자동 폼 초기화가 그 낡은 속성으로
              // 되돌린다(표시는 「선택」이 되고 내부 값만 남는다).
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

/** 기초자산 — 행 추가로 N종 */
function UnderlyingFields({
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
          등록된 기초자산이 없다. 아래 「고를 자산이 없다 — 자산 등록」으로 먼저 등록한다.
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
