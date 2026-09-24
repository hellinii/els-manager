import type { AssetOption } from '@/lib/db/queries/prices'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { AssetInput, ProviderSymbolInput } from '@/lib/db/mutations/types'
import { PROVIDER_ID, UNDERLYING_TYPES } from '@/lib/providers/kiwoom/endpoints'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import { formatSymbol, parseSymbol } from '@/lib/providers/kiwoom/symbols'
import type { KiwoomProductCandidate } from '@/lib/providers/kiwoom/terms-types'

import { normalizeAssetName } from './importAssets'
import { optionalText, text } from './parse'
import { isUuid, parseImportQuery, type ImportQuery } from './query'

/**
 * SCR-204 불러오기의 배관 — **순수**하다 (DOC-008 §5 SCR-204 v2.9)
 *
 * 화면(`page.tsx`·`KiwoomImport.tsx`)과 어댑터(`actions.ts`)에 남는 것은 배선뿐이고 규칙은 전부
 * 여기 있다 — 그 둘은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 없다(AQ-23).
 *
 * | 무엇 | 함수 |
 * |---|---|
 * | 후보 목록 — 정렬·거부 사유 | `candidateRowsOf` |
 * | 폼을 다시 마운트할 키 | `importFormKey` |
 * | 미해결 기초자산 — 자산 추가 제안 | `assetProposalOf` |
 * | 미해결 기초자산 — 기존 자산에 연결 후보 · 다른 심볼에 이미 연결된 자산 | `linkChoicesOf` · `mappedElsewhereOf` |
 * | 자산 추가·연결 제출 | `parseImportAssetForm` → `runImportAsset` |
 */

// ---------------------------------------------------------------------------
// 후보 목록
// ---------------------------------------------------------------------------

export type CandidateRow = {
  candidate: KiwoomProductCandidate
  /** 회차가 검색어와 정확히 같다 — 위로 올린다 */
  exact: boolean
  /** 불러올 수 없는 상품이면 사유. 링크를 그리지 않는다 */
  refusal: string | null
}

/**
 * es020 결과 → 화면의 후보 행.
 *
 * 검색이 **부분 일치**라 「795」가 「3795회」·「2795호」도 낸다(실측). 회차가 검색어의 숫자와
 * 정확히 같은 것을 위로 올린다 — 나머지 순서는 원천의 순서 그대로다(안정 정렬).
 *
 * 거부 사유는 **목록에서 알 수 있는 것만** 미리 말한다(월지급·외화). 나머지(표 ≠ 사다리 등)는
 * 상세를 받아야 알 수 있고 그때 불러오기가 거부한다.
 */
export function candidateRowsOf(
  query: string,
  candidates: readonly KiwoomProductCandidate[],
): CandidateRow[] {
  const wanted = /(\d+)\s*[회호]?\s*$/.exec(query.trim())?.[1] ?? null
  const rows = candidates.map((candidate) => ({
    candidate,
    exact: wanted != null && candidate.roundNumber === wanted,
    refusal: candidateRefusal(candidate),
  }))
  return [...rows.filter((r) => r.exact), ...rows.filter((r) => !r.exact)]
}

function candidateRefusal(candidate: KiwoomProductCandidate): string | null {
  if (candidate.monthlyPay || candidate.ladder.monthly) return '월지급식 — 이 모델이 표현하지 못한다'
  const foreign =
    candidate.ladder.dollar || (candidate.currency != null && candidate.currency !== 'KRW')
  return foreign ? '외화 상품 — 투자원금·세액이 원화를 전제한다' : null
}

// ---------------------------------------------------------------------------
// 폼 키
// ---------------------------------------------------------------------------

