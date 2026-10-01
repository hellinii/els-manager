'use client'

import { useActionState } from 'react'

import { saveExchangeRateAction } from '@/app/(app)/prices/actions'
import { Field, INPUT_CLASS } from '@/components/form/Field'
import { FormMessage } from '@/components/form/FormMessage'
import { SubmitButton } from '@/components/form/SubmitButton'
import { EXCHANGE_RATE_SECTION_TEXT } from '@/lib/format'
import { initialFormState } from '@/lib/forms/state'
import { EXCHANGE_RATE_SECTION } from '@/lib/routes/paths'

/**
 * 수동 환율 입력 — §5.13 `saveExchangeRate` (DOC-008 SCR-302 「환율 (원/달러)」 절 · P8 컷 a3)
 *
 * 수동 시세 입력(`PriceRow`)과 같은 형태다 — 기준일의 기본값과 `max`가 **조회 기준일**(V-17 — 브라우저의 오늘을
 * 쓰면 시간대 차이로 계약이 거부하는 값을 화면이 허용한다), 같은 기준일이 있으면 그 값을 고치고 출처가 수동이
 * 된다(UPSERT). 지우는 경로가 없다 — 틀린 값은 같은 기준일로 다시 저장해 고친다(DQ-13).
 *
 * 범위 검사(상한 · 하한)를 두지 않는다 — DOC-008 SCR-302의 결정이다. 방어는 값의 가시성(절의 최신 값 줄과
 * 각 화면의 근거 줄)이다. 환율 문자열은 숫자로 바꾸지 않고 그대로 보낸다(절대 규칙 #2 — 계약이 V-24로 본다).
 */
export function ExchangeRateForm({ currency, asOf }: { currency: 'USD'; asOf: string }) {
  /*
   * ★ **permalink가 절을 연 주소다.** JS 없이 제출하면 응답이 새 문서이고 절의 펼침은 서버가 다시 정한다 — 미상환
   * 달러 상품이 0건인 사용자가 손으로 펼쳐 저장하면 응답에서 절이 **다시 접혀** 성공 문구 · 오류 · 보존 입력이 그
   * 안에 숨는다(「눌렀는데 아무 일도 없다」 — 반박 검토 지적). permalink를 ST-07 링크와 같은 주소로 두면 JS 없는
   * 제출이 `?rate=open`으로 가서 열린 절로 돌아온다(SQ-20과 같은 기전).
   */
  const [state, formAction] = useActionState(
    saveExchangeRateAction,
    initialFormState({ asOfDate: asOf }),
    EXCHANGE_RATE_SECTION.href,
  )

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="currency" value={currency} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="asOfDate" label="기준일" error={state.fieldErrors.asOfDate}>
          {(props) => (
            <input
              {...props}
              type="date"
              max={asOf}
              defaultValue={state.values.asOfDate ?? asOf}
              className={INPUT_CLASS}
            />
          )}
        </Field>
        <Field
          name="rate"
          label={EXCHANGE_RATE_SECTION_TEXT.rateLabel}
          error={state.fieldErrors.rate ?? state.fieldErrors.currency}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              defaultValue={state.values.rate ?? ''}
              placeholder="예: 1392.40"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          )}
        </Field>
      </div>

      <div>
        <SubmitButton label="저장" pendingLabel="저장 중…" variant="secondary" />
      </div>
    </form>
  )
}
