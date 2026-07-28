'use client'

import { useActionState } from 'react'

import { saveManualPriceAction } from '@/app/(app)/prices/actions'
import { Badge } from '@/components/display/Badge'
import { INPUT_CLASS } from '@/components/form/Field'
import { SubmitButton } from '@/components/form/SubmitButton'
import type { AssetPriceView } from '@/lib/db/queries/prices'
import {
  PRICE_SOURCE_LABELS,
  STALE_GRADE,
  STALE_LABEL,
  korDate,
  priceDisplay,
  ymd,
} from '@/lib/format'
import { initialFormState } from '@/lib/forms/state'

/**
 * 자산 한 줄 — 최신 시세·갱신 시각·출처 + 수동 입력 (DOC-008 §5 SCR-302)
 *
 * ## 줄마다 폼이다
 *
 * 하나의 폼으로 모든 줄을 처리하려면 자산을 고르는 선택 상자가 필요하고, 그러면
 * 「보이는 값을 고쳐 쓴다」가 「목록에서 찾아 고른다」가 된다. §5.7이 UPSERT이므로
 * 줄마다 제출하는 편이 계약의 형태와도 맞는다.
 *
 * 각 줄이 자기 `useActionState`를 갖는 이유가 그것이다 — 한 줄의 오류가 다른
 * 줄의 입력을 지우지 않는다(입력값 보존).
 *
 * ## `import type`이다
 *
 * `AssetPriceView`를 값으로 가져오면 `queries/prices.ts` → `map.ts` →
 * `lib/domain` 전체가 클라이언트 번들에 실린다. 린트가 막는다(컷 0d 규칙 3).
 */

export function PriceRow({ asset, asOf }: { asset: AssetPriceView; asOf: string }) {
  const [state, formAction] = useActionState(
    saveManualPriceAction,
    initialFormState({ asOfDate: asOf }),
  )

  const priceError = state.fieldErrors.price ?? state.fieldErrors.asOfDate
  const failed = state.status === 'ERROR'

  return (
    <li className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center">
      {/* ① 자산 */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{asset.name}</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {asset.market ?? '시장 정보 없음'} · {asset.currency}
          {asset.usedByActiveProducts > 0 && (
            <> · 미상환 {asset.usedByActiveProducts}건 참조</>
          )}
        </p>
      </div>

      {/* ② 최신 시세 — E-01("시세 없음")이 갱신 시각보다 앞선다 */}
      <div className="lg:text-right">
        {asset.latestPrice == null ? (
          <span className="text-sm text-neutral-500">시세 없음</span>
        ) : (
          <span className="text-sm font-medium tabular-nums">
            {priceDisplay(asset.latestPrice)}
          </span>
        )}
        {asset.asOfDate != null && (
          <p className="mt-0.5 text-xs text-neutral-500">
            <span className="lg:hidden">기준 </span>
            {korDate(asset.asOfDate)}
          </p>
        )}
      </div>

      {/* ③ 출처·경과 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {asset.source != null && (
          <Badge grade="neutral">{PRICE_SOURCE_LABELS[asset.source]}</Badge>
        )}
        {asset.isStale && (
          <Badge grade={STALE_GRADE} title={`기준일 ${ymd(asOf)} 대비 5일 이상`}>
            {STALE_LABEL}
          </Badge>
        )}
      </div>

      {/* ④ 수동 입력 — ST-03의 폴백 경로가 목록 안에 있다 */}
      <form action={formAction} className="flex flex-col gap-1.5" noValidate>
        <input type="hidden" name="assetId" value={asset.assetId} />

        <div className="flex items-center gap-1.5">
          <input
            id={`price-${asset.assetId}`}
            name="price"
            type="text"
            inputMode="decimal"
            aria-label={`${asset.name} 시세`}
            aria-invalid={priceError != null}
            defaultValue={state.values.price ?? ''}
            placeholder="시세 입력"
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          />
          <input
            name="asOfDate"
            type="date"
            aria-label={`${asset.name} 기준일자`}
            /*
             * V-17: 기준일 이후의 시세는 존재할 수 없다. `max`가 계약과 **같은 날**을
             * 가리켜야 하므로 `getAsOf()`의 값을 받아 쓴다 — 브라우저의 오늘을 쓰면
             * 시간대 차이로 계약이 거부하는 값을 화면이 허용한다.
             */
            max={asOf}
            defaultValue={state.values.asOfDate ?? asOf}
            className={`${INPUT_CLASS} w-36`}
          />
          <SubmitButton label="저장" pendingLabel="저장 중…" variant="secondary" />
        </div>

        {state.message != null && (
          <p
            role={failed ? 'alert' : 'status'}
            className={`text-xs ${failed ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {state.message}
          </p>
        )}
        {priceError != null && (
          <p className="text-xs text-red-700">{priceError}</p>
        )}
        {/* 어느 칸과도 짝지어지지 않은 오류를 버리지 않는다 */}
        {state.unmatched.map(({ key, message }) => (
          <p key={key} className="text-xs text-red-700">
            <span className="font-mono">{key}</span> {message}
          </p>
        ))}
      </form>

      {/*
        자산 유형(`assetType`)은 **표시하지 않는다.** `AssetPriceView`에 그 필드가
        없고(DOC-011 §4.5) DOC-008 §5 SCR-302의 주요 요소에도 없다. 등록 폼에서는
        고르지만 목록에서는 보이지 않는 비대칭인데, 계약에 필드를 더하는 것은
        문서 선행 + 세 스위트를 끌고 오는 일이라 이 컷의 범위가 아니다 —
        필요해지면 §4.5에 등재한 뒤 넣는다.
      */}
    </li>
  )
}
