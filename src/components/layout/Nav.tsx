'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  MORE_ITEMS,
  MORE_LABEL,
  NAV_ITEMS,
  isMoreActive,
  isNavActive,
  type NavItem,
} from '@/lib/routes/paths'

/**
 * 주 네비게이션 — DOC-008 §3 · §8 반응형 대응
 *
 * **셸의 유일한 클라이언트 경계다.** `usePathname`이 활성 탭을 정하는데 서버
 * 레이아웃은 경로를 모른다(레이아웃은 경로 간에 재사용되므로 Next가 주지 않는다).
 * 판정 자체는 `lib/routes/paths.ts`의 순수 함수에 있고 여기 남은 것은 배선뿐이다.
 *
 * ## 두 벌을 렌더하고 CSS로 고른다
 *
 * DOC-008 §8: 모바일·태블릿(~1023px)은 하단 탭, 데스크톱(1024px~)은 상단 메뉴다.
 * 그 경계는 Tailwind의 `lg`(1024px)와 **정확히 일치**하므로 커스텀 브레이크포인트를
 * 만들지 않는다. 두 벌을 다 렌더하는 이유는 서버가 화면 폭을 모르기 때문이다 —
 * 조건부로 하나만 보내려면 클라이언트에서 폭을 재야 하고, 그러면 첫 페인트에
 * 내비게이션이 없다.
 *
 * ## 「더보기」는 라우트가 아니다
 *
 * DOC-008 §3이 대상 화면을 `—`로 둔 것을 그대로 지킨다. `<details>`로 펼치므로
 * **JS 없이 동작하고** 상태 훅이 필요 없다 — 하이드레이션 전에도 열린다.
 * 바깥 클릭으로 닫히지 않는 것은 대가로 받는다(닫는 방법은 다시 누르기·이동).
 */

const ITEM_BASE =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors'
const ITEM_IDLE = 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
const ITEM_ACTIVE = 'bg-neutral-900 text-white'

const TAB_BASE =
  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors'
const TAB_IDLE = 'text-neutral-500'
const TAB_ACTIVE = 'text-neutral-900'

function MenuItems({ onSurface }: { onSurface: 'top' | 'bottom' }) {
  const pathname = usePathname()

  return (
    <div
      className={[
        'absolute right-0 z-20 min-w-40 rounded-md border border-neutral-200 bg-white p-1 shadow-lg',
        onSurface === 'top' ? 'top-full mt-1' : 'bottom-full mb-2',
      ].join(' ')}
    >
      {MORE_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isNavActive(pathname, item.href) ? 'page' : undefined}
          className="block rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 aria-[current=page]:font-semibold aria-[current=page]:text-neutral-900"
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

/** 데스크톱(1024px~) 상단 메뉴 */
export function TopNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="주 메뉴" className="hidden items-center gap-1 lg:flex">
      {NAV_ITEMS.map((item: NavItem) => {
        const active = isNavActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
          >
            {item.label}
          </Link>
        )
      })}

      <details className="relative">
        <summary
          className={`${ITEM_BASE} ${
            isMoreActive(pathname) ? ITEM_ACTIVE : ITEM_IDLE
          } cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          {MORE_LABEL}
        </summary>
        <MenuItems onSurface="top" />
      </details>
    </nav>
  )
}

/** 모바일·태블릿(~1023px) 하단 탭. 다섯 칸이 DOC-008 §3의 순서다. */
export function BottomTabs() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="주 메뉴"
      /*
       * `fixed`이므로 문서 흐름에서 빠진다 — 셸이 `<main>`에 같은 높이의 아래
       * 여백을 준다. 그러지 않으면 마지막 항목이 탭 뒤에 영원히 숨는다.
       * `safe-bottom`은 홈 인디케이터가 있는 기기에서 탭을 밀어 올린다.
       */
      className="safe-bottom fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white lg:hidden"
    >
      {NAV_ITEMS.map((item: NavItem) => {
        const active = isNavActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE}`}
          >
            {item.label}
          </Link>
        )
      })}

      <details className="relative flex flex-1">
        <summary
          className={`${TAB_BASE} ${
            isMoreActive(pathname) ? TAB_ACTIVE : TAB_IDLE
          } cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          {MORE_LABEL}
        </summary>
        <MenuItems onSurface="bottom" />
      </details>
    </nav>
  )
}
