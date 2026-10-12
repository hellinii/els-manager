/**
 * 절 빈 상태의 글자 — SCR-101 ① ④ ⑤ · SCR-301 「다가오는 평가일」 (홈 피드백 컷 K4)
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
 * 화면 전체의 빈 상태(상품 없음 — 홈 · SCR-201 · SCR-301)는 이 파일에 아직 없다(홈 피드백 컷 K12).
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
