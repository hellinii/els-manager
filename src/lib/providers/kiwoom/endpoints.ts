/**
 * 키움 「기초자산 정보」(es040) — 엔드포인트·필드·스케일 규약 — DOC-010 ADR-008
 *
 * 이 파일에는 **상수만** 둔다. 파싱은 `parse.ts`(순수), 호출은 `index.ts`다.
 */

const BASE = 'https://www.kiwoom.com/wm/edl/es040'

/**
 * 셋 다 `POST` · `application/x-www-form-urlencoded`다.
 *
 * ★ **`GET`은 500이고, «쿠키를 실으면» 400이다** (ADR-008 §2 ③ 실측). 페이지를 먼저 열어
 * 세션을 얻는 통상 패턴이 **정확히 실패한다** — 배치는 무상태·무쿠키여야 한다.
 * `fetch`는 기본으로 쿠키를 싣지 않으므로 **아무것도 하지 않는 것이 옳다**(`credentials`를
 * 만지지 않는다).
 */
export const ENDPOINTS = {
  /** 기초자산 42종 목록. `result.map.g1[] = {els_unas_tp, stk_nm, stk_code}` */
  list: `${BASE}/getBaseAssetJson`,
  /** 거래소 코드 조회. `result.map.stex_stk_code` */
  detail: `${BASE}/getBaseAssetDtlJson`,
  /** 일별 시세. `tao.grid.arRow[] = [날짜, 가격, 등락률]` */
  chart: `${BASE}/getBaseAssetChartJson`,
} as const

/**
 * 자산 분류(`els_unas_tp`) — 목록 라디오의 값이며 차트 호출에 그대로 실린다.
 *
 * `provider_symbol`이 이 값을 담는 이유는 §symbols.ts에 있다.
 */
export const UNDERLYING_TYPES = {
  INDEX: '1',
  DOMESTIC_STOCK: '2',
  OVERSEAS_STOCK: '3',
} as const

export type UnderlyingType = (typeof UNDERLYING_TYPES)[keyof typeof UNDERLYING_TYPES]

/**
 * ★ **읽는 필드의 전수 — 셋이다.**
 *
 * ADR-007 §4가 요구한 「`adjclose`를 쓰지 않는다」를 **부정 목록이 아니라 허용 목록**으로
 * 쓴다. 이 응답에는 조정종가 필드가 애초에 없으므로 부정 목록은 **항진명제**이고, 실제
 * 위험은 **열 순서를 잘못 세는 것**이다(셋 다 문자열이라 타입이 지켜 주지 않는다).
 *
 * `colNames`가 `['FID_22','FID_10','FID_12']`로 오며 그 순서를 **응답이 스스로 말한다** —
 * 그래서 인덱스를 박지 않고 `colNames`에서 찾는다(`parse.ts`). 순서가 바뀌면 조용히
 * 날짜와 가격이 뒤바뀌는데, 그 둘은 형태가 달라 검증이 잡는다.
 */
export const READ_FIELDS = {
  /** 기준일. `gb`에 따라 8자(`YYYYMMDD`) 또는 **14자**(`YYYYMMDDhhmmss`) — 아래 `GB_RULES` */
  baseDate: 'FID_22',
  /** 종가. **분할 조정 · 배당 미조정** (ADR-008 §3) */
  close: 'FID_10',
} as const

/** 읽지 않는다. 이름을 적어 두는 것이 「빠뜨렸다」와 「뺐다」를 가른다 */
export const NOT_READ = {
  FID_12: '등락률(%). 부호 문자를 담고 판정 입력이 아니다',
} as const

/**
 * ★★ **`gb`별 규약 — 이것이 이 어댑터의 가장 위험한 부분이다.**
 *
 * 응답의 `gb`가 자산 부류를 말하고 **부류마다 스케일과 날짜 형식이 다르다.** 실측:
 *
 * | `gb` | 부류 | 표본 | 스케일 | 날짜 |
 * |---|---|---|---|---|
 * | `A` | 국내 지수 | `["20260805","103859",…]` | **÷100** → `1038.59` | 8자 |
 * | `B` | **해외 지수** | `["20260804000000"," 7736.52",…]` | **그대로** | **14자** · 값에 **선행 공백** |
 * | `C` | 국내주식 | `["20260805","246000",…]` | 그대로 (정수 KRW) | 8자 |
 * | `D` | 해외주식 | `["20260805","310.9300",…]` | 그대로 (4자리) | 8자 |
 *
 * **`gb=B`는 처음에 알려지지 않았다.** 초기 조사가 A·C·D 셋만 보고했고, 그 셋만 다루면서
 * B를 A로 취급하면 **S&P500 7736.52가 77.3652가 된다** — 유한하고 양수이며 자릿수도
 * 그럴싸해서 어떤 `CHECK`도 걸리지 않는다. 정확히 「형식은 정상이고 값만 거짓」이며
 * **DOC-002 DQ-08과 같은 부류의 위험**이다. 그래서 —
 *
 * ★ **모르는 `gb`는 «추측하지 않고» `MALFORMED`로 실패한다.** 새 부류가 생기면 시끄럽게
 * 멈추는 것이 조용히 100배 틀리는 것보다 낫다. `Record<Gb, …>`로 두어 부류를 늘리면
 * **컴파일이 깨진다**(`failures.ts`의 `FAILURE_CLASS`와 같은 형태).
 */
export type Gb = 'A' | 'B' | 'C' | 'D'

export type GbRule = {
  /** 10의 거듭제곱으로 나눈다. `0`이면 나누지 않는다 — 부동소수점을 쓰지 않으려고 지수로 둔다 */
  readonly divideByPowerOfTen: number
  /** 기준일 문자열의 기대 길이 */
  readonly dateLength: 8 | 14
  readonly note: string
}

export const GB_RULES: Record<Gb, GbRule> = {
  A: {
    divideByPowerOfTen: 2,
    dateLength: 8,
    note: '국내 지수 — 페이지 자신의 JS가 `if(gb=="A"){ fid_10 = Number(item[1])/100 }`로 나눈다',
  },
  B: {
    divideByPowerOfTen: 0,
    dateLength: 14,
    note: '해외 지수 — 이미 실제 지수값이다. 날짜가 14자이고 값에 선행 공백이 온다',
  },
  C: { divideByPowerOfTen: 0, dateLength: 8, note: '국내주식 — 정수 원화' },
  D: { divideByPowerOfTen: 0, dateLength: 8, note: '해외주식 — 소수 4자리' },
}

export function gbRule(gb: string): GbRule | null {
  return Object.prototype.hasOwnProperty.call(GB_RULES, gb)
    ? GB_RULES[gb as Gb]
    : null
}

/** 이 공급자의 식별자. `asset_provider_symbols.provider`·`asset_prices.provider`와 같은 문자열이며 `varchar(30)` 이내다 */
export const PROVIDER_ID = 'KIWOOM_ES040'

/** 한 호출이 받아 오는 최대 행 수. 500이 실제로 처리된다(클라이언트 경고 200은 JS뿐 — ADR-008 §1) */
export const MAX_ROWS_PER_CALL = 500

/**
 * 조회 창의 기본 길이(일). 전 영업일을 알 수 없으므로(휴장 + 해외 지수는 T+1) 창으로 묻고
 * **공급자가 준 날짜 중 최대**를 취한다. `isStale`의 5일과 같은 논거로 여유를 둔다.
 */
export const DEFAULT_LOOKBACK_DAYS = 10
