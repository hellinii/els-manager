/**
 * 작은 HTML 도구 — **의존성 0** · 순수 — DOC-010 ADR-009
 *
 * 범용 파서가 아니다. 키움 상세 팝업(서버 렌더 JSP)이 실제로 쓰는 모양만 다루고, 모르는
 * 모양은 **추측하지 않고** 호출자가 `MALFORMED`로 멈추게 한다. 그래서 여기 함수들은 실패를
 * 값(`null`)으로 돌려주고 던지지 않는다.
 *
 * ## 왜 DOM 파서를 들이지 않는가
 *
 * 필요한 것이 셋뿐이다 — ⓐ 주석·스크립트 제거 ⓑ 정확한 제목으로 구획 찾기 ⓒ `rowspan`·`colspan`
 * 펼치기. 의존성을 더하면 그 대가(번들·감사·갱신)가 셋의 구현보다 크다. 그리고 관대한 파서는
 * **닫히지 않은 태그를 조용히 고쳐 준다** — 이 원천에서는 그 관대함이 마크업 변경을 가린다.
 */

/**
 * 주석·`<script>`·`<style>`를 **한 번의 훑기로** 지운다.
 *
 * ★ **순서가 아니라 «먼저 오는 것»으로 지운다.** 주석 먼저 지우면 스크립트 안의 `'<!--'`
 * 문자열이 그 뒤 진짜 본문을 삼키고, 스크립트 먼저 지우면 주석 처리된 `<script>`가 같은 일을
 * 한다. HTML 자신의 규칙(스크립트 안에서는 주석이 없고 주석 안에서는 태그가 없다)이 곧 이것이다.
 *
 * 부하를 지는 제거다: E04000에 `<!-- MUL-14136 만기상환평가일자1 … -->`와 주석 처리된
 * 「기초자산 현재가」 열이 있고, E00795의 「만기상환」 낱말은 주석과 공지 제목에만 있다.
 * 닫히지 않은 주석·스크립트는 문서 끝까지를 지운다(HTML 규칙과 같다).
 */
export function stripNoise(html: string): string {
  const opener = /<!--|<script\b|<style\b/gi
  let out = ''
  let cursor = 0
  for (;;) {
    opener.lastIndex = cursor
    const m = opener.exec(html)
    if (m == null) break
    out += html.slice(cursor, m.index)
    const token = m[0].toLowerCase()
    // `toLowerCase()`로 위치를 재지 않는다 — 일부 문자는 소문자화하면 길이가 바뀐다
    const closer =
      token === '<!--' ? /-->/g : token === '<script' ? /<\/script\s*>/gi : /<\/style\s*>/gi
    closer.lastIndex = m.index + m[0].length
    const end = closer.exec(html)
    if (end == null) return out // 닫히지 않았다 — 문서 끝까지가 그 안이다
    cursor = end.index + end[0].length
  }
  return out + html.slice(cursor)
}

/** `from` 이후 첫 일치 위치. 없으면 -1 */
function indexFrom(text: string, pattern: RegExp, from: number): number {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  re.lastIndex = from
  return re.exec(text)?.index ?? -1
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
}

/**
 * 엔티티를 푼다. **모르는 엔티티는 그대로 둔다** — 그러면 뒤의 토큰 정규식이 시끄럽게
 * 실패한다. 조용히 지우면 `1&thinsp;000`이 `1000`처럼 읽힌다.
 *
 * 숫자 참조(`&#N;`·`&#xN;` — `&#39;` 포함)의 코드포인트는 개수이므로 `Number.parseInt`가 허용된다.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const named = NAMED_ENTITIES[body.toLowerCase()]
    if (named != null) return named
    if (/^#x[0-9a-f]+$/i.test(body)) return codePoint(Number.parseInt(body.slice(2), 16), whole)
    if (/^#\d+$/.test(body)) return codePoint(Number.parseInt(body.slice(1), 10), whole)
    return whole
  })
}

function codePoint(n: number, fallback: string): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback
}

/** 태그를 벗기고 → 엔티티를 풀고 → 공백을 접는다 */
export function cellText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 정확한 제목의 구획을 찾는다 — `<h1 class="head-sub-title">X</h1>`에서 시작해 **다음 셋 중
 * 먼저 오는 곳**에서 끝난다.
 *
 * - 다음 `head-sub-title` 제목
 * - 다음 `<section class="tab-content">` — ★ 만기상환 구획 뒤에는 제목 없이 NAV·기준가추이 탭이
 *   오고 **거기 표가 또 있다**(E04000 원본). 제목만 경계로 쓰면 그 표가 만기 구획에 섞이고,
 *   만기 구획이 없는 E00795에서는 조기상환 구획에 섞인다. 픽스처를 잘라 NAV를 지우면 이 결함이
 *   **초록으로 숨는다** — 그래서 픽스처는 `<head>`·`<script>` 본문만 비우고 나머지를 둔다
 * - 문서 끝
 *
 * 「`content-wrap`의 닫힘」은 경계로 쓰지 않는다 — 조기상환정보는 제목이 `content-wrap` **밖**에
 * 있고 표가 다음 `content-wrap` 안에 있어(E04000) 그 규칙이 표를 잘라 낸다. `</section>`도
 * 쓰지 않는다 — 기초자산정보 표의 머리 칸에 툴팁 `<section>`이 있다.
 *
 * 같은 제목이 둘이면 `'DUPLICATE'`다. 없으면 `null`이다(만기 구획처럼 없어도 되는 것이 있다).
 */
