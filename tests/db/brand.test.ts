import { describe, expect, it } from 'vitest'

import { asActive, evaluateCondition, kiStatus, type Active, type ConditionParams } from '@/lib/domain'
import type { ProductListItem, ScheduleItem } from '@/lib/db/queries/map'

import { ASSET_1, OWNER, priceMap, productRow } from './helpers/rows'
import { toProductListItem } from '@/lib/db/queries/map'

/**
 * `Active<T>` 브랜드가 새지 않는가 — 타입 수준 검사
 *
 * **`@ts-expect-error`가 이 파일의 본체다.** 런타임 단언은 부수적이고, 진짜
 * 게이트는 `npm run typecheck`다 — 주석이 붙은 줄이 오류를 내지 **않으면**
 * tsc가 "사용되지 않은 @ts-expect-error"로 실패한다. 즉 방어가 사라지면
 * 테스트가 조용히 통과하는 대신 컴파일이 깨진다.
 *
 * 브랜드는 `unique symbol`이라 **직렬화를 넘지 못한다.** 서버 컴포넌트에서
 * 클라이언트로 값이 넘어가는 순간 사라지므로, 뷰 타입에 브랜드가 들어 있으면
 * 타입은 있다고 말하는데 실제 값에는 없는 상태가 된다.
 */

describe('판정 함수는 asActive를 거친 값만 받는다 (E-05)', () => {
  it('브랜드 없는 객체 리터럴로는 호출할 수 없다', () => {
    // @ts-expect-error — ACTIVE 심볼이 모듈 외부로 나가지 않으므로 리터럴로 만들 수 없다
    evaluateCondition({ worstOf: '0.95', barrier: '0.9000' })

    // @ts-expect-error — kiStatus도 같다
    kiStatus({ kiBarrier: '0.5', kiTouchedAt: null, worstOf: '0.95' })

    expect(true).toBe(true)
  })

  it('Active<T>를 타입 단언 없이 리터럴로 만들 수 없다', () => {
    // @ts-expect-error — 브랜드 속성을 채울 수단이 없다
    const fake: Active<ConditionParams> = { worstOf: '0.9', barrier: '0.9000' }
    expect(fake).toBeDefined()
  })

  it('asActive를 거치면 호출된다 — 방어가 통과 경로를 막지 않는지', () => {
    const params = asActive({ worstOf: '0.95', barrier: '0.9000' }, null)
    expect(evaluateCondition(params)).toBe('EARLY')
  })

  it('상환 완료면 asActive가 null을 준다 — 넘길 값이 존재하지 않는다', () => {
    const params = asActive(
      { worstOf: '0.95', barrier: '0.9000' },
      { redemptionDate: '2026-07-02' },
    )
    expect(params).toBeNull()
  })
})

describe('뷰 타입에 브랜드가 새지 않는다', () => {
  /**
   * 평범한 객체 리터럴이 뷰 타입에 대입되는지로 확인한다. 브랜드가 섞여 들어오면
   * 이 리터럴에 채울 수 없는 속성이 생겨 **컴파일이 실패한다.**
   */
  it('ProductListItem은 순수 직렬화 가능 필드로만 구성된다', () => {
    const plain: ProductListItem = {
      id: 'p1',
      name: '상품',
      ownerId: OWNER,
      ownerName: '소유자',
      principal: '100000000',
      accountType: 'GENERAL',
      status: 'ACTIVE',
      nextEvaluation: {
        roundNo: 1,
        date: '2026-07-02',
        dDay: 2,
        barrier: '0.9000',
      },
      worstOf: '0.9500',
      conditionResult: 'EARLY',
      kiStatus: 'SAFE',
      integrityIssue: null,
      isOwner: true,
    }

    expect(plain.conditionResult).toBe('EARLY')
  })

  it('ScheduleItem도 같다', () => {
    const plain: ScheduleItem = {
      productId: 'p1',
      productName: '상품',
      // v1.8 신설 둘. 이 리터럴이 **전수 대조**이므로 필드가 늘면 여기서 컴파일이
      // 깨진다 — 그것이 이 파일의 목적이다(브랜드가 섞여 들어오면 채울 수 없는
      // 속성이 생긴다). 컷 7이 실제로 그 신호를 받아 두 줄을 더했다.
      ownerId: OWNER,
      ownerName: '소유자',
      roundNo: 1,
      evaluationDate: '2026-07-02',
      dDay: 2,
      barrier: '0.9000',
      hasLizard: false,
      status: 'ACTIVE',
      worstOf: '0.9500',
      conditionResult: 'EARLY',
      integrityIssue: null,
      isPast: false,
    }
    expect(plain.integrityIssue).toBeNull()
  })

  it('실제 매핑 결과가 JSON 왕복을 견딘다', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      '2026-06-30',
      OWNER,
    )

    // 브랜드된 값이 뷰에 들어 있으면 왕복 후 구조가 달라진다
    const roundTripped: unknown = JSON.parse(JSON.stringify(item))
    expect(roundTripped).toEqual(item)
  })

  it('뷰 값을 판정 함수에 되먹일 수 없다', () => {
    const item = toProductListItem(
      productRow(),
      priceMap([{ assetId: ASSET_1, price: '95.000000' }]),
      '2026-06-30',
      OWNER,
    )

    // @ts-expect-error — 뷰는 판정 결과이지 판정 입력이 아니다
    evaluateCondition({ worstOf: item.worstOf, barrier: item.nextEvaluation!.barrier })

    expect(item.worstOf).toBe('0.9500')
  })
})
