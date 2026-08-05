-- ============================================================================
-- asset_provider_symbols 를 사용자가 쓸 수 있게 한다 — P5a 컷 2a
-- DOC-002 §4.4 · DOC-010 §7 · DOC-011 §5.12 · ADR-008
--
-- 20260726171035:356 이 `grant select` 하나만 부여했고 사유는
-- "변경은 마이그레이션과 수집 배치(service_role) 전용이다 — 도메인 코드는 공급자
--  심볼을 알지 못하고(ADR-004), 사용자가 매핑을 편집할 화면도 없다" 였다.
--
-- ★ 그 사유의 둘이 다 무효가 됐다.
--   ① `service_role` 은 0 DML 이고(20260729155440) AQ-57 이 ⓐ(전용 서비스 계정)로
--      닫혔으므로 배치는 `authenticated` 로 돈다 — 즉 "배치 전용" 이라는 경로가 없다
--   ② P5a 가 매핑 «화면» 을 만든다 (SCR-302 확장, DOC-011 §5.12)
--
-- ★★ 이 테이블이 비어 있는 동안 자동 수집 대상은 «구조적으로» 0이다. 즉 이 부여가
--    없으면 P5a 의 나머지가 전부 서더라도 `targetCount` 가 0이고, 그 상태는
--    "동작하는데 화면에 아무것도 없다" 로 읽힌다 (ADR-007 §결과의 각주가 경계한 형태).
--
-- ---------------------------------------------------------------------------
-- ★ DELETE 를 «부여한다» — `assets`·`asset_prices` 와 비대칭이며 그 사유를 적는다.
--
--   20260726171035:327-331 은 공용 데이터의 삭제를 두 겹으로 막았다
--   ("한 사용자가 시세를 지우면 그 자산을 쓰는 타인 상품의 조건 판정이 함께 깨진다").
--   그 논거가 여기에는 적용되지 않는다 — 매핑은 «관측이 아니다».
--
--     구분          | asset_prices (관측)        | asset_provider_symbols (매핑)
--     -------------|---------------------------|------------------------------
--     지우면 잃는 것 | 과세 근거. 재현 불가        | 없다. 다시 만들면 된다
--     지운 뒤 상태   | E-01 시세 없음 → 판정 null | 미매핑 = 설계된 정상 상태(ADR-007)
--     되돌리는 수단  | 없다                       | 화면에서 다시 넣는다
--
--   그리고 DELETE 가 «필요하다» — "이 자산은 자동 수집하지 않는다" 로 되돌릴 유일한
--   수단이다. UPDATE 로 대신할 수 없다: `UNIQUE(asset_id, provider)` 아래에서 공급자를
--   바꾸는 것은 되지만 «매핑을 없애는» 것은 안 된다.
--
--   대가를 적어 둔다: 시세는 공용 데이터이므로 한 사용자가 매핑을 지우면 다른 사용자의
--   자산도 자동 수집이 멈춘다. 그러나 그것은 `asset_prices` 삭제와 달리 «드러난다» —
--   `unmapped` 가 세고(DOC-011 §7.1) SCR-302 가 표시한다. 즉 "조용한 피해" 가 아니라
--   "보이고 되돌릴 수 있는 변경" 이다.
--
-- ---------------------------------------------------------------------------
-- 정책은 `using (true)` 다 — 공용 데이터의 기존 규약(D-02 의 의도된 예외)을 그대로
-- 따르며 `assets`·`asset_prices` 와 같은 형태이므로 새 판단이 아니다.
--
-- RLS 는 이미 켜져 있다 (20260726171035:27) — 여기서 다시 켜지 않는다.
-- ============================================================================

grant insert, update, delete on public.asset_provider_symbols to authenticated;

create policy asset_provider_symbols_insert_all on public.asset_provider_symbols
  for insert to authenticated with check (true);

create policy asset_provider_symbols_update_all on public.asset_provider_symbols
  for update to authenticated using (true) with check (true);

create policy asset_provider_symbols_delete_all on public.asset_provider_symbols
  for delete to authenticated using (true);
