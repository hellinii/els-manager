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

  /**
   * 복원이 트리거·FK를 끈 채 돈다는 전제 — DOC-010 AQ-80 · DOC-013 §8.3.4
   *
   * `data.sql`의 첫 줄 `SET session_replication_role = replica;`가 5단계의 의미를 정한다
   * (트리거·FK 꺼짐, CHECK 적용). 그 줄이 사라지면 복원이 트리거를 **켠 채** 돌고 행 수
   * 대조는 여전히 초록일 수 있다 — 그래서 드릴이 첫 줄을 단언하고, 이 테스트는 **그 단언이
   * 코드로 있는가**를 본다. 실제 덤프는 저장소 밖(`~/els-manager-backups`)이므로 여기서
   * 읽지 않는다(ADR-003 · AQ-46과 같은 이유 — 러너에 없다).
   *
   * **`stripComments`를 거친다** — 그 줄을 설명하는 주석이 같은 리터럴을 담으므로,
   * 원문에서 찾으면 검사를 지워도 주석만으로 초록이 된다.
   */
  it('훈련이 data.sql의 첫 줄을 replica로 단언하고 다르면 복구 전에 멈춘다 — AQ-80', () => {
    const src = stripComments(DRILL)
    // ① 비교 대상이 정확한 리터럴이다
    expect(src).toContain(`REPLICA_LINE='SET session_replication_role = replica;'`)
    // ② 첫 «비어 있지 않은» 줄을 data.sql에서 읽는다
    expect(src).toContain(`FIRST_LINE=$(grep -m1 -v '^[[:space:]]*$' "$DUMP_DIR/data.sql")`)
    // ③ 다르면 크게 실패한다 — 비교 블록 안에 stderr 출력과 0이 아닌 exit가 있다
    const block = src.match(/^if \[\[ "\$FIRST_LINE" != "\$REPLICA_LINE" \]\]; then\n([\s\S]*?)\nfi$/m)
    expect(block, '첫 줄 비교 블록이 있어야 한다').not.toBeNull()
    const body = block?.[1] ?? ''
    expect(body, '다르면 0이 아닌 코드로 끝나야 한다').toMatch(/^\s*exit [1-9]\d*\s*$/m)
    expect(body).toContain('>&2')
    expect(body).toContain('AQ-80')
    // ④ 복구보다 앞이다 — 1단계(DB 생성)보다도 앞이어야 실패가 아무것도 남기지 않는다
    const check = src.indexOf('if [[ "$FIRST_LINE" != "$REPLICA_LINE" ]]')
    const createDb = src.indexOf('create database $DRILL_DB')
    const restore = src.indexOf('< "$DUMP_DIR/data.sql"')
    expect(check).toBeGreaterThan(0)
    expect(createDb, '1단계가 있어야 한다').toBeGreaterThan(0)
    expect(restore, '5단계가 있어야 한다').toBeGreaterThan(0)
    expect(check, '검사가 1단계(DB 생성)보다 앞이어야 한다').toBeLessThan(createDb)
    expect(check, '검사가 5단계(data 복구)보다 앞이어야 한다').toBeLessThan(restore)
  })

  /**
   * 복원된 행이 규칙을 만족하는가 — DOC-010 AQ-80 · DOC-013 §8.3.5 (P8.5 드릴 B)
   *
   * 5단계(replica)의 「일치」는 「행이 그대로 들어갔다」일 뿐이다. 실측(2026-10-04): 상환 시
   * 지급 상품에 월수익 기록 한 행을 끼운 덤프가 6단계를 「✓ 통과」했다. 7단계가 같은 덤프를
   * 트리거 · FK를 켠 채 새 DB에 다시 적재해 그 행을 23514로 막았다.
   *
   * 이 테스트는 그 단계가 **코드로 있는가**를 본다 — 실제 덤프는 저장소 밖이다(위와 같은 이유).
   * 넷이 빠지면 단계가 «있는데 아무것도 판별하지 않는» 형태가 된다: ① origin으로 바꾸지 않음
   * ② 뒤쪽 replica 전환을 세지 않음(그 아래가 트리거 없이 적재된다) ③ 적재 세션이 origin이었는지
   * 묻지 않음 ④ 거부를 0이 아닌 종료로 말하지 않음.
   */
  it('훈련이 트리거 · FK를 켠 채 다시 적재해 복원된 행의 규칙을 재검사한다 — AQ-80', () => {
    const src = stripComments(DRILL)
    // ① 첫 줄을 origin으로 바꿔 적재한다 — 바꾸는 대상이 0단계가 단언한 그 리터럴이다
    expect(src).toContain(`ORIGIN_LINE='SET session_replication_role = origin;'`)
    expect(src).toContain('s/^SET session_replication_role = replica;\\$/${ORIGIN_LINE}/')
    // ② session_replication_role 줄이 정확히 하나인지 센다
    expect(src).toContain(`SRR_LINES=$(grep -c 'session_replication_role' "$DUMP_DIR/data.sql")`)
    expect(src).toMatch(/if \[\[ "\$SRR_LINES" -ne 1 \]\]; then\n[^\n]*>&2\n\s*exit [1-9]/)
    // ③ 같은 스트림 끝에서 세션이 origin이었는지 묻고, 아니면 실패한다
    expect(src).toContain(`select 'SRR=' || current_setting('session_replication_role');`)
    expect(src).toContain('if [[ "$ORIGIN_OUT" != *"SRR=origin"* ]]; then')
    // ④ 거부는 ON_ERROR_STOP으로 멈추고 0이 아닌 코드(4)로 끝난다
    const reload = src.indexOf('ORIGIN_OUT=$(')
    expect(reload, '7단계 적재가 있어야 한다').toBeGreaterThan(0)
    expect(src.slice(reload, reload + 600)).toContain('-v ON_ERROR_STOP=1')
    expect(src).toMatch(/규칙 재검사 실패[\s\S]{0,400}?\n\s*exit 4\n/)
    // ⑤ auth.users는 5단계 DB의 public.users에서 온다 — 대상(GoTrue)이 제공하는 것의 대역
    expect(src).toContain(`select format('insert into auth.users (id) values (%L);', id) from public.users`)
    // ⑥ 6단계(행 수 대조) 뒤에 돈다 — 대조가 실패하거나 공허하면 이 단계는 의미가 없다
    const count = src.indexOf('▶ 6단계')
    const step7 = src.indexOf('▶ 7단계')
    expect(count).toBeGreaterThan(0)
    expect(step7, '7단계가 6단계 뒤여야 한다').toBeGreaterThan(count)
    expect(src).toContain('if [[ $rc -eq 0 ]]; then')
  })
})
