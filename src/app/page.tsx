import { signOutAction } from './(auth)/actions'

/**
 * 임시 랜딩 — SCR-101(홈)이 컷 9에서 대체한다.
 *
 * 지금 여기 있는 것은 **로그아웃뿐이다.** 화면을 만드는 컷이 아니라 인증 고리를
 * 닫는 컷이므로 조회 계약을 부르지 않는다.
 *
 * ## 로그아웃이 왜 지금 있는가
 *
 * DOC-008은 로그아웃을 SCR-502에 두었지만 그것은 **버튼의 위치**에 대한 것이지
 * 기능의 시점이 아니다. 없으면 미인증 상태로 가는 방법이 브라우저에서 쿠키를
 * 지우는 것뿐이라 프록시 리다이렉트와 SCR-001을 P4 내내 확인할 수 없다.
 * 그리고 **쿠키 삭제 경로의 유일한 소비자**다 — 갱신은 값을 덮어쓰지만 삭제는
 * 빈 값을 싣는 다른 경로이고, 그것이 깨지면 브라우저가 죽은 쿠키를 계속 보낸다.
 */

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">언제들어오나</h1>
        <p className="mt-2 text-sm text-neutral-600">
          로그인되어 있다. 화면은 P4에서 차례로 선다.
        </p>
      </div>

      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
        >
          로그아웃
        </button>
      </form>
    </main>
  )
}
