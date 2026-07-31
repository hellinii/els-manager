#!/usr/bin/env bash
#
# 복구 훈련 — DOC-013 §8.3
#
# **복구해 보지 않은 백업은 백업이 아니다.** 이 스크립트가 컷 6의 종결 조건이다.
#
# ## 대조군을 원본이 아니라 «덤프 자신»으로 둔다
#
# §8.3의 초안은 「테이블별 행 수를 **원본과** 대조한다」였다. 그런데 **실제 재해에서
# 원본은 없다** — 원본이 있으면 복구할 이유가 없다. 원본에 물어보는 절차는 「원본이
# 살아 있을 때만 검증되는 복구 절차」가 되고, 그것은 검증하려던 것과 다른 명제다.
#
# 그래서 기대값을 **`data.sql`의 COPY 블록에서 뽑는다.** 덤프 파일 하나만 있으면
# 대조가 성립하므로 훈련이 재해 조건을 실제로 닮는다. (원본이 살아 있으면 `--source`로
# 3자 대조까지 한다 — 그때는 「덤프가 원본을 빠뜨렸는가」도 함께 갈린다.)
#
# ## 로컬 스택을 비우지 않는다 — 별도 데이터베이스에 되살린다
#
# 같은 클러스터에 새 DB를 만들어 복구하면 ⓐ 로컬 개발 스택을 재시드할 필요가 없고
# ⓑ 스키마가 **덤프에서만** 오는 것이 보장된다(마이그레이션이 끼어들 여지가 없다).
# 대신 **roles는 클러스터 단위**라 이 방식으로 검증되지 않는다 — 그 사실을 보고에 적는다.
#
# 사용: npm run db:restore:drill -- <덤프디렉터리> [--source <psql-url>]
set -uo pipefail

DUMP_DIR="${1:-}"
[[ -n "$DUMP_DIR" ]] || { echo "사용: db-restore-drill.sh <덤프디렉터리> [--source <url>]" >&2; exit 2; }
shift || true
SOURCE_URL=""
[[ "${1:-}" == "--source" ]] && { SOURCE_URL="${2:-}"; }

CONTAINER="${LOCAL_DB_CONTAINER:-supabase_db_els-manager}"
DRILL_DB="${DRILL_DB:-restore_drill}"

# ---------------------------------------------------------------------------
# ★ 덤프의 «완전성»과 «동시성»을 먼저 본다 *(실측이 요구한 것, 2026-07-31)*
#
# 캠퍼스 네트워크에서 roles 덤프만 실패했더니 어제 성공분과 오늘 0바이트 파일이 한
# 디렉터리에 섞였고, **이 스크립트가 그것을 「✓ 통과」로 읽었다.** 셋이 «같은 실행»에서
# 나왔는지 보지 않으면 훈련이 잔해를 검증하고 초록을 낸다 — 검증하려던 것과 다른 명제다.
# (덤프 쪽도 임시 디렉터리 → 이동으로 고쳤다. 여기는 «두 번째» 방어다 — 손으로 만든
#  디렉터리나 옛 백업을 넘기는 경로가 여전히 있기 때문이다.)
# ---------------------------------------------------------------------------
for f in roles schema data; do
  [[ -s "$DUMP_DIR/$f.sql" ]] || {
    echo "✗ $DUMP_DIR/$f.sql 이 없거나 «비어 있다» — 부분 실패의 잔해일 수 있다" >&2
    echo "  셋이 한 실행에서 나와야 한다. 다시 덤프한다: npm run db:dump" >&2
    exit 1; }
