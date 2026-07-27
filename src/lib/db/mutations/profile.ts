import { parseTaxProfileInput } from '../validate/inputs'
import { Problems } from '../validate/primitives'
import { requireAffected } from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { toInsert } from './payload'
import { failWith, okVoid, type ActionResult } from './result'
import type { TaxProfileInput } from './types'

/** §5.6 — 과세 프로필 저장 */

export function makeProfileMutations(ctx: MutationContext) {
  /**
   * `UNIQUE(user_id, tax_year)` 기준 UPSERT.
   *
   * `user_id`는 **인증 사용자로 서버에서 설정한다** — 입력값으로 받지 않는 것이
   * §5.1의 `owner_id`와 같은 이유이며, 여기서는 조회도 본인 한정이므로
   * (`tax_profiles_select_self`) 남의 값을 쓰면 그 결과를 **본인은 볼 수도 없다.**
   *
   * **`tax_years`에 시드된 연도로 제한하지 않는다.** `tax_profiles.tax_year`에는
   * FK가 없고 그것이 의도다 — 조회 계층이 시드보다 미래 연도를 최신 시드로
   * 근사하고 `taxLawYear`로 드러내므로(§4.6), 2027년 프로필을 2027년 세율
   * 마이그레이션 전에 저장하는 것은 정상 경로다.
   */
  async function saveTaxProfile(input: TaxProfileInput): Promise<ActionResult<void>> {
    const p = new Problems()
    const parsed = parseTaxProfileInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const { data, error } = await ctx.db
      .from('tax_profiles')
      .upsert(
        toInsert('tax_profiles', {
          user_id: ctx.viewerId,
          tax_year: parsed.year,
          other_income_base: parsed.otherIncomeBase,
          other_financial_income: parsed.otherFinancialIncome,
          health_insurance_type: parsed.healthInsuranceType,
        }),
        { onConflict: 'user_id,tax_year' },
      )
      .select('id')
    if (error != null) return failDb(error, '과세 프로필 저장')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  return { saveTaxProfile }
}
