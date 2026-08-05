import { UNDERLYING_TYPES, type UnderlyingType } from './endpoints'

/**
 * `provider_symbol`의 표기 — DOC-010 ADR-008
 *
 * ## 형태: `<els_unas_tp>:<stk_code>`
 *
 * 예 — `3:AAPL`(해외주식) · `2:A005930`(국내주식) · `1:_SPX`(지수)
 *
 * ## 왜 분류를 «심볼 안에» 담는가
 *
 * 차트 호출이 `elsUnasTp`를 **요구한다.** 담지 않으면 자산마다 목록(42종)을 뒤져 분류를
 * 알아내야 하고, 그러면 ⓐ 왕복이 늘고 ⓑ **목록에서 사라진 자산의 분류를 알 수 없어진다**
 * (그때 실패 사유가 「목록에 없다」가 되는데 사용자가 고칠 것은 매핑이다).
 * 자기 서술적으로 두면 **틀린 매핑이 `SYMBOL_SCHEME`으로 즉시 드러난다.**
 *
 * ## 왜 `stex_stk_code`는 담지 «않는가»
 *
 * `AAPL → NDAAPL`·`BAC → NYBAC`처럼 거래소 접두사가 붙고 **종목마다 다르다**(실측).
 * 그러나 그것은 **공급자 내부 표기**이고 바뀔 수 있다. 매핑에 넣으면 그 값이 낡았을 때
 * 실패가 「데이터 없음」으로 나타나 **원인에서 먼 곳을 가리킨다**(사용자는 매핑을 고치라는
 * 말을 듣지만 고칠 것은 공급자 쪽 표기다). 매 실행에 조회하는 대가는 자산당 왕복 하나이며
 * 대상이 한 자릿수이므로 무의미하다.
 *
 * ## 형식 검사를 «여기서» 하고 값 검사는 하지 않는다
 *
 * 분류가 셋 중 하나인지는 본다. 그러나 **`stk_code`가 실재하는지는 보지 않는다** — 그것은
 * 공급자만 아는 값이고, 화면이 그 판단자가 되면 「목록에 있는데 화면이 거부한다」가 생긴다.
 * 없는 코드는 공급자가 0건으로 답하고 그것이 `EMPTY`(→ 「데이터 없음」 → 매핑을 고친다)다 —
 * DOC-002 DQ-02가 이미 그 경로를 설계했다.
 */

export type KiwoomTarget = {
  underlyingType: UnderlyingType
  stkCode: string
}

const VALID_TYPES: readonly string[] = Object.values(UNDERLYING_TYPES)

/** 표기 오류. `failures.ts`가 `NO_DATA`로 사상한다 — 조치가 「매핑을 고친다」로 같기 때문이다 */
export type SymbolSchemeError = { code: 'SYMBOL_SCHEME'; detail: string }

export function parseSymbol(raw: string): KiwoomTarget | SymbolSchemeError {
  const at = raw.indexOf(':')
  if (at < 0) {
    return {
      code: 'SYMBOL_SCHEME',
      detail: `구분자 ':'가 없다. 형태는 <분류>:<코드>이다 (예: 3:AAPL): ${show(raw)}`,
    }
  }

  const underlyingType = raw.slice(0, at)
  const stkCode = raw.slice(at + 1)

  if (!VALID_TYPES.includes(underlyingType)) {
    return {
      code: 'SYMBOL_SCHEME',
      detail: `분류가 1(지수)·2(국내주식)·3(해외주식) 중 하나가 아니다: ${show(underlyingType)}`,
    }
  }
  /*
   * 코드에 공백만 있는 것도 거부한다 — 그대로 보내면 공급자가 0건으로 답해
   * `EMPTY`가 되고, 그러면 **매핑이 비었다는 사실이 「휴장」과 같게 보인다.**
   */
  if (stkCode.trim() === '') {
    return { code: 'SYMBOL_SCHEME', detail: '코드가 비어 있다' }
  }
  if (stkCode !== stkCode.trim()) {
    return { code: 'SYMBOL_SCHEME', detail: `코드에 앞뒤 공백이 있다: ${show(stkCode)}` }
  }

  return { underlyingType: underlyingType as UnderlyingType, stkCode }
}

/** 매핑 화면이 값을 만들 때 쓴다 — 양방향을 한 파일에 두어 형태가 갈리지 않게 한다 */
export function formatSymbol(target: KiwoomTarget): string {
  return `${target.underlyingType}:${target.stkCode}`
}

/** 진단 문구에 원문을 담되 길이를 제한한다 */
function show(value: string): string {
  const trimmed = value.length > 40 ? `${value.slice(0, 40)}…` : value
  return JSON.stringify(trimmed)
}
