import type { Metadata } from 'next'

import { EmptyState } from '@/components/state/EmptyState'
import { AssetForm } from '@/components/prices/AssetForm'
import { PriceRow } from '@/components/prices/PriceRow'
import { RefreshButton } from '@/components/prices/RefreshButton'
import { getAsOf, getQueries } from '@/lib/db/server'
import { korDate } from '@/lib/format'

/**
 * SCR-302 시세 관리 — **P4의 첫 화면** (DOC-008 §5, 계획 §3)
 *
 * ## 왜 첫 화면인가
 *
 * 유일한 자급 화면이다. 자기 변경 계약(§5.7·§5.10)만으로 자기 화면에 실데이터를
 * 채운다 — 자산을 등록하면 줄이 생기고, 시세를 넣으면 값·`isStale`·출처가 나온다.
 * 다른 화면은 전부 상품에 의존하고 상품은 기초자산에 의존한다(위상 정렬 결과).
 *
 * 그리고 `ErrorCode` 일곱 중 다섯이 이 한 화면에서 실물로 나온다 — V-15·V-17·
 * V-19·`CONFLICT`(`nulls not distinct`)·`PROVIDER_UNAVAILABLE`. 마지막 하나가
 * **오류가 아닌 유일한 경우**이고(ST-03) 그 규칙을 나중에 만나면 이미 만든
 * 「오류 = 빨간 박스」를 되돌려야 한다.
 *
 * ## 서버 컴포넌트다
 *
 * 조회는 여기서 하고 폼만 클라이언트다. 데이터를 props로 내리므로 `lib/db`가
 * 클라이언트 번들에 실리지 않는다(린트가 값 import를 막는다).
 *
 * `getQueries()`는 미인증에서 던지지만(Q-04) 프록시가 먼저 거르므로 여기 도달하는
 * 요청은 인증되어 있다. 그러고도 던졌다면 **프록시가 놓쳤다는 신호**이므로
 * 삼키지 않는다(에러 경계로 간다).
 */

export const metadata: Metadata = {
  title: '시세 관리 · 언제들어오나',
}

export default async function PricesPage() {
  const queries = await getQueries()
  const assets = await queries.listAssetPrices()
  // 화면과 계약이 **같은 기준일**을 본다(Q-02). V-17의 `max`가 여기서 나온다.
  const asOf = getAsOf()

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">시세 관리</h1>
          <p className="mt-1 text-sm text-neutral-600">
            기준일 {korDate(asOf)} · 자산 {assets.length}종
          </p>
        </div>

        <RefreshButton />
        <p className="text-xs text-neutral-500">
          시세는 공용 데이터다 — 같은 자산을 여러 사용자가 참조하므로 누구나 조회하고
          입력할 수 있다.
        </p>
      </header>

      {assets.length === 0 ? (
        /*
         * 빈 상태의 다음 행동이 **이 자리의 입력**이다(ST-02). 링크로 두면
         * "자산을 등록하려면 상품을 등록하세요"가 되고 상품 등록은 다시 기초자산을
         * 요구해 안내가 순환한다 — DOC-008 §5 v0.3이 자산 등록을 이 화면에 넣은
         * 이유이며, `EmptyState`의 `action`이 필수 prop인 이유이기도 하다.
         */
        <EmptyState
          title="등록된 기초자산이 없다"
          description="자산을 먼저 등록하면 시세를 입력할 수 있고, 상품 등록에서 기초자산으로 고를 수 있다."
          action={{ label: '자산 등록', form: <AssetForm /> }}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            {/*
             * 표 머리글은 데스크톱에서만 — 모바일은 카드 1열이다(DOC-008 §8)
             *
             * **열 비율은 `PriceRow`의 `li`와 글자 하나까지 같아야 한다.** 조립하지
             * 않고 양쪽에 적어 두는 이유는 `ProductScheduleCard`의 docblock과 같다
             * (Tailwind가 템플릿 리터럴로 만든 클래스를 생성하지 않는다).
             */}
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.5fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
              <span>자산</span>
              <span className="text-right">최신 시세</span>
              <span>출처</span>
              <span>수동 입력</span>
            </div>

            <ul className="divide-y divide-neutral-200">
              {assets.map((asset) => (
                <PriceRow key={asset.assetId} asset={asset} asOf={asOf} />
              ))}
            </ul>
          </div>

          <details className="rounded-lg border border-neutral-200 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              자산 등록
            </summary>
            <div className="mt-4 max-w-sm">
              <AssetForm />
            </div>
          </details>
        </>
      )}
    </section>
  )
}
