import { KIWOOM_ES040 } from './kiwoom'

import type { DecimalValue } from '@/lib/decimal'

/**
 * 시세 공급자 어댑터 — DOC-010 **ADR-004(보정 이행판, v3.0)** · ADR-008 · DOC-011 §5.8·§7.1
 *
 * ## 서명은 문서가 정본이다 — 그런데 그 정본이 낡아 있었다
 *
 * v0.7의 이 파일은 「서명은 ADR-004의 것을 그대로 옮긴다 — 문서가 정본이므로 여기서
 * 바꾸지 않는다」고 적었고 **그 규율을 지켰다.** 문제는 ADR-004 본문이 세 문서가 인용하는
 * 「보정」을 **담고 있지 않았다**는 것이다(DOC-002 DQ-02 · DOC-011 §7.1 · DOC-013 §6.2가
 * 전부 `asOfDate`와 `failure`를 근거로 들었다). 즉 **베낀 것이 규율의 결과였고 베낀 대상이
 * 틀렸다.** P5a 컷 0이 ADR-004를 고쳤고 이 파일이 그 결과를 옮긴다.
 *
 * ## 절대 규칙 #2가 이 디렉터리에서 가장 위험하다
 *
 * 어댑터는 **외부 JSON을 파싱**하고 이 인터페이스는 `DecimalValue`를 요구한다. 그 사이에
 * `Number(json.close)`를 쓰면 **형식은 정상이고 값만 거짓**이 되며, 그 값은 `asset_prices`에
 * `source = 'AUTO'`로 저장되어 워스트오브·배리어 판정에 들어가므로 **화면에 드러나지 않는다.**
 * `eslint.config.mjs`의 `els/provider-values`가 이 디렉터리에서 강제 변환을 금지하는 이유가
 * 그것이다 — 그 규칙은 이 파일의 소비자를 향해 있다.
 */

/**
 * 실패의 **부류**. DOC-011 §7.1의 `failed[].reason` 두 갈래이며 **사용자의 조치가 다르다.**
 *
 * - `NO_DATA` — 공급자가 그 심볼의 그날 데이터를 주지 않았다 → **매핑을 고친다**(또는 휴장이라 정상)
 * - `CALL_FAILED` — 호출 자체가 실패했다 → **기다린다. 고칠 것이 없다**
 *
 * 문구가 아니라 **판별 가능한 값**인 것이 요점이다 — 문자열로 두면 이 구분이 층을 넘다가
 * 사라진다(V-18이 층마다 다른 칸을 가리켰던 함정과 같은 형태).
 */
export type FailureClass = 'NO_DATA' | 'CALL_FAILED'

/**
 * 실패의 **세분류**. 진단용이며 `FailureClass`는 이것의 전사상이다(`failures.ts`).
 *
 * **두 층으로 두는 이유:** 계약은 둘을 요구하고(조치가 둘이다) 진단은 열이 필요하다.
 * 하나로 합치면 「기다린다」 안에서 원인이 사라진다.
 */
export type ProviderFailureCode =
  /** `provider_symbol`이 이 공급자의 표기가 아니다 → 매핑을 고친다 */
  | 'SYMBOL_SCHEME'
  /** 응답은 정상인데 그 심볼의 행이 0건 — 휴장 · 상장폐지 · 심볼 오류 */
  | 'EMPTY'
  /** 인증키 거부 */
  | 'AUTH'
  /** 한도 초과 */
  | 'QUOTA'
  /** 비2xx (위 둘로 분류되지 않은 것) */
  | 'HTTP'
  /** `fetch`가 던졌다 · 타임아웃 · 전체 데드라인 초과 */
  | 'NETWORK'
  /** 봇 차단에 걸렸다 — 키움 WAF의 `eversafeThreat`가 이것이다(ADR-008 §2 ③) */
  | 'BLOCKED'
  /** 본문이 스키마가 아니다 · 필드 부재 · 절단 */
  | 'MALFORMED'
  /** 종가가 형식이 아니다 · 0 이하 · `numeric(18,6)` 범위 밖 */
  | 'BAD_VALUE'
  /** 기준일이 실재하는 날짜가 아니다 · 요청 상한을 넘는다 */
  | 'BAD_DATE'