/**
 * `ProductForm`의 `key` — **바뀌면 폼이 다시 마운트된다.**
 *
 * `useActionState`의 초기값은 마운트 때 한 번 읽히므로 불러온 값이 바뀌면 폼을 새로 세워야 한다.
 * 해결된 자산 id를 키에 넣는 이유는 **같은 주소에서** 자산을 추가한 뒤에도 폼이 새 `assetId`를
 * 받아야 하기 때문이다(주소는 그대로이고 해석 결과만 달라진다).
 *
 * 대가: 다시 마운트되면 사용자가 적은 투자원금·계좌유형이 사라진다 — 구획이 「불러온 뒤 적는다」를
 * 말하는 것으로 받는다(DOC-008 v2.9).
 */
export function importFormKey(code: string | null, values: Readonly<Record<string, string>>): string {
  if (code == null) return 'blank'
  const ids: string[] = []
  for (let index = 0; values[`underlyings[${index}].assetId`] != null; index += 1) {
    ids.push(values[`underlyings[${index}].assetId`]!)
  }
  return `${code}:${ids.join(',')}`
}

// ---------------------------------------------------------------------------
// 자산 추가 제안
// ---------------------------------------------------------------------------

export type AssetProposal =
  | { ok: true; asset: AssetInput; providerSymbol: string }
  | { ok: false; reason: string }

/**
 * 키움 지수 코드 → 통화. **허용 목록이다** — 목록 밖의 지수는 추측하지 않고 거부한다.
 *
 * 선물(`_WTIF`·`_BRENTF`)과 금리(`_CD91`)는 여기 없다: 앱의 `assetType`(STOCK·INDEX·ETF)에 맞는
 * 칸이 없고, 가격이 아닌 값(금리)을 기준가로 저장하면 워스트오브가 무의미해진다.
 */
const INDEX_CURRENCY: Readonly<Record<string, string>> = {
  '201': 'KRW', // KOSPI200
  '150': 'KRW', // KOSDAQ150
  _SPX: 'USD',
  _SX5E: 'EUR',
  '_HK#HIDX': 'HKD',
  '_HK#HS': 'HKD',
  '_JP#NI225': 'JPY',
}

/** 국내 지수 — 시장을 KRX로 적는다. 해외는 시장을 생략한다(아래 각주) */
const DOMESTIC_INDEX = new Set(['201', '150'])

/**
 * 키움 목록의 한 행 → 자산 등록 입력(§5.10) + 심볼(§5.12).
 *
 * | 분류 | assetType | market | currency |
 * |---|---|---|---|
 * | 1 지수 (허용 목록) | INDEX | 국내면 KRX, 해외면 생략 | 목록의 통화 |
 * | 2 국내주식 (`A` + 6자리) | STOCK | KRX | KRW |
 * | 3 해외주식 | STOCK | 생략 | USD |
 *
 * **해외 시장을 생략하는 이유**: 거래소(NASDAQ·NYSE)는 es040 상세(`getBaseAssetDtlJson`)를
 * 자산마다 한 번 더 불러야 안다. 시장은 표시와 `(name, market)` 유일성에만 쓰이고 판정에 들어가지
 * 않으므로 요청을 늘리지 않는다. 이름은 키움 목록의 이름이다(`HSCEI 지수`).
 */
export function assetProposalOf(listed: ListedAsset): AssetProposal {
  const parsed = parseSymbol(`${listed.underlyingType}:${listed.stkCode}`)
  if ('code' in parsed) return { ok: false, reason: '키움 분류를 알 수 없다 — 직접 등록한다' }
  const providerSymbol = formatSymbol(parsed)

  switch (parsed.underlyingType) {
    case UNDERLYING_TYPES.INDEX: {
      const currency = INDEX_CURRENCY[parsed.stkCode]
      if (currency == null) {
        return { ok: false, reason: `${listed.name}은 지수 가격이 아니다(선물·금리) — 직접 등록한다` }
      }
      return {
        ok: true,
        providerSymbol,
        asset: DOMESTIC_INDEX.has(parsed.stkCode)
          ? { name: listed.name, assetType: 'INDEX', market: 'KRX', currency }
          : { name: listed.name, assetType: 'INDEX', currency },
      }
    }
    case UNDERLYING_TYPES.DOMESTIC_STOCK:
      if (!/^A\d{6}$/.test(parsed.stkCode)) {
        return { ok: false, reason: `국내 종목 코드 형식이 아니다(${parsed.stkCode}) — 직접 등록한다` }
      }
      return {
        ok: true,
        providerSymbol,
        asset: { name: listed.name, assetType: 'STOCK', market: 'KRX', currency: 'KRW' },
      }
    case UNDERLYING_TYPES.OVERSEAS_STOCK:
      return {
        ok: true,
        providerSymbol,
        asset: { name: listed.name, assetType: 'STOCK', currency: 'USD' },
      }
    default:
      return { ok: false, reason: '키움 분류를 알 수 없다 — 직접 등록한다' }
  }
}

