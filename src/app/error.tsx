'use client'

import Link from 'next/link'

import { errorNotice } from '@/lib/format/errorNotice'

/**
 * 시스템 오류 경계 — P4 선행 조건 ③ (DOC-000 §3)
 *
 * 조회 계약은 미존재에 `null`, **시스템 오류에 예외**를 쓴다(DOC-011 §3.1).
 * 받을 경계가 없으면 그 예외가 Next 기본 화면으로 나간다.
 *
 * ## 여기서 오류의 종류를 판별하지 않는다
 *
 * 이 파일은 클라이언트 컴포넌트이고 **프로덕션에서 `Error`가 redact된다** —
 * 메시지도 프로토타입도 사라지고 `digest`만 온다. 따라서
 * `error.message.includes(...)`도 `instanceof`도 쓸 수 없다. 개발에서는 동작하고
 * 운영에서만 조용히 무너지므로, 그런 코드는 애초에 두지 않는다.
 *
 * 미인증을 여기서 SCR-001로 보내려던 종전 구상이 그래서 성립하지 않는다.
 * **`src/proxy.ts`가 먼저 거른다** — 미인증 요청은 RSC 렌더에 도달하지 않는다.
 * 그러고도 Q-04 예외가 여기 왔다면 그것은 프록시가 놓쳤다는 신호이므로 일반
 * 오류로 보이는 편이 옳다. 삼켜서 로그인 화면으로 보내면 그 신호가 사라진다.
 *
 * ## 문구가 "잠시 후 다시 시도"만이 아닌 이유
 *
 * 이 경계에 오는 것 중에는 **Q-06 절단 예외**가 있다. 그것은 장애가 아니라
 * AQ-09(페이지네이션)를 닫으라는 의도적 신호다. 재시도를 권하는 문구만 두면
 * 그 신호가 "가끔 실패하는 화면"으로 읽히고 아무도 열어보지 않는다. 그래서
 * `digest`를 보여준다 — 서버 로그에서 같은 값을 찾을 수 있어야 신고가 성립한다.
 */

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  /*
   * 판단은 `lib/format/errorNotice.ts`에 있다 — AQ-38 (c). 이 파일은 어느 스위트도
   * 실행하지 않으므로(경계에 도달하는 경로가 없다) 분기를 여기 두면 아무도 보지 못한다.
   * 그래서 남은 것은 «렌더»뿐이고, 그것이 이 컴포넌트가 조건문을 하나만 갖는 이유다.
   */
  const notice = errorNotice(error)

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{notice.title}</h1>
      <p className="max-w-sm text-sm text-neutral-600">{notice.body}</p>

      {notice.digest != null && (
        <p className="rounded-md bg-neutral-100 px-3 py-1.5 font-mono text-xs text-neutral-700">
          {notice.digest}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
        >
          홈으로
        </Link>
      </div>
    </main>
  )
}
