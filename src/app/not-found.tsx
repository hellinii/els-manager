import Link from 'next/link'

/**
 * SCR-901 페이지 없음 — DOC-008 §4
 *
 * 두 경로에서 도달한다. ① 매칭되는 라우트가 없을 때(자동) ② 화면이 `notFound()`를
 * 부를 때 — SCR-202가 `getProduct()`의 `null`을 여기로 바꾼다(DOC-008 §6
 * "미존재 → SCR-901").
 *
 * **조회 계약은 계속 `null`을 반환한다.** 변환은 화면의 일이다(코딩 규약,
 * DOC-011 §3.1). 계약이 던지게 바꾸면 "없음"과 "시스템 오류"가 같은 경로가 된다.
 *
 * > 규약 하나 — `notFound()`는 `NEXT_HTTP_ERROR_FALLBACK;404`를 던진다. 조회를
 * > `try/catch`로 감싸는 화면은 `unstable_rethrow`로 다시 던져야 한다. 삼키면
 * > 404가 아니라 **빈 성공 페이지**가 렌더된다.
 */

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-sm font-medium text-neutral-500">404</p>
      <h1 className="text-xl font-semibold tracking-tight">
        페이지를 찾을 수 없다
      </h1>
      <p className="max-w-sm text-sm text-neutral-600">
        주소가 바뀌었거나 삭제된 항목일 수 있다. 상품이 삭제된 경우 목록에서 다시
        찾는다.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
      >
        홈으로
      </Link>
    </main>
  )
}
