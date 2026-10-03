import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 키움 상품 조건 원천 실응답 픽스처 — **손으로 쓰지 않고 실제로 받아 온 것이다** (2026-09-24 KST 12:14~12:20 ·
 * EM2047 둘은 2026-10-02 KST 02:22 — P8 컷 a4 · EM2014 둘은 2026-10-03 KST 18:21 — P8 컷 b5)
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
 * | EM2014 | **원화 · 월지급식** — 전진 검사 일곱을 지나 채워지는 첫 월지급식(P8 컷 b5 · ADR-009 §8). 사다리 `월지급배리어 50, 3년/6개월 (85-85-80-75-70-65) KI20` · 헤드라인 「최대 연 23.64%」(= 1.97% × 12) · 수익률 전부 0 · 기초자산 KOSPI200 · 마이크론(지수 + 해외 티커 MU) · 만기 사흘 평균 |
 * | EM2047 | **달러 · 월지급 아님** — 불러오기가 채우는 첫 달러 상품(P8 컷 a4). 팝업 증인 `USD_` · `달러청약`, 배너는 `100dollar-ELS.jpg`(EM2048은 `dollar-ELS.png` — ADR-009 ⑲) · 해외 티커 TSLA·MU · 만기 사흘 평균 |
 * | E04262 | `PRE_ISSUANCE` — 기준가 0, 차수 없음, 만기는 날짜만 |
 * | E99999 | `EMPTY` — 없는 코드도 200 |
 * | E00795 | 주석에 「만기상환」이 있는데 구획이 없다 → `maturity: null` · 계단 없음 · 자산 셋 |
 * | EM1039 | **4자리 절사** — 엔비디아 85.905 × 0.75 = 64.42875 → `64.4287` |
 *
 * **비밀 · 개인정보 검사 (EM2047, 공개 저장소 — DOC-010 AQ-83).** 절단 전 원본의 `<head>`에 `loggedIn`·
 * `viewuserdn` 메타가 있으나 값이 `N`이고 절단이 그 본문을 비운다. 절단본과 검색 JSON에서 키 · 토큰 ·
 * 세션 · 쿠키 · 이메일 · 전화번호 · IP 형태를 찾았고 0건이다. 검색 JSON의 `user_dn` · `custNo` 등 사용자
 * 칸은 전부 `null`이며 값이 있는 최상위 칸의 집합이 2048 픽스처와 같다(`currentPage` · `pageSize`뿐).
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
  'EM2047',
  'EM2014',
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
  /**
   * `100000` — 1건(EM2047, 2026-10-02 수집). 달러 · 월지급 아님 — `crnc_code` `USD` · `rdmp_unit`
   * `000000000000100` · `mm_pay_frml_yn` `N` · 사다리 `달러청약, 3년/6개월 (80-80-75-75-70-65) KI25`
   */
  q2047: {
    file: 'search-100000-2047.json',
    query: '2047회',
    body: 'salFundNm=2047%ED%9A%8C&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100000',
    bytes: 5108,
    sha256: '52b687e6995190da0ab58c0c16f595544f9f23424230dc69d7e298d79040a4bf',
  },
  /**
   * `100000` — 1건(EM2014, 2026-10-03 수집 — P8 컷 b5). **원화 · 월지급식** — `crnc_code` `KRW` · `rdmp_unit`
   * `10000` · `mm_pay_frml_yn` `Y` · 사다리 `월지급배리어 50, 3년/6개월 (85-85-80-75-70-65) KI20`
   */
  q2014: {
    file: 'search-100000-2014.json',
    query: '2014회',
    body: 'salFundNm=2014%ED%9A%8C&searchStartDt=&searchEndDt=&elsTp=1&prncaPayTp=&rpyYn=&ordTp=&sortTp=&contGubn=&nextData=',
    respCode: '100000',
    bytes: 5112,
    sha256: '51bff1384320baf73546912ff4ae43cb3fcea5b4bee5eb82ebef50ed179593cb',
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

/* ================================================================== 투자설명서 (P8 컷 b5′) */

/**
 * 투자설명서 PDF의 **추출 텍스트** — `B<code>.txt` (2026-10-03 KST 18시대 수집 · DOC-010 ADR-009 §8.1)
 *
 * PDF 바이너리를 저장소에 싣지 않는다(표본 하나 약 650KB). 대신 **어댑터가 쓰는 추출 그대로**(`unpdf` 1.8.1 ·
 * `extractText(pdf, { mergePages: true })` — `prospectus.ts` `extractWithUnpdf`)의 결과를 커밋한다. 그래서 이 픽스처가
 * 지나는 것은 `prospectus-parse.ts`부터이고, PDF → 텍스트 단계는 ⓐ 원본 PDF의 크기 · sha256을 여기 적고 ⓑ 프로젝트에
 * 설치된 `unpdf`로 다시 뽑아 **바이트 단위로 같음**을 수집 때 확인했다(다섯 다). pypdf 6.19로 뽑은 날짜와도 180/180 같았다.
 *
 * 다섯은 검색어 `100조` 목록의 월지급식 전부다(픽스처 `search-100001-100jo` — EM2048 · EM2040 · EM2032 · EM2014 · EM2005).
 * **자르지 않았다** — 「월수익 지급」 구간 밖의 「메모리」(마이크론 사업 설명 — ADR-009 ㉑)가 변형 낱말 검사의 범위를
 * 시험하는 재료다. 공개 저장소 검사(AQ-83): 이메일 · 휴대전화 · 주민등록번호 형태 0건(발행사 고객센터 같은 공개 정보뿐이다).
 */
export const PROSPECTUS_FIXTURES = {
  EM2014: {
    file: 'BEM2014.txt',
    pdfBytes: 636284,
    pdfSha256: '674fa3a3c0fc90faa64de41139ca78c9da68a146c1780bb0f1455cc63e016874',
    textBytes: 102792,
    textSha256: 'f118a04eb9438a2d650342c6af2e93874e1f63d979681990c3aea99785cca3e4',
    note: '원화 · KOSPI200 · 마이크론 · 「같은 날」 규약(앱 산식 6/36)',
  },
  EM2048: {
    file: 'BEM2048.txt',
    pdfBytes: 667396,
    pdfSha256: '33d7a7468ac47691b10271e91f3e1ef7abb8a3ed4404f4cf9d72bc376ba5f6a5',
    textBytes: 109484,
    textSha256: '4d7b065b43babc7945aa98dc5dd76ddb972bebc4c5d6f59442f0c34866d5ec4a',
    note: '달러 · 팔란티어 · 마이크론 · 표 한가운데 페이지 경계',
  },
  EM2040: {
    file: 'BEM2040.txt',
    pdfBytes: 667249,
    pdfSha256: '07cb300c937db279e1874f10113c436143a4a0a5984011ae1da4db36ee9fb7cc',
    textBytes: 109461,
    textSha256: 'c45514a066c0ede0489932df1a2a6e924d380168b1475f975cf90b4609b7f21a',
    note: '달러 · 팔란티어 · 마이크론',
  },
  EM2032: {
    file: 'BEM2032.txt',
    pdfBytes: 670260,
    pdfSha256: '6a10d36e94471a99f1d64910657ab5b872d68ea98fa1fd073e441c09a4186d4e',
    textBytes: 110733,
    textSha256: '3872b1441d7b1c8a770459ae73135730cafee29fd1c6ae427d408dd96409e451',
    note: '달러 · 팔란티어 · 마이크론',
  },
  EM2005: {
    file: 'BEM2005.txt',
    pdfBytes: 636513,
    pdfSha256: '9995f4d804c20e1d876ad9789d078912b903f0691b37582607a58be656d14758',
    textBytes: 103456,
    textSha256: '0627313d926331d059c62b2657a3f953307ac98ac58fa3026ce219f9b219100b',
    note: '원화 · KOSPI200 · 마이크론 · 「−1일」 규약',
  },
} as const
export type ProspectusCode = keyof typeof PROSPECTUS_FIXTURES

export function prospectusText(code: ProspectusCode): string {
  return readFileSync(join(DIR, PROSPECTUS_FIXTURES[code].file), 'utf8')
}

export function prospectusBytes(code: ProspectusCode): Buffer {
  return readFileSync(join(DIR, PROSPECTUS_FIXTURES[code].file))
}
