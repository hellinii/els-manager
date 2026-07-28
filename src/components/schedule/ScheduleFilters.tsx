import Link from 'next/link'

import { INPUT_CLASS } from '@/components/form/Field'
import type { OwnerOption } from '@/components/products/ProductFilters'
import {
  SCHEDULE_KEYS,
  type ScheduleFilter,
  type ScheduleRange,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-301의 필터 — **SCR-201과 같은 형태다** (`<form method="GET">`, 「적용」 버튼,
 * 링크로 된 초기화)
 *
 * 계획 §4가 이 컷을 「201의 어휘를 거의 그대로 재사용」으로 적은 자리이며, 같은
 * 이유가 여기서도 성립한다 — 상태가 URL에 있으므로 JS 없이 동작하고 주소가 공유
 * 가능하다. 소유자 축은 **같은 질의 키**를 쓴다(`SCHEDULE_KEYS.ownerId`가
 * `FILTER_KEYS.ownerId`를 가리킨다).
 *
 * ## 축 셋 중 둘이 문서에 있고 하나는 이 컷이 더했다
 *
 * DOC-008 §5는 「소유자 / 미상환만 보기」를 적었고 **기간**은 v0.8이 더한 것이다.
 * 더한 이유는 그 문서가 요구한 「과거/미래 구분」이 구획(두 절)으로 실현되면서,
 * 「과거만 / 미래만 보기」가 그 구획의 자연스러운 축이 되었기 때문이다. 기본값이
 * `ALL`이므로 **기본 화면은 아무것도 좁히지 않는다** — 그것이 구분을 기본으로
 * 보이게 하는 조건이다.
 *
 * ## 정렬 선택지가 없다
 *
 * 이 화면의 목적이 「시간 순으로 조망」이므로 순서가 하나로 정해진다(계약이 준
 * 평가일 오름차순). SCR-201의 정렬 셋이 둘로 좁혀진 것과 같은 판단의 극단이며,
 * 고를 것이 하나뿐인 선택 상자를 두지 않는다.
 */

const RANGE_LABELS: Record<ScheduleRange, string> = {
  ALL: '전체 기간',
  UPCOMING: '다가오는 평가일',
  PAST: '지난 평가일',
}

export function ScheduleFilters({
  filter,
  owners,
}: {
  filter: ScheduleFilter
  /** 좁히지 않은 조회에서 나온다 — 필터가 자기 선택지를 지우지 않게(SCR-201과 같다) */
  owners: readonly OwnerOption[]
}) {
  return (
    <form
      method="GET"
      action={PATHS.schedule}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">소유자</span>
          <select
            name={SCHEDULE_KEYS.ownerId}
            defaultValue={filter.ownerId ?? ''}
            className={INPUT_CLASS}
          >
            <option value="">전체</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">기간</span>
          {/*
            「전체」가 기본값이므로 별도의 「전체」 선택지를 앞에 두지 않는다 —
            SCR-201의 필터는 「선택 안 함 = 전체」인데 여기서는 전체가 하나의 값이다.
            둘을 같은 모양으로 만들면 빈 값과 `ALL`이 같은 뜻인 축이 생긴다.
          */}
          <select
            name={SCHEDULE_KEYS.range}
            defaultValue={filter.range}
            className={INPUT_CLASS}
          >
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {/*
          체크박스다 — 「미상환만 보기」는 켜고 끄는 하나의 조건이므로 선택 상자로
          두면 「전체 / 미상환만」 두 항목을 읽게 만든다. 부재가 곧 `false`이고
          파서가 그 규약을 그대로 쓴다.
        */}
        <label className="flex items-center gap-2 sm:mt-6">
          <input
            type="checkbox"
            name={SCHEDULE_KEYS.activeOnly}
            defaultChecked={filter.activeOnly}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <span className="text-sm">미상환만 보기</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          적용
        </button>
        <Link href={PATHS.schedule} className="text-sm text-neutral-600 underline">
          초기화
        </Link>
      </div>
    </form>
  )
}
