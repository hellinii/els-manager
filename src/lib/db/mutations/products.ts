import {
  parseProductInput,
  parseRealizedProductInput,
  parseTouchedAt,
} from '../validate/inputs'
import { Problems } from '../validate/primitives'
import { V18_kiTouchedRequiresBarrier } from '../validate/rules'
import { requireAffected, requireOwnedProduct, staleState } from './access'
import type { MutationContext } from './context'
import { failDb } from './errors'
import { toUpdate, type MoneyFieldsOf } from './payload'
import { withholdingFor } from './redemptions'
import { failWith, ok, okVoid, type ActionResult } from './result'
import type { ProductInput, RealizedProductInput } from './types'

/** §5.1~§5.3·§5.9·§5.11 — 상품 생성·수정·삭제·KI 터치 확정·기실현 등재 */

/**
 * `jsonb` payload의 형태 — **금액 열을 세 테이블에서 파생시킨다** (AQ-30 잔여 ③ 해결)
 *
 * 종전에는 반환 타입이 `Json`이었고 그것은 아무것도 강제하지 않았다. 세 테이블에
 * 새 금액 열이 생기면 이 함수와 SQL 함수를 손으로 고쳐야 하는데 **빠뜨려도 아무것도
 * 실패하지 않았다** — `.rpc()` 경로는 `InsertPayload<T>`도 린트 셀렉터도 보지 못하기
 * 때문이다(계약 11개 중 둘).
 *
 * `MoneyFieldsOf<T>`가 열 사양에서 이름을 뽑아 `string`을 요구하므로, 이제 새 금액
 * 열은 **컴파일 오류**로 나타난다. 「단언이 아니라 파생」인 이유는 고칠 곳이 하나로
 * 정해진다는 것이다(`payload.ts`의 각주).
 *
 * 나머지 필드는 여기 그대로 적는다 — 금액이 아닌 열은 이름이 계약 입력과 1:1이
 * 아니고(`total_rounds`는 DQ-05로 삭제되어 payload에 없다) 그 대응은 §5가 정본이다.
 */
type ProductPayload = MoneyFieldsOf<'els_products'> & {
  name: string
  issuer: string | null
  issueDate: string
  evaluationPeriodMonths: number
  kiObservation: string | null
  accountType: string
  note: string | null
  underlyings: Array<
    MoneyFieldsOf<'els_underlyings'> & { assetId: string; sequence: number }
  >
  schedules: Array<
    MoneyFieldsOf<'redemption_schedules'> & {
      roundNo: number
      evaluationDate: string
      lizardRequiresNoKi: boolean | null
    }
  >
}

/**
 * `jsonb` payload — DOC-011 §5.0 W-04.
 *
 * **금액·비율만 문자열이고 개수는 수치 그대로다.** 쓰기 함수가 금액을 `->>` 후
 * `::numeric`으로 캐스팅하므로 JSON 수치로 실으면 그 값은 이미 JS 쪽에서 float64를
 * 경유한 뒤다 — jsonb 자체는 numeric을 정확히 보존하지만 경계 **앞에서** 잃은
 * 정밀도를 되살리지는 못한다. 차수·개월수·순서는 세는 값이므로 수치가 맞다
 * (`select.ts`의 `CountingColumn`과 같은 구분이다).
 *
 * 없는 값을 `undefined`로 두지 않고 **`null`로 명시**한다. `JSON.stringify`가
 * `undefined` 키를 지우므로 결과는 같지만, `payload->>'kiBarrier'`가 "비었다"를
 * 뜻하는지 "안 보냈다"를 뜻하는지가 페이로드에 드러나는 편이 낫다 — `updateProduct`는
 * 전체 교체이므로 **누락이 곧 비움**이고 그 사실이 여기서 읽혀야 한다.
 */
function productPayload(input: ProductInput): ProductPayload {
  return {
    name: input.name,
    issuer: input.issuer ?? null,
    issueDate: input.issueDate,
    principal: input.principal,
    evaluationPeriodMonths: input.evaluationPeriodMonths,
    annualCouponRate: input.annualCouponRate,
    kiBarrier: input.kiBarrier ?? null,
    kiObservation: input.kiObservation ?? null,
    accountType: input.accountType,
    note: input.note ?? null,
    underlyings: input.underlyings.map((item) => ({
      assetId: item.assetId,
      basePrice: item.basePrice,
      sequence: item.sequence,
    })),
    schedules: input.schedules.map((item) => ({
      roundNo: item.roundNo,
      evaluationDate: item.evaluationDate,
      barrier: item.barrier,
      lizardBarrier: item.lizardBarrier ?? null,
      lizardCouponRate: item.lizardCouponRate ?? null,
      lizardRequiresNoKi: item.lizardRequiresNoKi ?? null,
    })),
  }
}

