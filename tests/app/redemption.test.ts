import { describe, expect, it } from 'vitest'

import type { RedemptionInput } from '@/lib/db/mutations/types'
import { toProductDetailView } from '@/lib/db/queries/map'
import { parseRedemptionForm, parseTouchedAtForm } from '@/lib/forms/parse'
import {
  REDEMPTION_FIELDS,
  redemptionDefaults,
  redemptionValuesOf,
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
      { roundNo: 1, evaluationDate: '2026-07-02', hasLizard: false },
      { roundNo: 2, evaluationDate: '2027-01-04', hasLizard: true },
    ])
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
