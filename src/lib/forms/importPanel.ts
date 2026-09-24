import type { AssetOption } from '@/lib/db/queries/prices'
import { importPanelStateOf, type ImportPanelState } from '@/lib/format/importNotice'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import type {
  KiwoomProductCandidate,
  KiwoomProductTerms,
} from '@/lib/providers/kiwoom/terms-types'
import type { LookupOutcome } from '@/lib/providers/types'

import {
  assetProposalOf,
  candidateRowsOf,
  importFormKey,
  linkChoicesOf,
  mappedElsewhereOf,
  type AssetProposal,
  type CandidateRow,
  type LinkChoice,
} from './import'
import { resolveImportAssets, type AssetResolution } from './importAssets'
import { importFillOf, type ImportNote } from './importFill'
import {
  CLEARED_OBSERVATION_NOTE,
  EDIT_REDEEMED_NOTE,
  KEPT_OBSERVATION_NOTE,
  hasImportGaps,
  importOverStored,
  storedChangesOf,
} from './importMerge'
import type { ImportQuery, ImportTarget } from './query'

/**
 * SCR-204의 불러오기 — **페이지가 할 조립 전부** (DOC-008 §5 SCR-204 v2.9 · 수정 화면 v2.12)
 *
 * 페이지(`products/new/page.tsx`·`products/[id]/edit/page.tsx`)는 조회를 부르고 이 함수에 넘긴 뒤
 * 결과를 그린다. 조립을 페이지에 두면 「상세가 실패하면 무엇을 보이는가」·「자산 목록을 못 받으면
 * 채움이 어떻게 되는가」가 어떤 스위트에도 없다(AQ-23 — 페이지는 `server.ts`를 끌어온다).
 *
 * **입력은 이미 부른 조회의 결과뿐이다** — 이 함수는 부르지 않는다(DOC-011 §4.10은 화면이 부른다).
 *
 * ## 등록과 수정이 갈리는 곳은 채운 뒤 하나다
 *
 * `defaults`가 등록에서는 기본값, 수정에서는 **저장값**이다. 검색·거부·조회 실패는 `defaults`를 그대로
 * 폼에 두므로 두 화면이 같다. 채웠을 때만 다르다 — 등록은 기본값 위에 얹고, 수정은 원천에 없는 칸만
 * 저장값에서 가져온다(`importOverStored` — 칸 단위로 합치지 않는 이유가 그 파일에 있다).
 */

export type UnresolvedAsset = {
  /** 팝업 표의 이름 */
  name: string
  /** 해석 결과. 자산 목록을 받지 못했으면 `null`이다 — 제안할 재료가 없다 */
  resolution: AssetResolution | null
  /**
   * 형제 폼이 그릴 것 — **서버에서 계산해 평범한 값으로 넘긴다**(DOC-008 v2.10). 클라이언트가
   * 계산하면 어댑터 모듈이 클라이언트 번들에 실린다. `null`이면 제안이 없다(`detail`이 이유).
   */
  offer: {
    symbol: string
    /** 자산 추가 제안. 허용 목록 밖이면 거부 사유 */
    proposal: AssetProposal
    /** 기존 자산에 연결 — 키움 심볼 없는 같은 통화 자산 */
    links: LinkChoice[]
    /** 이름이 같은데 다른 키움 심볼에 연결된 자산 — SCR-302로 */
    elsewhere: Array<{ id: string; name: string; symbol: string }>
  } | null
  /** 제안이 없는 이유 */
  detail: string | null
}

