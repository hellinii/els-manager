'use client'

import { useState } from 'react'

import { Field, INPUT_CLASS } from '@/components/form/Field'
import type { AssetOption } from '@/lib/db/queries/prices'
import { narrowAssets } from '@/lib/forms/assets'
import { path } from '@/lib/forms/fieldPath'
import { UNDERLYING_SUBS } from '@/lib/forms/steps'

/**
 * ② 기초자산 한 행 — 자산 선택 + 기준가격 (SCR-204, DOC-008 §5)
 *
 * ## 자동완성은 **전량 + 클라이언트 필터**다
 *
 * DOC-011 §1.2가 「조회를 서버 액션으로 감싸지 않는다」고 못 박았으므로 타이핑마다
 * 서버에 묻는 경로가 없다. 그래서 서버 컴포넌트가 `searchAssets('')`로 전량을 실어
 * 보내고 여기서 좁힌다 — A-01 규모(자산 수십 종)에서 즉시성도 더 낫다. 계약의 빈
 * 질의가 「전량」이 된 것이 이 결정의 짝이다(§4.9 v1.5).
 *
 * ## 선택된 자산은 **항상** 목록에 남는다
 *
 * 필터가 선택된 항목을 숨기면 `<select>`의 값이 조용히 다른 자산으로 바뀐다 —
 * 사용자는 검색어를 지웠을 뿐인데 기초자산이 달라지고, 그 결과는 저장 후 상세
 * 화면에서야 보인다. 그래서 선택값을 상태로 들고 **필터 결과에 합집합**으로 넣는다.
 * 「검색은 표시를 좁히고 값을 바꾸지 않는다」가 이 컴포넌트의 유일한 불변식이다.
 *
 * ## `key`가 행의 정체다
 *
 * 행 삭제는 뒤의 행을 앞으로 당기므로(`removeRow`) 같은 인덱스에 다른 자산이 온다.
 * `useState`는 prop이 바뀌어도 초기값을 다시 읽지 않으므로, 부모가 `key`에 기본값을
 * 함께 넣어 그때 다시 마운트되게 한다(`ProductForm`의 각주).
 */

export function UnderlyingRow({
  index,
  assets,
  values,
  fieldErrors,
  removable,
}: {
  index: number
  assets: readonly AssetOption[]
  values: Record<string, string>
  fieldErrors: Record<string, string>
  /** 마지막 한 행은 지울 수 없다(V-02) — 버튼 자체를 내지 않는다(ST-04와 같은 규율) */
  removable: boolean
}) {
  const assetName = path('underlyings', index, UNDERLYING_SUBS[0])
  const priceName = path('underlyings', index, UNDERLYING_SUBS[1])

  const [selected, setSelected] = useState(values[assetName] ?? '')
  const [query, setQuery] = useState('')

  // 좁힘은 순수 함수다 — 「선택된 항목은 항상 남는다」를 상시 스위트가 본다.
  const shown = narrowAssets({ assets, query, selected })
  const chosen = assets.find((asset) => asset.id === selected) ?? null

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        {/*
          한 문자열로 렌더한다 — `{a} {b}`는 자식이 셋이 되어 React가 사이에 빈
          주석을 넣으므로 HTML에 `기초자산 1`이 존재하지 않는다(실측으로 걸렸다).
        */}
        <span className="text-sm font-medium">{`기초자산 ${index + 1}`}</span>
        {removable && (
          /*
           * 삭제도 **제출**이다. `onClick`으로 배열을 줄이면 JS 없이 동작하지 않고,
           * 무엇보다 그 전이를 어느 스위트도 보지 못한다(AQ-32) — `removeRow`는
           * 순수 함수이므로 상시 스위트가 전수로 본다.
           */
          <button
            type="submit"
            name="intent"
            value={`REMOVE_UNDERLYING:${index}`}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
          >
            이 행 삭제
          </button>
        )}
      </div>

      {/*
        검색 칸에는 `name`이 없다 — 제출되지 않아야 한다. 이름을 주면 값 맵에
        들어오고(`transition`이 폼의 이름만 남기므로 실제로는 버려지지만) 계약
        입력과 같은 자리에 화면의 도구가 섞인다.
      */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">자산 찾기</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름의 일부를 적으면 아래 목록이 좁아진다"
          className={INPUT_CLASS}
        />
      </label>

      <Field name={assetName} label="자산" error={fieldErrors[assetName]}>
        {(props) => (
          <select
            {...props}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">선택</option>
            {shown.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
                {asset.market == null ? '' : ` · ${asset.market}`}
              </option>
            ))}
          </select>
        )}
      </Field>

      {shown.length !== assets.length && (
        <p className="text-xs text-neutral-500">
          {shown.length}종 표시 중 (전체 {assets.length}종)
        </p>
      )}

      <Field
        name={priceName}
        label="기준가격"
        error={fieldErrors[priceName]}
        hint={
          chosen == null
            ? '발행 시점에 확정된 가격이다. 등락률 계산의 분모다'
            : `${chosen.currency} · ${
                chosen.hasPriceProvider ? '자동 조회 가능' : '시세는 수동 입력'
              }`
        }
      >
        {(props) => (
          <input
            {...props}
            type="text"
            inputMode="decimal"
            defaultValue={values[priceName] ?? ''}
            placeholder="예: 2489.55"
            className={INPUT_CLASS}
          />
        )}
      </Field>
    </li>
  )
}
