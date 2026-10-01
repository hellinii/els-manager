import { dec } from '@/lib/decimal'
import { KI_OBSERVATION_LABELS, PRODUCT_CURRENCY_LABELS } from '@/lib/format/labels'

import { productDefaults } from './defaults'
import { path } from './fieldPath'

/**
 * 수정 화면의 불러오기 — **저장값 위에 불러온 값** (DOC-008 §5 SCR-204 v2.12 · SQ-10)
 *
 * 규칙은 하나다: **원천에 있는 것은 불러온 값, 없는 것은 저장값.** 칸마다 무엇이 이길지 고르게
 * 하지 않는다 — 불러오기를 누른 것이 「조건을 키움 값으로 맞춘다」는 선택이고, 저장하기 전에는
 * 아무것도 바뀌지 않는다(DOC-011 X-04). 그 대신 **무엇을 덮는지 말한다**(`storedChangesOf`).
 *
 * ## 칸 단위로 합치지 않는다
 *
 * `{ ...저장값, ...불러온 값 }`이면 저장값이 7차수·기초자산 3종이고 불러온 상품이 6차수·2종일 때
 * 저장값의 `schedules[6].*`·`underlyings[2].*`가 **남는다** — 폼은 행을 키로 세므로 어느 원천에도
 * 없는 상품이 그려진다. 그래서 바닥은 저장값이 아니라 **기본값**이고, 저장값에서는 원천에 없는
 * 칸만 가져온다.
 */

/**
 * 원천에 없는 칸 — 수정 화면에서 저장값이 남는다.
 *
 * 앞의 셋은 계좌 정보이고 `importFillOf`가 절대 채우지 않는다(그 파일의 각주). 관찰방식은 안내
 * 화면에 없어 `importFillOf`가 비운다(SQ-09) — 수정 화면에서는 저장값이 사용자가 투자설명서로 고른
 * 값이다.
 *
 * **상품 통화는 여기 없다 (P8 컷 a4)** — 원천에 «있을 수도» 있는 칸이다. 증인이 있으면 불러온 값이고
 * 없으면 저장값이다(`importOverStored` · DOC-010 ADR-009 §7). 컷 a2~a3 동안 이 목록에 있었다 — 그때는
 * 불러오기가 통화를 채우지 않았고, 빠뜨리면 바닥의 `currency: ''`가 이겨 저장이 V-22로 막혔다.
 */
export const IMPORT_KEEPS_STORED = ['principal', 'accountType', 'note', 'kiObservation'] as const

/**
 * 저장값 위에 불러온 값.
 *
 * ## 상품 통화와 투자원금은 함께 움직인다 (DOC-011 X-07 · DOC-008 SCR-204)
 *
 * - 불러온 통화가 있으면 그것, 없으면(증인 없음 — `importFillOf`가 빈칸으로 둔다) 저장값이다.
 * - **불러온 통화가 저장값과 다르면 투자원금을 비운다.** 투자원금은 원천에 없어 저장값이 남는데,
 *   통화만 바뀌면 `10000000`(원)이 $10,000,000.00이 된다 — 형식이 정상이고 값만 거짓이며 자릿수가
 *   맞으므로 V-23도 잡지 못한다. 환산하지 않는다(환율은 계약 조건이 아니다) — 비워서 다시 적게 한다.
 * - 같으면 아무것도 비우지 않는다 — 같은 상품을 다시 불러와도 투자원금이 지워지지 않는다.
 */
export function importOverStored(
  stored: Readonly<Record<string, string>>,
  imported: Readonly<Record<string, string>>,
): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const name of IMPORT_KEEPS_STORED) kept[name] = stored[name] ?? ''
  // V-16 — 관찰방식은 KI 배리어의 짝이다. 불러온 상품이 노낙인이면 저장값을 실으면 저장이 거부된다
  if ((imported.kiBarrier ?? '') === '') kept.kiObservation = ''
  const storedCurrency = stored.currency ?? ''
  const importedCurrency = imported.currency ?? ''
  kept.currency = importedCurrency === '' ? storedCurrency : importedCurrency
  if (currencyChangedBy(stored, imported)) kept.principal = ''
  return { ...productDefaults(), ...imported, ...kept }
}

/**
 * 불러온 상품 통화가 저장값과 다른가 — X-07의 조건. `importOverStored`가 이 참일 때만 투자원금을 비우고,
 * `importPanelOf`가 같은 함수로 안내를 붙인다(조건을 두 곳에 따로 적지 않는다).
 */
export function currencyChangedBy(
  stored: Readonly<Record<string, string>>,
  imported: Readonly<Record<string, string>>,
): boolean {
  const importedCurrency = imported.currency ?? ''
  return importedCurrency !== '' && importedCurrency !== (stored.currency ?? '')
}

