import type { Metadata } from 'next'

import { KiwoomImport } from '@/components/products/KiwoomImport'
import { ProductForm } from '@/components/products/ProductForm'
import { getQueries } from '@/lib/db/server'
import { productDefaults } from '@/lib/forms/defaults'
import { importPanelOf } from '@/lib/forms/importPanel'
import { parseImportQuery, type QueryValues } from '@/lib/forms/query'
import { createKiwoomProductSource } from '@/lib/providers/kiwoom/terms'

import { importAssetAction, productFormAction } from './actions'

/**
 * SCR-204 ELS 등록 — 골격 (P4 컷 4a, DOC-008 §5·§7.1)
 *
 * ## 자산 전량을 한 번 실어 보낸다
 *
 * `searchAssets('')`이 전량이다(§4.9 v1.5). 타이핑마다 서버에 묻는 경로는
 * §1.2가 금지했으므로(조회를 서버 액션으로 감싸지 않는다) 자동완성은 **렌더 1회
 * 전량 + 클라이언트 필터**로 성립한다 — 그 결정이 계약의 빈 질의를 바꿨다.
 *
 * 종전 구현은 빈 질의에 `[]`를 주었고, 그 값이면 자산이 있어도 이 화면에서 하나도
 * 고를 수 없다. 「화면이 계약의 결함을 드러낸다」의 세 번째 사례다(컷 2의 AQ-24,
 * 컷 3의 판정 삼종에 이어).
 *
 * ## `listAssetPrices`로 대신하지 않는다
 *
 * 그쪽은 `usedByActiveProducts` 때문에 상품 계열을 한 번 더 읽고(왕복 2), 등록
 * 화면이 쓰지 않는 값 때문에 이 라우트의 무효화 축이 상품 변경 전체로 넓어진다
 * (`listAssetPrices`가 `PRODUCT_WIDE`에 있다). `ROUTE_QUERIES`가 이 라우트에
 * `searchAssets` 하나만 적은 것이 그 판단이다.
 *
 * ## 서버 컴포넌트다
 *
 * 조회는 여기서 하고 폼만 클라이언트다. 자산 목록을 props로 내리므로 `lib/db`가
 * 클라이언트 번들에 실리지 않는다(린트가 값 import를 막는다).
 *
 * ## 키움 불러오기 (S-12, DOC-008 v2.9 · DOC-011 §4.10)
 *
 * 주소가 상태다 — `?q=`이면 검색, `?q&code=`이면 상세. 이 파일에 남는 것은 **부르는 순서**뿐이고
 * 조립은 `importPanelOf`(순수)가 한다.
 *
 * - **X-01 — `getQueries()`가 먼저다.** 미인증이면 거기서 던지므로(Q-04) 키움 요청이 나가지 않는다.
 *   외부 조회는 세션이 필요 없어서 이 순서가 유일한 문지기다(프록시가 우회되어도)
 * - 부르는 것은 주소가 요구하는 것뿐이다 — 검색이면 검색 하나, 상세면 상세 + 기초자산 목록.
 *   셋이 서로 독립이므로 자산 목록과 함께 한 물결로 부른다
 * - **X-02 — 던지지 않는다.** 어댑터가 실패를 값으로 주고 `importPanelOf`가 「조회 실패」로 접는다.
 *   여기서 던지면 `app/error.tsx`가 수동 등록까지 막는다
 * - `ROUTE_EXTERNAL_LOOKUPS`(`lib/routes/invalidation.ts`)가 이 라우트의 외부 조회 셋을 적는다
 *   — DOC-011 §8과 양방향으로 대조된다
 */

export const metadata: Metadata = {
  title: 'ELS 등록 · 언제들어오나',
}

export default async function ProductNewPage({
  searchParams,
}: {
  // Next 16의 searchParams는 Promise다.
  searchParams: Promise<QueryValues>
}) {
  // X-01 — 인증이 먼저다. 미인증이면 여기서 던지고 아래의 키움 요청은 나가지 않는다.
  const queries = await getQueries()
  const importQuery = parseImportQuery(await searchParams)
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
    query: importQuery,
    search,
    terms,
    listed,
    options: assets,
    defaults: productDefaults(),
  })

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">ELS 등록</h1>
        <p className="mt-1 text-sm text-neutral-600">
          한 페이지에서 입력한다. 평가일은 증권사 통지서의 날짜를 적고, 비워 두면 저장할 때 산식으로 채워진다.
        </p>
      </header>

      <KiwoomImport panel={panel} assetAction={importAssetAction} />

      {/*
        같은 컴포넌트가 수정에도 쓰인다(컷 5). 다른 것은 초기값·대상 id·액션 셋뿐이며
        등록은 id가 없다 — 그 부재가 곧 「새로 만든다」다.

        불러온 값이 바뀌면 폼을 다시 마운트한다 — `initialValues`는 마운트 때 한 번 읽힌다.
        키에 해결된 자산 id가 들어가므로 같은 주소에서 자산을 추가해도 새 값을 받는다.
      */}
      <ProductForm
        key={panel.formKey}
        assets={assets}
        action={productFormAction}
        initialValues={panel.initialValues}
        fieldNotes={panel.fieldNotes}
      />
    </section>
  )
}
