import { dec, truncateToUnit, type DecimalValue } from '@/lib/decimal'

import { productCurrencyOf } from './currency'
import { parseTenor } from './ladder'
import type { ProspectusTerms } from './prospectus-parse'
import { DISPLAY_SCALE } from './terms-endpoints'
import type {
  KiwoomProductTerms,
  KiwoomRound,
  TermsDiscrepancy,
  TermsDiscrepancyKind,
} from './terms-types'

/**
 * 팝업 조건의 **교차 대조** — 순수하다 — DOC-010 ADR-009 §4 둘째 방어선
 *
 * ## 왜 파서와 따로 있는가
 *
 * 파서(`terms-parse.ts`)는 「형식이 옳은가」를 본다. 이 모듈은 「**서로 맞는가**」를 본다 —
 * E03060은 팝업 표의 1·2차 상환조건이 85인데 헤더 사다리와 SEIBro는 88이고, 조기상환가격까지
 * 85로 계산되어 **표 안에서는 완벽히 일관된다.** 그 표를 받아 쓰면 조기상환 판정이 틀린다.
 * 같은 페이지 안의 두 번째 증인(사다리·헤드라인·기준가)으로만 잡힌다.
 *
 * 한계도 적어 둔다: **표와 사다리가 둘 다 틀리면 못 잡는다**(DOC-010 AQ-71 — SEIBro 대조는 연기).
 *
 * ## 결과는 판별값이다 — 문장이 아니다
 *
 * `{kind, severity, round?, asset?, expected, actual}`만 낸다. 사용자 문구는 폼 층이 용어 사전으로
 * 만든다. `BLOCKING`이 하나라도 있으면 폼 층이 채우지 않는다.
 *
 * ## ★ 「거부」의 대응표 — DOC-008 SCR-204
 *
 * 위 약속이 참이려면 그 화면의 거부 사유 중 **페이지만으로 판정되는 것이 전부** 여기 있어야
 * 한다. 불일치만 세면 월지급식 상품(EM2048)이 `BLOCKING` 0건으로 지나간다 — 형식은
 * 정상이고 값도 서로 맞는데 **불러와서는 안 되는** 상품이었다(컷 b5 전). 그래서 적격성도 같은 목록에 싣는다 —
 * 컷 b5부터 월지급식은 거부가 아니라 **전진 검사 일곱**이다(DOC-010 ADR-009 §8.3).
 * **달러는 P8 컷 a4부터 적격이다** — 상품 통화는 거부 사유가 아니라 채울 값이고, 거부는 증인이
 * 충돌하거나 원화·달러 밖일 때뿐이다(DOC-010 ADR-009 §7).
 *
 * | SCR-204 거부 사유 | 자리 |
 * |---|---|
 * | 빈 안내 화면 · ELS 아님 · 날짜 이상(증가·발행일·지급일) | 파서의 실패(`EMPTY`·`MALFORMED`·`BAD_DATE`) — `ok`가 아니다 |
 * | 만기 구획 없음 · K ≥ L(리자드) | `MATURITY_ABSENT` · `KI_NOT_BELOW_LIZARD` |
 * | 월지급식의 전진 검사 실패 *(P8 컷 b5)* | `MONTHLY_YIELD_NONZERO` · `MONTHLY_HEADLINE` · `MONTHLY_BARRIER_UNKNOWN` · `MONTHLY_BARRIER_ORDER` · `MONTHLY_VARIANT` · `MONTHLY_LIZARD` · `MONTHLY_WITNESS_CONFLICT` |
 * | 투자설명서 ↔ 안내 화면의 불일치 *(P8 컷 b5′ — 읽었을 때만)* | `PROSPECTUS_COUPON_COUNT` · `PROSPECTUS_COUPON_ORDER` · `PROSPECTUS_COUPON_ANCHOR` · `PROSPECTUS_RATE` · `PROSPECTUS_EARLY_DATE` · `MONTHLY_VARIANT`(`PROSPECTUS`) |
 * | 상품 통화 — 증인 충돌 · 원화·달러 밖 *(P8 컷 a4)* | `CURRENCY_CONFLICT` · `CURRENCY_UNSUPPORTED` — 판정은 `currency.ts` |
 * | 사다리를 못 읽음 · 표 ≠ 사다리 | `LADDER_STEPS_ABSENT` · `LADDER_STEP_COUNT` · `LADDER_BARRIER` · `LIZARD_POSITION` |
 * | 가격 ≠ 기준가 × 배리어 · KI 비율 불일치 | `BARRIER_PRICE` · `KI_PRICE` · `KI_PCT_UNKNOWN` · `KI_CONFLICT` |
 * | 누적 수익률이 연율과 선형이 아님 | `CUMULATIVE_YIELD` · `LIZARD_MULTIPLE` · `HEADLINE_UNKNOWN` · `PERIOD_UNKNOWN` · `TENOR` |
 * | 날짜 이상(앱 산식에서 10일 초과) | **사상 층** — 앱의 평가일 산식이 필요하다. 이 모듈이 `lib/forms`를 import하지 않는다 |
 *
 * ## ★ 비교는 «앞 방향»이고 «절사»다 (`terms-endpoints.ts` `DISPLAY_SCALE`)
 *
 * 표시값에서 거꾸로 나누지 않는다. 정확값 `x`(기준가 × 비율 · 연율 × 개월/12)를 계산하고
 * 표시 스케일로 **절사한 값이 표시값과 같은지**를 본다 — 곧 `0 ≤ x − 표시 < 1단위`다.
 *
 * - 가격: 4자리 절사. EM1039 엔비디아 85.905 × 0.75 = 64.42875 → `64.4287`이 통과하고, 반올림
 *   규칙(`64.4288`)이었다면 **거부**됐을 것이다 — 그것이 이 규칙의 측정 근거다
 * - 누적 수익률: 2자리 절사. 거꾸로 나누면 안 되는 이유: 연 24.25% · 6개월이면 정확값 12.125가
 *   `12.13`으로 표시될 수 있는데 `12.13 × 2 = 24.26 ≠ 24.25`라 **맞는 상품이 거부**된다
 *
 * 허용폭을 넓히지 않는다. 한 단위 미만의 차이만 표시 규약으로 설명되고, 그 이상은 값이 다르다.
 */
