import { describe, expect, it } from 'vitest'

import { attributionOf } from '@/lib/db/queries/attribution'

import { productRow, redemption, schedule } from './helpers/rows'

/**
 * 적용 차수·귀속연도의 단일 원천 — DOC-007 §7.2, RD-02 (AQ-25)
 *
 * 이 판정은 세 곳(`contributionOf`·`judge`·`projectionOf`)에 흩어져 있었고 **그 셋을
 * 직접 시험하는 케이스가 없었다** — 값은 뷰 매핑 테스트와 통합 스위트를 통해서만
 * 관측됐다. 한 함수로 모았으므로 세 `kind`와 「차수 없음」의 세 경우를 여기서 본다.
 *
 * **`year`가 `null`인 경우를 `kind`가 판별한다**는 것이 AQ-25의 종결 형태이므로,
 * 아래 케이스들은 `year`의 값만 보지 않고 **`kind`를 함께 단언한다** — 값만 보면
 * `null`의 원인이 다시 구분되지 않는다(`map.test.ts` 머리글의 ①과 같은 이유다).
 */

const ASOF = '2026-06-30'

describe('상환 완료 — REDEEMED', () => {
  it('상환일의 연도가 귀속연도다', () => {
    const a = attributionOf(
      productRow({ redemptions: redemption({ redemption_date: '2026-07-02' }) }),
      ASOF,
    )

    expect(a.kind).toBe('REDEEMED')
    expect(a.year).toBe(2026)
  })

  it('상환일이 기준일보다 미래여도 상환 완료다 — 적용 차수를 찾지 않는다', () => {
    // 상환 레코드의 존재가 판정 기준이다(§7.5 `redeemedBy`가 같은 기준을 쓴다).
    const a = attributionOf(
      productRow({ redemptions: redemption({ redemption_date: '2027-01-04' }) }),
      ASOF,
    )

    expect(a.kind).toBe('REDEEMED')
    expect(a.year).toBe(2027)
  })

  it('★ 만기 상환 + 일정 0건도 REDEEMED다 — 상환 분기가 일정 검사보다 먼저다', () => {
    // I-13 FK가 `MATCH SIMPLE`이라 `round_no IS NULL`인 만기 상환은 일정 행이 전부
    // 지워져도 ON DELETE RESTRICT에 걸리지 않는다. 즉 **상환 완료이면서
    // SCHEDULE_MISSING인 상품이 실재하며**, 순서가 뒤바뀌면 그 상품이 NO_ROUND가
    // 되어 과세 기여가 사라진다(증권사 확정값이 있는데도).
    const a = attributionOf(
      productRow({
        redemption_schedules: [],
        redemptions: redemption({ round_no: null, redemption_date: '2028-01-04' }),
      }),
      ASOF,
    )

    expect(a.kind).toBe('REDEEMED')
    expect(a.year).toBe(2028)
  })
})

describe('미상환 + 적용 차수 있음 — ESTIMATED', () => {
  it('다음 도래 평가일의 차수를 가정한다 (RD-02)', () => {
    const a = attributionOf(productRow(), ASOF)

    expect(a.kind).toBe('ESTIMATED')
    if (a.kind !== 'ESTIMATED') return
    expect(a.round.round_no).toBe(1)
    expect(a.round.evaluation_date).toBe('2026-07-02')
    expect(a.year).toBe(2026)
  })

  it('경과한 차수를 건너뛰고 귀속연도가 함께 옮겨간다', () => {
    // 1차(2026-07-02)가 지난 기준일 → 2차(2027-01-04)가 적용 차수다.
    const a = attributionOf(productRow(), '2026-08-01')

    expect(a.kind).toBe('ESTIMATED')
    if (a.kind !== 'ESTIMATED') return
    expect(a.round.round_no).toBe(2)
    expect(a.year).toBe(2027)
  })

  it('평가일 당일은 아직 도래한 것으로 본다', () => {
    const a = attributionOf(productRow(), '2026-07-02')

    expect(a.kind).toBe('ESTIMATED')
    if (a.kind !== 'ESTIMATED') return
    expect(a.round.round_no).toBe(1)
  })

  it('무결성 결함(시세)은 적용 차수에 영향을 주지 않는다 — 입력 기준(§4.2)', () => {
    // 기초자산 0건이어도 차수 입력은 온전하다. 여기서 끊으면 억제가 원인의 범위를
    // 넘고, 그 상품이 §4.6에서는 과세에 기여하면서 §4.3에서만 값을 잃는다.
    const a = attributionOf(productRow({ els_underlyings: [] }), ASOF)

    expect(a.kind).toBe('ESTIMATED')
    expect(a.year).toBe(2026)
  })
})

describe('적용 차수를 정할 수 없다 — NO_ROUND', () => {
  it('E-07 전 차수 경과 미상환 (DOC-007 §9.2)', () => {
    const a = attributionOf(productRow(), '2027-01-05')

    expect(a.kind).toBe('NO_ROUND')
    expect(a.year).toBeNull()
  })

  it('SCHEDULE_MISSING — 일정 0건', () => {
    const a = attributionOf(productRow({ redemption_schedules: [] }), ASOF)

    expect(a.kind).toBe('NO_ROUND')
    expect(a.year).toBeNull()
  })

  it('★ 두 원인이 같은 kind다 — 그것이 결정이며 원인은 다른 축이 말한다', () => {
    // 이 판정이 답하는 물음은 「적용 차수가 무엇인가」이고 두 경우의 답이 같다.
    // 원인을 알아야 하는 소비자는 `integrityIssue`와 `overdue`를 따로 읽는다 —
    // 여기서 가르면 세 번째 이름이 생겨 어느 것이 정본인지 알 수 없게 된다.
    const overdue = attributionOf(productRow(), '2027-01-05')
    const missing = attributionOf(productRow({ redemption_schedules: [] }), ASOF)

    expect(overdue).toEqual(missing)
  })
})

describe('차수 순서에 의존하지 않는다', () => {
  it('일정이 뒤섞여 있어도 평가일 기준으로 고른다', () => {
    const a = attributionOf(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 3, evaluation_date: '2027-07-05' }),
          schedule({ round_no: 1, evaluation_date: '2026-07-02' }),
          schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
        ],
      }),
      '2026-08-01',
    )

    expect(a.kind).toBe('ESTIMATED')
    if (a.kind !== 'ESTIMATED') return
    expect(a.round.round_no).toBe(2)
    expect(a.year).toBe(2027)
  })
})