export type ImportPanel = {
  /** 불러오기가 채우는 폼 — 구획의 주소(검색 폼·링크·형제 폼의 복귀)가 여기서 나온다 */
  target: ImportTarget
  state: ImportPanelState
  query: string | null
  code: string | null
  candidates: CandidateRow[]
  /** 검색 결과가 더 있다(100001) — 화면이 「검색어를 더 적는다」를 말한다 */
  truncated: boolean
  productName: string | null
  /** 투자설명서 PDF. 없으면 `null`(링크를 그리지 않는다) */
  prospectusUrl: string | null
  /** 거부 사유 — 거부일 때만 있다 */
  reasons: string[]
  /** 구획 머리의 안내 */
  notes: string[]
  /** 스칼라 칸의 안내 — `ProductForm`이 그 칸의 힌트에 덧붙인다 */
  fieldNotes: Record<string, string>
  unresolved: UnresolvedAsset[]
  /** 폼의 초기값 — 채웠으면 불러온 값(수정은 원천에 없는 칸만 저장값), 아니면 `defaults` 그대로 */
  initialValues: Record<string, string>
  /** `ProductForm`의 `key` */
  formKey: string
  /**
   * 이 렌더의 조회가 실패했다 — 폼은 **직전 키를 유지**한다(DOC-008 v2.11). 불러온 화면에서 다른
   * 변경(자산 등록 등)이 성공하면 페이지가 다시 그려지며 키움을 다시 부르는데, 그 한 번이 일시
   * 실패하면 키가 바뀌어 불러온 값과 적은 투자원금이 사라졌다(반박 검토).
   */
  keepPreviousKey: boolean
}

export function importPanelOf(input: {
  target: ImportTarget
  query: ImportQuery
  search: LookupOutcome<KiwoomProductCandidate[]> | null
  terms: LookupOutcome<KiwoomProductTerms> | null
  listed: LookupOutcome<ListedAsset[]> | null
  options: readonly AssetOption[]
  /** 폼의 출발점 — 등록은 `productDefaults()`, 수정은 `productValuesOf(view)`(저장값) */
  defaults: Record<string, string>
}): ImportPanel {
  const { query, code } = input.query
  const editing = input.target.kind === 'EDIT'
  const base: ImportPanel = {
    target: input.target,
    state: 'IDLE',
    query,
    code,
    candidates: [],
    truncated: false,
    productName: null,
    prospectusUrl: null,
    reasons: [],
    notes: [],
    fieldNotes: {},
    unresolved: [],
    initialValues: input.defaults,
    formKey: importFormKey(null, input.defaults),
    keepPreviousKey: false,
  }

  /* ---------- 후보를 고르기 전 — 검색만 */
  if (code == null) {
    const search = input.search
    const state = importPanelStateOf({
      query,
      code,
      search: search == null ? null : search.ok ? { ok: true, count: search.data.length } : { ok: false },
      fill: null,
    })
    return {
      ...base,
      state,
      candidates: search?.ok === true && query != null ? candidateRowsOf(query, search.data) : [],
      truncated: search?.ok === true && search.truncated === true,
    }
  }

  /* ---------- 상품을 골랐다 — 상세 */
  const terms = input.terms
  if (terms == null || !terms.ok) {
    // 빈 안내 화면(없는 코드)은 거부다 — 기다려도 채워지지 않는다. 그 밖은 조회 실패(ST-03)
    if (terms != null && terms.failure === 'NO_DATA') {
      return {
        ...base,
        state: 'REFUSED',
        reasons: ['키움 안내 화면에 이 상품의 조건이 없다 — 상품 코드를 확인하거나 직접 입력한다.'],
      }
    }
    return {
      ...base,
      state: importPanelStateOf({ query, code, search: null, fill: { failed: true } }),
      keepPreviousKey: true,
    }
  }

  const product = terms.data
  const prospectusUrl = product.documents.find((d) => d.kind === 'PROSPECTUS')?.url ?? null
  const notes: string[] = []

  const listed = input.listed
  let resolutions: Record<string, AssetResolution> = {}
  if (listed?.ok === true) {
    resolutions = resolveImportAssets({ assets: product.assets, listed: listed.data, options: input.options })
  } else {
    notes.push('키움 기초자산 목록을 받지 못해 기초자산을 앱 자산과 잇지 못했다 — 직접 고른다.')
  }

  const fill = importFillOf(product, resolutions)
  // 화면에 따라 갈리는 안내 — 수정 화면에는 상품이 이미 있다(DOC-008 v2.12)
  const textOf = (note: ImportNote) =>
    editing && note.topic === 'KIWOOM_REDEEMED' ? EDIT_REDEEMED_NOTE : note.text

  if (fill.kind === 'REFUSED') {
    return {
      ...base,
      state: importPanelStateOf({ query, code, search: null, fill: { kind: fill.kind } }),
      productName: product.name,
      prospectusUrl,
      reasons: fill.reasons,
      notes: [...notes, ...fill.notes.filter((n) => n.field == null).map(textOf)],
    }
  }

  const fieldNotes: Record<string, string> = {}
  for (const note of fill.notes) {
    if (note.field == null) notes.push(textOf(note))
    else fieldNotes[note.field] = note.text
  }

  let initialValues: Record<string, string>
  let kind = fill.kind
  if (editing) {
    initialValues = importOverStored(input.defaults, fill.values)
    // 저장값의 관찰방식이 「관찰방식 미정」을 메운다 — 다른 빈 곳이 없으면 불러옴이다
    if (kind === 'PARTIAL' && !hasImportGaps(initialValues)) kind = 'FILLED'
    if (initialValues.kiObservation !== '') fieldNotes.kiObservation = KEPT_OBSERVATION_NOTE
    // 노낙인 상품이 저장값을 비웠다(V-16) — 구획의 문구는 관찰방식을 말하지 않으므로 칸이 말한다
    else if ((input.defaults.kiObservation ?? '') !== '') fieldNotes.kiObservation = CLEARED_OBSERVATION_NOTE
    const changes = storedChangesOf(input.defaults, initialValues)
    notes.unshift(changes.summary)
    for (const [field, text] of Object.entries(changes.fieldNotes)) {
      fieldNotes[field] = fieldNotes[field] == null ? text : `${fieldNotes[field]} · ${text}`
    }
  } else {
    initialValues = { ...input.defaults, ...fill.values }
  }
  const state = importPanelStateOf({ query, code, search: null, fill: { kind } })

  return {
    ...base,
    state,
    productName: product.name,
    prospectusUrl,
    notes,
    fieldNotes,
    unresolved: fill.unresolved.map((name) =>
      unresolvedOf(name, listed?.ok === true ? (resolutions[name] ?? null) : null, input.options),
    ),
    initialValues,
    formKey: importFormKey(code, initialValues),
    // 기초자산 목록만 실패해도 해결된 id가 비어 키가 바뀐다 — 같은 이유로 직전 키를 유지한다
    keepPreviousKey: listed?.ok !== true,
  }
}

