import type { ActionResult } from '@/lib/db/mutations/result'

import { barrierNotice, parseBarrierList } from './barriers'
import { parseFieldPath, path } from './fieldPath'
import { initialFormState, toFormState, type FormState } from './state'

/**
 * SCR-204의 단계 기계 — **순수**하다. `next`도 `react`도 모른다
 *
 * ## 왜 클라이언트 상태가 아닌가
 *
 * 단계 전환을 `useState`로 하면 두 가지를 잃는다.
 *
 * ① **JS 없이 동작하지 않는다.** 컷 1b가 실측한 함정과 같은 자리다 — 전체 갱신
 *    버튼이 클라이언트 화살표에 감싸여 JS 없이는 아무 일도 하지 않았고 e2e가
 *    그것을 잡았다. 단계 폼은 그 함정이 **네 배**다(단계마다 하나씩).
 * ② **어느 스위트도 보지 못한다.** 화면 안의 상태 전이는 브라우저가 있어야
 *    확인되고 우리는 브라우저를 도입하지 않았다(AQ-32). 여기 있으면 상시
 *    스위트가 전수로 본다.
 *
 * 그래서 현재 단계는 **폼의 값**이고(`step` 히든 필드) 전환은 **제출**이다.
 * `useActionState`가 붙으면 같은 POST가 클라이언트 내비게이션이 되므로 두 경로가
 * 하나다 — 「JS는 향상이고 요구가 아니다」.
 *
 * ## 비활성 단계의 값은 히든으로 실린다
 *
 * 다음 단계로 가면 앞 단계의 입력은 DOM에서 사라지고, 사라진 입력은 제출되지
 * 않는다. 그래서 활성 단계가 렌더하지 않는 **모든 이름**을 히든으로 다시 싣는다
 * (`carryNames`). 이름 목록을 손으로 적지 않고 `productFieldNames()`에서 파생시키는
 * 이유는 배열 필드가 동적이라는 것이다 — 행이 늘면 이름도 늘어야 하고, 두 곳에
 * 적으면 한쪽이 뒤처져 **조용히 값이 사라지는 행**이 생긴다.
 */

export type StepId = 'BASIC' | 'UNDERLYINGS' | 'CONDITIONS' | 'CONFIRM'

export type Step = {
  id: StepId
  /** DOC-008 §5 SCR-204의 단계 기호. 문서 표기를 그대로 쓴다 */
  ordinal: string
  /** DOC-008 §5의 단계 이름 */
  title: string
  /** 그 단계가 무엇을 묻는가 — DOC-008 §5의 「입력 항목」 요약 */
  summary: string
}

/** DOC-008 §5 SCR-204의 단계 표. 순서가 곧 전이 순서다 */
export const PRODUCT_STEPS: readonly Step[] = [
  { id: 'BASIC', ordinal: '①', title: '기본 정보', summary: '상품명 · 발행사 · 발행일 · 투자원금 · 계좌유형' },
  { id: 'UNDERLYINGS', ordinal: '②', title: '기초자산', summary: '자산 선택 + 기준가격 (N종)' },
  { id: 'CONDITIONS', ordinal: '③', title: '평가 조건', summary: '평가주기 · 총 차수 · 연쿠폰율 · 배리어 스케줄 · KI' },
  { id: 'CONFIRM', ordinal: '④', title: '확인', summary: '생성될 평가일정 미리보기 후 저장' },
] as const

const STEP_IDS = PRODUCT_STEPS.map((step) => step.id)

/**
 * 아직 서지 않은 조각 — **원장이다** (컷 2·3의 `NOT_YET_BUILT`와 같은 형태)
 *
 * 컷 4a는 라우트를 실화면으로 바꾸므로 `placeholderRoutes()`가 `/products/new`를
 * 더 이상 세지 않는다. 그러면 화면 하나가 **부분적으로** 선 상태가 어느 원장에도
 * 남지 않고, 그것은 컷 2·3이 「합계를 단언한다」로 막은 상태와 같은 부류다 —
 * 숫자만 줄어들고 「화면이 섰다」로 읽힌다.
 *
 * 그래서 화면 **안의** 미완성을 여기서 센다. 조각이 서면 이 표에서 지우고,
 * `tests/app/steps.test.ts`가 표와 실제를 대조한다(지우지 않으면 빨간불).
 *
 * > **원장이 두 번 비었다.** 컷 4a가 셋(③·④·저장)을 등재하고 컷 4b가 비웠으며,
 * > 컷 5가 SCR-202의 셋(상환 처리·상환 취소·KI 터치 확정)을 등재하고 **컷 6이
 * > 비웠다.** 채워짐과 비워짐이 번갈아 일어나는 것이 이 표가 살아 있다는 증거다 —
 * > 비었음을 단언으로 남기므로 다음에 조각을 미루는 컷이 오면 다시 채워진다.
 */
