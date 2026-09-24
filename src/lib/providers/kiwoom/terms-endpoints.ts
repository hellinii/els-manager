/**
 * 키움 「상품 조건」 원천 — 엔드포인트·라벨·표시 규약·실측 함정 — DOC-010 ADR-009
 *
 * 이 파일에는 **상수만** 둔다. 파싱은 `html.ts`·`ladder.ts`·`search-parse.ts`·`terms-parse.ts`
 * (순수), 대조는 `terms-check.ts`(순수), 호출은 `terms.ts`다. es040(ADR-008)의 상수는
 * `endpoints.ts`에 그대로 있다 — **같은 사이트의 다른 원천**이고 규약이 다르다.
 *
 * ## ★ 이 원천은 `PriceProvider`가 아니다
 *
 * 시세를 내지 않고 `asset_prices`에 쓰지 않는다. 그래서 `PRICE_PROVIDERS`·`KNOWN_PROVIDER_IDS`·
 * `PROVIDER_CREDENTIALS` **어디에도 들어가지 않는다** — 들어가면 §5.8 `refreshPrices`가
 * 이것을 수집 대상으로 세고, V-21이 `provider = 'KIWOOM_TERMS'` 같은 매핑을 받아 준다.
 * `tests/providers/kiwoom-terms.test.ts`가 셋 다에 없음을 단언한다.
 *
 * ## ★★ 실측 기록 (2026-09-23 조사 · 2026-09-24 픽스처 재수집, 전부 쿠키 없는 POST)
 *
 * 형식은 정상이고 값만 거짓인 자리가 이 원천에 특히 많다. 전부 여기 적는다.
 *
 * | # | 관측 | 표본 | 이 어댑터의 처리 |
 * |---|---|---|---|
 * | ① | **없는 코드도 HTTP 200**이고 빈 템플릿이 온다(67,602B) | E99999 | 이름·자산 행·문서가 전부 비면 `EMPTY` |
 * | ② | 청약 중이면 최초기준가격이 **`0`**이고 조기상환 표가 「해당 내용이 없습니다.」다. **발행일이 지나도 그대로인 상품이 있다** | E04262 · E04200(발행일 2026-09-04, 09-24에도 0) | 상태를 날짜가 아니라 **내용**으로 가른다 → `PRE_ISSUANCE` |
 * | ③ | 옛 상품은 만기상환 구획이 **없다.** 「만기상환」 낱말은 주석과 공지 제목에만 있다 | E00795 | 주석 제거 후 **정확한 제목**으로만 찾는다 → `maturity: null`. 파싱은 `ok`이고 대조가 `MATURITY_ABSENT`(BLOCKING)로 거부한다 |
 * | ④ | 만기 평가일이 `rowspan="3"`(사흘 평균) 또는 `rowspan="1"`이다 | E04000 · E03060 · E04100 | `expandGrid`로 펼친다 |
 * | ⑤ | 조기상환정보의 수익확정일 `<td>`가 **닫히지 않는다** | E04000 · EM1740 | 셀 끝을 `</td>`가 아니라 다음 셀·행 시작으로 본다 |
 * | ⑥ | 「KI(Knock-In/Knock-Out) 여부」와 es020 `ki_yn`은 「KI가 있는 상품인가」가 **아니라** 「이미 터치했는가」다 | E00795 `예` + 공지 「낙인배리어 터치 안내」 | 읽지 않는다 — `TERMS_NOT_READ` |
 * | ⑦ | **팝업 표가 틀린다.** 상환조건(%)이 1·2차 85인데 헤더 사다리·SEIBro는 88이다. 조기상환가격도 85로 계산되어 **표 안에서는 일관된다** | E03060 | 파싱은 `ok`, 대조가 `BLOCKING`을 낸다 |
 * | ⑧ | 가격 표시가 **소수 4자리 절사 + 뒤 0 제거**다 — 85.905×0.75 = 64.42875 → `64.4287` | EM1039 | `DISPLAY_SCALE` |
 * | ⑨ | 월지급식은 차수별 수익률이 전부 `0`이다 | EM2048 | 대조가 `MONTHLY_PAY`(BLOCKING)로 거부하고 수익률 대조는 하지 않는다. 같은 상품이 `달러청약`이라 `FOREIGN_CURRENCY`도 난다 — 검색 픽스처 `search-100001-100jo` 40행에서 `USD` ⟺ `달러청약`(9/9), `mm_pay_frml_yn = Y` ⟺ `월지급`(5/5) |
 * | ⑩ | 검색 목록의 사다리가 팝업 헤더와 **다르다** — 목록 `…) KI` · 팝업 `…) KI25` | EM2048 | 팝업이 정본. 목록 차이는 NOTE |
 * | ⑪ | 헤더 기초자산명과 표의 자산명이 다르다 — `HSCEI`↔`홍콩H지수`, `NIKKEI225`↔`일본니케이225지수` | E00795 · E03060 | 표가 정본. 이름 차이는 NOTE, **개수** 차이만 BLOCKING |
 * | ⑫ | ELB 팝업은 기준가격이 있고 조기상환 표가 비어 있다. 「조기상환형 상품이 아닙니다」 표식은 **빈 템플릿에만** 있다 | E90795 · E99999 | `MALFORMED`(범위 밖). 표식을 상태 판정에 쓰지 않는다 |
 * | ⑬ | 이름은 있는데 문서가 0개이고 청약기간이 `1900.01.01 ~ 1900.01.01`인 상품이 있다 | E04050 | 신원(`B<code>.pdf`)을 확인할 수 없으므로 `MALFORMED` |
 * | ⑭ | 정상 팝업도 `evfw` WAF 스크립트를 싣는다 | 전 표본 | 차단 표식으로 쓰지 않는다(`http.ts`) |
 * | ⑮ | 리자드가 2차에 올 수 있고 노낙인이 `NO KI`(공백)로 적힌다 | E04100 `(75-75(L50)-…) NO KI` | `ladder.ts` |
 * | ⑯ | 해외주식 티커는 자산 표가 아니라 「해외기초자산 정보」 표의 **거래소 행**에 있다(`시세보기 PLTR`) | EM1740 · EM2046 · EM2048 · EM1039 | 열 수가 자산 수와 같을 때만 읽는다 |
 * | ⑰ | 평가일은 산식(`발행일 + n×주기 − 1일`)이 아니다 — 휴일이면 앞뒤로 옮겨진다 | EM1740 4차 2027-05-28(금) | 요일 규칙을 두지 않는다. 받은 날짜를 그대로 낸다 |
 * | ⑱ | 팝업 기준가격은 **분할 조정값**이다 — es040 종가와 기준이 다를 수 있다 | EM1039 엔비디아 85.905 (2026-09-23 조사) | es040 대조를 하지 않는다(DOC-002 DQ-08 보충) |
 */