// ---------------------------------------------------------------------------
// 기존 자산에 연결
// ---------------------------------------------------------------------------

export type LinkChoice = { id: string; name: string; preselected: boolean }

/**
 * 「기존 자산에 연결」의 선택지 — **키움 심볼이 없는 앱 자산**, 같은 통화만.
 *
 * 이미 키움 심볼이 있는 자산은 넣지 않는다 — 고르면 §5.12 UPSERT가 **그 자산의 기존 매핑을
 * 덮는다**(다른 상품의 시세가 바뀐다). 그런 자산은 `mappedElsewhereOf`가 따로 말한다.
 *
 * 정규화한 이름이 같은 것을 미리 고른다. 선택지가 하나라도 있으면 화면이 **연결을 먼저** 보이고
 * 추가는 「새 자산이 맞는가」를 묻는다 — 이름이 다른 같은 자산을 두 번 만들면 시세가 새 행에
 * 쌓이고 기존 상품은 옛 행을 본다(DOC-008 v2.9).
 */
export function linkChoicesOf(
  options: readonly AssetOption[],
  proposal: AssetInput,
): LinkChoice[] {
  const key = normalizeAssetName(proposal.name)
  return options
    .filter((option) => option.currency === proposal.currency)
    .filter((option) => !option.providerSymbols.some((row) => row.provider === PROVIDER_ID))
    .map((option) => ({
      id: option.id,
      name: option.name,
      preselected: normalizeAssetName(option.name) === key,
    }))
}

/**
 * 이름이 같은데 **다른 키움 심볼**에 이미 연결된 앱 자산 — 덮지 않고 SCR-302로 보낸다.
 *
 * 이름이 같다는 것만으로 같은 자산이라고 단정하지 않는다(그래서 연결 선택지에 넣지 않는다). 사람이
 * 매핑 화면에서 어느 쪽이 맞는지 본다.
 */
export function mappedElsewhereOf(
  options: readonly AssetOption[],
  name: string,
  symbol: string,
): Array<{ id: string; name: string; symbol: string }> {
  const key = normalizeAssetName(name)
  return options.flatMap((option) => {
    if (normalizeAssetName(option.name) !== key) return []
    const row = option.providerSymbols.find((r) => r.provider === PROVIDER_ID)
    return row == null || row.symbol === symbol ? [] : [{ id: option.id, name: option.name, symbol: row.symbol }]
  })
}

// ---------------------------------------------------------------------------
// 자산 추가·연결 제출 — 형제 폼 (`ImportAssetForm`)
// ---------------------------------------------------------------------------

/** 형제 폼의 의도. 상품 폼의 `intent`와 **다른 이름**이다 — 한 문서에 두 폼이 있다 */
export const IMPORT_ASSET_INTENT_FIELD = 'importIntent'

export type ImportAssetCommand =
  | { kind: 'CREATE'; asset: AssetInput; providerSymbol: string; back: ImportQuery }
  | { kind: 'LINK'; assetId: string; providerSymbol: string; back: ImportQuery }
  | { kind: 'INVALID'; message: string; back: ImportQuery }

