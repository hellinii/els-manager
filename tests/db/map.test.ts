import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LatestPrice, ProductRow } from '@/lib/db/queries/load'
import {
  STALE_DAYS,
  attentionReasonsOf,
  bracketLabel,
  isStale,
  toProductDetailView,
  toProductListItem,
  toScheduleItems,
} from '@/lib/db/queries/map'
import { dec } from '@/lib/decimal'
import { deriveDisplay } from '@/lib/format'

import { ASSET_1, ASSET_2, OTHER, OWNER, priceMap, productRow, redemption, schedule } from './helpers/rows'

const ASOF = '2026-06-30'

/**
 * 행 → 뷰 매핑 — DB 없이 검증한다.
 *
 * 핵심이 둘이다.
 *
 * ① **`null`의 원인이 서로 구분되는가.** 같은 필드 조합으로 나타나면 화면이
 *    구분할 수 없고, 특히 무결성 결함이 "시세 없음"으로 표시되면 사용자가
 *    **영원히 오지 않을 시세를 기다린다**.
 * ② **억제가 원인의 범위를 넘지 않는가** (§4.2 입력 기준, v0.8). 결함은 그것이
 *    파괴한 입력을 쓰는 값만 죽여야 한다. 통짜로 죽이면 같은 상품이 계약마다
 *    다르게 보인다.
 */

// 무결성 결함은 console.error로 남긴다(삼키지 않는다). 테스트 출력만 조용히 한다.
let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
})

describe('conditionResult·kiStatus의 null 원인 구분 (§4.2)', () => {
  it('E-01 시세 없음 — ACTIVE, worstOf=null, integrityIssue=null', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: null }]),
      ASOF,
      OWNER,
    )

    expect(item.status).toBe('ACTIVE')
    expect(item.worstOf).toBeNull()
    expect(item.integrityIssue).toBeNull()
    expect(item.conditionResult).toBeNull()
    // 시세가 없어도 KI 배리어가 있으면 등급은 판정 보류다
    expect(item.kiStatus).toBeNull()
  })

  it('E-05 상환 완료 — REDEEMED, 판정 생략, nextEvaluation도 null', () => {
    const item = toProductListItem(
      productRow({ redemptions: redemption() }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )

    expect(item.status).toBe('REDEEMED')
    expect(item.integrityIssue).toBeNull()
    // 시세가 있어도 판정하지 않는다 — 표시값은 상환 실적이다
    expect(item.conditionResult).toBeNull()
    expect(item.kiStatus).toBeNull()
    expect(item.nextEvaluation).toBeNull()
    // 워스트오브 자체는 산출된다(판정만 생략한다)
    expect(item.worstOf).toBe('0.9500')
  })

  it('무결성 결함(기초자산 0건) — ACTIVE + worstOf=null인데 E-01과 구분된다', () => {
    const item = toProductListItem(
      productRow({ els_underlyings: [] }),
      priceMap([]),
      ASOF,
      OWNER,
    )

    expect(item.integrityIssue).toBe('UNDERLYING_MISSING')
    // ★ 여기가 요점 — status·worstOf만 보면 E-01과 완전히 같다
    expect(item.status).toBe('ACTIVE')
    expect(item.worstOf).toBeNull()
    expect(item.conditionResult).toBeNull()
    // ★ 차수 입력은 파괴되지 않았다 — 다음 평가일은 그대로 나온다 (v0.8)
    expect(item.nextEvaluation?.roundNo).toBe(1)
  })

  it('무결성 결함(일정 0건) — SCHEDULE_MISSING', () => {
    const item = toProductListItem(
      productRow({ redemption_schedules: [] }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )

    expect(item.integrityIssue).toBe('SCHEDULE_MISSING')
    // 차수가 없어 사라지는 것들 — 억제가 아니라 자연 결과다
    expect(item.nextEvaluation).toBeNull()
    expect(item.conditionResult).toBeNull()
    // ★ 시세 입력은 온전하므로 살아 있다 (v0.8 입력 기준). 종전에는 둘 다 null이었다.
    expect(item.worstOf).toBe('0.9500')
    expect(item.kiStatus).toBe('SAFE')
  })

  it('UNDERLYING_MISSING은 시세 입력을 파괴한다 — 시세 행이 있어도 무관하다', () => {
    // 기초자산 0건이면 시세 유무와 무관하다. 순서가 없으면 "시세 없음"으로
    // 표시되어 DOC-007 §3.1이 막으려던 화면이 재현된다.
    const item = toProductListItem(
      productRow({ els_underlyings: [] }),
      priceMap([{ assetId: ASSET_1, price: '200.000000' }]),
      ASOF,
      OWNER,
    )

    expect(item.integrityIssue).toBe('UNDERLYING_MISSING')
    expect(item.worstOf).toBeNull()
    expect(item.kiStatus).toBeNull()
  })

  it('결함을 삼키지 않고 기록한다', () => {
    toProductListItem(productRow({ els_underlyings: [] }), priceMap([]), ASOF, OWNER)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('I-07'))
  })

  it('기초자산 0건에서 worstOf를 호출하지 않는다 — 던지지 않는다', () => {
    // worstOf([])는 RangeError를 던진다. 조회 계층이 그 호출을 하지 않는 것이
    // 요점이다 — 던지면 남의 결함 상품 1건이 목록 전체를 죽인다.
    expect(() =>
      toProductListItem(productRow({ els_underlyings: [] }), priceMap([]), ASOF, OWNER),
    ).not.toThrow()
  })
})

