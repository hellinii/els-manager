import type { Metadata } from 'next'

import { LoginForm } from './LoginForm'

/**
 * SCR-001 로그인 — DOC-008 §5
 *
 * 진입: 미인증 상태에서 모든 경로 접근 시(프록시가 보낸다). 이탈: 성공 → SCR-101.
 *
 * 서버 컴포넌트이고 폼만 클라이언트다. 데이터를 읽지 않으므로 `getQueries()`를
 * 부르지 않는다 — 부르면 미인증에서 던져(Q-04) 로그인 화면 자체가 죽는다.
 */

export const metadata: Metadata = {
  title: '로그인 · 언제들어오나',
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">언제들어오나</h1>
          <p className="mt-1 text-sm text-neutral-600">
            ELS 포트폴리오 관리
          </p>
        </div>

        <LoginForm />

        {/* 회원가입 링크 없음 — 초대 기반 폐쇄형이다(DOC-001 A-05, SEC-03). */}
      </div>
    </main>
  )
}
