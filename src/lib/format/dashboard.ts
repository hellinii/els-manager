/**
 * 홈의 **표시 구조** — SCR-101 (P4 컷 9)
 *
 * ## 왜 화면 안이 아니라 여기인가
 *
 * `page.tsx`는 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 「한 상품이 한 줄이다」·「임박의 경계」·「자름을 표시한다」는 값의
 * 성질이므로 순수 함수로 떼어 두면 상시 스위트가 본다 — `lib/format/schedule.ts`
 * (월 그룹·과거/미래 구획)를 뗀 것과 같은 자리이며 그쪽과 같은 이유로 **타입을
 * 계약에 묶지 않고** 필요한 필드만 요구한다.
 *
 * ## 계약이 화면에 넘긴 판단이 여기 있다
 *
 * DOC-011 §4.1은 기간 창을 두지 않는다 — 창을 계약에 박으면 창 밖의 상품이 화면에서
 * 사라지고 그 상수는 어느 문서에도 근거가 없다. 그래서 경계와 표시 건수는 화면의
 * 것이며 근거는 DOC-008 §5 SCR-101에 있다. 이 파일은 그 결정의 **단일 구현**이다.
 */

import type { AttentionReason } from '@/lib/db/queries/map'

import { ATTENTION_REASON_GRADES, type BadgeGrade } from './badges'

/**
 * 「임박」의 경계 — **30일** (DOC-008 §5 SCR-101, DOC-005 §6)
 *
 * 근거는 사용 빈도다. 타깃 사용자는 저빈도·고중요 패턴이므로(DOC-001 §4) **다음
 * 접속이 한 달 뒤일 수 있고**, 그보다 가까운 평가일이 「지금 확인할 것」이다.
 *
 * **이 값이 틀려도 정보가 사라지지 않는다.** 표식은 D-Day 값을 대신하지 않고
 * 덧붙이며(모든 행이 `D-{n}`을 함께 표시한다) 이 화면에서 강조는 조치를 만들지
 * 않는다 — 평가일이 임박했을 때 앱에서 할 일은 없고, 경과한 뒤에 조치 목록의
 * `EVALUATION_PASSED`가 조치를 만든다. 그래서 근거가 약한 상수를 계약에 박지 않은
 * DOC-011 §4.1의 판단이 여기서 값을 갖는다.
 */
export const IMMINENT_DAYS = 30

/** 「임박」 — DOC-005 §6. 열거값이 아니라 boolean 파생이므로 §6.1의 표에 없다. */
export const IMMINENT_LABEL = '임박'

/**
 * 표시 건수 — 「스크롤이나 클릭 없이 세 가지를 안다」(DOC-008 §5의 설계 의도).
 *
 * ⑤가 ①보다 짧은 이유는 그것이 세 물음 중 어디에도 없는 **회고**라는 것이다.
 * 두 값 모두 자름을 화면이 표시하므로(`takeVisible`) 6번째가 조용히 사라지지 않는다.
 */
export const UPCOMING_VISIBLE = 5
export const RECENT_VISIBLE = 3

/**
 * 임박 판정 — **`dDay`의 부호는 계약이 정한다**(과거가 음수, DOC-011 §4.1).
 *
 * 음수를 임박으로 보지 않는다. 경과한 차수는 이 목록이 아니라 조치 목록의
 * `EVALUATION_PASSED`가 담당하며(§4.1이 두 구간을 배타적으로 나눈다) `upcomingEvaluations`
 * 자체가 이미 미래 차수만 담으므로 하한은 방어다 — 계약이 그 성질을 잃는 날
 * 「경과했는데 임박」이라는 표시가 나오지 않게 한다.
 */
export function isImminent(dDay: number): boolean {
  return dDay >= 0 && dDay <= IMMINENT_DAYS
}

/**
 * 자름 — **표시하지 않는 자름을 만들지 않는다.**
 *
 * `hidden > 0`이면 화면이 「총 N건 중 …」과 전체를 보는 링크를 함께 렌더한다.
 * 신호 없는 자름은 6번째 항목이 어떤 방법으로도 보이지 않는데 화면에 그 사실이
 * 없는 상태이며, DOC-010 AQ-22가 `searchAssets`에서 등재한 형태와 같다.
 */