describe('판정이 실제로 일어나는 경로', () => {
  it('배리어 충족 시 EARLY', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )
    // 다음 평가일은 2026-07-02(1차), 배리어 0.90, W = 0.95
    expect(item.nextEvaluation?.roundNo).toBe(1)
    expect(item.conditionResult).toBe('EARLY')
    expect(item.kiStatus).toBe('SAFE')
  })

  it('배리어 미달이면 CARRY_OVER', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '80.000000' }]),
      ASOF,
      OWNER,
    )
    expect(item.conditionResult).toBe('CARRY_OVER')
  })

  it('KI 배리어 이하면 BELOW — 조치가 필요한 상태다', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
      ASOF,
      OWNER,
    )
    expect(item.kiStatus).toBe('BELOW')
  })

  it('판정은 반올림 전 정밀도로 한다', () => {
    // W = 89.996 / 100 = 0.89996. 4자리로 먼저 접으면 0.9000이 되어 EARLY가 된다.
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '89.996000' }]),
      ASOF,
      OWNER,
    )
    expect(item.worstOf).toBe('0.9000') // 표시는 접힌 값
    expect(item.conditionResult).toBe('CARRY_OVER') // 판정은 접기 전 값
  })

  it('isOwner는 조회자 기준이다', () => {
    const row = productRow()
    expect(toProductListItem(row, priceMap([]), ASOF, OWNER).isOwner).toBe(true)
    expect(toProductListItem(row, priceMap([]), ASOF, OTHER).isOwner).toBe(false)
  })
})

