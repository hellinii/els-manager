import type { Metadata } from 'next'

import { ProductForm } from '@/components/products/ProductForm'
import { getQueries } from '@/lib/db/server'

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
 */

export const metadata: Metadata = {
  title: 'ELS 등록 · 언제들어오나',
}

export default async function ProductNewPage() {
  const queries = await getQueries()
  const assets = await queries.searchAssets('')

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">ELS 등록</h1>
        <p className="mt-1 text-sm text-neutral-600">
          네 단계로 입력한다. 각 단계의 값은 이동해도 남는다.
        </p>
      </header>

      <ProductForm assets={assets} />
    </section>
  )
}
