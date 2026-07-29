import { Badge } from '@/components/display/Badge'
import type { ProductDetailView } from '@/lib/db/queries/map'
import {
  CONDITION_RESULT_GRADES,
  CONDITION_RESULT_LABELS,
  amount,
  percent,
  ymd,
} from '@/lib/format'

/**
 * ③ 차수별 평가일·배리어·리자드 조건 표 — SCR-202 (DOC-008 §5·§8)
 *
 * ## 모바일에서 접는다 — DOC-008 §8이 이 표를 지목한다
 *
 * 「차수별 조건표(SCR-202)와 다년도 전망(SCR-402)은 열이 많아 모바일 대응이
 * 필요하다. **우선순위 낮은 열을 접고 상세 펼치기로 제공**한다.」 그래서 리자드
 * 세 열은 `<details>` 안에 있고, 좁은 폭에서는 차수·평가일·배리어만 보인다.
 *
 * **`<details>`를 쓰는 이유는 JS가 필요 없다는 것이다.** 접기를 상태로 만들면
 * 클라이언트 컴포넌트가 되고, 이 화면은 그 대가를 낼 이유가 없다(읽기 전용).
 * 그리고 접힌 내용이 **DOM에 있으므로** 검색·인쇄에서 사라지지 않는다.
 *
 * ## 판정은 적용 차수 한 곳에만 있다
 *
 * §4.3 필드 정의 표의 `schedules[].conditionResult`: 「**적용 차수 한 행에만 값이
 * 있다.** … 다른 차수의 배리어로 지금 시세를 판정하면 그 차수가 도래했을 때의 결과인
 * 척하는 값이 된다.」 계약이 이미 그렇게 주므로 화면은 있는 것만 표시한다 —
 * 「이 차수는 왜 판정이 없는가」를 화면이 설명하려 하면 그 설명이 곧 판정 규칙의
 * 두 번째 사본이 된다. 그리고 설명할 수도 없다: 같은 항목이 `null`의 원인을 넷으로
 * 열거하는데 이 뷰에서 갈리는 것은 그중 하나뿐이다(다른 행에 값이 있는가).
 *
 * > 인용이 P4.5까지 **거짓이었다.** 이 규칙은 코드 주석(`queries/map.ts`)에만 있었고
 * > §4.3에도 §4.4에도 문장이 없었다 — 실재한 것은 §4.2 D1 표의 **상품 단위** 한 칸이다.
 * > P4.5가 두 절에 필드 정의를 넣어 인용을 참으로 만들었다(U-01·절대 규칙 #10).
 *
 * ## `expectedGross`는 전 차수에 있다
 *
 * 판정과 무관하다(§4.3) — 「그 차수에 조기상환된다고 가정한 세전 수령액」이므로
 * 상환 완료 상품에서도, 경과한 차수에서도 의미가 있다. **추정값**이므로 ST-05에
 * 따라 확정된 상환 실적과 다르게 보여야 하고, 그 구분은 이 표가 「예상」이라고
 * 적고 상환 실적이 별 절에 있다는 것으로 짓는다.
 */

export function ScheduleTable({
  schedules,
}: {
  schedules: ProductDetailView['schedules']
}) {
  if (schedules.length === 0) {
    return (
      <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
        평가일정이 0건이다 — 계약을 경유하는 조작으로는 만들 수 없는 상태다
        (DOC-002 I-07).
      </p>
    )
  }

  const hasLizard = schedules.some((s) => s.lizardBarrier != null)

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200">
      <div className="hidden grid-cols-[minmax(0,0.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500 lg:grid">
        <span>차수</span>
        <span>평가일</span>
        <span className="text-right">배리어</span>
        <span className="text-right">예상 수령액 (원)</span>
        <span>판정 · 리자드</span>
      </div>

      <ul className="divide-y divide-neutral-200">
        {schedules.map((s) => (
          <li
            key={s.roundNo}
            className={`grid gap-1.5 px-4 py-3 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] lg:items-start lg:gap-3 ${
              // 경과한 차수는 흐리게 — 「지난 일」과 「앞으로 올 일」이 같은 무게로
              // 보이면 다음 평가일을 찾는 데 목록을 세어야 한다.
              s.isPast ? 'bg-neutral-50/60 text-neutral-500' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.roundNo}차</span>
              {s.isPast && (
                <span className="text-xs text-neutral-500 lg:hidden">경과</span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-sm tabular-nums">{ymd(s.evaluationDate)}</span>
              {s.isPast && (
                <span className="hidden text-xs text-neutral-500 lg:inline">경과</span>
              )}
            </div>

            <Value label="배리어">{percent(s.barrier)}</Value>
            <Value label="예상 수령액">{amount(s.expectedGross)}원</Value>

            <div className="flex flex-col gap-1.5">
              {s.conditionResult != null && (
                /*
                 * 적용 차수다. 「예상」을 문자로 붙이는 이유는 라벨이
                 * `redemptionType`(확정)과 같기 때문이다 — ST-05.
                 */
                <Badge grade={CONDITION_RESULT_GRADES[s.conditionResult]}>
                  예상 {CONDITION_RESULT_LABELS[s.conditionResult]}
                </Badge>
              )}

              {s.lizardBarrier != null && (
                /*
                 * 우선순위 낮은 열을 접는다(§8). `sm:` 이상에서는 펼친 채로 두지
                 * 않는다 — `<details open>`을 폭으로 바꾸려면 JS가 필요하고, 접힌
                 * 상태가 폭에 따라 다르면 인쇄 결과가 창 크기에 의존한다.
                 */
                <details className="text-xs">
                  <summary className="cursor-pointer text-neutral-600">
                    리자드 {percent(s.lizardBarrier)}
                  </summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-neutral-600">
                    <dt>배리어</dt>
                    <dd className="tabular-nums">{percent(s.lizardBarrier)}</dd>
                    <dt>쿠폰율</dt>
                    <dd className="tabular-nums">
                      {s.lizardCouponRate == null ? (
                        '—'
                      ) : (
                        <>
                          {percent(s.lizardCouponRate)}
                          {/*
                            원금상환형은 0으로 표기한다(DOC-007 §4.1) — 「쿠폰
                            없음」과 「조건 없음」이 다른 사실이므로 0을 「—」로
                            바꾸지 않는다.
                          */}
                          {s.lizardCouponRate === '0.0000' && ' (원금상환형)'}
                        </>
                      )}
                    </dd>
                    <dt>KI 미터치</dt>
                    <dd>{s.lizardRequiresNoKi === true ? '요구' : '무관'}</dd>
                  </dl>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!hasLizard && (
        <p className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500">
          리자드 조건이 있는 차수가 없다.
        </p>
      )}
    </div>
  )
}

function Value({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums lg:justify-end">
      <span className="text-xs font-normal text-neutral-500 lg:hidden">{label}</span>
      <span>{children}</span>
    </div>
  )
}
