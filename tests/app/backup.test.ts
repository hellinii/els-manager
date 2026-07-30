import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 백업 스크립트 ↔ DOC-013 §8.2 대조 — AQ-04
 *
 * ## 왜 이 파일이 있는가
 *
 * §8.2가 표로 정한 값들(3종의 플래그 · 보존 8주 · 임계 8일)이 **셸 스크립트 안에**
 * 있다. 그리고 그 스크립트는 **어느 스위트도 실행하지 않는다** — launchd가 주 1회
 * 부르고 실패하면 파일이 없을 뿐이다(§8.4 잔여 ⓐⓒⓓ). 즉 문서와 구현이 갈리면
 * **다음 재해까지 아무도 모른다.**
 *
 * 그래서 `tests/app/invalidation.test.ts`가 `vercel.json` ↔ §6.2에 쓴 것과 같은 형태를
 * 쓴다 — **문서를 파싱해 구현과 대조하고, 방향은 「설정이 문서를 따른다」다.**
 *
 * **이 파일은 백업이 도는지 보지 않는다.** 그것은 Docker·네트워크·운영 DB를 요구하므로
 * ADR-003의 전제를 깬다(상시 스위트는 DB에 접근하지 않는다). 여기서 보는 것은
 * **「문서가 말하는 값이 스크립트 안에 그 값으로 있는가」** 하나다.
 */