export const PENDING_PARTS: Record<string, string> = {}

export const STEP_FIELD = 'step'
export const INTENT_FIELD = 'intent'

/**
 * 수정 대상 상품 id — **폼의 이름이지만 계약 입력의 필드가 아니다** (P4 컷 5)
 *
 * `useActionState`의 서명은 `(prev, formData)`이므로 라우트 파라미터가 액션에 자동으로
 * 오지 않는다. 히든으로 실으면 조작이 가능하지만 계약이 소유를 다시 확인하며(§5.2의
 * 사전 조회 + RLS) 결과는 `FORBIDDEN`·`NOT_FOUND`다 — SCR-302가 줄마다 `assetId`를
 * 히든으로 싣는 것과 같은 자리다.
 *
 * **`productFieldNames`에 넣지 않는다.** 그 목록은 「계약 입력의 이름」이고 `transition`이
 * 그것으로 값을 좁히므로, 넣으면 상태가 id를 나르게 되고 그때 id의 정본이 둘이 된다
 * (라우트와 상태). 폼은 이 칸을 **props의 값으로 매 렌더 다시 그린다.**
 */
export const PRODUCT_ID_FIELD = 'productId'

/** 배열 필드의 행 상한 — 한 상품의 기초자산 수 (DOC-007 §3.1은 N종을 허용한다) */
export const MAX_UNDERLYINGS = 10

/**
 * 차수 상한 — **미리보기와 차수표의 행 수**다.
 *
 * V-20이 `smallint` 범위까지 허용하므로 조작된 값(`32767`)이 오면 그만큼의 행을
 * 렌더하게 된다. 계약이 거부하기 **전에** 우리 렌더가 죽으므로 화면 쪽 상한이
 * 따로 필요하다. 60은 5년 만기 매월 평가이며, 그보다 긴 상품이 나오면 이 값을
 * 올린다 — 계약의 상한이 아니라 표의 상한이다.
 */
export const MAX_ROUNDS = 60

// ---------------------------------------------------------------------------
// 단계 전이
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'NEXT' }
  | { kind: 'BACK' }
  | { kind: 'SUBMIT' }
  | { kind: 'ADD_UNDERLYING' }
  | { kind: 'REMOVE_UNDERLYING'; index: number }
  | { kind: 'APPLY_BARRIERS' }
  | { kind: 'NONE' }

/**
 * 버튼의 `value` → 의도.
 *
 * `<button name="intent" value="REMOVE_UNDERLYING:2">`처럼 인자를 콜론 뒤에 싣는다.
 * 버튼의 이름·값은 **JS 없이도 제출되므로** 이 인코딩이 두 경로에서 같다.
 *
 * 인식하지 못한 값은 `NONE`이다 — 조작된 값에 오류를 내면 링크 하나가 폼을 막고,
 * 그 판단은 `lib/forms/query.ts`가 URL 질의에 대해 이미 내렸다.
 */
export function parseIntent(raw: string | null | undefined): Intent {
  const [kind = '', arg = ''] = (raw ?? '').split(':')

  switch (kind) {
    case 'NEXT':
      return { kind: 'NEXT' }
    case 'BACK':
      return { kind: 'BACK' }
    case 'SUBMIT':
      return { kind: 'SUBMIT' }
    case 'ADD_UNDERLYING':
      return { kind: 'ADD_UNDERLYING' }
    case 'APPLY_BARRIERS':
      return { kind: 'APPLY_BARRIERS' }
    case 'REMOVE_UNDERLYING': {
      const index = /^\d+$/.test(arg) ? Number.parseInt(arg, 10) : -1
      return index < 0 ? { kind: 'NONE' } : { kind: 'REMOVE_UNDERLYING', index }
    }
    default:
      return { kind: 'NONE' }
  }
}

/** 인식하지 못한 단계는 첫 단계다 — 조작된 값이 폼을 막지 않는다 */
export function parseStep(raw: string | null | undefined): StepId {
  const found = STEP_IDS.find((id) => id === raw)
  return found ?? 'BASIC'
}