describe('§4.3 상품 상세', () => {
  const twoAssets = productRow({
    els_underlyings: [
      { asset_id: ASSET_1, base_price: '100.000000', sequence: 1, assets: null },
      { asset_id: ASSET_2, base_price: '200.000000', sequence: 2, assets: null },
    ],
  })

  it('totalRounds는 행 수다 — max(round_no)가 아니다', () => {
    // DB는 1, 2, 99를 허용한다(연속성 V-04는 계약 계층에만 있다)
    const view = toProductDetailView(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-07-02' }),
          schedule({ round_no: 2, evaluation_date: '2027-01-04' }),
          schedule({ round_no: 99, evaluation_date: '2027-07-05' }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )

    expect(view.product.totalRounds).toBe(3)
    expect(view.product.totalRounds).not.toBe(99)
  })

  it('isWorst — 동률이면 전부 true', () => {
    const view = toProductDetailView(
      twoAssets,
      priceMap([
        { assetId: ASSET_1, price: '90.000000' }, // 0.9
        { assetId: ASSET_2, price: '180.000000' }, // 0.9
      ]),
      ASOF,
      OWNER,
    )

    expect(view.underlyings.map((u) => u.isWorst)).toEqual([true, true])
  })

  it('isWorst — 최저 하나만 true', () => {
    const view = toProductDetailView(
      twoAssets,
      priceMap([
        { assetId: ASSET_1, price: '95.000000' }, // 0.95
        { assetId: ASSET_2, price: '180.000000' }, // 0.9
      ]),
      ASOF,
      OWNER,
    )

    expect(view.underlyings.map((u) => u.isWorst)).toEqual([false, true])
  })

  it('isWorst — worstOf가 null이면 전부 false', () => {
    const view = toProductDetailView(
      twoAssets,
      priceMap([
        { assetId: ASSET_1, price: '95.000000' },
        { assetId: ASSET_2, price: null }, // 하나라도 없으면 W = null
      ]),
      ASOF,
      OWNER,
    )

    expect(view.underlyings.map((u) => u.isWorst)).toEqual([false, false])
    // 시세가 있는 쪽의 비율은 그대로 보여준다
    expect(view.underlyings[0].ratio).toBe('0.9500')
    expect(view.underlyings[1].ratio).toBeNull()
  })

  it('expectedGross는 전 차수에 정의된다 — 상환 완료 상품에서도', () => {
    const view = toProductDetailView(
      productRow({ redemptions: redemption() }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )

    // P × (1 + r × m×n / 12) = 1억 × (1 + 0.08 × 6/12) = 104,000,000
    expect(view.schedules[0].expectedGross).toBe('104000000')
    // 2차 = 1억 × (1 + 0.08 × 12/12) = 108,000,000
    expect(view.schedules[1].expectedGross).toBe('108000000')
    // 실제 수령액과는 다른 값이다
    expect(view.redemption?.grossAmount).toBe('104000000')
  })

  it('conditionResult는 적용 차수에만 붙는다', () => {
    const view = toProductDetailView(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
      OWNER,
    )

    expect(view.schedules[0].conditionResult).toBe('EARLY')
    // 2차 배리어로 지금 시세를 판정하면 그 차수가 도래했을 때의 결과인 척한다
    expect(view.schedules[1].conditionResult).toBeNull()
  })

  it('realizedPnl은 음수가 될 수 있다', () => {
    const view = toProductDetailView(
      productRow({
        redemptions: redemption({
          redemption_type: 'MATURITY_LOSS',
          gross_amount: '70000000',
          taxable_income: '0', // 손실 상환의 과세 금융소득은 0이다(절대 규칙 #8)
          round_no: null,
        }),
      }),
      priceMap([]),
      ASOF,
      OWNER,
    )

    expect(view.redemption?.realizedPnl).toBe('-30000000')
    expect(view.redemption?.taxableIncome).toBe('0')
  })

  describe('projection의 null 2경우 — v0.8에서 ②·③이 하나가 됐다', () => {
    it('① 상환 완료', () => {
      const view = toProductDetailView(
        productRow({ redemptions: redemption() }),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        ASOF,
        OWNER,
      )
      expect(view.projection).toBeNull()
    })

    it('② 적용 차수 없음 — 일정 0건', () => {
      const view = toProductDetailView(
        productRow({ redemption_schedules: [] }),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        ASOF,
        OWNER,
      )
      expect(view.projection).toBeNull()
      expect(view.product.totalRounds).toBe(0)
    })

    it('무결성 결함은 사유가 아니다 — UNDERLYING_MISSING도 projection을 낸다', () => {
      // v0.6은 "② integrityIssue ≠ null"로 적었고 구현이 그대로 억제했다.
      // projection은 원금·쿠폰율·평가주기·차수만 쓰고 **시세를 쓰지 않으므로**
      // 기초자산 0건과 무관하다 — §4.6이 같은 상품의 과세 기여를 내는 것과
      // 같은 근거이며, 종전에는 두 계약이 그 지점에서 갈려 있었다.
      const view = toProductDetailView(
        productRow({ els_underlyings: [] }),
        priceMap([]),
        ASOF,
        OWNER,
      )

      expect(view.product.integrityIssue).toBe('UNDERLYING_MISSING')
      expect(view.projection).not.toBeNull()
      expect(view.projection!.appliedRoundNo).toBe(1)
      expect(view.projection!.expectedGross).toBe('104000000')
      expect(view.projection!.expectedTaxableIncome).toBe('4000000')
      expect(view.projection!.attributionYear).toBe(2026)
      // 시세가 파괴한 것은 그대로 죽는다
      expect(view.schedules[0].conditionResult).toBeNull()
    })

    it('② 적용 차수 없음 — 전 차수 경과 미상환 (v0.5의 주석이 놓친 경우)', () => {
      const view = toProductDetailView(
        productRow(),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        '2028-01-01', // 두 차수 모두 경과했고 상환 레코드가 없다
        OWNER,
      )
      expect(view.projection).toBeNull()
      expect(view.schedules.every((s) => s.isPast)).toBe(true)
    })

    it('정상 경로에서는 값이 있다', () => {
      const view = toProductDetailView(
        productRow(),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        ASOF,
        OWNER,
      )
      expect(view.projection).not.toBeNull()
      expect(view.projection!.appliedRoundNo).toBe(1)
      expect(view.projection!.expectedGross).toBe('104000000')
      expect(view.projection!.expectedTaxableIncome).toBe('4000000')
      expect(view.projection!.attributionYear).toBe(2026)
    })

    it('비과세 계좌의 예상 과세소득은 0이다', () => {
      const view = toProductDetailView(
        productRow({ account_type: 'TAX_FREE' }),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        ASOF,
        OWNER,
      )
      expect(view.projection!.expectedTaxableIncome).toBe('0')
    })
  })
})

describe('§4.4 평가일정 — 좁힌 유니온', () => {
  it('UNDERLYING_MISSING만 나타난다', () => {
    const items = toScheduleItems(
      productRow({ els_underlyings: [] }),
      priceMap([]),
      ASOF,
    )
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.integrityIssue === 'UNDERLYING_MISSING')).toBe(true)
  })

  it('일정 0건이면 행 자체가 생기지 않는다 — SCHEDULE_MISSING은 도달 불가', () => {
    const items = toScheduleItems(
      productRow({ redemption_schedules: [] }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
    )
    expect(items).toEqual([])
  })

  it('hasLizard는 차수별이다', () => {
    const items = toScheduleItems(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-07-02' }),
          schedule({
            round_no: 2,
            evaluation_date: '2027-01-04',
            lizard_barrier: '0.8000',
            lizard_coupon_rate: '0.0200',
          }),
        ],
      }),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      ASOF,
    )
    expect(items.map((i) => i.hasLizard)).toEqual([false, true])
  })
})

