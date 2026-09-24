import type { AssetOption } from '@/lib/db/queries/prices'
import { importPanelStateOf, type ImportPanelState } from '@/lib/format/importNotice'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'
import type {
  KiwoomProductCandidate,
  KiwoomProductTerms,
} from '@/lib/providers/kiwoom/terms-types'
import type { LookupOutcome } from '@/lib/providers/types'

import { candidateRowsOf, importFormKey, type CandidateRow } from './import'
import { resolveImportAssets, type AssetResolution } from './importAssets'
import { importFillOf } from './importFill'
import type { ImportQuery } from './query'

/**
 * SCR-204 등록 화면의 불러오기 — **페이지가 할 조립 전부** (DOC-008 §5 SCR-204 v2.9)
 *
 * 페이지(`products/new/page.tsx`)는 조회를 부르고 이 함수에 넘긴 뒤 결과를 그린다. 조립을 페이지에
 * 두면 「상세가 실패하면 무엇을 보이는가」·「자산 목록을 못 받으면 채움이 어떻게 되는가」가 어떤
 * 스위트에도 없다(AQ-23 — 페이지는 `server.ts`를 끌어온다).
 *
 * **입력은 이미 부른 조회의 결과뿐이다** — 이 함수는 부르지 않는다(DOC-011 §4.10은 화면이 부른다).
 */

export type UnresolvedAsset = {
  /** 팝업 표의 이름 */
  name: string
  /** 해석 결과. 자산 목록을 받지 못했으면 `null`이다 — 제안할 재료가 없다 */
  resolution: AssetResolution | null
}

export type ImportPanel = {
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
  /** 폼의 초기값 — 채웠으면 기본값 위에 불러온 값, 아니면 기본값 그대로 */
  initialValues: Record<string, string>
  /** `ProductForm`의 `key` */
  formKey: string
}

export function importPanelOf(input: {
  query: ImportQuery
  search: LookupOutcome<KiwoomProductCandidate[]> | null
  terms: LookupOutcome<KiwoomProductTerms> | null
  listed: LookupOutcome<ListedAsset[]> | null
  options: readonly AssetOption[]
  defaults: Record<string, string>
}): ImportPanel {
  const { query, code } = input.query
  const base: ImportPanel = {
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
    return { ...base, state: importPanelStateOf({ query, code, search: null, fill: { failed: true } }) }
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
  const state = importPanelStateOf({ query, code, search: null, fill: { kind: fill.kind } })

  if (fill.kind === 'REFUSED') {
    return {
      ...base,
      state,
      productName: product.name,
      prospectusUrl,
      reasons: fill.reasons,
      notes: [...notes, ...fill.notes.filter((n) => n.field == null).map((n) => n.text)],
    }
  }

  const fieldNotes: Record<string, string> = {}
  for (const note of fill.notes) {
    if (note.field == null) notes.push(note.text)
    else fieldNotes[note.field] = note.text
  }
  const initialValues = { ...input.defaults, ...fill.values }

  return {
    ...base,
    state,
    productName: product.name,
    prospectusUrl,
    notes,
    fieldNotes,
    unresolved: fill.unresolved.map((name) => ({
      name,
      resolution: listed?.ok === true ? (resolutions[name] ?? null) : null,
    })),
    initialValues,
    formKey: importFormKey(code, initialValues),
  }
}
