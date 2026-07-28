import type { BadgeGrade } from '@/lib/format'

/**
 * 상태 뱃지 — 등급 → 색. **등급의 정본은 DOC-005 §6.3이고 색은 여기다**
 *
 * 두 층을 가르는 이유: 등급은 도메인 판단("사용자가 할 일이 있는가")이고 색은
 * 디자인 결정이다. 순수 모듈이 Tailwind 클래스를 들고 있으면 디자인 시스템을
 * 역작성할 때(DOC-001 §10) 어느 쪽이 정본인지 알 수 없어진다.
 *
 * ## 다섯 등급이 서로 구별되어야 한다
 *
 * v1은 라이트 모드 고정이므로(SQ-05) 한 벌만 검증한다. 그 결정의 근거가 「색이
 * 의미를 나른다」였으니 색이 뭉치면 근거가 무의미해진다 — 특히 `attention`과
 * `defect`는 **다른 화면으로 유도한다**(SCR-202 확인 vs SCR-204 수정, ST-06).
 * 그래서 `defect`만 채도가 아니라 **명도**로 가른다: 빨강 계열 안에서 두 단계를
 * 나누면 나란히 놓였을 때 구분되지 않는다.
 */

const GRADE_CLASS: Record<BadgeGrade, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  caution: 'bg-amber-50 text-amber-900 ring-amber-300',
  attention: 'bg-red-50 text-red-700 ring-red-300',
  defect: 'bg-neutral-800 text-white ring-neutral-800',
}

export function Badge({
  grade,
  children,
  title,
}: {
  grade: BadgeGrade
  children: React.ReactNode
  /** 근거를 덧붙일 때. 예: 시세 경과의 기준일 */
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${GRADE_CLASS[grade]}`}
    >
      {children}
    </span>
  )
}
