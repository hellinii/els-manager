import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 키움 상품 조건 원천 실응답 픽스처 — **손으로 쓰지 않고 실제로 받아 온 것이다** (2026-09-24 KST 12:14~12:20)
 *
 * 전부 쿠키 없는 `POST` · `application/x-www-form-urlencoded`다(`curl -X POST --data …`).
 *
 * ## 팝업 HTML (`kiwoom-terms/<CODE>.html`)
 *
 * ★ **절단 규칙: `<head>…</head>`와 `<script>…</script>`의 «본문»만 비웠다**(태그는 남겼다).
 * NAV·기준가추이 탭, 주석, 닫히지 않은 `<td>`는 **그대로** 있다 — 그것들이 파서가 넘어야 하는
 * 것이기 때문이다. 특히 NAV 탭의 표는 구획 경계 규칙(`html.ts` `findSection`)을 시험한다:
 * 설계 초안처럼 NAV를 잘라 냈다면 「다음 제목까지」라는 틀린 경계가 **초록으로 숨었다.**
 *
 * 파일 머리의 주석이 요청 본문·원본 바이트 수·원본 sha256을 적는다. E04000·E00795는 자르지 않은
 * 원본(`*.raw.html`)도 두고, 테스트가 ⓐ 원본의 sha256이 머리 주석과 같고 ⓑ 두 파일의 파싱
 * 결과가 **같음**을 단언한다 — 절단이 결과를 바꾸지 않았다는 증거다.
 *
 * | 코드 | 무엇을 시험하나 |
 * |---|---|
 * | E04000 | 국내주식 · 만기 `rowspan=3` · 헤드라인 32.10 = 16.05 × 12/6 · 문서 4 · 공지 |
 * | EM1740 | 해외 티커 · 소수 가격 · 리자드 1배(3-2 = 21.63 = 3-1) · 4차 2027-05-28(금) |
 * | EM2046 | 리자드 2배(33.24 = 2 × 16.62) |
 * | E03060 | **파싱은 `ok`**, 대조가 `BLOCKING`(표 85/85 ↔ 사다리 88/88) · 만기 `rowspan=1` |
 * | EM2048 | 달러·월지급 · 수익률 전부 0 · `월지급배리어 50` · 목록 사다리 `KI` ↔ 팝업 `KI25` |
 * | E04262 | `PRE_ISSUANCE` — 기준가 0, 차수 없음, 만기는 날짜만 |
 * | E99999 | `EMPTY` — 없는 코드도 200 |
 * | E00795 | 주석에 「만기상환」이 있는데 구획이 없다 → `maturity: null` · 계단 없음 · 자산 셋 |
 * | EM1039 | **4자리 절사** — 엔비디아 85.905 × 0.75 = 64.42875 → `64.4287` |
 *
 * ## 검색 JSON (`kiwoom-terms/search-<resp_code>-<검색어>.json`)
 *
 * 본문은 **코드가 실제로 보내는 것 그대로**다(`salFundNm` + `SEARCH_FORM_DEFAULTS`). 테스트가
 * 어댑터가 만든 본문을 아래 `body`와 바이트 단위로 대조한다 — 픽스처가 다른 요청의 응답이면
 * 그 대조가 빨갛다. 응답은 자르지 않았다.
 */

const DIR = join(process.cwd(), 'tests', 'providers', 'fixtures', 'kiwoom-terms')

export const POPUP_CODES = [
  'E04000',
  'EM1740',
  'EM2046',
  'E03060',
  'EM2048',
  'E04262',
  'E99999',
  'E00795',
  'EM1039',
] as const
export type PopupCode = (typeof POPUP_CODES)[number]

/** 자르지 않은 원본도 둔 코드 */
export const RAW_CODES = ['E04000', 'E00795'] as const

export function popupHtml(code: PopupCode): string {
  return readFileSync(join(DIR, `${code}.html`), 'utf8')
}

export function rawPopupHtml(code: (typeof RAW_CODES)[number]): Buffer {
  return readFileSync(join(DIR, `${code}.raw.html`))
}

export type SearchFixture = {
  file: string
  query: string
  /** 요청 본문 원문 — `curl --data`에 실은 그대로 */
  body: string
  respCode: string
  bytes: number
  sha256: string
}

export const SEARCH_FIXTURES = {
  /** `100000` — 1건(E04000) */
  q4000: {
    file: 'search-100000-4000.json',
    query: '4000회',
    body: 'salFundNm=4000%ED%9A%8C&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100000',
    bytes: 5061,
    sha256: 'e402886f20124922a64ff2235f1a0d1235c0d3a1e8aa7ad41a9dc983f4b5d7dc',
  },
  /**
   * `100000` — 4건: 3795회 · 2795호 · 뉴글로벌 795회 · 795호. **부분 일치**이고 「회」와 「호」가
   * 섞인다. `elsTp=1`이라 ELB 795호(E90795)는 **없다**(설계 초안의 5건은 `elsTp` 없는 측정이었다)
   */
  q795: {
    file: 'search-100000-795.json',
    query: '795',
    body: 'salFundNm=795&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100000',
    bytes: 8017,
    sha256: 'c305e0738b45ff7593dedeb85ff59b7f78427de0160481bb2187bbec1aeed734',
  },
  /** `100000` — 1건(EM2048). 목록 사다리가 `…) KI`로 비율이 없다 */
  q2048: {
    file: 'search-100000-2048.json',
    query: '2048회',
    body: 'salFundNm=2048%ED%9A%8C&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100000',
    bytes: 5139,
    sha256: 'c85f283fd549d2545a6e65633b48d0ce119aae0f9f2c636bfa704bc1f646eb8a',
  },
  /** `505065` — `g1`이 없다. E03060은 「3060**호**」라 「3060회」로는 안 나온다 */
  q3060: {
    file: 'search-505065-3060.json',
    query: '3060회',
    body: 'salFundNm=3060%ED%9A%8C&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '505065',
    bytes: 4082,
    sha256: '75a0c0e517f65bd2cacc6d75a6a659c9f91870fb3d94d6b707f8370ef5420509',
  },
  /** `100001` — 40건 + `cont_gubn: 'Y'` + `next_data` */
  q100jo: {
    file: 'search-100001-100jo.json',
    query: '100조',
    body: 'salFundNm=100%EC%A1%B0&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100001',
    bytes: 44083,
    sha256: 'fb69e27d8b98cc9ded1a10e62f8c848d5b48f0cc2ba8ac973abca48e827f993b',
  },
  /** `520050` — 「종목정보 조회중 오류가 발생하였습니다.[0]」 */
  qEls3: {
    file: 'search-520050-els3.json',
    query: '키움 ELS 3',
    body: 'salFundNm=%ED%82%A4%EC%9B%80+ELS+3&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '520050',
    bytes: 4104,
    sha256: '4dfd3f680c6389cdf175bef5edde0d24738a62eac8c8eae379d06291afcff287',
  },
} as const satisfies Record<string, SearchFixture>

export function searchBytes(fixture: SearchFixture): Buffer {
  return readFileSync(join(DIR, fixture.file))
}

export function searchJson(fixture: SearchFixture): unknown {
  return JSON.parse(searchBytes(fixture).toString('utf8')) as unknown
}

export function searchText(fixture: SearchFixture): string {
  return searchBytes(fixture).toString('utf8')
}
