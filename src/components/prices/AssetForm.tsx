'use client'

import { useActionState } from 'react'

import { createAssetAction } from '@/app/(app)/prices/actions'
import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { ASSET_TYPE_LABELS } from '@/lib/format'
import { assetDefaults } from '@/lib/forms/defaults'
import { initialFormState } from '@/lib/forms/state'

/**
 * 자산 등록 — §5.10. **DOC-008 §5 SCR-302가 v0.3에서 이 화면에 넣은 요소다**
 *
 * 종전에는 `createAsset`이 SCR-204(상품 등록)의 자동완성에만 있었다. 그러면 이
 * 화면의 빈 상태가 **순환한다** — 빈 상태는 「등록된 기초자산 없음」이고 ST-02는
 * 다음 행동을 요구하는데, 그 행동이 "상품을 등록하세요"가 되고 상품 등록은 다시
 * 기초자산 선택을 요구한다. DOC-011 §8 v1.2가 배정을 넓혀 닫았다.
 *
 * `assetType`에 기본 선택이 없다 — 셋 중 하나를 고르는 것이 등록의 실제 결정이고,
 * 기본값을 주면 「지수」를 「종목」으로 등록하는 실수가 조용히 통과한다.
 */

export function AssetForm() {
  const [state, formAction] = useActionState(
    createAssetAction,
    initialFormState(assetDefaults()),
  )

  return (
    <form action={formAction} className="flex flex-col gap-3 text-left" noValidate>
      <FormMessage state={state} />

      <Field name="name" label="자산명" error={state.fieldErrors.name}>
        {(props) => (
          <input
            {...props}
            type="text"
            defaultValue={state.values.name ?? ''}
            placeholder="예: 코스피200"
            className={INPUT_CLASS}
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field name="assetType" label="유형" error={state.fieldErrors.assetType}>
          {(props) => (
            <select
              {...props}
              /*
               * `key`가 `defaultValue`와 같은 식이다 — AQ-64. 이 칸이 「연속으로
               * 자산을 등록하면 조용히 실패한다」의 원인이었다: 실패 응답은
               * `valuesOf(form)`으로 유형을 보존하는데 비제어 `<select>`가
               * remount되지 않아 자동 폼 초기화가 마운트 시점의 빈 값으로
               * 되돌렸고, 다음 제출이 `assetType=''`로 나가 같은
               * `VALIDATION_FAILED`(「입력값을 확인한다」)를 반복했다.
               *
               * 성공 응답은 값을 비우므로(`prices/actions.ts`) `key`가 그대로
               * 빈 값이고 초기화가 유형까지 비운다 — 그것이 의도된 동작이다.
               */
              key={state.values.assetType ?? ''}
              defaultValue={state.values.assetType ?? ''}
              className={INPUT_CLASS}
            >
              <option value="">선택</option>
              {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          name="currency"
          label="통화"
          error={state.fieldErrors.currency}
          hint="세 자리 대문자"
        >
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={3}
              defaultValue={state.values.currency ?? 'KRW'}
              className={`${INPUT_CLASS} uppercase`}
            />
          )}
        </Field>
      </div>

      <Field
        name="market"
        label="시장"
        error={state.fieldErrors.market}
        hint="선택. 비우면 시장 정보 없는 자산으로 한 번만 등록된다"
      >
        {(props) => (
          <input
            {...props}
            type="text"
            defaultValue={state.values.market ?? ''}
            placeholder="예: KRX"
            className={INPUT_CLASS}
          />
        )}
      </Field>

      <SubmitButton label="자산 등록" pendingLabel="등록 중…" />
    </form>
  )
}
