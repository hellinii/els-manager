/**
 * SCR-204 불러오기 구획의 상태 일곱 — 문구와 판단 (DOC-008 §5 SCR-204 v2.9)
 *
 * 화면(`KiwoomImport.tsx`)이 이 표 하나를 그린다. 상태를 화면에서 판정하면 그 판단이 어떤 스위트의
 * import 그래프에도 없게 된다(AQ-23) — 그래서 판정도 여기 있다.
 *
 * **§6.1 축이 아니다.** 열거형 표시 문자열이 아니라 한 화면의 국지 상태다(DOC-005 v1.4 — DOC-008
 * v0.5·v0.7·v0.9의 선례). 대신 `tests/app/importNotice.test.ts`가 **DOC-008 SCR-204의 상태 표와 이
 * 표의 이름 집합이 같은지** 본다 — 한쪽에만 상태가 늘면 빨간불이다.
 */

export type ImportPanelState =
  | 'IDLE'
  | 'NO_RESULTS'
  | 'CANDIDATES'
  | 'FILLED'
  | 'PARTIAL'
  | 'REFUSED'
  | 'LOOKUP_FAILED'

export type ImportPanelTone = 'plain' | 'info' | 'warn'

/**
 * `name`은 DOC-008 표의 첫 열 그대로다. `tone`은 **오류 색을 쓰지 않는다** — 불러오기는 보조
 * 기능이고 실패해도 직접 입력이 남는다(ST-03). 빨간색은 저장 검증 실패에만 쓴다.
 */
export const IMPORT_PANEL_STATES: Readonly<
  Record<ImportPanelState, { name: string; tone: ImportPanelTone; message: string | null }>
> = {
  IDLE: {
    name: '검색 전',
    tone: 'plain',
    message: null,
  },
  NO_RESULTS: {
    name: '결과 없음',
    tone: 'info',
    message:
      '찾는 상품이 없다. 청약 중인 상품은 청약이 끝난 뒤 검색된다 — 회차를 다시 확인하거나 직접 입력한다.',
  },
  CANDIDATES: {
    name: '후보 목록',
    tone: 'plain',
    message: '불러올 상품을 고른다. 같은 번호가 여러 시리즈에 있다.',
  },
  FILLED: {
    name: '불러옴',
    tone: 'info',
    message: '아래 폼을 채웠다. 투자원금·계좌유형을 적고, 값을 투자설명서와 대조한 뒤 저장한다.',
  },
  PARTIAL: {
    name: '일부 채움',
    tone: 'warn',
    message: '채울 수 있는 것만 채웠다. 아래 안내의 빈 칸을 채우고 투자원금·계좌유형을 적은 뒤 저장한다.',
  },
  REFUSED: {
    name: '거부',
    tone: 'warn',
    message: '이 상품은 불러오지 않았다 — 아래 사유를 투자설명서로 확인하고 직접 입력한다.',
  },
  LOOKUP_FAILED: {
    name: '조회 실패',
    tone: 'warn',
    message: '키움 조회에 실패했다 — 잠시 뒤 다시 찾거나 직접 입력한다.',
  },
}

/**
 * 수정 화면에서 문구가 다른 상태 다섯 (DOC-008 SCR-204 v2.12 「수정 화면의 불러오기」 · v2.13)
 *
 * **판정은 같고 문구만 다르다.** 등록의 「투자원금·계좌유형을 적는다」·「직접 입력한다」는 저장값이
 * 이미 있는 폼에 맞지 않는다 — 수정 화면에서 그 칸들은 저장값 그대로다. 이름 집합(DOC-008 표와의
 * 대조)은 `IMPORT_PANEL_STATES` 하나가 진다.
 *
 * **관찰방식을 「저장값 그대로」에 넣지 않는다**(v2.13) — 노낙인 상품을 불러오면 V-16 때문에 비운다.
 * 남겼는지 비웠는지는 그 칸의 안내가 말한다(`importPanelOf`).
 */
export const IMPORT_EDIT_MESSAGES: Readonly<Partial<Record<ImportPanelState, string>>> = {
  NO_RESULTS:
    '찾는 상품이 없다. 청약 중인 상품은 청약이 끝난 뒤 검색된다 — 회차를 다시 확인하거나 직접 고친다.',
  FILLED:
    '조건 칸을 불러온 값으로 바꿨다 — 투자원금·계좌유형·비고는 저장값 그대로다. 투자설명서와 대조한 뒤 저장한다.',
  PARTIAL:
    '채울 수 있는 것만 바꿨다. 아래 안내의 빈 칸을 채우고 저장한다 — 투자원금·계좌유형·비고는 저장값 그대로다.',
  REFUSED: '이 상품은 불러오지 않았다 — 폼은 저장값 그대로다. 아래 사유를 투자설명서로 확인한다.',
  LOOKUP_FAILED: '키움 조회에 실패했다 — 잠시 뒤 다시 찾거나 직접 고친다.',
}

/** 구획 머리의 문구 — 화면(등록·수정)에 따라 */
export function importPanelMessageOf(state: ImportPanelState, target: 'NEW' | 'EDIT'): string | null {
  return (target === 'EDIT' ? IMPORT_EDIT_MESSAGES[state] : undefined) ?? IMPORT_PANEL_STATES[state].message
}

/** 항상 붙는 한 줄 — 불러온 값의 권위(DOC-005 「불러온 값」) */
export const IMPORT_AUTHORITY_NOTE =
  '불러온 값은 키움 안내 화면의 값이다. 정본은 투자설명서이며 저장 전에 대조한다.'

/**
 * 화면이 가진 사실 → 상태. 입력은 이미 부른 조회의 결과뿐이다(여기서 부르지 않는다).
 *
 * `code`가 있으면 상세가 이긴다 — 후보를 고른 뒤의 화면이다. 상세 조회가 실패하면 **조회 실패**이고
 * 후보 목록으로 되돌아가지 않는다(검색을 다시 부르지 않았으므로 목록이 없다).
 */
export function importPanelStateOf(input: {
  query: string | null
  code: string | null
  search: { ok: true; count: number } | { ok: false } | null
  fill: { kind: 'FILLED' | 'PARTIAL' | 'REFUSED' } | { failed: true } | null
}): ImportPanelState {
  if (input.code != null) {
    if (input.fill == null || 'failed' in input.fill) return 'LOOKUP_FAILED'
    return input.fill.kind
  }
  if (input.query == null || input.search == null) return 'IDLE'
  if (!input.search.ok) return 'LOOKUP_FAILED'
  return input.search.count === 0 ? 'NO_RESULTS' : 'CANDIDATES'
}
