import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  decide,
  isRefusal,
  type CronRequest,
  type CronRule,
  type CronVerdict,
} from '@/lib/cron/decide'

/**
 * 배치 «사전» 판정의 분기표 — DOC-011 §7.1 CR-01·06·10 (P5b 컷 1 · P5a 컷 3에서 개편)
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
 * | **이 파일** | 갈래 «셋»의 전수 · 순서 상호작용 · §7.1 ID 대조 |
 * | `tests/e2e/cron.test.ts` | 실 HTTP의 상태·헤더·매처(**결정적인 갈래만**) |
 *
 * ## 기대값을 파생시키지 않는다
 *
 * 아래 표는 **손으로 적는다.** `decide`의 조건을 다시 계산해 비교하면 구현을 구현으로
 * 확인하는 것이므로 항진명제다 — `STALE_ROUTES`가 손으로 적힌 것과 같은 이유다(`why`가
 * 그 표의 값이며, 사람이 읽고 동의할 수 있는 형태로 둔다).
 *
 * ## ★ P5a 컷 3에서 «줄어든» 것과 그 이유
 *
 * 종전에는 갈래가 넷이었고 CR-07·CR-08은 §5.8의 판정을 **미러**한 것이었다. 이 파일에는
 * 그 두 벌을 «글자 단위로» 대조하는 블록이 있었다 — 같은 문구가 두 곳에 있었기 때문이다.
 *
 * **AQ-57이 ⓐ(전용 서비스 계정)로 닫히면서 미러가 사라졌다.** 라우트가 `MutationContext`를
 * 조립할 수 있으므로 §5.8을 «호출»하고, 문구는 §5.8에만 있다. 그래서 **그 대조 블록을
 * 지웠다** — 갈릴 수 있는 두 벌이 없으면 대조할 것이 없다.
 *
 * 지운 것이 「검증을 줄인 것」이 아니라 **「검증할 대상이 없어진 것」**이라는 구분이 중요하다.
 * CR-07·CR-08은 이제 `respond.ts`가 `ErrorCode`를 상태 코드로 옮기는 사상표이고,
 * 그 전수는 `tests/cron/respond.test.ts`가 본다.
 *
 * ## ★★ 「200이 없다」가 케이스에서 «타입»으로 옮겨졌다
 *
 * 종전 케이스(`CASES`의 모든 갈래가 200이 아니다)는 **`CASES`만 순회하므로 200 갈래를
 * 추가해도 초록이었다** — 즉 아무것도 막지 못했다. 이제 통과 갈래가 `status`를 갖지 않는
 * `{ proceed: true }`이므로 `decide(x).status`가 **컴파일되지 않는다.** 아래에
 * `@ts-expect-error` 음성 대조로 그 성질을 고정한다.
 */

const DOC_011 = join(process.cwd(), 'docs', '11_API_계약_명세.md')

const SECRET = 'x7Qk2pR9vLm4Ns8T' // 16자 — DOC-013 §6.3의 최소 길이

type Case = { why: string; input: CronRequest; rule: CronRule }

/**
 * 갈래 «셋» × 그 갈래로 들어가는 서로 다른 이유.
 *
 * **축이 셋이므로 조합은 곱이지만 전수를 적지 않는다** — 적을 수 있는 것은 곱이 아니라
 * **판별에 필요한 셀**이다. 그래서 각 축의 경계값과 **축 사이의 상호작용**을 고른다:
 * 비밀 부재 × 헤더 부재, 빈 비밀 × `Bearer ` 헤더(같은 순간에 두 갈래가 다투는 자리),
 * 자격증명 부재 × 틀린 토큰(**순서가 규칙인 자리** — 앞에 두면 미인증 호출자가
 * 배포 구성을 알게 된다).
 */
