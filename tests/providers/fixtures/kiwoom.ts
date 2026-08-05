/**
 * 키움 es040 실응답 픽스처 — **손으로 쓰지 않고 실제로 받아 온 것이다** (2026-08-05)
 *
 * 파서가 «읽는 것»만 남겼다(`gb` · `tao.grid.colNames` · `tao.grid.arRow`). 실응답에는
 * TAO 프레임워크의 헤더·고정폭 패킹 문자열 등이 더 있으나 그것을 픽스처에 담으면
 * **파서가 무엇에 의존하는지가 흐려진다.**
 *
 * ## ★ 네 부류가 «전부» 있는 것이 이 파일의 요점이다
 *
 * `gb`마다 스케일과 날짜 형식이 다르고(`endpoints.ts`의 `GB_RULES`) **`gb=B`는 초기
 * 조사에서 빠져 있었다.** 넷을 다 담아 두지 않으면 다음 사람이 세 부류만 보고 규칙을
 * 일반화한다.
 *
 * ## ★★ 값이 «독립 출처»와 일치한다 — 스케일 규칙의 검증이다
 *
 * 같은 날(2026-08-04) 신한투자증권이 게시한 값과 대조했다:
 *
 * | 자산 | 키움 원문 | 규칙 적용 후 | 신한 게시값 |
 * |---|---|---|---|
 * | KOSPI200 (`gb=A`) | `100003` | **÷100 → `1000.03`** | `1000.03` |
 * | S&P500 (`gb=B`) | `" 7736.52"` | **그대로 → `7736.52`** | `7736.52` |
 * | 애플 (`gb=D`) | `309.3800` | 그대로 | `309.38` |
 *
 * **즉 「A는 나누고 B는 나누지 않는다」가 두 발행사의 게시값으로 교차 확인됐다.**
 * 이것이 없으면 그 규칙은 페이지 JS를 읽은 «추론»에 머문다.
 */

export type KiwoomChartBody = {
  gb: string
  stk_code: string
  tao: { grid: { colNames: string[]; arRow: string[][] } }
}

const COLS = ['FID_22', 'FID_10', 'FID_12']

const body = (gb: string, stkCode: string, rows: string[][]): KiwoomChartBody => ({
  gb,
  stk_code: stkCode,
  tao: { grid: { colNames: [...COLS], arRow: rows } },
})

/** 국내 지수 — **÷100이 필요하다.** `103859` → `1038.59` */
export const CHART_INDEX_DOMESTIC = body('A', '201', [
  ['20260805', '103859', '+3.86'],
  ['20260804', '100003', '+1.35'],
  ['20260803', '98672', '-5.74'],
  ['20260731', '104681', '+19.98'],
])

/**
 * 해외 지수 — **나누지 않는다.** 그리고 둘이 더 다르다:
 * 날짜가 **14자**(`20260804000000`)이고 값에 **선행 공백**이 온다(`" 7736.52"`).
 */
export const CHART_INDEX_OVERSEAS = body('B', '_SPX', [
  ['20260804000000', ' 7736.52', '+1.73'],
  ['20260803000000', ' 7600.50', '+1.44'],
  ['20260731000000', ' 7489.72', '+0.69'],
  ['20260730000000', ' 7437.63', '+1.61'],
])

/** 국내주식 — 정수 원화, 그대로 */
export const CHART_STOCK_DOMESTIC = body('C', 'A005930', [
  ['20260805', '246000', '+2.50'],
  ['20260804', '240000', '+0.21'],
  ['20260803', '239500', '-8.76'],
  ['20260731', '262500', '+26.81'],
])

/** 해외주식 — 소수 4자리, 그대로 */
export const CHART_STOCK_OVERSEAS = body('D', 'AAPL', [
  ['20260805', '312.3100', '+0.94'],
  ['20260804', '309.3800', '+1.93'],
  ['20260803', '303.4200', '-1.81'],
  ['20260731', '308.9100', '-7.94'],
])

/**
 * `getBaseAssetDtlJson`의 실응답에서 파서가 읽는 부분.
 *
 * 실측: `AAPL → NDAAPL` · `BAC → NYBAC`(NYSE) · `201 → 201` · `A005930 → A005930`.
 * **해외주식만 거래소 접두사가 붙고 종목마다 다르다** — 그래서 유도하지 않고 물어본다.
 */
export const detailBody = (stex: string) => ({ result: { map: { stex_stk_code: stex } } })

/** `getBaseAssetJson`의 목록 — 실측 42종 중 부류별 대표만 */
export const ASSET_LIST_BODY = {
  result: {
    map: {
      g1: [
        { els_unas_tp: '1', stk_nm: 'KOSPI200지수', stk_code: '201' },
        { els_unas_tp: '1', stk_nm: 'S&P500 지수', stk_code: '_SPX' },
        { els_unas_tp: '1', stk_nm: 'HSCEI 지수', stk_code: '_HK#HIDX' },
        { els_unas_tp: '1', stk_nm: 'Nikkei225 지수', stk_code: '_JP#NI225' },
        { els_unas_tp: '1', stk_nm: 'EuroStoxx50 지수', stk_code: '_SX5E' },
        { els_unas_tp: '2', stk_nm: '삼성전자', stk_code: 'A005930' },
        { els_unas_tp: '3', stk_nm: '애플', stk_code: 'AAPL' },
        { els_unas_tp: '3', stk_nm: '뱅크오브아메리카', stk_code: 'BAC' },
      ],
    },
  },
}
