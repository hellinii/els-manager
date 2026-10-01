import { CURRENCY_ORDER, type ProductCurrency } from '@/lib/domain/currency'

import type { KiwoomLadder, KiwoomProductCandidate } from './terms-types'

/**
 * 상품 통화 — **증인과 판정** — 순수하다 — DOC-010 ADR-009 §7 · ⑲ (P8 컷 a4)
 *
 * 키움은 상품 통화를 한 칸으로 주지 않는다. 팝업에는 통화 칸이 없고 목록 행(es020)의 통화 코드는
 * 최선 노력이다(ADR-009 §5 — `listingMiss`). 그래서 흩어진 표기를 **증인**으로 모아 판정한다.
 *
 * ## 이 함수 하나가 정본이다
 *
 * 후보 목록(`candidateRowsOf`) · 대조(`crossCheckTerms`) · 채움(`importFillOf`)이 모두 이것을 부른다.
 * 같은 판정을 세 층이 각자 하면 한쪽만 고쳐지는 날이 온다(`importFill.ts` 머리 주석과 같은 판단).
 *
 * ## 증인 넷 — 그리고 증인이 «아닌» 것
 *
 * | 증인 | 자리 | 말하는 통화 |
 * |---|---|---|
 * | 상품명 접두 `USD_` | 팝업 `<h1>` · 목록 `stk_nm` | 있으면 USD |
 * | 사다리 `달러청약` | 팝업 상환조건 · 목록 `type_cntn` | 있으면 USD |
 * | 통화 코드 `crnc_code` | 목록만 | 세 글자 대문자 그대로 |
 * | 상환 단위 `rdmp_unit` | 목록만 | `100` → USD · `10000` → KRW · 그 밖은 말하지 않는다 |
 *
 * 실측(2026-10-02): 달러 팝업 9건에서 `USD_` · `달러청약` 9/9, 목록 40행에서 넷이 40/40 일치.
 * **팝업의 달러 배너는 증인이 아니다**(⑲) — 웹관리자가 올리는 홍보물이고 파일명이 9건에 넷이었다
 * (`newglobalels.png`에는 `dollar` 낱말도 없다). 부분 일치는 기초자산 해결에서 거절한 방식이다.
 *
 * ## 판정 넷
 *
 * | 판정 | 조건 |
 * |---|---|
 * | `DECIDED` | 말하는 증인이 하나 이상이고 전부 같은 통화이며 KRW · USD다 |
 * | `NO_WITNESS` | 말하는 증인이 없다 — **원화로 두지 않는다**(민서 결정 2026-09-29) |
 * | `CONFLICT` | 둘 이상의 통화를 말한다 — **다수결을 하지 않는다** |
 * | `UNSUPPORTED` | 한 통화인데 KRW · USD 밖이다 |
 *
 * **없음은 증언이 아니다.** 달러 표식이 없다는 사실로 원화를 확정하지 않는다 — 원화를 말하는 증인은
 * 목록 행에만 있으므로 목록을 놓친 원화 상품은 `NO_WITNESS`다(DOC-010 AQ-85). 틀리는 방향이 안전하다:
 * 빈칸은 V-22가 저장을 막고, 반대로 달러 상품을 원화로 채우면 모든 금액이 약 1,400배 틀린 채 형식은
 * 정상이다.
 *
 * **충돌을 다수결로 풀지 않는다.** 증인끼리 어긋나면 목록 행이나 팝업 중 하나가 낡았거나 틀렸다
 * (ADR-009 ⑦과 같은 부류). 「셋이 USD, 하나가 KRW」를 USD로 확정하면 형식이 옳은 거짓을 통과시킨다.
 */

export type CurrencyWitness =
  /** 상품명 접두 `USD_` */
  | 'NAME_PREFIX'
  /** 사다리 `달러청약` */
  | 'LADDER_DOLLAR'
  /** 목록 `crnc_code` */
  | 'LISTING_CODE'
  /** 목록 `rdmp_unit` */
  | 'LISTING_UNIT'

