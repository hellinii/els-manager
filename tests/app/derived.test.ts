import { describe, expect, it } from 'vitest'

import { PRICE_MISSING_LABEL, deriveDisplay, INTEGRITY_ISSUE_LABELS } from '@/lib/format'

/**
 * 판정값 부재의 원인 — **DOC-011 §4.2 우선순위표** (1 결함 → 2 E-05 → 3 E-01)
 *
 * ## 순서만 검증하는 테스트다
 *
 * 세 원인이 **겹치는 입력**이 존재하므로 순서가 곧 동작이다. 결함 상품은
 * `status = 'ACTIVE'`이고 `worstOf = null`이어서 3순위 조건을 그대로 만족한다 —
 * 순서를 뒤집으면 화면이 「시세 없음」을 표시하고 사용자는 **영원히 오지 않을
 * 시세를 기다린다.** 그래서 단독 케이스가 아니라 **조합**을 전수로 본다.
 */

const ISSUES = ['UNDERLYING_MISSING', 'SCHEDULE_MISSING'] as const
const STATUSES = ['ACTIVE', 'REDEEMED'] as const
const WORST_OFS = [null, '0.9500'] as const

describe('우선순위 — 조합 전수', () => {
  it('결함이 있으면 무엇이든 결함이다 (1순위)', () => {
    // 2×2×2 = 8 조합 중 결함이 있는 8개. 상환 완료도, 워스트오브가 있어도 결함이 이긴다.
    for (const issue of ISSUES) {
      for (const status of STATUSES) {
        for (const worstOf of WORST_OFS) {
          const result = deriveDisplay({ status, worstOf, integrityIssue: issue })
          expect(result.kind, `${issue}/${status}/${worstOf}`).toBe('INTEGRITY')
          if (result.kind === 'INTEGRITY') {
            expect(result.issue).toBe(issue)
            expect(result.label).toBe(INTEGRITY_ISSUE_LABELS[issue])
            expect(result.grade).toBe('defect')
          }
        }
      }
    }
  })

  it('상환 완료 + 결함은 결함이다 — 상환은 결함을 해소하지 않는다', () => {
    // §4.1의 표: "상환 완료 + 결함 → 결함만".
    expect(
      deriveDisplay({
        status: 'REDEEMED',
        worstOf: '0.9500',
        integrityIssue: 'SCHEDULE_MISSING',
      }).kind,
    ).toBe('INTEGRITY')
  })

  it('결함이 없는 상환 완료는 판정을 생략한다 (2순위)', () => {
    for (const worstOf of WORST_OFS) {
      expect(
        deriveDisplay({ status: 'REDEEMED', worstOf, integrityIssue: null }).kind,
      ).toBe('REDEEMED')
    }
  })

  it('보유중 + 시세 없음은 E-01이다 (3순위)', () => {
    const result = deriveDisplay({
      status: 'ACTIVE',
      worstOf: null,
      integrityIssue: null,
    })
    expect(result.kind).toBe('PRICE_MISSING')
    if (result.kind === 'PRICE_MISSING') expect(result.label).toBe(PRICE_MISSING_LABEL)
  })

  it('보유중 + 시세 있음이 유일한 정상 경로다', () => {
    const result = deriveDisplay({
      status: 'ACTIVE',
      worstOf: '0.9500',
      integrityIssue: null,
    })
    expect(result.kind).toBe('VALUED')
    if (result.kind === 'VALUED') expect(result.worstOf).toBe('0.9500')
  })
})

describe('문구가 서로 달라야 한다 — ST-06', () => {
  it('시세 없음과 결함은 같은 문구가 아니다', () => {
    /*
     * 두 상태는 화면에 **같은 모습으로 도달한다** — 둘 다 `ACTIVE`이고
     * 워스트오브가 없다. 같은 문구로 표시하면 사용자가 오지 않을 시세를
     * 기다리므로, DOC-008 ST-06이 다른 문구를 요구한다.
     */
    expect(PRICE_MISSING_LABEL).not.toBe(INTEGRITY_ISSUE_LABELS.UNDERLYING_MISSING)
    expect(PRICE_MISSING_LABEL).not.toBe(INTEGRITY_ISSUE_LABELS.SCHEDULE_MISSING)
    // 그리고 결함 문구는 고칠 곳을 지목한다.
    expect(INTEGRITY_ISSUE_LABELS.UNDERLYING_MISSING).toContain('수정 필요')
    expect(INTEGRITY_ISSUE_LABELS.SCHEDULE_MISSING).toContain('수정 필요')
    expect(PRICE_MISSING_LABEL).not.toContain('수정 필요')
  })
})
