import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EMPTY_STATES, missingUpcomingNote, SCOPE_LABELS, SECTION_EMPTY } from '@/lib/format'

import { liveDoc, liveText, quoteBlock } from './docText'

/**
 * 절 빈 상태의 글자 — SCR-101 ① ④ ⑤ · SCR-301 「다가오는 평가일」 (홈 피드백 컷 K4) · 화면 전체의 빈 상태 (홈 피드백 컷 K12)
 *
 * 셋을 본다. ⓐ ①의 뒷절이 **가리킬 블록이 있을 때만** 붙는다(DOC-008 SQ-28) — 그 판단은 화면 파일에 두면 어느
 * 스위트도 보지 못한다(AQ-23). ⓑ 글자가 DOC-005 §2.1의 문체다. ⓒ 글자가 DOC-008의 정본과 「」째로 같다 — 그 대조는
 * **취소선과 변경 이력 행을 벗긴 글**에 건다(`liveDoc`). 종전 문구가 취소선으로 문서에 남아 있으므로 원문에 걸면
 * 코드를 종전으로 되돌려도 초록이다.
 *
 * 화면 전체의 빈 상태(`EMPTY_STATES` — 홈 둘 · SCR-201 셋 · SCR-301 셋 · K12)는 넷을 본다. ⓓ 같은 사실은 화면이 달라도 같은
 * 글자다(DOC-008 §6 「SCR-201·301의 빈 상태가 하나씩 늘었다」 — 「그때 쓴 문구·행동을 두 화면이 그대로 쓴다」) ⓔ 「내 것만
 * 없다」는 넓히는 길을 표시 범위의 글자(「모든 사용자」)로 말한다 ⓕ 문체 ⓖ DOC-008 §6 「화면 빈 상태의 글자」 표의 **그 키의
 * 행**과 「」째로 같다.
 */

type EmptyKey = keyof typeof EMPTY_STATES
const EMPTY_ENTRIES = Object.entries(EMPTY_STATES) as Array<[EmptyKey, (typeof EMPTY_STATES)[EmptyKey]]>

const DOC_008 = '08_정보구조_및_화면목록.md'

describe('① 빈 줄의 뒷절 — DOC-008 SQ-28', () => {
  it('★ 홈은 ⑥에 항목이 있을 때만 뒷절을 붙인다 — 없는 블록을 가리키지 않는다', () => {
    /*
     * ★ 보유 상품이 전부 상환완료이거나 평가일정이 없는 결함 상품뿐이면 ①과 ⑥이 둘 다 빈다. ⑥은 0건이면 그리지
     * 않으므로(알림이다) 그때 「위 「상환 확인 필요」를 보세요」는 화면에 없는 것을 가리킨다 — 종전 문구부터 있던 한계다.
     */
    expect(missingUpcomingNote('HOME', 0)).toBe(SECTION_EMPTY.upcoming)
    expect(missingUpcomingNote('HOME', 0)).not.toContain('상환 확인 필요')

    const withChecks = missingUpcomingNote('HOME', 1)
    expect(withChecks.startsWith(`${SECTION_EMPTY.upcoming} — `)).toBe(true)
    expect(withChecks).toContain('「상환 확인 필요」')
    // 건수는 있음 · 없음만 가른다 — 문구가 건수를 말하지 않는다(그 수는 ⑥의 머리가 적는다)
    expect(missingUpcomingNote('HOME', 3)).toBe(withChecks)
  })

  it('★ SCR-301은 ⑥의 건수를 모르므로 뒷절이 조건문이다 — ⑥이 비어 있어도 참이다', () => {
    const note = missingUpcomingNote('SCHEDULE')
    expect(note.startsWith(`${SECTION_EMPTY.upcoming} — `)).toBe(true)
    expect(note).toContain('「상환 확인 필요」')
    // 「있으면」이 그 조건이다. 홈의 지시형(「보세요」)을 그대로 쓰면 ⑥이 빈 날 없는 블록을 가리킨다
    expect(note).toContain('있으면')
    expect(note).not.toBe(missingUpcomingNote('HOME', 1))
  })
})