export function crossCheckTerms(terms: KiwoomProductTerms): TermsDiscrepancy[] {
  const out: TermsDiscrepancy[] = []
  const add = (
    kind: TermsDiscrepancyKind,
    severity: TermsDiscrepancy['severity'],
    expected: string | null,
    actual: string | null,
    where: { round?: string; asset?: string } = {},
  ) => out.push({ kind, severity, ...where, expected, actual })

  const issued = terms.status === 'ISSUED'
  const ladder = terms.ladder
  const distinct = terms.rounds.filter((r) => r.variant !== 2)

  /* ---------------- 헤더 자산 ↔ 표 자산 (⑪: 이름은 다를 수 있다, 개수는 다를 수 없다) */
  const headerNames = terms.header.underlyingNames
  if (headerNames.length !== terms.assets.length) {
    add('HEADER_ASSET_COUNT', 'BLOCKING', String(headerNames.length), String(terms.assets.length))
  } else {
    headerNames.forEach((h, i) => {
      const name = terms.assets[i]!.name
      if (h !== name) add('HEADER_ASSET_NAME', 'NOTE', h, name, { asset: name })
    })
  }

  /* ---------------- 사다리 계단 ↔ 표의 상환조건 (E03060) */
  const steps = ladder.steps
  // 청약 중에는 차수 행이 없으므로 계단 수를 표로 셀 수 없다 — 계단 자신이 총 기간 수다
  const periodsTotal = issued ? distinct.length + 1 : (steps?.length ?? null)
  if (steps == null) {
    add('LADDER_STEPS_ABSENT', 'BLOCKING', null, terms.header.ladderText)
  } else if (issued && steps.length !== distinct.length + 1) {
    add('LADDER_STEP_COUNT', 'BLOCKING', String(steps.length), String(distinct.length + 1))
  } else {
    distinct.forEach((r, i) => {
      const step = steps[i]!
      if (!same(step.barrierPct, r.barrierPct)) {
        add('LADDER_BARRIER', 'BLOCKING', step.barrierPct, r.barrierPct, { round: r.label })
      }
      checkLizardPosition(r, step.lizardPct)
    })
    const last = steps[steps.length - 1]!
    if (terms.maturity != null && !same(last.barrierPct, terms.maturity.barrierPct)) {
      add('LADDER_BARRIER', 'BLOCKING', last.barrierPct, terms.maturity.barrierPct, { round: 'MATURITY' })
    }
  }
  if (terms.maturity == null) add('MATURITY_ABSENT', 'BLOCKING', null, null)

  function checkLizardPosition(round: KiwoomRound, lizardPct: string | null) {
    const lizard = terms.rounds.find((r) => r.round === round.round && r.variant === 2)
    const label = `${round.round}-2`
    if (lizardPct != null && lizard == null) {
      add('LIZARD_POSITION', 'BLOCKING', lizardPct, null, { round: label })
    } else if (lizardPct == null && lizard != null) {
      add('LIZARD_POSITION', 'BLOCKING', null, lizard.barrierPct, { round: label })
    } else if (lizardPct != null && lizard != null && !same(lizardPct, lizard.barrierPct)) {
      add('LIZARD_POSITION', 'BLOCKING', lizardPct, lizard.barrierPct, { round: label })
    }
  }

  /* ---------------- 월지급식 — 판정과 전진 검사 (DOC-010 ADR-009 §8.2 · §8.3 — P8 컷 b5) */
  const listing = terms.listing
  const monthly = isMonthlyTerms(terms)
  // 증인 둘이 다르면 거부한다 — 다수결을 하지 않는다(§7의 통화와 같다). 목록 행이 없으면(최선 노력) 팝업 하나다
  // 충돌이면 전진 검사를 쌓지 않는다 — 어느 증인이 옳은지 모르는 채 월지급식의 검사를 돌리면 사유가 여럿으로 읽힌다
  if (listing != null && ladder.monthly !== listing.monthlyPay) {
    add('MONTHLY_WITNESS_CONFLICT', 'BLOCKING', yesNo(ladder.monthly), yesNo(listing.monthlyPay))
  } else if (monthly) {
    checkMonthly()
  }

  function checkMonthly() {
    // ① 상환은 원금만이다(⑨ · V-29) — 수익률이 있는 차수 · 만기가 하나라도 있으면 상환 쿠폰이 함께 있는 상품이다
    const yields = [
      ...terms.rounds.map((r) => ({ label: r.label, pct: r.cumulativeYieldPct })),
      ...(terms.maturity == null ? [] : [{ label: 'MATURITY', pct: terms.maturity.cumulativeYieldPct }]),
    ]
    for (const y of yields) {
      if (!dec(y.pct).isZero()) add('MONTHLY_YIELD_NONZERO', 'BLOCKING', '0', y.pct, { round: y.label })
    }
    // ② 헤드라인 = 월 지급률 × 12 — 월 지급률은 퍼센트 소수 둘째 자리로 적힌다(「1.97%」 — 실측 3/3)
    const headline = terms.header.headlineAnnualPct
    if (headline == null || !monthlyPctOf(headline)) {
      add('MONTHLY_HEADLINE', 'BLOCKING', null, headline ?? terms.header.headlineText)
    }
    // ③ · ④ 월지급 배리어 C — 하나여야 하고 KI < C ≤ min B
    const coupon = ladder.monthlyBarrierPct
    if (coupon == null) {
      add('MONTHLY_BARRIER_UNKNOWN', 'BLOCKING', null, terms.header.ladderText)
    } else {
      // 발행 뒤에는 표가 정본이다(사다리와는 위에서 대조했다). 청약 중에는 표가 없으므로 계단이다
      const barriers = issued
        ? [...distinct.map((r) => r.barrierPct), ...(terms.maturity == null ? [] : [terms.maturity.barrierPct])]
        : (steps?.map((step) => step.barrierPct) ?? [])
      const minBarrier = barriers.reduce<string | null>(
        (low, pct) => (low == null || dec(pct).lt(dec(low)) ? pct : low),
        null,
      )
      // KI 비율을 모르면 KI_PCT_UNKNOWN이 이미 막았다 — 여기서 같은 사실을 두 번 말하지 않는다
      const kiBelow = ladder.noKi || ladder.kiPct == null || dec(ladder.kiPct).lt(dec(coupon))
      const underBarrier = minBarrier == null || dec(coupon).lte(dec(minBarrier))
      if (!kiBelow || !underBarrier) add('MONTHLY_BARRIER_ORDER', 'BLOCKING', terms.header.ladderText, coupon)
    }
    // ⑤ 기본형만 — 범위는 팝업 머리의 세 자리뿐이다(ADR-009 ㉑ · 투자설명서의 구간은 컷 b5′)
    const places = [
      ['NAME', terms.name],
      ['HEADLINE', terms.header.headlineText ?? ''],
      ['LADDER', terms.header.ladderText],
    ] as const
    for (const [place, text] of places) {
      for (const word of MONTHLY_VARIANT_WORDS) {
        if (text.includes(word)) add('MONTHLY_VARIANT', 'BLOCKING', place, word)
      }
    }
    // ⑥ 월지급식 + 리자드는 v2다(V-25) — 사다리의 낱말 · 계단의 `(Lxx)` · 표의 `n-2` 행 중 하나라도
    if (ladder.lizard || terms.rounds.some((r) => r.variant === 2) || steps?.some((step) => step.lizardPct != null)) {
      add('MONTHLY_LIZARD', 'BLOCKING', null, null)
    }
    // 투자설명서 — 읽었으면 안내 화면과 전부 맞아야 한다(ADR-009 §8.4). 못 읽었으면 대조할 것이 없다(산식 폴백)
    if (terms.prospectus?.kind === 'READ') checkProspectus(terms.prospectus)
  }

  function checkProspectus(p: ProspectusTerms) {
    const period = ladder.periodMonths ?? parseTenor(terms.header.tenorText).periodMonths
    // 청약 중 · 주기 미상 · 만기 구획 없음은 다른 사유가 이미 거부한다 — 회차를 셀 기준이 없다
    if (issued && period != null && terms.maturity != null) {
      const total = period * (distinct.length + 1)
      const numbered = p.coupons.every((c, i) => c.couponNo === i + 1)
      if (p.declaredCount !== total || p.coupons.length !== total || !numbered) {
        add('PROSPECTUS_COUPON_COUNT', 'BLOCKING', String(total), `${p.declaredCount}/${p.coupons.length}`)
      } else {
        let previous: string | null = null
        for (const c of p.coupons) {
          if (c.evaluationDate < terms.header.issueDate || (previous != null && c.evaluationDate <= previous)) {
            add('PROSPECTUS_COUPON_ORDER', 'BLOCKING', previous ?? terms.header.issueDate, c.evaluationDate, {
              round: String(c.couponNo),
            })
          }
          previous = c.evaluationDate
        }
        // 겹치는 달 — r차 조기상환은 (주기 × r)번째, 만기는 K번째다(RD-20 실측 — 25/25 · 5/5)
        const anchors = [
          ...distinct.map((r, i) => ({ couponNo: period * (i + 1), date: r.evaluationDate })),
          { couponNo: total, date: terms.maturity.evaluationDates.at(-1) ?? '' },
        ]
        for (const anchor of anchors) {
          const found = p.coupons[anchor.couponNo - 1]!.evaluationDate
          if (found !== anchor.date) {
            add('PROSPECTUS_COUPON_ANCHOR', 'BLOCKING', anchor.date, found, { round: String(anchor.couponNo) })
          }
        }
      }
      const early = distinct.map((r) => r.evaluationDate)
      if (p.earlyRedemptionDates.length !== early.length) {
        add('PROSPECTUS_EARLY_DATE', 'BLOCKING', String(early.length), String(p.earlyRedemptionDates.length), {
          round: 'COUNT',
        })
      } else {
        early.forEach((date, i) => {
          if (p.earlyRedemptionDates[i] !== date) {
            add('PROSPECTUS_EARLY_DATE', 'BLOCKING', date, p.earlyRedemptionDates[i]!, { round: distinct[i]!.label })
          }
        })
      }
    }
    // 지급금액 — 월 지급률 × 12 = 연율 = 헤드라인(실측 5/5). 헤드라인이 없으면 `MONTHLY_HEADLINE`이 이미 거부했다
    const headline = terms.header.headlineAnnualPct
    if (p.monthlyPct == null || p.annualPct == null) {
      add('PROSPECTUS_RATE', 'BLOCKING', headline, null, { round: 'ABSENT' })
    } else if (!dec(p.monthlyPct).times(12).eq(dec(p.annualPct))) {
      add('PROSPECTUS_RATE', 'BLOCKING', dec(p.monthlyPct).times(12).toString(), p.annualPct, { round: 'MONTHLY' })
    } else if (headline != null && !dec(p.annualPct).eq(dec(headline))) {
      add('PROSPECTUS_RATE', 'BLOCKING', headline, p.annualPct, { round: 'HEADLINE' })
    }
    // 변형 낱말 — 「월수익 지급」 구간만(ADR-009 ㉑ — 문서 전체에는 마이크론의 「메모리」가 있다)
    for (const word of MONTHLY_VARIANT_WORDS) {
      if (p.couponSection.includes(word)) add('MONTHLY_VARIANT', 'BLOCKING', 'PROSPECTUS', word)
    }
  }

  /* ---------------- 상품 통화 — 판정은 `productCurrencyOf` 하나다(ADR-009 §7). 증인 없음은 거부가 아니다 */
  const currency = productCurrencyOf({ popup: terms, listing })
  if (currency.kind === 'CONFLICT') {
    add('CURRENCY_CONFLICT', 'BLOCKING', null, [...new Set(currency.claims.map((c) => c.currency))].join('·'))
  } else if (currency.kind === 'UNSUPPORTED') {
    add('CURRENCY_UNSUPPORTED', 'BLOCKING', 'KRW·USD', currency.currency)
  }

  /* ---------------- KI < 리자드 (DQ-09 — 이 포함 관계가 `lizard_requires_no_ki`를 켜는 근거다) */
  if (ladder.kiPct != null && !ladder.noKi && !ladder.kiConflict) {
    const kiPct = ladder.kiPct
    const seen = new Set<string>()
    const lizards = [
      // 청약 중에는 표가 없으므로 계단의 `(Lxx)`가 유일한 증인이다
      ...steps?.flatMap((s, i) => (s.lizardPct == null ? [] : [{ label: `${i + 1}-2`, pct: s.lizardPct }])) ?? [],
      ...terms.rounds.filter((r) => r.variant === 2).map((r) => ({ label: r.label, pct: r.barrierPct })),
    ]
    for (const { label, pct } of lizards) {
      const key = `${label}|${dec(pct).toString()}`
      if (seen.has(key)) continue
      seen.add(key)
      if (dec(kiPct).gte(dec(pct))) add('KI_NOT_BELOW_LIZARD', 'BLOCKING', pct, kiPct, { round: label })
    }
  }

  /* ---------------- KI 가격 ↔ 기준가 × KI 비율 */
  if (ladder.kiConflict) {
    add('KI_CONFLICT', 'BLOCKING', null, terms.header.ladderText)
  } else if (ladder.noKi) {
    for (const a of terms.assets) {
      if (a.kiPrice != null) add('KI_PRICE', 'BLOCKING', null, a.kiPrice, { asset: a.name })
    }
  } else if (ladder.kiPct == null) {
    // 맨 `KI`(비율 없음)·표기 없음 — 조용히 건너뛰지 않는다. 표의 KI 가격에 두 번째 증인이 없다
    add('KI_PCT_UNKNOWN', 'BLOCKING', null, terms.header.ladderText)
  } else if (issued) {
    for (const a of terms.assets) {
      const expected = shownPrice(dec(a.basePrice!).times(ladder.kiPct).div(100))
      if (a.kiPrice == null || !same(expected, a.kiPrice)) {
        add('KI_PRICE', 'BLOCKING', expected, a.kiPrice, { asset: a.name })
      }
    }
  }

  /* ---------------- 배리어 가격 ↔ 기준가 × 상환조건 */
  if (issued) {
    const priced: { label: string; barrierPct: string; prices: readonly (string | null)[] }[] = [
      ...terms.rounds.map((r) => ({ label: r.label, barrierPct: r.barrierPct, prices: r.barrierPrices })),
      ...(terms.maturity == null
        ? []
        : [{ label: 'MATURITY', barrierPct: terms.maturity.barrierPct, prices: terms.maturity.barrierPrices }]),
    ]
    for (const row of priced) {
      terms.assets.forEach((a, i) => {
        const expected = shownPrice(dec(a.basePrice!).times(row.barrierPct).div(100))
        const actual = row.prices[i] ?? null
        if (actual == null || !same(expected, actual)) {
          add('BARRIER_PRICE', 'BLOCKING', expected, actual, { round: row.label, asset: a.name })
        }
      })
    }
  }

  /* ---------------- 누적 수익률 ↔ 연 수익률 × 경과 개월 / 12 (앞 방향) */
  const tenorFromHeader = parseTenor(terms.header.tenorText)
  const period = ladder.periodMonths ?? tenorFromHeader.periodMonths
  const tenor = ladder.tenorMonths ?? tenorFromHeader.tenorMonths

  if (period != null && tenor != null && periodsTotal != null && tenor !== period * periodsTotal) {
    add('TENOR', 'BLOCKING', String(period * periodsTotal), String(tenor))
  }

  // ⑨ 월지급식은 차수별 수익률이 전부 0이다 — 쿠폰은 투자설명서에만 있다. 위 전진 검사 ①이 그 표를 보므로
  // 0 대 헤드라인의 불일치를 쌓지 않는다(헤드라인은 월 지급률의 12배이지 상환 쿠폰이 아니다)
  if (!monthly) {
    const headline = terms.header.headlineAnnualPct
    if (headline == null) add('HEADLINE_UNKNOWN', 'BLOCKING', null, terms.header.headlineText)
    if (period == null) add('PERIOD_UNKNOWN', 'BLOCKING', null, terms.header.tenorText)

    if (headline != null && period != null) {
      const accrued = (months: number) => dec(headline).times(months).div(12)
      for (const r of terms.rounds) {
        const base = accrued(period * r.round)
        if (r.variant === 2) {
          if (ladder.lizardMultiple == null) {
            // EM1039 `리자드형` · E04100 — 배수가 없고 표의 값만 있다. 측정된 둘은 1배였다
            add('LIZARD_MULTIPLE_UNSTATED', 'NOTE', null, r.cumulativeYieldPct, { round: r.label })
            continue
          }
          const expected = shownPct(base.times(ladder.lizardMultiple))
          if (!same(expected, r.cumulativeYieldPct)) {
            add('LIZARD_MULTIPLE', 'BLOCKING', expected, r.cumulativeYieldPct, { round: r.label })
          }
          continue
        }
        const expected = shownPct(base)
        if (!same(expected, r.cumulativeYieldPct)) {
          add('CUMULATIVE_YIELD', 'BLOCKING', expected, r.cumulativeYieldPct, { round: r.label })
        }
      }
      const months = tenor ?? (periodsTotal == null ? null : period * periodsTotal)
      if (terms.maturity != null && months != null) {
        const expected = shownPct(accrued(months))
        if (!same(expected, terms.maturity.cumulativeYieldPct)) {
          add('CUMULATIVE_YIELD', 'BLOCKING', expected, terms.maturity.cumulativeYieldPct, { round: 'MATURITY' })
        }
      }
    }
  }

  /* ---------------- 만기 지급일 · 목록 행 (NOTE 위주) */
  if (terms.maturity != null && terms.maturity.paymentDate !== terms.header.maturityDate) {
    add('MATURITY_PAYMENT_DATE', 'NOTE', terms.header.maturityDate, terms.maturity.paymentDate, {
      round: 'MATURITY',
    })
  }
  if (listing != null) {
    if (listing.issueDate !== terms.header.issueDate) {
      add('LISTING_ISSUE_DATE', 'BLOCKING', terms.header.issueDate, listing.issueDate)
    }
    if (listing.maturityDate !== terms.header.maturityDate) {
      add('LISTING_MATURITY_DATE', 'BLOCKING', terms.header.maturityDate, listing.maturityDate)
    }
    if (squash(listing.ladderText) !== squash(terms.header.ladderText)) {
      // ⑩ EM2048: 목록 `…) KI` · 팝업 `…) KI25`. 팝업이 정본이다
      add('LISTING_LADDER_TEXT', 'NOTE', terms.header.ladderText, listing.ladderText)
    }
  }

  return out
}