/**
 * 불러온 폼에 사람이 채울 곳이 남았는가 — 수정 화면의 「일부 채움」 판정 (DOC-008 SCR-204 상태 표)
 *
 * 값으로 판정한다: 비어 있는 기초자산(미해결·중복) · KI 상품의 빈 관찰방식 · 빈 상품 통화 · 빈 투자원금.
 * 수정 화면에서만 부른다 — **저장값이 빈칸을 메운다**(관찰방식 · 증인 없는 상품 통화). 다른 빈 곳이 없는
 * KI 상품은 「불러옴」이다.
 *
 * **빈 투자원금은 X-07이 비운 것이다**(저장값은 `NOT NULL`이라 그 밖에는 비지 않는다). 사람이 새 통화로
 * 다시 적어야 하므로 빈 곳이다 — 「불러옴」으로 두면 수정 화면의 그 문구 「투자원금 · 계좌유형 · 비고는
 * 저장값 그대로다」가 거짓인 렌더가 생긴다(DOC-011 v4.14).
 */
export function hasImportGaps(values: Readonly<Record<string, string>>): boolean {
  for (let index = 0; values[path('underlyings', index, 'assetId')] != null; index += 1) {
    if (values[path('underlyings', index, 'assetId')] === '') return true
  }
  if ((values.currency ?? '') === '' || (values.principal ?? '') === '') return true
  return (values.kiBarrier ?? '') !== '' && (values.kiObservation ?? '') === ''
}

/** 관찰방식의 저장값을 남긴 KI 상품 — `importFillOf`의 「투자설명서에서 확인해 고른다」를 대신한다 */
export const KEPT_OBSERVATION_NOTE = '관찰방식은 안내 화면에 없다 — 저장값을 남겼다. 투자설명서와 대조한다.'

/** 노낙인 상품을 불러와 관찰방식의 저장값을 비웠다 — V-16. 문구가 「저장값 그대로」라고 말하지 않으므로 칸이 말한다 */
export const CLEARED_OBSERVATION_NOTE = '불러온 상품은 노낙인이다 — 관찰방식을 비웠다(KI 배리어가 없으면 둘 수 없다).'

/** 불러온 상품의 통화를 확인하지 못했다 — 수정 화면은 저장값을 남긴다(ADR-009 §7). 등록의 「고른다」를 대신한다 */
export const KEPT_CURRENCY_NOTE = '상품 통화를 안내 화면에서 확인하지 못했다 — 저장값을 남겼다. 투자설명서와 대조한다.'

/** X-07 — 불러온 상품 통화가 저장값과 달라 투자원금을 비웠다. 구획이 말한다(DOC-008 SCR-204) */
export const CURRENCY_CHANGED_NOTE = '상품 통화가 저장값과 다르다 — 투자원금을 비웠다. 새 통화로 다시 적는다.'

/** 키움에서 상환된 상품 — 수정 화면에는 상품이 이미 있다. 기실현 등재가 아니라 상환 처리다 */
export const EDIT_REDEEMED_NOTE = '키움에서는 이미 상환된 상품이다 — 상환 기록은 상세의 상환 처리에서 한다.'

export type StoredChanges = {
  /** 구획 머리의 한 줄 — 저장값과 다른 곳 */
  summary: string
  /** 스칼라 칸의 힌트 — 그 칸의 저장값 */
  fieldNotes: Record<string, string>
}

/**
 * 스칼라 칸 — 이름은 폼의 라벨 그대로다(단위 괄호만 뺀다). `hinted`는 `ProductForm`·`ConditionStep`이
 * `fieldNotes`를 잇는 칸이다 — 총 차수에는 힌트가 없다(차수표의 행 수가 곧 그 값이다).
 */
const SCALARS: ReadonlyArray<{ name: string; label: string; hinted: boolean }> = [
  { name: 'name', label: '상품명', hinted: true },
  { name: 'issuer', label: '발행사', hinted: true },
  { name: 'issueDate', label: '발행일', hinted: true },
  // 불러온 통화가 저장값과 다르면 이 둘이 함께 바뀐다(X-07) — 투자원금은 그때만 다르다
  { name: 'currency', label: '상품 통화', hinted: true },
  { name: 'principal', label: '투자원금', hinted: true },
  { name: 'evaluationPeriodMonths', label: '평가주기', hinted: true },
  { name: 'totalRounds', label: '총 차수', hinted: false },
  { name: 'annualCouponRate', label: '연쿠폰율', hinted: true },
  { name: 'kiBarrier', label: 'KI 배리어', hinted: true },
  { name: 'kiObservation', label: '관찰방식', hinted: true },
]

