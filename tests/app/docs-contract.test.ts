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

// ---------------------------------------------------------------------------
// DOC-010 §7 권한 정책 요약 ↔ `authz-matrix.ts` — P5a 컷 4
// ---------------------------------------------------------------------------

/**
 * **원장이 둘인데 대조가 없었다 — 그래서 한쪽이 낡았다.**
 *
 * `tests/rls/`의 카탈로그 대조는 `authz-matrix.ts`를 실제 GRANT와 양방향으로 맞춘다.
 * 그런데 DOC-010 §7의 「권한 정책 요약」 표는 **아무도 보지 않았고**, 컷 2a가
 * `asset_provider_symbols`에 전 DML을 부여한 뒤에도 그 표는 「없음(마이그레이션 전용)」인
 * 채였다. `cron_runs` 행은 아예 없었다. **모든 스위트가 초록인 채로 문서가 거짓이었다.**
 *
 * AQ-11 자신이 「권한 표를 데이터로 박는다」를 방어의 정본으로 삼았으므로 이 낡음은
 * 방어의 근거를 갉아먹는다 — **fail-open이 아니라 「근거 문서가 거짓」**이라는 다른 부류다.
 *
 * ## 왜 상시 스위트인가
 *
 * 대조 대상 둘이 **파일**이다(마크다운 + TS 상수). DB가 필요 없으므로 `tests/rls/`에 두면
 * 인프라가 있는 사람만 이 거짓을 보게 된다 — 그것이 이 낡음이 오래 살아남은 이유이기도 하다.
 *
 * ## 이름만 본다 — 권한 «내용»은 대조하지 않는다
 *
 * 표의 「조회」·「변경」 칸은 **산문**이고(「상품 소유자」·「관측 좌표는 불변」) 원장은
 * `['INSERT','SELECT']` 같은 집합이다. 그 둘을 문자열로 맞추려 하면 문서를 코드처럼 쓰게
 * 되고, 그러면 사람이 읽는 값이 사라진다. **집합이 갈리는 것을 잡는 층은 카탈로그 대조이며
 * 여기서 잡는 것은 「행이 빠졌다」다** — 실제로 낡은 방식이 그것이었다.
 */
describe('DOC-010 §7 권한 표 ↔ 권한 원장', () => {
  const DOC_010 = join(process.cwd(), 'docs', '10_아키텍처_및_기술결정.md')

  /** 표의 첫 열에서 백틱 이름을 전부 뽑는다 — 한 행이 여러 테이블을 담을 수 있다 */
  const documented = (() => {
    const lines = readFileSync(DOC_010, 'utf8').split('\n')
    const at = lines.indexOf('| 테이블 | 조회 | 변경 |')
    expect(at, '§7 권한 정책 요약 표를 찾지 못했다').toBeGreaterThan(-1)
    expect(lines.indexOf('| 테이블 | 조회 | 변경 |', at + 1), '같은 헤더가 둘 이상이다').toBe(-1)
    expect(lines[at + 1]).toMatch(/^\|(?:-+\|)+$/)

    const names = new Set<string>()
    let rows = 0
    for (const line of lines.slice(at + 2)) {
      if (!line.startsWith('|')) break
      rows += 1
      const firstCell = line.replace(/^\|/, '').split('|', 1)[0]!
      for (const m of firstCell.matchAll(/`([a-z_]+)`/g)) names.add(m[1]!)
    }
    expect(rows, '표를 0행 파싱했다').toBeGreaterThan(0)
    return names
  })()

  it('파서가 이름을 실제로 뽑았다 — 0개를 뽑고 초록이 되는 것을 막는다', () => {
    expect(documented.size).toBeGreaterThan(5)
    expect(documented).toContain('users')
  })

  it('문서의 테이블 집합이 원장과 «정확히» 같다', async () => {
    /*
     * ★ **정확 일치다 — 부분집합이 아니다.** 부분집합으로 두면 ⓐ 새 테이블이 원장에만
     * 들어오는 것(= 컷 2a에서 실제로 일어난 일)과 ⓑ 문서에만 남은 낡은 이름이 **둘 다**
     * 통과한다. 「겹치지 않는가」를 세는 열거는 「빠지지 않았는가」에 답하지 못한다.
     *
     * ★★ 그래서 표의 행을 「`els_products` 및 하위」로 «묶을 수 없다** — 그 표현이
     * 이름을 숨긴다. 하위 둘을 명시하게 만든 것이 이 단언의 부수 효과이며, 표가 더
     * 정확해졌다.
     */
    const { TABLE_PRIVILEGES } = await import('../rls/helpers/authz-matrix')
    expect([...documented].sort()).toEqual(Object.keys(TABLE_PRIVILEGES).sort())
  })
})
