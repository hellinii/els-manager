import { describe, expect, it, vi } from 'vitest'

import { evaluationClosePairsOf, evaluationVerdictFor, registrationDateOf } from '@/lib/db/queries/evaluation'
import { NO_EVALUATION_CLOSES, type EvaluationCloses, type PriceRow } from '@/lib/db/queries/load'
import { toProductDetailView } from '@/lib/db/queries/map'
import { NO_ESTIMATE_RATES } from '@/lib/domain'

import { ASSET_1, ASSET_2, OWNER, asset, priceMap, productRow, redemption, schedule } from './helpers/rows'

/**
 * 평가일 판정의 행 어댑터 · 상세 뷰 — DOC-007 §3.6 · DOC-011 §4.3 `evaluationVerdict` (P6 컷 7)
 *
 * 표본 `productRow`: 등록일 = 발행일 2026-01-02(KST), 1차 2026-07-02(목 · B 0.90) · 2차 2027-01-04(만기).
 * 기준일 2026-08-01이면 1차가 경과했고 2차는 다가온다.
 */

const ASOF = '2026-08-01'
const R1 = '2026-07-02'

function closesOf(entries: ReadonlyArray<[assetId: string, date: string, price: string]>): EvaluationCloses {
  const out = new Map<string, Map<string, PriceRow>>()
  for (const [assetId, date, price] of entries) {
    const byDate = out.get(assetId) ?? new Map<string, PriceRow>()
    byDate.set(date, { as_of_date: date, price, source: 'AUTO' })
    out.set(assetId, byDate)
  }
  return out
}

const detail = (row: ReturnType<typeof productRow>, closes: EvaluationCloses, asOf = ASOF) =>
  toProductDetailView(row, priceMap([]), asOf, OWNER, NO_ESTIMATE_RATES, closes)

describe('evaluationClosePairsOf — 로더에 넘길 쌍', () => {
  it('판정할 차수의 평가일 × 기초자산이다', () => {
    const row = productRow({
      els_underlyings: [
        { asset_id: ASSET_1, base_price: '100.000000', sequence: 1, assets: asset(ASSET_1, '자산1') },
        { asset_id: ASSET_2, base_price: '50.000000', sequence: 2, assets: asset(ASSET_2, '자산2') },
      ],
    })
    expect(evaluationClosePairsOf([row], ASOF)).toEqual([
      { assetId: ASSET_1, date: R1 },
      { assetId: ASSET_2, date: R1 },
    ])
  })

  it('같은 쌍은 한 번만 싣는다', () => {
    expect(evaluationClosePairsOf([productRow(), productRow({ id: 'product-2' })], ASOF)).toEqual([
      { assetId: ASSET_1, date: R1 },
    ])
  })

  it('쌍이 없는 경우 — 경과 없음 · 상환 완료 · 등록 전 · 만기(시세를 보지 않는다)', () => {
    expect(evaluationClosePairsOf([productRow()], '2026-06-30')).toEqual([])
    expect(evaluationClosePairsOf([productRow({ redemptions: redemption() })], ASOF)).toEqual([])
    expect(
      evaluationClosePairsOf([productRow({ created_at: '2026-07-10T00:00:00+00:00' })], ASOF),
    ).toEqual([])
    expect(evaluationClosePairsOf([productRow()], '2027-01-05')).toEqual([])
  })
})

describe('evaluationVerdictFor — 행 어댑터', () => {
  it('평가일 종가로 조건 충족을 낸다', () => {
    const v = evaluationVerdictFor(productRow(), closesOf([[ASSET_1, R1, '95.000000']]), ASOF)
    expect(v?.kind === 'CONDITION_MET' && v.result).toBe('EARLY')
    expect(v?.schedule.row.round_no).toBe(1)
  })

  it('그날 행이 없으면 평가일 종가 없음 — 최신 시세가 있어도 대체하지 않는다', () => {
    const v = evaluationVerdictFor(productRow(), NO_EVALUATION_CLOSES, ASOF)
    expect(v?.kind).toBe('CLOSE_MISSING')
  })

  it('상환 완료 · 기실현 등재 · 일정 0건이면 null', () => {
    expect(evaluationVerdictFor(productRow({ redemptions: redemption() }), NO_EVALUATION_CLOSES, ASOF)).toBeNull()
    expect(
      evaluationVerdictFor(
        productRow({
          entry_mode: 'REALIZED_ONLY',
          issue_date: null,
          els_underlyings: [],
          redemption_schedules: [],
          redemptions: redemption({ round_no: null, redemption_type: 'MATURITY_GAIN' }),
        }),
        NO_EVALUATION_CLOSES,
        ASOF,
      ),
    ).toBeNull()
    expect(evaluationVerdictFor(productRow({ redemption_schedules: [] }), NO_EVALUATION_CLOSES, ASOF)).toBeNull()
  })

  it('기초자산 0건(UNDERLYING_MISSING)이면 만기 갈래만 산다 — `worstOf`를 부르지 않는다', () => {
    const broken = productRow({ els_underlyings: [] })
    expect(evaluationVerdictFor(broken, NO_EVALUATION_CLOSES, ASOF)).toBeNull()
    expect(evaluationVerdictFor(broken, NO_EVALUATION_CLOSES, '2027-01-05')?.kind).toBe('MATURITY_REACHED')
  })

  it('등록일은 KST로 자른다 — UTC 15:30은 다음 날이다', () => {
    // KST 2026-07-02 등록 = 평가일 당일 → 판정한다
    const sameDay = productRow({ created_at: '2026-07-01T15:30:00+00:00' })
    expect(evaluationVerdictFor(sameDay, NO_EVALUATION_CLOSES, ASOF)?.kind).toBe('CLOSE_MISSING')
    // KST 2026-07-03 등록 = 평가일 다음 날 → 판정하지 않는다
    const nextDay = productRow({ created_at: '2026-07-02T15:00:00+00:00' })
    expect(evaluationVerdictFor(nextDay, NO_EVALUATION_CLOSES, ASOF)).toBeNull()
  })
})

