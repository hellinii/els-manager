import type { DecimalValue } from '@/lib/decimal'

/**
 * 시세 공급자 어댑터 — DOC-010 ADR-004, DOC-011 §5.8
 *
 * **인터페이스만 확정하고 구체 공급자는 고르지 않는다.** 공급자 선정은 ADR-007로
 * 분리되어 있고 아직 미결이다(AQ-01). 어댑터가 확정되면 그 선정은 교체 가능한
 * 결정으로 격하된다는 것이 ADR-004의 논거다.
 *
 * 서명은 ADR-004의 것을 그대로 옮긴다 — 문서가 정본이므로 여기서 바꾸지 않는다.
 * `price`는 `number`가 아니라 Decimal이다(절대 규칙 #2).
 */
export interface PriceProvider {
  readonly id: string
  fetchDailyClose(
    symbols: string[],
    date: Date,
  ): Promise<Array<{ symbol: string; price: DecimalValue }>>
}

/**
 * 등록된 공급자 — **의도적으로 비어 있다.**
 *
 * 스텁을 여기 넣지 않는다. 고정값이 `asset_prices`에 `source = 'AUTO'`로
 * 저장되면 그 값으로 워스트오브와 조건 판정이 이루어지는데, **형식은 정상이고
 * 값만 거짓**이라 화면에 드러나지 않는다 — 시세가 *없는* 상태(E-01)는 드러나지만
 * 시세가 *틀린* 상태는 드러나지 않는다. 게다가 시세는 공용 데이터이므로 피해가
 * 타인 상품의 판정까지 간다. 스텁은 테스트 안에서만 쓴다(ADR-004 v0.7).
 *
 * 배열이 비어 있는 동안 §5.8 `refreshPrices`는 `PROVIDER_UNAVAILABLE`을 반환한다.
 * `ok: true` + `succeeded: 0`이 **아니다** — 전자는 ST-03(수동 입력 폴백)으로
 * 유도하고 후자는 "갱신했으나 대상이 없었다"로 읽힌다.
 */
export const PRICE_PROVIDERS: readonly PriceProvider[] = []
