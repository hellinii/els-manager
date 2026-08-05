'use client'

import { useActionState } from 'react'

import { saveProviderSymbolAction } from '@/app/(app)/prices/actions'
import { INPUT_CLASS } from '@/components/form/Field'
import { SubmitButton } from '@/components/form/SubmitButton'
import { initialFormState } from '@/lib/forms/state'

/**
 * 공급자 심볼 매핑 편집 — DOC-011 §5.12 · DOC-008 §5 SCR-302 (P5a 컷 2b)
 *
 * ## `<details>`로 접는다 — 그리고 그것이 그리드를 지킨다
 *
 * SCR-302의 행은 4열 그리드이고 그 비율은 실측으로 조정된 값이다(`PriceRow`의 각주).
 * 5번째 열을 만들면 **머리글과 행 양쪽의 템플릿 문자열을 글자 단위로 맞춰야** 하고
 * (Tailwind가 템플릿 리터럴 클래스를 생성하지 않으므로 둘이 같아야 한다) 그 비율
 * 판단을 다시 해야 한다. 대신 `lg:col-span-full`로 **행 아래 한 줄**을 쓴다.
 *
 * `<details>`인 이유는 빈도다 — 매핑은 자산당 한 번 넣고 거의 바꾸지 않는데 시세 입력은
 * 자주 한다. 펼침 상태를 `useState`로 두지 «않으므로» **JS 없이도 열린다**
 * (`AssetForm`이 같은 형태를 쓴다).
 *
 * ## 한 칸이 저장과 해제를 «둘 다» 한다
 *
 * 빈 칸으로 제출하면 해제다 — `parseProviderSymbolForm`이 `''`을 `null`로 바꾸고
 * §5.12가 그 좌표의 행을 삭제한다. 「지우기」 버튼을 따로 두지 않는 이유는
 * **조작이 하나이기 때문**이다(그 칸을 비운다). §5.9 `setKiTouched`가 같은 형태다.
 */
export function ProviderSymbolForm({
  assetId,
  assetName,
  provider,
  current,
}: {
  assetId: string
  assetName: string
  /** 이 앱이 아는 공급자 id. V-21이 이 값을 검증한다 */
  provider: string
  /** 지금 저장된 심볼. `null`이면 미매핑 */
  current: string | null
}) {
  const [state, formAction] = useActionState(
    saveProviderSymbolAction,
    initialFormState({ providerSymbol: current ?? '' }),
  )

  const failed = state.status === 'ERROR'
  const symbolError = state.fieldErrors.providerSymbol ?? state.fieldErrors.provider

  return (
    <details className="lg:col-span-full">
      <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">
        공급자 매핑{current == null ? '' : ` — ${current}`}
      </summary>

      <form action={formAction} className="mt-2 flex flex-col gap-1.5" noValidate>
        <input type="hidden" name="assetId" value={assetId} />
        <input type="hidden" name="provider" value={provider} />

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            name="providerSymbol"
            type="text"
            aria-label={`${assetName} 공급자 심볼`}
            aria-invalid={symbolError != null}
            defaultValue={state.values.providerSymbol ?? current ?? ''}
            placeholder="비우면 해제"
            className={`${INPUT_CLASS} min-w-48 flex-1`}
          />
          <SubmitButton label="매핑 저장" pendingLabel="저장 중…" variant="secondary" />
        </div>

        {/*
         * 표기 규약을 화면이 «말한다». 형태를 모르면 사용자가 티커만 넣게 되고 그러면
         * `SYMBOL_SCHEME`으로 거부되는데, 그 오류 문구만으로는 「1·2·3이 무엇인지」를
         * 알 수 없다. 여기 적어 두는 것이 그 왕복을 없앤다.
         *
         * ★ **해외 지수 예를 «반드시» 넣는다 — 종단 실측이 그 필요를 만들었다** (컷 3).
         * 국내 지수 예(`1:201`)만 두면 사용자가 S&P500을 `1:SPX`로 넣는데 올바른 코드는
         * **`1:_SPX`**(선행 밑줄)이고, 그 상태의 결과는 `NO_DATA`다 — 즉 **오류가 아니라
         * 「데이터 없음」으로 보고되고** 조치가 매핑 수정임을 문구에서 읽어야 한다.
         * 실제로 그 경로를 밟았고(응답: 「거래소 코드가 비어 있다」) 그것이 이 한 줄의 근거다.
         */}
        <p className="text-xs text-neutral-500">
          형태는 <span className="font-mono">분류:코드</span> — 1 지수 · 2 국내주식 · 3 해외주식
          (예: <span className="font-mono">1:201</span> ·{' '}
          <span className="font-mono">1:_SPX</span> ·{' '}
          <span className="font-mono">2:A005930</span> ·{' '}
          <span className="font-mono">3:AAPL</span>)
        </p>
        <p className="text-xs text-neutral-500">
          해외 지수는 <strong>선행 밑줄</strong>이 붙는다 —{' '}
          <span className="font-mono">1:_SPX</span> ·{' '}
          <span className="font-mono">1:_SX5E</span> ·{' '}
          <span className="font-mono">1:_HK#HIDX</span> ·{' '}
          <span className="font-mono">1:_JP#NI225</span>
        </p>

        {state.message != null && (
          <p
            role={failed ? 'alert' : 'status'}
            className={`text-xs ${failed ? 'text-red-700' : 'text-emerald-700'}`}
          >
            {state.message}
          </p>
        )}
        {symbolError != null && <p className="text-xs text-red-700">{symbolError}</p>}
        {/* 어느 칸과도 짝지어지지 않은 오류를 버리지 않는다 */}
        {state.unmatched.map(({ key, message }) => (
          <p key={key} className="text-xs text-red-700">
            <span className="font-mono">{key}</span> {message}
          </p>
        ))}
      </form>
    </details>
  )
}