const BASE = 'https://www.kiwoom.com'

/**
 * 둘 다 `POST` · `application/x-www-form-urlencoded` · **쿠키 없음**이다.
 *
 * - `search` — 청약이 **끝난** 상품의 이름 부분 일치 검색. `GET`은 500이다(실측)
 * - `popup` — 서버가 렌더한 상세 HTML. 본문은 `salFundCd=<code>` 하나다
 * - `documentBase` — 문서 PDF의 접두. 파일명은 팝업의 `data-filenm`에서 **읽는다**(유도하지 않는다)
 */
export const TERMS_ENDPOINTS = {
  search: `${BASE}/wm/edl/es020/getEndElsMainJson`,
  popup: `${BASE}/wm/edl/es010/fndElsDetailPopup`,
  documentBase: `${BASE}/wm/upload/gds/`,
} as const

/**
 * 검색 본문의 나머지 칸 — 페이지 `#searchForm`의 필드 전수이며 **`salFundNm`만 호출자가 채운다.**
 *
 * - `elsTp: '1'` — ELS만. 빈 값이면 DLS·ELB·DLB가 섞인다(ELB는 ⑫로 어차피 거부된다)
 * - 날짜 창을 **비운다.** 창을 넣으면 창 안의 자료에 따라 `520050`이 나는데 그 경계는
 *   컷오프가 아니라 데이터에 달려 있다 — 이름 검색은 창 없이 2010년 상품까지 닿는다
 * - `contGubn`·`nextData` — 다음 페이지 표지. **따라가지 않는다**(`truncated`로 알린다)
 *
 * 픽스처는 **이 객체가 만드는 본문 그대로** 받아 왔다(`tests/providers/fixtures/kiwoom-terms.ts`).
 */