describe('§4.5 isStale', () => {
  it('시세 행이 없으면 false — 경과 판단 대상이 아니다', () => {
    expect(isStale({ asOfDate: null, asOf: '2026-07-27' })).toBe(false)
  })

  it(`${STALE_DAYS}일 미만은 false`, () => {
    expect(isStale({ asOfDate: '2026-07-27', asOf: '2026-07-27' })).toBe(false)
    expect(isStale({ asOfDate: '2026-07-23', asOf: '2026-07-27' })).toBe(false)
  })

  it(`${STALE_DAYS}일 이상은 true`, () => {
    expect(isStale({ asOfDate: '2026-07-22', asOf: '2026-07-27' })).toBe(true)
  })

  it('금요일 종가는 다음 주 수요일까지 정상이다 — 3일 기준이 틀리는 이유', () => {
    // 2026-07-24는 금요일. 월요일(27일)에 3일 경과다.
    expect(isStale({ asOfDate: '2026-07-24', asOf: '2026-07-27' })).toBe(false)
    // 수요일(29일)까지 정상
    expect(isStale({ asOfDate: '2026-07-24', asOf: '2026-07-29' })).toBe(true)
    expect(isStale({ asOfDate: '2026-07-24', asOf: '2026-07-28' })).toBe(false)
  })
})