export function findSection(clean: string, title: string): string | null | 'DUPLICATE' {
  const headings = [...clean.matchAll(/<h1\s+class="head-sub-title"\s*>([\s\S]*?)<\/h1>/g)]
  const hits = headings.filter((h) => cellText(h[1]!) === title)
  if (hits.length === 0) return null
  if (hits.length > 1) return 'DUPLICATE'
  const start = hits[0]!.index!
  const after = start + hits[0]![0].length
  const next = headings.find((h) => h.index! > start)?.index ?? clean.length
  const tabMatch = /<section\s+class="tab-content"/g
  tabMatch.lastIndex = after
  const tab = tabMatch.exec(clean)?.index ?? clean.length
  return clean.slice(after, Math.min(next, tab))
}

/**
 * 구획 안의 **유일한** `<table>…</table>`. 0개나 2개 이상이면 `null` — 경계가 틀렸거나 마크업이
 * 바뀐 것이므로 추측하지 않는다.
 */
export function onlyTable(section: string): string | null {
  const opens = [...section.matchAll(/<table\b/gi)]
  if (opens.length !== 1) return null
  const start = opens[0]!.index!
  const end = indexFrom(section, /<\/table/i, start)
  return end < 0 ? null : section.slice(start, end)
}

export type RawCell = { text: string; rowspan: number; colspan: number }

/**
 * 표의 한 부분(`thead`·`tbody`)을 행과 셀로 나눈다.
 *
 * ★ **`</td>`를 요구하지 않는다** — 셀은 `<td`·`<th` 시작 태그에서 다음 셀 시작이나 `</tr`까지다.
 * E04000 조기상환정보의 수익확정일 `<td>`가 닫히지 않는다(⑤). `</tr>`도 없을 수 있어 행은 다음
 * `<tr` 시작까지다.
 *
 * `part`의 여는 태그가 없으면 `null`이다.
 */
export function rowsOf(table: string, part: 'thead' | 'tbody'): RawCell[][] | null {
  const open = indexFrom(table, new RegExp(`<${part}\\b`, 'i'), 0)
  if (open < 0) return null
  const closeAt = indexFrom(table, new RegExp(`</${part}`, 'i'), open)
  const body = table.slice(open, closeAt < 0 ? table.length : closeAt)
  const rows: RawCell[][] = []
  for (const chunk of body.split(/<tr\b/i).slice(1)) {
    const endTr = chunk.search(/<\/tr/i)
    const inner = endTr < 0 ? chunk : chunk.slice(0, endTr)
    const cells: RawCell[] = []
    const starts = [...inner.matchAll(/<(td|th)\b([^>]*)>/gi)]
    for (let i = 0; i < starts.length; i += 1) {
      const s = starts[i]!
      const from = s.index! + s[0].length
      const to = i + 1 < starts.length ? starts[i + 1]!.index! : inner.length
      cells.push({
        text: cellText(inner.slice(from, to)),
        rowspan: span(s[2]!, 'rowspan'),
        colspan: span(s[2]!, 'colspan'),
      })
    }
    rows.push(cells)
  }
  return rows
}

function span(attrs: string, name: 'rowspan' | 'colspan'): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*"?(\\d{1,2})"?`, 'i').exec(attrs)
  if (m == null) return 1
  const n = Number.parseInt(m[1]!, 10) // 칸 개수다 — 금액·비율이 아니다
  return n >= 1 ? n : 1
}

/**
 * `rowspan`·`colspan`을 채워 **직사각형**으로 편다. 행마다 폭이 다르면 `null` —
 * 겹치거나 빈 칸이 생긴 표를 추측으로 메우지 않는다.
 *
 * 머리(두 줄 · `colspan`)와 만기 본문(`rowspan="3"`)이 같은 함수를 지난다.
 */
export function expandGrid(rows: readonly RawCell[][]): string[][] | null {
  const grid: (string | undefined)[][] = []
  rows.forEach((row, r) => {
    grid[r] ??= []
    let c = 0
    for (const cell of row) {
      while (grid[r]![c] !== undefined) c += 1
      for (let dr = 0; dr < cell.rowspan; dr += 1) {
        grid[r + dr] ??= []
        for (let dc = 0; dc < cell.colspan; dc += 1) {
          grid[r + dr]![c + dc] = cell.text
        }
      }
      c += cell.colspan
    }
  })
  // rowspan이 표 밖으로 넘친 행은 원래 행 수에서 자른다 — 그 행은 존재하지 않는다
  const out = grid.slice(0, rows.length)
  if (out.length === 0) return []
  const width = out[0]!.length
  for (const row of out) {
    if (row.length !== width) return null
    for (let c = 0; c < width; c += 1) if (row[c] === undefined) return null
  }
  return out as string[][]
}