/** 전이. 양 끝에서 넘어가지 않는다 */
export function moveStep(current: StepId, intent: Intent): StepId {
  const at = STEP_IDS.indexOf(current)
  if (intent.kind === 'NEXT') return STEP_IDS[Math.min(at + 1, STEP_IDS.length - 1)]!
  if (intent.kind === 'BACK') return STEP_IDS[Math.max(at - 1, 0)]!
  // 행 추가·삭제·일괄 적용은 같은 단계에 머문다 — 제출도 마찬가지다(성공하면
  // 화면이 바뀌고, 실패하면 오류가 있는 단계로 간다: `stepForErrors`).
  return current
}

/**
 * 오류가 있는 첫 단계 — 제출이 거부되면 그 단계로 되돌린다.
 *
 * ④에서 제출했는데 오류가 ①에 있으면 사용자는 오류 문구를 **볼 수 없다**(그 칸이
 * 히든이므로). 「저장이 안 되는데 아무 표시도 없다」의 단계 폼 버전이며,
 * `splitFieldErrors`가 미매칭 키를 버리지 않는 것과 같은 이유로 여기서 단계를
 * 고른다. 어느 단계에도 속하지 않는 키(미매칭)는 상단 요약이 받는다.
 */
export function stepForErrors(fields: Record<string, string> | undefined): StepId | null {
  const owners = new Set(
    Object.keys(fields ?? {})
      .map((key) => stepOfField(key))
      .filter((id): id is StepId => id != null),
  )
  return STEP_IDS.find((id) => owners.has(id)) ?? null
}

// ---------------------------------------------------------------------------
// 필드 소유 — 어느 단계가 어느 이름을 렌더하는가
// ---------------------------------------------------------------------------

/** ① 기본 정보. `note`는 문서의 단계 표에 없다 — 아래 각주 참조 */
const BASIC_NAMES = [
  'name',
  'issuer',
  'issueDate',
  'principal',
  'accountType',
  'note',
] as const

/** ③ 평가 조건의 스칼라. `barriers`는 일괄 입력 칸이며 계약 필드가 아니다 */
const CONDITION_NAMES = [
  'evaluationPeriodMonths',
  'totalRounds',
  'annualCouponRate',
  'kiBarrier',
  'kiObservation',
  'barriers',
] as const

/** 배열 행의 하위 이름. 생성기와 파서가 이 목록을 공유한다 */
export const UNDERLYING_SUBS = ['assetId', 'basePrice'] as const
export const SCHEDULE_SUBS = [
  'barrier',
  'lizardBarrier',
  'lizardCouponRate',
  'lizardRequiresNoKi',
] as const

/** 일괄 배리어 입력 칸의 이름 — 계약의 필드가 아니라 화면의 도구다 */
export const BARRIERS_FIELD = 'barriers'

const FIELD_STEP: Record<string, StepId> = {
  name: 'BASIC',
  issuer: 'BASIC',
  issueDate: 'BASIC',
  principal: 'BASIC',
  accountType: 'BASIC',
  note: 'BASIC',
  underlyings: 'UNDERLYINGS',
  evaluationPeriodMonths: 'CONDITIONS',
  totalRounds: 'CONDITIONS',
  annualCouponRate: 'CONDITIONS',
  kiBarrier: 'CONDITIONS',
  kiObservation: 'CONDITIONS',
  barriers: 'CONDITIONS',
  schedules: 'CONDITIONS',
}

/**
 * 오류 키 → 그 칸을 렌더하는 단계.
 *
 * 배열 키는 뿌리로 판정한다(`underlyings[1].assetId` → `underlyings`) — 인덱스가
 * 어디에 속하는가는 단계와 무관하다.
 */
export function stepOfField(key: string): StepId | null {
  const parsed = parseFieldPath(key)
  if (parsed == null) return null
  return FIELD_STEP[parsed.field] ?? null
}

export type RowCounts = {
  underlyings: number
  /** 차수표의 행 수. `totalRounds` 입력에서 나오며 0은 「아직 정하지 않았다」다 */
  rounds: number
}

/** 배열 행의 이름 — 생성기와 파서가 이 함수를 공유한다 */
function rowNames(field: string, count: number, subs: readonly string[]): string[] {
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    for (const sub of subs) names.push(path(field, index, sub))
  }
  return names
}