describe('§4.1 attentionItems', () => {
  it('UNDERLYING_MISSING은 시세 파생 사유를 가린다 — 그것뿐이다', () => {
    // 기초자산 0건이면 KI도 워스트오브도 산출할 수 없고, 기본 픽스처의 두 차수는
    // 미경과다. 그래서 결과가 결함 하나다 — 다른 사유를 **억제해서**가 아니다.
    expect(
      attentionReasonsOf(productRow({ els_underlyings: [] }), priceMap([]), ASOF),
    ).toEqual(['UNDERLYING_MISSING'])
  })

  it('상환 완료 상품은 조치 대상이 아니다', () => {
    expect(
      attentionReasonsOf(
        productRow({ redemptions: redemption() }),
        priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
        ASOF,
      ),
    ).toEqual([])
  })

  it('KI_BELOW — 사용자 확인이 필요한 유일한 상태 (D-04)', () => {
    expect(
      attentionReasonsOf(
        productRow(),
        priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
        ASOF,
      ),
    ).toContain('KI_BELOW')
  })

  it('KI_NEAR — 배리어 × 1.1 이하', () => {
    // 배리어 0.5 → 주의 구간은 0.5 초과 ~ 0.55 이하
    expect(
      attentionReasonsOf(
        productRow(),
        priceMap([{ assetId: ASSET_1, price: '54.000000' }]),
        ASOF,
      ),
    ).toContain('KI_NEAR')
  })

  it('KI_TOUCHED가 BELOW보다 앞선다', () => {
    const reasons = attentionReasonsOf(
      productRow({ ki_touched_at: '2026-03-15' }),
      priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
      ASOF,
    )
    expect(reasons).toContain('KI_TOUCHED')
    expect(reasons).not.toContain('KI_BELOW')
  })

  it('PRICE_MISSING', () => {
    expect(
      attentionReasonsOf(productRow(), priceMap([{ assetId: ASSET_1, price: null }]), ASOF),
    ).toContain('PRICE_MISSING')
  })

  it('EVALUATION_PASSED — 경과 미상환', () => {
    expect(
      attentionReasonsOf(
        productRow(),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        '2028-01-01',
      ),
    ).toContain('EVALUATION_PASSED')
  })
})

describe('§4.6 bracketLabel 합성', () => {
  // 만·억 단위 렌더러 자체는 `tests/app/format.test.ts`가 본다 —
  // 구현이 `lib/format/money.ts`로 이관되었고, 여기서는 그것을 쓰는 **합성**만 본다.
  it('중간 구간은 하한~다음 하한', () => {
    expect(
      bracketLabel({ lowerBound: dec('14000000'), nextLowerBound: dec('50000000') }),
    ).toBe('1,400만~5,000만')
  })

  it('최상단은 "초과"', () => {
    expect(
      bracketLabel({ lowerBound: dec('1000000000'), nextLowerBound: null }),
    ).toBe('10억 초과')
  })

  it('최하단(하한 0)은 "이하" — P3a에서 정했다', () => {
    expect(
      bracketLabel({ lowerBound: dec('0'), nextLowerBound: dec('14000000') }),
    ).toBe('1,400만 이하')
  })
})

// ---------------------------------------------------------------------------
// §4.2 입력 기준 — 억제는 결함이 파괴한 입력을 쓰는 값에만 미친다 (v0.8)
// ---------------------------------------------------------------------------

