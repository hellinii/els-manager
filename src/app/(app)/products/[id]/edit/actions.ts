'use server'

import { redirect } from 'next/navigation'

import { updateProduct } from '@/app/actions'
import { parseProductForm, text } from '@/lib/forms/parse'
import { PRODUCT_ID_FIELD, stepState, submitState, transition } from '@/lib/forms/steps'
import type { FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-204 수정의 어댑터 — 등록과 **한 줄만 다르다** (P4 컷 5)
 *
 * 다른 줄은 계약 호출이다: `createProduct(input)` → `updateProduct(id, input)`.
 * 단계 전이·값 좁힘·오류 단계 판정은 `lib/forms/steps.ts`의 같은 함수를 부른다 —
 * 여기 복제하면 두 화면의 오류 표시가 갈릴 수 있고, 두 어댑터는 어떤 스위트의 import
 * 그래프에도 없으므로(AQ-23) 그 갈림을 아무도 보지 못한다.
 *
 * ## 대상 id는 폼에서 읽는다
 *
 * `useActionState`의 서명이 `(prev, formData)`이므로 라우트 파라미터가 자동으로 오지
 * 않는다(`PRODUCT_ID_FIELD`의 각주). 조작된 id는 계약이 거부한다 — `updateProduct`가
 * 사전 조회로 소유를 확인하고 RLS가 그 위에 한 겹 더 있으므로 결과는 `FORBIDDEN`
 * 또는 `NOT_FOUND`이며, 둘 다 `FormMessage`가 상단에 그린다.
 *
 * ## `updateProduct`는 **전체 교체**다
 *
 * 폼이 보내지 않은 필드는 비워진다(§5.2). 그 위험은 이 파일이 아니라 초기값 쪽에
 * 있고(`productValuesOf`) `tests/app/values.test.ts`가 폼의 모든 이름이 초기값에
 * 있음을 파생으로 확인한다.
 */
export async function productEditFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const next = transition(form)
  if (next.intent.kind !== 'SUBMIT') return stepState(next)

  const id = text(form, PRODUCT_ID_FIELD)
  const result = await updateProduct(id, parseProductForm(form))

  // 성공하면 상세로 — 등록과 같은 도착지다(§7.1). 수정한 값을 확인하는 화면이 그곳이다.
  if (result.ok) redirect(PATHS.product(result.data.id))

  return submitState(result, next)
}
