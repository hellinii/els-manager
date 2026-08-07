import Link from 'next/link'

import { INPUT_CLASS } from '@/components/form/Field'
import { KI_STATUS_LABELS, STATUS_LABELS } from '@/lib/format'
import {
  FILTER_KEYS,
  OWNER_ALL,
  OWNER_MINE,
  type ProductFilter,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-201의 필터·정렬 — **서버 폼이다** (DOC-008 §5 「필터(소유자 / 상태 / KI 상태),
 * 정렬(평가일 / 원금 / D-Day)」)
 *
 * ## `<form method="GET">`이고 `'use client'`가 아니다
 *
 * 상태가 URL에 있으므로 하이드레이션 전에도 동작하고 주소가 공유 가능하다.
 * 후자가 설계상 필요하다 — SQ-01이 SCR-501을 만들지 않은 근거가 「소유자 필터가
 * 사용자 현황 화면을 대체한다」이므로, 소유자 선택이 주소로 표현되지 않으면 그
 * 대체가 성립하지 않는다(§7.4가 그린 전이가 링크다).
 *
 * 대가는 **「적용」 버튼**이다. 선택 즉시 재조회하려면 `onChange`가 필요하고 그것은
 * 클라이언트 컴포넌트다. 버튼 하나로 JS 비의존을 사는 편이 이 규모(사용자 3명)에서
 * 맞는 교환이며, 같은 판단을 SCR-302의 줄별 폼에서도 했다.
 *
 * ## 정렬 선택지가 **둘**이다 — 문서의 셋이 둘로 줄어든다 (U-03)
 *
 * DOC-008은 「평가일 / 원금 / D-Day」 셋을 적었다. 그런데 계약의 두 값이 **같은
 * 순서를 만든다** — `dDay = 평가일 − 기준일`이고 기준일은 요청당 상수이므로
 * D-Day 오름차순은 평가일 오름차순과 동일하다(`products.ts`의 `sortItems`가
 * 두 값을 한 분기에 둔 이유). 선택지로 둘을 나란히 두면 **존재하지 않는 구분**을
 * 사용자에게 제시하게 된다.
 *
 * 파서는 셋 다 받는다(`?sortBy=D_DAY` 링크가 살아 있어야 한다). 없는 것은
 * 「고를 수 있는 항목」뿐이다. 근거는 DOC-008 §5 SCR-201 각주에 등재했다.
 */

const SORT_LABELS = {
  EVALUATION_DATE: '평가일 임박 순',
  PRINCIPAL: '투자원금 큰 순',
} as const

export type OwnerOption = { id: string; name: string }

export function ProductFilters({
  filter,
  owners,
}: {
  filter: ProductFilter
  /**
   * 고를 수 있는 소유자. **좁히지 않은 목록에서 나온다** — 필터가 자기 선택지를
   * 지우면 다른 소유자로 되돌아갈 길이 사라진다(`page.tsx`의 두 번째 조회).
   */
  owners: readonly OwnerOption[]
}) {
  return (
    <form
      method="GET"
      action={PATHS.products}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          ★ 소유자만 **빈 값의 뜻이 다르다** (v2.6). 다른 셋은 「빈 값 = 좁히지
          않음 = 전체」인데, 소유자는 **빈 값이 「내 상품」**이고 전체는 `ALL`이라는
          고른 값이다 — 그것이 DOC-008 §5 SCR-201 ★가 정한 기본값이다. 그래서
          `emptyLabel`이 「전체」가 아니라 「내 상품」이고 「전체」가 항목으로 온다.

          **자기 자신은 `owners`에 없다** — `page.tsx`의 `ownersOf`가 뺀다. 두면
          같은 뜻의 항목이 둘이 되고 어느 것이 지금 상태인지 사용자가 알 수 없다.
        */}
        <Select
          name={FILTER_KEYS.owner}
          label="소유자"
          value={filter.owner === OWNER_MINE ? '' : filter.owner}
          options={[
            [OWNER_ALL, '전체'],
            ...owners.map((owner): readonly [string, string] => [owner.id, owner.name]),
          ]}
          emptyLabel="내 상품"
        />
        <Select
          name={FILTER_KEYS.status}
          label="상태"
          value={filter.status ?? ''}
          options={Object.entries(STATUS_LABELS)}
        />
        <Select
          name={FILTER_KEYS.kiStatus}
          label="KI 상태"
          /*
           * 다섯 값 전부다 — AQ-24 해결. `KI_STATUS_LABELS`가
           * `Record<KiStatus, string>`이므로 도메인 열거값이 늘면 선택지도 함께
           * 는다. 여기서 값을 손으로 적으면 그 강제가 사라지고, AQ-24가 바로
           * 그렇게 생긴 비대칭이었다.
           */
          value={filter.kiStatus ?? ''}
          options={Object.entries(KI_STATUS_LABELS)}
        />
        <Select
          name={FILTER_KEYS.sortBy}
          label="정렬"
          value={filter.sortBy}
          options={Object.entries(SORT_LABELS)}
          /* 정렬에는 빈 값이 없다 — 순서는 언제나 하나로 정해진다 */
          emptyLabel={null}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          적용
        </button>
        {/*
          초기화는 버튼이 아니라 **링크**다. 폼을 비우는 자바스크립트 없이
          「필터 없는 주소」로 이동하는 것이 같은 결과이고, 그편이 주소가 상태라는
          사실과 일치한다.
        */}
        <Link href={PATHS.products} className="text-sm text-neutral-600 underline">
          초기화
        </Link>
      </div>
    </form>
  )
}

function Select({
  name,
  label,
  value,
  options,
  emptyLabel = '전체',
}: {
  name: string
  label: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  /**
   * **빈 값(`value=""`)의 라벨**이다. `null`이면 그 항목을 두지 않는다.
   *
   * ★ 이름이 `allLabel`이었는데 v2.6에서 고쳤다 — 소유자 축에서 **빈 값이 「전체」가
   * 아니라 「내 상품」**이 되면서 그 이름이 거짓이 됐다. 한 낱말이 두 뜻을 갖는 것이
   * 이 컷이 고치는 결함 자체이므로 같은 형태를 컴포넌트에 남기지 않는다.
   */
  emptyLabel?: string | null
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {/*
        `defaultValue`가 아니라 `value` + `readOnly`가 아니다 — 서버 컴포넌트가
        렌더하는 제어되지 않는 `<select>`이므로 `defaultValue`가 맞다. 파싱 결과를
        넘기므로 인식하지 못한 주소값은 자동으로 「전체」로 표시된다.
      */}
      <select name={name} defaultValue={value} className={INPUT_CLASS}>
        {emptyLabel != null && <option value="">{emptyLabel}</option>}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
