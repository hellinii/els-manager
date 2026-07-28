import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { TaxSummaryView } from '@/lib/db/queries/tax'
import {
  HEALTH_INSURANCE_TYPE_LABELS,
  INTEGRITY_ISSUE_GRADES,
  INTEGRITY_ISSUE_LABELS,
  amount,
  koreanWon,
  percent,
  won,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-401의 표시 절들 — DOC-008 §5의 ③④⑤⑥ (P4 컷 8)
 *
 * ③ 금융소득 집계 · ④ 세액 상세 · ⑤ 건강보험료 · ⑥ 구간별 실질 한계 부담률 표.
 * ①②(연도·프로필)는 폼이므로 `TaxProfileForms`·`SaveProfileForm`에 있다.
 *
 * ## 이 파일이 정하지 않는 것
 *
 * 숫자는 전부 계약이 낸다(§4.6). 여기서 더하거나 빼는 것이 하나도 없으며, 그것이
 * 규칙이다 — 화면이 `총세액 − 원천징수`를 계산하면 §5.5의 추가납부 정의가 두 곳에
 * 생기고, 그중 하나만 고쳐지는 날이 온다. 린트가 `Number()`를 막으므로 시도해도
 * 막히지만, 막힌 뒤에 값을 안 보여주는 것이 아니라 **계약이 준 값을 쓰는 것**이
 * 옳은 대응이다.
 */

/** ③ 금융소득 집계 — 종합과세 여부가 이 절의 결론이다 */
export function IncomeSection({ view }: { view: TaxSummaryView }) {
  const { income } = view

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">금융소득 집계</h2>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Amount label="ELS 과세 금융소득" value={income.elsTaxableIncome} />
        <Amount label="ELS 외 금융소득" value={income.otherFinancialIncome} />
        <Amount label="금융소득 합계" value={income.total} emphasis />
      </dl>

      <p
        className={`rounded-md px-3 py-2 text-sm ${
          income.isComprehensive
            ? 'bg-amber-50 text-amber-900'
            : 'bg-neutral-100 text-neutral-700'
        }`}
      >
        {income.isComprehensive ? (
          <>
            <strong>종합과세 대상이다.</strong> 종합과세 기준금액을{' '}
            <span className="tabular-nums">{won(income.thresholdGap)}</span> 초과했다 —
            다른 종합소득과 합산해 누진세율이 적용된다(비교과세).
          </>
        ) : (
          <>
            <strong>분리과세로 종결된다.</strong> 종합과세 기준금액까지{' '}
            <span className="tabular-nums">{won(income.thresholdGap)}</span> 남았다 —
            원천징수로 납세 의무가 끝난다.
          </>
        )}
      </p>
    </section>
  )
}

/**
 * ④ 세액 상세 — **비교과세 두 값이 `null`인 경우가 정상이다**(§4.6).
 *
 * `F ≤ 종합과세 기준금액`이면 비교과세를 적용하지 않으므로 두 산식을 보여주지
 * 않는다. 계약이 그 상태를 `null`로 표현하는 이유가 「무의미한 비교를 렌더링하지
 * 않게」이므로, 화면이 `0`으로 그리면 그 설계가 무너진다.
 */
export function TaxSection({ view }: { view: TaxSummaryView }) {
  const { tax } = view
  const comparative = tax.method1 != null && tax.method2 != null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">세액</h2>

      {comparative && (
        <dl className="grid gap-3 sm:grid-cols-2">
          <Amount label="① 분리 기준" value={tax.method1!} />
          <Amount label="② 종합 기준" value={tax.method2!} />
        </dl>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Amount label="산출세액" value={tax.computedTax} />
        <Amount label="지방소득세" value={tax.localTax} />
        <Amount label="총세액" value={tax.totalTax} emphasis />
        <Amount label="기납부 원천징수" value={tax.withheld} />
      </dl>

      <div className="flex flex-col gap-1 rounded-md bg-neutral-100 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">추가납부</span>
          <span className="text-base font-semibold tabular-nums">
            {won(tax.additionalPayment)}
          </span>
        </div>
        {/*
          DOC-008 §5의 「표시 주의」 첫 줄 — 추가납부액이 0인 경우가 **정상**이다
          (DOC-007 §5.5). 적지 않으면 사용자는 계산이 덜 된 줄로 읽는다.
        */}
        <p className="text-xs text-neutral-600">
          원천징수가 확정 세액을 이미 채웠으면 <strong>0이 정상이다</strong>. 음수는
          환급을 뜻한다.
        </p>
      </div>

      <p className="text-sm text-neutral-600">
        최종 부담률 <span className="tabular-nums">{percent(tax.effectiveRate)}</span> —
        총세액 ÷ 금융소득이며 평균 개념이다(한계 부담률은 아래 표).
      </p>
    </section>
  )
}

/**
 * ⑤ 건강보험료 — **가입 유형이 미입력이면 금액을 적지 않는다.**
 *
 * `NONE`은 산정 소득을 0으로 만들므로 보험료도 0이 된다(DOC-007 §6.1의 마지막 줄).
 * 그 0을 금액으로 렌더하면 **부과액이 0이라는 계산 결과처럼 읽히는데**, 실제로는
 * 아무것도 계산하지 않은 상태다 — DOC-011 §4.6이 「계산 결과가 아니라 미입력으로
 * 표시해야 한다」고 요구하고 DOC-005 §6.1이 라벨을 「미입력」으로 정한 이유다.
 */
export function HealthSection({ view }: { view: TaxSummaryView }) {
  const { healthInsurance, profile } = view
  const notEntered = profile.healthInsuranceType === 'NONE'

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">건강보험료 (추정)</h2>

      {notEntered ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>가입 유형이 미입력이므로 산출하지 않는다.</strong> 위 조정에서 가입
          유형을 고르면 금융소득 기준 추정 보험료가 계산된다 — 유형에 따라 문턱과
          산정 소득이 다르다(직장·지역·피부양자).
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            {HEALTH_INSURANCE_TYPE_LABELS[profile.healthInsuranceType]} 기준
          </p>
          <dl className="grid gap-3 sm:grid-cols-4">
            <Amount label="산정 소득" value={healthInsurance.assessmentBase} />
            <Amount label="건강보험료" value={healthInsurance.healthPremium} />
            <Amount label="장기요양보험료" value={healthInsurance.longTermCarePremium} />
            <Amount label="합계" value={healthInsurance.total} emphasis />
          </dl>
        </>
      )}

      {/* DOC-008 §5의 「표시 주의」 둘째 줄 — A-06. `isEstimate`가 항상 참이다 */}
      <p className="text-xs text-neutral-500">
        개인의 금융소득만 반영한 추정치다. 지역가입자 보험료는 실제로는 세대 단위로
        소득·재산을 합산해 부과되며 본 시스템은 세대와 재산을 모델링하지 않는다.
      </p>
    </section>
  )
}

