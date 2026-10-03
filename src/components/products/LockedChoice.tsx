/**
 * 바꿀 수 없는 선택 — 값 글자 + 숨은 입력 + 힌트 (P8 컷 b3-4, DOC-008 SCR-204 · SQ-21 ⓖ b3 개정)
 *
 * 월수익 지급 기록이 있는 상품의 상품 통화 · 쿠폰 지급방식이 이 모양이다. `<select disabled>`는 **제출되지 않으므로**
 * 저장이 V-22 · V-25의 빈칸 오류를 낸다 — 숨은 입력이 저장값을 그대로 되돌려 보낸다(동결 트리거는 같은 값을 통과시킨다).
 * 칸 이름은 그대로라 계약의 오류가 그 자리(힌트 아래)에 붙는다.
 */
export function LockedChoice({
  name,
  label,
  value,
  shown,
  error,
}: {
  name: string
  label: string
  /** 제출될 저장값 */
  value: string
  /** 화면에 적는 글자 */
  shown: string
  error?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input type="hidden" name={name} value={value} />
      <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{shown}</p>
      <p className="text-xs text-neutral-500">월수익 지급 기록이 있어 바꿀 수 없다 — 기록을 모두 지우면 바꿀 수 있다</p>
      {error != null && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
