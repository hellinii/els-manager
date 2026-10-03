/**
 * 표시 형식 — 서버 컴포넌트와 클라이언트 컴포넌트가 함께 쓴다.
 *
 * **`lib/tax`·`lib/domain`에 두지 않은 이유**(DOC-010 §5): 그쪽에 넣는 것은 린트상
 * 합법이지만 계산과 표시 규칙이 섞여 TC-01~22의 경계가 흐려진다. `components/`에
 * 두면 서버 컴포넌트가 클라이언트 디렉터리를 import하게 된다. 어느 쪽도 아닌
 * 자리가 옳다.
 *
 * 이 모듈은 **오늘을 계산하지 않고**(ADR-003 · Q-02) **숫자로 강제 변환하지
 * 않는다**(Q-08). 둘 다 린트로 강제한다(컷 0d 규칙 1·2).
 */

export {
  amount,
  exchangeRateDisplay,
  koreanAmount,
  koreanWon,
  money,
  moneyAmount,
  signedMoney,
  signedWon,
  withCommas,
  won,
} from './money'
export { barrierGap, percent, percentPoint } from './ratio'
export {
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  EXCHANGE_RATE_MISSING_JOINER,
  EXCHANGE_RATE_SECTION_TEXT,
  EXCHANGE_RATE_STALE_LABEL,
  FOREIGN_FORECAST_DISCLAIMER,
  FOREIGN_TAX_ASSUMPTION_NOTE,
  REDEMPTION_KRW_TAXABLE_HINT,
  SETTINGS_FOREIGN_DISCLAIMER,
  convertedIncludedLine,
  convertedTaxLine,
  exchangeRateMissingLead,
  exchangeRateMissingNotice,
  forecastBasisLine,
  krwEstimateLine,
  projectionBasisLine,
  redemptionTaxableHint,
  type ExchangeRateBasisText,
  type ExchangeRateMissing,
} from './exchangeRate'
export { priceDisplay, refreshSummary } from './price'
export { dDayLabel, korDate, korMonth, monthKey, ymd } from './date'
export {
  ACCOUNT_TYPE_LABELS,
  ASSET_TYPE_LABELS,
  ATTENTION_REASON_LABELS,
  CONDITION_RESULT_LABELS,
  HEALTH_INSURANCE_TYPE_LABELS,
  INTEGRITY_ISSUE_LABELS,
  KI_OBSERVATION_LABELS,
  KI_STATUS_LABELS,
  LABEL_AXES,
  PRICE_SOURCE_LABELS,
  PRODUCT_CURRENCY_LABELS,
  COUPON_CONDITION_RESULT_LABELS,
  COUPON_OUTCOME_LABELS,
  COUPON_PAYOUT_LABELS,
  COUPON_STATE_LABELS,
  REDEMPTION_TYPE_LABELS,
  STALE_LABEL,
  STATUS_LABELS,
} from './labels'
export {
  ATTENTION_REASON_GRADES,
  CONDITION_RESULT_GRADES,
  COUPON_CONDITION_RESULT_GRADES,
  COUPON_STATE_GRADES,
  INTEGRITY_ISSUE_GRADES,
  KI_STATUS_GRADES,
  STALE_GRADE,
  STATUS_GRADES,
  type BadgeGrade,
} from './badges'
export { deriveDisplay, PRICE_MISSING_LABEL, type DisplayState } from './derived'
export {
  couponAmountShown,
  couponMonthLabel,
  couponSummaryOf,
  couponTaxableHint,
  monthlyRateLabel,
  recordAmountShown,
  UNNUMBERED_COUPON_LABEL,
} from './coupons'
export {
  kiTermLabel,
  lizardLabel,
  stepdownLabel,
  type LizardTerm,
} from './terms'
export {
  underlyingLines,
  type UnderlyingLine,
  type UnderlyingQuote,
  type UnderlyingTerm,
} from './underlyings'
export {
  groupByMonth,
  groupByProduct,
  mergeTimeline,
  productsWithoutRounds,
  splitByPast,
  taxBasisOf,
  type MonthGroup,
  type ProductGroup,
  type ScheduleProductFacts,
  type TimelineRow,
} from './schedule'
export { paginate, PRODUCTS_PER_PAGE, type Paged } from './page'
export { selectableYears } from './tax'
export { isForecastEmpty } from './forecast'
export {
  attentionChipLabel,
  groupAttention,
  hasFinancialIncomeToReport,
  heaviestGrade,
  isImminent,
  takeVisible,
  IMMINENT_DAYS,
  IMMINENT_LABEL,
  RECENT_VISIBLE,
  UPCOMING_VISIBLE,
  type AttentionGroup,
  type Visible,
} from './dashboard'
