import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { decide, isRefusal, type CronRefusal } from '@/lib/cron/decide'
import { NO_STORE, refusalResponse, resultResponse } from '@/lib/cron/respond'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { CronResult } from '@/lib/db/mutations/types'

/**
 * `ErrorCode` → HTTP 사상표 — DOC-011 §7.1 CR-02·CR-07·CR-08·CR-09
 *
 * ## 이 파일이 종전 «미러 대조»를 대체한다
 *
 * v2.7~컷 2b에서는 `decide()`가 CR-07·CR-08의 문구를 §5.8과 **글자 단위로** 같게
 * 유지해야 했고, `tests/app/cron.decide.test.ts`에 그 둘을 비교하는 블록이 있었다.
 * AQ-57 = ⓐ가 라우트에게 세션을 주면서 **문구가 한 곳에만 남았고**, 남는 일은
 * 「그 `ErrorCode`를 어느 상태 코드로 옮기는가」뿐이다 — 그것이 이 파일이 보는 전부다.
 *
 * ## 왜 라우트가 아니라 `respond.ts`인가
 *
 * 라우트 파일은 어느 상시 스위트의 import 그래프에도 없다(AQ-23 — Next가 실행한다).
 * 사상표를 라우트에 두면 아무도 전수로 읽지 못한다.
 */

const DOC_011 = join(process.cwd(), 'docs', '11_API_계약_명세.md')

const SECRET = 'x7Qk2pR9vLm4Ns8T'
const AT = '2026-08-05T05:00:00.000Z'

const RESULT: CronResult = {
  executedAt: AT,
  targetCount: 3,
  succeeded: 1,
  skipped: 1,
  unmapped: 1,
  failed: [],
}

function refusalOf(input: Parameters<typeof decide>[0]): CronRefusal {
  const verdict = decide(input)
  if (!isRefusal(verdict)) throw new Error('거부가 아니다')
  return verdict
}

describe('CR-09 — 캐시 금지 헤더 3종을 «무조건» 싣는다', () => {
  /**
   * ★ **갈래마다 고르게 두지 않는 것이 요점이다.** 라우트가 갈래별로 헤더를 고르면
   * 한 갈래에서 빠질 수 있고, 그 결함은 **응답이 캐시된 뒤에야** 보인다 — 그때는
   * 배치가 조용히 안 돌고 **Vercel 로그에도 남지 않는다**(§7.1 CR-09의 인용).
   * 그래서 두 함수가 헤더를 «반환값의 일부»로 만든다.
   */
  const CASES: Array<[string, { headers: Record<string, string> }]> = [
    ['CR-06 (500)', refusalResponse(refusalOf({ header: null, secret: null, missingCredentials: [] }))],
    [
      'CR-01 (401)',
      refusalResponse(refusalOf({ header: null, secret: SECRET, missingCredentials: [] })),
    ],
    [
      'CR-10 (500)',
      refusalResponse(
        refusalOf({
          header: `Bearer ${SECRET}`,
          secret: SECRET,
          missingCredentials: ['CRON_SERVICE_EMAIL'],
        }),
      ),
    ],
    ['성공 (200)', resultResponse({ ok: true, data: RESULT }, AT)],
    [
      '503',
      resultResponse({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'x' } }, AT),
    ],
    ['500', resultResponse({ ok: false, error: { code: 'INTERNAL', message: 'x' } }, AT)],
  ]

  it.each(CASES)('%s', (_why, response) => {
    expect(response.headers).toEqual(NO_STORE)
  })

  it('문서가 적은 세 값과 글자까지 같다', () => {
    /*
     * §7.1 CR-09가 세 헤더를 **문자 그대로** 적는다. 그것이 문서와 코드가 같은 값을 두
     * 곳에 적는 지점이므로 대조한다 — 그리고 이 대조는 미러가 아니다(문구가 아니라
     * 프로토콜 값이고, 정본이 HTTP 캐시 규약이다).
     */
    const doc = readFileSync(DOC_011, 'utf8')
    const row = doc.split('\n').find((line) => line.startsWith('| CR-09 |'))
    expect(row, 'CR-09 행을 찾지 못했다').toBeDefined()

    expect(row!).toContain(NO_STORE['Cache-Control'])
    expect(row!).toContain('`Expires: 0`')
    expect(row!).toContain('`Pragma: no-cache`')
  })
})

