import { SCOPE_LABELS } from './labels'

/**
 * 빈 상태의 글자 — SCR-101 ① ④ ⑤ · SCR-301 「다가오는 평가일」 (홈 피드백 컷 K4) · 화면 전체의 빈 상태 (홈 피드백 컷 K12)
 *
 * ## 왜 화면 안이 아니라 여기인가 — 둘
 *
 * **e2e가 이 값을 import해 단언한다.** 리터럴을 화면과 테스트에 따로 두면 화면 문구가 바뀌는 날 테스트의 음성
 * 단언이 조용히 헛돈다 — 종전 `home.test.ts`의 「임박한 평가일이 없다」가 그 자리였다. 그리고 ①의 뒷절을 붙이는
 * **조건**(DOC-008 SQ-28)이 값의 판단이므로 순수 함수로 떼면 상시 스위트가 본다(DOC-010 AQ-23 — 화면 파일은 어느
 * 스위트의 import 그래프에도 없다).
 *
 * ## 문체 (DOC-005 §2.1)
 *
 * 빈 상태 **제목은 명사형**이고(「~없음」) 뒤의 **안내는 해요체**다. 둘이 한 줄에 오는 것은 섞임이 아니다 — 제목과
 * 설명은 대상이 다르다(§2.1 「섞지 않는 단위는 상자다」). 문구의 정본은 DOC-008 §6 「①의 절 단위 빈 상태」 각주와
 * SCR-301 빈 상태 표이며 `tests/app/emptyState.test.ts`가 「」째로 결속한다(취소선 · 이력 행 밖의 글만 — `liveDoc`).
 *
 * ~~화면 전체의 빈 상태(상품 없음 — 홈 · SCR-201 · SCR-301)는 이 파일에 아직 없다(홈 피드백 컷 K12).~~ → 화면 전체의 빈
 * 상태도 여기다 — 아래 `EMPTY_STATES` *(홈 피드백 컷 K12)*. 정본은 DOC-008 §6 「화면 빈 상태의 글자」 각주다.
 */

/**
 * 절 빈 상태의 제목 셋 — **절 제목(h2)은 남고 그 아래 한 줄이다**(피드백 #10 — 점선 상자가 빈 절에 자리를 줬다).
 *
 * ⑤가 「상환된 상품 없음」이 아니라 「상환 실적 없음」인 것은 절 제목 「최근 상환 실적」과 같은 말을 쓰기 위해서다.
 */
export const SECTION_EMPTY = {
  upcoming: '다가오는 평가일 없음',
  attention: '주의 상태 상품 없음',
  recent: '상환 실적 없음',
} as const

/** 제목과 안내 사이 — 한 줄 안의 이음표 */
const JOINER = ' — '

/**
 * ①의 빈 줄 · SCR-301의 「다가오는 평가일이 없다」 상태 — **같은 사실이고 가리키는 블록이 같다**(DOC-008 §6 각주).
 *
 * 상품은 있는데 미상환 상품의 다음 평가일이 하나도 없는 상태다(전 차수 경과 · 전부 상환완료 · 평가일정 0건 결함뿐).
 * 그때 다음 행동은 등록이 아니라 상환 처리이고, 무엇을 물을지는 홈 ⑥ 「상환 확인 필요」가 정한다.
 *
 * **두 화면이 아는 것이 다르다** — DOC-008 SQ-28:
 *
 * - **홈은 ⑥의 건수를 안다.** 그래서 ⑥에 항목이 있을 때만 뒷절을 붙인다. 보유 상품이 전부 상환완료이거나 평가일정이
 *   없는 결함 상품뿐이면 ⑥도 비어 그리지 않으므로(알림이다) 뒷절이 **없는 블록을 가리킨다** — 종전 문구부터 있던 한계다
 * - **SCR-301은 모른다** — 그 화면의 계약(`listSchedule`)은 평가일 판정을 싣지 않는다(판정은 `getDashboard`의
 *   `redemptionChecks`다). 그래서 뒷절을 조건문으로 쓴다 — ⑥이 비어 있어도 참이다
 */
export function missingUpcomingNote(where: 'SCHEDULE'): string
export function missingUpcomingNote(where: 'HOME', redemptionCheckCount: number): string
export function missingUpcomingNote(where: 'HOME' | 'SCHEDULE', redemptionCheckCount = 0): string {
  if (where === 'SCHEDULE') {
    return `${SECTION_EMPTY.upcoming}${JOINER}상환을 확인할 지난 차수가 있으면 홈의 「상환 확인 필요」에 떠요.`
  }
  return redemptionCheckCount > 0
    ? `${SECTION_EMPTY.upcoming}${JOINER}지난 차수는 위 「상환 확인 필요」를 보세요.`
    : SECTION_EMPTY.upcoming
}