describe('문체 — DOC-005 §2.1', () => {
  /** 평서 종결 「~다」 — 문장 끝(마침표 · 따옴표 · 대시 · 줄끝) 앞의 「다」. 「마다」 · 「보다」는 종결이 아니다 */
  const declarative = (text: string): string[] =>
    [...text.matchAll(/[가-힣]다(?=[.」\s—]|$)/g)].map((m) => m[0]).filter((w) => w !== '마다' && w !== '보다')

  it('스캐너가 살아 있다 — 평서 종결을 잡고 명사형 · 해요체를 잡지 않는다', () => {
    // 이것이 0을 내면 아래 둘이 항진명제다
    expect(declarative('임박한 평가일이 없다.')).toHaveLength(1)
    expect(declarative('경과한 차수의 상환은 위 「상환 확인 필요」가 묻는다.')).toHaveLength(1)
    expect(declarative('주의 상태 상품 없음')).toHaveLength(0)
    expect(declarative('사라져요.')).toHaveLength(0)
  })

  it('제목 셋은 명사형이다 — 종결어미 · 마침표 · 「요」로 끝나지 않는다', () => {
    const titles = Object.values(SECTION_EMPTY)
    expect(titles).toHaveLength(3)
    for (const title of titles) {
      expect(declarative(title), title).toEqual([])
      expect(title, title).not.toMatch(/[.요]$/)
      expect(title, title).toMatch(/없음$/)
    }
  })

  it('뒷절이 있는 안내는 해요체다 — 평서 종결이 없고 「~요.」로 끝난다', () => {
    for (const note of [missingUpcomingNote('HOME', 1), missingUpcomingNote('SCHEDULE')]) {
      expect(declarative(note), note).toEqual([])
      expect(note, note).toMatch(/요\.$/)
    }
  })

  it.each(EMPTY_ENTRIES)('화면 빈 상태 %s — 제목은 「~없음」 · 설명은 해요체 · 행동은 동작 이름 (K12)', (_key, text) => {
    expect(declarative(text.title)).toEqual([])
    expect(text.title).toMatch(/없음$/)
    expect(declarative(text.description)).toEqual([])
    expect(text.description).toMatch(/요\.$/)
    // 버튼은 명사(동작 이름) — 「~하기」 · 「~한다」를 붙이지 않는다. 「~보기」는 관용형으로 허용한다(DOC-005 §2.1)
    expect(declarative(text.action)).toEqual([])
    expect(text.action).not.toMatch(/[.요]$|하기$/)
  })
})

describe('화면 빈 상태 — 한 사실에 한 이름 (홈 피드백 컷 K12 · DOC-008 §6)', () => {
  it('전제 — 여덟이다: 홈 둘(범위) · SCR-201 셋 · SCR-301 셋(넷째 「다가오는 평가일 없음」은 `missingUpcomingNote`)', () => {
    expect(Object.keys(EMPTY_STATES).sort()).toEqual(
      [
        'homeMine',
        'homeAll',
        'productsMine',
        'productsNarrowed',
        'productsAll',
        'scheduleMine',
        'scheduleNarrowed',
        'scheduleAll',
      ].sort(),
    )
  })

  it('★ 홈과 SCR-201의 같은 상태는 같은 제목이다 — SCR-101이 먼저 지난 자리의 문구를 두 화면이 그대로 쓴다', () => {
    expect(EMPTY_STATES.productsMine.title).toBe(EMPTY_STATES.homeMine.title)
    expect(EMPTY_STATES.productsAll.title).toBe(EMPTY_STATES.homeAll.title)
    // 이 축을 넓히는 행동은 두 목록 화면이 같은 글자다 — 표시 범위의 「모든 사용자」를 따른다
    expect(EMPTY_STATES.scheduleMine.action).toBe(EMPTY_STATES.productsMine.action)
    expect(EMPTY_STATES.productsMine.action).toBe(`${SCOPE_LABELS.ALL}로 보기`)
  })

  it('★ 같은 화면의 상태는 서로 다른 글자다 — 구분이 성립해야 다음 행동이 갈린다 (ST-02)', () => {
    const screens: EmptyKey[][] = [
      ['homeMine', 'homeAll'],
      ['productsMine', 'productsNarrowed', 'productsAll'],
      ['scheduleMine', 'scheduleNarrowed', 'scheduleAll'],
    ]
    for (const keys of screens) {
      expect(new Set(keys.map((k) => EMPTY_STATES[k].title)).size, keys.join(' · ')).toBe(keys.length)
      expect(new Set(keys.map((k) => EMPTY_STATES[k].description)).size, keys.join(' · ')).toBe(keys.length)
    }
    // SCR-301의 넷째(「다가오는 평가일 없음」)와도 겹치지 않는다
    expect(EMPTY_STATES.scheduleAll.title).not.toBe(SECTION_EMPTY.upcoming)
  })

  it('★ 「내 것만 없다」는 넓히는 길을 「모든 사용자」로 말하고 이 축에 「전체」를 쓰지 않는다 (민서 결정(2026-10-12) D6)', () => {
    for (const key of ['homeMine', 'productsMine', 'scheduleMine'] as const) {
      expect(EMPTY_STATES[key].description, key).toContain(`「${SCOPE_LABELS.ALL}」`)
    }
    for (const [key, text] of EMPTY_ENTRIES) {
      expect(`${text.title} ${text.description} ${text.action}`, key).not.toMatch(/전체/)
    }
  })
})

