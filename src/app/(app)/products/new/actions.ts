'use server'

import { redirect } from 'next/navigation'

import { createProduct } from '@/app/actions'
import { parseProductForm } from '@/lib/forms/parse'
import {
  STEP_FIELD,
  productFieldNames,
  stepForErrors,
  transition,
} from '@/lib/forms/steps'
import { initialFormState, toFormState, type FormState } from '@/lib/forms/state'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-204의 어댑터 — **전이 한 번, 계약 한 번, 그리고 리다이렉트**
 *
 * 이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 그래서 단계 전이·행 연산·값 좁힘·파싱·오류 단계 판정이 전부 순수
 * 모듈에 있고(상시 스위트가 전수로 본다) 여기 남는 것은 배선이다 — 「위험한 부분만
 * 테스트 안에 남긴다」의 적용이며 SCR-302의 어댑터와 같은 형태다.
 *
 * `src/app/actions.ts`가 아닌 이유도 같다: 그 파일은 DOC-011 §5의 계약 열하나를
 * 1:1로 노출하는 것이 불변식이고 폼 상태 변환은 그 열하나가 아니다.
 *
 * **무효화를 여기서 부르지 않는다.** `getMutations()`가 이미 감싸고 있다
 * (`server.ts`의 `withInvalidation`). 여기서 또 부르면 두 곳이 되고, 한쪽이 빠져도
 * 아무것도 실패하지 않는다.
 */
export async function productFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const next = transition(form)

  if (next.intent.kind !== 'SUBMIT') {
    /*
     * 오류 없는 전이다 — `initialFormState`를 쓰는 이유는 이전 제출의 오류가 다음
     * 단계까지 따라오면 「고쳤는데도 빨간 글씨가 남는」 상태가 되기 때문이다.
     * 안내(`notice`)는 오류가 아니므로 `status`를 바꾸지 않는다.
     */
    const state = initialFormState(next.values)
    return next.notice == null ? state : { ...state, message: next.notice }
  }

  const result = await createProduct(parseProductForm(form))

  /*
   * 성공하면 **상세로 보낸다** — DOC-008 §7.1의 「[저장] → SCR-202 상세」다.
   * `redirect()`는 `NEXT_REDIRECT`를 던지므로 try/catch 밖이어야 하고(여기에는
   * catch가 없다) 결과 객체를 돌려주는 경로와 섞이지 않는다.
   */
  if (result.ok) redirect(PATHS.product(result.data.id))

  /*
   * 실패하면 **오류가 있는 단계로 되돌린다.** ④에서 제출했는데 오류가 ①에 있으면
   * 사용자는 그 문구를 볼 수 없다(그 칸이 히든이다) — 「저장이 안 되는데 아무
   * 표시도 없다」의 단계 폼 버전이다.
   *
   * `knownNames`는 **폼 전체**의 이름이다(활성 단계의 것만 주면 다른 단계의 오류가
   * 전부 미매칭으로 상단에 쌓이고 정작 칸에는 표시되지 않는다).
   */
  const state = toFormState(result, next.values, productFieldNames(next.counts))
  const failed = stepForErrors(state.fieldErrors)

  return failed == null
    ? state
    : { ...state, values: { ...state.values, [STEP_FIELD]: failed } }
}