describe('입력 기준 — 결함이 파괴한 입력만 죽는다', () => {
  describe('SCHEDULE_MISSING은 차수 입력만 파괴한다', () => {
    it('worstOf·kiStatus가 산출된다', () => {
      const item = toProductListItem(
        productRow({ redemption_schedules: [] }),
        priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
        ASOF,
        OWNER,
      )

      expect(item.integrityIssue).toBe('SCHEDULE_MISSING')
      expect(item.worstOf).toBe('0.9500')
      expect(item.kiStatus).toBe('SAFE')
    })

    it('등급이 입력에 반응한다 — 기본값을 넣은 것이 아니다', () => {
      // 'SAFE'만 보면 "판정을 건너뛰고 기본값을 넣었다"와 구분되지 않는다.
      const item = toProductListItem(
        productRow({ redemption_schedules: [] }),
        priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
        ASOF,
        OWNER,
      )
      expect(item.kiStatus).toBe('BELOW')
    })

    it('상세의 ratio·isWorst도 산출된다 — 종전에는 ratio만 나오고 isWorst는 전부 false였다', () => {
      const view = toProductDetailView(
        productRow({
          redemption_schedules: [],
          els_underlyings: [
            { asset_id: ASSET_1, base_price: '100.000000', sequence: 1, assets: null },
            { asset_id: ASSET_2, base_price: '200.000000', sequence: 2, assets: null },
          ],
        }),
        priceMap([
          { assetId: ASSET_1, price: '95.000000' }, // 0.95
          { assetId: ASSET_2, price: '90.000000' }, // 0.45
        ]),
        ASOF,
        OWNER,
      )

      expect(view.underlyings.map((u) => u.ratio)).toEqual(['0.9500', '0.4500'])
      // ★ ratio가 나오는데 isWorst만 전부 false인 것은 그 자체로 내부 모순이었다
      expect(view.underlyings.map((u) => u.isWorst)).toEqual([false, true])
      // 차수가 없어 사라지는 것은 그대로다
      expect(view.projection).toBeNull()
      expect(view.schedules).toEqual([])
    })

    it('E-05는 별개 축이다 — 상환 완료면 kiStatus가 다시 null이다', () => {
      // 위 표의 "산출"은 결함 축이 막지 않는다는 뜻이지 값이 반드시 나온다는
      // 뜻이 아니다. 두 축이 겹치면 둘 다 걸린다.
      const item = toProductListItem(
        productRow({ redemption_schedules: [], redemptions: redemption() }),
        priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
        ASOF,
        OWNER,
      )

      expect(item.integrityIssue).toBe('SCHEDULE_MISSING')
      expect(item.status).toBe('REDEEMED')
      expect(item.kiStatus).toBeNull()
    })
  })

  describe('UNDERLYING_MISSING은 시세 입력만 파괴한다', () => {
    it('시세가 있어도 worstOf·kiStatus는 살아나지 않는다', () => {
      // 기초자산 행이 0건이면 그 시세가 어느 자산의 것인지 말할 근거가 없다.
      const item = toProductListItem(
        productRow({ els_underlyings: [] }),
        priceMap([{ assetId: ASSET_1, price: '200.000000' }]),
        ASOF,
        OWNER,
      )

      expect(item.worstOf).toBeNull()
      expect(item.kiStatus).toBeNull()
      expect(item.nextEvaluation?.roundNo).toBe(1) // 차수는 파괴되지 않았다
    })

    it('노낙인이어도 NO_KI로 새지 않는다', () => {
      // kiStatus는 kiBarrier == null이면 **시세를 보기 전에** 'NO_KI'를 준다.
      // 명시적 절단이 없으면 정의가 깨진 상품에 화면이 "노낙인 = 안전"을 말한다.
      const item = toProductListItem(
        productRow({ els_underlyings: [], ki_barrier: null }),
        priceMap([]),
        ASOF,
        OWNER,
      )
      expect(item.kiStatus).toBeNull()
    })

    it('KI 터치가 확정돼 있어도 TOUCHED로 새지 않는다', () => {
      // 같은 이유 — 'TOUCHED'도 worstOf 검사보다 먼저 반환된다.
      const item = toProductListItem(
        productRow({ els_underlyings: [], ki_touched_at: '2026-03-15' }),
        priceMap([]),
        ASOF,
        OWNER,
      )
      expect(item.kiStatus).toBeNull()
    })

    it('차수별 expectedGross는 그대로다 — 계약 조건에서만 나오는 값이다', () => {
      const view = toProductDetailView(
        productRow({ els_underlyings: [] }),
        priceMap([]),
        ASOF,
        OWNER,
      )
      expect(view.schedules.map((x) => x.expectedGross)).toEqual([
        '104000000',
        '108000000',
      ])
    })
  })

  describe('§4.1 조치 사유 — 결함이 다른 사유를 가리지 않는다', () => {
    it('SCHEDULE_MISSING + KI 하회 → 둘 다 보고한다', () => {
      // 일정 0건 상품은 §4.4에 행이 없고 upcomingEvaluations에도 없다.
      // 억제하면 이 KI 하회가 시스템 어디에서도 보이지 않는다.
      expect(
        attentionReasonsOf(
          productRow({ redemption_schedules: [] }),
          priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
          ASOF,
        ),
      ).toEqual(['SCHEDULE_MISSING', 'KI_BELOW'])
    })

    it('결함이 먼저 온다 — 순서가 화면의 해석을 정한다', () => {
      const reasons = attentionReasonsOf(
        productRow({ redemption_schedules: [] }),
        priceMap([{ assetId: ASSET_1, price: '45.000000' }]),
        ASOF,
      )
      expect(reasons[0]).toBe('SCHEDULE_MISSING')
    })

    it('UNDERLYING_MISSING + 경과 → EVALUATION_PASSED도 보고한다', () => {
      // overdueEvaluations의 입력은 (schedules, asOf, redemption)뿐 — 시세가 없다.
      // 경과 미상환(E-07)과 결함 수정(SCR-204)은 서로 다른 조치다.
      expect(
        attentionReasonsOf(
          productRow({ els_underlyings: [] }),
          priceMap([]),
          '2028-01-01',
        ),
      ).toEqual(['UNDERLYING_MISSING', 'EVALUATION_PASSED'])
    })

    it('UNDERLYING_MISSING은 PRICE_MISSING을 내지 않는다', () => {
      // "시세가 수집되면 해소된다"는 약속인데, 기초자산 0건에서 그것은 영원히
      // 오지 않을 시세를 기다리게 하는 바로 그 표시다(DOC-007 §3.1).
      expect(
        attentionReasonsOf(productRow({ els_underlyings: [] }), priceMap([]), ASOF),
      ).not.toContain('PRICE_MISSING')
    })

    it('SCHEDULE_MISSING + 시세 없음은 진짜 E-01이다 — PRICE_MISSING을 낸다', () => {
      expect(
        attentionReasonsOf(
          productRow({ redemption_schedules: [] }),
          priceMap([{ assetId: ASSET_1, price: null }]),
          ASOF,
        ),
      ).toEqual(['SCHEDULE_MISSING', 'PRICE_MISSING'])
    })

    it('상환 완료여도 결함은 보고한다 — 상환이 결함을 해소하지 않는다', () => {
      expect(
        attentionReasonsOf(
          productRow({ els_underlyings: [], redemptions: redemption() }),
          priceMap([]),
          ASOF,
        ),
      ).toEqual(['UNDERLYING_MISSING'])
    })
  })
})