/** ⑥ 구간별 실질 한계 부담률 — 건강보험료를 포함한 값이다(DOC-005 §4) */
export function MarginalRateSection({ view }: { view: TaxSummaryView }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">구간별 실질 한계 부담률</h2>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">과세표준 구간</th>
              <th className="px-3 py-2 text-right font-medium">소득세율</th>
              <th className="px-3 py-2 text-right font-medium">실질 한계 부담률</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {view.marginalRates.map((row) => (
              <tr key={row.bracketLabel}>
                {/* 구간 표시명은 계약이 합성한다(§4.6) — 화면이 만들지 않는다 */}
                <td className="px-3 py-2">{row.bracketLabel}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {percent(row.incomeTaxRate)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {percent(row.realMarginalRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        금융소득 1원이 늘 때의 추가 부담이며 지방소득세와 건강보험료를 포함한다.
        가입 유형을 조정하면 이 표가 함께 바뀐다.
      </p>
    </section>
  )
}

/**
 * 기여 상품 — **결함 표식이 금액을 바꾸지 않는다**(§4.6 v0.8).
 *
 * 표식이 없으면 SCR-202에서 「수정 필요」로 표시되는 같은 상품이 여기서는 숫자로만
 * 나타나 사용자가 그것을 데이터 오류로 읽는다. `isEstimated`와 **직교**한다.
 */
export function ContributingSection({ view }: { view: TaxSummaryView }) {
  if (view.contributingProducts.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">기여 상품</h2>
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-600">
          {view.year}년에 귀속되는 상환·추정이 없다. 상환이 확정되거나 적용 차수가 이
          연도에 들어오면 여기에 나타난다.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        기여 상품{' '}
        <span className="font-normal text-neutral-500">
          {view.contributingProducts.length}건
        </span>
      </h2>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
        {view.contributingProducts.map((item) => (
          <li
            key={item.productId}
            className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Link
                href={PATHS.product(item.productId)}
                className="font-medium hover:underline"
              >
                {item.productName}
              </Link>
              {/*
                ST-05 — 추정과 확정을 구분한다. 상환 확정값은 증권사가 낸 숫자이고
                추정은 적용 차수의 예상 수령액에서 나온다(RD-02).
              */}
              <Badge grade={item.isEstimated ? 'caution' : 'neutral'}>
                {item.isEstimated ? '추정' : '확정'}
              </Badge>
              {item.integrityIssue != null && (
                <Badge grade={INTEGRITY_ISSUE_GRADES[item.integrityIssue]}>
                  {INTEGRITY_ISSUE_LABELS[item.integrityIssue]}
                </Badge>
              )}
            </span>
            <span className="tabular-nums">{won(item.taxableIncome)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 금액 한 칸. 억·만 단위를 함께 적어 자릿수를 눈으로 세지 않게 한다 */
function Amount({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd
        className={`tabular-nums ${emphasis ? 'text-base font-semibold' : 'text-sm'}`}
      >
        {amount(value)}원
        {/*
          `koreanWon`은 만 단위 아래를 버리므로 **보조 표기**다. 0원이거나 만 단위가
          없으면 「0원」이 되어 위 숫자와 모순으로 보이므로 그때는 붙이지 않는다.
        */}
        {koreanWon(value) !== '0원' && (
          <span className="ml-1.5 text-xs font-normal text-neutral-500">
            ({koreanWon(value)})
          </span>
        )}
      </dd>
    </div>
  )
}
