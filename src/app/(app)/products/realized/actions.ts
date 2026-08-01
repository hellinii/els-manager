'use server'

import { redirect } from 'next/navigation'

import { createRealizedProduct } from '@/app/actions'
import { parseRealizedProductForm } from '@/lib/forms/parse'
import { REALIZED_FIELDS } from '@/lib/forms/realized'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-205의 어댑터 — 파서 하나, 계약 하나, 리다이렉트 (DOC-011 §5.11)
 *
 * SCR-203·204·302의 어댑터와 같은 형태다. 이 파일은 `server.ts`를 끌어오므로 어떤
 * 스위트의 import 그래프에도 들어갈 수 없고(AQ-23), 그래서 파싱(`lib/forms/parse.ts`)과
 * 초기값·파생(`lib/forms/realized.ts`)과 상태 변환(`lib/forms/state.ts`)이 전부 순수
 * 모듈에 있다. 여기 남는 것은 세 줄이다.
 *
 * **성공은 상세로 간다.** 계약이 상품 id를 주므로(§5.11) SCR-202에서 등재 결과를
 * 확인한다 — 그 화면이 「기실현 등재」임을 적고 상환 실적 절을 보여 준다.
 */
export async function realizedFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await createRealizedProduct(parseRealizedProductForm(form))

  if (result.ok) redirect(PATHS.product(result.data.id))

  // 실패는 입력값과 함께 돌아온다 — §6이 SCR-205에 「입력값 보존」을 요구한다.
  return toFormState(result, valuesOf(form), REALIZED_FIELDS)
}