describe('§4.3 evaluationVerdict — 상세 뷰', () => {
  it('조건 충족 — 차수 · 평가일 · D+n · 평가일 W · 배리어', () => {
    const view = detail(productRow(), closesOf([[ASSET_1, R1, '95.000000']]))
    expect(view.evaluationVerdict).toEqual({
      kind: 'EARLY',
      roundNo: 1,
      evaluationDate: R1,
      dDay: -30,
      worstOf: '0.9500',
      barrier: '0.9000',
      missingAssets: null,
      weekendEvaluation: false,
    })
  })

  it('★ 경과 행의 conditionResult는 여전히 null이다 — 별도 필드다(불변식 isPast ⟹ null)', () => {
    const view = detail(productRow(), closesOf([[ASSET_1, R1, '95.000000']]))
    const past = view.schedules.find((s) => s.roundNo === 1)
    expect(past?.isPast).toBe(true)
    expect(past?.conditionResult).toBeNull()
  })

  it('평가일 종가 없음 — 결측 자산의 이름을 싣는다', () => {
    const view = detail(productRow(), NO_EVALUATION_CLOSES)
    expect(view.evaluationVerdict).toMatchObject({
      kind: 'CLOSE_MISSING',
      roundNo: 1,
      worstOf: null,
      barrier: null,
      missingAssets: [{ assetId: ASSET_1, assetName: '자산1' }],
    })
  })

  it('리자드 — 배리어는 L(n)이다', () => {
    const row = productRow({
      redemption_schedules: [
        schedule({ round_no: 1, evaluation_date: R1, lizard_barrier: '0.8000', lizard_coupon_rate: '0.0800' }),
        schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
      ],
    })
    const view = detail(row, closesOf([[ASSET_1, R1, '85.000000']]))
    expect(view.evaluationVerdict).toMatchObject({ kind: 'LIZARD', worstOf: '0.8500', barrier: '0.8000' })
  })

  it('만기 평가일 경과 — W를 싣지 않는다(3일 평균 · RD-08)', () => {
    const view = detail(productRow(), NO_EVALUATION_CLOSES, '2027-01-05')
    expect(view.evaluationVerdict).toEqual({
      kind: 'MATURITY_REACHED',
      roundNo: 2,
      evaluationDate: '2027-01-04',
      dDay: -1,
      worstOf: null,
      barrier: null,
      missingAssets: null,
      weekendEvaluation: false,
    })
  })

  it('이월이면 null — 묻지 않는다(D2)', () => {
    expect(detail(productRow(), closesOf([[ASSET_1, R1, '80.000000']])).evaluationVerdict).toBeNull()
  })

  it('주말로 저장된 평가일은 표식을 단다', () => {
    const row = productRow({
      redemption_schedules: [
        schedule({ round_no: 1, evaluation_date: '2026-07-04' }), // 토
        schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
      ],
    })
    expect(detail(row, NO_EVALUATION_CLOSES).evaluationVerdict?.weekendEvaluation).toBe(true)
  })
})

describe('읽을 수 없는 등록일 — 그 상품만 「등록일 모름」 (DOC-002 DQ-18 ④ · P6 컷 7-7)', () => {
  it("created_at = 'infinity'면 던지지 않는다 — 쌍 선택이 깨지면 전체 보기의 홈이 죽는다", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const broken = productRow({ id: 'broken', created_at: 'infinity' })
      expect(registrationDateOf(broken)).toBeNull()
      // 다른 상품의 쌍은 그대로다
      expect(evaluationClosePairsOf([broken, productRow()], ASOF)).toEqual([{ assetId: ASSET_1, date: R1 }])
      // 비만기 차수는 묻지 않는다(「등록 전」 갈래) · 만기는 묻는다
      expect(evaluationVerdictFor(broken, NO_EVALUATION_CLOSES, ASOF)).toBeNull()
      expect(evaluationVerdictFor(broken, NO_EVALUATION_CLOSES, '2027-01-05')?.kind).toBe('MATURITY_REACHED')
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('DQ-18'))
    } finally {
      spy.mockRestore()
    }
  })
})

