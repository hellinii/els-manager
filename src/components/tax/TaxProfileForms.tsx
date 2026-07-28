import { INPUT_CLASS } from '@/components/form/Field'
import type { TaxSummaryView } from '@/lib/db/queries/tax'
import { HEALTH_INSURANCE_TYPE_LABELS, amount } from '@/lib/format'
import { TAX_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-401의 **조정 폼과 연도 폼** — 둘 다 `<form method="GET">`이다 (P4 컷 8)
 *
 * ## GET인 것이 「저장되지 않는다」의 구조적 보장이다
 *
 * DOC-011 §4.6은 `override`를 시뮬레이션 전용으로 정하고 저장을 §5.6으로 분리한다.
 * 근거는 「값을 조정해봤을 뿐인데 저장되는」 문제이며, 이 폼이 서버 액션이 아니므로
 * **변경 계약으로 가는 경로가 아예 없다** — 실수로 저장하는 코드를 쓸 수 없다.
 * 부수 효과로 시뮬레이션 상태가 주소로 공유되고 JS 없이 동작한다.
 *
 * 저장은 `SaveProfileForm`(별 파일, 클라이언트)이며 **적용된 값**을 히든으로 든다.
 *
 * ## 폼이 둘인 이유 — 연도를 바꾸는 것은 조정이 아니다
 *
 * 한 폼에 합치면 연도만 바꿔도 세 입력이 함께 제출되어 **직전 연도의 조정값이
 * 새 연도의 override가 된다.** 그러면 2025년 화면이 2026년에 적어 둔 값으로
 * 계산되고, 그 상태가 「저장된 프로필」과 구분되지 않는다. 연도 폼은 `year` 하나만
 * 보내므로 그 연도의 저장값이 그대로 쓰인다.
 */

export function TaxYearForm({
  year,
  years,
}: {
  year: number
  /** 고를 수 있는 연도 — 하한은 `seededYears[0]`이다(§4.6 v1.9) */
  years: readonly number[]
}) {
  return (
    <form
      method="GET"
      action={PATHS.tax}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-neutral-600">귀속연도</span>
        <select name={TAX_KEYS.year} defaultValue={String(year)} className={INPUT_CLASS}>
          {years.map((option) => (
            <option key={option} value={option}>
              {option}년
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
      >
        조회
      </button>
    </form>
  )
}

export function TaxOverrideForm({
  year,
  profile,
  /** 조정 중인가 — 문구와 「조정 해제」 링크의 유무를 정한다 */
  simulating,
}: {
  year: number
  profile: TaxSummaryView['profile']
  simulating: boolean
}) {
  return (
    <form
      method="GET"
      action={PATHS.tax}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
    >
      {/* 연도는 이 폼에서 바꾸지 않는다 — 위 폼의 일이다 */}
      <input type="hidden" name={TAX_KEYS.year} value={year} />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">
            금융소득 외 종합소득 과세표준
          </span>
          <input
            type="text"
            inputMode="numeric"
            name={TAX_KEYS.otherIncomeBase}
            /*
             * **쉼표 없이 렌더한다.** 이 값은 입력란이면서 동시에 주소에 실려
             * 돌아오는 값이므로(GET), 표시용 쉼표를 붙이면 그 문자열이 계약으로
             * 가고 V-19가 「정수로 입력한다」를 낸다. 파서가 쉼표를 지우기는 하지만
             * (`amountDigits`) 그 방어에 기대지 않는다 — 사용자가 적은 쉼표는 지우고
             * 우리가 붙인 쉼표는 애초에 만들지 않는다.
             */
            defaultValue={profile.otherIncomeBase}
            className={`${INPUT_CLASS} text-right tabular-nums`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">ELS 외 금융소득</span>
          <input
            type="text"
            inputMode="numeric"
            name={TAX_KEYS.otherFinancialIncome}
            defaultValue={profile.otherFinancialIncome}
            className={`${INPUT_CLASS} text-right tabular-nums`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">건강보험 가입 유형</span>
          <select
            name={TAX_KEYS.healthInsuranceType}
            defaultValue={profile.healthInsuranceType}
            className={INPUT_CLASS}
          >
            {/*
              「미입력」도 선택지다(DOC-005 §6.1 각주) — 가입 유형을 비우는 동작이며
              그 상태로 되돌릴 방법이 화면에 있어야 한다.
            */}
            {Object.entries(HEALTH_INSURANCE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
        >
          조정 적용
        </button>
        {simulating && (
          /*
           * 조정 해제는 버튼이 아니라 **링크**다 — 폼을 비우는 자바스크립트 없이
           * 「조정 없는 주소」로 가는 것이 같은 결과이고, 그편이 주소가 상태라는
           * 사실과 일치한다(SCR-201의 「초기화」와 같은 판단).
           */
          <a
            href={`${PATHS.tax}?${TAX_KEYS.year}=${year}`}
            className="text-sm text-neutral-600 underline"
          >
            조정 해제
          </a>
        )}
        <p className="text-xs text-neutral-500">
          조정은 이 화면에서만 계산에 반영되고 저장되지 않는다.
        </p>
      </div>
    </form>
  )
}

/**
 * 조정된 값과 저장된 값의 차이 — **조정 중일 때만 보여준다.**
 *
 * 「무엇을 조정했는지」가 화면에 없으면 사용자는 지금 보는 숫자가 자기 상황인지
 * 가정인지 구별하지 못한다. 저장값은 계약이 주지 않으므로(§4.6의 `profile`은
 * **적용된** 값이다) 여기서는 적용값만 다시 적는다 — 그것이 이 화면이 아는 전부다.
 */
export function AppliedValues({ profile }: { profile: TaxSummaryView['profile'] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-neutral-500">금융소득 외 종합소득</dt>
        <dd className="tabular-nums">{amount(profile.otherIncomeBase)}원</dd>
      </div>
      <div>
        <dt className="text-xs text-neutral-500">ELS 외 금융소득</dt>
        <dd className="tabular-nums">{amount(profile.otherFinancialIncome)}원</dd>
      </div>
      <div>
        <dt className="text-xs text-neutral-500">건강보험 가입 유형</dt>
        <dd>{HEALTH_INSURANCE_TYPE_LABELS[profile.healthInsuranceType]}</dd>
      </div>
    </dl>
  )
}