/** 성공한 관측 하나 */
export type ProviderQuote = {
  /** 요청한 `provider_symbol` 원문. 수집기가 이것으로 자산에 되붙인다 */
  symbol: string
  /**
   * ★ **공급자가 준 기준일이다. `today()`가 아니다.**
   *
   * `YYYY-MM-DD`. 배치가 `today()`를 쓰면 전일 종가가 오늘 날짜로 저장되고 그것이
   * 「형식은 정상이고 값만 거짓」인 상태다 — `as_of_date`가 오늘이므로 `isStale`(5일)이
   * **발동하지 않아** 화면 어디에도 드러나지 않는다(DOC-013 §6.2 각주 1 · DQ-02와 같은 부류).
   *
   * 항상 `asOf` **이하**이며, 그래서 DOC-011 V-17(미래 일자 거부)이 자동으로 만족된다.
   */
  asOfDate: string
  /**
   * ★ **미조정 종가다.** 정확히는 **분할 조정 · 배당 미조정**이다 — ADR-008 §3.
   *
   * 둘을 가르지 않으면 ADR-007의 `adjclose` 금지가 분할 조정까지 금지하는 것으로 읽힌다.
   * 분할은 가격 변동이 아니므로 **조정되어야 옳고**(가격과 기준가가 같은 기준 위에 있어야
   * 한다) 배당 조정은 **연 1.2~2.2%p 단방향 누적**으로 배리어 계단을 삼킨다.
   */
  price: DecimalValue
}

/** 실패한 관측 하나 */
export type ProviderFailure = {
  symbol: string
  /** 계약이 요구하는 판별값. `FAILURE_CLASS[code]`에서 **파생**된다 — 손으로 적지 않는다 */
  failure: FailureClass
  code: ProviderFailureCode
  /** 진단용. 사용자 표시 문구가 아니고 **자격증명을 담지 않는다** */
  detail: string
}

export type ProviderOutcome =
  | ({ ok: true } & ProviderQuote)
  | ({ ok: false } & ProviderFailure)

/**
 * 어댑터 — ADR-004 보정판.
 *
 * ## 계약 의무 다섯 — 전부 테스트가 단언한다
 *
 * ① **던지지 않는다.** 모든 실패가 값이다. 하나라도 던지면 DOC-011 CR-02(부분 실패가
 *    배치를 중단시키지 않는다)가 깨진다
 * ② 입력 심볼당 **정확히 하나**의 outcome. 순서는 자유, 중복 없음, 누락 없음
 * ③ `asOfDate <= asOf`이고 실재하는 날짜다 (V-17)
 * ④ `price > 0` · 유한 · `numeric(18,6)` 범위 안
 * ⑤ `id`는 `asset_provider_symbols.provider`·`asset_prices.provider`와 **같은 문자열**이며
 *    `varchar(30)` 이내다 — FK가 없으므로 그 일치를 테스트가 본다
 */
export interface PriceProvider {
  readonly id: string
  fetchDailyClose(
    symbols: readonly string[],
    /** `YYYY-MM-DD`, KST 기준일(`today()`). **상한**이다 — 이 날짜 이후는 반환하지 않는다 */
    asOf: string,
  ): Promise<readonly ProviderOutcome[]>
}

/**
 * 어댑터 생성에 주입되는 것.
 *
 * **레지스트리가 변수 «이름»을 모른다** — `apiKey`가 필요한 공급자는 `lib/db/env.ts`의
 * 접근자에서 값을 받는다(그 파일이 `process.env`를 읽을 수 있는 유일한 자리다 —
 * `tests/db/no-service-role.test.ts`가 `src/` 전체에 대해 정확 일치로 단언한다).
 *
 * **키움 es040은 `apiKey`를 요구하지 않는다** — 미인증 공개 엔드포인트다(ADR-008 §1).
 */
export type ProviderDeps = {
  /** 자격증명이 필요한 공급자만 쓴다. 키움 es040은 쓰지 않는다 */
  apiKey?: string
  /** 테스트가 주입한다 — 상시 스위트에 네트워크가 없다(ADR-003) */
  fetchImpl?: typeof fetch
  /** 요청당 상한(ms) */
  timeoutMs?: number
  /** 전체 데드라인(epoch ms). 넘으면 남은 심볼이 `NETWORK`로 **값이 된다** */
  deadlineAt?: number
}

/**
 * **등록과 생성을 가른다.** 등록은 정적이고 자격증명이 없다.
 *
 * ★ 그래야 `providerCount`가 지금의 뜻을 유지한다 — 「이 배포의 **코드에** 등록된 공급자가
 * 없다」는 **코드가 정한 설계 상태**이고, 그것이 CR-07(503 + 수동 입력 유도)의 대상이다.
 * 반대로 「키 없는 공급자를 명부에서 빼서 `providerCount`를 0으로」 만들면 **설정 결함이
 * 설계 상태로 위장**되고 사용자는 「수동 입력으로 갱신한다」를 듣는데 실제 고칠 것은
 * 환경변수다 — 절대 규칙 #6이 열거한 fail-open과 같은 형태이며, 그 갈래가 **CR-10**이다.
 */
export type ProviderFactory = {
  readonly id: string
  create(deps: ProviderDeps): PriceProvider
}

