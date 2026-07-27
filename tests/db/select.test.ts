import { describe, expect, it } from 'vitest'

import {
  ELS_PRODUCT_COLUMNS,
  PRICE_COLUMNS,
  SCHEDULE_COLUMNS,
  SERVER_MAX_ROWS,
  TRUNCATION_PROBE_LIMIT,
  USER_COLUMNS,
  assertNotTruncated,
  defineColumns,
  embed,
  selectList,
} from '@/lib/db/select'

/**
 * 열 사양 → select 문자열·행 타입 — DOC-011 §4.0 Q-08
 *
 * **`@ts-expect-error`가 핵심 게이트다.** 캐스팅 누락은 값 단언으로 잡을 수
 * 없다 — `numeric(15,0)`은 15자리까지 float64로 정확히 표현되므로 값이 그럴싸하게
 * 맞아떨어진다. 그래서 타입으로만 막고, 그 방어가 사라지면 `npm run typecheck`가
 * "사용되지 않은 @ts-expect-error"로 실패한다.
 */

describe('캐스트 목록이 열 사양에서 파생된다', () => {
  it('text 열에만 ::text가 붙는다', () => {
    expect(selectList(SCHEDULE_COLUMNS)).toBe(
      'round_no,evaluation_date,barrier::text,lizard_barrier::text,lizard_coupon_rate::text,lizard_requires_no_ki',
    )
  })

  it('금액·비율 열 전부가 캐스팅된다', () => {
    const list = selectList(ELS_PRODUCT_COLUMNS)
    for (const column of ['principal', 'annual_coupon_rate', 'ki_barrier']) {
      expect(list).toContain(`${column}::text`)
    }
  })

  it('개수를 세는 정수는 캐스팅하지 않는다', () => {
    const list = selectList(ELS_PRODUCT_COLUMNS)
    expect(list).toContain('evaluation_period_months')
    expect(list).not.toContain('evaluation_period_months::text')
  })

  it('users는 email을 담지 않는다 (D9)', () => {
    const list = selectList(USER_COLUMNS)
    expect(list).toBe('id,display_name')
    expect(list).not.toContain('email')
  })

  it('별칭을 쓰지 않는다 — 응답 키가 열 이름과 같아야 행 타입과 어긋나지 않는다', () => {
    // `alias:column` 형태가 없어야 한다. `::text`는 캐스팅이므로 대상이 아니다.
    expect(selectList(PRICE_COLUMNS)).not.toMatch(/(?:^|,)[a-z_]+:[^:]/)
    expect(selectList(PRICE_COLUMNS)).toBe('as_of_date,price::text,source')
  })

  it('임베드는 안쪽 목록을 그대로 감싼다', () => {
    expect(embed('asset_prices', selectList(PRICE_COLUMNS))).toBe(
      'asset_prices(as_of_date,price::text,source)',
    )
    expect(embed('els_products', 'id', { modifier: '!inner' })).toBe(
      'els_products!inner(id)',
    )
  })
})

describe('캐스팅 누락은 타입이 막는다', () => {
  it('금액 열을 raw로 두면 호출 지점에서 거부된다', () => {
    // 오류는 인자 전체(교차 타입 불일치)에서 보고되므로 호출 줄에 붙는다.
    // 오류 메시지가 누락된 열 이름("principal")을 그대로 보여준다.
    // @ts-expect-error — principal은 numeric이므로 'text'여야 한다
    defineColumns('els_products', {
      id: 'raw',
      principal: 'raw',
    })

    expect(true).toBe(true)
  })

  it('존재하지 않는 열은 거부된다 — 스키마 드리프트 감지', () => {
    defineColumns('els_products', {
      // @ts-expect-error — total_rounds는 DQ-05로 삭제되었다
      total_rounds: 'raw',
    })

    expect(true).toBe(true)
  })

  it('개수를 세는 정수는 raw가 허용된다 — 방어가 정상 경로를 막지 않는지', () => {
    const spec = defineColumns('els_underlyings', {
      asset_id: 'raw',
      sequence: 'raw',
      base_price: 'text',
    })
    expect(selectList(spec)).toBe('asset_id,sequence,base_price::text')
  })
})

describe('절단 감지 — Q-06', () => {
  it('요청 상한은 서버 상한보다 하나 크다', () => {
    // === 1000 으로 감지하면 정확히 1000행인 정상 결과를 오탐한다
    expect(TRUNCATION_PROBE_LIMIT).toBe(SERVER_MAX_ROWS + 1)
  })

  it('상한 이하는 통과한다', () => {
    expect(() =>
      assertNotTruncated(new Array(SERVER_MAX_ROWS).fill(0), '테스트'),
    ).not.toThrow()
  })

  it('상한을 넘으면 던진다 — 잘린 목록을 반환하지 않는다', () => {
    expect(() =>
      assertNotTruncated(new Array(SERVER_MAX_ROWS + 1).fill(0), '평가일정'),
    ).toThrow(/평가일정.*상한/)
  })

  it('오류가 AQ-09를 가리킨다 — 도달했다면 페이지네이션 신호다', () => {
    expect(() =>
      assertNotTruncated(new Array(TRUNCATION_PROBE_LIMIT).fill(0), '목록'),
    ).toThrow(/AQ-09/)
  })
})
