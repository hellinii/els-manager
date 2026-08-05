'use server'

import { createAsset, refreshPrices, saveManualPrice, saveProviderSymbol } from '@/app/actions'
import {
  parseAssetForm,
  parseManualPriceForm,
  parseProviderSymbolForm,
} from '@/lib/forms/parse'
import { refreshSummary } from '@/lib/format'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'

/**
 * SCR-302의 어댑터 — **얇다. 세 줄이 전부다**
 *
 * `src/app/actions.ts`가 아니다. 그 파일은 DOC-011 §5의 계약 열하나를 1:1로
 * 노출하는 것이 불변식이고, 폼 상태 변환은 그 열하나가 아니다.
 *
 * 이 파일은 `@/app/actions`를 거쳐 `server.ts`를 끌어오므로 **어떤 스위트의
 * import 그래프에도 들어갈 수 없다**(AQ-23). 그래서 여기 있는 것은 배선뿐이고
 * 파싱(`lib/forms/parse.ts`)과 상태 변환(`lib/forms/state.ts`)은 순수 모듈에서
 * 상시 스위트가 본다. 「위험한 부분만 테스트 안에 남긴다」의 적용이다.
 *
 * **무효화를 여기서 부르지 않는다.** `getMutations()`가 이미 감싸고 있다
 * (`server.ts`의 `withInvalidation`). 여기서 또 부르면 두 곳이 되고, 한쪽이
 * 빠져도 아무것도 실패하지 않는다.
 */

/** 수동 시세 입력의 칸 이름. `toFormState`가 미매칭 오류를 가르는 기준이다. */
const PRICE_FIELDS = ['assetId', 'asOfDate', 'price'] as const
const ASSET_FIELDS = ['name', 'assetType', 'market', 'currency'] as const
const PROVIDER_SYMBOL_FIELDS = ['assetId', 'provider', 'providerSymbol'] as const

export async function saveManualPriceAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await saveManualPrice(parseManualPriceForm(form))
  return toFormState(result, valuesOf(form), PRICE_FIELDS, '시세를 저장했다.')
}

export async function createAssetAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await createAsset(parseAssetForm(form))
  // 성공하면 입력을 비운다 — 같은 자산을 두 번 등록하려는 것이 아니라 다음 자산을
  // 등록하는 것이 자연스러운 다음 행동이고, 남아 있으면 재제출이 CONFLICT가 된다.
  return toFormState(result, result.ok ? {} : valuesOf(form), ASSET_FIELDS, '자산을 등록했다.')
}

/**
 * §5.8 — 인자를 쓰지 않는데도 `(prev, formData)` 서명을 지키는 이유는 **하이드레이션
 * 전에도 동작해야** 하기 때문이다 — `useActionState`에 클라이언트 화살표 함수
 * (`() => refreshPricesAction()`)를 넘기면 그것은 서버 액션 참조가 아니므로 React가 폼을
 * `action="javascript:throw new Error('React form unexpectedly submitted.')"`로
 * 렌더한다. **JS 없이 누르면 아무 일도 일어나지 않는다.** 실측으로 확인했고
 * (`tests/e2e/prices.test.ts`가 그 형태를 잡았다) 서명을 맞춰 고쳤다.
 *
 * ## ★ 결과를 «버리지 않는다» (P5a 컷 3)
 *
 * 종전 문구는 고정된 「시세를 갱신했다.」였고 그래서 `succeeded`·`skipped`·`unmapped`·
 * `failed[]` 넷에 **표시 표면이 없었다.** 공급자가 0개인 동안 그 갈래에 닿지 않아
 * 무해했으므로 — 즉 **수집기가 오는 순간 실재하는 결함이 되는 부류**였고 같은 컷에서
 * 고친다. 문구 조립은 순수 모듈(`refreshSummary`)이 하며 상시 스위트가 그 분기표를 본다
 * (이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 그래프에도 들어갈 수 없다 — AQ-23).
 *
 * `PROVIDER_UNAVAILABLE`은 여전히 **오류가 아니다**(ST-03) — 그 판정은 `code`로 하고
 * 화면(`RefreshButton`)이 등급을 고른다.
 */
export async function refreshPricesAction(
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  const result = await refreshPrices()
  return toFormState(result, {}, [], result.ok ? refreshSummary(result.data) : undefined)
}

/**
 * §5.12 — 공급자 심볼 매핑. 빈 칸이 «해제»다(`parseProviderSymbolForm`).
 *
 * ★ 성공해도 입력을 **비우지 않는다** — `createAssetAction`과 반대다. 저장된 값이
 * 그 칸의 현재 상태이므로 비우면 「저장했더니 사라졌다」로 읽히고, 해제한 경우에는
 * 이미 비어 있다. 즉 어느 갈래에서도 비울 이유가 없다.
 */
export async function saveProviderSymbolAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await saveProviderSymbol(parseProviderSymbolForm(form))
  return toFormState(
    result,
    valuesOf(form),
    PROVIDER_SYMBOL_FIELDS,
    // 해제와 저장을 같은 문구로 말하지 않는다 — 사용자가 한 조작이 다르다
    form.get('providerSymbol')?.toString().trim() === ''
      ? '자동 수집을 해제했다.'
      : '공급자 매핑을 저장했다.',
  )
}
