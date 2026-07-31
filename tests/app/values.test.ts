import { describe, expect, it } from 'vitest'

import type { ProductInput } from '@/lib/db/mutations/types'
import { toProductDetailView } from '@/lib/db/queries/map'
import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { parseProductForm, percentToRatio, ratioToPercent } from '@/lib/forms/parse'
import {
  STEP_FIELD,
  productFieldNames,
  roundCountOf,
  rowCountOf,
} from '@/lib/forms/steps'
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
     * `step`은 폼이 정하는 값이므로 제외한다(수정도 ①에서 시작한다).
     */
    for (const name of productFieldNames(counts)) {
      if (name === STEP_FIELD) continue
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

  it('수정 저장은 평가일을 **재생성한다** — 저장된 날짜가 산식과 다르면 바뀐다', () => {
    /*
     * 평가일은 입력이 아니라 생성값이다(DOC-008 §5 SCR-204). 그래서 폼 값 맵에
     * 담지 않고 `발행일 + n×주기 − 1일`에서 다시 나온다 — 결과로 저장된 날짜가 그
     * 산식과 다른 상품을 수정하면 날짜가 산식대로 **바뀐다.**
     *
     * 히든으로 나르는 대안이 더 나쁜 이유는 컷 4a가 적었다(발행일을 고친 뒤 평가
     * 조건 단계를 지나지 않고 저장하면 **고치기 전 날짜**가 저장된다). 그 상태는
     * 단일 페이지화 이후 존재할 수 없고, 대신 이 재생성이 일어난다 — 조용히 두지
     * 않고 케이스로 박는다.
     */
    const drifted = toProductDetailView(
      productRow({
        issue_date: ISSUE,
        evaluation_period_months: PERIOD,
        redemption_schedules: [
          // 손으로 정해진 날짜. 산식은 2026-07-01이다(발행일 + 6개월 − 1일).
          schedule({ round_no: 1, evaluation_date: '2026-07-15' }),
        ],
      }),
      priceMap([]),
      ASOF,
      OWNER,
    )

    expect(drifted.schedules[0]!.evaluationDate).toBe('2026-07-15')
    const back = parseProductForm(formOf(productValuesOf(drifted)))
    expect(back.schedules[0]!.evaluationDate).toBe(DATES[0])
    expect(DATES[0]).toBe('2026-07-01')
  })

  it('★ 재생성이 멱등이다 — 규약대로 저장된 날짜는 수정 저장에서 그대로다', () => {
    /*
     * DOC-002 §4.8 v0.9의 load-bearing 성질이다. v0.7은 「RD-03이 조정 경로를
     * 만들면 DOC-011 §5.2의 전체 교체와 충돌한다(조정한 날짜가 다음 수정 저장에서
     * 되돌아간다)」고 경고했는데, **규약이 전역이므로 그 충돌이 발생하지 않는다** —
     * 저장값이 이미 산식의 결과이므로 재생성이 같은 값을 다시 낸다.
     *
     * 그래서 이 프로젝트는 차수별 평가일 입력 칸을 만들지 않았고 §5.2에 예외도 두지
     * 않았다. 그 판단이 옳은지가 이 케이스에 달려 있다 — 여기가 빨간불이면 운영
     * 데이터의 SQL 정정도 되돌아간다.
     */
    const view = viewOf()
    const once = parseProductForm(formOf(productValuesOf(view)))
    expect(once.schedules.map((s) => s.evaluationDate)).toEqual([...DATES])

    // 두 번째 왕복도 같다 — 재생성이 값을 옮기지 않는다
    const twice = parseProductForm(formOf(productValuesOf(view)))
    expect(twice.schedules.map((s) => s.evaluationDate)).toEqual([...DATES])
  })
})
