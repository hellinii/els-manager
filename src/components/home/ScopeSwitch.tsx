import Link from 'next/link'

import { dashboardQuery, type DashboardScope } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * 표시 범위 전환 — **두 링크다** (DOC-008 §5 SCR-101, P4 컷 9)
 *
 * SCR-201·301의 필터는 `<select>` + 「적용」인데 여기는 링크다. 축이 하나이고 값이
 * 둘이므로 선택 상자는 클릭을 하나 더 요구하고 「적용」 버튼은 두 값 사이의 이동을
 * 제출로 만든다. JS 없이 동작하고 주소가 공유 가능하다는 성질은 같다 — 같은 근거의
 * 같은 결론이며 표현만 다르다.
 *
 * **기본값은 주소에 싣지 않는다**(`dashboardQuery`). 「내 상품」으로 돌아가는 링크가
 * `/?scope=MINE`이 아니라 `/`이므로, 공유된 링크가 어느 쪽이든 같은 화면이 된다.
 *
 * ## 이 컨트롤이 빈 상태의 절반을 진다
 *
 * 기본 범위가 본인이므로(SQ-03) 홈은 **처음부터 좁혀진 상태**다. 「내 상품이 없다」가
 * 좁힘의 결과임을 사용자가 알아야 하고, 그 사실을 말하는 것이 빈 상태의 문구가
 * 아니라 **목록 위에 항상 렌더되는 이 컨트롤**이다(SCR-201의 필터가 같은 자리에 있는
 * 것과 같은 이유).
 */

const SCOPE_LABELS: Record<DashboardScope, string> = {
  MINE: '내 상품',
  ALL: '전체',
}

export function ScopeSwitch({ scope }: { scope: DashboardScope }) {
  return (
    <nav
      aria-label="표시 범위"
      className="inline-flex rounded-md border border-neutral-300 p-0.5 text-sm"
    >
      {(Object.keys(SCOPE_LABELS) as DashboardScope[]).map((value) => {
        const active = value === scope
        return (
          <Link
            key={value}
            href={`${PATHS.home}${dashboardQuery(value)}`}
            /*
             * 현재 위치를 색으로만 말하지 않는다 — SQ-05의 근거가 「색이 의미를
             * 나른다」였으므로 그 역도 지킨다(색이 유일한 전달 수단이 되면 안 된다).
             *
             * **`"page"`가 아니라 `"true"`다.** 두 링크는 같은 화면의 다른 상태이지
             * 다른 페이지가 아니며(주소의 질의만 다르다), `"page"`는 주 네비게이션의
             * 활성 탭이 쓰는 값이다 — `tests/e2e/shell.test.ts`가 그 표식으로 활성
             * 탭을 세므로 여기서 같은 값을 쓰면 그 단언이 **잘못된 이유로** 깨진다
             * (실측으로 걸렸다: 홈에서 활성 표식이 2건이 아니라 3건이 되었다).
             */
            aria-current={active ? 'true' : undefined}
            className={`rounded px-3 py-1 transition-colors ${
              active
                ? 'bg-neutral-900 font-medium text-white'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {SCOPE_LABELS[value]}
          </Link>
        )
      })}
    </nav>
  )
}
