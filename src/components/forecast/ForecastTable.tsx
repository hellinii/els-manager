import { Badge } from '@/components/display/Badge'
import type { ForecastRow } from '@/lib/db/queries/forecast'
import { amount, percent, signedWon } from '@/lib/format'

/**
 * SCR-402의 표 — DOC-008 §5의 요소 ①~⑫이 열이다
 *
 * ## 열 순서가 문서의 마커 순서다
 *
 * `tests/app/forecast.test.ts`가 그 셀을 파싱해 `keyof ForecastRow`와 대조하지만
 * **순서까지는 보지 않는다**(대조는 집합이다). 그래도 문서 순서를 따르는 이유는 사람이
 * 두 곳을 나란히 읽기 때문이다 — 순서가 갈리면 「열 하나가 빠졌다」를 눈으로 셀 수 없다.
 *
 * ## 표식 셋은 열 안이 아니라 마지막 칸에 모은다
 *
 * DOC-008 §5가 그 셋(적용 세율 연도 · 프로필 출처 연도 · 행별 추정 표식)을 「주요 요소」가
 * 아니라 **「표 밖 표식」** 행으로 규정한다. 그러나 셋 다 **행 단위**다 — 특히 세율 연도는
 * 2027이 시드되는 날 2026·2027행은 정확하고 2028~행은 근사로 **한 표 안에서 갈린다**
 * (DOC-011 §4.7이 `taxLawYear`를 행에 담는 이유가 그것이다). 그래서 「표 밖」을 「표
 * 아래」로 읽지 않고 **열거된 열 밖**으로 읽어 마지막 칸에 모았다 — 표 아래 한 줄로 적으면
 * 그 갈림을 표현할 수 없고, 화면이 「이 표 전체가 근사」라고 거짓을 말하게 된다.
 *
 * ## 모바일은 가로 스크롤이다
 *
 * DOC-008 §8이 「열이 많아 모바일 대응이 필요하다 … 우선순위 낮은 열을 접고 상세
 * 펼치기로 제공한다」고 적었으나 **구체적 열 우선순위를 DOC-009로 유예했다.** 정본이
 * 없는 상태에서 열을 접으면 어느 열을 감추는지가 이 파일의 결정이 되므로, P4b는 같은
 * 표의 다른 두 행이 허용한 **가로 스크롤**로 끝낸다.
 */

export function ForecastTable({ rows }: { rows: readonly ForecastRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">연도</th>
            <th className="px-3 py-2 text-right font-medium">세전 회수</th>
            <th className="px-3 py-2 text-right font-medium">그 해 금융소득</th>
            <th className="px-3 py-2 text-right font-medium">종합과세 기준 대비</th>
            <th className="px-3 py-2 text-left font-medium">종합과세 여부</th>
            <th className="px-3 py-2 text-right font-medium">최종 부담률</th>
            <th className="px-3 py-2 text-right font-medium">추가납부</th>
            <th className="px-3 py-2 text-right font-medium">보험료 합계</th>
            <th className="px-3 py-2 text-right font-medium">세후 회수</th>
            <th className="px-3 py-2 text-right font-medium">누적 세후 회수</th>
            <th className="px-3 py-2 text-right font-medium">누적 자산</th>
            <th className="px-3 py-2 text-right font-medium">잔여 원금</th>
            <th className="px-3 py-2 text-left font-medium">표식</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {rows.map((row) => (
            /*
             * DOC-008 §5의 「강조」 — 종합과세 기준금액 초과 연도를 시각으로 가른다.
             * ⑤가 그 사실을 글자로도 말하므로 색만으로 정보를 나르지 않는다.
             */
            <tr key={row.year} className={row.isComprehensive ? 'bg-amber-50' : undefined}>
              <td className="px-3 py-2 font-medium tabular-nums">{row.year}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.grossProceeds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.financialIncome)}
              </td>
              {/*
                ④는 **차액이며 부호가 뜻을 나른다**(양수면 초과 — §4.6의 절대값과 다르다).
                `signedWon`이 그 부호를 남긴다: `won`으로 적으면 「초과」와 「여유」가 같은
                숫자로 보이고, ⑤ 하나에 그 구분을 전부 떠넘기게 된다.
              */}
              <td className="px-3 py-2 text-right tabular-nums">
                {signedWon(row.thresholdGap)}
              </td>
              <td className="px-3 py-2">
                <Badge grade={row.isComprehensive ? 'caution' : 'neutral'}>
                  {row.isComprehensive ? '종합과세' : '분리과세'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {percent(row.effectiveRate)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.additionalTax)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.totalInsurance)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.netProceeds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.cumulativeNet)}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {amount(row.cumulativeAssets)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {amount(row.remainingPrincipal)}
              </td>

              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  {/*
                    ST-05 — 추정과 확정을 구분한다. **행 축이다**(DOC-007 §7.5): 그 해에
                    상환이 가정된 항목이 있거나 연도 말에 미상환 항목이 남아 있으면 참이다.
                    화면 전체 고지와 이 표식을 하나로 두면 행 표식의 정보량이 0이 되므로
                    (미상환 상품이 하나라도 있으면 모든 행이 참이 된다) 둘을 갈라 둔다.
                  */}
                  <Badge grade={row.hasEstimates ? 'caution' : 'neutral'}>
                    {row.hasEstimates ? '추정' : '확정'}
                  </Badge>

                  {row.taxLawYear !== row.year && (
                    <Badge
                      grade="neutral"
                      title={`${row.year}년의 세율·요율이 아직 없어 ${row.taxLawYear}년 기준으로 계산했다`}
                    >
                      세율 {row.taxLawYear}년
                    </Badge>
                  )}

                  {/*
                    프로필 출처 연도 — **세 상태를 그대로 말한다**(§4.7). `boolean`으로
                    접으면 「이월」과 「미입력」이 한 거짓이 되어 §4.6의 `isSaved`가 저지른
                    실수를 반복한다. 그 해의 저장값일 때는 적지 않는다 — 정상이 표식을
                    갖지 않는 것이 나머지 둘을 눈에 띄게 한다.
                  */}
                  {row.profileYear == null ? (
                    <Badge
                      grade="caution"
                      title="과세 프로필이 저장되어 있지 않아 금융소득 외 종합소득을 0으로 두었다 — 세액이 실제보다 낮게 나온다"
                    >
                      프로필 미입력
                    </Badge>
                  ) : (
                    row.profileYear !== row.year && (
                      <Badge
                        grade="neutral"
                        title={`${row.year}년 프로필이 없어 ${row.profileYear}년 값을 이월했다`}
                      >
                        프로필 {row.profileYear}년
                      </Badge>
                    )
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
