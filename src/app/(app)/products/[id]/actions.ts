'use server'

import { redirect } from 'next/navigation'

import {
  deleteProduct,
  deleteRedemption,
  setKiTouched,
  updateRedemption,
} from '@/app/actions'
import { parseRedemptionForm, parseTouchedAtForm, text } from '@/lib/forms/parse'
import { REDEMPTION_FIELDS, REDEMPTION_ID_FIELD } from '@/lib/forms/redemption'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'
import { PRODUCT_ID_FIELD } from '@/lib/forms/steps'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-202의 어댑터 — 상세 화면의 액션 넷 (P4 컷 5·6)
 *
 * 컷 5는 삭제 하나였고 컷 6이 상환 수정·취소와 KI 터치 확정을 더한다 — 넷 다
 * DOC-011 §8이 SCR-202에 배정한 계약이고, 라우트가 하나이므로 어댑터도 하나다.
 *
 * `src/app/actions.ts`가 아닌 이유는 SCR-302·204의 어댑터와 같다: 그 파일은 §5의
 * 계약 열하나를 1:1로 노출하는 것이 불변식이다.
 *
 * ## 셋은 리다이렉트하지 않는다
 *
 * 상품 삭제만 화면이 사라지므로 목록으로 간다. 상환 수정·취소·KI 터치는 **같은 화면이
 * 남고 그 화면의 내용이 바뀌는** 일이므로 결과 객체를 돌려주고 무효화가 재렌더를
 * 만든다(`getMutations()`의 `withInvalidation`). 리다이렉트를 걸면 성공 문구를 놓치고,
 * 무엇보다 실패 시 입력값을 잃는다.
 */

/** 삭제 폼의 칸 — id 하나다. `toFormState`가 미매칭 오류를 가르는 기준이 된다 */
const DELETE_FIELDS = [PRODUCT_ID_FIELD] as const

/** §5.9의 `fields` 키는 `kiTouchedAt`이다 — 파라미터 이름(`touchedAt`)이 아니다(v1.1) */
const KI_FIELDS = ['kiTouchedAt'] as const

/**
 * §5.3 — **성공하면 목록으로 간다. 상세는 이미 없다**
 *
 * 상세에 머물면 그 화면의 `getProduct`가 `null`을 주고 `notFound()`가 404를 낸다 —
 * 사용자가 방금 한 일의 결과가 「페이지를 찾을 수 없다」로 보인다. DOC-008 §7.1이
 * 삭제의 이탈을 SCR-201로 그린 이유다.
 *
 * **실패는 결과 객체로 돌아온다.** 대부분 `CONFLICT`(상환 실적이 있다)이고 그 문구는
 * 계약이 만든다 — 화면이 다시 쓰면 두 곳이 갈리고, 어느 쪽이 정본인지 알 수 없다.
 * 컷 6부터 그 문구가 가리키는 상환 취소가 **같은 화면에 있다**(2단계의 첫 단계).
 */
export async function deleteProductAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await deleteProduct(text(form, PRODUCT_ID_FIELD))

  if (result.ok) redirect(PATHS.products)

  return toFormState(result, valuesOf(form), DELETE_FIELDS)
}

/**
 * §5.5 상환 수정 — **확정된 과세 이력을 고치는 일이다** (P4 컷 6)
 *
 * `taxableIncome`·`redemptionDate`를 고치면 §4.6의 연도별 집계가 그대로 바뀐다.
 * 그래서 문구가 「값을 고친다」가 아니라 그 사실을 말하고, 화면이 취소와 **같은 수준의
 * 확인**을 둔다(§5.5 v0.9).
 *
 * 리다이렉트하지 않는다 — 같은 화면이 남고 내용이 바뀌는 일이므로 성공 문구를 보여야
 * 하고, 실패 시 입력값이 보존되어야 한다(§6).
 */
export async function updateRedemptionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await updateRedemption(
    text(form, REDEMPTION_ID_FIELD),
    parseRedemptionForm(form),
  )

  return toFormState(result, valuesOf(form), REDEMPTION_FIELDS, '상환 실적을 고쳤다.')
}

/**
 * §5.5 상환 취소 — **상품 삭제 2단계의 첫 단계다**
 *
 * §5.3이 상환 완료 상품의 삭제를 `CONFLICT`로 막으므로 상품을 지우려는 사용자는 반드시
 * 이 계약을 먼저 통과한다. 그 순서가 설계이며(DQ-01을 도입하지 않은 결정의 짝)
 * 두 단계의 확인 문구가 **서로 다른 것을 말한다** — 첫 단계는 「이 해의 금융소득이
 * 바뀐다」, 둘째는 「상품이 사라진다」.
 *
 * 성공 뒤 이 화면이 살아 있다 — 상품은 그대로이고 상태만 보유중으로 되돌아간다.
 * 그러므로 리다이렉트가 없고, 무효화가 상세를 다시 렌더해 상환 실적 절이 사라진다.
 */
export async function deleteRedemptionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await deleteRedemption(text(form, REDEMPTION_ID_FIELD))

  return toFormState(
    result,
    valuesOf(form),
    [REDEMPTION_ID_FIELD],
    '상환을 취소했다. 상품이 보유중으로 돌아갔다.',
  )
}

/**
 * §5.9 KI 터치 확정 — **시스템이 자동 확정하지 않는다** (D-04)
 *
 * 일 배치 종가 수집으로는 `CONTINUOUS` 관찰의 장중 터치를 확인할 수 없으므로 확정은
 * 사용자의 조치다. 빈 칸이 해제(`null`)이며 그 변환은 `parseTouchedAtForm`에 있다 —
 * 버튼으로 의도를 나르지 않는 이유는 해제가 「비우고 저장」이라는 한 동작이기 때문이다.
 */
export async function setKiTouchedAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const touchedAt = parseTouchedAtForm(form)
  const result = await setKiTouched(text(form, PRODUCT_ID_FIELD), touchedAt)

  return toFormState(
    result,
    valuesOf(form),
    KI_FIELDS,
    touchedAt == null ? 'KI 터치를 해제했다.' : 'KI 터치를 확정했다.',
  )
}
