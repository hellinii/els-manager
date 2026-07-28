import type { ConditionResult, KiStatus } from '@/lib/domain'
import type { AttentionReason, IntegrityIssue, ProductListItem, RedemptionView } from '@/lib/db/queries/map'
import type { AssetPriceView } from '@/lib/db/queries/prices'
import type { AssetInput, ProductInput } from '@/lib/db/mutations/types'

/**
 * 열거형 → 한글 표시 문자열 — **DOC-005 §6.1이 정본이다** (절대 규칙 #9)
 *
 * ## 왜 한 파일에 모으는가
 *
 * 화면이 열거값을 직접 옮기면 같은 값이 화면마다 다른 말로 나온다. 실제로 문서
 * 사이에 이미 그런 갈림이 있었다 — `kiStatus.BELOW`가 DOC-007 §3.4에서는
 * 「KI 이하 (확인 필요)」, DOC-008 §5에서는 「KI 배리어 하회 — 확인 필요」였다.
 * 어느 쪽을 옮겨 적어도 다른 문서와 어긋나는 상태였고, 그 갈림을 볼 테스트가
 * 없었다. DOC-005 §6.1을 정본 표로 신설하고 `tests/app/labels.test.ts`가 그 표를
 * **파싱해 이 파일과 전수 대조**한다 — 한쪽이 늘거나 줄면 실패한다.
 *
 * ## 타입은 계약에서 가져온다 (`import type`만)
 *
 * `Record<유니온, string>`이므로 계약의 유니온에 값이 늘면 **여기서 컴파일이
 * 깨진다.** 열거값을 문자열로 다시 적으면 그 강제가 사라지므로 계약 타입을
 * 색인해 쓴다. 값 import는 린트가 막는다(컷 0d 규칙 3) — 타입은 컴파일 후
 * 사라지므로 `lib/domain`·`lib/db`가 클라이언트 번들에 실리지 않는다.
 *
 * ## 뱃지 등급은 여기 없다
 *
 * 같은 문자열이 맥락에 따라 다른 강조를 받는다(ST-05). DOC-005 §6.3이 등급을
 * 따로 정의하며 구현은 `badges.ts`다.
 */

export const STATUS_LABELS: Record<ProductListItem['status'], string> = {
  ACTIVE: '보유중',
  REDEEMED: '상환완료',
}

export const ACCOUNT_TYPE_LABELS: Record<ProductListItem['accountType'], string> = {
  GENERAL: '일반',
  TAX_FREE: '비과세',
}

export const REDEMPTION_TYPE_LABELS: Record<RedemptionView['redemptionType'], string> = {
  EARLY: '조기상환',
  LIZARD: '리자드상환',
  MATURITY_GAIN: '만기상환(이익)',
  MATURITY_LOSS: '만기상환(손실)',
}

/**
 * 판정 결과. `redemptionType`과 `EARLY`·`LIZARD`를 공유하지만 **성질이 다르다** —
 * 이쪽은 추정이고 저쪽은 확정이다(ST-05). 라벨은 같고 뱃지 등급이 다르다.
 */
export const CONDITION_RESULT_LABELS: Record<ConditionResult, string> = {
  EARLY: '조기상환',
  LIZARD: '리자드상환',
  CARRY_OVER: '이월',
}

export const KI_STATUS_LABELS: Record<KiStatus, string> = {
  NO_KI: '노낙인',
  SAFE: '안전',
  WARNING: '주의',
  BELOW: 'KI 배리어 하회',
  TOUCHED: 'KI 터치',
}

export const KI_OBSERVATION_LABELS: Record<
  NonNullable<ProductInput['kiObservation']>,
  string
> = {
  CONTINUOUS: '장중 터치',
  CLOSING: '종가',
}

export const ASSET_TYPE_LABELS: Record<AssetInput['assetType'], string> = {
  STOCK: '종목',
  INDEX: '지수',
  ETF: 'ETF',
}

export const PRICE_SOURCE_LABELS: Record<
  NonNullable<AssetPriceView['source']>,
  string
> = {
  AUTO: '자동',
  MANUAL: '수동',
}

/**
 * 무결성 결함 — ST-06이 「시세 없음」과 다른 문구를 요구한다. 두 결함도 서로
 * 달라야 한다: 고칠 곳이 기초자산 탭인지 평가조건 탭인지가 다르다.
 */
export const INTEGRITY_ISSUE_LABELS: Record<IntegrityIssue, string> = {
  UNDERLYING_MISSING: '기초자산 없음 — 수정 필요',
  SCHEDULE_MISSING: '평가일정 없음 — 수정 필요',
}

/**
 * 조치 사유 — DOC-008 §5 SCR-101의 표.
 *
 * 결함 두 값이 `INTEGRITY_ISSUE_LABELS`와 **같은 문자열**이다. DOC-008의 표가 두
 * 사유를 한 칸에 묶은 것은 **조치가 같다**(SCR-204로 유도)는 뜻이지 문구가 같다는
 * 뜻이 아니다 — 뭉뚱그리면 ST-06의 요구가 조치 목록에서만 깨진다.
 */
export const ATTENTION_REASON_LABELS: Record<AttentionReason, string> = {
  KI_NEAR: 'KI 근접',
  KI_BELOW: 'KI 배리어 하회 — 확인 필요',
  KI_TOUCHED: 'KI 터치',
  EVALUATION_PASSED: '평가일 경과',
  PRICE_MISSING: '시세 없음',
  UNDERLYING_MISSING: '기초자산 없음 — 수정 필요',
  SCHEDULE_MISSING: '평가일정 없음 — 수정 필요',
}

/**
 * 축 이름 → 라벨 표. **키가 DOC-005 §6.1의 `축` 열과 같아야 한다** — 문서 파싱
 * 대조가 그 이름으로 짝을 짓는다. 축이 늘어나면 문서에도 늘어야 실패하지 않는다.
 */
export const LABEL_AXES = {
  status: STATUS_LABELS,
  accountType: ACCOUNT_TYPE_LABELS,
  redemptionType: REDEMPTION_TYPE_LABELS,
  conditionResult: CONDITION_RESULT_LABELS,
  kiStatus: KI_STATUS_LABELS,
  kiObservation: KI_OBSERVATION_LABELS,
  assetType: ASSET_TYPE_LABELS,
  priceSource: PRICE_SOURCE_LABELS,
  integrityIssue: INTEGRITY_ISSUE_LABELS,
  attentionReason: ATTENTION_REASON_LABELS,
} as const satisfies Record<string, Record<string, string>>

/** 「시세 오래됨」 — DOC-005 §6 `isStale`. 열거형이 아니라 boolean이므로 따로 둔다. */
export const STALE_LABEL = '시세 오래됨'
