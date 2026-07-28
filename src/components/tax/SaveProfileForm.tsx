'use client'

import { useActionState } from 'react'

import { saveTaxProfileAction } from '@/app/(app)/tax/actions'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import type { TaxSummaryView } from '@/lib/db/queries/tax'
import { initialFormState } from '@/lib/forms/state'

/**
 * 과세 프로필 저장 — §5.6. **저장은 여기 하나뿐이다** (P4 컷 8)
 *
 * ## 왜 히든인가
 *
 * 조정 폼(GET)에 보이는 입력란이 있으므로 여기 또 한 벌을 두면 같은 세 값의 칸이
 * 두 개씩 생긴다 — 사용자는 어느 쪽에 적어야 하는지 모르고, 두 칸의 값이 다를 때
 * 무엇이 저장되는지도 알 수 없다. 그래서 이 폼은 **적용된 값**(서버가 방금 계산에
 * 쓴 값)을 히든으로 들고 버튼 문구가 그 사실을 말한다.
 *
 * 조정하고 「조정 적용」을 누르지 않은 상태에서 저장하면 **직전에 적용된 값**이
 * 저장되는데, 그 값이 화면의 숫자와 일치하므로 사용자가 본 것과 저장된 것이
 * 어긋나지 않는다. 「입력란의 값이 저장된다」로 두면 그 반대가 된다.
 *
 * ## 연도도 히든이다
 *
 * §5.6은 `year`를 입력으로 받으므로(집계 키가 `(owner_id, year)`다 — 절대 규칙 #7)
 * 지금 보고 있는 연도가 실려야 한다. 빠뜨리면 `NaN`이 되어 V-20이 거부한다.
 */

export function SaveProfileForm({
  year,
  profile,
  /** 조정 중인가 — 버튼 문구가 「적용된 값」을 가리키는지를 정한다 */
  simulating,
}: {
  year: number
  profile: TaxSummaryView['profile']
  simulating: boolean
}) {
  const [state, formAction] = useActionState(saveTaxProfileAction, initialFormState())

  return (
    <form action={formAction} className="flex flex-col gap-2" noValidate>
      <FormMessage state={state} />

      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="otherIncomeBase" value={profile.otherIncomeBase} />
      <input
        type="hidden"
        name="otherFinancialIncome"
        value={profile.otherFinancialIncome}
      />
      <input
        type="hidden"
        name="healthInsuranceType"
        value={profile.healthInsuranceType}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label={simulating ? '조정된 값으로 저장' : `${year}년 프로필로 저장`}
          pendingLabel="저장 중…"
          variant="secondary"
        />
        <p className="text-xs text-neutral-500">
          {simulating
            ? '지금 계산에 쓰인 값이 저장된다.'
            : '이 값을 저장하면 다음에도 같은 기준으로 계산된다.'}
        </p>
      </div>
    </form>
  )
}