// ---------------------------------------------------------------------------
// 목록 ↔ 상세의 판정 동일성 — §4.3 판정 삼종 (v1.4, P4 컷 3)
// ---------------------------------------------------------------------------

/**
 * **`deriveDisplay()`가 두 뷰에서 같은 답을 내는가.**
 *
 * §4.2 우선순위표(무결성 결함 > E-05 > E-01)는 다섯 화면이 하는 판정이고 구현은
 * `lib/format/derived.ts` 하나다. 그런데 「같은 함수를 쓴다」는 **같은 입력을
 * 받는다는 뜻이 아니다** — v1.3까지 상세 뷰에는 `status`·`worstOf`가 없어서
 * SCR-202가 `redemption == null`과 `isWorst` 탐색으로 둘을 합성해야 했고, 그
 * 합성은 화면 안에 있으므로 어떤 스위트도 볼 수 없었다(AQ-23).
 *
 * v1.4가 뷰에 셋을 담았으므로 이제 **한 행을 두 매퍼에 넣고 같은 함수를 걸어**
 * 대조할 수 있다. 이 파일이 순수 모듈만 다루므로 DB도 Next도 없다.
 *
 * `deriveDisplay`를 import하는 것이 `lib/db` 테스트로서 이상해 보이지만, 확인
 * 대상은 포매터가 아니라 **두 뷰가 그 포매터에 같은 것을 준다**는 매핑의 성질이다.
 *
 * ## 음성 대조 3건 — 세 필드가 각각 무게를 진다
 *
 * 상세 매퍼의 한 줄씩 깨뜨려 빨간불을 확인하고 되돌렸다. 어느 필드를 틀리게 해도
 * 무언가가 실패한다는 것이 이 describe가 항진명제가 아님을 뜻한다.
 *
 * | 깨뜨린 것 | 실패한 케이스 |
 * |---|---|
 * | `status`를 늘 `'ACTIVE'`로 | 3건 — `REDEEMED`, 일정 0건 + 상환 완료, 상환 완료의 워스트오브 |
 * | `kiStatus`를 늘 `null`로 | 1건 — `VALUED` |
 * | `worstOf`를 늘 `null`로 | 4건 |
 *
 * `kiStatus`가 1건뿐인 이유는 다른 네 케이스에서 그 값이 원래 `null`이기 때문이다
 * (상환 완료·결함·시세 없음). 즉 **`VALUED` 케이스가 그 필드의 유일한 대조점**이며
 * 그것을 지우면 `kiStatus`는 검증되지 않는다.
 */
