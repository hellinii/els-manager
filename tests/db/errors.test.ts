import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAPPED_CONSTRAINTS,
  constraintNameOf,
  failDb,
  mapDbError,
} from '@/lib/db/mutations/errors'
import { fail, ok, okVoid, unauthenticated } from '@/lib/db/mutations/result'
import { guardInput, guardSystem, guardSystemAsync } from '@/lib/db/mutations/guard'

import {
  CHECK_KI_PAIR,
  DATE_SYNTAX,
  FK_REDEMPTION_MISSING_PARENT,
  FK_REDEMPTION_RESTRICT,
  LENGTH_OVERFLOW,
  NOT_NULL_CURRENCY,
  NUMERIC_OVERFLOW,
  PERMISSION_DENIED,
  RLS_VIOLATION,
  TRIGGER_I16_AFTER_FIX,
  TRIGGER_I16_BEFORE_FIX,
  UNIQUE_ASSET_NAME_MARKET,
} from '../fixtures/db-errors'

/**
 * 오류 매핑 — DOC-011 §3.2.1·§3.2.2
 *
 * **픽스처는 실측값이다**(`tests/fixtures/db-errors.ts`). 형태를 손으로 지으면
 * 매핑이 자기가 상상한 본문에 대해서만 옳고, 실제 경로에서는 전부 `INTERNAL`로
 * 떨어질 수 있다 — 그 상태에서도 이 파일은 초록색이 된다.
 */

let logged: string[]

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('제약 이름 추출 — 채널이 둘이다', () => {
  it('표준 제약은 message에서 나온다', () => {
    expect(constraintNameOf(CHECK_KI_PAIR)).toBe('els_products_ki_pair_check')
    expect(constraintNameOf(UNIQUE_ASSET_NAME_MARKET)).toBe('assets_name_market_key')
    expect(constraintNameOf(FK_REDEMPTION_RESTRICT)).toBe('redemptions_els_id_fkey')
  })

  it('plpgsql RAISE는 detail 첫 줄에서 나온다', () => {
    expect(constraintNameOf(TRIGGER_I16_AFTER_FIX)).toBe(
      'asset_prices_coordinates_immutable',
    )
  })

  it('detail의 둘째 줄 이후는 사람이 읽는 설명이므로 무시된다', () => {
    expect(
      constraintNameOf({
        code: '23514',
        message: '한글 문구',
        details: 'constraint=els_products_redeemed_immutable\n상환을 먼저 취소한다.',
        hint: null,
      }),
    ).toBe('els_products_redeemed_immutable')
  })

  it('detail이 표준 문구면 이름으로 오인하지 않는다', () => {
    // FK의 details("Key is still referenced …")는 constraint= 형식이 아니다
    expect(
      constraintNameOf({ code: '23503', message: '무명', details: 'Key is still referenced from table "x".', hint: null }),
    ).toBeNull()
  })

  it('어느 채널에도 없으면 null이다 — 5단계 이전의 I-16이 그 상태다', () => {
    expect(constraintNameOf(TRIGGER_I16_BEFORE_FIX)).toBeNull()
  })
})

describe('SQLSTATE 기본값', () => {
  const cases = [
    { body: UNIQUE_ASSET_NAME_MARKET, code: 'CONFLICT' },
    { body: FK_REDEMPTION_RESTRICT, code: 'CONFLICT' },
    { body: CHECK_KI_PAIR, code: 'VALIDATION_FAILED' },
    { body: RLS_VIOLATION, code: 'FORBIDDEN' },
    { body: PERMISSION_DENIED, code: 'FORBIDDEN' },
    { body: LENGTH_OVERFLOW, code: 'VALIDATION_FAILED' },
    { body: NUMERIC_OVERFLOW, code: 'VALIDATION_FAILED' },
    { body: DATE_SYNTAX, code: 'VALIDATION_FAILED' },
    { body: NOT_NULL_CURRENCY, code: 'VALIDATION_FAILED' },
  ] as const

  it.each(cases)('$body.code → $code', ({ body, code }) => {
    expect(mapDbError(body, '시험').code).toBe(code)
  })

  it('날짜 형식(22007)이 INTERNAL로 떨어지지 않는다', () => {
    // 22P02만 사상하면 이 케이스가 시스템 오류로 보고된다 — 실측이 고친 지점이다
    expect(mapDbError(DATE_SYNTAX, '시험').code).toBe('VALIDATION_FAILED')
  })

  it('알 수 없는 SQLSTATE는 INTERNAL이고 조용히 넘기지 않는다', () => {
    const mapped = mapDbError({ code: '40001', message: 'deadlock detected' }, '시험')
    expect(mapped.code).toBe('INTERNAL')
    expect(mapped.fields).toBeUndefined()
    expect(logged.join('\n')).toContain('분류되지 않은 DB 오류')
  })
})

