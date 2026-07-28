'use server'

import { redirect } from 'next/navigation'

import { createProduct } from '@/app/actions'
import { parseProductForm } from '@/lib/forms/parse'
import { stepState, submitState, transition } from '@/lib/forms/steps'
import type { FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-204 등록의 어댑터 — **전이 한 번, 계약 한 번, 그리고 리다이렉트**
 *
 * 이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수 없다
 * (AQ-23). 그래서 단계 전이·행 연산·값 좁힘·파싱·오류 단계 판정이 전부 순수 모듈에
 * 있고(상시 스위트가 전수로 본다) 여기 남는 것은 배선이다 — 「위험한 부분만 테스트
 * 안에 남긴다」의 적용이며 SCR-302의 어댑터와 같은 형태다.
 *
 * `src/app/actions.ts`가 아닌 이유도 같다: 그 파일은 DOC-011 §5의 계약 열하나를
 * 1:1로 노출하는 것이 불변식이고 폼 상태 변환은 그 열하나가 아니다.
 *
 * **무효화를 여기서 부르지 않는다.** `getMutations()`가 이미 감싸고 있다
 * (`server.ts`의 `withInvalidation`). 여기서 또 부르면 두 곳이 되고, 한쪽이 빠져도
 * 아무것도 실패하지 않는다.
 *
 * > **수정 어댑터와 세 줄이 같다** (컷 5). 그 세 줄(`stepState`·`submitState`·
 * > `transition`)은 순수 모듈에 있고 여기 남은 차이는 **어느 계약을 부르는가**와
 * > 성공 뒤 어디로 가는가뿐이다.
 */
export async function productFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const next = transition(form)
  if (next.intent.kind !== 'SUBMIT') return stepState(next)

  const result = await createProduct(parseProductForm(form))

  /*
   * 성공하면 **상세로 보낸다** — DOC-008 §7.1의 「[저장] → SCR-202 상세」다.
   * `redirect()`는 `NEXT_REDIRECT`를 던지므로 try/catch 밖이어야 하고(여기에는
   * catch가 없다) 결과 객체를 돌려주는 경로와 섞이지 않는다.
   */
  if (result.ok) redirect(PATHS.product(result.data.id))

  return submitState(result, next)
}
