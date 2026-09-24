import { describe, expect, it } from 'vitest'

import type { ProductInput } from '@/lib/db/mutations/types'
import { toProductDetailView } from '@/lib/db/queries/map'
import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { formOfValues, parseProductForm, percentToRatio, ratioToPercent } from '@/lib/forms/parse'
import {
  INTENT_FIELD,
  productFieldNames,
  roundCountOf,
  rowCountOf,
  transition,
} from '@/lib/forms/productForm'
import { EVALUATION_DATE_BASIS_FIELD } from '@/lib/forms/schedules'
import { productValuesOf } from '@/lib/forms/values'

import { ASSET_1, ASSET_2, OWNER, priceMap, productRow, schedule } from '../db/helpers/rows'

/**
 * 수정 모드의 왕복 — **뷰 → 폼 값 → 계약 입력** (SCR-204, P4 컷 5)
 *
 * ## 무엇이 틀렸을 때 실패하는가
 *
 * §5.2는 **전체 교체**다. 폼이 다루지 않는 필드는 저장 시 비워지므로, 초기값에서 한
 * 칸이 빠지면 **수정이 그 값을 조용히 지운다** — 오류도 경고도 없고 증상은 저장 후
 * 상세 화면에서야 보인다. 컷 4a가 「비고」를 ①에 넣은 판단이 막은 것이 정확히 그
 * 형태이며, 여기서는 목록을 손으로 적는 대신 `productFieldNames()`에서 파생시킨다.
 *
 * 왕복의 양 끝이 다른 사람이 쓴 두 함수라는 것이 이 파일의 값이다 —
 * `productValuesOf`(컷 5)와 `parseProductForm`(컷 4b)이 서로를 검산한다.
 *
 * ## 뷰를 손으로 쓰지 않는다
 *
 * `toProductDetailView`를 지나게 한다. 뷰를 리터럴로 적으면 매퍼가 실제로 주는 형태
 * (`ratioString`의 4자리 고정, `priceString`의 6자리 고정)와 갈릴 수 있고, 그 갈림이
 * 곧 이 함수가 잘못 변환하는 원인이 된다.
 */

const ASOF = '2026-06-30'

/** 발행일 + n×주기 − 1일. **저장된 평가일이 산식과 같은** 정상 상품이다 */
const ISSUE = '2026-01-02'
const PERIOD = 6
const ROUNDS = 3
const DATES = generateEvaluationDates({
  issueDate: ISSUE,
  evaluationPeriodMonths: PERIOD,
  totalRounds: ROUNDS,
  // 앱이 저장할 때 쓰는 규약과 같아야 한다 — 여기서 0을 넘기면 이 파일이
  // 「수정 저장이 평가일을 되돌린다」를 정상 상품에서 관측하게 된다.
  offsetDays: EVALUATION_DATE_OFFSET_DAYS,
})

function viewOf() {
  const row = productRow({
    issue_date: ISSUE,
    evaluation_period_months: PERIOD,
    principal: '123456789012345',
    annual_coupon_rate: '0.0850',
    ki_barrier: '0.5000',
    ki_observation: 'CONTINUOUS',
    note: '수정 왕복 확인',
    els_underlyings: [
      // AQ-30 — `numeric(18,6)` 상한 근처. 이 값이 왕복에서 밀리면 여기서 걸린다.
      {
        asset_id: ASSET_1,
        base_price: '99999999999.999999',
        sequence: 1,
        assets: { id: ASSET_1, name: '자산1', market: 'KRX', currency: 'KRW' },
      },
      {
        asset_id: ASSET_2,
        base_price: '5300.000000',
        sequence: 2,
        assets: { id: ASSET_2, name: '자산2', market: 'KRX', currency: 'KRW' },
      },
    ],
    redemption_schedules: [
      schedule({ round_no: 1, evaluation_date: DATES[0]!, barrier: '0.9000' }),
      schedule({
        round_no: 2,
        evaluation_date: DATES[1]!,
        barrier: '0.8500',
        lizard_barrier: '0.6000',
        lizard_coupon_rate: '0.0300',
        lizard_requires_no_ki: true,
      }),
      schedule({ round_no: 3, evaluation_date: DATES[2]!, barrier: '0.8000' }),
    ],
  })

  return toProductDetailView(row, priceMap([{ assetId: ASSET_1, price: '120.000000' }]), ASOF, OWNER)
}

/** 값 맵 → `FormData`. 브라우저가 폼을 제출하는 것과 같은 형태다(전부 문자열) */
function formOf(values: Record<string, string>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(values)) form.append(name, value)
  return form
}