/** 증인 하나가 말한 것. `currency`는 원천의 표기 그대로다(지원 밖이면 `'EUR'` 같은 값) */
export type CurrencyClaim = { witness: CurrencyWitness; source: 'POPUP' | 'LISTING'; currency: string }

export type ProductCurrencyVerdict =
  | { kind: 'DECIDED'; currency: ProductCurrency; claims: CurrencyClaim[] }
  | { kind: 'NO_WITNESS'; claims: CurrencyClaim[] }
  | { kind: 'CONFLICT'; claims: CurrencyClaim[] }
  | { kind: 'UNSUPPORTED'; currency: string; claims: CurrencyClaim[] }

/**
 * 상품명 접두. **`USD_` 하나만 읽는다** — `([A-Z]{3})_`로 일반화하면 `ELS_`로 시작하는 원화 상품이
 * 「ELS」라는 통화를 말하게 된다. 다른 외화의 표기는 측정한 적이 없다 — 오면 `crnc_code`가 말한다.
 */
export const USD_NAME_PREFIX = 'USD_'

/**
 * 상환 단위 → 통화. 키는 **앞의 0을 지운** 문자열이다(`000000000000100` → `'100'` — `search-parse.ts`).
 *
 * `'10000'` → KRW는 계획의 증인(`= 100`)을 대칭으로 넓힌 것이다(ADR-009 §7) — 근거는 측정된 상관뿐이고
 * 필드의 뜻(1좌 액면 단위로 보인다)은 원문으로 확인하지 않았다. 효과는 충돌 검출과 `crnc_code`가 형식
 * 밖일 때의 원화 확정 둘이다. 목록에 없는 값은 아무것도 말하지 않는다.
 */
export const REDEMPTION_UNIT_CURRENCY: Readonly<Record<string, ProductCurrency>> = {
  '100': 'USD',
  '10000': 'KRW',
}

type PopupWitnesses = { name: string; ladder: Pick<KiwoomLadder, 'dollar'> }
type ListingWitnesses = Pick<KiwoomProductCandidate, 'name' | 'ladder' | 'currency' | 'redemptionUnit'>

/**
 * 상품 통화 판정. `popup`이 없으면(후보 목록) 목록 행의 증인만 본다.
 *
 * 증인의 순서는 판정에 영향이 없다 — 충돌 사유가 어떤 순서로 말할지만 정한다(목록의 코드가 먼저).
 */
export function productCurrencyOf(input: {
  popup: PopupWitnesses | null
  listing: ListingWitnesses | null
}): ProductCurrencyVerdict {
  const claims: CurrencyClaim[] = []
  const { popup, listing } = input

  if (listing?.currency != null) claims.push({ witness: 'LISTING_CODE', source: 'LISTING', currency: listing.currency })
  const unitCurrency = listing?.redemptionUnit == null ? undefined : REDEMPTION_UNIT_CURRENCY[listing.redemptionUnit]
  if (unitCurrency != null) claims.push({ witness: 'LISTING_UNIT', source: 'LISTING', currency: unitCurrency })
  for (const [source, witnesses] of [
    ['POPUP', popup],
    ['LISTING', listing],
  ] as const) {
    if (witnesses == null) continue
    if (witnesses.name.trim().startsWith(USD_NAME_PREFIX)) claims.push({ witness: 'NAME_PREFIX', source, currency: 'USD' })
    if (witnesses.ladder.dollar) claims.push({ witness: 'LADDER_DOLLAR', source, currency: 'USD' })
  }

  const distinct = [...new Set(claims.map((c) => c.currency))]
  if (distinct.length === 0) return { kind: 'NO_WITNESS', claims }
  if (distinct.length > 1) return { kind: 'CONFLICT', claims }
  const only = distinct[0]!
  return isProductCurrency(only)
    ? { kind: 'DECIDED', currency: only, claims }
    : { kind: 'UNSUPPORTED', currency: only, claims }
}

function isProductCurrency(code: string): code is ProductCurrency {
  return (CURRENCY_ORDER as readonly string[]).includes(code)
}