/**
 * §5.11의 payload — **금액을 두 테이블에서 각각 파생시킨다** (AQ-30과 같은 형태)
 *
 * `MoneyFieldsOf<'els_products'>`는 `principal`·`annualCouponRate`·`kiBarrier` 셋을
 * 요구하는데 이 계약은 원금만 받는다. 그래서 그 매핑 타입을 그대로 쓰지 않고
 * **`Pick`으로 좁힌다** — 좁힌 뒤에도 파생이 유지되므로 `els_products`에 새 금액
 * 열이 생기면 여기가 아니라 `MoneyFieldsOf` 쪽이 먼저 바뀌고, 그 열을 이 계약이
 * 받기로 하는 날 `Pick`에 이름을 더하는 것이 컴파일러가 보는 변경이 된다.
 *
 * 나머지 금액 넷은 `redemptions`에서 파생시킨다. `withholdingTax`가 선택적이 아닌
 * 이유는 **계약 계층이 이미 산출했기 때문**이다(미입력이면 `taxableIncome ×
 * 분리과세율`) — 여기서 `undefined`를 허용하면 그 산출을 건너뛰는 경로가 생긴다.
 */
type RealizedPayload = Pick<MoneyFieldsOf<'els_products'>, 'principal'> &
  Pick<
    MoneyFieldsOf<'redemptions'>,
    'grossAmount' | 'taxableIncome' | 'withholdingTax'
  > & {
    name: string
    issuer: string | null
    accountType: string
    redemptionType: string
    redemptionDate: string
    isConfirmed: boolean
    note: string | null
  }

function realizedPayload(
  input: RealizedProductInput,
  withholdingTax: string,
): RealizedPayload {
  return {
    name: input.name,
    issuer: input.issuer ?? null,
    principal: input.principal,
    accountType: input.accountType,
    redemptionType: input.redemptionType,
    redemptionDate: input.redemptionDate,
    grossAmount: input.grossAmount,
    taxableIncome: input.taxableIncome,
    withholdingTax,
    isConfirmed: input.isConfirmed,
    note: input.note ?? null,
  }
}

