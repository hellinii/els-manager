import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: '언제들어오나',
  description: 'ELS 포트폴리오 관리 — 평가일정, 조건 판정, 세금 추정',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // UI 표시 문자열이 전부 한글이다(CLAUDE.md 코딩 규약). `lang="en"`이면
    // 스크린리더가 영어 음성으로 읽고 브라우저가 영어 기준으로 줄바꿈한다.
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
