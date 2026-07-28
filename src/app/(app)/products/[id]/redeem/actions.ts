'use server'

import { redirect } from 'next/navigation'

import { createRedemption } from '@/app/actions'
import { parseRedemptionForm, text } from '@/lib/forms/parse'
import { REDEMPTION_FIELDS } from '@/lib/forms/redemption'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-203의 어댑터 — 파서 하나, 계약 하나, 리다이렉트 (P4 컷 6)
 *
 * SCR-302·204의 어댑터와 같은 형태다. 이 파일은 `server.ts`를 끌어오므로 어떤
 * 스위트의 import 그래프에도 들어갈 수 없고(AQ-23), 그래서 파싱(`lib/forms/parse.ts`)과
 * 기본값(`lib/forms/redemption.ts`)과 상태 변환(`lib/forms/state.ts`)이 전부 순수
 * 모듈에 있다.
 *
 * **성공은 상세로 간다.** DOC-008 §7.1: 「[저장] → SCR-202 (상환완료 상태)」. 그
 * 화면에서 상태 전이의 결과를 본다 — 상환 실적 절이 생기고 예상 수령액 절이
 * 「상환이 완료되어 추정하지 않는다」로 바뀐다(E-05).
 */
export async function redemptionFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const productId = text(form, PRODUCT_ID_FIELD)
  const result = await createRedemption(productId, parseRedemptionForm(form))

  if (result.ok) redirect(PATHS.product(productId))

  /*
   * 실패는 입력값과 함께 돌아온다(§6이 SCR-203에 「입력값 보존」을 요구한다).
   * `valuesOf(form)`이 히든 id까지 담지만 `knownNames`에 없으므로 오류가 그 칸에
   * 붙지 않는다 — 그것이 옳다: id는 사용자가 고칠 칸이 아니다.
   */
  return toFormState(result, valuesOf(form), REDEMPTION_FIELDS)
}