describe('목록과 상세가 같은 판정을 낸다 (§4.3 판정 삼종)', () => {
  /** §4.2 우선순위가 실제로 갈리는 다섯 경우. 각각 다른 `kind`를 내야 한다. */
  const CASES: Array<{ label: string; row: ProductRow; prices: Map<string, LatestPrice> }> = [
    {
      label: 'VALUED — 시세가 있고 미상환',
      row: productRow(),
      prices: priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
    },
    {
      label: 'PRICE_MISSING — E-01',
      row: productRow(),
      prices: priceMap([{ assetId: ASSET_1, price: null }]),
    },
    {
      label: 'REDEEMED — E-05',
      row: productRow({ redemptions: redemption() }),
      prices: priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
    },
    {
      label: 'INTEGRITY — 기초자산 0건',
      row: productRow({ els_underlyings: [] }),
      prices: priceMap([]),
    },
    {
      label: 'INTEGRITY — 일정 0건이 상환 완료를 이긴다',
      row: productRow({ redemption_schedules: [], redemptions: redemption() }),
      prices: priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
    },
  ]

  it.each(CASES)('$label', ({ row, prices }) => {
    const item = toProductListItem(row, prices, ASOF, OWNER)
    const view = toProductDetailView(row, prices, ASOF, OWNER)

    // 세 필드가 값으로 같다 — 여기가 어긋나면 아래 판정이 우연히 같을 수 있다
    expect(view.product.status).toBe(item.status)
    expect(view.product.worstOf).toBe(item.worstOf)
    expect(view.product.kiStatus).toBe(item.kiStatus)
    expect(view.product.integrityIssue).toBe(item.integrityIssue)

    // 그러므로 우선순위 판정도 같다
    expect(deriveDisplay(view.product)).toEqual(deriveDisplay(item))
  })

  it('다섯 경우가 실제로 서로 다른 판정을 낸다', () => {
    /*
     * ★ 이 단언이 위의 `it.each`를 항진명제에서 구한다. 픽스처가 전부 같은
     * `kind`를 내면 「두 뷰가 같다」는 자동으로 참이고 우선순위는 한 번도
     * 시험되지 않는다. `INTEGRITY`가 둘이므로 네 종류가 나와야 한다.
     */
    const kinds = CASES.map(
      ({ row, prices }) => deriveDisplay(toProductListItem(row, prices, ASOF, OWNER)).kind,
    )
    expect(kinds).toEqual([
      'VALUED',
      'PRICE_MISSING',
      'REDEEMED',
      'INTEGRITY',
      'INTEGRITY',
    ])
  })

  it('상환 완료 상품도 워스트오브를 갖는다 — 두 축 어디에도 막히지 않는다', () => {
    // §4.2 v0.8의 확인 사항이며, 상세 화면이 그 값을 표시하는 근거다.
    const view = toProductDetailView(
      productRow({ redemptions: redemption() }),
      priceMap([{ assetId: ASSET_1, price: '120.000000' }]),
      ASOF,
      OWNER,
    )
    expect(view.product.status).toBe('REDEEMED')
    expect(view.product.worstOf).toBe('1.2000')
    // 죽는 것은 **판정값**이다.
    expect(view.product.kiStatus).toBeNull()
  })
})