/**
 * `FormData` → 명령. **쓰기 전에 심볼을 검사한다** — 자산을 만든 뒤 매핑이 형식 오류로 거부되면
 * 고아 자산(미매핑)이 남는다. 그 상태는 정상 상태이지만(ADR-007) 만들 이유가 없다.
 *
 * `provider`는 폼 칸이 아니다 — 불러오기는 키움 심볼만 다루므로 상수다(DOC-011 §5.12 v4.3).
 * 숨은 칸을 조작해도 얻는 것은 SCR-302가 이미 허용하는 것 이상이 아니다(공용 데이터, RLS `true`).
 */
export function parseImportAssetForm(form: FormData): ImportAssetCommand {
  const back = parseImportQuery({ q: text(form, 'q'), code: text(form, 'code') })
  const intent = text(form, IMPORT_ASSET_INTENT_FIELD)
  const providerSymbol = text(form, 'providerSymbol').trim()
  const parsed = parseSymbol(providerSymbol)
  if ('code' in parsed) return { kind: 'INVALID', message: `키움 심볼이 형식에 맞지 않는다: ${parsed.detail}`, back }

  if (intent === 'LINK') {
    const assetId = text(form, 'assetId').trim()
    if (!isUuid(assetId)) return { kind: 'INVALID', message: '연결할 자산을 고른다.', back }
    return { kind: 'LINK', assetId, providerSymbol, back }
  }
  if (intent === 'CREATE') {
    const asset: AssetInput = {
      name: text(form, 'name'),
      assetType: text(form, 'assetType') as AssetInput['assetType'],
      currency: text(form, 'currency').toUpperCase(),
    }
    const market = optionalText(form, 'market')
    if (market != null) asset.market = market
    return { kind: 'CREATE', asset, providerSymbol, back }
  }
  return { kind: 'INVALID', message: '무엇을 할지 알 수 없는 제출이다.', back }
}

export type ImportAssetPorts = {
  createAsset(input: AssetInput): Promise<ActionResult<{ id: string }>>
  saveProviderSymbol(input: ProviderSymbolInput): Promise<ActionResult<void>>
}

export type ImportAssetOutcome =
  | { ok: true; back: ImportQuery }
  | { ok: false; message: string; back: ImportQuery }

/**
 * 자산 추가(§5.10 → §5.12) 또는 연결(§5.12) — **순서대로, 원자적이지 않다** (DOC-011 AQ-74).
 *
 * 둘째가 실패하면 자산은 있고 매핑이 없다 — **미매핑 자산**이며 ADR-007이 정상 상태로 정했다.
 * 재시도는 연결(§5.12, UPSERT)만 하면 된다. 그 안내를 문구가 한다.
 *
 * 계약은 포트로 받는다 — 어댑터가 `src/app/actions.ts`를 넘기고 테스트가 가짜를 넘긴다. 이 함수가
 * 던지지 않는 것은 계약이 던지지 않기 때문이다(`ActionResult`).
 */
export async function runImportAsset(
  command: ImportAssetCommand,
  ports: ImportAssetPorts,
): Promise<ImportAssetOutcome> {
  if (command.kind === 'INVALID') return { ok: false, message: command.message, back: command.back }

  if (command.kind === 'CREATE') {
    const created = await ports.createAsset(command.asset)
    if (!created.ok) {
      return {
        ok: false,
        back: command.back,
        message:
          created.error.code === 'CONFLICT'
            ? '같은 이름·시장의 자산이 이미 있다 — 「기존 자산에 연결」을 쓴다.'
            : created.error.message,
      }
    }
    const mapped = await ports.saveProviderSymbol({
      assetId: created.data.id,
      provider: PROVIDER_ID,
      providerSymbol: command.providerSymbol,
    })
    return mapped.ok
      ? { ok: true, back: command.back }
      : {
          ok: false,
          back: command.back,
          message: '자산은 등록됐지만 키움 심볼을 저장하지 못했다 — 「기존 자산에 연결」로 다시 시도한다.',
        }
  }

  const linked = await ports.saveProviderSymbol({
    assetId: command.assetId,
    provider: PROVIDER_ID,
    providerSymbol: command.providerSymbol,
  })
  return linked.ok ? { ok: true, back: command.back } : { ok: false, message: linked.error.message, back: command.back }
}
