import Link from 'next/link'

import { INPUT_CLASS } from '@/components/form/Field'
import { ImportAssetForm } from '@/components/products/ImportAssetForm'
import type { ImportAssetState } from '@/lib/forms/import'
import {
  IMPORT_AUTHORITY_NOTE,
  IMPORT_PANEL_STATES,
  importPanelMessageOf,
  type ImportPanelTone,
} from '@/lib/format/importNotice'
import type { ImportPanel } from '@/lib/forms/importPanel'
import { IMPORT_KEYS, importHref, importTargetPath } from '@/lib/forms/query'

/**
 * SCR-204 불러오기 구획 — **주소가 상태다** (DOC-008 §5 SCR-204 v2.9, DOC-001 S-12)
 *
 * 서버 컴포넌트다. 검색은 GET 폼(`?q=`), 선택은 링크(`?q&code=`)이며 서버 액션이 아니다
 * (DOC-011 §1.2·§4.10) — JS 없이 동작하고 뒤로 가기가 후보 목록으로 돌아간다.
 *
 * **판단은 여기 없다.** 상태·후보 정렬·거부 사유·안내는 `importPanelOf`가 이미 정했고 이
 * 컴포넌트는 그린다 — 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23).
 *
 * ## 후보 링크는 `prefetch={false}`다
 *
 * 방어적 선택이며 근거는 추정이다 — 보이는 후보마다 상세 조회(키움 요청 다섯 — ADR-009 §5)가 날 수 있다는 것을
 * 측정하지 않았다(DOC-008 v2.9). 사람이 고른 하나만 부르는 것이 ADR-009 §5의 「순회하지 않는다」다.
 *
 * ## 오류 색을 쓰지 않는다
 *
 * 불러오기는 보조 기능이다 — 실패해도 아래 폼으로 직접 입력한다(ST-03). 빨간색은 저장 검증에만 쓴다.
 *
 * ## 등록·수정 두 화면에 선다 (DOC-008 v2.12)
 *
 * 주소의 경로는 `panel.target`에서 나온다(`importHref`) — 검색 폼의 대상·링크·형제 폼의 복귀가 같은
 * 경로를 가리켜야 수정 화면의 검색이 등록 화면으로 새지 않는다. 문구가 다른 곳은 머리 안내와 검색 칸의
 * 설명 둘이다(수정 화면에는 저장값이 있다).
 */
export function KiwoomImport({
  panel,
  assetAction,
}: {
  panel: ImportPanel
  /**
   * 미해결 기초자산의 형제 폼이 부를 어댑터(`importAssetAction`). 이 구획은 상품 폼 **밖**에
   * 있으므로 폼 중첩이 생기지 않는다
   */
  assetAction: (prev: ImportAssetState, form: FormData) => Promise<ImportAssetState>
}) {
  const state = IMPORT_PANEL_STATES[panel.state]
  const message = importPanelMessageOf(panel.state, panel.target.kind)
  const editing = panel.target.kind === 'EDIT'

  return (
    <section
      aria-labelledby="kiwoom-import-title"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4"
    >
      <h2 id="kiwoom-import-title" className="text-sm font-semibold">
        키움 ELS 불러오기
      </h2>

      {/* 검색 — GET 폼. 버튼은 「찾기」다(「저장」이 아니다 — 상품 폼의 저장 버튼과 섞이지 않는다) */}
      <form method="GET" action={importTargetPath(panel.target)} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kiwoom-import-query" className="text-sm font-medium">
            회차
          </label>
          <input
            id="kiwoom-import-query"
            name={IMPORT_KEYS.query}
            type="search"
            defaultValue={panel.query ?? ''}
            placeholder="예: 4000"
            maxLength={30}
            className={INPUT_CLASS}
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          찾기
        </button>
        <p className="w-full text-xs text-neutral-500">
          {editing
            ? '상품명의 번호를 적는다(차수가 아니다). 불러오면 조건 칸이 키움 값으로 바뀐다 — 투자원금·계좌유형·비고와 KI 상품의 관찰방식은 저장값이 남고, 저장하기 전에는 아무것도 바뀌지 않는다.'
            : '상품명의 번호를 적는다(차수가 아니다). 불러오면 아래 폼이 새로 채워진다 — 투자원금·계좌유형은 불러온 뒤 적는다.'}
        </p>
      </form>

      {message != null && <Notice tone={state.tone}>{message}</Notice>}

      {panel.code != null && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {panel.productName != null && <strong className="font-medium">{panel.productName}</strong>}
          <span className="text-neutral-500">{panel.code}</span>
          {panel.prospectusUrl != null && (
            <a
              href={panel.prospectusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              투자설명서
            </a>
          )}
          {panel.query != null && (
            <Link
              href={importHref(panel.target, { query: panel.query, code: null })}
              prefetch={false}
              className="text-neutral-600 underline"
            >
              다른 후보 보기
            </Link>
          )}
          <Link href={importTargetPath(panel.target)} prefetch={false} className="text-neutral-600 underline">
            불러오기 취소
          </Link>
        </div>
      )}

      {panel.state === 'CANDIDATES' && (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {panel.candidates.map(({ candidate, exact, refusal }) => (
            <li key={candidate.productCode} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={exact ? 'font-medium' : ''}>{candidate.name}</span>
                <span className="text-xs text-neutral-500">{candidate.productCode}</span>
                {candidate.redeemed && <span className="text-xs text-neutral-500">상환</span>}
              </div>
              <p className="text-xs text-neutral-600">
                {candidate.issueDate ?? '발행일 미상'} ~ {candidate.maturityDate ?? '만기일 미상'} ·{' '}
                {candidate.underlyingNames.join(', ')} · {candidate.ladderText.replace(/\s+/g, ' ')}
              </p>
              {refusal == null ? (
                <Link
                  href={importHref(panel.target, { query: panel.query, code: candidate.productCode })}
                  prefetch={false}
                  className="self-start rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100"
                >
                  불러오기
                </Link>
              ) : (
                <p className="text-xs text-amber-800">불러올 수 없다 — {refusal}</p>
              )}
            </li>
          ))}
          {panel.truncated && (
            <li className="px-3 py-2 text-xs text-neutral-600">결과가 더 있다 — 검색어를 더 적는다.</li>
          )}
        </ul>
      )}

      {panel.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-900">
          {panel.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {(panel.state === 'FILLED' || panel.state === 'PARTIAL' || panel.state === 'REFUSED') && (
        <p className="text-xs text-neutral-600">{IMPORT_AUTHORITY_NOTE}</p>
      )}

      {panel.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-neutral-700">
          {panel.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {panel.unresolved.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">앱 자산과 잇지 못한 기초자산</p>
          {panel.unresolved.map((asset) => (
            <ImportAssetForm
              key={asset.name}
              asset={asset}
              target={panel.target}
              back={{ query: panel.query, code: panel.code }}
              action={assetAction}
            />
          ))}
        </div>
      )}
    </section>
  )
}

const TONE_CLASS: Record<ImportPanelTone, string> = {
  plain: 'text-sm text-neutral-700',
  info: 'rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900',
  warn: 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900',
}

function Notice({ tone, children }: { tone: ImportPanelTone; children: React.ReactNode }) {
  return <p className={TONE_CLASS[tone]}>{children}</p>
}
