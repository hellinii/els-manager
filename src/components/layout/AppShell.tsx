import Link from 'next/link'

import { PATHS } from '@/lib/routes/paths'

import { BottomTabs, TopNav } from './Nav'

/**
 * 앱 셸 — DOC-008 §3 주 네비게이션 · §8 반응형 대응
 *
 * ## 루트 레이아웃이 아니라 `(app)` 그룹의 레이아웃이다
 *
 * SCR-001에는 셸이 없어야 한다 — 미인증 사용자에게 「상품」·「세금」 탭을 보여주면
 * 누를 수 있는 것처럼 보이고 누르면 프록시가 다시 로그인으로 되돌린다.
 * 그런데 **서버 레이아웃은 자기 아래 어느 경로가 렌더되는지 모르므로**
 * (레이아웃은 경로 간에 재사용된다) 루트에 두고 `/login`만 빼는 방법이 없다.
 * 라우트 그룹은 URL을 바꾸지 않으면서 그 경계를 만든다.
 *
 * 그래서 이 파일의 존재 자체가 단언 대상이다 — `tests/e2e/shell.test.ts`가
 * `/login` HTML에 탭 라벨이 **없음**을 확인한다. 루트 레이아웃으로 옮기면 그
 * 단언이 빨간불이 된다.
 *
 * ## 서버 컴포넌트다
 *
 * 상호작용은 `Nav.tsx`(활성 탭)에만 있다. 셸을 클라이언트로 만들면 그 아래 모든
 * 화면이 클라이언트 트리 안에 놓이고, `lib/db` 조회 계약이 번들에 실린다.
 */

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={PATHS.home}
            className="text-base font-semibold tracking-tight"
          >
            언제들어오나
          </Link>
          <TopNav />
        </div>
      </header>

      {/*
        `pb-20`은 하단 탭이 `fixed`라서 필요하다 — 문서 흐름에서 빠지므로 마지막
        항목이 탭 뒤에 숨는다. 데스크톱에서는 탭이 없으므로 `lg:pb-8`로 되돌린다.
      */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-20 lg:pb-8">
        {children}
      </main>

      <BottomTabs />
    </div>
  )
}