describe('ratioToPercent — percentToRatio의 역', () => {
  it('저장 형식을 퍼센트 입력으로 되돌린다', () => {
    expect(ratioToPercent('0.9000')).toBe('90')
    expect(ratioToPercent('0.0850')).toBe('8.5')
    expect(ratioToPercent('0.4667')).toBe('46.67')
    expect(ratioToPercent('1.0000')).toBe('100')
    // `0`은 값이다 — 원금상환형 리자드의 쿠폰율(V-08 하한이 필드별로 다른 이유)
    expect(ratioToPercent('0.0000')).toBe('0')
  })

  it('왕복이 닫힌다 — 어느 방향으로 두 번 지나도 같은 값이다', () => {
    for (const percent of ['90', '8.5', '46.67', '100', '0', '0.5']) {
      expect(ratioToPercent(percentToRatio(percent)), percent).toBe(percent)
    }
    for (const ratio of ['0.9000', '0.0850', '0.4667', '1.0000', '0.0000']) {
      expect(percentToRatio(ratioToPercent(ratio)), ratio).toBe(ratio)
    }
  })

  it('빈 칸과 형식 아닌 값은 그대로 둔다', () => {
    // 계약이 준 값이 아닌 것이 오면 화면이 그것을 보여야 사용자가 상태를 안다.
    expect(ratioToPercent('')).toBe('')
    expect(ratioToPercent('  ')).toBe('')
    expect(ratioToPercent('abc')).toBe('abc')
  })
})

describe('productValuesOf — 폼의 모든 이름을 덮는다', () => {
  const values = productValuesOf(viewOf())
  const counts = {
    underlyings: rowCountOf(values, 'underlyings'),
    rounds: roundCountOf(values),
  }

  it('행 수가 뷰에서 파생된다', () => {
    expect(counts).toEqual({ underlyings: 2, rounds: ROUNDS })
  })

  it('★ 선언된 모든 이름에 값이 있다 — 빠진 칸은 수정 저장이 비운다', () => {
    /*
     * ★ **이 단언이 §5.2의 전체 교체를 막는 방어다.** 폼에 칸이 늘고 여기 대응이
     * 없으면 그 값은 수정 저장에서 `''`가 되어 계약에 실린다. `productFieldNames`를
     * 좌변으로 두므로 목록이 세 번째 사본이 되지 않는다.
     *
     * 제외할 이름이 없다 — 단계 분리를 철회하며 `step` 필드가 사라졌고(P6 컷 1),
     * 이제 폼의 모든 이름이 계약 입력의 이름이다.
     */
    for (const name of productFieldNames(counts)) {
      expect(Object.keys(values), `${name}의 초기값이 없다`).toContain(name)
    }
  })

  it('일괄 배리어 칸은 비어 있다 — 저장된 값이 아니라 도구다', () => {
    expect(values.barriers).toBe('')
  })

  it('비율이 퍼센트로 되돌아 있다', () => {
    expect(values.annualCouponRate).toBe('8.5')
    expect(values.kiBarrier).toBe('50')
    expect(values['schedules[0].barrier']).toBe('90')
    expect(values['schedules[1].lizardBarrier']).toBe('60')
    expect(values['schedules[1].lizardCouponRate']).toBe('3')
  })

  it('노낙인 상품은 KI 두 칸이 빈다 — V-16의 짝이 유지된다', () => {
    const view = toProductDetailView(
      productRow({ ki_barrier: null, ki_observation: null }),
      priceMap([]),
      ASOF,
      OWNER,
    )
    const noKi = productValuesOf(view)
    expect(noKi.kiBarrier).toBe('')
    expect(noKi.kiObservation).toBe('')
  })
})