describe('사전 판정의 거부 → 응답', () => {
  it('`code`·`message`·`rule` 셋을 싣는다 — 상태 코드는 CR-06과 CR-10을 가르지 못한다', () => {
    const six = refusalResponse(refusalOf({ header: null, secret: null, missingCredentials: [] }))
    const ten = refusalResponse(
      refusalOf({
        header: `Bearer ${SECRET}`,
        secret: SECRET,
        missingCredentials: ['CRON_SERVICE_PASSWORD'],
      }),
    )

    expect(six.status).toBe(500)
    expect(ten.status).toBe(500)
    expect(six.body.code).toBe('INTERNAL')
    expect(ten.body.code).toBe('INTERNAL')
    // ★ 상태도 `code`도 같다. **`rule`만이 진단을 가른다.**
    expect(six.body.rule).toBe('CR-06')
    expect(ten.body.rule).toBe('CR-10')
    expect(six.body.message).not.toBe(ten.body.message)
  })

  it('부재한 변수의 «이름»이 본문에 없다 — 배포 구성은 미인증 호출자의 것이 아니다', () => {
    const response = refusalResponse(
      refusalOf({
        header: `Bearer ${SECRET}`,
        secret: SECRET,
        missingCredentials: ['CRON_SERVICE_EMAIL', 'DATA_GO_KR_SERVICE_KEY'],
      }),
    )

    const serialized = JSON.stringify(response.body)
    expect(serialized).not.toContain('CRON_SERVICE_EMAIL')
    expect(serialized).not.toContain('DATA_GO_KR_SERVICE_KEY')
  })
})

describe('§5.8의 반환 → HTTP', () => {
  const MAP: Array<[string, ActionResult<CronResult>, number]> = [
    ['ok → 200', { ok: true, data: RESULT }, 200],
    [
      'PROVIDER_UNAVAILABLE → 503 (CR-07)',
      { ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'x' } },
      503,
    ],
    ['INTERNAL → 500 (CR-08)', { ok: false, error: { code: 'INTERNAL', message: 'x' } }, 500],
    /*
     * 그 밖의 코드도 **500이다.** 배치 경로에서 `FORBIDDEN`·`VALIDATION_FAILED`가 나오면
     * 그것은 사용자 입력의 문제가 아니라 배포·권한 결함이므로(요청에 입력이 없다)
     * 4xx로 답하면 「호출자가 고칠 것이 있다」는 거짓말이 된다.
     */
    ['FORBIDDEN → 500', { ok: false, error: { code: 'FORBIDDEN', message: 'x' } }, 500],
    ['CONFLICT → 500', { ok: false, error: { code: 'CONFLICT', message: 'x' } }, 500],
    ['NOT_FOUND → 500', { ok: false, error: { code: 'NOT_FOUND', message: 'x' } }, 500],
    [
      'UNAUTHENTICATED → 500',
      { ok: false, error: { code: 'UNAUTHENTICATED', message: 'x' } },
      500,
    ],
    [
      'VALIDATION_FAILED → 500',
      { ok: false, error: { code: 'VALIDATION_FAILED', message: 'x' } },
      500,
    ],
  ]

  it.each(MAP)('%s', (_why, result, status) => {
    expect(resultResponse(result, AT).status).toBe(status)
  })

  it('★ `ok`인데 `failed[]`가 비어 있지 않은 것을 오류로 만들지 않는다 (CR-02)', () => {
    /*
     * 부분 실패는 `ok`다. 비2xx로 바꾸면 **건강한 부분 실패가 전면 실패로 보이고**,
     * cron 모니터링이 매일 빨간불이 되어 곧 무시된다(AQ-46이 기각한 형태).
     */
    const partial: CronResult = {
      ...RESULT,
      failed: [{ assetId: 'a', reason: '호출 실패 — 401', failure: 'CALL_FAILED' }],
    }
    const response = resultResponse({ ok: true, data: partial }, AT)

    expect(response.status).toBe(200)
    expect(response.body.failed).toHaveLength(1)
  })

  it('성공 본문이 `CronResult` 그 자체다 — 어휘를 덧붙이지 않는다', () => {
    const response = resultResponse({ ok: true, data: RESULT }, AT)
    expect(response.body).toEqual({ ...RESULT })
  })

  it('실패 본문에는 `rule`이 «없다» — 사전 판정이 아니므로 지어내지 않는다', () => {
    const response = resultResponse(
      { ok: false, error: { code: 'INTERNAL', message: '처리 중 오류가 발생했다.' } },
      AT,
    )
    expect(response.body.rule).toBeUndefined()
    expect(response.body.at).toBe(AT) // 대신 시점을 적는다
  })
})