/**
 * 월지급식인가 — 증인 둘(팝업 사다리의 `월지급` · 목록 행의 `mm_pay_frml_yn`) 중 하나라도 말하면 (ADR-009 §8.2).
 *
 * **대조와 채움이 같은 함수를 부른다** — `importFill.ts`가 다시 판정하면 한쪽만 고쳐지는 날이 온다(`productCurrencyOf`와
 * 같은 판단). 둘이 다르면 위 대조가 `MONTHLY_WITNESS_CONFLICT`로 거부하므로 채움에 닿는 상품에서는 둘이 같다.
 * 「월지급 표기가 없음」은 상환 시 지급의 증언이 아니다 — 그 증언은 누적 수익률의 선형성(`CUMULATIVE_YIELD`가 통과)이다
 */
export function isMonthlyTerms(terms: Pick<KiwoomProductTerms, 'ladder' | 'listing'>): boolean {
  return terms.ladder.monthly || terms.listing?.monthlyPay === true
}

/** 변형의 낱말 — 기본형만 받는다(DOC-001 S-14 · ADR-009 §8.3). 이름을 만들지 않고 원천의 낱말을 찾는다 */
export const MONTHLY_VARIANT_WORDS = ['누적', '메모리', '지급중단'] as const

/**
 * 헤드라인 → 월 지급률(퍼센트) — 소수 둘째 자리에서 끝날 때만. 끝나지 않으면 `null`이다(헤드라인이 월 지급률의 12배가
 * 아니다). 채움(`importFill.ts`)이 월수익 연쿠폰율의 출처를 판정할 때도 이 함수다
 */
