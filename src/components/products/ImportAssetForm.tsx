'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { INPUT_CLASS } from '@/components/form/Field'
import { ASSET_TYPE_LABELS } from '@/lib/format'
import {
  IMPORT_ASSET_INITIAL,
  IMPORT_ASSET_INTENT_FIELD,
  type ImportAssetState,
} from '@/lib/forms/import'
import type { UnresolvedAsset } from '@/lib/forms/importPanel'
import { PRODUCT_ID_FIELD } from '@/lib/forms/productForm'
import { IMPORT_KEYS, type ImportTarget } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * 미해결 기초자산 하나의 **형제 폼** — 기존 자산에 연결 / 자산 추가 (DOC-008 §5 SCR-204 v2.10)
 *
 * 상품 폼 **밖**에 있다 — HTML이 폼 중첩을 허용하지 않는다(자산 등록 폼과 같은 자리). 그래서 이
 * 폼의 버튼은 「저장」이 아니고 의도 칸의 이름도 상품 폼의 `intent`와 다르다(`importIntent`).
 *
 * **판단은 여기 없다.** 무엇을 제안할지·어느 자산을 미리 고를지는 서버(`importPanelOf`)가 정했고
 * 이 컴포넌트는 그 값을 그린다 — 계산을 여기 두면 어댑터 모듈이 클라이언트 번들에 실린다.
 *
 * ## `<select>`는 미리 고른 값으로 키를 준다
 *
 * React가 폼 제출 뒤 자동 초기화할 때 `<select>`의 표시가 마운트 시점의 속성으로 돌아간다
 * (DOC-008 v1.8 (3), AQ-64). 값과 같은 식의 `key`로 다시 마운트해 표시를 맞춘다.
 *
 * 성공하면 어댑터가 같은 주소로 리다이렉트한다 — 페이지가 다시 불러오고 해결된 자산이 상품 폼에 들어간다.
 *
 * ## 수정 화면에서는 대상 상품 id를 싣는다 (DOC-008 v2.12)
 *
 * 복귀 주소가 `/products/[id]/edit`인데 라우트 파라미터는 서버 액션에 오지 않는다 — 상품 폼의
 * `PRODUCT_ID_FIELD`와 같은 이유이고 같은 이름을 쓴다. 조작된 id는 어댑터가 쓰기 **전에** 거른다.
 */
export function ImportAssetForm({
  asset,
  target,
  back,
  action,
}: {
  asset: UnresolvedAsset
  target: ImportTarget
  back: { query: string | null; code: string | null }
  action: (prev: ImportAssetState, form: FormData) => Promise<ImportAssetState>
}) {
  const [state, formAction] = useActionState(action, IMPORT_ASSET_INITIAL)
  const offer = asset.offer
  const idBase = `import-asset-${asset.name.replace(/[^0-9A-Za-z가-힣]/g, '')}`

  const hidden = (
    <>
      {back.query != null && <input type="hidden" name={IMPORT_KEYS.query} value={back.query} />}
      {back.code != null && <input type="hidden" name={IMPORT_KEYS.code} value={back.code} />}
      {offer != null && <input type="hidden" name="providerSymbol" value={offer.symbol} />}
      {target.kind === 'EDIT' && <input type="hidden" name={PRODUCT_ID_FIELD} value={target.productId} />}
    </>
  )

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm">
      <p className="font-medium">{asset.name}</p>

      {offer == null && <p className="text-xs text-neutral-600">{asset.detail}</p>}

      {offer != null && offer.elsewhere.length > 0 && (
        <p className="text-xs text-amber-800">
          같은 이름의 자산이 다른 키움 심볼({offer.elsewhere.map((e) => e.symbol).join(', ')})에 이미
          연결되어 있다 —{' '}
          <Link href={PATHS.prices} className="underline">
            시세 관리
          </Link>
          에서 어느 쪽이 맞는지 확인한다. 여기서 덮지 않는다.
        </p>
      )}

      {offer != null && offer.links.length > 0 && (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          {hidden}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idBase}-link`} className="text-xs text-neutral-600">
              기존 자산에 연결 ({offer.symbol})
            </label>
            <select
              id={`${idBase}-link`}
              name="assetId"
              key={offer.links.find((l) => l.preselected)?.id ?? ''}
              defaultValue={offer.links.find((l) => l.preselected)?.id ?? ''}
              className={INPUT_CLASS}
            >
              <option value="">자산을 고른다</option>
              {offer.links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            name={IMPORT_ASSET_INTENT_FIELD}
            value="LINK"
            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100"
          >
            연결
          </button>
        </form>
      )}

      {/*
        동명 자산이 다른 키움 심볼에 연결되어 있으면 「자산 추가」를 그리지 않는다(DOC-008 v2.11) —
        같은 이름·시장이면 늘 CONFLICT이고, 그 문구가 가리키는 연결 선택지에는 그 자산이 없다
        (덮지 않으려고 뺐다). 위 안내의 시세 관리 링크만 남는다.
      */}
      {offer != null && offer.proposal.ok && offer.elsewhere.length === 0 && (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          {hidden}
          <input type="hidden" name="name" value={offer.proposal.asset.name} />
          <input type="hidden" name="assetType" value={offer.proposal.asset.assetType} />
          {offer.proposal.asset.market != null && (
            <input type="hidden" name="market" value={offer.proposal.asset.market} />
          )}
          <input type="hidden" name="currency" value={offer.proposal.asset.currency} />
          <span className="text-xs text-neutral-600">
            새 자산: {offer.proposal.asset.name} · {ASSET_TYPE_LABELS[offer.proposal.asset.assetType]} ·{' '}
            {offer.proposal.asset.market ?? '시장 생략'} · {offer.proposal.asset.currency} · {offer.symbol}
          </span>
          {offer.links.length > 0 && (
            // 이름이 다른 같은 자산을 두 번 만들지 않게 한 번 묻는다 — JS 없이도 막히도록 `required`다
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="confirmNew" value="on" required className="size-3.5" />
              위 자산들과 다른 새 자산이 맞다
            </label>
          )}
          <button
            type="submit"
            name={IMPORT_ASSET_INTENT_FIELD}
            value="CREATE"
            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100"
          >
            자산 추가
          </button>
        </form>
      )}

      {offer != null && !offer.proposal.ok && (
        <p className="text-xs text-neutral-600">{offer.proposal.reason}</p>
      )}

      {state.message != null && (
        <p role="status" className="text-xs text-amber-900">
          {state.message}
        </p>
      )}
    </div>
  )
}
