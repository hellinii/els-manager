import { describe, expect, it } from 'vitest'

import type { RedemptionInput } from '@/lib/db/mutations/types'
import { toProductDetailView } from '@/lib/db/queries/map'
import { dec } from '@/lib/decimal'
import { shiftDays } from '@/lib/domain'
import { parseRedemptionForm, parseTouchedAtForm } from '@/lib/forms/parse'
import {
  REDEMPTION_DATE_OFFSET_DAYS,
  REDEMPTION_FIELDS,
  redemptionDefaults,
  redemptionValuesOf,
  roundFillOf,
  roundOptionsOf,
  taxableIncomeLocked,
} from '@/lib/forms/redemption'

import { ASSET_1, OWNER, priceMap, productRow, redemption, schedule } from '../db/helpers/rows'

/**
 * SCR-203 상환 폼의 순수 부분 — **기본값이 틀리면 사용자가 그것을 저장한다** (P4 컷 6)
 *
 * ## 왜 자동 채움을 테스트하는가
 *
 * DOC-008은 「조건 판정 결과에 따라 유형·차수·예상 수령액을 자동 채움」을 요구한다.
 * 상환 실적은 §4.6 연도별 집계의 입력이므로 **틀린 기본값 하나가 그 해의 세액을
 * 바꾼다** — 그리고 사용자는 화면이 채운 값을 확정값으로 읽는다(ST-05가 추정과 확정을
 * 구분하라고 요구한 것이 정확히 그 위험이다).
 *
 * ## 뷰를 손으로 쓰지 않는다
 *
 * `toProductDetailView`를 지나게 한다 — `projection`이 실제로 어떤 조건에서 `null`이
 * 되는지(§4.3의 두 경우)가 매퍼의 성질이고, 뷰를 리터럴로 적으면 그 성질과 무관한
 * 픽스처를 검증하게 된다.
 */

const ASOF = '2026-06-30'

/** 기준일에 1차(2026-07-02)가 미래다 → 적용 차수 1. 시세 120 / 기준가 100 = 1.2 */
function viewWith(price: string | null, asOf = ASOF) {
  return toProductDetailView(
    productRow({
      redemption_schedules: [
        schedule({ round_no: 1, evaluation_date: '2026-07-02', barrier: '0.9000' }),
        schedule({
          round_no: 2,
          evaluation_date: '2027-01-04',
          barrier: '0.8500',
          lizard_barrier: '0.6000',
          lizard_coupon_rate: '0.0300',
        }),
      ],
    }),
    priceMap([{ assetId: ASSET_1, price }]),
    asOf,
    OWNER,
  )
}

function formOf(values: Record<string, string>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(values)) form.append(name, value)
  return form
}