describe('제약 이름이 fields를 결정한다', () => {
  it('I-11 → kiObservation', () => {
    const mapped = mapDbError(CHECK_KI_PAIR, '상품 수정')
    expect(mapped.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(mapped.fields ?? {})).toEqual(['kiObservation'])
  })

  it('I-16 → assetId·asOfDate 둘 다', () => {
    const mapped = mapDbError(TRIGGER_I16_AFTER_FIX, '시세 입력')
    expect(Object.keys(mapped.fields ?? {}).sort()).toEqual(['asOfDate', 'assetId'])
  })

  it('자산 중복 → name·market', () => {
    const mapped = mapDbError(UNIQUE_ASSET_NAME_MARKET, '자산 등록')
    expect(mapped.code).toBe('CONFLICT')
    expect(Object.keys(mapped.fields ?? {}).sort()).toEqual(['market', 'name'])
  })

  it('fields의 값은 사용자 메시지이고 DB 원문이 아니다', () => {
    const mapped = mapDbError(CHECK_KI_PAIR, '상품 수정')
    expect(mapped.fields?.kiObservation).toBe(mapped.message)
    expect(mapped.message).not.toContain('constraint')
    expect(mapped.message).not.toContain('els_products')
  })

  it('빈 fields를 만들지 않는다 — 화면이 순회해 아무것도 표시하지 않는 상태', () => {
    // I-01은 필드가 없는 상태 충돌이다
    const mapped = mapDbError(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "redemptions_els_id_key"',
      },
      '상환 처리',
    )
    expect(mapped.code).toBe('CONFLICT')
    expect(mapped.fields).toBeUndefined()
    expect(mapped.message).toContain('이미 상환')
  })
})

/** 쓰기 함수의 상태 충돌 거부 — 이름을 `detail`로 싣는 형태(6단계) */
const TRIGGER_REDEEMED = {
  code: '23514',
  message: '상환 처리된 상품은 수정할 수 없다.',
  details: 'constraint=els_products_redeemed_immutable',
  hint: null,
}

describe('이름이 코드를 올린다 — DOC-002 §8 명명 규약', () => {
  it('*_redeemed_immutable은 23514여도 CONFLICT다', () => {
    const mapped = mapDbError(TRIGGER_REDEEMED, '상품 수정')
    expect(mapped.code).toBe('CONFLICT')
    // 고칠 필드가 없으므로 fields를 붙이지 않는다
    expect(mapped.fields).toBeUndefined()
    expect(mapped.message).toContain('상환을 먼저 취소')
  })

  it('올린 경우는 흔적을 남긴다 — 경로가 드물다', () => {
    mapDbError(TRIGGER_REDEEMED, '상품 수정')
    expect(logged.join('\n')).toContain('상태 충돌')
  })

  it('접미사가 규약을 벗어나면 기본값으로 떨어지고 신호가 남는다', () => {
    // 다음 사람이 상태 충돌 제약에 *_check를 붙였을 때의 동작이다.
    // 조용히 VALIDATION_FAILED가 되지 않도록 로그가 남는다.
    const mapped = mapDbError(
      {
        code: '23514',
        message: 'new row for relation "els_products" violates check constraint "els_products_locked_check"',
      },
      '상품 수정',
    )
    expect(mapped.code).toBe('VALIDATION_FAILED')
    expect(logged.join('\n')).toContain('사상에 없는 제약(els_products_locked_check)')
  })
})

