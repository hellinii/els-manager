import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 문서 버전의 삼자 대조 — P5b 컷 9 (DOC-000의 컷 9 후보를 구현한다)
 *
 * ## 왜 이 파일이 있는가 — 네 번 일어났다
 *
 * 「① 문서 헤더의 `| 버전 |` ② 그 문서 변경 이력의 **최신** 행 ③ DOC-000 버전 표의 해당 행」
 * 셋이 갈리는 일이 **네 번** 일어났다. DOC-000 v1.4가 둘을 고쳤고, v1.5가 셋째를 찾으며
 * 「그 둘을 고칠 때 이 문서는 보이지 않았다」를 적었고, **P5b 컷 3에서 넷째가 났는데
 * 그것이 DOC-000 자신이었다** — 「전수로 훑지 않으면 어느 원본이 갈렸는지 모른다」고 적은
 * 바로 그 문서가 같은 컷에서 재발시켰다. **즉 주의로 막히지 않는다.**
 *
 * ## DOC-000이 남긴 판단 사항 셋에 대한 답
 *
 * **ⓐ 「최신 행」의 정의** — DOC-008의 변경 이력은 **행 순서가 내림차순이 아니다**(`0.1`이
 * `1.2` 위에 있고, DOC-001은 `0.5` 아래에 `0.8`이 온다). 「첫 행」으로 정의하면 그 문서에서
 * 틀리므로 **최대값**으로 정의하고, 비교는 **점으로 끊어 수치 튜플**로 한다 — 문자열 비교면
 * `1.10 < 1.9`가 되어 열째 판부터 조용히 틀린다.
 *
 * **ⓑ 제외 규칙 — 「미작성 문서」만으로는 부족하다.** 컷 6이 이 검사를 손으로 돌리다
 * 발견했다: **DOC-000에는 변경 이력 표가 «없다».** 그래서 축이 셋이 아니라 **둘**이다.
 * 「셋 다 요구」로 쓰면 이 문서가 **영구히 빨간불**이고, 「있는 축만 요구」로 쓰면 넷째 사례를
 * 잡는다(실제로 잡았다). 미작성 문서는 표에 `—`이고 파일이 없으므로 자연히 빠진다.
 *
 * **ⓒ 헤더 앵커** — 변경 이력 표의 머리글도 `| 버전 |`으로 시작한다. 그래서 헤더는
 * **`| 버전 | <숫자> |` 형태**로만 잡는다(머리글 행은 `| 버전 | 일자 | …`이라 걸리지 않는다).
 *
 * **네 번째 축(`선행 문서`)은 자동화하지 «않는다» — 결정.** DOC-013의 `선행 문서` 행이
 * `DOC-010 v1.8 · DOC-011 v2.6`을 가리키는데 그 둘은 이미 `2.4`·`2.8`이다. 그러나 그것은
 * **드리프트가 아니라 「그 시점에 읽은 버전」이라는 스냅샷**이며, 단언하면 문서 하나를 올릴
 * 때마다 그것을 참조하는 모든 문서를 함께 올려야 한다 — **의미 없는 갱신을 강제하는 검사는
 * 곧 무시된다**(DOC-013 §3.3.1의 「항상 빨간 검사」와 같은 형태). 그 판단을 §11에 등재했다.
 */

const ROOT = process.cwd()
const DOCS = join(ROOT, 'docs')
const INDEX = readFileSync(join(DOCS, '00_문서_인덱스.md'), 'utf8')

