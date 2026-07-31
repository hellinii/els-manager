'use client'

/**
 * 루트 레이아웃 실패 전용 경계.
 *
 * `app/error.tsx`는 레이아웃 **안쪽**에서만 동작하므로 `layout.tsx` 자체가
 * 던지면 잡지 못한다. 그때는 이 파일이 `<html>`·`<body>`를 직접 렌더한다 —
 * 레이아웃이 죽은 상태이므로 그것들이 존재하지 않기 때문이다.
 *
 * **Tailwind에 의존하지 않고 인라인 스타일을 쓴다.** 스타일시트는 레이아웃이
 * import하는데, 그 레이아웃이 실패한 경우다. 클래스명을 쓰면 무스타일 화면이 된다.
 *
 * 개발 모드에서는 Next의 오류 오버레이가 먼저 뜨므로 이 화면은 프로덕션에서만
 * 보인다 — 즉 **여기서 무엇이 잘못됐는지 설명할 수단은 `digest`뿐이다.**
 */

import { errorNotice } from '@/lib/format/errorNotice'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // 판단은 `lib/format/errorNotice.ts`에 있다 — AQ-38 (c). 이 파일도 어느 스위트도
  // 실행하지 않으므로 분기를 여기 두면 `error.tsx`와 «따로» 낡는다(실제로 빈 문자열
  // 갈래가 양쪽에 중복돼 있었다).
  const notice = errorNotice(error, 'global')

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '3rem 1rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#171717',
          background: '#ffffff',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
          {notice.title}
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#525252', maxWidth: '24rem' }}>
          {notice.body}
        </p>

        {notice.digest != null && (
          <p
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.75rem',
              background: '#f5f5f5',
              padding: '0.375rem 0.75rem',
              borderRadius: '0.375rem',
            }}
          >
            {notice.digest}
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#ffffff',
            background: '#171717',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  )
}
