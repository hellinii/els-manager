import type { FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * 폼 상단 문구 — **`ErrorCode`가 표현을 정한다** (DOC-011 §3.2 화면 처리 열)
 *
 * | 코드 | 처리 |
 * |---|---|
 * | `UNAUTHENTICATED` | **폼을 갈아치우지 않는다.** 재로그인 링크만 얹는다 (W-03의 존재 이유) |
 * | `PROVIDER_UNAVAILABLE` | **오류가 아니다.** ST-03 폴백 안내 → 수동 입력 유도 |
 * | `CONFLICT` | 인라인 + 다음 행동 |
 * | 그 외 | 오류 박스 |
 *
 * ## `PROVIDER_UNAVAILABLE`이 이 컴포넌트의 존재 이유다
 *
 * ST-03: 「자동 조회 실패는 오류가 아니라 **폴백 경로 안내**로 표현한다.」
 * 코드를 버리고 문구만 남기면 그 판단을 문자열 비교로 하게 되고, 「오류 = 빨간
 * 박스」를 먼저 만들어 버리면 나중에 되돌려야 한다 — SCR-302를 P4의 첫 화면으로
 * 옮긴 근거 중 하나가 이것이다(계획 §3).
 *
 * ## `UNAUTHENTICATED`에서 폼을 지우지 않는다
 *
 * 변경 계약이 미인증에 던지지 않는 이유가 「입력값 보존」이다(W-03). 여기서 폼을
 * 로그인 안내로 갈아치우면 그 설계가 무의미해진다 — 사용자는 다시 로그인한 뒤
 * 처음부터 입력하게 된다.
 */

const TONE = {
  error: 'bg-red-50 text-red-700',
  notice: 'bg-amber-50 text-amber-900',
  ok: 'bg-emerald-50 text-emerald-800',
} as const

export function FormMessage({ state }: { state: FormState }) {
  if (state.message == null) return null

  const tone =
    state.status === 'OK'
      ? 'ok'
      : state.code === 'PROVIDER_UNAVAILABLE'
        ? 'notice'
        : 'error'

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-col gap-1 rounded-md px-3 py-2 text-sm ${TONE[tone]}`}
    >
      <p>{state.message}</p>

      {state.code === 'UNAUTHENTICATED' && (
        // `<Link>`가 아니라 `<a>`다 — 세션이 이미 없으므로 클라이언트 내비게이션의
        // 캐시된 RSC 페이로드가 아니라 **새 문서 요청**이 나가야 프록시가 판정한다.
        <a href={PATHS.login} className="font-medium underline">
          다시 로그인한다
        </a>
      )}

      {state.unmatched.length > 0 && (
        /*
         * 어느 칸과도 짝지어지지 않은 오류. 사용자가 행을 지우고 재제출하면
         * 서버가 사라진 인덱스를 가리킬 수 있다 — 조용히 버리면 "저장이 안 되는데
         * 아무 표시도 없다"가 된다.
         */
        <ul className="mt-1 list-inside list-disc text-xs">
          {state.unmatched.map(({ key, message }) => (
            <li key={key}>
              <span className="font-mono">{key}</span> {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
