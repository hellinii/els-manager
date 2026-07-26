import { describe, expect, it } from 'vitest'
import { actingAs, anonymously } from './helpers/client'
import { USER_A } from './helpers/fixtures'
import { expectPermissionDenied } from './helpers/expect'

/**
 * `tax_years` · `tax_brackets` · `tax_constants`
 * — DOC-010 §7 "조회 전체 / 변경 없음 (마이그레이션 전용)"
 *
 * ADR-005: 세율은 버전 관리되는 마이그레이션으로만 들어가며 기존 연도 행은
 * 수정하지 않는다. 애플리케이션 경로로 세율을 바꿀 수 있으면 "왜 작년 계산
 * 결과가 달라졌는가"에 답할 수 없고, 회귀 테스트(K-08)의 전제가 무너진다.
 *
 * 거부가 **조용한 0행이 아니라 42501**인 것이 중요하다. 세율을 바꾸려는
 * 코드가 아무 일도 하지 않고 성공한 척하는 것보다 즉시 실패하는 편이 낫다.
 */

describe('조회는 전체 인증 사용자', () => {
  it('2026년 세율 구간 8행을 조회한다', async () => {
    const rows = await actingAs(USER_A).query(
      'select lower_bound from public.tax_brackets where tax_year = 2026',
    )
    expect(rows.rowCount).toBe(8)
  })

  it('2026년 주입 상수 9개를 조회한다', async () => {
    const rows = await actingAs(USER_A).query(
      'select key from public.tax_constants where tax_year = 2026',
    )
    expect(rows.rowCount).toBe(9)
  })

  it('연도 목록을 조회한다', async () => {
    const rows = await actingAs(USER_A).query(
      'select tax_year from public.tax_years where tax_year = 2026',
    )
    expect(rows.rowCount).toBe(1)
  })
})

describe('변경 경로가 존재하지 않는다 (ADR-005)', () => {
  it('세율을 수정할 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        'update public.tax_brackets set rate = 0.0100 where tax_year = 2026',
      ),
    )
  })

  it('세율을 추가·삭제할 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        `insert into public.tax_brackets (tax_year, lower_bound, rate, progressive_deduction)
         values (2026, 2000000000, 0.5000, 0)`,
      ),
    )
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('delete from public.tax_brackets where tax_year = 2026'),
    )
  })

  it('상수를 변경할 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query(
        `update public.tax_constants set value = 0.5
           where tax_year = 2026 and key = 'separate_taxation_rate'`,
      ),
    )
  })

  it('연도를 추가할 수 없다', async () => {
    await expectPermissionDenied(() =>
      actingAs(USER_A).query('insert into public.tax_years (tax_year) values (2027)'),
    )
  })
})

describe('미인증 접근 (SEC-03)', () => {
  it('세율을 조회할 수 없다', async () => {
    await expectPermissionDenied(() =>
      anonymously.query('select rate from public.tax_brackets'),
    )
  })
})