export const SEARCH_FORM_DEFAULTS = {
  searchStartDt: '',
  searchEndDt: '',
  elsTp: '1',
  prncaPayTp: '',
  rpyYn: '',
  ordTp: '',
  sortTp: '',
  contGubn: '',
  nextData: '',
} as const

/**
 * `result.resultMap.resp_code` — HTTP는 항상 200이고 **성패가 본문에 있다.**
 *
 * | 코드 | 뜻 (실측 표본) | 결과 |
 * |---|---|---|
 * | `100000` | 완료 (`4000회` → 1건) | `ok` |
 * | `100001` | 「연속 자료가 존재합니다」 + `cont_gubn: 'Y'` (`100조` → 40건) | `ok` + `truncated` |
 * | `505065` | 「자료가 존재하지 않습니다」 — `g1`이 **아예 없다** (`3060회`: 그 상품은 「3060**호**」다) | `ok([])` |
 * | `520050` | 「종목정보 조회중 오류」 (`키움 ELS 3`) | `HTTP` — 코드·문구를 `detail`에 싣는다 |
 * | 그 밖 | 모른다 | `HTTP` |
 */
export const RESP_CODE = {
  OK: '100000',
  CONTINUED: '100001',
  NOT_FOUND: '505065',
} as const

/** 검색어 길이 상한. 사용자 입력에만 건다 — 팝업 이름으로 하는 내부 조회는 이 상한 밖이다 */
export const QUERY_MAX_LENGTH = 30

/**
 * 상품 코드 — `E04000`·`EM1740`·`E90795`. 검색어·팝업 호출 모두 이 형식이 아니면
 * **네트워크에 나가지 않는다**(`SYMBOL_SCHEME`).
 */
export const PRODUCT_CODE = /^E[0-9A-Z]{5}$/

/**
 * 팝업 구획의 **정확한** 제목 — `<h1 class="head-sub-title">` 안의 텍스트와 완전 일치로만 찾는다.
 *
 * 부분 일치는 안전하지 않다: 공지 제목 `[만기상환 안내] 제795회 …`가 「만기상환」을 담는다(③).
 * 툴팁의 `<h1 class="contents-title">`은 클래스가 달라 걸리지 않는다.
 */
export const SECTION_HEADINGS = {
  assets: '기초자산정보',
  overseasAssets: '해외기초자산 정보',
  rounds: '조기상환 평가정보',
  maturity: '만기상환 평가정보',
  notices: 'ELS/DLS 공지사항',
} as const

/** 헤더 블록(`els-block-title > strong`)의 라벨 */
export const HEADER_LABELS = {
  headline: '특정조건 충족 시 수익률(세전)',
  ladder: '상환조건',
  underlyings: '기초자산',
  maxLoss: '조건 미충족 시 최대손실률',
  issueDate: '발행일',
  maturityDate: '만기일',
  tenor: '만기/상환주기',
  subscription: '청약기간',
  redeemed: '상환여부',
} as const

/** 없거나 비면 `MALFORMED`인 라벨. 나머지는 없어도 된다(E04262에는 상환여부가 없다) */
export const REQUIRED_HEADER_LABELS = [
  HEADER_LABELS.ladder,
  HEADER_LABELS.underlyings,
  HEADER_LABELS.issueDate,
  HEADER_LABELS.maturityDate,
  HEADER_LABELS.tenor,
] as const

