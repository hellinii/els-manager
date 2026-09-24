'use server'

import { redirect } from 'next/navigation'

import { createAsset, saveProviderSymbol, updateProduct } from '@/app/actions'
import { parseImportAssetForm, runImportAsset, type ImportAssetState } from '@/lib/forms/import'
import { formOfValues, parseProductForm, text } from '@/lib/forms/parse'
import { PRODUCT_ID_FIELD, intentState, submitState, transition } from '@/lib/forms/productForm'
import { importHref, isUuid } from '@/lib/forms/query'
import type { FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-204 수정의 어댑터 — 등록과 **한 줄만 다르다** (P4 컷 5)
 *
 * 다른 줄은 계약 호출이다: `createProduct(input)` → `updateProduct(id, input)`.
 * 의도 해석·행 연산·배리어 펼침·값 좁힘은 `lib/forms/productForm.ts`의 같은 함수를
 * 부른다 — 여기 복제하면 두 화면의 오류 표시가 갈릴 수 있고, 두 어댑터는 어떤
 * 스위트의 import 그래프에도 없으므로(AQ-23) 그 갈림을 아무도 보지 못한다.
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
  // 저장 보류(평가일 기준 변경 + 실제 날짜, DOC-008 v2.8)는 계약을 부르지 않는다 — 안내만 돌려준다.
  if (next.intent.kind !== 'SUBMIT' || next.saveHeld) return intentState(next)

  const id = text(form, PRODUCT_ID_FIELD)
  // 계약 입력은 `next.values`에서 나온다 — 등록 어댑터의 각주와 같은 이유다.
  // id만 원본 폼에서 읽는다(`PRODUCT_ID_FIELD`는 계약 필드가 아니라 라우트 파라미터의
  // 대체물이므로 `productFieldNames`에 없고 따라서 `next.values`에도 없다).
  const result = await updateProduct(
    id,
    parseProductForm(formOfValues(next.values)),
  )

  // 성공하면 상세로 — 등록과 같은 도착지다(§7.1). 수정한 값을 확인하는 화면이 그곳이다.
  if (result.ok) redirect(PATHS.product(result.data.id))

  return submitState(result, next)
}

/**
 * 수정 화면 불러오기의 형제 폼 — 기존 자산에 연결 / 자산 추가 (DOC-008 SCR-204 v2.12)
 *
 * 등록 어댑터(`products/new/actions.ts`의 `importAssetAction`)와 **복귀 주소만 다르다** — 규칙과 두
 * 계약(§5.10 → §5.12)은 같은 `runImportAsset`이 부른다. 대상 id는 폼에서 읽고(`PRODUCT_ID_FIELD` —
 * 위 어댑터와 같은 이유) **쓰기 전에** 형식을 본다: 자산을 만든 뒤에 복귀 주소를 만들 수 없음을
 * 알면 사용자는 성공한 쓰기에 실패 문구를 받는다. 소유는 여기서 보지 않는다 — 두 계약은 상품에
 * 닿지 않고, 복귀한 수정 화면이 소유를 다시 판정한다(비소유자는 SCR-902).
 */
export async function importAssetEditAction(
  _prev: ImportAssetState,
  form: FormData,
): Promise<ImportAssetState> {
  const productId = text(form, PRODUCT_ID_FIELD)
  if (!isUuid(productId)) return { message: '어느 상품의 수정인지 알 수 없는 제출이다 — 수정 화면을 다시 연다.' }

  const outcome = await runImportAsset(parseImportAssetForm(form), { createAsset, saveProviderSymbol })
  if (outcome.ok) redirect(importHref({ kind: 'EDIT', productId }, outcome.back))
  return { message: outcome.message }
}
