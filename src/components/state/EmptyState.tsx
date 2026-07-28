import Link from 'next/link'

/**
 * 빈 상태 — **타입이 ST-02를 강제한다**
 *
 * DOC-008 ST-02: 「빈 상태는 "데이터 없음"에 그치지 않고 다음 행동을 제시한다.」
 * 그 규칙은 규율로 지키면 반드시 한 화면에서 빠진다 — 빠진 화면은 사용자가
 * 막다른 곳에 서는데 오류는 아니므로 아무도 신고하지 않는다.
 *
 * 그래서 `action`을 **필수 prop**으로 둔다. 다음 행동이 없는 빈 상태는 컴파일되지
 * 않는다. 이 파일에서 가장 중요한 줄은 마크업이 아니라 그 물음표 없는 타입이다.
 *
 * > SCR-302의 빈 상태가 이 규칙이 실제로 문제를 잡은 자리다. 「등록된 기초자산
 * > 없음」의 다음 행동이 SCR-204(상품 등록)뿐이었고 상품 등록은 다시 기초자산을
 * > 요구해서 **안내가 순환했다.** DOC-011 §8이 `createAsset`을 SCR-302에도
 * > 배정하며 닫혔다(v1.2).
 */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  /** ST-02 — 다음 행동. 없는 빈 상태는 만들 수 없다. */
  action: { label: string; href: string } | { label: string; form: React.ReactNode }
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center">
      <p className="text-sm font-medium text-neutral-900">{title}</p>
      {description != null && (
        <p className="max-w-sm text-sm text-neutral-600">{description}</p>
      )}

      {'href' in action ? (
        <Link
          href={action.href}
          className="mt-1 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          {action.label}
        </Link>
      ) : (
        // 다음 행동이 이동이 아니라 **이 자리에서 하는 입력**일 수 있다 —
        // SCR-302의 자산 등록이 그렇다. 링크로만 두면 그 화면이 자기 자신을
        // 가리키게 된다.
        <div className="mt-1 w-full max-w-sm">{action.form}</div>
      )}
    </div>
  )
}
