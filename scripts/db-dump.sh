#!/usr/bin/env bash
#
# 운영 DB 백업 — DOC-013 §8.2
#
# `supabase db dump` 3종을 저장소 **밖**에 날짜 디렉터리로 떨어뜨린다.
#
# ## 이 스크립트가 막으려는 것은 실패가 아니라 «조용한» 실패다
#
# DOC-013 §8.1.2와 §9.1이 증상이 같은 실패 경로 **둘**을 등재했다 —
#   ⓐ 캠퍼스 네트워크에서 깨어남 → `pooler:5432`가 차단돼 덤프가 안 된다
#   ⓑ Supabase Free 7일 저활동 일시정지 → `pg_dump`가 붙지 못한다
# 둘 다 증상이 **「파일이 없다」** 하나뿐이므로 원인이 갈리지 않고, 주 1회 실행이라
# 몇 주 연속 실패해도 눈에 띄지 않는다. 그리고 ⓑ에는 순환이 있다 —
# **일시정지를 막는 활동 중 하나가 이 덤프인데, 일시정지되면 이 덤프가 실패한다.**
#
# 그래서 이 스크립트는 성공/실패를 **파일로 남기고**(LAST_SUCCESS / LAST_FAILURE)
# 실패 시 알림을 띄운다. 원인은 여전히 갈리지 않지만 **「무언가 잘못됐다」는 알게 되고**
# 그것이 지금 없는 유일한 것이다. 나이 검사는 `db-dump-check.sh`가 한다.
#
# ## 성공을 종료 코드만으로 판정하지 않는다
#
# 빈 파일을 만들고 0으로 끝나는 것이 이 부류의 전형적인 조용한 실패다. 그래서
# 산출물 셋의 **내용**을 검사한다(§8.2의 「비공허성 검사」).
#
# 사용: npm run db:dump
set -uo pipefail

ROOT="${BACKUP_ROOT:-$HOME/els-manager-backups}"
KEEP_WEEKS="${BACKUP_KEEP_WEEKS:-8}"
ENV_FILE="${BACKUP_ENV_FILE:-$HOME/els-manager-backups/.env.backup}"
STAMP="$(date +%F)"
DEST="$ROOT/$STAMP"

note() { printf '  %s\n' "$*"; }

notify() {
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"els-manager 백업\"" >/dev/null 2>&1 || true
}

fail() {
  local reason="$1"
  mkdir -p "$ROOT"
  printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" >>"$ROOT/LAST_FAILURE"
  printf '\n✗ 백업 실패: %s\n' "$reason" >&2
  printf '  기록: %s\n' "$ROOT/LAST_FAILURE" >&2
  notify "실패 — $reason"
  exit 1
}

# ---------------------------------------------------------------------------
# 접속 정보 — 저장소 밖에서만 온다
#
# `.gitignore`가 `.env*`를 무시하므로 저장소 안에 두어도 커밋되지는 않는다. 그래도
# **밖에 둔다** — 안에 두면 그 한 줄에 의존하게 되고, `!.env.example`이 **정확한 이름
# 예외**라서 `.env.backup.example` 같은 파일은 조용히 무시된다(그 비대칭이 함정이다).
# 그래서 템플릿은 파일이 아니라 DOC-013 §8.2에 있다.
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  fail "접속 정보가 없다: $ENV_FILE (템플릿은 DOC-013 §8.2)"
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
[[ -n "${BACKUP_DB_URL:-}" ]] || fail "BACKUP_DB_URL이 비어 있다 ($ENV_FILE)"

command -v docker >/dev/null 2>&1 || fail "docker가 없다 — supabase db dump가 컨테이너를 요구한다"
docker info >/dev/null 2>&1 || fail "docker가 돌지 않는다"