/** `1.10 > 1.9`가 되도록 점으로 끊어 수치로 비교한다 */
const parseVersion = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10))
function isNewer(a: string, b: string): boolean {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
const maxVersion = (vs: string[]) => vs.reduce((m, v) => (isNewer(v, m) ? v : m))

/** DOC-000의 버전 표에서 「파일이 있는 문서」만 뽑는다 — 미작성 문서는 `—`이라 정규식에 안 걸린다 */
function indexRows(): { id: string; file: string; version: string }[] {
  return [...INDEX.matchAll(/^\| (DOC-\d+) \|[^|]*\|\s*`([^`]+)`\s*\|\s*([0-9.]+)\s*\|/gm)].map(
    (m) => ({ id: m[1]!, file: m[2]!, version: m[3]! }),
  )
}

/** 헤더의 `| 버전 | x |`. 변경 이력 표의 머리글(`| 버전 | 일자 | …`)은 형태가 달라 걸리지 않는다 */
const headerVersion = (src: string) => /^\| 버전 \| ([0-9.]+) \|\s*$/m.exec(src)?.[1] ?? null

/** 변경 이력의 모든 판. 없으면 `null`(축이 둘인 문서다 — 위 ⓑ) */
function historyMax(src: string): string | null {
  const rows = [...src.matchAll(/^\| ([0-9]+\.[0-9]+) \| \d{4}-\d{2}-\d{2} \|/gm)].map((m) => m[1]!)
  return rows.length ? maxVersion(rows) : null
}

const ROWS = indexRows()

describe('문서 버전 삼자 대조 — DOC-000 컷 9 후보', () => {
  describe('전제 — 파서가 항진명제가 아니다', () => {
    it('버전 비교가 문자열이 아니라 수치다', () => {
      expect(isNewer('1.10', '1.9')).toBe(true) // 문자열 비교였다면 false
      expect(isNewer('2.0', '1.99')).toBe(true)
      expect(isNewer('1.2', '1.2')).toBe(false)
      expect(maxVersion(['0.1', '1.2', '0.8'])).toBe('1.2')
      // 행 순서가 내림차순이 아닌 실제 상황
      expect(maxVersion(['0.5', '0.8', '0.7', '0.6'])).toBe('0.8')
    })

    it('헤더 앵커가 변경 이력 머리글을 잡지 않는다', () => {
      const sample = ['| 버전 | 1.4 |', '', '| 버전 | 일자 | 작성자 | 변경 내용 |', '|---|---|---|---|'].join('\n')
      expect(headerVersion(sample)).toBe('1.4')
    })

    it('이력 표가 없는 문서는 null을 준다 — 축이 둘이다', () => {
      expect(historyMax('| 버전 | 2.0 |\n본문뿐')).toBeNull()
      expect(historyMax('| 0.3 | 2026-07-30 | 민서 | x |\n| 0.4 | 2026-07-31 | 민서 | y |')).toBe('0.4')
    })

    it('인덱스 표에서 실재 문서를 실제로 읽었다', () => {
      // 0건이면 아래 대조가 전부 항진명제가 된다.
      expect(ROWS.length).toBeGreaterThanOrEqual(9)
      expect(ROWS.map((r) => r.id)).toContain('DOC-013')
      for (const r of ROWS) expect(existsSync(join(DOCS, r.file)), `${r.file}이 없다`).toBe(true)
    })

    it('미작성 문서는 표에서 자연히 빠진다', () => {
      // DOC-003·004·006·009·012는 파일 칸이 `—`이라 정규식이 잡지 않는다.
      const ids = ROWS.map((r) => r.id)
      for (const missing of ['DOC-003', 'DOC-004', 'DOC-006', 'DOC-009', 'DOC-012']) {
        expect(ids, `${missing}은 미작성이므로 대조 대상이 아니다`).not.toContain(missing)
      }
      // 그리고 그 문서들이 표에는 실재해야 한다 — 표에서 사라지면 이 제외가 조용해진다
      for (const missing of ['DOC-006', 'DOC-009', 'DOC-012']) {
        expect(INDEX, `${missing} 행이 표에 있어야 한다`).toContain(`| ${missing} |`)
      }
    })
  })

  it('★ 세 축(있는 것만)이 문서마다 일치한다', () => {
    const drift: string[] = []
    for (const { id, file, version } of ROWS) {
      const src = readFileSync(join(DOCS, file), 'utf8')
      const header = headerVersion(src)
      const history = historyMax(src)
      const axes = [
        ['헤더', header],
        ['이력최신', history],
        ['인덱스표', version],
      ].filter(([, v]) => v !== null) as [string, string][]
      const distinct = new Set(axes.map(([, v]) => v))
      if (distinct.size !== 1) {
        drift.push(`${id}: ` + axes.map(([k, v]) => `${k}=${v}`).join(' · '))
      }
    }
    expect(
      drift,
      '문서 버전을 올릴 때 헤더·변경 이력·DOC-000 버전 표 셋을 함께 고친다',
    ).toEqual([])
  })

  it('축이 둘인 문서는 DOC-000 하나뿐이다 — 늘어나면 이유를 확인한다', () => {
    // 「이력 표가 없다」가 정상인 문서가 늘면 제외 규칙이 넓어지는 것이고,
    // 그때는 규칙이 아니라 그 문서가 이상한지 먼저 본다.
    const twoAxis = ROWS.filter(
      ({ file }) => historyMax(readFileSync(join(DOCS, file), 'utf8')) === null,
    ).map((r) => r.id)
    expect(twoAxis).toEqual(['DOC-000'])
  })

  it('헤더 버전이 없는 문서가 없다 — 축 하나가 통째로 빠지지 않는다', () => {
    const noHeader = ROWS.filter(
      ({ file }) => headerVersion(readFileSync(join(DOCS, file), 'utf8')) === null,
    ).map((r) => r.id)
    expect(noHeader).toEqual([])
  })
})