describe('글자 ↔ DOC-008 (취소선 · 이력 행 밖의 글)', () => {
  const doc = liveDoc(DOC_008)
  /*
   * ~~문서 전체~~ → **정본 각주 블록 하나** *(홈 피드백 컷 K7 — K4 검증 지적)*. ①의 제목 「다가오는 평가일 없음」은 SQ-28 ·
   * K0 ① 각주도 인용하므로 문서 전체에 걸면 정본 각주에서 그 제목을 바꿔도(지워도) 초록이었다(실측 — K7 음성 대조)
   */
  const footnote = quoteBlock(doc, '> **①의 절 단위 빈 상태는 이 표의 빈 상태가 아니다.**')

  it.each(Object.entries(SECTION_EMPTY))('절 빈 상태 제목 %s — §6 「①의 절 단위 빈 상태」 각주', (_key, title) => {
    expect(footnote).toContain(`「${title}」`)
  })

  it('홈 ①의 뒷절 있는 줄 — 같은 각주', () => {
    expect(footnote).toContain(`「${missingUpcomingNote('HOME', 1)}」`)
  })

  it('SCR-301의 줄 — §5 빈 상태 표의 「다가오는 평가일이 없다」 행', () => {
    const row = doc.split('\n').find((line) => line.startsWith('| **다가오는 평가일이 없다** |'))
    expect(row, 'SCR-301 빈 상태 표의 그 행이 없다').toBeDefined()
    expect(row).toContain(`「${missingUpcomingNote('SCHEDULE')}」`)
  })
})

describe('화면 빈 상태 ↔ DOC-008 §6 「화면 빈 상태의 글자」 (살아 있는 글 · 그 각주의 그 키의 행 · 홈 피드백 컷 K12)', () => {
  /*
   * 결속은 **각주 하나의 그 키의 행**에 건다 — 문서 전체에 걸면 제목이 다른 자리(§6 표 · SCR-201 · 301 각주)에도 있어 정본에서
   * 바꿔도 초록이고(K7 · K8 실측과 같은 부류), 블록 전체에 걸면 두 상태의 글자를 맞바꿔도 초록이다(홈과 SCR-201은 제목이 같다)
   */
  const block = quoteBlock(liveDoc(DOC_008), '> **화면 빈 상태의 글자')
  const rowOf = (key: string): string | undefined => block.split('\n').find((line) => line.startsWith(`> | \`${key}\` |`))

  it('전제 — 표의 행이 키 여덟과 정확히 맞는다(문서에만 있는 행 · 코드에만 있는 키가 없다)', () => {
    const documented = [...block.matchAll(/^> \| `(\w+)` \|/gm)].map((m) => m[1])
    expect(documented.sort()).toEqual(Object.keys(EMPTY_STATES).sort())
  })

  it.each(EMPTY_ENTRIES)('%s — 제목 · 설명 · 다음 행동이 그 행에 「」째로 있다', (key, text) => {
    const row = rowOf(key)
    expect(row, `${key}의 행이 없다`).toBeDefined()
    expect(row).toContain(`「${text.title}」`)
    expect(row).toContain(`「${text.description}」`)
    expect(row).toContain(`「${text.action}」`)
  })
})

describe('liveDoc — 결속이 종전 문구에 초록이 되지 않는다', () => {
  it('합성 입력 — 줄 안의 취소선 여럿과 이력 행을 벗긴다', () => {
    const text = [
      '| 2.49 | 2026-10-13 | 민서 | 「이력이 인용한 종전 문구」 |',
      '> 본문 ~~「종전 하나」~~ → 「새 문구」 · ~~「종전 둘」~~ 끝',
      '| 버전 | 2.49 |',
    ].join('\n')
    const live = liveText(text)
    expect(live).not.toContain('이력이 인용한')
    expect(live).not.toContain('종전 하나')
    expect(live).not.toContain('종전 둘')
    // 벗기지 말아야 할 것 — 새 문구와 헤더 표(이력 행이 아니다)
    expect(live).toContain('「새 문구」')
    expect(live).toContain('| 버전 | 2.49 |')
  })

  it.each([
    // 이 컷이 취소선으로 남긴 ① 빈 줄의 종전 제목. v1.0 변경 이력 행도 이 글을 인용하므로 이력 행 벗기기도 함께
    // 본다(실측 — 이력 행 필터만 지우면 이 줄이 빨강이다)
    ['「임박한 평가일이 없다」'],
    // P6 컷 7-6(v2.46)이 취소선으로 남긴 SCR-202 충족 문장의 v2.44 형태 — 괄호가 「(추정)」뿐이던 판. 끝절만 잡으면
    // 살아 있는 v2.46 문장(「(워스트오브 {W} ≥ 배리어 {B} · 추정). 상환되었으면 …」)에도 맞는다(실측 — 이 단언의 첫 판이 빨강)
    ['조건을 충족했다(추정). 상환되었으면 기록한다.」'],
  ])('실제 문서 — %s는 원문에 있고 살아 있는 글에는 없다', (phrase) => {
    // 원문에 있어야 대조가 성립한다 — 없으면 아래 음성 단언이 항진명제다
    expect(readFileSync(join(process.cwd(), 'docs', DOC_008), 'utf8')).toContain(phrase)
    expect(liveDoc(DOC_008)).not.toContain(phrase)
  })
})
