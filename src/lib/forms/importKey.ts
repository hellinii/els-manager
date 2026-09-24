/**
 * 불러온 폼의 키 선택 — **의존성이 없다** (DOC-008 v2.13)
 *
 * 클라이언트 컴포넌트(`ImportedProductForm`)가 import한다. `importPanel.ts`에 두면 그 파일이 끌어오는
 * 어댑터·채움 모듈이 클라이언트 번들에 실린다(`ImportAssetForm`의 각주와 같은 이유) — 그래서 따로 둔다.
 */

/**
 * 이 렌더의 폼 키 — 직전 키를 유지할지의 **판단** (DOC-008 v2.11 · v2.13)
 *
 * `ImportedProductForm`이 렌더마다 부른다. 판단을 컴포넌트에 두면 어떤 스위트도 보지 못한다(AQ-23) —
 * 실제로 그 자리에 결함이 있었다: 기초자산 목록만 실패한 **첫** 렌더에서 직전 키(빈 폼의 「blank」)를
 * 유지해 **채움이 폼에 닿지 않았다**. 구획은 「일부 채움」을 말하고 폼은 저장값 그대로였다(반박 검토).
 *
 * | 이 렌더 | 결과 |
 * |---|---|
 * | 조회가 전부 성공(`keepPreviousKey` 거짓) | 이 렌더의 키 |
 * | 상세 성공 · 기초자산 목록 실패 | 직전 키가 **같은 상품 코드**의 불러온 폼이면 유지, 아니면 이 렌더의 키 |
 * | 상세 실패 | 직전 키 — 새로 채울 것이 없다 |
 *
 * 후보 링크는 소프트 이동이고 Next는 검색 인자만 바뀐 이동에서 클라이언트 상태를 유지하므로 첫
 * 렌더의 직전 키는 실제로 「blank」다.
 */
export function formKeyAfter(
  previous: string,
  panel: { code: string | null; formKey: string; keepPreviousKey: boolean },
): string {
  if (!panel.keepPreviousKey) return panel.formKey
  const prefix = panel.code == null ? null : `${panel.code}:`
  // 채움이 있다(키가 이 상품의 것이다) — 같은 상품의 불러온 폼만 지킨다. 처음이면 이 채움이 곧 새 폼이다
  if (prefix != null && panel.formKey.startsWith(prefix)) {
    return previous.startsWith(prefix) ? previous : panel.formKey
  }
  return previous
}
