import Link from 'next/link'

/**
 * SCR-902 권한 없음 — DOC-008 §4
 *
 * ## 라우트가 아니라 컴포넌트다
 *
 * DOC-008이 이 화면의 경로를 `—`로 둔 것이 힌트다. 그리고 **에러 경계도 아니다.**
 * RLS 설계에서 그 이유가 나온다: 모든 SELECT 정책이 `using (true)`이므로
 * (DOC-010 §7) 비소유자도 SCR-202/203/204의 데이터를 **읽는다.** 계약은
 * `isOwner: false`를 돌려주지 예외를 던지지 않는다. `FORBIDDEN`은 변경 계약의
 * `ActionResult`에서만 나오고, W-03이 그것을 경계로 보내는 것을 금지한다
 * (입력값 보존).
 *
 * 그래서 도달 경로는 하나다 — **소유자 전용 URL을 직접 입력**. 화면도 둘뿐이다
 * (SCR-203 상환, SCR-204 수정). ST-04가 버튼을 숨기므로 링크로는 올 수 없다.
 *
 * ## `forbidden()`을 쓰지 않는 이유
 *
 * Next에 `forbidden()` + `app/forbidden.tsx`가 있지만
 * `experimental.authInterrupts`를 요구한다(기본 `false` —
 * `next/dist/server/config-shared.js:233`). 그것으로 얻는 것은 **403 상태
 * 코드**인데, 현재 검증 인프라로 그 속성을 측정할 방법이 없다. 검증할 수 없는
 * 속성을 위해 실험 플래그를 켜지 않는다. 소유자 전용 화면이 셋째로 늘면 재검토한다.
 *
 * `productId`를 받으면 상세로 돌아갈 길을 준다 — 조회는 허용되므로 그 화면은
 * 실제로 열린다. 막힌 것은 수정·상환뿐이라는 사실 자체가 안내가 된다.
 *
 * ## 루트가 `<main>`이 아니라 `<section>`이다 (P4.5)
 *
 * 이 컴포넌트는 **셸 안에서** 반환된다(`(app)/products/[id]/{edit,redeem}/page.tsx`가
 * `(app)/layout.tsx`의 자식이다). `AppShell`에 이미 `<main>`이 있으므로 여기서도
 * `<main>`을 쓰면 **한 문서에 `main` 랜드마크가 둘**이 되고, 보조기술에서 「본문」이
 * 어느 것인지 정해지지 않는다.
 *
 * 같은 마크업이 **셸 밖의 형제**(`app/not-found.tsx`·`app/error.tsx`)에서는 `<main>`이
 * 맞다 — 그 둘은 `(app)/layout.tsx`보다 위에 있어 셸이 렌더되지 않는다. 셋이 같은
 * 모습이라 한 파일만 다르게 두는 것이 실수처럼 보이므로 이유를 여기 적는다.
 *
 * `flex-1`도 함께 뗐다 — **부모가 flex 컨테이너가 아니어서 무효였다**(`AppShell`의
 * `<main>`은 `flex`가 아니다). 무효한 유틸리티는 다음 사람에게 「세로 정렬이 여기서
 * 처리된다」는 거짓 신호를 준다. 가운데 정렬은 `min-h`와 자체 flex로 남긴다.
 */

export function AccessDenied({
  what,
  productId,
}: {
  /** 무엇이 막혔는지. 예: `'이 상품을 수정할'` */
  what: string
  productId?: string
}) {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-sm font-medium text-neutral-500">403</p>
      <h1 className="text-xl font-semibold tracking-tight">권한이 없다</h1>
      <p className="max-w-sm text-sm text-neutral-600">
        {what} 권한은 소유자에게만 있다. 조회는 가능하다.
      </p>

      <div className="mt-2 flex gap-2">
        {productId != null && (
          <Link
            href={`/products/${productId}`}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            상세로
          </Link>
        )}
        <Link
          href="/products"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
        >
          목록으로
        </Link>
      </div>
    </section>
  )
}
