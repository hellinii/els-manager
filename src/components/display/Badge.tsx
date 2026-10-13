import type { BadgeGrade } from '@/lib/format'

/**
 * 상태 뱃지 — 등급 → 색. **등급의 정본은 DOC-005 §6.3이고 색은 여기다**
 *
 * 두 층을 가르는 이유: 등급은 도메인 판단("사용자가 할 일이 있는가")이고 색은
 * 디자인 결정이다. 순수 모듈이 Tailwind 클래스를 들고 있으면 디자인 시스템을
 * 역작성할 때(DOC-001 §10) 어느 쪽이 정본인지 알 수 없어진다.
 *
 * ## 여섯 등급이 서로 구별되어야 한다
 *
 * v1은 라이트 모드 고정이므로(SQ-05) 한 벌만 검증한다. 그 결정의 근거가 「색이
 * 의미를 나른다」였으니 색이 뭉치면 근거가 무의미해진다 — 특히 `attention`과
 * `defect`는 **다른 화면으로 유도한다**(SCR-202 확인 vs SCR-204 수정, ST-06).
 * 그래서 `defect`만 채도가 아니라 **명도**로 가른다: 빨강 계열 안에서 두 단계를
 * 나누면 나란히 놓였을 때 구분되지 않는다.
 *
 * `record` 「기록 필요」는 `attention`과 **색상**(파랑 ↔ 빨강)으로 가른다 *(홈 피드백 컷 K3 · DOC-005 v1.24)*.
 * 같은 빨강의 옅은 단계로 두면 위와 같은 이유로 나란히 놓였을 때 구분되지 않고, 빨강이 조건 충족을
 * 경고로 읽게 한 것이 피드백 #1이었다. blue-700은 blue-50 위 6.28:1 · 흰 바탕 6.83:1이다(DOC-008 §6 ST-08).
 */

/**
 * 배지의 바탕 · 글자 · 테두리. **export하는 것은 색을 상시 스위트가 지키게 하려는 것이다**(`tests/app/gradeColors.test.ts`
 * — 홈 피드백 컷 K6). 종전에는 이 표를 빨강으로 되돌려도 상시 스위트가 전부 초록이었다(K3 검증 실측) — 등급 토큰은
 * 문서와 대조되지만 토큰 → 색은 아무도 보지 않았다. 화면은 이 표를 직접 읽지 않고 `Badge`를 쓴다.
 */
export const GRADE_CLASS: Record<BadgeGrade, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  caution: 'bg-amber-50 text-amber-900 ring-amber-300',
  record: 'bg-blue-50 text-blue-700 ring-blue-300',
  attention: 'bg-red-50 text-red-700 ring-red-300',
  defect: 'bg-neutral-800 text-white ring-neutral-800',
}

/**
 * 등급의 **글자색만** — 배지 없이 숫자 하나를 등급으로 칠할 때(흰 바탕 기준 대비).
 * 배지의 글자색과 같은 단계다. `defect`는 배지가 어두운 바탕이라 흰 바탕의 글자로는 가장 진한 무채색을 쓴다.
 *
 * | 등급 | 흰 바탕 대비 |
 * |---|---|
 * | neutral | 10.37 |
 * | positive | 7.61 |
 * | caution | 9.06 |
 * | record | 6.83 |
 * | attention | 6.42 |
 * | defect | 17.93 |
 */
export const GRADE_TEXT_CLASS: Record<BadgeGrade, string> = {
  neutral: 'text-neutral-700',
  positive: 'text-emerald-800',
  caution: 'text-amber-900',
  record: 'text-blue-700',
  attention: 'text-red-700',
  defect: 'text-neutral-900',
}

/**
 * 카드 · 상자의 **왼쪽 띠** — 바탕에 등급 색을 깔지 않고 띠만 칠한다 (DOC-008 SCR-101 「홈 피드백 컷 K0」 ⑥).
 *
 * 바탕을 칠하지 않는 이유: 빨강 바탕은 조건 충족을 경고로 읽게 했고(피드백 #1), 옅은 파랑(blue-50)을 깔면
 * 그 위의 neutral-500 글자가 4.36:1로 AA에 못 미친다(ST-08). 띠는 비텍스트이고 뜻은 같은 줄의 배지 글자가
 * 나르지만(색이 유일한 전달 수단이 아니다), 띠 색도 흰 바탕에서 3:1 이상인 단계를 고른다(WCAG 1.4.11) —
 * neutral-500 4.74 · emerald-600 3.65 · amber-600 3.20 · blue-600 5.25 · red-600 4.77 · neutral-800 15.13.
 * 클래스는 완전한 리터럴이다 — Tailwind는 조립한 클래스 이름을 만들지 않는다.
 */
export const GRADE_ACCENT: Record<BadgeGrade, string> = {
  neutral: 'border-l-neutral-500',
  positive: 'border-l-emerald-600',
  caution: 'border-l-amber-600',
  record: 'border-l-blue-600',
  attention: 'border-l-red-600',
  defect: 'border-l-neutral-800',
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