/**
 * 기초자산정보 표의 열 라벨 — **위치를 박지 않고 라벨로 찾는다.**
 *
 * 주석 처리된 「기초자산 현재가」 열이 실제로 있다(`<!-- <th>기초자산 현재가</th> -->`).
 * 누가 그 주석을 풀면 위치로 읽는 파서는 **모든 열이 한 칸씩 밀린 채** 조용히 통과한다.
 * 그래서 라벨이 모자라거나 **남아도** `MALFORMED`다 — 읽지 않는 열도 이름으로 허용한다.
 */
export const ASSET_COLUMNS = {
  name: '기초자산',
  basePrice: '최초기준가격',
  kiPrice: 'Knock-In 가격',
} as const

/** 읽지 않지만 있어도 되는 열. 「No Knock-In 가격」은 툴팁 문구가 붙으므로 **앞부분 일치**다 */
export const ASSET_COLUMNS_NOT_READ = ['Knock-Out 가격', 'No Knock-In 가격'] as const

/** 조기상환 평가정보 표의 잎 라벨. 자산별 가격 열은 부모 라벨 `ROUND_PRICE_GROUP` 아래에 있다 */
export const ROUND_COLUMNS = {
  label: '차수',
  evaluationDate: '평가일',
  paymentDate: '상환지급일',
  cumulativeYield: '수익률(%)',
  barrier: '상환조건(%)',
} as const
export const ROUND_PRICE_GROUP = '조기상환가격'

/** 만기상환 평가정보 표의 잎 라벨 — 첫 열의 이름이 조기상환 표와 다르다 */
export const MATURITY_COLUMNS = {
  evaluationDate: '만기상환평가일',
  paymentDate: '상환지급일',
  cumulativeYield: '수익률(%)',
  barrier: '상환조건(%)',
} as const
export const MATURITY_PRICE_GROUP = '만기상환가격'

/** 표 본문이 비었다는 서버 문구. 이것 **하나만** 있는 행은 「행 0개」다 */
export const NO_ROWS_TEXT = '해당 내용이 없습니다.'

/** 빈 템플릿(①)의 조기상환정보 문구. **상태 판정에 쓰지 않는다**(⑫) — 진단 문구에만 싣는다 */
export const NOT_AUTOCALLABLE_MARKER = '해당 상품은 조기상환형 상품이 아닙니다.'

/** 해외기초자산 정보 표에서 티커를 읽는 행과 셀 형식(⑯) */
export const TICKER_ROW = '거래소'
export const TICKER_CELL = /^시세보기 ([A-Z][A-Z0-9.]{0,9})$/

/**
 * 문서 종류 — **링크 문구로** 가른다. 파일명 접두(Q/B/C/A)로 가르지 않는 이유는 2010년
 * E00001의 파일명이 그 규칙을 따르지 않기 때문이다(2026-09-23 조사).
 */
export const DOCUMENT_KINDS = {
  핵심설명서: 'KEY',
  투자설명서: 'PROSPECTUS',
  간이투자설명서: 'SIMPLE',
  상품안내자료: 'GUIDE',
} as const

/**
 * ★ **신원 확인 문서** — 팝업은 코드를 되돌려 주지 않는다. 파일명만이 코드를 말한다.
 *
 * `B<code>.pdf`(투자설명서)가 `data-filenm` 중에 없으면 **이 팝업이 요청한 상품의 것인지
 * 알 수 없다** → `MALFORMED`. 청약 중 상품에도 있다(E04262 `BE04262.pdf`, 실측) — 예외가 없다.
 */
export const IDENTITY_DOCUMENT = { prefix: 'B', suffix: '.pdf' } as const

