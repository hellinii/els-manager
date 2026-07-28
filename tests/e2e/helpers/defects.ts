import { queryRows, sql } from '../../integration/helpers/seed'

/**
 * 무결성 결함 둘을 만든다 — **계약으로는 도달 불가하다** (P4 컷 9)
 *
 * ## 왜 SQL인가 — 앱으로 만들 수 없기 때문이다
 *
 * I-07(상품은 기초자산·차수를 각각 1개 이상 갖는다)에 **DB 층 방어가 있다**:
 * `create_els_product`·`update_els_product`가 말미에서 하위 행 수를 검사하고
 * 0건이면 `raise exception`한다(P3b 3단계, DOC-010 AQ-14 부분 해소). 두 함수가
 * 상품을 쓰는 유일한 경로이므로 **화면으로는 결함 상품을 만들 수 없다** — 그것이
 * 설계이며 여기서 우회하려는 것이 아니다.
 *
 * 그런데 **하위 행의 DELETE는 막히지 않는다**(그 구멍이 AQ-14의 잔여다). 컷 2가
 * `supabase/dev/02_broken_fixtures.sql`에서 같은 기법을 쓴 선례가 있고 그 파일의
 * 주석이 「계약으로는 도달 불가 — 재현이 아니라 이용한다」라고 적었다. 여기도 같다.
 *
 * ## 그래서 이 파일이 e2e에 있는 것이 정당한가
 *
 * ST-06과 §4.1의 결정 F(결함이 다른 사유를 가리지 않는다)는 **화면에 대한 요구**이고,
 * 그 화면을 렌더하는 층은 이 스위트뿐이다. 결함 상태를 만들 수 없으면 그 요구는
 * 계약 계층까지만 검증되고 화면에서는 영구히 미검증으로 남는다 —
 * `tests/integration/integrity-inputs.test.ts`가 계약의 절반을 이미 보고 있으므로
 * 남는 절반이 정확히 여기다.
 *
 * `pg` 직결 자체는 새 전제가 아니다: 이 스위트는 이미 `tests/integration/helpers/`의
 * 환경 해석과 사용자 픽스처를 쓰고 있고(`global-setup.ts`), `sql()`은 그 파일의
 * 공개 함수다. **정리는 `db:reset`이 한다**(CLAUDE.md의 스위트 순서).
 *
 * ## 삭제 순서와 제약
 *
 * `redemptions`가 `(els_id, round_no)`로 `redemption_schedules`를 참조하며
 * `ON DELETE RESTRICT`다(I-13). 즉 **상환된 상품의 차수는 지울 수 없고**, 그것이
 * 옳다 — 이 함수는 미상환 상품에만 쓴다. 어긴 호출은 `23503`으로 죽으므로 조용히
 * 잘못되지 않는다.
 */

/**
 * 평가일정을 전부 지운다 → `SCHEDULE_MISSING`.
 *
 * **기초자산과 시세는 남는다.** 그것이 §4.2 입력 기준의 요점이다 — 차수 입력만
 * 파괴되므로 `worstOf`·`kiStatus`는 살아 있고, 그래서 이 상품이 결정 F의 관측
 * 대상이 된다(결함 + KI 하회를 함께 올려야 한다).
 */
export async function destroySchedules(productId: string): Promise<void> {
  await sql('delete from public.redemption_schedules where els_id = $1::uuid', [
    productId,
  ])
  await expectRowCount('redemption_schedules', productId, 0)
}

/**
 * 기초자산을 전부 지운다 → `UNDERLYING_MISSING`.
 *
 * **차수는 남는다.** 시세 입력이 파괴되므로 `worstOf`·`kiStatus`·`conditionResult`가
 * 죽고 `next`·`overdue`는 산다. `PRICE_MISSING`을 내지 **않아야** 하는 상태이며
 * (오지 않을 시세를 기다리게 하지 않는다) 그 음성 단언의 대상이 이 상품이다.
 *
 * `assets` 행은 남는다(FK RESTRICT의 반대 방향이며 지울 이유도 없다).
 */
export async function destroyUnderlyings(productId: string): Promise<void> {
  await sql('delete from public.els_underlyings where els_id = $1::uuid', [productId])
  await expectRowCount('els_underlyings', productId, 0)
}

/**
 * **결함이 실제로 만들어졌는지 확인한다.**
 *
 * 확인하지 않으면 이 파일의 실패 형태가 「화면 단언이 빨간불」이 되고, 원인이 화면인지
 * 픽스처인지 갈리지 않는다 — 컷 4a·4b의 음성 대조가 두 번 드러낸 함정(테스트가
 * 픽스처의 결함을 화면의 결함으로 보고한다)과 같은 자리다.
 */
async function expectRowCount(
  table: 'redemption_schedules' | 'els_underlyings',
  productId: string,
  expected: number,
): Promise<void> {
  // 건수를 `::text`로 받는다 — `pg`의 수치 파서를 일부러 등록하지 않았으므로
  // (`helpers/seed.ts`의 머리글) 문자열로 받아 여기서 해석한다.
  const { rows } = await queryRows<{ n: string }>(
    `select count(*)::text as n from public.${table} where els_id = $1::uuid`,
    [productId],
  )
  const actual = Number.parseInt(rows[0]!.n, 10)
  if (actual !== expected) {
    throw new Error(
      `${table}의 행이 ${expected}건이어야 하는데 ${actual}건이다 (상품 ${productId}).\n` +
        '  결함 픽스처가 만들어지지 않았다 — 화면 단언보다 먼저 여기서 실패시킨다.',
    )
  }
}