/**
 * **단계가 렌더하는 이름의 정본.** 컴포넌트는 이 목록의 칸을 그리고, 히든 이송은
 * 나머지를 싣는다 — 두 목록이 같은 함수에서 나오므로 갈릴 수 없다.
 *
 * 목록을 컴포넌트에 두면 새 칸이 한쪽에만 생기는 날이 오고, 그때 그 값은
 * **다음 단계로 가면 사라진다** — 저장을 누를 때까지 아무 증상이 없다.
 * `tests/e2e/`가 단계마다 「선언된 이름이 전부 DOM에 있다」를 확인한다.
 */
export const STEP_NAMES: Record<StepId, (counts: RowCounts) => string[]> = {
  BASIC: () => [...BASIC_NAMES],
  UNDERLYINGS: (counts) =>
    rowNames('underlyings', counts.underlyings, UNDERLYING_SUBS),
  CONDITIONS: (counts) => [
    ...CONDITION_NAMES,
    ...rowNames('schedules', counts.rounds, SCHEDULE_SUBS),
  ],
  // ④는 입력이 없다 — 전부 히든이며 저장 버튼만 있다.
  CONFIRM: () => [],
}

/**
 * 폼의 **모든** 이름 — 히든 이송과 미매칭 판정이 함께 쓴다.
 *
 * `toFormState`의 `knownNames`가 이 값이어야 하는 이유: 폼은 단계에 걸쳐 있고
 * 오류는 지금 보이지 않는 단계의 칸을 가리킬 수 있다. 활성 단계의 이름만 주면
 * 그 오류들이 전부 「미매칭」으로 상단에 쌓이고, 정작 칸에는 표시되지 않는다.
 */
export function productFieldNames(counts: RowCounts): string[] {
  return [STEP_FIELD, ...STEP_IDS.flatMap((id) => STEP_NAMES[id](counts))]
}

/**
 * 히든으로 실을 이름 — 전체에서 활성 단계의 것을 뺀다.
 *
 * `step`은 히든에 남는다(활성 단계 자신을 나르는 값이다).
 */
export function carryNames(counts: RowCounts, active: StepId): string[] {
  const shown = new Set(STEP_NAMES[active](counts))
  return productFieldNames(counts).filter((name) => !shown.has(name))
}

// ---------------------------------------------------------------------------
// 행 연산 — 값 맵을 직접 다룬다
// ---------------------------------------------------------------------------

/**
 * 그 배열 필드의 행 수 — **값에서 파생시킨다.**
 *
 * 히든 계수기를 따로 두지 않는 이유: 계수기와 값이 갈리면 화면은 3행을 그리는데
 * 파서는 4행을 읽는(또는 그 반대) 상태가 되고, 그 어긋남은 저장 시점에야 드러난다.
 * 빈 입력도 `''`로 제출되므로 행의 존재는 값 맵에 남는다.
 *
 * 최소 1이다 — 기초자산 0건은 계약이 거부하는 상태이고(V-02), 행이 없으면
 * 사용자가 추가 버튼을 찾아야 한다.
 */
export function rowCountOf(values: Record<string, string>, field: string): number {
  let max = -1
  for (const key of Object.keys(values)) {
    const parsed = parseFieldPath(key)
    if (parsed?.field !== field || parsed.index == null) continue
    if (parsed.index > max) max = parsed.index
  }
  return Math.max(1, max + 1)
}

/**
 * 차수표의 행 수 — `totalRounds` 입력에서 나온다.
 *
 * 키에서 파생시키지 않는 이유는 잔재다(총 차수를 6→3으로 줄이면 `schedules[3..5]`의
 * 키가 남는다). 사용자가 지운 것을 우리가 되살리면 V-03이 「6건이 총 차수 3과
 * 다르다」를 내고 원인이 화면에 없다. `parse.ts`가 같은 규칙을 쓴다.
 */
export function roundCountOf(values: Record<string, string>): number {
  const parsed = countOf(values.totalRounds)
  return Number.isNaN(parsed) ? 0 : Math.min(parsed, MAX_ROUNDS)
}

/**
 * 개수를 세는 정수의 단일 해석 — 차수·개월수. **금액이 아니다.**
 *
 * `parse.ts`(FormData)와 화면(값 맵)이 같은 함수를 쓴다. 갈리면 화면이 6행을 그리는데
 * 파서가 다른 수를 읽는 상태가 되고, 그 어긋남은 저장 시점에야 V-03으로 드러난다.
 *
 * 형식이 아니면 `NaN`이다 — 오류 문구는 계약이 낸다(V-20).
 */
