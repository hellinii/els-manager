import { signOutAction } from '@/app/(auth)/actions'

/**
 * SCR-502 설정 — 축소판. 온전한 화면은 컷 10에서 선다.
 *
 * 자리표시가 아니라 **동작하는 부분이 하나 있는 화면**이다: 로그아웃. 컷 0b가
 * 그것을 홈에 임시로 둔 것은 화면이 하나뿐이어서였고, DOC-008 §5 SCR-502가
 * 처음부터 정한 자리가 여기다. 셸에 「더보기 → 설정」이 생긴 지금 옮긴다.
 *
 * **지우면 안 되는 이유는 그대로다.** 미인증 상태로 가는 유일한 수단이고
 * (없으면 프록시 게이트와 SCR-001을 손으로 확인할 방법이 브라우저 쿠키 삭제뿐이다)
 * **쿠키 삭제 경로의 유일한 소비자**다 — 갱신은 값을 덮어쓰지만 삭제는 빈 값을
 * 싣는 다른 경로이고, 그것이 깨지면 브라우저가 죽은 쿠키를 계속 보낸다.
 *
 * 컷 10이 더하는 것: 앱 정보·면책 고지. 표시명 변경은 v1에서 보류했다
 * (DOC-008 §5 U-03 — DB는 허용하나 DOC-011 §5에 계약이 없다).
 */

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs text-neutral-400">SCR-502</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">설정</h1>
        <p className="mt-2 text-sm text-neutral-600">
          앱 정보와 면책 고지는 컷 10에서 더한다.
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
    </section>
  )
}