/**
 * 차수 칸 — 한 차수에서 하나라도 다르면 그 차수를 센다. 리자드는 셋이 한 조건이다.
 * 이름은 DOC-005 §8.2를 따른다 — 수식어 없는 「배리어」를 쓰지 않는다(`barrier`는 조기상환 배리어다).
 */
const ROUND_GROUPS: ReadonlyArray<{ label: string; subs: readonly string[] }> = [
  { label: '평가일', subs: ['evaluationDate'] },
  { label: '조기상환 배리어', subs: ['barrier'] },
  { label: '리자드 조건', subs: ['lizardBarrier', 'lizardCouponRate', 'lizardRequiresNoKi'] },
]

/**
 * 저장값과 합친 폼의 차이 — 수정 화면의 불러오기는 **덮어쓰기**이므로 무엇을 덮는지 보여야 한다.
 *
 * - 수는 **값으로** 비교한다 — 저장값은 `::text`(`71000.000000`)이고 불러온 값은 안내 화면의 자릿수다.
 *   문자열로 비교하면 같은 기준가가 전부 「다르다」가 된다
 * - 기초자산은 **구성으로** 비교한다 — 워스트오브에 순서가 없고, 키움 표의 순서가 사용자가 적은
 *   순서와 다를 수 있다. 기준가는 같은 자산끼리만 본다
 * - 차수는 두 쪽 중 긴 쪽까지 센다 — 한쪽에만 있는 차수는 다르다
 */
export function storedChangesOf(
  stored: Readonly<Record<string, string>>,
  merged: Readonly<Record<string, string>>,
): StoredChanges {
  const parts: string[] = []
  const fieldNotes: Record<string, string> = {}

  for (const { name, label, hinted } of SCALARS) {
    const before = stored[name] ?? ''
    if (sameValue(before, merged[name] ?? '')) continue
    parts.push(label)
    if (hinted) fieldNotes[name] = `저장값 ${display(name, before)}`
  }

  const rounds = Math.max(rowCount(stored, 'schedules', 'barrier'), rowCount(merged, 'schedules', 'barrier'))
  for (const { label, subs } of ROUND_GROUPS) {
    let differs = 0
    for (let index = 0; index < rounds; index += 1) {
      const at = (sub: string) => path('schedules', index, sub)
      if (subs.some((sub) => !sameValue(stored[at(sub)] ?? '', merged[at(sub)] ?? ''))) differs += 1
    }
    if (differs > 0) parts.push(`${label}(${differs}개 차수)`)
  }

  const before = underlyingsOf(stored)
  const after = underlyingsOf(merged)
  const sameSet =
    before.size === after.size && [...before.keys()].every((id) => after.has(id)) && !after.has('')
  if (!sameSet) parts.push('기초자산')
  let priced = 0
  for (const [id, price] of after) {
    if (id !== '' && before.has(id) && !sameValue(before.get(id)!, price)) priced += 1
  }
  if (priced > 0) parts.push(`기준가격(${priced}종)`)

  return {
    summary:
      parts.length === 0
        ? '저장값과 같다 — 불러온 값이 바꾸는 칸이 없다.'
        : `저장값과 다른 곳 — ${parts.join(', ')}. 저장하기 전에는 바뀌지 않는다.`,
    fieldNotes,
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/

function sameValue(a: string, b: string): boolean {
  const left = a.trim()
  const right = b.trim()
  if (DECIMAL.test(left) && DECIMAL.test(right)) return dec(left).eq(dec(right))
  return left === right
}

function display(name: string, value: string): string {
  if (value === '') return '없음'
  if (name === 'kiObservation') return KI_OBSERVATION_LABELS[value as keyof typeof KI_OBSERVATION_LABELS] ?? value
  if (name === 'currency') return PRODUCT_CURRENCY_LABELS[value as keyof typeof PRODUCT_CURRENCY_LABELS] ?? value
  return value
}

/** 행 수 — 폼과 같이 키로 센다(`importFormKey`와 같은 방식) */
function rowCount(values: Readonly<Record<string, string>>, name: string, sub: string): number {
  let index = 0
  while (values[path(name, index, sub)] != null) index += 1
  return index
}

/** 자산 id → 기준가. 빈 id(미해결)는 `''` 한 칸으로 모인다 — 있으면 구성이 다르다 */
function underlyingsOf(values: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (let index = 0; index < rowCount(values, 'underlyings', 'assetId'); index += 1) {
    map.set(values[path('underlyings', index, 'assetId')]!, values[path('underlyings', index, 'basePrice')] ?? '')
  }
  return map
}