describe('FK는 방향에 따라 뜻이 다르다', () => {
  it('삭제 방향 — 상환을 먼저 취소하라고 말한다 (§5.3의 2단계)', () => {
    const mapped = mapDbError(FK_REDEMPTION_RESTRICT, '상품 삭제')
    expect(mapped.code).toBe('CONFLICT')
    expect(mapped.message).toContain('상환을 먼저 취소')
  })

  it('삽입 방향 — 같은 제약인데 대상 부재를 말한다', () => {
    const mapped = mapDbError(FK_REDEMPTION_MISSING_PARENT, '상환 처리')
    expect(mapped.code).toBe('CONFLICT')
    expect(mapped.message).toContain('찾을 수 없다')
  })
})

describe('널 위반만 열 이름을 필드로 바꿀 수 있다', () => {
  it('currency → currency', () => {
    const mapped = mapDbError(NOT_NULL_CURRENCY, '자산 등록')
    expect(mapped.fields).toEqual({ currency: '필수 입력값이 비어 있다.' })
  })

  it('사상에 없는 열은 필드 없이 내고 신호를 남긴다', () => {
    const mapped = mapDbError(
      {
        code: '23502',
        message: 'null value in column "created_at" of relation "assets" violates not-null constraint',
      },
      '자산 등록',
    )
    expect(mapped.code).toBe('VALIDATION_FAILED')
    expect(mapped.fields).toBeUndefined()
    expect(logged.join('\n')).toContain('널 위반의 열을 필드로 사상할 수 없다')
  })

  it('길이·자릿수 초과는 필드를 만들지 않는다 — 열 이름이 없으므로', () => {
    expect(mapDbError(LENGTH_OVERFLOW, '자산 등록').fields).toBeUndefined()
    expect(mapDbError(NUMERIC_OVERFLOW, '시세 입력').fields).toBeUndefined()
  })
})

describe('원문을 사용자에게 노출하지 않는다', () => {
  it('권한 미부여의 hint(GRANT 문장)가 메시지에 새지 않는다', () => {
    const mapped = mapDbError(PERMISSION_DENIED, '세율 수정')
    expect(mapped.message).not.toContain('GRANT')
    expect(mapped.message).not.toContain('tax_constants')
  })

  it('권한 미부여는 배포 결함이므로 로그에 구분해 남긴다', () => {
    mapDbError(PERMISSION_DENIED, '세율 수정')
    expect(logged.join('\n')).toContain('권한 미부여(GRANT 결함)')
  })

  it('RLS 위반은 정상 방어이므로 결함으로 남기지 않는다', () => {
    mapDbError(RLS_VIOLATION, '하위 행 삽입')
    expect(logged.join('\n')).not.toContain('GRANT 결함')
  })
})

describe('결과 타입', () => {
  it('ok·okVoid·fail의 형태', () => {
    expect(ok({ id: 'x' })).toEqual({ ok: true, data: { id: 'x' } })
    expect(okVoid()).toEqual({ ok: true, data: undefined })
    expect(fail('NOT_FOUND', '없다')).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '없다' },
    })
  })

  it('빈 fields는 생략된다', () => {
    const result = fail('VALIDATION_FAILED', '확인', {})
    expect(result).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: '확인' },
    })
  })

  it('미인증은 예외가 아니라 결과 객체다 — W-03', () => {
    const result = unauthenticated()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('failDb가 매핑 결과를 그대로 감싼다', () => {
    const result = failDb(CHECK_KI_PAIR, '상품 수정')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.fields).toEqual({
        kiObservation: 'KI 배리어와 관찰 방식은 함께 설정하거나 함께 비운다.',
      })
    }
  })
})

