import { Badge } from '@/components/display/Badge'
import { ExchangeRateForm } from '@/components/prices/ExchangeRateForm'
import type { ExchangeRateView } from '@/lib/db/queries/prices'
import {
  EXCHANGE_RATE_SECTION_TEXT,
  EXCHANGE_RATE_STALE_LABEL,
  PRICE_SOURCE_LABELS,
  STALE_GRADE,
  exchangeRateDisplay,
  ymd,
} from '@/lib/format'
import { EXCHANGE_RATE_SECTION } from '@/lib/routes/paths'

/**
 * SCR-302 「환율 (원/달러)」 절 — DOC-008 SCR-302 (v2.15 명세 · v2.19 결정 · P8 컷 a3)
 *
 * ## 언제 열려 오는가
 *
 * `<details>`를 서버가 그린다 — `useState`가 아니므로 JS 없이 열린다(매핑 편집과 같은 형태). 열림 조건은 둘이다.
 * ① **누구든** 미상환 달러 상품이 있다(`usedByActiveProducts > 0` — 전 사용자 수, DOC-011 §4.11) ② ST-07의 링크로
 * 왔다(`?rate=open` — SQ-20 결정). 원화뿐인 사용자에게도 다른 사용자의 달러 상품 때문에 열려 오는 것은 알고 받아들인
 * 대가다(DOC-008 v2.19 — 환율은 공용 관측이다).
 *
 * ## 원소는 지원 외화마다 하나다
 *
 * 빈 배열을 「환율 없음」으로 읽지 않는다 — 계약이 늘 원소를 준다(§4.11). 값이 없으면 그 통화의 자리에서
 * 「환율이 없다」를 말한다(ST-07의 원인을 여기서 말한다).
 *
 * ## 수집 상태는 필드에서 파생한다
 *
 * `autoCollected`가 거짓이면 「자동 수집 안 함 — 수동 입력이 정상 경로」(`neutral` — 결함이 아니다). 문구를 박지
 * 않는다 — 수집기가 등재되는 날(컷 c2) 화면이 코드 변경 없이 바뀐다. 그때의 「{원천}」 표기는 ADR-010 ⑤가 정한다.
 */
export function ExchangeRateSection({
  rates,
  asOf,
  forceOpen,
}: {
  rates: readonly ExchangeRateView[]
  asOf: string
  /** ST-07 링크로 왔다 — `?rate=open` */
  forceOpen: boolean
}) {
  const open = forceOpen || rates.some((rate) => rate.usedByActiveProducts > 0)

  return (
    <details
      id={EXCHANGE_RATE_SECTION.id}
      open={open}
      className="scroll-mt-4 rounded-lg border border-neutral-200 p-4"
    >
      <summary className="cursor-pointer text-sm font-medium">
        {EXCHANGE_RATE_SECTION_TEXT.title}
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        {rates.map((rate) => (
          <div key={rate.currency} className="flex flex-col gap-3">
            {/* 최신 값 — 값 · 기준일(ymd) · 출처 · 경과 */}
            {rate.latestRate == null ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {EXCHANGE_RATE_SECTION_TEXT.missing}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-base font-semibold tabular-nums">
                  {exchangeRateDisplay(rate.latestRate)}
                </span>
                {rate.asOfDate != null && (
                  <span className="text-xs text-neutral-500">{ymd(rate.asOfDate)} 기준</span>
                )}
                {rate.source != null && (
                  <Badge grade="neutral">{PRICE_SOURCE_LABELS[rate.source]}</Badge>
                )}
                {rate.isStale && (
                  <Badge grade={STALE_GRADE} title={`기준일 ${ymd(asOf)} 대비 5일 이상`}>
                    {EXCHANGE_RATE_STALE_LABEL}
                  </Badge>
                )}
              </div>
            )}

            {/* 수집 상태 — neutral. 결함이 아니라 설계된 정상 경로다(ADR-010) */}
            <div>
              {rate.autoCollected ? (
                <Badge grade="neutral">자동 수집{rate.provider != null ? `: ${rate.provider}` : ''}</Badge>
              ) : (
                <Badge grade="neutral">{EXCHANGE_RATE_SECTION_TEXT.notCollected}</Badge>
              )}
            </div>

            <div className="max-w-md">
              <ExchangeRateForm currency={rate.currency} asOf={asOf} />
            </div>
          </div>
        ))}

        {/* 안내 둘 — 「전체 갱신」 버튼과 이 절이 한 화면에 있다(SQ-19) */}
        <div className="flex flex-col gap-1 text-xs text-neutral-500">
          <p>{EXCHANGE_RATE_SECTION_TEXT.estimateOnly}</p>
          <p>{EXCHANGE_RATE_SECTION_TEXT.refreshExcludes}</p>
        </div>
      </div>
    </details>
  )
}