const ROOT = process.cwd()
const DOC = readFileSync(join(ROOT, 'docs', '13_배포_및_운영.md'), 'utf8')
const DUMP = readFileSync(join(ROOT, 'scripts', 'db-dump.sh'), 'utf8')
const CHECK = readFileSync(join(ROOT, 'scripts', 'db-dump-check.sh'), 'utf8')
const DRILL = readFileSync(join(ROOT, 'scripts', 'db-restore-drill.sh'), 'utf8')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('백업 — DOC-013 §8.2 ↔ scripts/', () => {
  it('전제 — 읽은 문서가 §8.2를 담고 있다', () => {
    // 파서가 0건을 찾아 「대조가 항진명제」가 되는 것을 막는다. §8.3.1이 그 함정을
    // COPY 파서에서 실제로 밟았다.
    expect(DOC).toContain('### 8.2 로컬 스케줄 덤프')
    expect(DOC).toContain('#### 8.2.1 `.env.backup`의 정본은 이 블록이다')
  })

  it('npm 스크립트 셋이 §8.2의 표와 같은 파일을 가리킨다', () => {
    expect(PKG.scripts['db:dump']).toBe('bash scripts/db-dump.sh')
    expect(PKG.scripts['db:dump:check']).toBe('bash scripts/db-dump-check.sh')
    expect(PKG.scripts['db:restore:drill']).toBe('bash scripts/db-restore-drill.sh')
    // 문서가 세 명령을 그 이름으로 적는다 — 이름이 갈리면 절차가 갈린다
    for (const cmd of ['npm run db:dump', 'npm run db:dump:check', 'npm run db:restore:drill']) {
      expect(DOC, `§8.2가 ${cmd}를 적어야 한다`).toContain(cmd)
    }
  })

  it('덤프 3종의 플래그가 §8.2가 적은 것과 같다', () => {
    // §8.2: `--role-only` / `-s public` / `-s public --data-only --use-copy`
    expect(DUMP).toContain('dump roles  --role-only')
    expect(DUMP).toContain('dump schema -s public')
    expect(DUMP).toContain('dump data   -s public --data-only --use-copy')
    // 순서가 복구 순서다(roles → schema → data). 뒤바뀌면 §8.3의 복구가 깨진다.
    const order = ['dump roles', 'dump schema', 'dump data'].map((k) => DUMP.indexOf(k))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i > 0)).toBe(true)
  })

  it('보존 8주 · 임계 8일이 문서와 스크립트에서 같다', () => {
    expect(DOC).toContain('최근 8주')
    expect(DUMP).toContain('KEEP_WEEKS="${BACKUP_KEEP_WEEKS:-8}"')
    expect(CHECK).toContain('STALE_DAYS="${BACKUP_STALE_DAYS:-8}"')
  })

  it('비공허성 검사 셋이 실재한다 — 「0으로 끝났다」를 성공으로 읽지 않는다', () => {
    // §8.2.2. 빈 파일을 만들고 0으로 끝나는 것이 이 부류의 조용한 실패다.
    expect(DUMP).toContain('roles.sql이 비어 있다')
    expect(DUMP).toContain("grep -q '^CREATE TABLE'")
    expect(DUMP).toContain("grep -q '^COPY '")
  })

  it('LAST_SUCCESS · LAST_FAILURE를 쓰고 검사가 그 나이를 본다', () => {
    expect(DUMP).toContain('LAST_SUCCESS')
    expect(DUMP).toContain('LAST_FAILURE')
    expect(CHECK).toContain('MARK="$ROOT/LAST_SUCCESS"')
    // 실패 경로 셋을 사용자에게 열거한다(§8.2.2) — 원인이 갈리지 않으므로 셋을 다 보여 준다
    expect(CHECK).toContain('pooler:5432 차단')
    expect(CHECK).toContain('일시정지')
    expect(CHECK).toContain('스케줄이 아예 돌지 않았다')
  })

  it('복구 훈련이 대상의 전제 넷을 스스로 세운다 — §8.3.2', () => {
    // `-s public` 덤프가 자기충족적이지 않다는 실측의 산물. 문서에만 적으면
    // 다음 마이그레이션이 조용히 넘어간다.
    expect(DRILL).toContain('create schema if not exists auth')
    expect(DRILL).toContain('create table if not exists auth.users (id uuid primary key)')
    expect(DRILL).toContain('create or replace function auth.uid()')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(DRILL, `${role} 롤을 세워야 한다`).toContain(`rolname = '${role}'`)
    }
  })

  it('훈련이 «판별한 테이블 수»를 세고 전부 0이면 실패로 답한다 — §8.3.3', () => {
    // 「0 = 0」은 참이지만 아무것도 판별하지 않는다. 그 초록색을 만들지 않는 장치다.
    expect(DRILL).toContain('판별하지 않는다')
    expect(DRILL).toContain('아무것도 증명하지 않는다')
    expect(DRILL).toContain('sys.exit(3)')
  })

  /**
   * 주석 줄을 버린다 — **셸이 실행하지 않는 줄이다.**
   *
   * `tests/db/no-service-role.test.ts`가 쓰는 규약과 같은 자리다(그쪽은 주석을 제거하고
   * 문자열 리터럴은 보존한다). 여기서 이 처리가 **필요했던** 이유가 있다: 아래 ②의 함정을
   * **설명하는 주석 자체가 그 패턴을 담는다.** 함정을 기록하면 검사에 걸리는 상태였다.
   *
   * 여는 `#`만 보고 버리므로 코드 뒤에 붙은 꼬리 주석은 남는다 — **그것은 안전한 방향**이다.
   * 과다 검출은 빨간불로 드러나고 과소 검출은 조용하다.
   */
  const stripComments = (src: string) =>
    src
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')

  it('bash 3.2 제약 둘을 지킨다 — macOS 기본 셸이 launchd의 셸이다', () => {
    for (const [name, raw] of [
      ['db-dump.sh', DUMP],
      ['db-dump-check.sh', CHECK],
      ['db-restore-drill.sh', DRILL],
    ] as const) {
      const src = stripComments(raw)
      // ① mapfile은 4.0부터다
      expect(src, `${name}이 mapfile을 쓰면 안 된다`).not.toMatch(/^\s*mapfile\b/m)
      // ② `$var` 바로 뒤에 한글이 오면 bash 3.2가 하나의 식별자로 읽고 unbound로 죽는다
      const hits = [...src.matchAll(/\$[A-Za-z_][A-Za-z_0-9]*[가-힣]/g)].map((m) => m[0])
      expect(hits, `${name}: $var 뒤 한글은 \${var}로 감싼다`).toEqual([])
    }
  })

  it('전제 — 위 스캐너가 항진명제가 아니다', () => {
    // 합성 입력으로 스캐너 자체를 시험한다(`select.test.ts`의 파서 전제와 같은 자리).
    const bad = 'echo "줄 $rc_out개"'
    expect([...stripComments(bad).matchAll(/\$[A-Za-z_][A-Za-z_0-9]*[가-힣]/g)]).toHaveLength(1)
    const good = 'echo "줄 ${rc_out}개"'
    expect([...stripComments(good).matchAll(/\$[A-Za-z_][A-Za-z_0-9]*[가-힣]/g)]).toHaveLength(0)
    // 주석은 버려진다
    expect(stripComments('# $rc_out개\ncode')).toBe('code')
  })
})
