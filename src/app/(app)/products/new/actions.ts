'use server'

import { transition } from '@/lib/forms/steps'
import { initialFormState, type FormState } from '@/lib/forms/state'

/**
 * SCR-204의 어댑터 — **전이 한 번과 (컷 4b의) 계약 한 번이 전부다**
 *
 * 이 파일은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 그래서 단계 전이·행 연산·값 좁힘은 전부 `lib/forms/steps.ts`에
 * 있고(상시 스위트가 전수로 본다) 여기 남는 것은 배선이다 — 「위험한 부분만
 * 테스트 안에 남긴다」의 적용이며 SCR-302의 어댑터와 같은 형태다.
 *
 * `src/app/actions.ts`가 아닌 이유도 같다: 그 파일은 DOC-011 §5의 계약 열하나를
 * 1:1로 노출하는 것이 불변식이고 단계 전이는 그 열하나가 아니다.
 *
 * **컷 4a에는 제출이 없다.** `SUBMIT` 의도는 전이에서 같은 단계에 머물며
 * (`moveStep`) 저장 버튼 자체가 렌더되지 않는다 — 그 사실은 `PENDING_PARTS`가
 * 들고 있고 컷 4b가 `createProduct` 결선을 여기 붙인다.
 */
export async function productFormAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const next = transition(form)

  /*
   * 오류 없는 전이다 — `initialFormState`를 쓰는 이유는 이전 제출의 오류가 다음
   * 단계까지 따라오면 「고쳤는데도 빨간 글씨가 남는」 상태가 되기 때문이다.
   * 안내(`notice`)는 오류가 아니므로 `status`를 바꾸지 않는다.
   */
  const state = initialFormState(next.values)
  return next.notice == null ? state : { ...state, message: next.notice }
}