// ---------------------------------------------------------------------------
// 화면 전체의 빈 상태 — 홈 · SCR-201 · SCR-301 (홈 피드백 컷 K12)
// ---------------------------------------------------------------------------

/** 빈 상태 하나의 글자 — 제목(명사형) · 설명(해요체) · 다음 행동의 글자(동작 이름 — ST-02). 주소는 화면이 붙인다 */
export type EmptyStateText = {
  readonly title: string
  readonly description: string
  readonly action: string
}

/** 이 축을 넓히는 다음 행동 — DOC-005 §2.1 「~보기」 관용형 · 글자는 표시 범위(`SCOPE_LABELS`)를 따른다 */
const SHOW_ALL_OWNERS = `${SCOPE_LABELS.ALL}로 보기`

/**
 * 화면 전체의 빈 상태 여덟 — 홈 둘(범위) · SCR-201 셋 · SCR-301 셋(필터 — 넷째 「다가오는 평가일 없음」은 위 함수) (홈 피드백 컷
 * K12 · 민서 결정(2026-10-12) D4 · D6 · DOC-008 §6 「화면 빈 상태의 글자」).
 *
 * ## 왜 한 곳인가 — 한 사실을 화면마다 다르게 부르지 않는다
 *
 * SCR-201 · 301의 「내 것만 없다」는 SCR-101이 SQ-03에서 먼저 지난 자리이고 **그때 쓴 문구 · 행동을 두 화면이 그대로 쓴다**
 * (DOC-008 §6 「SCR-201·301의 빈 상태가 하나씩 늘었다」). 종전에는 세 화면이 각자 리터럴이라 그 규칙을 아무것도 지키지
 * 않았고(「내 상품이 없다」가 두 파일에 따로 있었다) e2e도 리터럴을 따로 들고 있어 화면 문구가 바뀌면 음성 단언이 조용히
 * 헛돌았다. 이제 같은 사실은 같은 값을 **가리키고**(`homeMine.title`과 `productsMine.title`) 상시 스위트가 그 동일성을 본다.
 *
 * ## 문체 (DOC-005 §2.1)
 *
 * 제목은 명사형(「~없음」 — DOC-008 §6 상태 표의 꼴 그대로)이고 설명은 해요체다. 이 축을 넓히는 행동은 「모든 사용자로
 * 보기」 — 종전 「전체 보기」의 「전체」는 다른 필터 축에서 「좁히지 않음」이자 기본값이라 이 축에서 반대로 읽혔다(피드백 #11).
 *
 * **홈의 `MINE`은 범위를 넓히는 버튼이 없다** — 범위 전환이 머리글에 늘 렌더되므로 설명이 그 길을 말하고 다음 행동은 등록이다
 * (`EmptyState.action`은 하나다 · DOC-008 §6 「SCR-101의 빈 상태가 범위에 따라 둘이다」).
 */
export const EMPTY_STATES = {
  homeMine: {
    title: '내 상품 없음',
    description: `위에서 「${SCOPE_LABELS.ALL}」로 바꾸면 다른 사용자의 상품이 보여요. 내 ELS를 등록하면 평가일정·조건 판정·세금 계산이 함께 채워져요.`,
    action: '+ 등록',
  },
  homeAll: {
    title: '등록된 상품 없음',
    description: 'ELS를 등록하면 다가오는 평가일·조치 목록·올해 금융소득이 여기에 모여요.',
    action: '+ 등록',
  },
  productsMine: {
    title: '내 상품 없음',
    description: `다른 사용자의 상품까지 보려면 소유자를 「${SCOPE_LABELS.ALL}」로 바꾸세요.`,
    action: SHOW_ALL_OWNERS,
  },
  productsNarrowed: {
    title: '조건에 맞는 상품 없음',
    description: '필터를 해제하면 내 상품 목록이 보여요.',
    action: '필터 초기화',
  },
  productsAll: {
    title: '등록된 상품 없음',
    description: 'ELS를 등록하면 평가일정·조건 판정·세금 계산이 함께 채워져요.',
    action: '+ 등록',
  },
  scheduleMine: {
    title: '내 평가일정 없음',
    description: `다른 사용자의 일정까지 보려면 소유자를 「${SCOPE_LABELS.ALL}」로 바꾸세요.`,
    action: SHOW_ALL_OWNERS,
  },
  scheduleNarrowed: {
    title: '조건에 맞는 평가일 없음',
    description: '필터를 해제하면 내 일정이 보여요.',
    action: '필터 초기화',
  },
  scheduleAll: {
    title: '등록된 평가일정 없음',
    description: 'ELS를 등록하면 차수별 평가일과 예상 수령액이 여기에 모여요.',
    action: '+ 등록',
  },
} as const satisfies Record<string, EmptyStateText>