describe('순수 모듈 예외 → ErrorCode (§3.2.2)', () => {
  it('RangeError는 선언된 필드의 VALIDATION_FAILED가 된다', () => {
    const result = guardInput(
      () => {
        throw new RangeError('날짜는 YYYY-MM-DD 형식이어야 한다: 2026-13-01')
      },
      { field: 'issueDate', message: '발행일 형식이 올바르지 않다.' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.fields).toEqual({ issueDate: '발행일 형식이 올바르지 않다.' })
      // 순수 모듈의 원문을 사용자에게 그대로 보내지 않는다
      expect(result.error.message).not.toContain('YYYY-MM-DD')
    }
  })

  it('RangeError가 아니면 INTERNAL이다 — 입력 오류로 보고하지 않는다', () => {
    const result = guardInput(
      () => {
        throw new TypeError('undefined is not a function')
      },
      { field: 'principal', message: '원금을 확인한다.' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL')
      expect(result.error.fields).toBeUndefined()
    }
    expect(logged.join('\n')).toContain('예상 밖의 예외')
  })

  it('성공 경로는 값을 그대로 통과시킨다', () => {
    const result = guardInput(() => 42, { field: 'x', message: 'y' })
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('시스템 전제 위반은 어떤 예외든 INTERNAL이다', () => {
    const result = guardSystem(() => {
      throw new RangeError('tax_brackets가 비어 있다.')
    }, '세율 상수 조립')

    expect(result.ok).toBe(false)
    // ★ 같은 RangeError가 호출 지점에 따라 다른 코드가 된다 — §3.2.2의 요점이다
    if (!result.ok) expect(result.error.code).toBe('INTERNAL')
    expect(logged.join('\n')).toContain('세율 상수 조립')
  })

  it('비동기 시스템 경로도 같다', async () => {
    const result = await guardSystemAsync(async () => {
      throw new Error('세율 시드가 없다.')
    }, '세율 연도 조회')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTERNAL')
  })

  it('CONFLICT는 이 경로에서 나오지 않는다', () => {
    // AQ-17의 답이다. 순수 모듈은 "이미 상환됨"을 알 수 있는 위치에 없으므로,
    // 어떤 예외도 상태 충돌로 번역되지 않는다.
    const codes = [
      guardInput(() => { throw new RangeError('기초자산이 없다') }, { field: 'underlyings', message: 'x' }),
      guardSystem(() => { throw new RangeError('기초자산이 없다') }, 'y'),
    ].map((r) => (r.ok ? 'ok' : r.error.code))

    expect(codes).not.toContain('CONFLICT')
  })
})

describe('사상 목록의 온전성', () => {
  it('제약 이름이 중복 없이 등재되어 있다', () => {
    expect(new Set(MAPPED_CONSTRAINTS).size).toBe(MAPPED_CONSTRAINTS.length)
  })

  it('DOC-011 §3.2.1이 열거한 제약이 모두 사상에 있다', () => {
    // 문서의 표와 코드가 갈리는 것을 막는다. **DB 카탈로그와의 대조는 별개다** —
    // 여기서는 이름이 SQL에 실재하는지 알 수 없으므로(암묵 FK 이름은 SQL 텍스트에
    // 없다) tests/rls가 pg_constraint와 양방향으로 본다.
    const documented = [
      'els_products_ki_pair_check',
      'els_products_ki_touched_check',
      'redemption_schedules_lizard_barrier_check',
      'redemption_schedules_lizard_coupon_check',
      'redemptions_maturity_loss_check',
      'redemptions_taxable_income_check',
      'redemptions_round_no_required_check',
      'asset_prices_coordinates_immutable',
      'els_products_principal_check',
      'els_products_evaluation_period_check',
      'redemption_schedules_barrier_check',
      'redemptions_gross_amount_check',
      'els_products_underlyings_required',
      'els_products_schedules_required',
      'els_products_redeemed_immutable',
    ]
    expect(MAPPED_CONSTRAINTS).toEqual(expect.arrayContaining(documented))
  })
})