export function makeProductMutations(ctx: MutationContext) {
  /**
   * §5.1 — **쓰기 함수를 경유한다.**
   *
   * `.insert()` 세 번으로 만들지 않는 이유는 PostgREST가 요청당 1 트랜잭션이기
   * 때문이다. 두 번째가 실패하면 기초자산 0건인 상품이 남고, 그것은 §5.3이
   * "계약을 경유하는 어떤 조작도 만들 수 없다"고 단언한 상태다(I-07).
   *
   * `owner_id`는 보내지 않는다 — 함수가 `auth.uid()`로 박으므로 "입력값으로 받지
   * 않는다"가 규율이 아니라 구조다.
   */
  async function createProduct(input: ProductInput): Promise<ActionResult<{ id: string }>> {
    const p = new Problems()
    const parsed = parseProductInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const { data, error } = await ctx.db.rpc('create_els_product', {
      payload: productPayload(parsed),
    })
    if (error != null) return failDb(error, '상품 생성')

    // 생성 함수는 uuid를 반환하거나 예외를 던진다 — NULL은 올 수 없다. 그래도
    // 확인하는 것은 그 전제가 깨졌을 때 **없는 id를 화면에 넘기지 않기** 위함이다.
    const createdId: string | null = data
    if (createdId == null) {
      console.error('[DB] 상품 생성 — create_els_product가 NULL을 반환했다. 오류도 없었다.')
      return failWith({ code: 'INTERNAL', message: '처리 중 오류가 발생했다.' })
    }
    return ok({ id: createdId })
  }

  /**
   * §5.2 — 상품 열 갱신 + 하위 배열 **전체 교체**를 한 트랜잭션에.
   *
   * 원자성이 생성보다 더 필요하다: 교체는 **기존 행을 지운 상태**를 경유하므로
   * 그 사이에 끊기면 0건 상태가 남고 원본은 이미 없다.
   */
  async function updateProduct(
    id: string,
    input: ProductInput,
  ): Promise<ActionResult<{ id: string }>> {
    const p = new Problems()
    const parsed = parseProductInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const access = await requireOwnedProduct(ctx, id, '상품 수정')
    if (!access.ok) return failWith(access.error)

    // 상환 완료 상품은 수정 불가. 함수도 `els_products_redeemed_immutable`로
    // 거부하지만(두 번째 겹), 사전 조회가 있어야 **왜** 거부되는지 말할 수 있다.
    if (access.value.redemptions != null) {
      return failWith({
        code: 'CONFLICT',
        message: '상환 처리된 상품은 수정할 수 없다. 상환을 먼저 취소한다.',
      })
    }

    const { data, error } = await ctx.db.rpc('update_els_product', {
      p_id: id,
      payload: productPayload(parsed),
    })
    if (error != null) return failDb(error, '상품 수정')

    // ★ 생성 타입은 `Returns: string`이라 함수의 NULL(영향 행 0)이 타입에서
    //   사라진다(§5.2 각문). 복원하지 않으면 0행이 성공으로 읽힌다 — `::text`가
    //   널 허용을 잃는 것과 같은 부류다.
    const updatedId: string | null = data
    if (updatedId == null) return failWith(staleState())
    return ok({ id: updatedId })
  }

  /**
   * §5.3 — 하위 행은 FK `CASCADE`로 함께 지워진다.
   *
   * **상환 실적이 있으면 지울 수 없다.** DB의 `RESTRICT`가 최종 보장이고 사전
   * 조회는 그 이유를 말하기 위한 것이다. 상환까지 연쇄 삭제하면 조작 한 번으로
   * 실현된 과세 이력이 사라지고 해당 귀속연도의 세액이 아무 경고 없이 바뀐다.
   */
  async function deleteProduct(id: string): Promise<ActionResult<void>> {
    const access = await requireOwnedProduct(ctx, id, '상품 삭제')
    if (!access.ok) return failWith(access.error)

    if (access.value.redemptions != null) {
      return failWith({
        code: 'CONFLICT',
        message: '상환 실적이 있는 상품은 삭제할 수 없다. 상환을 먼저 취소한다.',
      })
    }

    const { data, error } = await ctx.db
      .from('els_products')
      .delete()
      .eq('id', id)
      .select('id')
    if (error != null) return failDb(error, '상품 삭제')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  /**
   * §5.9 — KI 터치 확정. `null`은 해제다.
   *
   * **미래 일자를 거부하지 않는다.** V-17은 시세에만 걸린다 — 터치 확정일은
   * 증권사 통지에서 옮겨 적는 외부 사실이고, 기준일보다 앞선 날짜는 입력 오류이기
   * 이전에 관측일과 통지일의 시차일 수 있다. 판정에서도 `ki_touched_at`은 존재
   * 여부만 쓰이므로(DOC-007 §3.4) 미래 일자가 판정을 틀리게 만드는 경로가 없다.
   */
  async function setKiTouched(
    productId: string,
    touchedAt: string | null,
  ): Promise<ActionResult<void>> {
    const p = new Problems()
    const parsed = parseTouchedAt(p, touchedAt)
    if (!p.isEmpty) return failWith(p.toError())

    const access = await requireOwnedProduct(ctx, productId, 'KI 터치 확정')
    if (!access.ok) return failWith(access.error)

    // V-18 — 노낙인 상품에는 터치를 설정할 수 없다(I-15). 해제(`null`)는 노낙인
    // 상품에서도 허용한다 — 이미 없는 것을 없애는 요청은 거부할 이유가 없다.
    const value = parsed ?? null
    V18_kiTouchedRequiresBarrier(p, value, { kiBarrier: access.value.ki_barrier })
    if (!p.isEmpty) return failWith(p.toError())

    const { data, error } = await ctx.db
      .from('els_products')
      .update(toUpdate('els_products', { ki_touched_at: value }))
      .eq('id', productId)
      .select('id')
    if (error != null) return failDb(error, 'KI 터치 확정')

    const conflict = requireAffected(data)
    return conflict == null ? okVoid() : failWith(conflict)
  }

  /**
   * §5.11 — **상품 1건 + 상환 1건을 한 트랜잭션에.**
   *
   * `createProduct` + `createRedemption`을 이어 부르지 않는 이유가 §5.1과 같고
   * 더 무겁다: 두 요청은 두 트랜잭션이므로 둘째가 실패하면 **`REALIZED_ONLY`인데
   * 상환이 없는 상품**이 남는다. §5.1의 잔해(기초자산 0건)는 `integrityIssue`가
   * 드러내지만 이 잔해는 계약 조건도 상환도 없어 **판정의 모든 입력이 없는데**
   * 조회 계층이 `entry_mode`만 보면 정상으로 읽힌다.
   *
   * **사전 조회가 없다.** 부모 상품이 없으므로 소유·상환 중복을 볼 대상이 없고,
   * `owner_id`는 함수가 `auth.uid()`로, `entry_mode`는 리터럴로 박는다.
   *
   * 원천징수액 산출은 **`createRedemption`과 같은 함수를 지난다**(§5.4). 복제하면
   * 두 계약이 다른 상수를 쓸 수 있고 그 갈림은 값을 비운 저장에서만 드러난다.
   */
  async function createRealizedProduct(
    input: RealizedProductInput,
  ): Promise<ActionResult<{ id: string }>> {
    const p = new Problems()
    const parsed = parseRealizedProductInput(p, input)
    if (parsed == null) return failWith(p.toError())

    const withholding = await withholdingFor(ctx, parsed)
    if (!withholding.ok) return failWith(withholding.error)

    const { data, error } = await ctx.db.rpc('create_realized_els_product', {
      payload: realizedPayload(parsed, withholding.value),
    })
    if (error != null) return failDb(error, '기실현 등재')

    // `createProduct`와 같은 방어 — 함수는 uuid를 반환하거나 예외를 던지므로
    // NULL은 올 수 없다. 확인하는 것은 그 전제가 깨졌을 때 없는 id를 화면에
    // 넘기지 않기 위함이다.
    const createdId: string | null = data
    if (createdId == null) {
      console.error(
        '[DB] 기실현 등재 — create_realized_els_product가 NULL을 반환했다. 오류도 없었다.',
      )
      return failWith({ code: 'INTERNAL', message: '처리 중 오류가 발생했다.' })
    }
    return ok({ id: createdId })
  }

  return {
    createProduct,
    updateProduct,
    deleteProduct,
    setKiTouched,
    createRealizedProduct,
  }
}