/**
 * 등록된 공급자 — **키움 es040 하나** (P5a 컷 3).
 *
 * ## 컷 1이 어댑터를 세우고 컷 3이 등재한다 — 그 «간격»이 의도였다
 *
 * 컷 1 시점에 여기 넣으면 `providerCount > 0`이 되고 수집기가 없으므로 §5.8이
 * CR-08(`INTERNAL` + 로깅)로 끝난다 — 「배포 결함」 상태이며 **503(설계된 상태)보다
 * 나쁘다.** R-05(각 단계는 동작하는 상태에서 끝낸다)가 등재를 수집기와 **같은 컷**으로
 * 묶은 이유이고, 그 컷이 여기다. **그래서 CR-08의 도달 가능한 상태가 이제 없다.**
 *
 * ## 스텁을 여기 넣지 않는다 (ADR-004 v0.7 — 그대로 유지된다)
 *
 * 고정값이 `asset_prices`에 `source = 'AUTO'`로 저장되면 그 값으로 워스트오브와 조건
 * 판정이 이루어지는데 **형식은 정상이고 값만 거짓**이라 화면에 드러나지 않는다 —
 * 시세가 *없는* 상태(E-01)는 드러나지만 시세가 *틀린* 상태는 드러나지 않는다. 게다가
 * 시세는 공용 데이터이므로 피해가 타인 상품의 판정까지 간다. **스텁은 테스트 안에서만 쓴다.**
 *
 * ## 순서가 계약이다 — `[0]`이 «주 원천»이다
 *
 * 두 번째 공급자(P5a 컷 1c의 `data.go.kr`)는 **대조**이고 `asset_prices`에 쓰지 않는다.
 * 그 처리가 정의되기 전까지 `collectAndRecord`가 **둘 이상이면 수집하지 않는다** —
 * 조용히 첫 것만 쓰면 컷 1c의 등재가 아무 일도 하지 않으면서 초록이 된다.
 */
export const PRICE_PROVIDERS: readonly ProviderFactory[] = [KIWOOM_ES040]

/**
 * 공급자별로 **필요한 환경변수 이름** — CR-10의 두 번째 출처.
 *
 * ★ **키움 es040은 비어 있고 그것이 이 원장의 «값»이다.** 자격증명을 요구하지 않는
 * 공개 엔드포인트이므로(ADR-008 §2.3 — 쿠키를 «보내면» 오히려 막힌다) 오늘 CR-10은
 * 서비스 계정 축에서만 도달한다. 그 사실을 **빈 배열로 적어 두는 것**과 「아무 데도
 * 안 적는 것」은 다르다 — 다음 공급자가 키를 요구할 때 채울 자리가 여기 있고,
 * `tests/providers/kiwoom.test.ts`가 **모든 `KNOWN_PROVIDER_IDS`에 항목이 있는지**
 * 본다(빠뜨리면 그 공급자의 키 부재가 CR-10에 세어지지 않는다).
 *
 * ★★ **값이 아니라 이름이다**(SEC-05). 이 상수는 클라이언트 번들에도 실릴 수 있다.
 */
export const PROVIDER_CREDENTIALS: Record<string, readonly string[]> = {
  KIWOOM_ES040: [],
}

/**
 * **코드가 «아는» 공급자 전부** — 수집에 켜졌는지와 무관하다.
 *
 * ## 두 명부를 가르는 것이 설계다 (P5a 컷 2b)
 *
 * | | 무엇인가 | 누가 읽는가 |
 * |---|---|---|
 * | `PRICE_PROVIDERS` | 수집에 **켜진** 것 | `decide()`의 `providerCount` · §5.8 `refreshPrices` |
 * | `KNOWN_PROVIDER_IDS` | 코드가 **아는** 것 | §5.12의 **V-21**(매핑의 `provider` 검증) |
 *
 * ★ **매핑 검증이 「켜진 것」을 보면 안 된다.** 컷 1이 어댑터를 세웠으나 등재하지
 * 않았으므로(수집기가 없어 CR-08이 된다) 레지스트리를 보면 **이 화면이 컷 3까지 아무 값도
 * 저장할 수 없다.** 반대로 전체 명부를 보면 매핑을 미리 넣어 둘 수 있고 **수집기가 첫
 * 실행부터 대상을 갖는다** — 즉 이 분리가 컷 2b를 컷 3보다 먼저 쓸모 있게 만든다.
 *
 * ★★ 반대 방향의 함정도 적어 둔다: 이 목록으로 **수집을 돌리면 안 된다.** 그러면
 * 「등재하지 않았다」가 무의미해지고 CR-08 상태가 되살아난다. 그 관계를
 * `tests/providers/kiwoom.test.ts`가 **부분집합으로 단언한다**
 * (`PRICE_PROVIDERS ⊆ KNOWN_PROVIDER_IDS`) — 두 목록이 반대로 자라는 것을 막는다.
 */
export const KNOWN_PROVIDER_IDS: readonly string[] = ['KIWOOM_ES040']

export function isKnownProvider(id: string): boolean {
  return KNOWN_PROVIDER_IDS.includes(id)
}
