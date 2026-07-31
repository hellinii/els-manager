import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { errorNotice } from '@/lib/format/errorNotice'

/**
 * 오류 경계의 판단 — AQ-38 (c), P5b 컷 10
 *
 * ## 이 파일이 닫는 것과 «닫지 못하는» 것
 *
 * **닫는 것:** 경계가 무엇을 렌더하기로 했는가(문구 · `digest` 칩의 분기).
 * **닫지 못하는 것:** **프로덕션에서 `Error`가 실제로 redact되는가.** 그것은 경계가
 * 실행돼야 보이고 그 경로가 지금 없다 — AQ-38이 그 잔여를 안고 열려 있다.
 *
 * **경로가 없다는 것은 컷 10이 전수로 확인했다**(후보 (b)의 선행 조건):
 * 세 라우트가 `isUuid`로 가드하고, `searchParams`는 순수 파서를 지나며, 페이지 렌더
 * 경로의 `catch`는 `tax/page.tsx` 하나뿐이고, Q-06 절단 예외는 999행 상주를 요구한다.
 * **URL로 도달하면서 잡히지 않는 던짐이 0이다** — 그것이 (b)를 닫고 (c)를 남긴 근거다.
 *
 * ## 소스 단언이 이 파일의 절반이다
 *
 * 「경계에서 오류의 «종류»를 판별하지 않는다」는 CLAUDE.md가 `tests/e2e/`를 프로덕션
 * 빌드로 띄우는 근거이자 `error.tsx` 설계의 전제다. 그런데 그것을 **행동으로 관측할
 * 수 없으므로**(위) 소스로 고정한다 — `invalidation.test.ts`가 `force-dynamic`을
 * 같은 이유로 소스 단언으로 옮긴 것과 같은 자리다.
 */

const ROOT = process.cwd()
const BOUNDARIES = ['src/app/error.tsx', 'src/app/global-error.tsx'] as const

describe('오류 경계의 판단 — AQ-38 (c)', () => {
  describe('digest 분기', () => {
    it('digest가 있으면 그대로 보여 준다', () => {
      expect(errorNotice({ digest: 'a1b2c3' }).digest).toBe('a1b2c3')
    })

    it('digest가 없으면 null이다 — 개발 모드가 이 갈래다', () => {
      expect(errorNotice({}).digest).toBeNull()
      expect(errorNotice({ digest: undefined }).digest).toBeNull()
    })

    it('★ 빈 문자열도 없는 것으로 접는다 — 종전 구현은 빈 칩을 렌더했다', () => {
      // `error.digest != null &&`는 `''`를 통과시켜 **내용 없는 회색 칩**을 만든다.
      // 「코드와 함께 알린다」고 적어 놓고 빈 칩을 보여 주는 상태이며, 화면은 정상으로
      // 보이고 신고만 성립하지 않는다. `env.ts`가 부재와 빈 문자열을 함께 던지는 규약과 같다.
      expect(errorNotice({ digest: '' }).digest).toBeNull()
      expect(errorNotice({ digest: '   ' }).digest).toBeNull()
    })

    it('global 문구가 page와 다르다 — 상태가 다르기 때문이다', () => {
      // 루트 레이아웃이 깨지면 셸도 스타일도 없다. 「다시 시도」가 아니라 새로고침이다.
      const page = errorNotice({ digest: 'x' })
      const global = errorNotice({ digest: 'x' }, 'global')
      expect(global.title).not.toBe(page.title)
      expect(global.body).toContain('새로고침')
      // ★ 그러나 digest 판단은 «같다» — 나누면 한쪽만 고쳐지는 상태가 다시 생긴다.
      expect(errorNotice({ digest: '' }, 'global').digest).toBeNull()
      expect(errorNotice({ digest: '  ' }, 'global').digest).toBeNull()
    })

    it('문구 둘은 비어 있지 않고 「코드와 함께 알린다」를 말한다', () => {
      const n = errorNotice({ digest: 'x' })
      expect(n.title.length).toBeGreaterThan(0)
      // 재시도만 권하면 Q-06 절단 예외 같은 «의도된 신호»가 「가끔 실패하는 화면」으로 읽힌다.
      expect(n.body).toContain('알린다')
    })
  })

  describe('★ 경계는 오류의 종류를 판별하지 않는다 — 소스 단언', () => {
    // 운영에서 `Error`가 redact되면 메시지도 프로토타입도 사라지고 `digest`만 온다.
    // 개발에서는 동작하고 **운영에서만 조용히 무너지는** 코드이므로 애초에 두지 않는다.
    const FORBIDDEN = [
      { pattern: /\berror\.message\b/, why: '운영에서 메시지가 redact된다' },
      { pattern: /\berror\.name\b/, why: '같은 이유' },
      { pattern: /\berror\.stack\b/, why: '같은 이유' },
      { pattern: /\binstanceof\b/, why: '프로토타입이 사라져 항상 거짓이 된다' },
      { pattern: /\berror\.cause\b/, why: '같은 이유' },
    ] as const

    for (const rel of BOUNDARIES) {
      it(`${rel}가 오류의 내용을 읽지 않는다`, () => {
        const src = readFileSync(join(ROOT, rel), 'utf8')
          .split('\n')
          .filter((l) => !/^\s*\*|^\s*\/\*|^\s*\/\//.test(l)) // 주석은 그 함정을 «설명»한다
          .join('\n')
        for (const { pattern, why } of FORBIDDEN) {
          expect(src, `${rel}: ${pattern} — ${why}`).not.toMatch(pattern)
        }
      })
    }

    it('전제 — 두 파일을 실제로 읽었고 주석 제거가 본문을 지우지 않았다', () => {
      // 0바이트를 읽으면 위 단언이 전부 항진명제가 된다.
      for (const rel of BOUNDARIES) {
        const src = readFileSync(join(ROOT, rel), 'utf8')
        expect(src.length, `${rel}`).toBeGreaterThan(200)
        expect(src).toContain('export default')
      }
    })

    it('전제 — 스캐너가 실제로 갈린다 (합성 입력)', () => {
      const bad = 'if (error.message.includes("x")) return null'
      expect(bad).toMatch(/\berror\.message\b/)
      const good = 'const notice = errorNotice(error)'
      expect(good).not.toMatch(/\berror\.message\b/)
    })
  })

  it('경계 «둘 다» 판단을 순수 모듈에 위임한다 — 분기가 되돌아오지 않는다', () => {
    // 양쪽을 보는 것이 요점이다. 초안은 `error.tsx`만 옮겼고 `global-error.tsx`에
    // 같은 분기가 남아 **빈 문자열 갈래가 한쪽에만 고쳐진 상태**였다.
    for (const rel of BOUNDARIES) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src, rel).toContain("from '@/lib/format/errorNotice'")
      expect(src, rel).toMatch(/errorNotice\(error/)
      // 종전 형태가 돌아오면 빈 문자열 갈래가 다시 열린다.
      expect(src, rel).not.toMatch(/error\.digest\s*!=\s*null/)
    }
  })
})