done
SPREAD=$(python3 -c "
import os, sys
d = sys.argv[1]
ts = [os.path.getmtime(os.path.join(d, f + '.sql')) for f in ('roles', 'schema', 'data')]
print(int(max(ts) - min(ts)))
" "$DUMP_DIR")
if [[ "$SPREAD" -gt 600 ]]; then
  echo "✗ 세 파일의 시각이 ${SPREAD}초 벌어져 있다 — «같은 실행»의 산출물이 아니다" >&2
  echo "  부분 실패가 직전 성공분과 섞인 상태다. 다시 덤프한다: npm run db:dump" >&2
  exit 1
fi
echo "▶ 0단계 — 덤프 셋이 한 실행의 것이다 (시각 차 ${SPREAD}초)"

psql_drill() { docker exec -i "$CONTAINER" psql -U postgres -d "$DRILL_DB" "$@"; }

echo "▶ 1단계 — 빈 데이터베이스를 만든다 ($DRILL_DB)"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q \
  -c "drop database if exists $DRILL_DB" -c "create database $DRILL_DB" \
  || { echo "✗ 데이터베이스를 만들 수 없다" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 복구 «대상»의 전제 — 이 블록이 곧 명세다
#
# ★ 실측(첫 시도): 빈 데이터베이스에 `schema.sql`을 부으면
#   `ERROR: schema "auth" does not exist`로 죽는다. `-s public` 덤프가 자기충족적이지
#   않기 때문이다 — `schema.sql`이 `public` 밖을 **정확히 셋** 참조한다:
#     · `auth.users`  1회 — `public.users.id`의 FK
#     · `auth.uid()`  2회 — RLS 정책
#   (`data.sql`은 0건이다.)
#
# 즉 **복구 대상은 「빈 DB」가 아니라 「auth와 롤이 이미 있는 새 Supabase 프로젝트」**다.
# 실제 재해 절차가 「새 프로젝트를 만들고 거기에 되살린다」이므로 그것이 옳은 모델이다.
#
# 아래는 그 대상이 반드시 제공해야 하는 **최소 집합**이며, 새 의존이 생기는 날
# 이 훈련이 실패해서 알려 준다. 그것이 이 블록을 스크립트에 두는 이유다 —
# 문서에만 적으면 다음 마이그레이션이 조용히 넘어간다.
# ---------------------------------------------------------------------------
echo "▶ 2단계 — 복구 대상의 전제를 세운다 (새 Supabase 프로젝트가 제공하는 것)"
psql_drill -q <<'SQL' >/dev/null 2>&1
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
do $$ begin
  perform 1 from pg_roles where rolname = 'anon';
  if not found then create role anon nologin noinherit; end if;
  perform 1 from pg_roles where rolname = 'authenticated';
  if not found then create role authenticated nologin noinherit; end if;
  perform 1 from pg_roles where rolname = 'service_role';
  if not found then create role service_role nologin noinherit bypassrls; end if;
end $$;
SQL
echo "  auth 스키마 · auth.users(id) · auth.uid() · 롤 셋"

echo "▶ 3단계 — roles.sql (클러스터 단위이므로 이 훈련으로 검증되지 않는다. 동작만 관측한다)"
if [[ -s "$DUMP_DIR/roles.sql" ]]; then
  rc_out=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
             < "$DUMP_DIR/roles.sql" 2>&1 | grep -c 'ERROR' || true)
  # ★ `${...}` 중괄호가 필수다 — **bash 3.2(macOS 기본)는 `$rc_out개`를 하나의 식별자로
  #   읽고 `unbound variable`로 죽는다**(실측). 이 저장소는 전부 한글이라 상시 함정이다.
  echo "  ERROR 줄 ${rc_out}개 — 기존 클러스터에 이미 롤이 있으면 42710이 정상이다"
fi

echo "▶ 4단계 — schema 복구"
psql_drill -q -v ON_ERROR_STOP=1 < "$DUMP_DIR/schema.sql" >/dev/null 2>"$DUMP_DIR/.restore-schema.err" \
  || { echo "✗ schema 복구 실패:"; tail -5 "$DUMP_DIR/.restore-schema.err"; exit 1; }
echo "  통과"

echo "▶ 5단계 — data 복구"
psql_drill -q -v ON_ERROR_STOP=1 < "$DUMP_DIR/data.sql" >/dev/null 2>"$DUMP_DIR/.restore-data.err" \
  || { echo "✗ data 복구 실패:"; tail -5 "$DUMP_DIR/.restore-data.err"; exit 1; }
echo "  통과"

echo "▶ 6단계 — 테이블별 행 수 대조"

# 기대값: data.sql 의 COPY 블록에서 뽑는다
python3 - "$DUMP_DIR/data.sql" >"$DUMP_DIR/.expected" <<'PY'
import re, sys
expected, table, n = {}, None, 0
for line in open(sys.argv[1], encoding='utf-8'):
    if table is None:
        # ★ 실측 형식: `COPY "public"."assets" ("id", ...) FROM stdin;`
        # 스키마·테이블·열이 **전부 따옴표**로 감싸여 온다. 따옴표를 선택으로 둔
        # 초안 정규식은 0건을 찾았고, 그러면 대조가 「덤프에 COPY가 없다」로 12건
        # 빨간불이 된다 — **파서가 못 찾은 것과 덤프가 빈 것이 같게 보인다.**
        m = re.match(r'^COPY\s+"?(?:public)"?\.\s*"?(\w+)"?\s*\(.*FROM stdin;', line)
        if m: table, n = m.group(1), 0
    elif line.rstrip('\n') == r'\.':
        expected[table] = n; table = None
    else:
        n += 1
for t in sorted(expected):
    print(f"{t}\t{expected[t]}")
PY

# 실제값: 복구된 DB
docker exec -i "$CONTAINER" psql -U postgres -d "$DRILL_DB" -tAF$'\t' -c "
  select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by relname
" >"$DUMP_DIR/.actual" 2>/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d "$DRILL_DB" -q -c "analyze" >/dev/null 2>&1
docker exec -i "$CONTAINER" psql -U postgres -d "$DRILL_DB" -tAF$'\t' -c "
  select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by relname
" >"$DUMP_DIR/.actual" 2>/dev/null

python3 - "$DUMP_DIR/.expected" "$DUMP_DIR/.actual" <<'PY'
import sys
def load(p):
    d = {}
    for line in open(p, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line: continue
        t, n = line.split('\t'); d[t] = int(n)
    return d
exp, act = load(sys.argv[1]), load(sys.argv[2])
names = sorted(set(exp) | set(act))
bad = vacuous = 0
print(f"  {'테이블':<26}{'덤프':>7}{'복구':>7}   판정")
for t in names:
    e, a = exp.get(t), act.get(t)
    if e is None:   verdict, bad = "*** 덤프에 COPY 블록이 없다", bad + 1
    elif a is None: verdict, bad = "*** 복구 후 테이블이 없다", bad + 1
    elif e != a:    verdict, bad = "*** 불일치", bad + 1
    elif e == 0:    verdict, vacuous = "일치 (0=0 — 판별하지 않는다)", vacuous + 1
    else:           verdict = "일치"
    print(f"  {t:<26}{'-' if e is None else e:>7}{'-' if a is None else a:>7}   {verdict}")
tot = len(names)
print(f"\n  테이블 {tot}개 · 불일치 {bad}개 · **판별한 테이블 {tot - vacuous - bad}개** (0=0 {vacuous}개)")
if bad: print("\n✗ 복구 대조 실패"); sys.exit(1)
if tot - vacuous == 0:
    print("\n⚠ 모든 테이블이 0행이다 — 이 훈련은 «아무것도 증명하지 않는다».")
    print("  행이 있는 원본으로 다시 돌려야 §8.3의 종결 조건을 만족한다.")
    sys.exit(3)
print("\n✓ 복구 대조 통과")
PY
rc=$?

if [[ -n "$SOURCE_URL" ]]; then
  echo "▶ 7단계 — 원본 3자 대조 (덤프가 원본을 빠뜨렸는지도 갈린다)"
  docker exec -i "$CONTAINER" psql "$SOURCE_URL" -tAF$'\t' -c "
    select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by relname
  " 2>/dev/null | sed 's/^/  원본 /'
fi

rm -f "$DUMP_DIR/.expected" "$DUMP_DIR/.actual"
exit $rc