# ---------------------------------------------------------------------------
# ★ 임시 디렉터리에 쓰고 «성공한 뒤에만» 옮긴다 *(실측이 요구한 것, 2026-07-31)*
#
# 종전에는 목적지에 바로 썼다. 그러다 캠퍼스 네트워크에서 roles 덤프가 실패했더니
# **어제 성공분(`schema.sql`·`data.sql`)과 오늘 실패분(0바이트 `roles.sql`)이 한
# 디렉터리에 섞였다.** 그 디렉터리는 **그럴듯해 보이고**, 복구 훈련이 실제로 그것을
# 「✓ 통과」로 읽었다 — 부분 실패가 남긴 잔해가 유효한 백업으로 위장한다.
#
# 임시로 쓰면 실패한 실행이 **직전 성공분을 건드리지 않는다.**
# ---------------------------------------------------------------------------
STAGE="$ROOT/.staging-$$"
rm -rf "$STAGE"
mkdir -p "$STAGE" || fail "임시 디렉터리를 만들 수 없다: $STAGE"
note "목적지 $DEST (임시 $STAGE)"

# ---------------------------------------------------------------------------
# 3종 — 순서가 복구 순서다 (roles → schema → data)
# ---------------------------------------------------------------------------
dump() {
  local name="$1"; shift
  note "덤프 $name …"
  if ! npx --no-install supabase db dump --db-url "$BACKUP_DB_URL" "$@" \
        -f "$STAGE/$name.sql" >"$STAGE/$name.log" 2>&1; then
    cp "$STAGE/$name.log" "$ROOT/last-$name.log" 2>/dev/null || true
    fail "$name 덤프가 실패했다 (로그: $ROOT/last-$name.log). 직전 성공분은 건드리지 않았다"
  fi
}

dump roles  --role-only
dump schema -s public
dump data   -s public --data-only --use-copy

# ---------------------------------------------------------------------------
# 비공허성 검사 — 「0으로 끝났다」와 「내용이 있다」는 다른 명제다
# ---------------------------------------------------------------------------
[[ -s "$STAGE/roles.sql" ]] || fail "roles.sql이 비어 있다"
grep -q '^CREATE TABLE' "$STAGE/schema.sql" || fail "schema.sql에 CREATE TABLE이 없다"
grep -q '^COPY '        "$STAGE/data.sql"   || fail "data.sql에 COPY 블록이 없다"

tables=$(grep -c '^CREATE TABLE' "$STAGE/schema.sql")
copies=$(grep -c '^COPY '        "$STAGE/data.sql")
note "검사 통과 — CREATE TABLE ${tables}건 · COPY ${copies}블록"

# ---------------------------------------------------------------------------
# 검사를 통과한 뒤에만 «옮긴다» — 이 한 줄이 부분 실패의 잔해를 막는다
# ---------------------------------------------------------------------------
rm -rf "$DEST"
mv "$STAGE" "$DEST" || fail "임시 디렉터리를 옮길 수 없다"

# ---------------------------------------------------------------------------
# 성공 기록 — db-dump-check.sh가 이 파일의 나이를 본다
# ---------------------------------------------------------------------------
printf '%s\t%s\ttables=%s\tcopies=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DEST" "$tables" "$copies" >"$ROOT/LAST_SUCCESS"

# ---------------------------------------------------------------------------
# 보존 — 최근 KEEP_WEEKS개 날짜 디렉터리만 남긴다
#
# ★ `mapfile`을 쓰지 않는다 — **macOS 기본 bash가 3.2**이고 그 내장 명령은 4.0부터다
#   (실측: `/bin/bash --version` → `3.2.57`). 이 스크립트는 launchd가 실행하므로
#   Homebrew bash가 PATH에 없는 환경을 전제해야 한다.
# ---------------------------------------------------------------------------
find "$ROOT" -maxdepth 1 -type d -name '20*-*-*' | sort -r | tail -n "+$((KEEP_WEEKS + 1))" | while IFS= read -r d; do
  [[ -n "$d" ]] || continue
  rm -rf "$d" && note "삭제 $d"
done

printf '\n✓ 백업 완료 — %s\n' "$DEST"
