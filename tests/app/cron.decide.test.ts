import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { decide, type CronRequest, type CronRule } from '@/lib/cron/decide'
import type { UserSessionClient } from '@/lib/db/client'
import type { MutationContext } from '@/lib/db/mutations/context'
import { makePriceMutations } from '@/lib/db/mutations/prices'
import { PRICE_PROVIDERS } from '@/lib/providers/types'

/**
 * 배치 응답 판정의 분기표 — DOC-011 §7.1 CR-01·06·07·08 (P5b 컷 1)
 *
 * ## 이 파일이 라우트 대신 보는 것
 *
 * `src/app/api/cron/prices/route.ts`는 **어느 스위트의 import 그래프에도 없다**(Next가
 * 실행한다). e2e는 실 HTTP로 보지만 거기서 결정적으로 만들 수 없는 갈래가 하나 있다 —
 * **`CRON_SECRET` 미설정**. `next start`는 `.env.local`을 읽으므로 그 갈래의 참·거짓이
 * 개발자 기계에 달려 있다. 판정을 순수 함수로 떼면 그것이 인자 하나가 된다.
 *
 * 그래서 역할이 이렇게 갈린다:
 *
 * | 층 | 무엇을 보는가 |
 * |---|---|
 * | **이 파일** | 갈래 넷의 전수 · 순서 상호작용 · §5.8과의 일치 · §7.1 ID 대조 |
 * | `tests/e2e/cron.test.ts` | 실 HTTP의 상태·헤더·매처(**결정적인 갈래만**) |
 *
 * ## 기대값을 파생시키지 않는다
 *
 * 아래 표는 **손으로 적는다.** `decide`의 조건을 다시 계산해 비교하면 구현을 구현으로
 * 확인하는 것이므로 항진명제다 — `STALE_ROUTES`가 손으로 적힌 것과 같은 이유다(`why`가
 * 그 표의 값이며, 사람이 읽고 동의할 수 있는 형태로 둔다).
 */

const DOC_011 = join(process.cwd(), 'docs', '11_API_계약_명세.md')

const SECRET = 'x7Qk2pR9vLm4Ns8T' // 16자 — DOC-013 §6.3의 최소 길이

type Case = { why: string; input: CronRequest; rule: CronRule }

/**
 * 갈래 넷 × 그 갈래로 들어가는 서로 다른 이유.
 *
 * **축이 셋이므로 조합은 곱이지만 전수를 적지 않는다** — 적을 수 있는 것은 곱이 아니라
 * **판별에 필요한 셀**이다. 그래서 각 축의 경계값과 **축 사이의 상호작용**을 고른다:
 * 비밀 부재 × 헤더 부재, 빈 비밀 × `Bearer ` 헤더(같은 순간에 두 갈래가 다투는 자리),
 * 공급자 0 × 유효 토큰.
 */
