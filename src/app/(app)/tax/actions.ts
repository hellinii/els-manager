'use server'

import { saveTaxProfile } from '@/app/actions'
import { parseTaxProfileForm } from '@/lib/forms/parse'
import { toFormState, valuesOf, type FormState } from '@/lib/forms/state'

/**
 * SCR-401의 어댑터 — **저장 하나뿐이다** (P4 컷 8)
 *
 * 조정(시뮬레이션)은 이 파일에 없다. 그것이 DOC-011 §4.6이 요구한 분리의 형태다 —
 * 조정은 `<form method="GET">`이므로 서버 액션을 지나지 않고, 그래서 **실수로
 * 저장하는 코드를 쓸 수 없다.** 이 파일에 export가 하나라는 사실이 그 보장의
 * 관측 가능한 형태이며, `tests/e2e/tax.test.ts`가 렌더된 문서에서 같은 것을 본다
 * (조정 폼에 `$ACTION_*` 히든 필드가 없다).
 *
 * 다른 어댑터와 같은 규율: 파싱은 `lib/forms/parse.ts`(순수), 상태 변환은
 * `lib/forms/state.ts`(순수), 여기 남는 것은 배선 세 줄이다(AQ-23).
 */

/**
 * `fields` 키가 될 수 있는 이름 — `toFormState`가 미매칭 오류를 가르는 기준이다.
 *
 * 이 폼의 칸은 전부 히든이지만(값은 조정 폼에서 온다) `fields` 키 판정은 이름으로
 * 하므로 다를 것이 없다. V-20(`year`)·V-19(나머지 셋)가 이 넷을 가리킨다.
 */
const PROFILE_FIELDS = [
  'year',
  'otherIncomeBase',
  'otherFinancialIncome',
  'healthInsuranceType',
] as const

export async function saveTaxProfileAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await saveTaxProfile(parseTaxProfileForm(form))
  /*
   * 성공해도 값을 비우지 않는다 — 다음 렌더에서 화면이 저장된 값을 다시 읽어
   * 히든에 실으므로(서버가 정본이다) 여기서 비우면 그 사이의 재제출이 빈 폼이 된다.
   * `createAsset`이 성공 시 비우는 것과 반대인 이유: 그쪽은 「다음 자산을 등록」이
   * 자연스러운 다음 행동이고, 여기는 같은 연도의 프로필이 하나뿐이다(UPSERT).
   */
  return toFormState(
    result,
    valuesOf(form),
    PROFILE_FIELDS,
    '과세 프로필을 저장했다.',
  )
}
