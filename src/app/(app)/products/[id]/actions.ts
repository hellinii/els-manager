'use server'

import { redirect } from 'next/navigation'

import { deleteProduct } from '@/app/actions'
import { text } from '@/lib/forms/parse'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-202의 어댑터 — 상세 화면의 액션들 (P4 컷 5·6)
 *
 * 컷 5는 삭제 하나다. 컷 6이 상환 수정·취소와 KI 터치 확정을 여기 더한다 — 셋 다
 * DOC-011 §8이 SCR-202에 배정한 계약이고, 라우트가 하나이므로 어댑터도 하나다.
 *
 * `src/app/actions.ts`가 아닌 이유는 SCR-302·204의 어댑터와 같다: 그 파일은 §5의
 * 계약 열하나를 1:1로 노출하는 것이 불변식이다.
 */

/** 삭제 폼의 칸 — id 하나다. `toFormState`가 미매칭 오류를 가르는 기준이 된다 */
const DELETE_FIELDS = [PRODUCT_ID_FIELD] as const

/**
 * §5.3 — **성공하면 목록으로 간다. 상세는 이미 없다**
 *
 * 상세에 머물면 그 화면의 `getProduct`가 `null`을 주고 `notFound()`가 404를 낸다 —
 * 사용자가 방금 한 일의 결과가 「페이지를 찾을 수 없다」로 보인다. DOC-008 §7.1이
 * 삭제의 이탈을 SCR-201로 그린 이유다.
 *
 * **실패는 결과 객체로 돌아온다.** 대부분 `CONFLICT`(상환 실적이 있다)이고 그 문구는
 * 계약이 만든다 — 화면이 다시 쓰면 두 곳이 갈리고, 어느 쪽이 정본인지 알 수 없다.
 * 다음 행동(상환 취소)은 컷 6에 서므로 그때까지 문구만 있다.
 */
export async function deleteProductAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await deleteProduct(text(form, PRODUCT_ID_FIELD))

  if (result.ok) redirect(PATHS.products)

  return toFormState(result, valuesOf(form), DELETE_FIELDS)
}