export type Visible<T> = {
  shown: T[]
  total: number
  /** 잘려 나간 건수. `0`이면 화면이 자름을 말하지 않는다 */
  hidden: number
}

export function takeVisible<T>(items: readonly T[], limit: number): Visible<T> {
  return {
    shown: items.slice(0, limit),
    total: items.length,
    hidden: Math.max(0, items.length - limit),
  }
}

/**
 * 조치 목록을 **상품 단위로 접는다** — DOC-008 §5 SCR-101 ④
 *
 * 계약은 `(상품 × 사유)`를 평면 배열로 준다(한 상품이 여러 사유를 낸다, §4.1 v0.8).
 * 그 요소의 제목은 「주의 상태 **상품**」이므로 접지 않으면 결함 + KI 하회 상품이
 * 목록에 두 번 나타나고 **사용자는 그것을 두 개의 상품으로 읽는다.**
 *
 * ## 순서를 다시 정하지 않는다 — 두 축 모두
 *
 * 사유의 순서는 계약이 「결함 우선」으로 고정했다(§4.1 v0.8: 결함 → KI → 시세 없음
 * → 평가일 경과). 여기서 다시 정하면 §4.2 우선순위표가 화면마다 갈리는 함정이 이
 * 요소에서 재발한다 — `deriveDisplay()`를 단일 구현으로 둔 것과 같은 논거다.
 * 상품의 순서도 **첫 등장 순서**이며 계약이 준 순서다.
 *
 * 같은 상품이 떨어져서 두 번 나타나도 **먼저 만든 그룹에 합친다**(`groupByMonth`와
 * 같은 규약) — 제목이 두 번 나오면 사용자는 그것을 두 상품으로 읽는다.
 */
export type AttentionGroup<T extends { reason: unknown }> = {
  productId: string
  productName: string
  ownerName: string
  /** 계약이 준 순서 그대로. 대표값은 첫 원소다 */
  reasons: Array<T['reason']>
}

export function groupAttention<
  T extends {
    productId: string
    productName: string
    ownerName: string
    reason: unknown
  },
>(items: readonly T[]): Array<AttentionGroup<T>> {
  const groups: Array<AttentionGroup<T>> = []
  const byId = new Map<string, AttentionGroup<T>>()

  for (const item of items) {
    let group = byId.get(item.productId)
    if (group == null) {
      group = {
        productId: item.productId,
        productName: item.productName,
        ownerName: item.ownerName,
        reasons: [],
      }
      byId.set(item.productId, group)
      groups.push(group)
    }
    group.reasons.push(item.reason)
  }

  return groups
}

/**
 * 그룹의 시각 등급 — **가장 무거운 사유가 줄의 등급이다.**
 *
 * 첫 사유를 쓰면 「결함 우선」 순서 때문에 항상 `defect`가 되어 KI 하회 상품과
 * 결함 상품이 같은 색이 된다(그 순서는 **조치의 성격** 순이지 심각도 순이 아니다).
 * 사유마다 뱃지를 달아 각각의 등급을 그대로 보이는 것이 이 화면의 표시이고,
 * 이 함수는 **줄 전체의 강조**에만 쓴다.
 *
 * 서열은 `BADGE_WEIGHT`가 정한다 — `BadgeGrade`의 전수 사상이므로 등급이 늘면
 * 여기서 컴파일이 깨진다.
 */
const BADGE_WEIGHT: Record<BadgeGrade, number> = {
  neutral: 0,
  positive: 0,
  caution: 1,
  attention: 2,
  defect: 3,
}

export function heaviestGrade(reasons: readonly AttentionReason[]): BadgeGrade {
  let heaviest: BadgeGrade = 'neutral'
  for (const reason of reasons) {
    const grade = ATTENTION_REASON_GRADES[reason]
    if (BADGE_WEIGHT[grade] > BADGE_WEIGHT[heaviest]) heaviest = grade
  }
  return heaviest
}