const CASES: Case[] = [
  // ── CR-06: 비밀이 없다 (500). 다른 어느 축보다 먼저 판정된다 ──────────────
  {
    why: '비밀 미설정 — 헤더가 없어도 401이 아니다',
    input: { header: null, secret: null, providerCount: 0 },
    rule: 'CR-06',
  },
  {
    why: '비밀 미설정 — 올바른 형태의 토큰이 와도 500이다(비교할 대상이 없다)',
    input: { header: `Bearer ${SECRET}`, secret: null, providerCount: 0 },
    rule: 'CR-06',
  },
  {
    why: '★ 빈 비밀 + `Bearer ` — 빈 문자열을 부재로 다루지 않으면 이 요청이 통과한다',
    input: { header: 'Bearer ', secret: '', providerCount: 0 },
    rule: 'CR-06',
  },
  {
    why: '★ 빈 비밀 + 아무 토큰 — 같은 fail-open의 다른 표면(접두사만 맞으면 된다)',
    input: { header: 'Bearer 아무거나', secret: '', providerCount: 0 },
    rule: 'CR-06',
  },
  {
    why: '공백만 있는 비밀도 부재다 — `trim()`이 그 규약이다(`env.ts`와 같다)',
    input: { header: `Bearer    `, secret: '   ', providerCount: 0 },
    rule: 'CR-06',
  },
  {
    why: '비밀 미설정 — 공급자가 있어도 500이다(순서가 CR-07보다 앞이다)',
    input: { header: `Bearer ${SECRET}`, secret: null, providerCount: 3 },
    rule: 'CR-06',
  },

  // ── CR-01: 토큰이 틀리다 (401) ────────────────────────────────────────────
  {
    why: '헤더 부재',
    input: { header: null, secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '빈 헤더',
    input: { header: '', secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '값은 맞으나 스킴이 없다 — `Bearer ` 접두사가 계약이다',
    input: { header: SECRET, secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '스킴의 대소문자가 다르다 — 관용하지 않는다(Vercel이 붙이는 형태는 하나다)',
    input: { header: `bearer ${SECRET}`, secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '접두사만 있다 — 빈 비밀이 아닌 한 통과하지 않는다',
    input: { header: 'Bearer ', secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '값의 접두사가 일치한다 — 부분 일치를 허용하지 않는다',
    input: { header: `Bearer ${SECRET.slice(0, 8)}`, secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '값 뒤에 공백이 붙었다 — 정확 일치다',
    input: { header: `Bearer ${SECRET} `, secret: SECRET, providerCount: 0 },
    rule: 'CR-01',
  },
  {
    why: '토큰이 틀리면 공급자 유무와 무관하다 — 처리하지 않는다(CR-01)',
    input: { header: 'Bearer 다른값', secret: SECRET, providerCount: 5 },
    rule: 'CR-01',
  },

  // ── CR-07: 인증됐고 공급자가 0개다 (503) ──────────────────────────────────
  {
    why: '지금의 정상 경로 — 배포 첫날부터 P5a까지 매일 이 응답이다(DOC-013 §6.4)',
    input: { header: `Bearer ${SECRET}`, secret: SECRET, providerCount: 0 },
    rule: 'CR-07',
  },
  {
    why: '음수는 실재하지 않지만 CR-08로 새지 않는다 — 「없다」에 가깝다',
    input: { header: `Bearer ${SECRET}`, secret: SECRET, providerCount: -1 },
    rule: 'CR-07',
  },

  // ── CR-08: 공급자는 있고 수집기가 없다 (500) ──────────────────────────────
  {
    why: '§5.8의 세 번째 갈래 — 배포 결함이며 P5a 컷 3이 200으로 대체한다',
    input: { header: `Bearer ${SECRET}`, secret: SECRET, providerCount: 1 },
    rule: 'CR-08',
  },
]

describe('분기표 — 갈래 넷의 전수', () => {
  it.each(CASES)('$rule ← $why', ({ input, rule }) => {
    expect(decide(input).rule).toBe(rule)
  })

  it('표가 갈래 넷을 전부 덮는다 — 하나가 비면 그 갈래는 아무도 보지 않는다', () => {
    const covered = new Set(CASES.map((c) => c.rule))
    expect([...covered].sort()).toEqual(['CR-01', 'CR-06', 'CR-07', 'CR-08'])
  })

  it('`rule` → (`status`, `code`)가 §7.1·§3.2와 같다', () => {
    /*
     * 판별자를 `status`가 아니라 `rule`로 둔 이유가 이 표다 — **CR-06과 CR-08이 같은
     * 500이다.** 상태 코드만 보는 소비자는 「비밀이 없다」와 「그 밖의 배포 결함」을
     * 구분하지 못하고, 그 구분이 CR-06의 존재 이유 그 자체다(ST-06).
     */
    const expected: Record<CronRule, { status: number; code: string }> = {
      'CR-01': { status: 401, code: 'UNAUTHENTICATED' },
      'CR-06': { status: 500, code: 'INTERNAL' },
      'CR-07': { status: 503, code: 'PROVIDER_UNAVAILABLE' },
      'CR-08': { status: 500, code: 'INTERNAL' },
    }

    for (const { input, rule, why } of CASES) {
      const verdict = decide(input)
      expect({ status: verdict.status, code: verdict.code }, why).toEqual(expected[rule])
    }
  })

  it('어느 갈래에도 「인증 없이 통과」가 없다', () => {
    /*
     * §7.1의 마지막 문장을 케이스로 박는다. 위 표가 전부 200이 아님을 확인하는 것과
     * 다르다 — 이쪽은 **200 자체가 표현되지 않는다**는 사실이다(수집기가 P5a 컷 3에
     * 오기 전까지). 200이 생기는 날 이 단언이 빨간불이 되어 그 갈래의 조건을 다시 적게
     * 한다.
     */
    for (const { input, why } of CASES) {
      expect(decide(input).status, why).not.toBe(200)
    }
  })

  it('같은 입력에 같은 답이다 — 시계도 환경도 읽지 않는다', () => {
    // 멱등성(CR-03)의 판정 층 절반이다. 나머지 절반(DB)은 수집기가 올 때 생긴다.
    for (const { input, why } of CASES) {
      expect(decide(input), why).toEqual(decide(input))
    }
  })
})

// ---------------------------------------------------------------------------
// §5.8과의 일치 — 정본은 저쪽이다
// ---------------------------------------------------------------------------

describe('§5.8 `refreshPrices`와 같은 판정을 낸다', () => {
  /** 조립만 하므로 클라이언트는 호출되지 않는다(`refreshPrices`는 `ctx`를 쓰지 않는다). */
  const CTX: MutationContext = {
    db: {} as UserSessionClient,
    asOf: '2026-07-29',
    viewerId: '00000000-0000-4000-8000-0000000000aa',
  }

  it('공급자 0개 — `code`와 문구가 글자까지 같다', async () => {
    /*
     * ★ **이 단언이 §7.1 CR-08의 요구를 실제로 검사하는 유일한 자리다.** 「둘만 미러하면
     * 같은 상태가 UI에서 `INTERNAL`, cron에서 503이 된다」는 서술은 문구가 갈리는 것도
     * 함께 막아야 성립한다 — 사용자가 화면에서 읽는 문장과 재호출 본문의 문장이 다르면
     * 같은 상태의 두 보고가 서로를 부정한다.
     *
     * 라우트는 §5.8을 **호출할 수 없다**(`mutationsFor(user, ctx)`가 세션을 요구한다).
     * 그래서 일치는 구조가 아니라 이 대조로만 지켜진다.
     */
    expect(PRICE_PROVIDERS.length).toBe(0) // 전제. 공급자가 등록되면 아래가 무의미해진다

    const result = await makePriceMutations(CTX).refreshPrices()
    expect(result.ok).toBe(false)
    if (result.ok) return // 타입 좁힘. 위 단언이 이미 실패했다

    const verdict = decide({
      header: `Bearer ${SECRET}`,
      secret: SECRET,
      providerCount: PRICE_PROVIDERS.length,
    })

    expect(verdict.code).toBe(result.error.code)
    expect(verdict.message).toBe(result.error.message)
    expect(verdict.status).toBe(503) // §3.2가 `PROVIDER_UNAVAILABLE`에 배정한 HTTP
  })

  it('세 번째 갈래는 지금 도달할 수 없다 — 그 사실을 적어 둔다', () => {
    /*
     * §5.8의 갈래 셋 중 「등록됐으나 수집 로직 없음」은 `PRICE_PROVIDERS`가 빈 배열인
     * 동안 **실행되지 않는다**(스텁을 넣지 않는 것이 ADR-004 v0.7의 결정이다). 즉 위
     * 대조는 CR-07 축에서만 가능하고, CR-08 축의 일치는 P5a가 공급자를 등록하는 날
     * 처음 관측된다. 그때 이 케이스가 빨간불이 되어 위 대조를 CR-08로 넓히라고 말한다.
     */
    expect(PRICE_PROVIDERS).toEqual([])
    expect(decide({ header: `Bearer ${SECRET}`, secret: SECRET, providerCount: 1 }).rule).toBe(
      'CR-08',
    )
  })
})

// ---------------------------------------------------------------------------
// §7.1 동작 규칙 표 ↔ 구현
// ---------------------------------------------------------------------------

/**
 * **판정이 아닌 CR** — 응답 갈래가 아니므로 `decide`에 나타나지 않는다.
 *
 * 이 표가 있어야 아래 대조가 「구현이 문서보다 좁다」를 잡는다. 없으면 부분집합
 * 단언뿐이고, 그것은 문서에 CR이 늘어도 초록이다 — 새 규칙이 응답 갈래인지 아닌지를
 * **누군가 판단했다는 기록**이 여기 남는다.
 */
const NOT_A_VERDICT: Record<string, string> = {
  'CR-02': '부분 실패의 처리 방식이다. 공급자 0개에서는 존재하지 않는다 — P5a 컷 3',
  'CR-03': '멱등성. 판정이 아니라 수집기와 `UNIQUE` 제약의 성질이다',
  'CR-04': '감지·진단의 배정. SCR-302와 재호출이 담당한다',
  'CR-05': '기준일 행 사전 확인. 수집기의 규칙이다 — P5a',
  'CR-09': '응답 헤더. 판정이 아니라 라우트가 항상 싣는다(e2e가 무조건 단언한다)',
  /*
   * **아직 판정이 아니다 — 도달할 수 없기 때문이다.** CR-10은 「공급자는 등록됐으나 그
   * 자격증명이 없다」이고, `PRICE_PROVIDERS`가 빈 동안 그 상태는 **존재하지 않는다**
   * (CR-07이 먼저 걸린다 — §7.1이 순서를 규칙으로 못박았다).
   *
   * 도달 불가한 갈래를 지금 `CASES`에 넣으면 그것을 시험하는 케이스가 아무것도 증명하지
   * 않는다 — `decide.ts`의 머리글이 200 갈래에 대해 적은 것과 같은 논거다.
   * **P5a 컷 3에서 `CASES`로 옮긴다.**
   */
  'CR-10': '공급자 자격증명 부재. 공급자 0개인 동안 도달 불가다 — P5a 컷 3',
}

describe('§7.1 동작 규칙 표 ↔ 판정', () => {
  const rows = (() => {
    const lines = readFileSync(DOC_011, 'utf8').split('\n')
    const header = '| ID | 규칙 | 근거 |'
    const at = lines.indexOf(header)
    expect(at, `§7.1 동작 규칙 표를 찾지 못했다: ${header}`).toBeGreaterThan(-1)
    expect(lines.indexOf(header, at + 1), '같은 헤더가 둘 이상이다').toBe(-1)
    expect(lines[at + 1]).toMatch(/^\|(?:-+\|)+$/)

    const out: string[][] = []
    for (const line of lines.slice(at + 2)) {
      if (!line.startsWith('|')) break
      out.push(
        line
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim()),
      )
    }
    return out
  })()

  const documented = rows.map((row) => row[0]!)

  it('파서가 표를 찾았다 — 0행 파싱 후 조용한 통과를 막는다', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.length === 3)).toBe(true)
    expect(documented.every((id) => /^CR-\d{2}$/.test(id))).toBe(true)
  })

  it('문서의 ID가 판정 넷과 비판정 여섯으로 정확히 갈린다', () => {
    /*
     * **양방향이다.** ⓐ `decide`가 문서에 없는 ID를 내지 않는다 ⓑ 문서의 모든 ID가
     * 판정이거나 위 표에 사유와 함께 등재되어 있다. ⓑ가 없으면 §7.1에 CR-10이 추가되어도
     * 이 파일은 초록이고, 그것이 「계약이 늘었는데 구현이 모른다」의 형태다.
     */
    const verdicts = new Set(CASES.map((c) => c.rule))
    const classified = new Set([...verdicts, ...Object.keys(NOT_A_VERDICT)])

    expect([...documented].sort()).toEqual([...classified].sort())
    expect(documented).toHaveLength(10) // CR-01 ~ CR-10 (CR-10은 v3.5 신설)
  })

  it('판정 넷의 규칙 문언이 이 구현을 서술한다', () => {
    /*
     * 문언 전체를 대조하지 않는다(문서는 산문이다). **상태 코드만 본다** — 그것이 문서와
     * 코드가 같은 값을 두 곳에 적는 유일한 지점이고, 갈리면 조용히 갈린다.
     */
    const statusOf = (id: string): string => {
      const row = rows.find((r) => r[0] === id)
      expect(row, `${id} 행이 없다`).toBeDefined()
      return row![1]!
    }

    expect(statusOf('CR-01')).toContain('401')
    expect(statusOf('CR-06')).toContain('500')
    expect(statusOf('CR-07')).toContain('503')
    // CR-08은 상태 코드를 적지 않는다 — 「§5.8의 `INTERNAL`과 같은 판정」이라고 적는다.
    expect(statusOf('CR-08')).toContain('INTERNAL')
  })
})
