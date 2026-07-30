#!/usr/bin/env bash
#
# 백업 최신성 검사 — DOC-013 §8.1.2 · §9.1
#
# ## 이 검사가 왜 별도 명령인가
#
# 덤프가 실패하면 `db-dump.sh`가 알림을 띄우지만 **그 실패조차 일어나지 않는 경우**가
# 있다 — launchd가 아예 깨지 않았거나, 기계가 꺼져 있었거나, 로그인 세션이 없었을 때다.
# 그때 증상은 「LAST_FAILURE도 없고 LAST_SUCCESS만 낡아 있다」이며 **어떤 오류도 나지
# 않는다.** 그래서 「최근 성공이 얼마나 오래됐는가」를 묻는 자리가 따로 있어야 한다.
#
# ## 하나의 계기가 실패 경로 셋을 덮는다
#
# | 실패 경로 | 증상 | 이 검사가 잡는가 |
# |---|---|---|
# | 캠퍼스 네트워크에서 깨어남 (§8.1.2) | 파일 없음 | **그렇다** |
# | Supabase Free 일시정지 (§9.1) | 파일 없음 | **그렇다** |
# | launchd가 아예 안 돎 | 아무 흔적 없음 | **그렇다** |
#
# **원인은 갈리지 않는다.** 그것이 이 검사의 한계이며 §9.1이 그렇게 적었다 —
# 종결 수단은 원인별 판별이 아니라 **「무언가 잘못됐다」를 아는 것**이다.
#
# 사용: npm run db:dump:check   (초록 = 최근 STALE_DAYS일 안에 성공했다)
set -uo pipefail

ROOT="${BACKUP_ROOT:-$HOME/els-manager-backups}"
STALE_DAYS="${BACKUP_STALE_DAYS:-8}"
MARK="$ROOT/LAST_SUCCESS"

if [[ ! -f "$MARK" ]]; then
  printf '✗ 성공 기록이 없다: %s\n' "$MARK" >&2
  printf '  백업이 한 번도 성공하지 않았거나 디렉터리가 사라졌다.\n' >&2
  exit 1
fi

now=$(date +%s)
mtime=$(stat -f %m "$MARK" 2>/dev/null || stat -c %Y "$MARK")
age_days=$(( (now - mtime) / 86400 ))

printf '  최근 성공  %s\n' "$(cat "$MARK")"
printf '  경과       %s일 (임계 %s일)\n' "$age_days" "$STALE_DAYS"

if [[ -f "$ROOT/LAST_FAILURE" ]]; then
  printf '  ⚠ 실패 기록이 있다 — 마지막 줄:\n    %s\n' "$(tail -1 "$ROOT/LAST_FAILURE")"
fi

if (( age_days > STALE_DAYS )); then
  printf '\n✗ 백업이 낡았다 — %s일 경과\n' "$age_days" >&2
  printf '  원인은 이 검사가 갈라 주지 않는다(§9.1). 셋 중 하나다 —\n' >&2
  printf '    ① 캠퍼스 네트워크에서 실행됐다 (pooler:5432 차단, §8.1.2)\n' >&2
  printf '    ② Supabase 프로젝트가 일시정지됐다 (7일 저활동, §9.1)\n' >&2
  printf '    ③ 스케줄이 아예 돌지 않았다 (기계 꺼짐 · 로그인 세션 부재)\n' >&2
  exit 1
fi

printf '\n✓ 백업이 최신이다\n'
