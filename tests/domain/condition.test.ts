import { describe, expect, it } from 'vitest'
import { evaluateCondition } from '@/lib/domain/condition'
import { worstOf } from '@/lib/domain/worstOf'
import { TC22_UNDERLYINGS } from '../fixtures/products'
import { expectAmount } from '../fixtures/assert'

/** DOC-007 §10.7 — 조건 판정 */

describe('조건 판정 (DOC-007 §10.7)', () => {
  it('TC-19: W = 0.92, B(1) = 0.90 → 조기상환 충족', () => {
    expect(
      evaluateCondition({ worstOf: '0.92', barrier: '0.90' }),
    ).toBe('EARLY')
  })

  it('TC-20: W = 0.87, B(1) = 0.90, L(1) = 0.85 → 리자드 충족', () => {
    expect(
      evaluateCondition({
        worstOf: '0.87',
        barrier: '0.90',
        lizardBarrier: '0.85',
      }),
    ).toBe('LIZARD')
  })

  it('TC-21: KI 터치 + lizard_requires_no_ki = true → 리자드 미충족, 이월', () => {
    expect(
      evaluateCondition({
        worstOf: '0.87',
        barrier: '0.90',
        lizardBarrier: '0.85',
        lizardRequiresNoKi: true,
        kiBarrier: '0.50',
        kiTouchedAt: '2026-03-15',
      }),
    ).toBe('CARRY_OVER')
  })

  it('TC-22: 기초자산 3종 중 1종 시세 없음 → W = null, 판정 보류', () => {
    const w = worstOf(TC22_UNDERLYINGS)
    expect(w).toBeNull()

    expect(evaluateCondition({ worstOf: w, barrier: '0.90' })).toBeNull()
  })
})

describe('판정 우선순위 (DOC-007 §3.3)', () => {
  it('조기상환 조건이 충족되면 리자드를 평가하지 않는다', () => {
    // 리자드 배리어도 넘지만 조기상환이 우선한다
    expect(
      evaluateCondition({
        worstOf: '0.95',
        barrier: '0.90',
        lizardBarrier: '0.85',
      }),
    ).toBe('EARLY')
  })

  it('배리어와 정확히 같으면 조기상환이다 (W ≥ B)', () => {
    expect(evaluateCondition({ worstOf: '0.90', barrier: '0.90' })).toBe('EARLY')
  })

  it('리자드 배리어와 정확히 같으면 리자드다 (W ≥ L)', () => {
    expect(
      evaluateCondition({
        worstOf: '0.85',
        barrier: '0.90',
        lizardBarrier: '0.85',
      }),
    ).toBe('LIZARD')
  })

  it('리자드 배리어 미달이면 이월한다', () => {
    expect(
      evaluateCondition({
        worstOf: '0.84',
        barrier: '0.90',
        lizardBarrier: '0.85',
      }),
    ).toBe('CARRY_OVER')
  })

  it('해당 차수에 리자드가 없으면 이월한다', () => {
    expect(evaluateCondition({ worstOf: '0.87', barrier: '0.90' })).toBe(
      'CARRY_OVER',
    )
  })
})

describe('리자드의 KI 요구 조건 (DOC-007 §3.3, E-06)', () => {
  it('KI 미터치면 requires_no_ki = true여도 리자드가 충족된다', () => {
    expect(
      evaluateCondition({
        worstOf: '0.87',
        barrier: '0.90',
        lizardBarrier: '0.85',
        lizardRequiresNoKi: true,
        kiBarrier: '0.50',
        kiTouchedAt: null,
      }),
    ).toBe('LIZARD')
  })

  it('requires_no_ki = false면 KI 터치와 무관하게 충족된다', () => {
    expect(
      evaluateCondition({
        worstOf: '0.87',
        barrier: '0.90',
        lizardBarrier: '0.85',
        lizardRequiresNoKi: false,
        kiBarrier: '0.50',
        kiTouchedAt: '2026-03-15',
      }),
    ).toBe('LIZARD')
  })

  it('E-06: 노낙인 상품은 KI 요구 조건을 항상 충족으로 처리한다', () => {
    expect(
      evaluateCondition({
        worstOf: '0.87',
        barrier: '0.90',
        lizardBarrier: '0.85',
        lizardRequiresNoKi: true,
        kiBarrier: null,
        kiTouchedAt: null,
      }),
    ).toBe('LIZARD')
  })
})

describe('워스트오브 (DOC-007 §3.1)', () => {
  it('기준가 대비 비율이 가장 낮은 자산의 값이다', () => {
    // 0.95 / 0.96 / 0.90 → 0.90
    expectAmount(
      worstOf([
        { basePrice: '100', currentPrice: '95' },
        { basePrice: '250', currentPrice: '240' },
        { basePrice: '50', currentPrice: '45' },
      ]),
      '0.9',
    )
  })

  it('통화가 달라도 환율 변환 없이 비율만으로 비교한다 (D-03)', () => {
    // USD 표시 자산과 KRW 표시 자산이 섞여 있어도 비율에서 통화가 상쇄된다
    expectAmount(
      worstOf([
        { basePrice: '412.55', currentPrice: '391.9225' }, // USD, 0.95
        { basePrice: '2650', currentPrice: '2597' }, // KRW, 0.98
      ]),
      '0.95',
    )
  })
})