export function monthlyPctOf(headlinePct: string): string | null {
  const monthly = dec(headlinePct).div(12)
  return truncateToUnit(monthly, PCT_UNIT).eq(monthly) ? monthly.toString() : null
}

function yesNo(value: boolean): 'Y' | 'N' {
  return value ? 'Y' : 'N'
}

/** 표시 스케일 한 단위 — `10^−scale`을 **문자열로** 만든다(`10 ** n`은 number 연산이다) */
function unitOf(scale: number): string {
  return scale === 0 ? '1' : `0.${'0'.repeat(scale - 1)}1`
}

const PRICE_UNIT = unitOf(DISPLAY_SCALE.price)
const PCT_UNIT = unitOf(DISPLAY_SCALE.percent)

/** 키움이 보여 줄 가격 — 4자리 절사 */
function shownPrice(exact: DecimalValue): string {
  return truncateToUnit(exact, PRICE_UNIT).toString()
}

/** 키움이 보여 줄 누적 수익률 — 2자리 절사 */
function shownPct(exact: DecimalValue): string {
  return truncateToUnit(exact, PCT_UNIT).toString()
}

/** 값으로 비교한다 — `'32.1'`과 `'32.10'`은 같다(뒤 0 제거, ⑧) */
function same(a: string, b: string): boolean {
  return dec(a).eq(dec(b))
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