describe('왕복 — 뷰 → 폼 값 → 계약 입력', () => {
  const view = viewOf()
  const input = parseProductForm(formOf(productValuesOf(view)))

  it('상품 열이 그대로 돌아온다', () => {
    expect(input.name).toBe(view.product.name)
    expect(input.issuer).toBe(view.product.issuer)
    expect(input.issueDate).toBe(view.product.issueDate)
    expect(input.principal).toBe(view.product.principal)
    expect(input.accountType).toBe(view.product.accountType)
    expect(input.note).toBe(view.product.note)
    expect(input.evaluationPeriodMonths).toBe(view.product.evaluationPeriodMonths)
    expect(input.totalRounds).toBe(view.schedules.length)
    expect(input.annualCouponRate).toBe(view.product.annualCouponRate)
    expect(input.kiBarrier).toBe(view.product.kiBarrier)
    expect(input.kiObservation).toBe(view.product.kiObservation)
  })

  it('기초자산이 순서·기준가까지 그대로다 — 18자리가 밀리지 않는다', () => {
    expect(input.underlyings).toEqual([
      { assetId: ASSET_1, basePrice: '99999999999.999999', sequence: 1 },
      { assetId: ASSET_2, basePrice: '5300.000000', sequence: 2 },
    ] satisfies ProductInput['underlyings'])
  })

  it('차수가 그대로다 — 리자드 셋이 붙은 차수만 그 셋을 갖는다', () => {
    expect(input.schedules).toEqual([
      { roundNo: 1, evaluationDate: DATES[0], barrier: '0.9000' },
      {
        roundNo: 2,
        evaluationDate: DATES[1],
        barrier: '0.8500',
        lizardBarrier: '0.6000',
        lizardCouponRate: '0.0300',
        lizardRequiresNoKi: true,
      },
      { roundNo: 3, evaluationDate: DATES[2], barrier: '0.8000' },
    ] satisfies ProductInput['schedules'])
  })

  it('★ 저장된 평가일을 그대로 싣는다 — 산식과 달라도 (DOC-008 v2.8)', () => {
    /*
     * v2.7까지 이 자리의 케이스는 「수정 저장은 평가일을 **재생성한다**」였다 — 평가일이
     * 생성값이던 동안의 사실이다. 평가일이 차수별 입력값이 되면서(DOC-002 §4.8 v1.6)
     * 뒤집혔다: 산식과 다른 날짜(불러온 실제 날짜, E04000의 휴장일 조정)가 수정 저장에서
     * 산식으로 바뀌면 **§5.2 전체 교체가 그 날짜를 조용히 지운다.**
     */
    const drifted = toProductDetailView(
      productRow({
        issue_date: ISSUE,
        evaluation_period_months: PERIOD,
        redemption_schedules: [
          // 산식은 2026-07-01이다(발행일 + 6개월 − 1일). 저장값은 그와 다르다.
          schedule({ round_no: 1, evaluation_date: '2026-07-15' }),
        ],
      }),
      priceMap([]),
      ASOF,
      OWNER,
    )

    const values = productValuesOf(drifted)
    expect(values['schedules[0].evaluationDate']).toBe('2026-07-15')

    // 저장 제출을 지나도 그대로다 — 어댑터가 부르는 경로 그대로(`transition` → 파서)
    const next = transition(formOf({ ...values, [INTENT_FIELD]: 'SUBMIT' }))
    expect(next.saveHeld).toBe(false)
    expect(parseProductForm(formOfValues(next.values)).schedules[0]!.evaluationDate).toBe(
      '2026-07-15',
    )
    // 음성 대조 — 산식이었다면 다른 날이다
    expect(DATES[0]).toBe('2026-07-01')
  })

  it('★ 왕복이 항등이다 — 산식대로 저장된 날짜(운영 11건)는 수정 저장에서 그대로다', () => {
    const view = viewOf()
    const values = productValuesOf(view)
    const once = transition(formOf({ ...values, [INTENT_FIELD]: 'SUBMIT' }))
    expect(parseProductForm(formOfValues(once.values)).schedules.map((s) => s.evaluationDate)).toEqual([
      ...DATES,
    ])
    const twice = transition(formOf({ ...once.values, [INTENT_FIELD]: 'SUBMIT' }))
    expect(twice.values).toEqual(once.values)
  })

  it('★ 산식대로이던 날짜는 발행일을 고친 저장에서 따라간다 — 기준을 싣기 때문이다', () => {
    /*
     * 가장 흔한 수정 경로다(운영 11건이 전부 산식대로). 기준(`evaluationDateBasis`)을
     * 싣지 않으면 판정이 **현재** 발행일과 대조해 산식대로이던 날짜를 「실제 날짜」로
     * 읽고, 날짜를 옮기지 않은 채 저장을 보류한다 — 사용자가 고친 발행일과 어긋난
     * 날짜가 재제출로 저장된다.
     */
    const values = productValuesOf(viewOf())
    expect(values[EVALUATION_DATE_BASIS_FIELD]).toBe(`${ISSUE}|${PERIOD}`)

    const next = transition(formOf({ ...values, issueDate: '2026-02-02', [INTENT_FIELD]: 'SUBMIT' }))
    expect(next.saveHeld).toBe(false)
    expect([0, 1, 2].map((i) => next.values[`schedules[${i}].evaluationDate`])).toEqual([
      '2026-08-01',
      '2027-02-01',
      '2027-08-01',
    ])
  })

  it('실제 날짜의 상품은 발행일을 고친 저장이 한 번 보류된다', () => {
    const drifted = toProductDetailView(
      productRow({
        issue_date: ISSUE,
        evaluation_period_months: PERIOD,
        redemption_schedules: [schedule({ round_no: 1, evaluation_date: '2026-07-15' })],
      }),
      priceMap([]),
      ASOF,
      OWNER,
    )
    const next = transition(
      formOf({ ...productValuesOf(drifted), issueDate: '2026-02-02', [INTENT_FIELD]: 'SUBMIT' }),
    )
    expect(next.saveHeld).toBe(true)
    expect(next.values['schedules[0].evaluationDate']).toBe('2026-07-15')
  })
})