describe('차수 선택지', () => {
  it('리자드 조건이 있는 차수를 표시한다 — V-14가 그것을 요구한다', () => {
    /*
     * 리자드 상환은 **그 차수에 리자드 조건이 정의되어 있어야** 한다. 화면이 그 사실을
     * 보여주지 않으면 사용자가 조건 없는 차수를 고르고, 오류를 받은 뒤에야 어느 차수를
     * 골라야 하는지 알게 된다.
     */
    expect(roundOptionsOf(viewWith('120.000000'))).toEqual([
      {
        roundNo: 1,
        evaluationDate: '2026-07-02',
        hasLizard: false,
        // P=1억 · r=8% · m=6 → 1차 = 1억 × (1 + 0.08 × 6/12)
        early: { grossAmount: '104000000', taxableIncome: '4000000' },
        lizard: null,
      },
      {
        roundNo: 2,
        evaluationDate: '2027-01-04',
        hasLizard: true,
        early: { grossAmount: '108000000', taxableIncome: '8000000' },
        // 리자드 쿠폰율 3% — 같은 차수인데 500만원 작다
        lizard: { grossAmount: '103000000', taxableIncome: '3000000' },
      },
    ])
  })

  it('조기상환 가정의 세전이 차수별 표의 값과 «일치한다»', () => {
    /*
     * 상세 화면의 차수별 표가 `schedules[].expectedGross`를 렌더하므로 두 값이
     * 갈리면 한 차수가 두 금액으로 보인다. 이 케이스는 그 **일치**를 지키는
     * 회귀 가드다.
     *
     * ★ **「재사용임」을 증명하지는 «못한다» (실측).** `grossExpected`를 다시 부르는
     * 구현으로 바꿔도 이 케이스는 초록이다 — 같은 입력에 같은 `amountString`을
     * 지나므로 값이 같기 때문이다(음성 대조 ⑤). 즉 구현 선택(재사용)의 근거는
     * 테스트가 아니라 **주석**에 있고, 이 케이스가 지키는 것은 「두 경로가 갈리지
     * 않는다」뿐이다. 그 구분을 적어 두지 않으면 다음 사람이 이 초록을 재사용의
     * 증거로 읽는다.
     */
    const view = viewWith('120.000000')
    const options = roundOptionsOf(view)

    for (const [index, option] of options.entries()) {
      expect(option.early?.grossAmount ?? null).toBe(view.schedules[index]!.expectedGross)
    }
  })

  it('★ 적용 차수의 추정값이 `projection`과 «글자까지» 같다', () => {
    /*
     * ★ **이것이 이 파일의 핵심 대조다.** 두 산출이 반올림 «순서»가 다르다 —
     * `projectionOf`는 반올림 **전** 값에서 원금을 빼고, `amountsOf`는 이미 반올림된
     * `expectedGross`에서 뺀다. 오늘 같은 값이 나오는 이유는 `principal`이
     * `numeric(15,0)`(정수)이라 `round(g) − P = round(g − P)`이기 때문인데, 그것은
     * **스키마의 성질이지 계약이 아니다.** 고정하지 않으면 조용히 갈린다.
     */
    const view = viewWith('120.000000')
    const applied = view.projection!
    const option = roundOptionsOf(view).find((r) => r.roundNo === applied.appliedRoundNo)!

    expect(option.early!.grossAmount).toBe(applied.expectedGross)
    expect(option.early!.taxableIncome).toBe(applied.expectedTaxableIncome)
  })

  it('★ 금액이 저장 축과 «같은 형식»이다 — V-19·V-11의 `/^\\d+$/`', () => {
    // `numeric(15,0)`이고 계약이 쉼표·소수·부호를 거부한다. 화면이 채우는 값이
    // 저장할 수 없는 모양이면 사용자는 「고치지 않았는데 거부됐다」를 본다.
    for (const option of roundOptionsOf(viewWith('120.000000'))) {
      for (const amounts of [option.early, option.lizard]) {
        if (amounts == null) continue
        expect(amounts.grossAmount).toMatch(/^\d+$/)
        expect(amounts.taxableIncome).toMatch(/^\d+$/)
      }
    }
  })

  it('비과세 계좌는 전 차수·전 가정의 과세 금융소득이 0이다 — DOC-007 §4.3', () => {
    const view = toProductDetailView(
      productRow({
        account_type: 'TAX_FREE',
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-07-02', barrier: '0.9000' }),
          schedule({
            round_no: 2,
            evaluation_date: '2027-01-04',
            barrier: '0.8500',
            lizard_barrier: '0.6000',
            lizard_coupon_rate: '0.0300',
          }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      ASOF,
      OWNER,
    )

    for (const option of roundOptionsOf(view)) {
      expect(option.early!.taxableIncome).toBe('0')
      // 세전은 계좌구분과 무관하다 — 과세 축만 0이다
      expect(option.early!.grossAmount).not.toBe('0')
    }
    expect(roundOptionsOf(view)[1]!.lizard!.taxableIncome).toBe('0')
  })

  it('연쿠폰율이 없으면 두 가정이 «함께» 비어 있다 — 값을 비운 추정을 만들지 않는다', () => {
    /*
     * D-07 기실현 등재는 계약 조건이 없다. 차수가 0건이라 계약 경로로는 도달하지
     * 않지만 수동 SQL이 그 상태를 만들 수 있다(AQ-14·AQ-65와 같은 자리).
     * 그때 「세전은 없는데 과세소득은 있다」가 되면 화면이 0원을 금액으로 읽는다.
     */
    const view = toProductDetailView(
      productRow({
        entry_mode: 'REALIZED_ONLY',
        annual_coupon_rate: null,
        redemption_schedules: [
          schedule({
            round_no: 1,
            evaluation_date: '2026-07-02',
            barrier: '0.9000',
            lizard_barrier: '0.6000',
            lizard_coupon_rate: '0.0300',
          }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      ASOF,
      OWNER,
    )

    const option = roundOptionsOf(view)[0]!
    expect(option.early).toBeNull()
    // 리자드 쿠폰율은 «있는데»도 비운다 — 그 상품에서는 의미가 없다
    expect(option.lizard).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 차수를 고치면 다시 채운다 (DOC-008 §5 v2.7)
// ---------------------------------------------------------------------------

/**
 * ★ **적용 차수는 «다음 도래» 차수다** — 이 describe의 존재 이유
 *
 * DOC-007 RD-02가 적용 차수를 「다음 도래 평가일의 차수」로 정하므로, 평가가 일어난 뒤
 * 상환을 기록하러 온 사용자에게 폼은 **이미 다음 차수**를 가리킨다. 차수를 옳게 고쳐도
 * 금액이 따라오지 않으면 **「차수 2 / 1차의 금액」**이 저장되고 그 행은 §4.6 집계의
 * 입력이다. 즉 이 함수는 편의가 아니라 **모순된 행을 만들기 가장 쉬운 경로**를 막는다.
 *
 * ## 음성 대조 5건 — 실측이다. **다섯째는 «초록»이었고 그것이 기록의 요점이다**
 *
 * 대상 코드를 깨뜨려 실제로 세었다(원복 후 40건 초록 확인).
 *
 * | 되돌린 것 | 실패한 케이스 |
 * |---|---|
 * | `MATURITY_LOSS` 가드 제거 | **1건** |
 * | `LIZARD` 분기를 `round.early`로 | **4건** — 리자드 값 · 리자드가 더 작다 · 리자드 없는 차수 · 리자드 판정의 초기값 |
 * | `amountsOf`의 `accountType`을 `'GENERAL'` 고정 | **1건** — 비과세 계좌 |
 * | `REDEMPTION_DATE_OFFSET_DAYS`를 `0`으로 | **3건** — 상환일 · 경계 · 「초기값과 다르다」 |
 * | **`early`를 `grossExpected` 재호출로 교체** | **0건 — 판별하지 못한다** |
 *
 * ★ **다섯째 줄이 이 표에서 가장 중요하다.** 「조회가 낸 값을 그대로 쓴다」는 구현
 * 선택은 **어떤 케이스도 강제하지 않는다** — 재계산해도 같은 입력에 같은
 * `amountString`을 지나 값이 같기 때문이다. 그러므로 그 선택의 근거는 테스트가 아니라
 * 주석이며, 위 「일치한다」 케이스를 **재사용의 증거로 읽으면 안 된다.** 세는 것과
 * 가르는 것은 다르다.
 *
 * 넷째 줄이 「상환일만은 차수에서 파생하지 않는다」의 대조점이다 — 그 상수가 0이면
 * `redemptionDefaults`의 상환일(기준일)과 우연히 같아질 수 있는 픽스처가 생긴다.
 */
describe('차수를 고치면 다시 채운다 — roundFillOf', () => {
  const ROUNDS = roundOptionsOf(viewWith('120.000000'))

  it('상환일이 그 차수의 평가일 + 5일이다', () => {
    expect(roundFillOf(ROUNDS, '1', 'EARLY')!.redemptionDate).toBe('2026-07-07')
    expect(roundFillOf(ROUNDS, '2', 'EARLY')!.redemptionDate).toBe('2027-01-09')
    expect(REDEMPTION_DATE_OFFSET_DAYS).toBe(5)
  })

  it('상환일이 월·연·윤년 경계를 넘는다', () => {
    const view = toProductDetailView(
      productRow({
        redemption_schedules: [
          // +5가 해를 넘는다
          schedule({ round_no: 1, evaluation_date: '2026-12-28', barrier: '0.9000' }),
          // 2028은 윤년이라 2/29가 있다 → 2/26 + 5 = 3/2
          schedule({ round_no: 2, evaluation_date: '2028-02-26', barrier: '0.9000' }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      ASOF,
      OWNER,
    )
    const rounds = roundOptionsOf(view)

    expect(roundFillOf(rounds, '1', 'EARLY')!.redemptionDate).toBe('2027-01-02')
    expect(roundFillOf(rounds, '2', 'EARLY')!.redemptionDate).toBe('2028-03-02')
    // 규약이 `shiftDays`와 같은 산술임을 함께 고정한다
    expect(roundFillOf(rounds, '2', 'EARLY')!.redemptionDate).toBe(
      shiftDays('2028-02-26', REDEMPTION_DATE_OFFSET_DAYS),
    )
  })

  it('★ 리자드는 그 차수의 리자드 쿠폰율에서 나온다 — 조기상환보다 «작다»', () => {
    /*
     * DOC-007 §4.1. 유형을 보지 않고 채우면 조기상환 금액(과대)이 리자드 상환에
     * 저장되고, 그 차이가 그대로 과세 금융소득의 차이다 — 여기서는 500만원이다.
     */
    const early = roundFillOf(ROUNDS, '2', 'EARLY')!.amounts!
    const lizard = roundFillOf(ROUNDS, '2', 'LIZARD')!.amounts!

    expect(lizard).toEqual({ grossAmount: '103000000', taxableIncome: '3000000' })
    expect(dec(lizard.grossAmount).lt(dec(early.grossAmount))).toBe(true)
  })

  it('리자드 쿠폰율이 0이면 원금만 상환된다 — Q-04의 원금상환형', () => {
    // `null`이 아니라 `0`으로 표기하는 것이 규약이다. 0을 「없음」으로 접으면
    // 원금상환형 리자드를 표현할 수 없다.
    const view = toProductDetailView(
      productRow({
        redemption_schedules: [
          schedule({
            round_no: 1,
            evaluation_date: '2026-07-02',
            barrier: '0.9000',
            lizard_barrier: '0.6000',
            lizard_coupon_rate: '0.0000',
          }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      ASOF,
      OWNER,
    )
    expect(roundFillOf(roundOptionsOf(view), '1', 'LIZARD')!.amounts).toEqual({
      grossAmount: '100000000',
      taxableIncome: '0',
    })
  })

  it('★ 리자드 조건이 없는 차수는 «던지지 않고» 비운다 — V-14를 미리 말할 수 있게', () => {
    /*
     * `applicableCouponRate`는 이 조합에 `RangeError`를 던진다(§4.1 Q-04). 폼 계층에서
     * 던지면 `onChange` 안이라 오류 경계로도 가지 않아 **화면이 조용히 멈춘다.**
     * 여기서 옳은 답은 「없으면 채우지 않는다」이며, 그래야 화면이 V-14를 미리 말한다.
     */
    const fill = roundFillOf(ROUNDS, '1', 'LIZARD')
    expect(fill).not.toBeNull()
    // 차수 자체는 실재하므로 상환일은 나온다 — 금액만 없다
    expect(fill!.redemptionDate).toBe('2026-07-07')
    expect(fill!.amounts).toBeNull()
  })

  it('★ 만기손실은 실수령액을 채우지 않는다 — 시세가 정하는 값이다', () => {
    /*
     * 실제 수령액이 `P × W`이므로 화면이 알 수 없다. 그리고 `r ≥ 0`이라 예상 수령액은
     * 언제나 `≥ P`이므로 손실 상환에 채우는 것은 **항상 틀린 방향**이다 — 마지막
     * 차수에서 상환 유형을 비우는 것과 같은 논거다.
     */
    expect(roundFillOf(ROUNDS, '2', 'MATURITY_LOSS')!.amounts).toBeNull()
  })

  it('만기이익은 조기상환과 같은 산식이다 · 유형이 비면 EARLY를 가정한다', () => {
    const early = roundFillOf(ROUNDS, '2', 'EARLY')!.amounts
    expect(roundFillOf(ROUNDS, '2', 'MATURITY_GAIN')!.amounts).toEqual(early)
    expect(roundFillOf(ROUNDS, '2', '')!.amounts).toEqual(early)
  })

  it('빈 차수·형식이 아닌 차수·없는 차수는 `null`이고 던지지 않는다', () => {
    // 빈 차수는 **만기 상환의 정상값**이다(V-13) — 그때 채움이 풀린다.
    expect(roundFillOf(ROUNDS, '', 'MATURITY_GAIN')).toBeNull()
    expect(roundFillOf(ROUNDS, '둘', 'EARLY')).toBeNull()
    expect(roundFillOf(ROUNDS, '99', 'EARLY')).toBeNull()
    expect(roundFillOf([], '1', 'EARLY')).toBeNull()
  })
})

describe('기본값 — 판정에서 나온다', () => {
  it('★ 폼의 모든 칸에 값이 있다', () => {
    // `REDEMPTION_FIELDS`를 좌변으로 둔다 — 칸이 늘고 여기 대응이 없으면 그 칸은
    // 초기값 없이 렌더되고, 수정 경로에서는 그것이 곧 값의 상실이다.
    const values = redemptionDefaults(viewWith('120.000000'), ASOF)
    for (const name of REDEMPTION_FIELDS) {
      expect(Object.keys(values), `${name}의 기본값이 없다`).toContain(name)
    }
  })

  it('조기상환 판정이면 유형·차수·금액을 채운다', () => {
    const view = viewWith('120.000000')
    const values = redemptionDefaults(view, ASOF)

    // 1.2 ≥ 0.9이므로 1차 조기상환 판정이다.
    expect(values.redemptionType).toBe('EARLY')
    expect(values.roundNo).toBe('1')
    expect(values.grossAmount).toBe(view.projection!.expectedGross)
    expect(values.taxableIncome).toBe(view.projection!.expectedTaxableIncome)
    // 상환일은 기준일이다 — 화면이 `new Date()`를 부르지 않는다(Q-02).
    expect(values.redemptionDate).toBe(ASOF)
  })

  it('★ 원천징수세액은 비운다 — 채우면 계약의 산출이 영원히 실행되지 않는다', () => {
    // §5.4는 `withholdingTax`가 **미입력일 때만** 산출한다. 화면이 추정값을 채우면
    // 그 산출 경로가 죽고, 사용자는 우리 추정을 실제 징수액으로 저장한다.
    expect(redemptionDefaults(viewWith('120.000000'), ASOF).withholdingTax).toBe('')
  })

  it('★ 확정값 체크는 꺼져 있다 — ST-05', () => {
    // `is_confirmed`는 「증권사가 제공한 실제 값」이다(DOC-005 §6). 기본이 참이면
    // 추정값이 확정값으로 저장되고 화면은 그것을 같은 무게로 보여 준다.
    expect(redemptionDefaults(viewWith('120.000000'), ASOF).isConfirmed).toBe('')
  })

  it('이월 판정이면 유형을 채우지 않는다 — 없는 판단을 지어내지 않는다', () => {
    // 0.8 < 0.9 → `CARRY_OVER`. 「상환이 아니다」이므로 유형이 비고, 차수·금액은
    // 여전히 적용 차수의 것이다(사용자가 만기 상환으로 고칠 수 있다).
    const values = redemptionDefaults(viewWith('80.000000'), ASOF)
    expect(values.redemptionType).toBe('')
    expect(values.roundNo).toBe('1')
  })

  it('시세가 없으면 유형이 비고 금액은 계약 조건에서 나온다', () => {
    /*
     * E-01 — `conditionResult`가 `null`이므로 유형을 채울 근거가 없다. 그런데
     * `projection`은 **산다**(§4.3: 예상 수령액은 계약 조건에서만 나오고 시세를
     * 쓰지 않는다). 두 축이 다르다는 사실이 여기서 관측된다.
     */
    const view = viewWith(null)
    expect(view.projection).not.toBeNull()

    const values = redemptionDefaults(view, ASOF)
    expect(values.redemptionType).toBe('')
    expect(values.grossAmount).toBe(view.projection!.expectedGross)
  })

  it('★ 상환일은 기준일이다 — 차수에서 «파생하지 않는다»', () => {
    /*
     * ★ 이것이 「차수를 고르면 평가일 + 5일」과 **다른 것을 말하는 것이 의도**임을
     * 고정한다. 적용 차수는 정의상 **다음 도래** 차수이므로(RD-02) 그 평가일을 첫
     * 렌더에 넣으면 기본값이 **미래 날짜**가 되고, V-10은 그것을 거부하지 않는다
     * (발행일 이후만 본다). 즉 막아 주는 층이 없고 귀속연도는 상환일이 정하므로
     * 사용자가 고치지 않으면 「아직 일어나지 않은 상환」이 그 해의 금융소득에 들어간다.
     */
    const view = viewWith('120.000000')
    const values = redemptionDefaults(view, ASOF)
    expect(values.redemptionDate).toBe(ASOF)

    // 그리고 선택했을 때의 값과 실제로 다르다 — 같으면 이 케이스가 항진명제다
    const picked = roundFillOf(roundOptionsOf(view), values.roundNo, values.redemptionType)
    expect(picked!.redemptionDate).not.toBe(values.redemptionDate)
  })

  it('★ 초기 금액이 «차수를 고쳤을 때와 같은 함수»에서 나온다', () => {
    /*
     * 따로 두면 같은 (차수, 유형)에서 두 값이 나온다 — 사용자가 차수를 건드렸다
     * 되돌리기만 해도 금액이 변하고, 둘 중 하나는 틀린 값이다.
     */
    const view = viewWith('120.000000')
    const values = redemptionDefaults(view, ASOF)
    const picked = roundFillOf(roundOptionsOf(view), values.roundNo, values.redemptionType)

    expect(values.grossAmount).toBe(picked!.amounts!.grossAmount)
    expect(values.taxableIncome).toBe(picked!.amounts!.taxableIncome)
  })

  it('★ 리자드 판정이면 초기값도 «리자드 쿠폰율» 기준이다 — projection과 갈리는 지점', () => {
    /*
     * ★ **종전 동작의 정정이다.** `projection`은 §4.1의 `EARLY` 가정 위에 있으므로
     * 리자드 판정 상품에서도 조기상환 금액을 냈다. 그 값을 초기값으로 채우면 500만원
     * 과대 추정이 확정값 칸에 앉고, 사용자가 차수를 다시 고르는 순간 금액이 바뀐다.
     *
     * 픽스처는 3차수다 — 2차가 **마지막이 아니어야** 유형이 채워진다(마지막 차수는
     * 손익 판정이 필요해 비운다). W = 0.7이므로 2차에서 `W < B(0.85)` ∧ `W ≥ L(0.60)`.
     */
    const view = toProductDetailView(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-07-02', barrier: '0.9000' }),
          schedule({
            round_no: 2,
            evaluation_date: '2027-01-04',
            barrier: '0.8500',
            lizard_barrier: '0.6000',
            lizard_coupon_rate: '0.0300',
          }),
          schedule({ round_no: 3, evaluation_date: '2027-07-02', barrier: '0.8000' }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '70.000000' }]),
      '2026-08-01',
      OWNER,
    )

    const values = redemptionDefaults(view, '2026-08-01')
    expect(values.redemptionType).toBe('LIZARD')
    expect(values.roundNo).toBe('2')

    // 리자드 기준 — 1억 × (1 + 0.03 × 12/12)
    expect(values.grossAmount).toBe('103000000')
    expect(values.taxableIncome).toBe('3000000')

    // 그리고 `projection`(EARLY 가정)과 «다르다» — 정정의 관측 지점이다
    expect(view.projection!.expectedGross).toBe('108000000')
  })

  it('적용 차수가 없으면 차수·금액이 빈다 — E-07', () => {
    // 전 차수 경과 미상환. 자동 채움의 근거가 없으므로 지어내지 않는다.
    const view = viewWith('120.000000', '2027-06-30')
    expect(view.projection).toBeNull()

    const values = redemptionDefaults(view, '2027-06-30')
    expect(values.roundNo).toBe('')
    expect(values.grossAmount).toBe('')
    expect(values.taxableIncome).toBe('')
    expect(values.redemptionType).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 마지막 차수 — 두 축의 값 집합이 다르다 (P4.5)
// ---------------------------------------------------------------------------

/**
 * ★ **마지막 차수에서 유형을 비운다** — P4.5 (DOC-008 §5 SCR-203의 별 각주)
 *
 * 판정 축 `conditionResult`는 셋(`EARLY`·`LIZARD`·`CARRY_OVER`)이고 실적 축
 * `redemptionType`은 **넷**이다(+ `MATURITY_GAIN`·`MATURITY_LOSS`). v0.7 구현은 확정
 * 판정 둘을 **항등으로** 옮겼고, `evaluateCondition`은 차수가 마지막인지 보지 않으므로
 * 마지막 차수에서 `W ≥ B(n)`이면 `EARLY`가 채워졌다. DOC-005는 `EARLY`를 「만기 **전**
 * 평가일에」로 정의하므로 그 상환은 정의상 `MATURITY_GAIN`이며, 기본값을 그대로 저장하면
 * **만기상환이 조기상환으로 기록되고 그 기록이 §4.6 집계의 입력이 된다.**
 *
 * **DOC-007은 건드리지 않았다** — 판정 축에 만기 개념을 넣는 것은 TC-01~22의 정본을
 * 흔드는 일이므로(절대 규칙 #1) 두 축의 차이를 실적 축으로 옮기는 자리에서 흡수한다.
 *
 * ## 음성 대조 3건 — 셋이 각각 다른 케이스를 잡는다
 *
 * | 되돌린 것 | 실패한 케이스 |
 * |---|---|
 * | 가드 제거 (`finalRound`를 `false` 고정) | **2건** — 마지막 차수 케이스 · 불연속 차수 케이스 |
 * | `isFinalRound`를 `roundNo === schedules.length`로 (행 수 판정) | **1건** — 불연속 차수 케이스뿐 |
 * | `isFinalRound`를 `true` 고정 | **2건** — 「마지막이 아니면 그대로 채운다」 케이스 · 기존 「조기상환 판정이면 …」 |
 *
 * 둘째 줄이 이 describe의 핵심 기록이다 — **불연속 차수 케이스가 「행 수로 판정」을
 * 잡는 유일한 대조점**이므로 그것을 지우면 그 구현이 아무 단언도 깨뜨리지 않는다.
 *
 * ## 무효 대조 세 유형을 순서대로 배제한다
 *
 * ① **픽스처가 두 구현에서 일치한다** — 차수가 `1, 2`뿐이면 `max(roundNo)`와
 *    `schedules.length`가 **둘 다 2**여서 두 구현이 같은 답을 낸다. 그래서 차수를
 *    `1, 99`로 둔 케이스를 함께 넣는다(`totalRounds = 2`, 최대 차수 `99`). DB가 그
 *    상태를 허용하는 것은 실측된 사실이다(AQ-29 — V-04는 계약 계층에만 있다).
 * ② **테스트가 값을 얹는다** — 뷰를 리터럴로 쓰지 않고 `toProductDetailView`를
 *    지나게 한다. `projection`이 어느 조건에서 `null`이 되는지는 매퍼의 성질이므로,
 *    뷰를 손으로 적으면 그 성질과 무관한 픽스처를 검증하게 된다(이 파일의 기존 규약).
 * ③ **단언이 깨뜨림에 불변인 대리 지표를 본다** — 「유형이 비었다」만 보면 `true` 고정
 *    구현이 통과한다. 그래서 **마지막이 아닌 차수에서 채워지는 것**을 같은 describe에
 *    나란히 둔다 — 두 케이스가 같은 관측 지점에 **반대 결과**를 낸다는 것이 가드가
 *    조건에 민감하다는 증거다.
 */
describe('마지막 차수에서는 상환 유형을 비운다', () => {
  /** 1차가 경과하고 2차(마지막)가 미래 → 적용 차수 = 2 = 마지막 */
  function viewFinalApplied(lastRoundNo: number) {
    return toProductDetailView(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-07-02', barrier: '0.9000' }),
          schedule({
            round_no: lastRoundNo,
            evaluation_date: '2027-01-04',
            barrier: '0.8500',
          }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      '2026-12-01',
      OWNER,
    )
  }

  it('★ 판정이 `EARLY`여도 마지막 차수면 유형이 빈다', () => {
    const view = viewFinalApplied(2)

    // 전제를 먼저 고정한다 — 적용 차수가 마지막이고 판정이 확정적이어야 이 케이스가
    // 무엇인가를 검증한다. 전제가 무너지면 「유형이 비었다」가 다른 이유로 참이 된다.
    expect(view.projection!.appliedRoundNo).toBe(2)
    expect(view.schedules.find((s) => s.roundNo === 2)!.conditionResult).toBe('EARLY')

    const values = redemptionDefaults(view, '2026-12-01')
    expect(values.redemptionType).toBe('')
    // **차수·금액은 여전히 채운다** — 비우는 것은 유형 하나다. 사용자가 만기 이익/손실을
    // 고르면 나머지 칸이 이미 채워져 있다.
    expect(values.roundNo).toBe('2')
    expect(values.grossAmount).toBe(view.projection!.expectedGross)
  })

  it('★ 마지막이 아닌 차수에서는 그대로 채운다 — 같은 지점의 반대 결과', () => {
    /*
     * ★ 가드가 **조건에 민감하다**는 것을 같은 지점의 반대 결과로 고정한다 — 적용 차수가
     * 1이고 마지막이 2이므로 걸리지 않아야 한다.
     *
     * > **판별력은 중복이다.** 초안 주석은 「이 케이스가 없으면 `true` 고정 구현이
     * > 통과한다」고 적었는데 **거짓이다** — 컷 6의 기존 케이스(「조기상환 판정이면
     * > 유형·차수·금액을 채운다」)가 같은 픽스처·같은 단언을 이미 갖고 있어 그 변형을
     * > 잡는다(실측: `true` 고정 → 두 케이스가 함께 빨간불). 이 케이스를 남기는 이유는
     * > 판별력이 아니라 **대칭을 한 describe 안에서 눈에 보이게** 두는 것이다.
     */
    const view = viewWith('120.000000')
    expect(view.projection!.appliedRoundNo).toBe(1)

    expect(redemptionDefaults(view, ASOF).redemptionType).toBe('EARLY')
  })

  it('★ 차수 번호가 불연속이어도 마지막을 맞게 고른다 — 행 수로 판정하지 않는다', () => {
    /*
     * ★ **`totalRounds`(= `schedules.length`)로 판정하면 여기가 빨간불이다.**
     * 차수가 `1, 99`이면 `totalRounds`는 2이고 최대 차수는 99다. 적용 차수 99를
     * `=== totalRounds`로 물으면 「마지막이 아니다」가 되어 가드가 통째로 샌다.
     *
     * 그 상태는 도달 가능하다 — V-04(차수 연속성)는 **계약 계층에만** 있고 쓰기 함수는
     * 보지 않으므로(DOC-011 AQ-29, 실측으로 고정되어 있다) `1, 2, 99`인 상품이 함수
     * 직접 호출로 만들어진다. DQ-05가 총 차수 정본을 `max(round_no)`가 아니라 행 수로
     * 정한 것이 바로 두 값이 갈릴 수 있기 때문이다.
     */
    const view = viewFinalApplied(99)
    expect(view.product.totalRounds).toBe(2)
    expect(view.projection!.appliedRoundNo).toBe(99)

    expect(redemptionDefaults(view, '2026-12-01').redemptionType).toBe('')
  })
})

describe('수정의 초기값 — 저장된 값이다', () => {
  const stored = redemption({
    round_no: 2,
    withholding_tax: '327250',
    is_confirmed: true,
    note: '지급명세서 확인',
  })
  const values = redemptionValuesOf({
    id: stored.id,
    redemptionType: stored.redemption_type,
    roundNo: stored.round_no,
    redemptionDate: stored.redemption_date,
    grossAmount: stored.gross_amount,
    taxableIncome: stored.taxable_income,
    withholdingTax: stored.withholding_tax,
    isConfirmed: stored.is_confirmed,
    realizedPnl: '4000000',
    note: stored.note,
  })

  it('★ 폼의 모든 칸에 값이 있다 — 빠진 칸은 수정 저장이 비운다', () => {
    for (const name of REDEMPTION_FIELDS) {
      expect(Object.keys(values), `${name}의 초기값이 없다`).toContain(name)
    }
  })

  it('★ 원천징수세액이 저장된 값 그대로다 — 비우면 재산출된다', () => {
    /*
     * ★ 비우면 계약이 `taxableIncome × 분리과세율`로 다시 산출한다. 그러면 「비고만
     * 고치려던」 수정에서 증권사가 확정한 징수액이 **우리 산출값으로 바뀐다** —
     * A-04를 뒤집는 조용한 변경이고, 화면에는 그 사실이 나타나지 않는다.
     */
    expect(values.withholdingTax).toBe('327250')
  })

  it('확정값 여부가 체크 상태로 옮겨진다', () => {
    expect(values.isConfirmed).toBe('on')
    // 거짓이면 빈 문자열이다 — `checkbox()`가 그것을 거짓으로 읽는다.
    const unconfirmed = redemptionValuesOf({
      id: 'x',
      redemptionType: 'MATURITY_GAIN',
      roundNo: null,
      redemptionDate: '2026-07-02',
      grossAmount: '1',
      taxableIncome: '0',
      withholdingTax: null,
      isConfirmed: false,
      realizedPnl: '0',
      note: null,
    })
    expect(unconfirmed.isConfirmed).toBe('')
    // 만기 상환은 차수가 없다 — 빈 값이 정상이다(I-14는 조기·리자드만 요구한다).
    expect(unconfirmed.roundNo).toBe('')
    expect(unconfirmed.withholdingTax).toBe('')
  })

  it('★ 왕복 — 초기값을 그대로 제출하면 저장된 값이 돌아온다', () => {
    const input = parseRedemptionForm(formOf(values))

    expect(input).toEqual({
      redemptionType: 'EARLY',
      roundNo: 2,
      redemptionDate: '2026-07-02',
      grossAmount: '104000000',
      taxableIncome: '4000000',
      withholdingTax: '327250',
      isConfirmed: true,
      note: '지급명세서 확인',
    } satisfies RedemptionInput)
  })
})

describe('파서', () => {
  const base = {
    redemptionType: 'MATURITY_GAIN',
    redemptionDate: '2026-07-02',
    grossAmount: '104,000,000',
    taxableIncome: '4,000,000',
  }

  it('금액의 쉼표를 지운다 — 값은 바뀌지 않는다', () => {
    const input = parseRedemptionForm(formOf(base))
    expect(input.grossAmount).toBe('104000000')
    expect(input.taxableIncome).toBe('4000000')
  })

  it('빈 차수는 키가 없다 — 만기 상환의 정상값이다', () => {
    const input = parseRedemptionForm(formOf({ ...base, roundNo: '' }))
    expect('roundNo' in input).toBe(false)
  })

  it('★ 빈 원천징수세액은 키가 없다 — 계약이 산출한다', () => {
    // `''`를 보내도 `optionalAmount`가 `undefined`로 읽지만, 그 동일성은 **계약 쪽
    // 구현의 성질**이다. 여기서 기대면 그쪽이 엄격해지는 날 조용히 깨진다.
    const input = parseRedemptionForm(formOf({ ...base, withholdingTax: '' }))
    expect('withholdingTax' in input).toBe(false)
  })

  it('형식이 아닌 차수는 `NaN`이다 — V-20이 그 문구를 낸다', () => {
    // 화면이 같은 판정을 하지 않는 이유는 규칙이 두 곳에 생기면 정본을 알 수 없다는 것.
    const input = parseRedemptionForm(formOf({ ...base, roundNo: '둘' }))
    expect(Number.isNaN(input.roundNo)).toBe(true)
  })

  it('체크박스는 부재와 빈 값 둘 다 거짓이다', () => {
    expect(parseRedemptionForm(formOf(base)).isConfirmed).toBe(false)
    expect(parseRedemptionForm(formOf({ ...base, isConfirmed: '' })).isConfirmed).toBe(false)
    expect(parseRedemptionForm(formOf({ ...base, isConfirmed: 'on' })).isConfirmed).toBe(true)
  })

  it('빈 비고는 키가 없다 — `null`로 저장된다', () => {
    expect('note' in parseRedemptionForm(formOf({ ...base, note: '  ' }))).toBe(false)
  })
})

describe('KI 터치 — 빈 칸이 해제다', () => {
  it('빈 값은 `null`이다', () => {
    /*
     * ★ 계약의 두 번째 인자가 `string | null`이고 `null`이 해제다. `''`를 넘기면
     * 「YYYY-MM-DD 형식으로 입력한다」가 되어 **해제할 방법이 없어진다.**
     */
    expect(parseTouchedAtForm(formOf({ kiTouchedAt: '' }))).toBeNull()
    expect(parseTouchedAtForm(formOf({ kiTouchedAt: '   ' }))).toBeNull()
    expect(parseTouchedAtForm(new FormData())).toBeNull()
  })

  it('날짜는 그대로 넘어간다', () => {
    expect(parseTouchedAtForm(formOf({ kiTouchedAt: '2026-06-15' }))).toBe('2026-06-15')
  })
})

describe('만기손실의 과세 금융소득 고정', () => {
  it('만기손실만 고정이다 — V-12·I-08·절대 규칙 #8', () => {
    expect(taxableIncomeLocked('MATURITY_LOSS')).toBe(true)
    for (const type of ['EARLY', 'LIZARD', 'MATURITY_GAIN', '']) {
      expect(taxableIncomeLocked(type), type).toBe(false)
    }
  })
})
