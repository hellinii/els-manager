import Link from 'next/link'

import {
  scheduleQuery,
  type ScheduleFilter,
  type ScheduleView,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * 보기 전환 — **두 링크다** (DOC-008 §5 SCR-301, P6 컷 6)
 *
 * `ScopeSwitch`(SCR-101)와 같은 근거의 같은 결론이다 — 축이 하나이고 값이 둘이므로
 * `<select>`는 클릭을 하나 더 요구하고 「적용」 버튼은 **두 표현 사이의 이동을
 * 제출로** 만든다. JS 없이 동작하고 주소가 공유 가능하다는 성질도 같다.
 *
 * ## 그쪽과 갈리는 지점 하나 — 현재 필터를 실어야 한다
 *
 * `dashboardQuery(scope)`는 축이 하나뿐이라 질의를 처음부터 조립하지만 여기는
 * 넷이다(`ownerId`·`range`·`activeOnly`·`view`). 나머지 셋을 잃으면 보기를 바꾸는
 * 순간 필터가 풀린다 — `pageQuery`가 같은 자리에서 같은 일을 한다(「페이지 링크가
 * 현재 필터를 함께 싣는다」). 그래서 `scheduleQuery(filter, view)`를 쓴다.
 *
 * ## 라벨 표를 여기 두는 이유
 *
 * `lib/format/labels.ts`의 `LABEL_AXES`에 넣으면 `tests/app/labels.test.ts`가
 * 「축 집합이 정확히 일치한다」로 DOC-005 §6.1과 대조하다 **실패한다** — 이것은
 * 계약의 열거값이 아니라 화면 지역의 표현 축이다. `SCOPE_LABELS`·`RANGE_LABELS`가
 * 이미 같은 이유로 컴포넌트 지역에 있다.
 */

const VIEW_LABELS: Record<ScheduleView, string> = {
  PRODUCT: '상품별',
  TIME: '시간순',
}

export function ViewSwitch({
  filter,
  view,
}: {
  filter: ScheduleFilter
  view: ScheduleView
}) {
  return (
    <nav
      aria-label="보기"
      className="inline-flex rounded-md border border-neutral-300 p-0.5 text-sm"
    >
      {(Object.keys(VIEW_LABELS) as ScheduleView[]).map((value) => {
        const active = value === view
        return (
          <Link
            key={value}
            href={`${PATHS.schedule}${scheduleQuery(filter, value)}`}
            /*
             * ★ **`"page"`가 아니라 `"true"`다.** 두 링크는 같은 화면의 다른
             * 상태이지 다른 페이지가 아니며, `tests/e2e/shell.test.ts`가
             * `aria-current="page"`로 **주 네비게이션의 활성 탭을 센다** —
             * 여기서 같은 값을 쓰면 그 단언이 잘못된 이유로 깨진다. `ScopeSwitch`가
             * 실측으로 그 함정에 걸렸다(홈의 활성 표식이 2건이 아니라 3건이 됐다).
             */
            aria-current={active ? 'true' : undefined}
            className={`rounded px-3 py-1 transition-colors ${
              active
                ? 'bg-neutral-900 font-medium text-white'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {VIEW_LABELS[value]}
          </Link>
        )
      })}
    </nav>
  )
}