const CASES: Case[] = [
  // ── CR-06: 비밀이 없다 (500). 다른 어느 축보다 먼저 판정된다 ──────────────
  {
    why: '비밀 미설정 — 헤더가 없어도 401이 아니다',
    input: { header: null, secret: null, missingCredentials: [] },
    rule: 'CR-06',
  },
  {
    why: '비밀 미설정 — 올바른 형태의 토큰이 와도 500이다(비교할 대상이 없다)',
    input: { header: `Bearer ${SECRET}`, secret: null, missingCredentials: [] },
    rule: 'CR-06',
  },
  {
    why: '★ 빈 비밀 + `Bearer ` — 빈 문자열을 부재로 다루지 않으면 이 요청이 통과한다',
    input: { header: 'Bearer ', secret: '', missingCredentials: [] },
    rule: 'CR-06',
  },
  {
    why: '★ 빈 비밀 + 아무 토큰 — 같은 fail-open의 다른 표면(접두사만 맞으면 된다)',
    input: { header: 'Bearer 아무거나', secret: '', missingCredentials: [] },
    rule: 'CR-06',
  },
  {
    why: '공백만 있는 비밀도 부재다 — `trim()`이 그 규약이다(`env.ts`와 같다)',
    input: { header: `Bearer    `, secret: '   ', missingCredentials: [] },
    rule: 'CR-06',
  },
  {
    why: '★ 비밀 부재 + 자격증명 부재 — 둘 다 배포 결함인데 «비밀»이 먼저다(CR-06 → CR-10)',
    input: {
      header: `Bearer ${SECRET}`,
      secret: null,
      missingCredentials: ['CRON_SERVICE_EMAIL'],
    },
    rule: 'CR-06',
  },

  // ── CR-01: 토큰이 틀리다 (401) ────────────────────────────────────────────
  {
    why: '헤더 부재',
    input: { header: null, secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '빈 헤더',
    input: { header: '', secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '값은 맞으나 스킴이 없다 — `Bearer ` 접두사가 계약이다',
    input: { header: SECRET, secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '스킴의 대소문자가 다르다 — 관용하지 않는다(Vercel이 붙이는 형태는 하나다)',
    input: { header: `bearer ${SECRET}`, secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '접두사만 있다 — 빈 비밀이 아닌 한 통과하지 않는다',
    input: { header: 'Bearer ', secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '값의 접두사가 일치한다 — 부분 일치를 허용하지 않는다',
    input: { header: `Bearer ${SECRET.slice(0, 8)}`, secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '값 뒤에 공백이 붙었다 — 정확 일치다',
    input: { header: `Bearer ${SECRET} `, secret: SECRET, missingCredentials: [] },
    rule: 'CR-01',
  },
  {
    why: '★★ 틀린 토큰 + 자격증명 부재 — **401이다.** 500을 주면 상태 코드가 배포 구성을 누설한다',
    input: {
      header: 'Bearer 다른값',
      secret: SECRET,
      missingCredentials: ['CRON_SERVICE_EMAIL', 'CRON_SERVICE_PASSWORD'],
    },
    rule: 'CR-01',
  },

  // ── CR-10: 인증됐고 자격증명이 없다 (500) ─────────────────────────────────
  {
    why: '서비스 계정 변수 하나가 없다 — 503이 아니다(고칠 것은 환경변수다)',
    input: {
      header: `Bearer ${SECRET}`,
      secret: SECRET,
      missingCredentials: ['CRON_SERVICE_PASSWORD'],
    },
    rule: 'CR-10',
  },
  {
    why: '둘 다 없다 — 개수가 판정을 바꾸지 않는다',
    input: {
      header: `Bearer ${SECRET}`,
      secret: SECRET,
      missingCredentials: ['CRON_SERVICE_EMAIL', 'CRON_SERVICE_PASSWORD'],
    },
    rule: 'CR-10',
  },
  {
    why: '공급자 자격증명 — 두 출처를 «한» 규칙으로 답한다(고치는 사람이 같다)',
    input: {
      header: `Bearer ${SECRET}`,
      secret: SECRET,
      missingCredentials: ['DATA_GO_KR_SERVICE_KEY'],
    },
    rule: 'CR-10',
  },
]

describe('분기표 — 갈래 셋의 전수', () => {
  it.each(CASES)('$rule ← $why', ({ input, rule }) => {
    const verdict = decide(input)
    expect(isRefusal(verdict)).toBe(true)
    if (!isRefusal(verdict)) return // 타입 좁힘
    expect(verdict.rule).toBe(rule)
  })

  it('표가 갈래 셋을 전부 덮는다 — 하나가 비면 그 갈래는 아무도 보지 않는다', () => {
    const covered = new Set(CASES.map((c) => c.rule))
    expect([...covered].sort()).toEqual(['CR-01', 'CR-06', 'CR-10'])
  })

  it('`rule` → (`status`, `code`)가 §7.1·§3.2와 같다', () => {
    /*
     * 판별자를 `status`가 아니라 `rule`로 둔 이유가 이 표다 — **CR-06과 CR-10이 같은
     * 500이고 `code`도 같은 `INTERNAL`이다.** 즉 응답만 보는 소비자는 둘을 구분할 수
     * 없고, 그 구분이 두 규칙의 존재 이유 그 자체다(ST-06 — 고치는 «변수»가 다르다).
     */
    const expected: Record<CronRule, { status: number; code: string }> = {
      'CR-01': { status: 401, code: 'UNAUTHENTICATED' },
      'CR-06': { status: 500, code: 'INTERNAL' },
      'CR-10': { status: 500, code: 'INTERNAL' },
    }

    for (const { input, rule, why } of CASES) {
      const verdict = decide(input)
      if (!isRefusal(verdict)) throw new Error(`통과했다: ${why}`)
      expect({ status: verdict.status, code: verdict.code }, why).toEqual(expected[rule])
    }
  })

  it('같은 입력에 같은 답이다 — 시계도 환경도 읽지 않는다', () => {
    // 멱등성(CR-03)의 판정 층 절반이다. 나머지 절반(DB)은 `UNIQUE` 제약이 진다.
    for (const { input, why } of CASES) {
      expect(decide(input), why).toEqual(decide(input))
    }
  })
})

describe('통과 갈래 — 200을 «표현할 수 없다»', () => {
  const VALID: CronRequest = {
    header: `Bearer ${SECRET}`,
    secret: SECRET,
    missingCredentials: [],
  }

  it('셋 다 아니면 `{ proceed: true }`다 — 필드가 그것뿐이다', () => {
    const verdict = decide(VALID)
    expect(isRefusal(verdict)).toBe(false)
    /*
     * `toEqual`이 아니라 **키 집합을 본다.** `toEqual({proceed: true})`만으로는 나중에
     * `status: 200`이 붙어도… 실은 그것도 잡는다. 그래도 키를 명시하는 이유는 «무엇이
     * 없어야 하는가»가 이 테스트의 명제이기 때문이다 — 읽는 사람에게 그것이 보여야 한다.
     */
    expect(Object.keys(verdict).sort()).toEqual(['proceed'])
    expect(verdict).toEqual({ proceed: true })
  })

  it('★ `status`·`code`·`rule`을 «읽을 수 없다» — 타입 수준 음성 대조', () => {
    const verdict: CronVerdict = decide(VALID)

    /*
     * ★★ **이것이 종전 「200 갈래가 없다」 케이스를 대체한다.**
     *
     * 종전에는 `CASES`를 순회하며 `status !== 200`을 단언했는데, 그 순회는 «표에 있는
     * 것»만 보므로 **200 갈래를 추가해도 초록이었다** — 즉 그 단언이 막겠다고 적은 것을
     * 막지 못했다(「위반자가 0인 동안 보이지 않는다」의 형태).
     *
     * 이제 통과 갈래에 `status`가 «없으므로» 판별 없이 읽는 코드가 **컴파일되지 않는다.**
     * `@ts-expect-error`는 그 성질을 뒤집으면 `npm run typecheck`가 **「사용되지 않은
     * expect-error」로 실패**하게 만든다 — 음성 대조가 무효화되면 조용하지 않다.
     */
    // @ts-expect-error — `CronProceed`에 `status`가 없다. 판별 없이 읽을 수 없다
    void verdict.status
    // @ts-expect-error — `code`도 마찬가지다(§3.2의 어휘는 거부에만 있다)
    void verdict.code
    // @ts-expect-error — `rule`도 마찬가지다(§7.1의 ID는 거부에만 있다)
    void verdict.rule

    // 판별을 지나면 읽을 수 있다 — 위 셋이 「타입이 없다」가 아니라 「좁혀야 한다」임을 고정
    if (isRefusal(verdict)) expect(typeof verdict.status).toBe('number')
    else expect(verdict.proceed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §7.1 동작 규칙 표 ↔ 구현
// ---------------------------------------------------------------------------

/**
 * **판정이 아닌 CR** — 사전 판정의 갈래가 아니므로 `decide`에 나타나지 않는다.
 *
 * 이 표가 있어야 아래 대조가 「구현이 문서보다 좁다」를 잡는다. 없으면 부분집합
 * 단언뿐이고, 그것은 문서에 CR이 늘어도 초록이다 — 새 규칙이 사전 판정인지 아닌지를
 * **누군가 판단했다는 기록**이 여기 남는다.
 */
const NOT_A_VERDICT: Record<string, string> = {
  'CR-02': '부분 실패의 처리 방식이다. `collect.ts`가 값으로 답하고 `tests/cron/collect.test.ts`가 본다',
  'CR-03': '멱등성. 판정이 아니라 수집기와 `UNIQUE` 제약의 성질이다',
  'CR-04': '감지·진단의 배정. SCR-302 · 재호출 · `cron_runs`가 담당한다',
  'CR-05': '기준일 행 사전 확인. 수집기의 규칙이다 — `collect.ts`',
  /*
   * ★ **P5a 컷 3에서 «사전 판정에서 빠졌다».** 종전에는 `decide()`가 이 둘을 §5.8과
   * **미러**했다(라우트가 세션이 없어 §5.8을 호출할 수 없었기 때문이다). AQ-57 = ⓐ가
   * 그 전제를 없애서 라우트가 §5.8을 **호출**하고, 남는 일은 그 `ErrorCode`를 상태
   * 코드로 옮기는 것뿐이다 — 그것이 `respond.ts`이고 문구는 §5.8에만 있다.
   *
   * 즉 이 두 줄은 **검증을 줄인 기록이 아니라 검증할 대상이 없어진 기록**이다.
   */
  'CR-07': '§5.8이 `PROVIDER_UNAVAILABLE`로 답하고 `respond.ts`가 503으로 옮긴다 — `tests/cron/respond.test.ts`',
  'CR-08': '§5.8·수집기의 실패를 `respond.ts`가 500으로 옮긴다 — 같은 파일',
  'CR-09': '응답 헤더. 판정이 아니라 `respond.ts`가 «무조건» 싣는다(e2e가 세 갈래에서 단언한다)',
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

  it('문서의 ID가 사전 판정 셋과 비판정 일곱으로 정확히 갈린다', () => {
    /*
     * **양방향이다.** ⓐ `decide`가 문서에 없는 ID를 내지 않는다 ⓑ 문서의 모든 ID가
     * 사전 판정이거나 위 표에 사유와 함께 등재되어 있다. ⓑ가 없으면 §7.1에 CR-11이
     * 추가되어도 이 파일은 초록이고, 그것이 「계약이 늘었는데 구현이 모른다」의 형태다.
     *
     * ★ **부류가 바뀐 것도 이 단언이 잡는다** — 컷 3에서 CR-07·CR-08이 판정에서
     * 비판정으로 옮겨졌고, 옮기지 않으면 `covered`와 `NOT_A_VERDICT`가 겹쳐 빨간불이다.
     */
    const verdicts = new Set(CASES.map((c) => c.rule))
    const classified = new Set([...verdicts, ...Object.keys(NOT_A_VERDICT)])

    // 두 부류가 겹치지 않는다 — 겹치면 위 합집합이 개수를 속인다
    for (const id of verdicts) expect(NOT_A_VERDICT[id], `${id}가 두 부류에 다 있다`).toBeUndefined()

    expect([...documented].sort()).toEqual([...classified].sort())
    expect(documented).toHaveLength(10) // CR-01 ~ CR-10 (CR-10은 v3.5 신설)
  })

  it('사전 판정 셋의 규칙 문언이 이 구현을 서술한다', () => {
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
    expect(statusOf('CR-10')).toContain('500')
  })
})
