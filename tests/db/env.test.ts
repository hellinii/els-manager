import { afterEach, describe, expect, it } from 'vitest'

import { cronSecret, supabaseEnv } from '@/lib/db/env'

/**
 * 환경변수 해석 — DOC-010 §7.2, DOC-013 §5.2 (P5b 컷 1 신설)
 *
 * **이 파일이 없었다.** `env.ts`는 P3a부터 있었지만 그것을 직접 시험하는 스위트가
 * 하나도 없었고, 「부재 시 즉시 던진다」는 규약이 실행되는 것을 아무도 보지 않았다 —
 * 앱이 뜨면 값이 있으므로 그 갈래는 정상 경로에 나타나지 않는다.
 *
 * **컷 1이 그 공백을 결함으로 만들었다.** `CRON_SECRET`이 들어오면서 「빈 문자열도
 * 부재」가 편의가 아니라 **보안 규칙**이 되었다: 빈 값이면 `Bearer `로 시작하는 모든
 * 헤더가 일치하므로 인증이 조용히 사라진다(§7.1 CR-06).
 *
 * ## 환경을 케이스마다 되돌린다
 *
 * `process.env`는 프로세스 전역이고 vitest는 파일 안에서 케이스를 순차 실행한다. 지우지
 * 않으면 **다음 케이스가 앞 케이스의 값을 본다** — 그것이 「실행 순서가 데이터인
 * 초록색」의 가장 싼 형태다. 그래서 각 케이스는 필요한 변수만 세우고 `afterEach`가
 * 원래 값을 복원한다(개발자 기계의 셸에 값이 있어도 결과가 같아야 한다).
 */

const NAMES = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CRON_SECRET'] as const

const ORIGINAL = new Map<string, string | undefined>(
  NAMES.map((name) => [name, process.env[name]]),
)

function set(name: (typeof NAMES)[number], value: string | undefined): void {
  if (value == null) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of ORIGINAL) {
    if (value == null) delete process.env[name]
    else process.env[name] = value
  }
})

describe('cronSecret', () => {
  it('미설정이면 던진다 — 변수명을 지목한다', () => {
    set('CRON_SECRET', undefined)
    expect(() => cronSecret()).toThrow(/CRON_SECRET/)
  })

  it('★ 빈 문자열도 던진다 — 통과시키면 `Bearer `로 시작하는 모든 헤더가 일치한다', () => {
    /*
     * 이것이 이 파일의 존재 이유다. `require_`의 규약(「빈 문자열도 부재」)은 URL·공개
     * 키에서는 편의였다(실패를 첫 조회까지 미루지 않는다). 비밀에서는 **fail-open의
     * 유일한 문**이다 — 그 갈래를 `lib/cron/decide.ts`가 한 번 더 막지만, 두 겹 중
     * 앞의 겹이 여기다.
     */
    set('CRON_SECRET', '')
    expect(() => cronSecret()).toThrow(/CRON_SECRET/)
  })

  it('공백만 있어도 던진다 — `trim()` 규약', () => {
    set('CRON_SECRET', '   ')
    expect(() => cronSecret()).toThrow(/CRON_SECRET/)
  })

  it('값이 있으면 그대로 돌려준다 — 다듬지 않는다', () => {
    // 비밀을 정규화하면 「설정한 값」과 「비교되는 값」이 갈린다. 그 갈림은 401로만 보인다.
    set('CRON_SECRET', ' x7Qk2pR9vLm4Ns8T ')
    expect(cronSecret()).toBe(' x7Qk2pR9vLm4Ns8T ')
  })

  /*
   * ★ **「오류 메시지에 값이 담기지 않는다」는 케이스를 두지 않는다.** 초안에 있었고
   * 실측으로 지웠다 — 던지는 갈래의 값은 **언제나 빈 문자열이거나 공백**이므로 담길 값이
   * 없다(`'  틀린비밀  '`는 `trim()` 뒤 비지 않아 애초에 던지지 않는다). 그 케이스는
   * 무엇도 판별하지 않으면서 방어가 있는 것처럼 보이게 한다.
   *
   * 값이 실린 메시지가 가능해지는 날은 `require_`가 **다른 이유로**(예: 최소 길이) 던지게
   * 되는 날이며, 그때 필요한 것은 이 케이스가 아니라 그 검증에 붙는 케이스다.
   */

  it('고치는 법을 말한다 — 부재의 진단이 메시지 하나뿐이다', () => {
    set('CRON_SECRET', undefined)
    expect(() => cronSecret()).toThrow(/\.env\.example/)
  })
})

describe('supabaseEnv', () => {
  it('둘 다 있으면 해석한다', () => {
    set('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    expect(supabaseEnv()).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon-key' })
  })

  it('빠진 쪽을 지목한다 — 둘 중 어느 것인지가 진단의 전부다', () => {
    set('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
    expect(() => supabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)

    set('NEXT_PUBLIC_SUPABASE_URL', undefined)
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    expect(() => supabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('빈 문자열도 부재다 — "URL이 빈 클라이언트"를 만들지 않는다', () => {
    set('NEXT_PUBLIC_SUPABASE_URL', '')
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    expect(() => supabaseEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('`CRON_SECRET`을 요구하지 않는다 — 앱 경로와 배치 경로가 갈린다', () => {
    /*
     * 셋을 한 함수에서 읽으면 `CRON_SECRET`이 없는 로컬 기계에서 **앱 전체가 죽는다**
     * (프록시가 매 요청에서 `supabaseEnv()`를 지난다). 두 함수인 것이 그 격리이며,
     * 그래서 `.env.example`의 `CRON_SECRET`이 로컬에서 선택일 수 있다.
     */
    set('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    set('CRON_SECRET', undefined)
    expect(() => supabaseEnv()).not.toThrow()
  })
})
