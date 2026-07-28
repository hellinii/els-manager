import { AppShell } from '@/components/layout/AppShell'

/**
 * 인증 구역의 레이아웃 — 셸이 여기에만 걸린다.
 *
 * `(app)`은 라우트 그룹이므로 **URL에 나타나지 않는다.** `(app)/page.tsx`가
 * 여전히 `/`이고 `(app)/products/page.tsx`가 `/products`다. 그룹을 쓰는 유일한
 * 이유는 `(auth)/login`을 셸 **밖**에 두는 것이다 — 근거는 `AppShell`의 docblock.
 *
 * 여기서 인증을 검사하지 않는다. `src/proxy.ts`가 미인증 요청을 렌더 전에
 * 돌려보내므로(선행 조건 ②) 레이아웃에서 다시 판정하면 같은 판단이 두 곳에
 * 생기고, 둘이 갈리면 어느 쪽이 정본인지 알 수 없게 된다.
 */

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>
}