export function countOf(raw: string | undefined): number {
  const trimmed = (raw ?? '').trim()
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN
}

/** 행 추가 — 빈 값으로 이름을 만든다. 상한을 넘으면 그대로 둔다 */
export function addRow(
  values: Record<string, string>,
  field: string,
  subs: readonly string[],
  max: number,
): Record<string, string> {
  const count = rowCountOf(values, field)
  if (count >= max) return values

  const next = { ...values }
  for (const sub of subs) next[path(field, count, sub)] = ''
  return next
}

/**
 * 행 삭제 — **뒤의 행을 앞으로 당긴다.**
 *
 * 인덱스를 비워 두면 `underlyings[1]`이 없는 채 `[2]`가 남고, 파서가 그 구멍을
 * 빈 행으로 읽어 계약이 「기초자산을 선택한다」를 존재하지 않는 행에 붙인다.
 * 마지막 행은 지우지 않는다(V-02).
 */
export function removeRow(
  values: Record<string, string>,
  field: string,
  subs: readonly string[],
  index: number,
): Record<string, string> {
  const count = rowCountOf(values, field)
  if (count <= 1 || index < 0 || index >= count) return values

  const next = { ...values }
  for (let row = index; row < count - 1; row += 1) {
    for (const sub of subs) {
      next[path(field, row, sub)] = next[path(field, row + 1, sub)] ?? ''
    }
  }
  for (const sub of subs) delete next[path(field, count - 1, sub)]
  return next
}

/**
 * 일괄 배리어를 차수별 칸에 **펼친다** — SQ-04 (P4 컷 4b)
 *
 * ## 왜 칸에 쓰는가 (일괄 입력을 그대로 파싱하지 않는가)
 *
 * 배리어의 정본을 일괄 칸으로 두면 계약이 돌려주는 `schedules[2].barrier` 오류가
 * **어느 칸과도 짝지어지지 않는다** — 상단 요약으로 밀리고, 가장 흔한 오류가 가장
 * 먼 자리에 표시된다. 차수별 칸에 펼치면 오류가 그 차수에 붙고 차수별 수정
 * (스텝다운이 아닌 구조)도 같은 칸에서 된다. 일괄 입력은 **채우는 도구**다.
 *
 * ## 총 차수가 비어 있으면 채운다
 *
 * 비어 있을 때만 채운다 — 사용자가 적은 숫자를 우리가 바꾸지 않는다. 다르면
 * 안내로 알린다(V-03이 저장 시점에 같은 사실을 오류로 말한다).
 */
export function applyBarriers(values: Record<string, string>): {
  values: Record<string, string>
  notice: string
} {
  const list = parseBarrierList(values[BARRIERS_FIELD] ?? '')
  if (list.tokens.length === 0) {
    return {
      values,
      notice: '배리어를 적고 「일괄 적용」을 누른다. 예: 90-85-80-75-70-65',
    }
  }

  const next = { ...values }
  if (roundCountOf(next) === 0) {
    next.totalRounds = String(Math.min(list.tokens.length, MAX_ROUNDS))
  }

  const rounds = roundCountOf(next)
  for (let index = 0; index < Math.min(rounds, list.tokens.length); index += 1) {
    next[path('schedules', index, 'barrier')] = list.tokens[index]!
  }

  return { values: next, notice: barrierNotice(list, rounds) }
}

// ---------------------------------------------------------------------------
// 전이 한 번 — 액션이 부르는 유일한 함수
// ---------------------------------------------------------------------------

export type Transition = {
  intent: Intent
  /** 이 제출 뒤에 렌더할 단계 */
  step: StepId
  /** 다음 렌더의 값. 폼의 모든 이름으로 **좁혀져** 있다 */
  values: Record<string, string>
  counts: RowCounts
  /** 사용자에게 알릴 것 — 오류가 아니다(일괄 적용 결과 등) */
  notice: string | null
}

/**
 * `FormData` → 다음 렌더 상태. **액션에 남는 것은 이 호출과 계약 호출뿐이다.**
 *
 * 어댑터(`app/<route>/actions.ts`)는 `server.ts`를 끌어오므로 어떤 스위트의 import
 * 그래프에도 들어갈 수 없다(AQ-23). 단계 전이·행 연산·값 좁힘이 거기 있으면
 * 그만큼이 영구 미검증이므로 전부 여기 있다 — `FormData`는 Node 전역이고 이
 * 파일은 `next`도 `react`도 모른다.
 */
