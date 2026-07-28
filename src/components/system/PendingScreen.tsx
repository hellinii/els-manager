import Link from 'next/link'

import { PATHS } from '@/lib/routes/paths'

/**
 * 아직 서지 않은 화면의 자리표시 — P4 진행 중에만 존재한다.
 *
 * ## 왜 404로 두지 않는가
 *
 * 네비게이션에 있는 탭이 404로 가면 그것은 **결함으로 보인다.** 셸이 도는 상태를
 * 컷의 종료 조건으로 삼았으므로(계획 §4) 다섯 탭 전부가 눌러지는 화면이어야 하고,
 * "이 화면은 아직 없다"와 "이 주소는 틀렸다"는 사용자에게 다른 사실이다.
 *
 * ## 왜 컷 번호를 적는가
 *
 * 이 컴포넌트는 화면이 서면 사라진다. 어느 컷이 어느 자리를 대체하는지 적어 두지
 * 않으면 남은 자리표시가 "만들려다 만 화면"과 구분되지 않는다. `grep PendingScreen`
 * 하나로 남은 것을 셀 수 있어야 한다.
 */

export function PendingScreen({
  screen,
  title,
  cut,
}: {
  /** DOC-008 §4의 화면 ID */
  screen: string
  title: string
  /** 이 자리를 대체하는 컷 */
  cut: string
}) {
  return (
    <section className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="font-mono text-xs text-neutral-400">{screen}</p>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-neutral-600">
        아직 만들지 않은 화면이다. {cut}에서 선다.
      </p>
      <Link
        href={PATHS.home}
        className="mt-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
      >
        홈으로
      </Link>
    </section>
  )
}
