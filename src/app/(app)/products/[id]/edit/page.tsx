import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ImportedProductForm } from '@/components/products/ImportedProductForm'
import { KiwoomImport } from '@/components/products/KiwoomImport'
import { AccessDenied } from '@/components/system/AccessDenied'
import { getQueries } from '@/lib/db/server'
import { importPanelOf } from '@/lib/forms/importPanel'
import { isUuid, parseImportQuery, type QueryValues } from '@/lib/forms/query'
import { productValuesOf } from '@/lib/forms/values'
import { createKiwoomProductSource } from '@/lib/providers/kiwoom/terms'
import { PATHS } from '@/lib/routes/paths'

import { importAssetEditAction, productEditFormAction } from './actions'

/**
 * SCR-204 ELS 수정 — **등록과 같은 화면, 다른 초기값** (P4 컷 5, DOC-008 §5)
 *
 * ## `OwnerOnly`의 첫 소비자가 아니다 — 이쪽은 라우트 가드다
 *
 * ST-04는 **버튼**을 숨기라고 요구하고 그 소비자는 SCR-202다. 여기는 주소를 직접
 * 타이핑해 들어온 경로이므로 컴포넌트가 아니라 화면 전체가 SCR-902가 된다. 계획 §5가
 * 「902에 도달하는 유일한 길은 소유자 전용 URL을 직접 타이핑하는 것」이라고 적은
 * 자리가 정확히 여기다(다른 하나는 컷 6의 SCR-203).
 *
 * **읽기는 막지 않는다.** 모든 SELECT 정책이 `using (true)`이므로 비소유자도 이
 * 상품을 읽을 수 있고(DOC-010 §7) 계약은 `isOwner: false`를 줄 뿐 던지지 않는다.
 * 그래서 조회는 성공하고 화면이 판단한다 — 그 순서가 아니면 「없다」와 「권한이
 * 없다」가 구분되지 않는다.
 *
 * ## 상환 완료 상품도 이 화면을 연다
 *
 * 막는 것은 저장이다(§5.2 `CONFLICT`). 열지 못하게 하면 「왜 못 고치는가」를 화면이
 * 말할 자리가 없으므로 폼은 채우고 상단에 사유와 다음 행동을 적는다. 다음 행동인
 * 상환 취소는 **컷 6**에 서므로 지금은 상세로 보낸다.
 *
 * ## 두 계약을 부른다 — `getProduct`와 `searchAssets`
 *
 * `ROUTE_QUERIES['/products/[id]/edit']`가 처음부터 그 둘을 적고 있었다(컷 1b).
 * 자산 목록이 필요한 이유는 ②의 선택 상자가 등록과 같기 때문이다 — 기초자산을
 * **바꾸는** 수정이 정상 경로이고(§5.2가 전체 교체다) 목록이 없으면 그 칸이 비어 보인다.
 *
 * ## 키움 불러오기 — 등록과 같은 구획, 저장값 위에 채운다 (DOC-008 v2.12 · SQ-10)
 *
 * 조립은 `importPanelOf`가 한다(`target: EDIT`). 이 파일에 남는 것은 **부르는 순서**이고 등록보다
 * 문지기가 둘 많다(DOC-011 X-01 v4.6):
 *
 * 1. `getQueries()` — 미인증이면 던진다
 * 2. `getProduct` + **소유 확인** — 비소유자는 SCR-902이고 키움을 부르지 않는다
 * 3. **상환 처리된 상품은 부르지 않는다** — 저장이 `CONFLICT`이므로 채울 이유가 없다. 주소에
 *    `?code=`가 있어도 버린다(구획도 그리지 않는다)
 *
 * 그 뒤의 조회 넷(자산 목록 + 주소가 요구하는 키움 조회)은 서로 독립이므로 한 물결이다.
 * `ROUTE_EXTERNAL_LOOKUPS`가 이 라우트의 외부 조회 셋을 적는다.
 */

export const metadata: Metadata = { title: 'ELS 수정 · 언제들어오나' }

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<QueryValues>
}) {
  const { id } = await params
  // 형식 검사가 먼저다 — 없으면 `getProduct('abc')`가 `22P02`로 던져 404가 500이 된다
  // (컷 3이 음성 대조로 확인했다).
  if (!isUuid(id)) notFound()

  const queries = await getQueries()
  const view = await queries.getProduct(id)
  if (view == null) notFound()

  if (!view.product.isOwner) {
    return <AccessDenied what="이 상품을 수정할" productId={id} />
  }

  const redeemed = view.product.status === 'REDEEMED'
  // X-01 — 여기까지 왔으면 인증·소유가 확인됐다. 상환된 상품은 불러오지 않으므로 주소를 읽지도 않는다
  const importQuery = redeemed ? { query: null, code: null } : parseImportQuery(await searchParams)
  const source = createKiwoomProductSource({ fetchImpl: fetch })

  const [assets, search, terms, listed] = await Promise.all([
    queries.searchAssets(''),
    importQuery.code == null && importQuery.query != null
      ? source.searchKiwoomProducts(importQuery.query)
      : null,
    importQuery.code != null ? source.getKiwoomProductTerms(importQuery.code) : null,
    importQuery.code != null ? source.listKiwoomAssets() : null,
  ])

  const panel = importPanelOf({
    target: { kind: 'EDIT', productId: id },
    query: importQuery,
    search,
    terms,
    listed,
    options: assets,
    defaults: productValuesOf(view),
  })

  return (
    <section className="flex flex-col gap-5">
      <header>
        <Link href={PATHS.product(id)} className="text-sm text-neutral-600 underline">
          ← 상세
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">ELS 수정</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {view.product.name} ·{' '}
          <strong className="font-medium">
            저장하면 기초자산과 평가일정이 입력한 것으로 전부 교체된다.
          </strong>{' '}
          평가일은 칸의 날짜 그대로 저장된다 — 산식대로인 날짜만 발행일·평가주기를 따라 옮겨진다.
        </p>
      </header>

      {redeemed && (
        /*
         * §5.2 — 상환 완료 상품은 수정 불가다. 저장을 눌러도 계약이 `CONFLICT`를
         * 주지만, 그 사실을 저장 시점에 처음 알려 주면 사용자가 채운 수정이 버려진다.
         * 먼저 말하고 다음 행동을 준다(상환 취소는 상세에 있다 — 컷 6).
         */
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          상환 처리된 상품이다 — 저장은 거부된다. 고치려면 상세에서 상환을 먼저
          취소한다.
        </p>
      )}

      {!redeemed && <KiwoomImport panel={panel} assetAction={importAssetEditAction} />}

      {/*
        불러온 값이 바뀌면 폼을 다시 세운다 — 등록 화면과 같은 규칙이다(`ImportedProductForm`).
        불러오지 않은 렌더의 키는 「blank」이고 초기값은 저장값이다 — 「불러오기 취소」가 그 상태로 돌아간다.
      */}
      <ImportedProductForm
        formKey={panel.formKey}
        keepPreviousKey={panel.keepPreviousKey}
        assets={assets}
        action={productEditFormAction}
        initialValues={panel.initialValues}
        fieldNotes={panel.fieldNotes}
        productId={id}
      />
    </section>
  )
}