export function transition(form: FormData): Transition {
  const intent = parseIntent(readText(form, INTENT_FIELD))
  const current = parseStep(readText(form, STEP_FIELD))

  let raw = readAll(form)
  let notice: string | null = null

  switch (intent.kind) {
    case 'ADD_UNDERLYING': {
      const before = rowCountOf(raw, 'underlyings')
      raw = addRow(raw, 'underlyings', UNDERLYING_SUBS, MAX_UNDERLYINGS)
      if (rowCountOf(raw, 'underlyings') === before) {
        notice = `기초자산은 ${MAX_UNDERLYINGS}종까지 입력한다.`
      }
      break
    }
    case 'REMOVE_UNDERLYING': {
      const before = rowCountOf(raw, 'underlyings')
      raw = removeRow(raw, 'underlyings', UNDERLYING_SUBS, intent.index)
      if (rowCountOf(raw, 'underlyings') === before) {
        // 마지막 한 행은 지울 수 없다 — V-02가 0건을 거부한다.
        notice = '기초자산은 1종 이상 필요하다.'
      }
      break
    }
    case 'APPLY_BARRIERS': {
      const applied = applyBarriers(raw)
      raw = applied.values
      notice = applied.notice
      break
    }
    default:
      break
  }

  const counts: RowCounts = {
    underlyings: rowCountOf(raw, 'underlyings'),
    rounds: roundCountOf(raw),
  }
  const step = moveStep(current, intent)

  const values: Record<string, string> = { [STEP_FIELD]: step }
  for (const name of productFieldNames(counts)) {
    if (name === STEP_FIELD) continue
    values[name] = raw[name] ?? ''
  }

  return { intent, step, values, counts, notice }
}

// ---------------------------------------------------------------------------
// 전이 → 폼 상태 — 어댑터 둘이 공유한다 (P4 컷 5)
// ---------------------------------------------------------------------------

/**
 * 제출이 아닌 전이의 결과 상태.
 *
 * `initialFormState`를 쓰는 이유는 이전 제출의 오류가 다음 단계까지 따라오면
 * 「고쳤는데도 빨간 글씨가 남는」 상태가 되기 때문이다. 안내(`notice`)는 오류가
 * 아니므로 `status`를 바꾸지 않는다 — 일괄 적용의 해석 모드가 그 자리다(SQ-04).
 */
export function stepState(next: Transition): FormState {
  const state = initialFormState(next.values)
  return next.notice == null ? state : { ...state, message: next.notice }
}

/**
 * 제출 실패의 결과 상태 — **오류가 있는 단계로 되돌린다.**
 *
 * ④에서 저장했는데 오류가 ①에 있으면 사용자는 그 문구를 볼 수 없다(그 칸이 히든이다).
 * `knownNames`가 **폼 전체**의 이름인 것도 같은 이유다 — 활성 단계의 것만 주면 다른
 * 단계의 오류가 전부 미매칭으로 상단에 쌓이고 정작 칸에는 표시되지 않는다.
 *
 * **등록과 수정이 이 함수를 공유한다.** 어댑터마다 적으면 한쪽만 고쳐지는 날이 오고,
 * 그때 그 화면에서만 오류가 보이지 않는다 — 두 어댑터는 어떤 스위트의 import 그래프에도
 * 없으므로(AQ-23) 그 갈림을 아무도 보지 못한다.
 */
export function submitState<T>(result: ActionResult<T>, next: Transition): FormState {
  const state = toFormState(result, next.values, productFieldNames(next.counts))
  const failed = stepForErrors(state.fieldErrors)

  return failed == null
    ? state
    : { ...state, values: { ...state.values, [STEP_FIELD]: failed } }
}

/**
 * 폼의 이름만 남긴다 — `$ACTION_*`·`intent`는 상태에 담지 않는다.
 *
 * `valuesOf(form)`을 그대로 쓰면 React의 액션 필드가 상태에 들어오고, 그 상태는
 * 다음 제출을 위해 **폼에 다시 직렬화된다**(컷 1b에서 `$ACTION_*`가 히든 필드로
 * 렌더되는 것을 실측했다). 단계 폼은 값이 많으므로 그 왕복이 커지고, 무엇보다
 * 상태에 무엇이 있는지가 흐려진다.
 */
function readAll(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

function readText(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
