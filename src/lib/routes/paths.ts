/**
 * 경로 정본 — DOC-008 §4의 `경로` 열 + §3 주 네비게이션
 *
 * **순수 데이터다.** `next`도 `react`도 import하지 않으므로 상시 스위트가 그대로
 * 읽는다. 그래서 `src/proxy.ts`(프레임워크 안)와 `src/components/`(브라우저로
 * 나가는 코드)와 무효화 맵(컷 1b)이 **같은 문자열 하나**를 본다. 경로를 리터럴로
 * 흩뿌리면 `/login` 하나의 이름이 프록시·셸·서버 액션에 각자 적히고 그중 하나만
 * 고쳐지는 날이 온다.
 *
 * 무효화 맵이 이 파일의 값을 쓰기 때문에 "맵의 모든 경로가 실재 라우트"를 단언할
 * 수 있다(컷 1b). 그 단언의 좌변이 여기다.
 *
 * 동적 경로는 문자열이 아니라 **함수**로 둔다 — 템플릿 리터럴을 호출부에서 조립하면
 * `/products/${id}/edit`의 슬래시 위치가 화면마다 갈릴 수 있고, 그 오타는 404로만
 * 드러난다.
 */

export const PATHS = {
  /** SCR-101 홈 */
  home: '/',
  /** SCR-001 로그인 */
  login: '/login',
  /** SCR-201 목록 */
  products: '/products',
  /** SCR-204 등록 */
  productNew: '/products/new',
  /** SCR-202 상세 */
  product: (id: string): string => `/products/${id}`,
  /** SCR-204 수정 */
  productEdit: (id: string): string => `/products/${id}/edit`,
  /** SCR-203 상환 처리 */
  productRedeem: (id: string): string => `/products/${id}/redeem`,
  /** SCR-301 평가일정 */
  schedule: '/schedule',
  /** SCR-302 시세 관리 */
  prices: '/prices',
  /** SCR-401 세금 계산 */
  tax: '/tax',
  /** SCR-402 다년도 전망 (P4b) */
  forecast: '/forecast',
  /** SCR-502 설정 */
  settings: '/settings',
} as const

export type NavItem = {
  /** UI 표시 문자열. 한글 표준 용어 (DOC-005) */
  label: string
  href: string
  /** 근거 추적용 — DOC-008 §4의 화면 ID */
  screen: string
}

/**
 * 주 네비게이션 — DOC-008 §3의 표를 순서까지 그대로 옮긴다.
 *
 * 다섯째 항목이 링크가 아니라 **묶음**이다. DOC-008이 「더보기」의 대상 화면을
 * `—`로 둔 것이 그 뜻이다 — `/more` 같은 라우트를 만들면 문서에 없는 화면이
 * 하나 생긴다. 대신 `MORE_ITEMS`를 메뉴로 펼친다.
 *
 * **시세 관리가 여기 없는 것은 의도다.** DOC-008 §3: 시세는 자동 조회가 기본이고
 * 수동 입력은 폴백이므로, 상시 노출하면 폴백이 정상 경로로 보인다.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: '홈', href: PATHS.home, screen: 'SCR-101' },
  { label: '상품', href: PATHS.products, screen: 'SCR-201' },
  { label: '일정', href: PATHS.schedule, screen: 'SCR-301' },
  { label: '세금', href: PATHS.tax, screen: 'SCR-401' },
] as const

/** 「더보기」가 펼치는 것. SCR-501은 만들지 않는다(DOC-008 SQ-01). */
export const MORE_ITEMS: readonly NavItem[] = [
  { label: '시세 관리', href: PATHS.prices, screen: 'SCR-302' },
  { label: '설정', href: PATHS.settings, screen: 'SCR-502' },
] as const

export const MORE_LABEL = '더보기'

/**
 * 활성 탭 판정 — 하위 경로까지 부모 탭을 활성으로 본다.
 *
 * `/products/abc/edit`에서 「상품」이 꺼지면 사용자는 자기가 어느 구역에 있는지
 * 잃는다. 그래서 접두사 일치인데 **구분자까지 붙여서** 본다. 두 가지가 그 한
 * 글자에 달려 있다.
 *
 * | 형태 | `startsWith(href)` | `startsWith(href + '/')` |
 * |---|---|---|
 * | `/taxes` ↔ `/tax` | 활성 (틀림) | 비활성 |
 * | 아무 경로 ↔ `/` (홈) | **항상 활성** (틀림) | 비활성 — `'//'`로 시작하는 경로가 없다 |
 *
 * 둘째 줄이 홈의 예외를 **없애 준다.** 처음에는 `href === '/'`를 따로 분기했는데,
 * 음성 대조에서 그 줄을 지워도 아무 단언이 실패하지 않았다 — 대조가 약한 것이
 * 아니라 그 분기가 **죽은 코드**였다(같은 단언이 경계 없는 `startsWith`에는
 * 실패한다. 두 대조를 다 돌려 구분했다). 없는 예외를 지키는 것처럼 보이는 분기를
 * 남기지 않는다.
 *
 * 순수 함수로 떼어 둔 이유가 이것이다 — 컴포넌트 안에 있으면 이 한 글자를
 * 브라우저 없이 시험할 수 없다(AQ-32의 경계선이 여기다).
 */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** 「더보기」는 자기 경로가 없으므로 펼친 항목 중 하나라도 활성이면 활성이다. */
export function isMoreActive(pathname: string): boolean {
  return MORE_ITEMS.some((item) => isNavActive(pathname, item.href))
}
