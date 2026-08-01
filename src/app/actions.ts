'use server'

import type { ActionResult } from '@/lib/db/mutations/result'
import type {
  AssetInput,
  ManualPriceInput,
  ProductInput,
  RealizedProductInput,
  RedemptionInput,
  RefreshPricesResult,
  TaxProfileInput,
} from '@/lib/db/mutations/types'
import { getMutations } from '@/lib/db/server'

/**
 * 서버 액션 — DOC-011 §5의 계약 11개를 프레임워크에 노출한다
 *
 * ## 얇게 유지한다
 *
 * 각 함수는 `getMutations()`로 계약 묶음을 얻어 그대로 위임한다. 여기에 로직을
 * 두면 **테스트가 닿지 않는 자리**가 생긴다 — 이 파일은 `next`를 경유하는
 * `server.ts`를 import하므로 `tests/integration`의 import 그래프에 들어갈 수
 * 없고, 그쪽은 `createMutations(ctx)`를 직접 조립해 계약을 검증한다. 위임 외의
 * 것이 여기 있으면 그것만 미검증으로 남는다(AQ-23과 같은 형태다).
 *
 * ## `revalidatePath`는 아직 붙이지 않는다
 *
 * 무엇을 무효화할지는 **어느 화면이 무엇을 읽는가**에 달렸고, 그 매핑은 화면이
 * 서는 P4에서 확정된다(§8 추적 매트릭스). 지금 추측으로 넣으면 실제 경로와
 * 어긋난 무효화가 남고, 어긋난 무효화는 "저장했는데 화면이 그대로"로 나타나
 * 원인이 계약인지 캐시인지 구분되지 않는다.
 *
 * ## 인증
 *
 * 미인증에서 **던지지 않는다.** `getMutations()`가 전 계약이 `UNAUTHENTICATED`를
 * 반환하는 묶음을 주므로(W-03) 입력값이 보존되고, 화면이 그 코드로 SCR-001을
 * 유도한다.
 */

// ---------------------------------------------------------------------------
// §5.1~§5.3·§5.9 상품
// ---------------------------------------------------------------------------

export async function createProduct(
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  return (await getMutations()).createProduct(input)
}

export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  return (await getMutations()).updateProduct(id, input)
}

export async function deleteProduct(id: string): Promise<ActionResult<void>> {
  return (await getMutations()).deleteProduct(id)
}

export async function setKiTouched(
  productId: string,
  touchedAt: string | null,
): Promise<ActionResult<void>> {
  return (await getMutations()).setKiTouched(productId, touchedAt)
}

/** §5.11 — 기실현 등재. 상품과 상환을 한 트랜잭션에 만든다 */
export async function createRealizedProduct(
  input: RealizedProductInput,
): Promise<ActionResult<{ id: string }>> {
  return (await getMutations()).createRealizedProduct(input)
}

// ---------------------------------------------------------------------------
// §5.4~§5.5 상환
// ---------------------------------------------------------------------------

export async function createRedemption(
  productId: string,
  input: RedemptionInput,
): Promise<ActionResult<{ id: string }>> {
  return (await getMutations()).createRedemption(productId, input)
}

export async function updateRedemption(
  id: string,
  input: RedemptionInput,
): Promise<ActionResult<void>> {
  return (await getMutations()).updateRedemption(id, input)
}

export async function deleteRedemption(id: string): Promise<ActionResult<void>> {
  return (await getMutations()).deleteRedemption(id)
}

// ---------------------------------------------------------------------------
// §5.6~§5.8·§5.10 과세 프로필 · 시세 · 자산
// ---------------------------------------------------------------------------

export async function saveTaxProfile(
  input: TaxProfileInput,
): Promise<ActionResult<void>> {
  return (await getMutations()).saveTaxProfile(input)
}

export async function saveManualPrice(
  input: ManualPriceInput,
): Promise<ActionResult<void>> {
  return (await getMutations()).saveManualPrice(input)
}

export async function refreshPrices(): Promise<ActionResult<RefreshPricesResult>> {
  return (await getMutations()).refreshPrices()
}

export async function createAsset(
  input: AssetInput,
): Promise<ActionResult<{ id: string }>> {
  return (await getMutations()).createAsset(input)
}