function unresolvedOf(
  name: string,
  resolution: AssetResolution | null,
  options: readonly AssetOption[],
): UnresolvedAsset {
  if (resolution == null) {
    return { name, resolution, offer: null, detail: '키움 기초자산 목록을 받지 못했다 — 기초자산 칸에서 직접 고른다.' }
  }
  switch (resolution.kind) {
    case 'NO_MAPPING': {
      const proposal = assetProposalOf(resolution.listed)
      return {
        name,
        resolution,
        detail: null,
        offer: {
          symbol: resolution.symbol,
          proposal,
          links: proposal.ok ? linkChoicesOf(options, proposal.asset) : [],
          elsewhere: mappedElsewhereOf(options, proposal.ok ? proposal.asset.name : name, resolution.symbol),
        },
      }
    }
    case 'NO_ES040':
      return { name, resolution, offer: null, detail: '키움 기초자산 목록에 없다 — 기초자산 칸에서 직접 고른다.' }
    case 'AMBIGUOUS':
      return { name, resolution, offer: null, detail: `${resolution.detail} — 기초자산 칸에서 직접 고른다.` }
    case 'RESOLVED':
      // 폼이 같은 앱 자산이 두 행에 풀린 것을 비웠다(V-09) — 사람이 고른다
      return { name, resolution, offer: null, detail: '앞 행과 같은 앱 자산으로 풀렸다 — 기초자산 칸에서 고른다.' }
  }
}