/**
 * ★★ **표시 스케일 — 키움은 «절사»하고 뒤 0을 지운다(⑧).**
 *
 * 대조(`terms-check.ts`)는 정확값 `x`와 표시값 `s`에 대해 **`0 ≤ x − s < 1단위`**를 요구한다
 * (단위 = `10^−scale`). 반올림 허용폭(±½단위)을 쓰지 않는 이유가 EM1039다 — 반올림이면
 * `64.4288`이어야 하는데 `64.4287`이 왔다.
 *
 * | 칸 | scale | 근거 (정확하지 «않은» 표본) | 정확한 표본 |
 * |---|---|---|---|
 * | 가격 (배리어·KI) | **4** | EM1039 엔비디아 64.42875 → `64.4287` (3-1차·4차) | 지수 `6,886.8525`·`32,189.0835`(4자리가 실제로 쓰인다), 해외 `53.151`, 국내 `269,450` |
 * | 백분율 (누적 수익률) | **2** | **없다** — 7개 상품의 누적 수익률이 전부 나누어떨어졌다 | E04000 `16.05`, EM2046 `5.54`, EM1740 `7.21` |
 *
 * ★ **자산 부류별 스케일을 두지 «않는다».** 국내주식이 정수로 절사될 가능성이 있으나 측정한
 * 국내주식 가격(E04000·E04230 · 2026-09-23 조사의 E00001)이 **전부 정수로 나누어떨어져**
 * 정수 절사와 4자리 절사를 가를 표본이 없다. 그리고 팝업만으로는 부류를 알 수 없다(국내 지수도
 * `271.1205`처럼 4자리다). 틀린 방향이 **시끄럽다**는 것이 이 선택의 근거다 — 국내주식이 실제로
 * 정수 절사라면 그 상품은 `BLOCKING`으로 거부되고(거짓 양성), 조용히 통과하지는 않는다.
 * 백분율 2자리 절사도 같은 논거다: 반올림 표시가 실재하면 거부로 드러난다.
 *
 * 백분율 토큰이 **소수 둘째 자리까지만** 허용되는 것(`terms-parse.ts`)과 맞물린다 — 저장 열이
 * `numeric(6,4)` 비율이라 셋째 자리부터는 Postgres가 **조용히 반올림**한다.
 */
export const DISPLAY_SCALE = {
  price: 4,
  percent: 2,
} as const

/** 응답 본문 상한(바이트). 스트림으로 센다 — `text()`는 전부 읽은 뒤에야 크기를 안다. 실측 최대 102,654B */
export const MAX_BODY_BYTES = 1_048_576

/** 요청당 상한(ms) — DOC-011 §4.10 X-06 */
export const REQUEST_TIMEOUT_MS = 8_000

/** 한 조회(최대 2요청 · 자산 목록은 3요청)의 전체 상한(ms). `deadlineAt`을 주지 않으면 조회마다 이것으로 잡는다 */
export const LOOKUP_BUDGET_MS = 15_000

/**
 * ★ **읽지 않는 것의 전수** — es040의 `NOT_READ`와 같은 형태다. 이름을 적어 두는 것이
 * 「빠뜨렸다」와 「뺐다」를 가른다.
 */
export const TERMS_NOT_READ = {
  조기상환결정여부: '조기상환정보 표. E00795(2021 만기)에서 「미결정」으로 남아 있다 — 낡는다',
  KI여부: '팝업 「KI(Knock-In/Knock-Out) 여부」·es020 `ki_yn`. 「KI 터치 여부」다(⑥). `ki_touched_at`으로 새면 안 된다',
  수익확정일: '조기상환정보 표. 닫히지 않는 `<td>`의 자리다(⑤)',
  상환대금지급일: '조기상환정보 표. 상환 기록은 이 어댑터의 범위가 아니다',
  KnockOut가격: '기초자산정보 표. 전 표본에서 0',
  NoKnockIn가격: '기초자산정보 표. 전 표본에서 0',
  기준가추이: 'NAV 탭. 상품 공정가치이고 기초자산 가격이 아니다(ADR-008)',
  최대손실률: '헤더. `maxLossText`로 원문만 싣는다 — 판정 입력이 아니다',
} as const

/** 조사했으나 **쓰지 않는** 원천 — ADR-009 §5 */
export const NOT_USED = {
  es010_getElsListJson: '청약 중 목록. 그 상품의 팝업은 기준가·차수가 비어 채울 것이 거의 없다(②)',
  en010_getSrchNoticeTab2: '공지 본문. 기준가격 결정일·사흘 평균 규칙이 있으나 자유 문장이다 — `noticeIds`만 싣는다',
  PDF: '투자설명서 본문. 법적 정본이나 비정형이다 — URL만 싣는다',
} as const
