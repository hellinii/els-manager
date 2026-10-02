# API · 계약 명세

**언제들어오나** — ELS 통합관리 시스템

| 항목 | 내용 |
|---|---|
| 문서 ID | DOC-011 |
| 버전 | 4.16 |
| 작성일 | 2026-07-26 |
| 작성자 | 민서 |
| 선행 문서 | DOC-002 데이터 모델 v0.6, DOC-007 계산 로직 명세 v0.5, DOC-008 화면 목록 v0.3, DOC-010 아키텍처 v1.0 |
| 상태 | 검토 중 |

### 변경 이력

| 버전 | 일자 | 작성자 | 변경 내용 |
|---|---|---|---|
| 4.16 | 2026-10-02 | 민서 | **P8 컷 b1 — 월지급식 ELS(DOC-001 S-14)의 계약을 코드보다 먼저 쓴다. 본 버전은 선행 명세다 — `src/` 0줄, 마이그레이션 0, 테스트 0줄, 파서에 결속된 표(§6 규칙 표 · §3.2.1 제약 이름 표 · §8 매트릭스)의 행 0줄.** 달러 절반(v4.9)의 짝이다. 용어는 DOC-005 v1.11(쿠폰 지급방식 · 월지급식 · 상환 시 지급 · 월수익 · 월수익 연쿠폰율 · 월수익 일정 · 월수익 평가일 · 월수익 지급일 · 월수익 순번 · 월수익 배리어 · 월수익 지급 기록 · 월수익 미기록 · 받은 월수익 · 조기상환 가정 밖 · 월수익 흐름 끝). **(1) 공통 타입 다섯 — §4.0.** `CouponPayout` · `CouponOutcome` · `CouponState`(여섯 — 지급 · 미지급 · 미기록 · 예정 · 예정 · 조기상환 가정 밖 · 상환 후 없음) · `CouponConditionResult`(표시 전용) · `ContributionBasis`. 월수익 흐름 끝(상환일 / 적용 차수 평가일 / 무한 — 비교 키는 월수익 평가일, 경계 포함)과 구획표. 사건 규칙 넷 — 소득 사건 = 상환 0..1 + 월수익 0..K(I-01 · I-08 · D-01 불변 — 월지급식의 상환은 원금만) · 원금은 상환 사건에만 · 추정 월수익은 시세를 쓰지 않는다(`PRICE_WIDE`에 세금 없음 유지) · **빼는 단위는 사건, 세는 단위는 상품**(`unconvertedCount` · `convertedCount` · `excludedForeignCount` — DOC-008 ST-07 「달러 상품 n건」과 짝. 종전 「건 수」 문언 넷을 취소선으로). 월수익 두 테이블은 ~~`PRODUCT_SELECT` 임베드~~ 상품 루트 로더의 임베드(아래 개정 ⓒ) — 왕복 불변(페이로드는 DOC-010 AQ-77). 라벨 축은 코드 커밋(넷은 b3, `contributionBasis`는 b4). **(2) 뷰.** §4.1 `byCurrency[].receivedCoupons`(받은 월수익 — 보유중 상품의 PAID 합, 실현손익에 넣지 않는다 — 민서 결정(2026-10-02) ②) · `realizedPnl`은 상환된 상품만 · 월수익 포함(검산 B-2 −22,000,000) — 항등식은 통화별 그대로 · `upcomingEvaluations`는 조기상환 차수만(DOC-008 SQ-18) · 조치 사유 `COUPON_UNRECORDED`(상품 단위 · 상환된 상품에서도 — 순서 결함 → 월수익 미기록 → E-05 → KI → 시세 → 평가일 경과) · `COUPON_SCHEDULE_MISSING`. §4.2 `couponPayout` · `terms.monthlyCoupon` · `couponProgress`, null 원인표 1순위는 「판정 입력을 파괴한 결함」, D1에 셋째 결함(파괴 입력 `'COUPONS'` — 월수익 사건과 그 표시만 억제, 우선순위는 기존 결함 다음). §4.3 `coupons: CouponObservationView[] 또는 null`(조건 판정은 다음 한 행만 — RD-14 부분 해소) · 형제 필드 `remainingCoupons`(`projection` 밖 — NO_ROUND · 상환 완료에서도 F에 남는다) · 상환된 월지급 상품의 `realizedPnl`에 월수익. §4.4 조기상환 차수만 · `integrityIssue` 유니온에 `COUPON_SCHEDULE_MISSING`(그 상품은 차수가 있어 행을 갖는다). §4.6 `contributingProducts[]` 상품당 한 행 · `basis` · `breakdown` · `isEstimated` 유지(= `basis !== 'CONFIRMED'`) · `taxableIncome = null`은 사건이 전부 빠졌을 때만 · `exchangeRateMissing`은 하나라도 빠지면 참(a2의 동치가 깨진다) · `income.confirmedElsTaxableIncome` · `estimatedElsTaxableIncome`. §4.7 사건마다 항목 · 기준 연도 이전 사건 · 가정 문장(표 밖 표식) · 검산 B-7. §4.8 변경 없음(같은 `contributionOf` — 본인 F 항등의 통합 테스트는 b4). **(3) §4.12 `listMonthlyCouponSchedule` 신설 — 구현 b3, 조회 10 → 11.** 인자는 `listSchedule`과 같고 자기 루트 쿼리이며 `ScheduleItem` 합집합을 쓰지 않는다(`groupByProduct`의 `roundNo` 정렬). **(4) 입력.** §5.1 · §5.2 `couponPayout`(필수 · 기본값 없음 — V-25) · `monthlyCouponAnnualRate?` · `couponSchedules?`, 꼬리 검사 셋, 확장 웨이브(W4)의 `coalesce` → 축소(M-b2c, b4) 뒤 `23502` → `fields.couponPayout` 영구 단언. **계약은 b2부터 `MONTHLY`를 받고 폼은 b4까지 고를 수 없다**(SB-13 — P8 계획 결정). §5.2 **월수익 일정은 전체 교체가 아니다** — ~~기록 없는 달만 삭제~~ 입력에 없는 순번 삭제(아래 반박 검토 반영) + `coupon_no` upsert, 기록이 있으면 통화 · 지급방식 · 기록된 달 동결 → `CONFLICT`(민서 결정(2026-10-02) ④ — 동결 트리거는 값이 바뀔 때만 거부해야 upsert가 지난다). §5.3 기록 `RESTRICT` · 「개별 삭제 계약 없음」을 I-07 대상으로 좁혔다. §5.4 · §5.5 월지급 상품의 상환(V-29 — 같은 날 월수익은 §5.14, U6(P8 계획 결정) · 검산 B-3) · 삭제 동선 최대 3단계. §5.11 `couponPayout` 필수 · 기실현 월지급은 두 율 `NULL` · 이력은 §5.14의 순번 없는 PAID. **(5) §5.14 `recordCouponPayments` · §5.15 `updateCouponPayment` · `deleteCouponPayments` 신설 — 구현 b2, 변경 14 → 17.** 1..60건 · 다행 INSERT 한 번(전부 아니면 전무) · 원천징수 기본값 `withholdingFor(…, 'paymentDate')`(`WithholdingDateField`에 `'paymentDate'`) · 연도별 세율 한 번씩 · 오류 경로 `entries[i].<필드>`(색인 금지는 DB 사상의 규칙) · 세율 시드 없는 해의 빈 원천징수 → `entries[i].withholdingTax`(RD-16). 무효화 `COUPON_RECORD_WIDE`(세금이 있다) · `PRODUCT_WIDE` · `PRICE_WIDE`에 `listMonthlyCouponSchedule`(세금은 여전히 없다 — SB-17). **(6) §6 규칙 일곱의 문언**(산문) — V-08′ · V-20′(`couponNo` — `smallint` · 1 이상) · V-25~V-29 + 대상 확장 셋(V-23 · V-24ⓐ · V-11). **(7) §3.2.1 사상의 문언** — 「P8 월지급」 블록(I-23 CHECK · 꼬리 검사 셋 · `*_recorded_immutable` 둘 → `CONFLICT` · 기록의 형태 · 자릿수 · 부모 트리거 셋 · `redemptions` 트리거 둘 — AQ-87 ⓑ) · SQLSTATE 표 `23514` 행에 둘째 상태 충돌 접미사 · `NOT_NULL_FIELD`의 새 키 `couponPayout`(b4). §3.2.2 표에 §5.14 · §5.15. **(8) §8** 판정 기준 ①에 「추정 월수익도 시세를 쓰지 않는다」 · 「P8 월지급이 이 매트릭스에 더할 것」(SCR-206 행 · SCR-202 · SCR-301). **(9) §9** X-07 뒷절반 = **컷 b4**(폼이 월지급식을 고르게 되는 컷 — 저장은 b2부터 `els_products_coupon_recorded_immutable`이 막는다) · 계약면 표의 b1 자리 · **b1 결정이 답하지 않은 열여섯을 「P8 월지급 — b2 전에 정한다」 ①~⑯로 등재**(`fields` 키 · 「n개월 미기록」의 n · SCR-201의 배리어 · `getProduct`의 월수익 연쿠폰율 · 기실현 월지급의 표시 · `remainingCoupons`의 환율 기준 · §4.7 가정 표식 · §4.12 반환 행 · 상환일 쪽 사전 검사 · §5.14 반환 · 부분 삭제 · 기실현 기록 상한 · 월수익 연쿠폰율 상한 · §8 넣는 순서와 `createProduct` · b3/b4 경계 · DOC-007 RD-18의 계약 쪽). **★ 코드가 한 컷 앞섰다(P8 컷 b0, `d675efb`).** 소득 사건 모델이 이 문서보다 먼저 코드에 섰다 — `src/lib/db/queries/income.ts` `incomeEventsOf(row, asOf, rates, only?)` · `contributionOf`가 사건을 접는다(사건 ≤1을 별칭 없는 튜플로 단언) · `forecastItemOf` → `forecastItemsOf`(사건마다 항목 하나, 원금을 돌려주는 사건이 없으면 원금 항목 하나) · `excludedForeignCountOf`(상품 단위) · `withholdingFor(ctx, {date, taxableIncome, withholdingTax?}, dateField)` + `withholdingInputOf`(`WithholdingDateField = 'redemptionDate'`). **동작 불변**(HEAD 대 작업 트리 차분 0). §4.6 · §4.7 · §5.4에 그 사실을 적었고 §4.7의 낡은 `forecastItemOf` 참조를 `forecastItemsOf`로 고쳤다. **부수 정정(낡은 문장)**: §5.1 각주의 「정책 37개」(v4.12에 Q-01만 40으로 고쳤다 — b2 뒤 48) · §6 각주의 「20개 안에서의 오태그」 · §5.0.1 ②(「§5.5의 두 계약만 3이다」는 b2에서 낡는다고 예고). **선행 명세 → 구현 컷**: `CouponPayout` · `CouponOutcome` · 입력의 `couponPayout` · `monthlyCouponAnnualRate` · `couponSchedules` · §5.2 upsert · 동결 · §5.14 · §5.15 · `COUPON_RECORD_WIDE` · V-08′ · V-20′ · V-25~V-28 표 행 · §3.2.1 b2 사상 · `redemptions` 트리거 둘 · §8 변경 이름 셋 → **b2** · `CouponState` · `CouponConditionResult` · §4.1 `receivedCoupons` · `COUPON_UNRECORDED` · `realizedPnl`의 월수익 몫 · §4.2 · §4.3 `coupons` · `COUPON_SCHEDULE_MISSING` · §4.12 · `PRODUCT_WIDE` · `PRICE_WIDE`의 `listMonthlyCouponSchedule` · 라벨 축 넷 · §8 SCR-206 · SCR-301 행 · 왕복 표 행 → **b3** · `ContributionBasis` · 과세에 닿는 것 전부(§4.1 `currentYearTax` · §4.3 `remainingCoupons` · §4.6 분할 · §4.7 · §4.8) · V-29 표 행 · M-b2c(`coalesce` 제거 · `NOT_NULL_FIELD.couponPayout`) · 월지급식 선택 개방 · X-07 뒷절반 · `contributionBasis` 라벨 축 → **b4**. **개정 반영(같은 판 — b1 개정, 2026-10-02).** 위 (1)~(9) 중 아래가 바뀌었다. ⓐ **상환 뒤 지급 금지의 비교 키 = 그 달의 월수익 평가일**(DOC-007 RD-18 해결): V-27 「상환이 있으면 그 달의 월수익 평가일 ≤ 상환일」 · `monthly_coupon_payments_after_redemption`(그 달 일정의 `evaluation_date > redemption_date`면 거부) · `redemptions_before_coupon_payment`(~~`PAID`로~~ 기록된 달(지급 · 미지급 — 아래 반박 검토 반영)들의 `evaluation_date` 최댓값과 비교) · 순번 없는 기실현 기록은 검사 밖. 흐름 끝과 같은 키라 ⑯의 틈이 닫혔다. ⓑ **월수익 금액의 정의는 하나**(DOC-007 RD-10 ③ · DOC-008 SQ-21 ⓒ 해결): `q_k`는 `P × r_m / 12`의 보조단위 절사값이고 F · `expectedAmount` · `remainingCoupons` · SCR-206 기본값이 같은 값이다. 절사는 지급 금액의 정의라 「집계는 반올림하지 않는다」와 충돌하지 않는다(검산 값 불변 · 달러의 원화 과세 `q_k × x`는 반올림하지 않는다). ⓒ **임베드는 상품 루트만**: (1)의 「`PRODUCT_SELECT` 임베드」를 고쳤다 — 차수 루트 `loadScheduleRows`에는 넣지 않고 b3이 상품 루트 셀렉트와 차수 루트 셀렉트를 가른다(DOC-010 AQ-77 방향 유지). ⓓ **I-23 보강**(DOC-002 DQ-17 ③): `REALIZED_ONLY ⇒ monthly_coupon_annual_rate IS NULL`. ⓔ **(9)의 미결을 답으로**: DB 오류의 `fields`는 색인 없는 이름(①) · `attentionItems[].count`(②) · `terms.monthlyCoupon.barrier`(③ — 표시어 「월수익 배리어」) · `product.monthlyCouponAnnualRate`(④) · 기실현 월지급은 `coupons = []` · `unnumberedCouponRecords: CouponRecordView[]` · `couponProgress = null`(⑤) · `remainingCoupons`를 `{ byYear, exchangeRateBasis }` 컨테이너(nullable)로(⑥) · §4.7 표 밖 표식 여섯째 `monthlyCouponAssumption`(⑦) · §4.12 `MonthlyCouponScheduleItem`과 `EXCHANGE_RATE_WIDE` 제외(⑧) · 상환일 쪽 사전 검사 = V-27의 양방향 문언(⑨) · §5.14 반환 `{ ids }`(⑩) · §5.15 삭제는 사전 조회 + 한 문장 DELETE, 행 수 불일치는 `CONFLICT`(⑪) · 기실현 기록 상품당 60건(⑫) · 월수익 연쿠폰율 상한 = V-08(⑬ — DB는 `> 0`만, 받아들인 이탈) · 매트릭스 시점 b2/b3과 `createProduct` · `updateProduct`의 `affects`(⑭ — 부분) · 필드 컷 배정(⑮) · V-20′ 해석. 등재 행은 지우지 않고 「→ 해결」을 달았다. **남은 것** — ⑭의 두 몫(b2~b3 동안 기록 두 계약이 서는 매트릭스 행 — b2 전 · SCR-206이 읽는 조회 계약 — DOC-008 SQ-21 ⓘ로, b3 전)과 **⑰ 신설**(ⓒ의 뒤따름 — §4.4 `COUPON_SCHEDULE_MISSING` 탐지와 §4.12 부모 임베드의 K² 복제, b3 전). **b1 명세에 없던 필드 하나** — `CouponRecordView.paymentDate`(⑤의 답이 순번 없는 기록을 지급일 순으로 싣게 해 그 기록의 유일한 날짜가 되었고 §5.15 수정 폼의 초기값이다). 용어에 「소득 사건」을 더했다(DOC-005). SCR-203의 과세 0 고정은 §5.4에 인용만. **개정을 맞춰 보며 고친 문장 넷** — §4.0 「형식」의 비율 4자리에 `terms.monthlyCoupon`의 `annualRate` · `barrier`(③의 답이 더한 필드) · §5.11의 「DOC-002 I-23은 `FULL`만 보고」(ⓓ 뒤로는 기실현 행의 월수익 연쿠폰율 `NULL`도 그 `CHECK`가 강제한다) · §3.2.1 I-23 항목에 `coalesce(…, false)`(DOC-002가 같은 개정에서 찾은 `NULL` 통과 구멍) · §5.14 무효화 각주의 「지급방식이 기본형만」(→ 「월지급식이」 — 쿠폰 지급방식과 월지급 변형은 다른 축이다. 변형 명칭은 DOC-005 GQ-06 미결). §3.2.1 부모 트리거 항목과 §9 ①에 `monthly_coupon_payments_after_redemption`의 `ErrorCode` · 칸이 DOC-002 DQ-17 ②의 미결임을 가리켰다(①의 답은 키의 모양만 정했다). 선행 명세 → 구현 컷 추가분: §5.14 `{ ids }` 반환 · V-27의 양방향 사전 검사와 60건 상한 → **b2** · `attentionItems[].count` · `terms.monthlyCoupon.barrier` · `monthlyCouponAnnualRate` · `unnumberedCouponRecords` · §4.12 행 타입 → **b3** · `remainingCoupons.exchangeRateBasis` · `monthlyCouponAssumption` → **b4** **반박 검토 반영(같은 판)** — 「쿠폰 지급」 선택 상자(「선택」 · 「상환 시 지급」)와 §4.3 `product.couponPayout`을 V-25와 같은 **b2** 커밋으로 옮겼고(b2~b3 동안 폼 저장이 전부 거부되던 공백), §5.2는 입력에 없는 순번을 지우고 기록된 순번이 입력에서 빠지면 사전 검사가 `CONFLICT`(23503은 마지막 그물 · V-26은 입력에 적용)이며, 상환 쪽 사전 검사와 `redemptions_before_coupon_payment`가 기록 쪽처럼 지급 · 미지급 모든 기록을 보고(대칭) 그 사전 검사의 컷은 b2(§5.4 · §5.5 · §5.11 꼬리표)이고, V-28에 지급일 중복(`entries[i].paymentDate`) · §4.12에 부모 `MONTHLY` 조건 · §3.2.1 b2 이름 목록에 둘(기록의 `coupon_no >= 1` · 일정의 `els_id` FK) · 일정 동결 트리거에 `IS DISTINCT FROM`을 더했고, `remainingCoupons`를 「잔여 월수익」(DOC-005)으로 부르고 「DB가 양쪽에서 막는다」류를 단일 요청 순서로 좁혀 DOC-010 AQ-93을 인용했으며, `COUPON_SCHEDULE_MISSING`의 조치 사유를 해결로 표기(결함 둘이면 앞의 것)하고 `terms.monthlyCoupon.barrier = null`의 두 뜻 · 흐름 끝의 전제(DOC-007 RD-20) · b0 조기 반환의 b4 이동 · `hasEstimates`의 실제 정의(DOC-007 RD-19 ⓑ) · X-07 제목의 「월수익 지급 기록」을 적었고, 결정 ID를 「b1 개정」 · 「민서 결정(2026-10-02) ①~④」로 정리하고 U5 · U6 · SB-n의 첫 자리에 「P8 계획 결정」을 밝혔다 |
| 4.15 | 2026-10-02 | 민서 | **P8 컷 a4-2 — X-07 앞절반이 코드로 섰다. §4.10 규칙 표에 X-07 행(코드 커밋과 함께 — v4.8의 약속).** `importOverStored`가 불러온 통화가 있으면 그것, 없으면 저장값을 싣고, 다르면 투자원금을 비운다. 조건은 `currencyChangedBy` 하나이며 비움과 구획 안내가 같은 함수를 부른다(조건을 두 곳에 적지 않는다). `hasImportGaps`가 빈 투자원금 · 빈 상품 통화를 빈 곳으로 세고 **수정 화면이 상태를 합친 값으로 양방향 다시 판정하므로** 비운 렌더는 「일부 채움」이다 — 「불러옴」은 투자원금이 저장값일 때만 선다는 속성을 테스트가 시나리오 여덟로 단언한다. *(반박 검토 반영 — 종전 판정은 올리기만 해서 노낙인 · 자산 전부 풀림 상품의 X-07 렌더가 「불러옴」으로 남았고, 속성 테스트의 시나리오 넷이 전부 KI 상품이라 그 갈래를 지나지 않았다. 노낙인 넷을 더했고 종전 판정으로 되돌리면 2건이 빨간불이다)* §9 X-07을 「앞절반 해결」로 고쳤다. 뒷절반(월수익 기록 있는 상품의 거부)은 그대로 b1이 컷을 정한다. **음성 대조**: 비움 한 줄을 지우면 3건, 통화를 늘 저장값으로 두면 3건, 빈 곳 판정을 빼면 3건이 빨간불이었다. §9 X-07의 `importMerge.ts:29` 줄 번호를 뺐다(식별자 `IMPORT_KEEPS_STORED`가 정본이다) |
| 4.14 | 2026-10-02 | 민서 | **P8 컷 a4-1 — X-07 앞절반(불러온 상품 통화와 투자원금의 연동)의 판정 규칙을 코드보다 먼저 쓴다. 선행 명세다 — `src/` 0줄, §4.10 규칙 표의 행 0줄.** **(1) 「불러온 상품 통화」의 정의** — DOC-010 v3.21 ADR-009 §7 `productCurrencyOf`의 **확정** 판정이다. **증인 없음은 「불러온 통화 없음」**이며 수정 화면에서 저장값을 남긴다(「원천에 없는 것은 저장값」 — 투자원금도 남는다). 충돌 · 지원 밖은 거부라 폼이 저장값 그대로다. **(2) 다르면** 통화는 불러온 값 · 투자원금은 빈칸 · 구획 안내 · 상태 「일부 채움」. 빈 투자원금은 사람이 채울 곳이고, 「불러옴」으로 두면 수정 화면의 그 문구(「투자원금 · 계좌유형 · 비고는 저장값 그대로다」)가 **거짓인 렌더**가 생긴다. 같으면 아무것도 비우지 않는다 — 같은 상품의 재불러오기가 투자원금을 지우지 않는다. **(3) 뒷절반**(월수익 기록이 있는 상품의 거부)은 v4.8 그대로 b1이 컷을 정한다. **(4) §4.10의 서명은 바뀌지 않는다** — `KiwoomProductCandidate`에 목록의 상환 단위(`rdmp_unit`)가 실리지만 필드 전수의 정본은 `terms-types.ts`다(§4.10 머리). **선행 명세 → 구현 컷**: X-07 앞절반 · §4.10 표의 X-07 행 → **a4-2** |
| 4.13 | 2026-10-01 | 민서 | **P8 컷 a3-2 — 추정 환율이 계약을 지난다. §4.11 `listExchangeRates`(조회 9 → 10) · §5.13 `saveExchangeRate`(변경 13 → 14) · v4.9 a3 몫의 뷰 필드 전부가 코드로 섰다. 화면은 아직이다(a3-3).** **(1) `loadEstimateRates(ctx)`** — `exchange_rates`에서 통화별 `as_of_date ≤ asOf` 최신 1건(`limit(1)`)을 요청당 한 번 읽는다. 다섯 호출부(`getProduct` · `getDashboard` · `getTaxSummary` · `listUserSummaries` · `getForecast`)의 `NO_ESTIMATE_RATES`를 그것으로 바꿨고 **전부 첫 물결에서 나란히** 나간다 — §4.0 왕복 표를 고쳤다(`listProducts`와 `getProduct`를 갈랐다 — `getProduct`만 3이다). `getProduct`는 종전 순차(`loadProduct` → 시세)였고 환율을 `loadProduct`와 같은 물결에 두었다 — 그래서 상품이 없거나 기초자산이 0건이어도 환율 왕복은 나간다(`getProductNoUnderlying` 예산 `{els_products: 1, exchange_rates: 1}`). §4.11과 **같은 로더**(`loadLatestExchangeRates`)와 같은 근거 사상(`exchangeRateBasisOf` — `priceString` · §4.5 `isStale`)을 지나므로 SCR-302의 최신 환율과 다른 화면이 쓴 환율이 갈릴 수 없다. **(2) 뷰 필드** — §4.0 `ExchangeRateBasisView` · §4.1 `totals.krwEstimate`(보유중 외화가 있을 때만, 외화 하나라도 환율이 없으면 두 필드가 함께 `null` — 부분합 없음) · `currentYearTax.exchangeRateBasis`·`convertedCount` · §4.3 `projection.exchangeRateBasis` · §4.6 `income.exchangeRateBasis`·`convertedCount` · §4.7 `ForecastRow.exchangeRateBasis`. **「환산함」의 신호** — v4.9가 이름을 정하지 않은 자리다. 순수 모듈에 `estimateConversionOf`(곱해야 하는 외화 또는 `null`)를 두고 **`taxableIncomeKrw`가 그 함수로 갈리게** 했다 — 분기 순서를 두 곳에 적으면 「환산한 건 + 빠진 건 = 곱해야 하는 건」이 조용히 깨진다(`tests/domain/currency.test.ts`가 48조합으로 둘의 일치를 본다). 기여(`contributionOf`)는 그 환율을 `estimateRate`로 나르고 `convertedCount`가 그것을 센다. **(3) §4.7 — 결정 둘(문서에 없던 것)** — `exchangeRateBasis`가 붙는 행은 `excludedForeignCount`와 **같은 규칙**(환산한 외화 상품이 처음 원화 합에 필요해진 행부터 마지막 행까지 — 그래서 모든 행이 같은 값, 기준 연도 이전 상환은 세우지 않는다)이고, `hasEstimates`의 행 축은 **그대로**다(누적 두 열의 앞 행 몫은 원화 추정에서도 세지 않았다 — 달러 환산만 다른 규칙을 두지 않는다). §4.7 「달러 상품의 전망」에 두 줄로 적었다. **(4) §6** — V-24 행의 ⓑ를 본문으로(필수 · 같은 수치 규칙 · 통화는 `USD`만), V-17 행에 환율. `V17_notFuture`가 **대상을 인자로** 받는다 — 문구에 「시세」가 박혀 있어 환율 폼에 「시세」가 뜰 자리였다(반박 검토 지적). 조사는 받침으로 갈린다(「환율은」 — `${subject}는`으로 조립하면 「환율는」이다). **(5) §8** — SCR-302 행에 두 계약. `EXCHANGE_RATE_WIDE`(세금이 «있다») · `PRODUCT_WIDE`·`createProduct`에 `listExchangeRates`(그 통화의 미상환 수 — `createRealizedProduct`·`setKiTouched`는 아니다) · `ROUTE_QUERIES['/prices']`. `refreshPrices`·`saveManualPrice`의 `affects`에 세금 계약 **셋 다** 없음을 단언한다(종전은 `getTaxSummary` 하나만 보았다 — SB-17). **(6) 정정 셋(낡은 문장)** — §5.0.1 `refreshPrices`의 「0 · 공급자 0개」는 P5a 컷 3 전의 값이었다(테스트는 그 컷부터 5를 단언했다) · §5.12는 그 표에서 잰 적이 없다고 적었다 · §4.11 「환율 없음 — 수동 입력」 예시를 지웠다(문구 정본은 DOC-008 SCR-302 「최신 값」 행이고 두 문구가 갈려 있었다). `usedByActiveProducts`가 §4.5처럼 **전 사용자의** 미상환 상품을 센다는 것을 명시했다 — DOC-008 SCR-302 「절」 행의 근거(「원화뿐인 사용자에게 매번 펼쳐진 절은 소음」)는 조회자 본인의 수를 전제하므로 그 차이는 화면 컷(a3-3)에서 민서에게 묻는다. **(7) 통합 스위트** — `exchange_rates`에는 소유자도 이름도 없고 사용자는 지울 수 없다. 그래서 픽스처 환율은 **`AS_OF` 뒤의 예약 날짜**(`FX_RATE_DATES`)에만 쓰고 `resetFixtures`가 그 날짜만 지운다(소유자 커넥션) — `AS_OF` 컨텍스트에서는 환율이 없어 a2의 E-09 단언이 파일 순서와 무관하게 서고, 환율이 있는 상태는 `RATE_AS_OF`로 읽는다. `formats.test.ts`가 새 경로(근거 뷰 다섯 접두사 · `krwEstimate` · `convertedCount` · §4.11)를 `PRICE`·`AMOUNT_KRW`·`NUMBER`로 등재하고 비-null·null을 둘 다 관측시킨다(`krwEstimate = null`은 원화뿐인 B의 홈). `exchange-rates.test.ts` 신설 — **계약 경로의 `provider: null`**(자동 행을 수동 정정하면 공급자가 지워진다) + 짝 통제(열을 뺀 PostgREST UPSERT는 `23514 exchange_rates_provider_check`) · 「같은 행」(SCR-302 = 세금 · 홈 둘 · 상세 · 전망 전 행) · **F의 항등**(`getTaxSummary` = `getForecast` Y₀ = 본인 `UserSummary` = 홈 — 환율 있음 · 없음 각각). **음성 대조**: `estimateRate`를 환산과 무관하게 채우면 · 부분합을 주면 · 기준 연도 이전 상환에 근거를 세우면 · `provider: null`을 빼면 · `asOf` 상한을 빼면 · 환율 탐침의 `number`를 문자열로 바꾸면 — 여섯 다 빨간불을 먼저 보았다. **반박 검토 반영(커밋 전, 확인된 19건 — 값 결함 0)**: ⓐ 낡은 왕복 수 — §4.7 본문 「왕복은 3이다」 → 4 · §4.0 v2.5 각주(다중집합에 `exchange_rates`) · 「a3에서 고친다」를 과거형으로 · §4.4 각주의 `listUserSummaries` 4(당시) · 코드·테스트 주석 넷 ⓑ **§5.13 ★의 오류 코드** — `provider_check`에 걸린 수동 정정은 `INTERNAL`이 아니라 **칸 없는 `VALIDATION_FAILED`**다(사상이 없는 `23514`의 기본값 — `tests/db/errors.test.ts`가 고정한다). 결론(정정 경로가 막힌다)은 같고 근거의 코드가 틀렸다 ⓒ §5.0.1 — `refreshPrices` 행을 조건부(매핑 0건 5 · 새 종가 N건 5+N · 대상 0건 2)로, ① 「사전 조회가 필요한 계약만 2 이상」을 사용자 데이터 계약으로 좁혔다(그 행이 반례다) ⓓ §8 SCR-302 행의 「공급자 미등재」(P5a 컷 3 이후 낡음)와 말미 각주의 현재형 ⓔ §9 원장의 줄 번호 참조를 케이스 이름으로 ⓕ `getProduct` 물결 근거 — 「통화를 보고 고르면 물결이 셋」은 사실이 아니었다(둘째 물결에서 조건부로 내면 둘 그대로다). 선택은 그대로이고 근거를 「규칙 2의 균일함 · 통화 무관한 예산」으로 고쳐 적었다 ⓖ 테스트 공백 셋 — `usedByActiveProducts`가 «전 사용자 · 미상환»임을 B의 달러 둘(보유 · 상환)로 값으로 가른다(조회자로 좁히면 1 · 상환을 세면 3 · 옳으면 2) · 원화 환율 거부를 계약의 문구로 가르고 DB CHECK 짝 통제를 더했다(칸만 보면 DB 겹도 같은 칸이다) · `saveExchangeRate.affects`를 집합 전체로 박았다(`listAssetPrices`를 넣어도 `/prices`가 이미 낡아 초록이었다). 「변경 계약 열하나」 등 사본 문장 아홉은 수를 빼고 고쳤다(다시 낡지 않게). **배포 순서**: 이 코드는 `exchange_rates`를 읽으므로 **W2 `db push` 뒤에만** `main`에 간다. 화면(a3-3)과 함께 간다 — 이 커밋만으로는 환율을 넣을 화면이 없어 운영 동작이 같다 |
| 4.12 | 2026-10-01 | 민서 | **P8 컷 a3-1 — §3.2.1 제약 이름 표에 `exchange_rates` 넷을 더했다(코드 커밋과 함께).** `exchange_rates_currency_check` → `currency` · `exchange_rates_rate_check` → `rate` · `exchange_rates_coordinates_immutable`(트리거 라벨 · `RAISE_ONLY`) → `currency` · `asOfDate`(**검증 오류다 — 상태 충돌이 아니다**) · `exchange_rates_currency_as_of_date_key` → `asOfDate`. `exchange_rates_provider_check`는 사상하지 않는다(`NOT_USER_REACHABLE` — 수동 입력은 `provider = null`을 명시한다). 산문(v4.9)의 사상 그대로다. **§5.1의 「통화 누락 → 23502」가 도달 가능해졌다** — M-a2c(W2)가 열 기본값과 RPC `coalesce`를 뗐다. 계약 계층은 V-22로 앞에서 막고, 우회하는 직접 호출은 `NOT_NULL_FIELD`의 `currency`로 그 칸에 닿는다. Q-01의 정책 수 37 → 40 |
| 4.11 | 2026-09-30 | 민서 | **P8 컷 a2-3a — 달러 ELS의 계약 · 조회가 코드로 섰다. v4.9 선행 명세의 a2 몫이다(a3 몫 — `exchangeRateBasis` · `krwEstimate` · `convertedCount` · 실제 환산 — 은 싣지 않았다: 추정 환율이 없어 모든 응답에서 구조적 상수가 된다, §4.0 「컷별 도달」).** **(1) §6 규칙 표에 V-22 · V-23 · V-24 세 행 — 코드와 같은 커밋**(파서 결속 — `RULE_IDS`를 `tests/db/docs-contract.test.ts`가 양방향으로 대조한다, V-21 선례). V-01에서 「정수」를 떼어 V-23으로 옮겼다(자릿수는 통화가 정한다). **(2) 입력** — `ProductInput` · `RealizedProductInput`의 `currency`(기본값 없음 — V-22), `RedemptionInput` · `RealizedProductInput`의 `exchangeRate?`(V-24 — 원화 상품이면 거부). 상환(§5.4 · §5.5)의 `grossAmount`는 **부모 상품의** 통화로 V-23을 지난다 — 기존 사전 조회의 select에 `currency`를 더했고 왕복은 그대로다. **V-23을 통과한 금액은 `moneyString`으로 접어 싣는다** — `dec('10000.500').decimalPlaces()`는 1이지만 DB의 `scale()`은 끝의 0까지 세어 3이므로, 접지 않으면 `els_products_principal_scale_check`가 정상 입력을 거부한다(`tests/integration/mutations.test.ts`가 그 경로를 왕복시킨다). **(3) 조회** — §4.1 `totals.byCurrency[]`(최상위 `activePrincipal` · `realizedPnl`은 사라졌다) · `currentYearTax.unconvertedCount` · `recentRedemptions[].currency` / §4.2 `currency` · `PRINCIPAL` 정렬의 통화 묶음(`sortItems` — 계약 층) / §4.3 `product.currency` · `projection.expectedTaxableIncome: string | null`(DOC-007 §4.8 `taxableIncomeKrw` — 원화 상품은 그 경로를 지나지 않는다) · `RedemptionView.exchangeRate`(6자리) / §4.4 `currency` · 「달러 기준 참고」(보조단위로 접은 세전에서 세 값이 파생되고 원천징수는 `rounding.unit = MINOR_UNITS[currency].unit` — 원화 `'1'`은 종전 `DEFAULT_ROUNDING`과 같다) / §4.6 `income.unconvertedCount` · `contributingProducts[].currency` · `exchangeRateMissing` · `taxableIncome: string | null`(빠진 상품도 행에 남는다) / §4.7 `excludedForeignCount`(모든 행이 같은 값 — 그 규칙에서 보유중 · `Y₀` 상환 상품은 첫 행부터 원화 합에 필요하다) / §4.8 `activePrincipalByCurrency`. **원화뿐인 범위의 문자열은 바이트 단위로 같다** — `byCurrency`는 원화 한 행이고 그 값이 종전 두 필드와 같다(통합 스위트의 단언이 그 형태로 바뀌었다). **(4) 추정 환율의 자리를 먼저 만들었다** — 매퍼 넷(`toProductDetailView` · `contributionOf` · `computeOwnTax` · `forecastItemOf`)이 `rates: EstimateRates`를 **기본값 없이** 받고, 호출부 다섯(`getProduct` · `getDashboard` · `getTaxSummary` · `getForecast` · `listUserSummaries`)이 `NO_ESTIMATE_RATES`를 명시로 넘긴다. 컷 a3는 그 다섯 줄을 `loadEstimateRates(ctx)`로 바꾼다 — 기본값을 두면 a3에서 주입을 잊은 호출부가 환율이 있는데도 조용히 전부 E-09가 된다. **(5) Q-07′ 검증 계기가 섰다** — `tests/integration/helpers/formats.ts`의 `AMOUNT`를 과세 축 `AMOUNT_KRW`와 상품 통화 `MONEY`로 갈랐다(가까운 조상의 `currency` → 루트 `product.currency` → 없으면 **던진다**). `formats.test.ts`에 달러 픽스처 둘(센트 — 상환 완료 · 미상환)과 계기 자신의 음성 대조 셋(달러 `'10001'`은 위반 · 형제 가지는 루트 폴백 · 통화 없음은 던진다). 달러 17자리 경계(`999999999999999.99`)의 계약 왕복도 같은 커밋이다. **반박 검토가 계기 둘을 더 요구했다** — 경로 단위의 「비-null로 한 번 관측」은 원화 한 번으로 채워져 달러 분기가 판정됐는지 말하지 못하므로, `MONEY` 경로 열여섯마다 **원화와 달러가 둘 다** 비-null로 관측되는지 단언한다(③′). 그리고 형식만 보는 검사는 `null`을 `'0'`으로 흡수하거나 통화를 넘어 더해도 초록이므로, 달러 픽스처로 **값을** 본다 — §4.6 빠진 행 `taxableIncome = null` · `unconvertedCount = 1` · 확정 원화 `'835740'` 그대로 / §4.1 같은 건수 · 달러 행 / §4.7 모든 행 `excludedForeignCount = 2` / §4.8 달러 원금. 상환의 끝 0 정규화(`10400.520` → `10400.52`)와 V-23이 **계약 층에서** 거부하는지(문구로 가른다 — DB 트리거도 같은 코드 · 같은 칸으로 사상되므로)도 같은 커밋이다. **(6) 화면 입력은 아직 원화만 고른다** — DOC-008 v2.16(4). **(7) 문장 둘을 좁혔다** — §4.0 「컷별 도달」과 §4.3 「컷」의 「미상환 달러 상품은 늘 `null`」은 일반 계좌 · 달러 이익 > 0에만 참이다(비과세 · 이익 ≤ 0은 환율 없이 `'0'` — 같은 절의 표). 동작은 처음부터 표대로였다 |
| 4.10 | 2026-09-30 | 민서 | **P8 컷 a2-1 — §3.2.1 제약 이름 표에 넷을 더했다(코드 커밋과 함께).** `els_products_principal_scale_check` → `principal` · `redemptions_gross_amount_digits_check` → `grossAmount` · `redemptions_gross_amount_scale`(RAISE) → `grossAmount` · `redemptions_exchange_rate_check` → `exchangeRate`. `errors.ts` `BY_CONSTRAINT`와 같은 커밋이다(`tests/db/docs-contract.test.ts`가 양방향으로 대조한다). v4.9의 산문 사상(§3.2.1 끝)은 선행 명세로 남는다 — a3의 `exchange_rates_*`가 아직 산문이다 |
| 4.9 | 2026-09-30 | 민서 | **P8 컷 a1 — 달러 ELS(DOC-001 S-13)의 계약을 코드보다 먼저 쓴다. 본 버전은 선행 명세다 — `src/` 0줄, 파서에 결속된 표(§6 규칙 표 · §3.2.1 제약 이름 표 · §8 매트릭스)의 행 0줄.** 월지급식 절반은 컷 b1이다(§4.12·§5.14·§5.15는 가리키는 한 줄만 두었다). 용어는 DOC-005 v1.6(상품 통화 · 적용 환율 · 추정 환율 · 원화 환산 · 포트폴리오 손익 · 환율). **(1) 공통 타입 둘 — §4.0.** `ProductCurrency`(`KRW`·`USD` — 선언 순서가 목록·정렬 순서)와 `ExchangeRateBasisView`(추정에만 붙는다, ST-05). 규칙 넷 — 금액이 있는 곳에 통화가 있다 · 추정 환율은 요청당 통화별 하나 · 기본 환율 없음(개수로 말한다) · 확정 원화 값은 늘 들어간다(E-09는 건 단위). 왕복은 a3에서 다섯 계약이 +1(물결 불변). **(2) Q-07 개정** — 금액이 두 부류다: 상품 통화 금액은 보조단위 고정 자릿수(KRW 0 · USD 2 — `moneyString(value, currency)`, 통화 인자에 기본값 없음), 과세 축 금액과 원화 환산 추정값은 언제나 원화 정수(`amountString` — 바이트 동일), 환율은 시세와 같은 6자리. 통합 형식 검사는 통화 조상을 못 찾으면 **던진다**(SB-10), 달러 픽스처는 센트를 싣는다. 달러 금액은 17자리라 Q-08의 방어가 값을 지키는 유일한 층이 된다. **(3) 뷰.** §4.1 `totals` → `byCurrency[]`(KRW→USD, 0건이면 `[{KRW,0,'0','0'}]`) + `krwEstimate`(보유중 외화가 있을 때만, 부분합 없음) — ② 마커는 여전히 `totals` 한 키, 항등식은 통화별, 원화 전용 포트폴리오는 바이트 동일 · `currentYearTax`에 `exchangeRateBasis`·`unconvertedCount` · `recentRedemptions[].currency`. §4.2 `currency`, `PRINCIPAL` 정렬 = 통화(KRW→USD) 다음 원금 큰 순 — 환산 비교 안 함, 묶음은 계약 층(DOC-008 SQ-15의 계약 쪽). §4.3 `product.currency` · `projection.expectedTaxableIncome`이 원화 `string | null`(null = E-09 — `projection`의 null 두 경우와 다른 셋째) · `projection.exchangeRateBasis` · `RedemptionView.exchangeRate`(참고). §4.4 `currency` — `ScheduleProceeds`는 단일 통화·환율 무관: 달러는 「달러 기준 참고」 원천징수(DOC-001 U8 · DOC-007 §4.5 — `rounding.unit = '0.01'`, 세율은 조회)라 세후 = 세전 − 원천징수가 통화마다 성립하고 SCR-301이 환율에 낡지 않는다. §4.6 `income.exchangeRateBasis`·`unconvertedCount` · `contributingProducts[].currency`·`exchangeRateMissing`·`taxableIncome: string | null` — 빠진 상품도 행에 남는다. 확정/추정 분할은 b1. §4.7 `excludedForeignCount`(표 밖 표식 넷째, a2)·`exchangeRateBasis`(다섯째, a3 — 둘 다 열이 아니다, `OutsideTable` 3→4→5, DOC-008 SCR-402) · `hasEstimates`는 환산에도 참. §4.8 `activePrincipalByCurrency` — E-09 표식은 화면이 없어 두지 않는다(SQ-01). **(4) §4.11 `listExchangeRates` 신설 — 컷 a3, 조회 계약 9 → 10.** `latestRate`는 추정 환율과 같은 행, 지원 외화마다 원소 하나(빈 배열이 「환율 없음」이 아니다), `autoCollected`는 레지스트리에서 파생(분기 C면 영구 `false` · neutral). 왕복 2. **(5) 입력.** §5.1·§5.2 `ProductInput.currency`(필수·기본값 없음 — 원화로 채우면 약 1,400배가 형식 정상으로 저장된다), V-23을 지난 **뒤** 정규화, 쓰기 함수의 `coalesce`는 확장 웨이브(W1)에만 — 축소(M-a2c, a3) 뒤 통화 누락 → `23502` → `fields.currency`를 영구 단언(SB-12), 미상환 상품의 통화 변경 허용(뜻의 짝은 입력 계층 — X-07·SCR-204). §5.4·§5.5 `RedemptionInput.exchangeRate?`(참고 — 계산에 쓰지 않고 추정 환율의 원천도 아니다), `grossAmount`는 부모 상품의 통화로 V-23(사전 조회 select에 `currency` — 왕복 불변), 과세 둘은 원화 그대로라 원천징수 기본값이 유효하다, 달러 상품의 SCR-203 과세 칸은 미리 채우지 않는다. §5.11 `currency`·`exchangeRate?`. **(6) §5.13 `saveExchangeRate` 신설 — 컷 a3, 변경 계약 13 → 14.** §5.7과 같은 UPSERT, `source = 'MANUAL'` · **`provider = null`을 명시해 싣는다** — 싣지 않으면 자동 수집 행의 수동 정정이 `exchange_rates_provider_check`에 걸리고 그 제약이 `NOT_USER_REACHABLE`이라 `INTERNAL`이 된다(정정 경로가 막힌다). 이 명시가 그 분류의 전제다. `affects` = 새 축 `EXCHANGE_RATE_WIDE`(세금이 **있다** — `listExchangeRates`·`getProduct`·`getDashboard`·`getTaxSummary`·`listUserSummaries`·`getForecast`), `PRICE_WIDE`는 세금 없음 유지(SB-17 · SQ-19), `listExchangeRates`는 `PRODUCT_WIDE`·`createProduct`에도 든다. **(7) §6 규칙 넷의 문언** — V-01′(0보다 큼) · V-22(상품 통화, 기본값 없음 — V-19의 기초자산 통화와 다른 필드) · V-23(상품 통화 금액 자릿수 · 정수부 15자리, V-22 위반이면 판정 안 함, 과세 둘은 대상 아님) · V-24(적용 환율은 외화 상품에만 · `saveExchangeRate`의 외화·율 — 0 초과 · 6자리). **(8) §3.2.1 사상의 문언** — `els_products_principal_scale_check`(fail-closed) · 트리거 라벨 `redemptions_gross_amount_scale` · `redemptions_exchange_rate_check` · `exchange_rates_*` 넷(좌표 동결은 `VALIDATION_FAILED`) · `provider_check`는 `NOT_USER_REACHABLE`. 널 위반 `currency`는 `NOT_NULL_FIELD`에 **이미 있다**(`assets.currency` — 열 이름 사상). **(9) §8·§9** — 매트릭스에 더할 두 이름을 말미 각주로, §9 P8 계약면 표에 a1 명세 자리를 적었다. **부수 발견(범위 밖)**: §5.7 `saveManualPrice`도 `provider`를 싣지 않아 자동 시세를 수동 정정하면 `source = 'MANUAL'`인데 `provider`가 남는다 — 짝 제약이 없어 조용하고 그 열을 읽는 조회가 없다. 등재는 DOC-010의 몫. **확실성**: 원화 환산 산식 `max(0, 세전 − 원금) × 추정 환율`이 기대는 원금 환차익 비과세는 **추론**이다(1차 출처 미확인 — DOC-007 RD-13). **선행 명세 → 구현 컷**: Q-07′ · V-01′·V-22·V-23·V-24ⓐ · 뷰·입력의 `currency` 전부 · `byCurrency`·`activePrincipalByCurrency` · `unconvertedCount`·`excludedForeignCount`·`exchangeRateMissing` · `expectedTaxableIncome`의 null · `exchangeRate`(참고) · `PRINCIPAL` 정렬 · 달러 기준 참고 원천징수 · §3.2.1 a2 사상 → **a2** · `ExchangeRateBasisView`와 `exchangeRateBasis` 필드 전부 · `krwEstimate` · §4.11 · §5.13 · V-24ⓑ · `EXCHANGE_RATE_WIDE` · 왕복 +1 · §3.2.1 a3 사상 · 통화 기본값·`coalesce` 제거(M-a2c) · §8 행 → **a3** **반박 검토 반영:** S2 §4.7 `excludedForeignCount`는 그 상품이 처음 원화 합에 필요해진 행부터 **마지막 행까지** 센다 — 누적 두 열이 뒤 행에서도 그 상품을 잃는다(종전 「상환 연도까지」) · S3 §4.3의 `product.currency`는 `schedules[]`·`projection`·`redemption`의 조상이 아니라 형제이므로 `MONEY` 헬퍼가 조상 다음으로 루트의 `product.currency`를 본다(둘 다 없으면 여전히 던진다 — §4.0 규칙 1 · Q-07′) · S5 §4.1 `currentYearTax`·§4.6 `income`에 `convertedCount`(a3 — 일반계좌 · 달러 이익 > 0 · 추정 환율 있음. DOC-008 SCR-101 ③·SCR-401 「달러 상품 n건」의 n) · C1 §4.4 달러 참고 원천징수는 실제 달러 차감액과 −1~+1.5센트 안에서 갈린다(15.4% 단일 곱이 두 단계 10원 절사보다 0~19원 **크다** — 종전 「0~약 21원 적고」는 방향과 크기가 틀렸다), §5.4 「최대 약 20원」 → 「최대 19원」 · C2 §4.4의 표시 서술을 DOC-008 SCR-301(달러 ⑬ 값의 「≈」 · 머리글·모바일 라벨의 「달러 기준 참고」 · 목록 세후 고지의 한 문장)에 맞췄다 · C4 V-24ⓐ와 이 행의 「참고 환율」 → 「적용 환율」(DOC-005 표준 용어) · C6 §5.1 「b2·b2c」 → 「b2 · b4의 M-b2c」(DOC-002 §4.6) · L4 Q-07 — `krwEstimate.activePrincipal`은 ⓑ · L5 §4.3·§4.6 표에 「달러 이익 ≤ 0이면 환율 없이 0」 줄(월지급식이 b1에서 전부 E-09로 표시되지 않게) · L7 V-24 정수부 12자리 이내(`numeric(18,6)`) · O1 Q-07 「모든 응답이 바이트 동일」 → 「모든 금액 문자열이 바이트 동일」(응답의 모양은 바뀐다), §4.1 「달러 0건」은 통화 열이 없어 상품명으로 추론한 값 · Q-07 — DB는 USD 금액의 소수 자릿수를 2 **이하**로만 강제하고 `moneyString`이 읽기에서 정확히 2자리로 정규화하므로 고정 형식이 저장된 어떤 값에도 선다 · §3.2.1·§5.4 — `gross_amount`의 통화 무관 부분(정수부 15자리 · 소수 2자리 이하)은 단일 행 `CHECK` `redemptions_gross_amount_digits_check`(a2 — 데이터 전용 복원이 다시 검사한다), 트리거 `check_amount_scale_by_currency()`는 통화 의존 부분(원화 부모 ⇒ 소수 0자리)만 보며 라벨은 테이블마다 리터럴이다(b2가 `TG_TABLE_NAME`으로 조립하지 않는다) |
| 4.8 | 2026-09-30 | 민서 | **P8 컷 0b — 달러 ELS·월지급식 ELS(DOC-001 v1.7 S-13·S-14)가 이 문서에 만드는 예정·미결을 §9에 먼저 등재한다. 서명과 §4·§5·§6·§7.1·§8의 표 행은 0줄, `src/` 0줄이다.** 용어는 DOC-005 v1.6을 따른다(상품 통화 `currency` · 쿠폰 지급방식 `coupon_payout` · 월수익 · 월수익 일정 `monthly_coupon_schedules` · 월수익 지급 기록 `monthly_coupon_payments` · 적용 환율 `exchange_rate` · 추정 환율 · 환율 `exchange_rates`). **(1) CR-11~13 — 예정(컷 c2, ADR-010 게이트가 분기 A/A′일 때만).** 환율 수집이 `GET /api/cron/prices`의 둘째 단계가 될 때의 규칙 셋이다 — 실패 영역을 가르고(HTTP 상태를 바꾸지 않는다), 같은 `(currency, as_of_date)`를 덮어쓰지 않고(CR-05의 환율판), 키가 없으면 **환율 단계만** 끈다(CR-10의 전체 500과 반대 방향). **§7.1 표에 지금 적지 않는 이유는 결속이다** — `tests/app/cron.decide.test.ts:348`이 표를 길이 10으로 단언하고 모든 ID를 사전 판정 또는 `NOT_A_VERDICT`로 분류하라고 요구하므로, 행이 코드보다 먼저 서면 그 커밋이 빨간불이다. 분기 C면 셋을 「해당 없음」으로 닫는다. **(2) X-07 — 예정(컷 a4).** 불러온 상품 통화가 저장값과 다르면 투자원금을 비운다 — 투자원금은 `IMPORT_KEEPS_STORED`에 있어 저장값이 남으므로 통화만 바뀌면 `10000000`(원)이 $10,000,000.00이 된다. 월수익 기록이 있는 상품은 통화·쿠폰 지급방식이 다른 불러오기를 거부한다. **뒷절반은 a4에서 도달할 수 없다** — 월지급식은 컷 b4에서야 선택 가능하므로(DOC-000 P8 — 월지급식 선택은 컷 b4) 기록 있는 상품이 계약 경로로 생기지 않는다. 발동 불가인 분기를 먼저 세우는 대신 그 절반의 컷을 b1 명세에서 정하도록 등재했다. **(3) X-08 — 예정(컷 b5/b5′).** 월수익 평가일은 투자설명서 PDF에서 읽으면 실제 날짜, 못 읽으면 산식 날짜 + 「산식」 표시(ADR-009 ⑰)이고 조기상환 평가일과 겹치는 달은 실제 날짜다. 원천 사실(2026-09-30): EM2048의 1~36회 실제 날짜 표는 투자설명서에만 있고 지급일은 「평가일 후 3영업일」이다. **(4) 계약면 증가 예정을 §9 한 자리에 표로 적는다** — 변경 계약 13 → 17(`saveExchangeRate`·`recordCouponPayments`·`updateCouponPayment`·`deleteCouponPayments`), 조회 계약 9 → 11(`listExchangeRates`·`listMonthlyCouponSchedule`), V-22~V-29 신설과 V-01·V-08·V-20 개정, Q-07 개정(상품 통화 금액은 보조단위 고정 자릿수, 과세 축은 KRW 정수), §3.2.1·§8의 새 행. 명세는 컷 a1·b1이고 **파서에 결속된 표의 행은 코드 커밋(a2·a3·b2·b3·b4)에 함께** 선다 — V-21(v3.6)·§8 외부 조회(v4.3 → v4.4)의 선례다. **(5) AQ-76~87은 DOC-010 §9에만 둔다** — 여기에는 가리키는 한 줄만 적는다(사본은 갈린다). **(6) 낡은 수 하나를 정정한다** — Q-01 근거의 「정책 32개」 → **37개**(`supabase/migrations/`의 `create policy` 37문 · `drop policy` 0문, 2026-09-30 실측). 선행 명세: CR-11~13 → c2 · X-07 → a4(기록 절반의 컷은 b1에서 배정) · X-08 → b5/b5′ · 계약 17 · 조회 11 · V-22~29 · V-01′·V-08′·V-20′ · Q-07′ → 명세 a1·b1, 표 행 a2·a3·b2·b3·b4 |
| 4.7 | 2026-09-24 | 민서 | **v4.6 변경 이력의 서술 둘을 정정한다 — 배포 전 반박 검토가 짚었다. 계약면·규칙 X는 바뀌지 않는다.** **(1) v4.6 (1)의 「같은 커밋에서 `ROUTE_EXTERNAL_LOOKUPS`에 선다」가 거짓이었다** — §8 행의 문구는 문서 커밋(`a22332a`)에서, 원장은 다음 코드 커밋에서 섰다. 그 사이가 초록이었던 이유는 §8의 **식별자**가 바뀌지 않았고(「등록만」은 산문이다) 대조가 화면 단위 합집합이기 때문이다 — v4.6 (4)가 적은 바로 그 구멍이다. **(2) v4.6 (3)의 「폼이 저장값을 싣는 규칙이 그대로 병합의 바닥이 된다」가 구현·DOC-008과 반대였다** — 병합의 바닥은 **기본값**이고 저장값에서는 원천에 없는 칸만 가져온다(DOC-008 v2.12 「칸 단위로 합치지 않는다」). v4.2의 규칙(초기값이 저장값을 싣는다)은 **불러오지 않은** 수정 화면의 바닥이다 |
| 4.6 | 2026-09-24 | 민서 | **외부 조회를 SCR-204 수정 라우트에도 배정한다 — DOC-008 v2.12(SQ-10 해결). 계약면은 바뀌지 않는다**(조회 계약 · 변경 계약 13 · §6 그대로). **(1) §8 SCR-204 행의 「등록만」을 지운다** — 같은 커밋에서 `ROUTE_EXTERNAL_LOOKUPS`에 `/products/[id]/edit`이 선다(§8은 그 원장과 양방향 대조). **(2) X-01에 수정 라우트의 순서를 적는다** — `getQueries()` 다음에 `getProduct`와 **소유 확인**이 먼저다. 비소유자(SCR-902)와 상환 처리된 상품(저장이 §5.2 `CONFLICT`)은 키움을 부르지 않는다 — 결과를 쓸 수 없는 요청을 외부로 내보내지 않는다. **(3) X-04의 경로에 §5.2를 더한다** — 수정 화면에서 불러온 값은 §5.2(전체 교체)를 지난다. 전체 교체이므로 폼이 저장값을 싣는 규칙(v4.2)이 그대로 병합의 바닥이 된다. **(4) ★ 원장 대조가 이 변경을 보지 못했다 — 라우트 단위 대조를 더한다.** §8 ↔ `ROUTE_EXTERNAL_LOOKUPS`는 **화면 단위 합집합**이고 SCR-204가 두 라우트이므로, 수정 라우트가 키움을 부르면서 원장에서 빠져도 등록 라우트가 같은 셋을 채워 합집합이 같다 — **실측으로 초록이었다**(원장에서 `/products/[id]/edit`을 지우고 41건 통과). 그래서 원장의 좌변을 **페이지 소스**에서 읽는 대조를 더했다(`page.tsx`의 `.이름(` 호출 ↔ 원장, 라우트마다 같은 집합). X-01이 외부 조회를 페이지가 직접 부르게 하므로 그 호출이 곧 라우트의 외부 조회다. 음성 대조: 같은 삭제가 이제 빨간불이다. 「겹치지 않는가」를 세는 대조가 「빠지지 않았는가」에 답하지 못한다는 CLAUDE.md 절대 규칙 #6의 교훈이 **한 화면 두 라우트**에서 되풀이된 것이다 |
| 4.5 | 2026-09-24 | 민서 | **§4.9 `AssetOption.assetType` 신설.** 불러오기의 「기존 자산에 연결」 후보가 **같은 유형·통화**여야 하는데(DOC-008 SCR-204) 뷰에 유형이 없어 구현이 통화만 봤다 — 주식 제안에 같은 통화의 지수 자산이 후보로 떴다(반박 검토). 열을 하나 넓힐 뿐 왕복은 늘지 않는다 |
| 4.4 | 2026-09-24 | 민서 | **§8 SCR-204 행에 외부 조회 셋과 `saveProviderSymbol`을 올린다 — 코드 원장과 같은 커밋이다.** v4.3이 「§8은 코드 원장과 양방향으로 대조되므로 원장과 같은 커밋에서 올린다」고 적은 그 커밋이다. **(1) 원장이 둘이 됐다** — `ROUTE_QUERIES`(조회 계약, 무효화 축 안)와 `ROUTE_EXTERNAL_LOOKUPS`(외부 조회, 축 밖 — §4.10 X-05). `tests/app/invalidation.test.ts`가 §8의 백틱 식별자를 **세 부류**(조회 계약 · 미구현 등재 · 외부 조회)로 가르고, 외부 조회는 화면별로 원장과 양방향 대조한다. **(2) 외부 조회의 이름은 어댑터 객체에서 실행 시점에 파생한다** — `MUTATION_NAMES`가 `createMutations`의 키에서 나오는 것과 같은 형태이며, 목록을 테스트에 다시 적으면 어댑터에 조회가 늘어도 대조가 모른다(「빠지지 않았는가」에 답하지 못한다). 음성 대조: 원장에서 `listKiwoomAssets`를 빼면 양방향 케이스가 빨간불이다. **(3) `saveProviderSymbol`을 SCR-204에 배정한다** — 불러오기의 「자산 추가」 둘째 단계와 「기존 자산에 연결」(§5.12 v4.3의 배정). 변경 계약 수는 13 그대로다 |
| 4.3 | 2026-09-24 | 민서 | **§4.10 외부 조회 신설 — 상품 조건 불러오기(DOC-001 S-12). §1.1·§1.2·§4.9·§5.10·§5.12 보충, §9에 AQ-73·74 신설. 변경 계약 수는 13 그대로다. 본 버전은 선행 명세다.** **(1) ★ 조회 계약이 아니다** — DB를 읽지 않으므로 `Queries` 묶음과 무효화 축 밖에 둔다. 넣으면 `_queryAxisIsExhaustive`가 가짜 `affects`를 요구한다. 대신 규칙 X-01~06을 세웠다. **X-02가 Q-06과 반대 방향인 이유**를 적었다 — 조회 계약은 잘린 목록을 옳은 것처럼 보이지 않으려고 던지고, 외부 조회는 원천 장애가 **수동 등록 화면까지** 죽이지 않도록 값을 돌려준다. **(2) X-01은 순서 규칙이다** — 외부 조회는 세션이 필요 없으므로 앞선 `getQueries()`가 유일한 문지기다. **(3) §4.9 `AssetOption.providerSymbols`** — 불러온 기초자산을 앱 자산과 **심볼로** 잇는 데 필요하다. 이름으로 잇지 않는다(사용자가 쓴 이름이다). **(4) §5.10·§5.12를 SCR-204 불러오기에도 배정했다** — 둘을 순서대로 부르며 원자적이지 않다. 중간 상태(자산은 있고 매핑이 없다)가 곧 **미매핑 자산**이고 ADR-007이 그것을 정상 상태로 정했으므로 14번째 계약(RPC)을 만들지 않는다(AQ-74). **(5) §8의 외부 조회 칸은 이 버전에서 쓰지 않는다** — §8은 코드 원장과 양방향으로 대조되므로(`tests/app/invalidation.test.ts`) 이름을 먼저 적으면 그 커밋이 빨간불이다. 원장과 같은 커밋에서 올린다(DOC-005 v1.1이 코드에 묶인 표에 대해 내린 판단과 같다) |
| 4.2 | 2026-09-24 | 민서 | **§5.1·§5.2 — 평가일이 차수별 입력값이 된 것을 계약 쪽에 적는다. 서명·검증 규칙 변경 0, `src/` 0줄. 본 버전은 선행 명세다.** 선행은 DOC-002 v1.6·DOC-008 v2.8이다. **(1) `ProductInput.schedules[].evaluationDate`는 원래 입력이었다** — 서명이 그것을 받았고 V-07(형식·증가·발행일 이상)이 칸 단위 키로 검사했다. 달라진 것은 **값의 출처**다: 종전에는 파서가 산식으로 만들어 넣었고 이제는 칸의 값이다. 산식으로 빈 칸을 채우는 것은 **입력 계층의 일**이며 계약은 날짜만 받는다 — 배리어 일괄 입력의 파싱이 입력 계층에 있는 것(§5.1 동작 셋째 줄)과 같은 자리다. **(2) ★ §5.2 전체 교체가 평가일을 보존하는 근거를 바꿨다.** 종전(DOC-002 v0.9)에는 「재생성이 멱등」이었고, 이제는 **수정 폼이 저장값을 싣는다**(`productValuesOf`). 계약 쪽 예외는 두지 않는다 — 교체는 여전히 전체 교체이고, 교체되는 값이 이전과 같을 뿐이다. **(3) 부수 효과 — V-07 오류가 칸에 붙는다.** 종전에는 짝지을 칸이 없어 `schedules[i].evaluationDate` 오류가 상단 요약으로 밀렸다 |
| 4.1 | 2026-09-14 | 민서 | **§4.3 `schedules[].expectedGross`의 타입 드리프트를 정정한다. 계약 변경이 아니라 «문서가 구현을 따라잡는» 정정이며 `src/` 0줄이다.** 문서는 `string`인데 구현은 **`string | null`**이다(`src/lib/db/queries/map.ts:706·L825`). `null`의 뜻은 「연쿠폰율이 없어 산출할 수 없다」이고 `expectedGrossOf`가 그 규약을 **독블록으로 이미 적고 있었다**(D-07 기실현 등재 · 계약 밖 경로 AQ-14·AQ-65). ★ **조용했던 이유가 기록할 가치가 있다** — 같은 절의 `projection.expectedGross`는 진짜로 `string`이고(`projectionOf`가 `null`이면 `projection` 전체를 `null`로 낸다) **같은 이름이 한 절 안에서 두 타입을 갖는다.** 읽는 사람이 옆 필드를 보고 맞다고 판단하기 쉬운 형태다. **DOC-008 v2.7의 차수별 채움이 이 필드를 전 차수에서 읽으면서 드러났다** — 그 기능이 `null` 분기를 실제로 밟는 첫 소비자다. |
| 0.1 | 2026-07-26 | 민서 | 최초 작성 |
| 3.9 | 2026-08-07 | 민서 | **P5a 컷 5 후속 — §7.1 CR-07 각주의 절 참조를 정정한다. 계약 0줄.** 「그것이 §7.2의 `cron_runs`다」가 **이 문서의** §7.2를 가리키는데 그 절이 없다(§7의 하위는 §7.1 하나이고 다음 헤딩이 §8이다). 가리키려던 것은 **DOC-013 §7.2**이며, DOC-013 §7.1의 문장을 옮겨 적으면서 **문서 접두사가 빠졌다**(그쪽에서는 같은 문서 안이라 유효했다). 같은 문서의 다른 자리는 접두사를 붙여 쓴다. **★ 부류: 인용은 «출처 안에서 참인 표현»을 옮기므로 상대 참조가 함께 옮겨진다.** 3차 적대적 스윕이 찾았다 |
| 3.8 | 2026-08-07 | 민서 | **P5a 컷 5 — §7.1의 두 각주에서 ⓐ′로 거짓이 된 문장을 정정한다. 계약 0줄이다.** **(1) CR-07 각주의 「앞의 둘: … 호출자 판별」에서 그 근거를 철회했다(U-03).** 운영이 ⓐ′(배치가 민서 자신의 계정을 재사용)이므로 `actor_id`가 모든 행에서 같아 Cron·SCR-302 버튼·진단 `curl`을 **가르지 못한다.** DOC-002 §4.11이 v1.4에서 같은 철회를 적었는데 이 문서가 따라오지 않아 **두 문서가 같은 테이블의 근거 수를 다르게 서술**하고 있었다. **근거 ①·③은 온전하므로 「세 번째 독립 근거」라는 이 각주의 결론은 그대로 서고 `cron_runs`도 정당하다.** **(2) CR-08 각주의 「배치가 «전용» GoTrue 서비스 계정을 가지므로」에서 «전용»을 뺐다.** 하중을 지는 것은 **세션을 얻는다**는 사실이고 그 계정이 새것인지 기존 것인지는 미러 소멸과 무관하다 — 결론은 한 글자도 바뀌지 않는다. **(3) ★ 이 둘을 «적대적 스윕»이 찾았다.** 컷 5의 첫 편집에서 나는 DOC-002·DOC-013·코드·테스트를 고치고 **DOC-011을 빠뜨렸다.** 6개 에이전트가 저장소를 훑고 후보마다 별도 에이전트가 반증을 시도해 **13건 확인·17건 기각**했으며 그중 둘이 이 문서였다. **부류: 결정이 바뀔 때 그 결정을 «인용»한 문서가 따라오지 않는다** — 원장이 둘일 때 한쪽만 갱신되는 형태(컷 4의 §7 권한 표)와 같고, 다른 점은 여기서는 **인용의 방향이 문서 → 문서**라 어떤 테스트도 대조하지 않는다는 것이다 |
| 3.7 | 2026-08-05 | 민서 | **P5a 컷 3 — §7.1 CR-08 각주를 정정하고(미러 소멸) §5.8 각주에 등재 사실을 적고 AQ-31을 종결한다.** **(1) ★ CR-08의 전제가 «사라졌다»(U-03, 취소선).** 종전 문언은 「Route Handler는 세션이 없어 §5.8을 호출할 수 없으므로 구조적 분기가 실재한다 → 셋을 모두 미러한다」였고, **AQ-57 = ⓐ(전용 GoTrue 서비스 계정)가 그 「세션이 없다」를 없앴다.** 그래서 미러가 0이 되고 `tests/app/cron.decide.test.ts`의 「글자까지 같다」 대조 블록을 **지웠다** — 그것은 검증을 줄인 것이 아니라 **갈릴 수 있는 두 벌이 없어진 것**이다. **(2) ★★ 그런데 「라우트가 §5.8을 호출한다」도 정확하지 않고 그 차이가 설계다.** 두 반환의 필드 집합이 갈리므로(`assetName` vs `executedAt`·`targetCount`) 한쪽이 다른 쪽을 부를 수 없다 — v3.5가 「공통 코어의 두 투영」이라 적은 것이 이제 **코드의 층**이 되었고 그 넷을 표로 적었다(`cron/collect.ts` 순수 · `mutations/collect.ts` 포트+`collectAndRecord` · `cron/report.ts` 투영 둘 · `cron/respond.ts` 사상). **결과로 사전 판정이 넷 → 셋이 됐다**(CR-06·CR-01·CR-10). CR-07·CR-08은 판정이 아니라 **사상**이며 `tests/cron/respond.test.ts`가 전수로 본다. **(3) §5.8의 세 번째 갈래가 «도달 불가»가 됐다** — 등재와 수집기가 같은 컷에 왔기 때문이다(R-05). 컷 1이 어댑터를 세우고도 등재하지 않은 이유가 그것이었음을 각주에 적었다. **(4) AQ-31 종결.** 셋을 같은 커밋에 세웠고, ⓐ가 **상시 스위트**에 있는 것이 요점이다(순수 오케스트레이션이라 한 실행에서 일곱 갈래를 결정적으로 만든다). ⓒ는 3방향이 아니라 **둘**이 되었다(CR-10이 사전 판정으로 갈라졌다). **계약의 서명·필드는 0줄 바뀌었다** — v3.5·v3.6이 이미 정해 두었기 때문이며 그것이 문서 선행의 값이다 |
| 4.0 | 2026-08-07 | 민서 | **§4.0의 왕복 경고에서 «조건»만 이동한다 — 계약은 한 줄도 바뀌지 않는다.** 선행은 DOC-008 v2.6(소유자 필터의 기본값을 「본인」으로)이다. **(1) 「소유자 필터가 «걸리면» 두 번 부른다」가 「기본 화면부터 두 번」이 됐다** — 두 번 부르지 «않는» 경우가 이제 사용자가 소유자를 **「전체」로 고른** 주소뿐이며 그것이 예외 경로다. SCR-201도 같은 형태다(`listProducts` 2 → 4). **(2) ★ 계약을 고치지 않는 것이 이 판의 요점이다** — `params.ownerId`가 선택 필드인 것도, Q-05가 그것을 「열 조건이므로 질의로 내린다」로 분류한 것도 그대로다. 바뀐 것은 **화면이 그 파라미터를 언제 채우는가**뿐이므로, 정정 대상은 §4의 타입이 아니라 **§4.0 각주의 조건절**이다. 계약 변경 0 · 마이그레이션 0. **(3) 이 문서에 「기본값」을 적지 않는다** — 화면의 기본값은 DOC-008이 정본이고 여기에 사본을 두면 둘이 갈리는 날 어느 쪽이 정본인지 말할 것이 없다. 그래서 각주는 **사실(항상 두 번)**만 적고 근거는 DOC-008 §5 SCR-201 ★★ ⓐ로 넘긴다 |
| 3.6 | 2026-08-05 | 민서 | **P5a 컷 2b — §5.12 신설(계약 12 → 13) · §4.5에 `providerSymbols` · §6에 V-21. 매핑 화면이 섰다.** **(1) ★ 계약을 «하나»로 뒀다 — `deleteProviderSymbol`을 만들지 않는다.** `providerSymbol: null`이 해제이며 §5.9 `setKiTouched`가 같은 형태의 선례다(좌표가 하나이고 화면의 조작도 하나다). 둘로 쪼개면 계약 수가 14가 되고 `MutationName`을 세는 원장이 «두 번» 움직인다. 삭제가 **필요**한 것은 `UNIQUE(asset_id, provider)` 때문이다 — 그 제약 아래에서 UPDATE로는 매핑을 없앨 수 없다. **(2) 해제에 `requireAffected`를 걸지 않는다** — 없는 행을 지우는 요청은 0행이고 그것은 **성공**이다(§5.9가 노낙인 상품의 `null` 터치를 허용한 것과 같은 판단). 걸면 두 번 누르는 것이 오류가 되고 그 오류에는 사용자가 고칠 것이 없다. e2e가 그 성질을 케이스로 갖는다. **(3) ★★ V-21 신설 — `provider`의 «소속»을 본다.** 열이 `varchar(30)`이라 아무 문자열이나 저장되는데, 어느 수집기도 모르는 값은 그 매핑을 **영구히 쓰이지 않는 행**으로 만든다 — 화면은 「자동 수집됨」으로 읽히고 수집은 되지 않으며 `unmapped`도 세지 않는다. **오타 하나가 만드는 조용한 상태**다. 반대로 `provider_symbol`의 **내용은 검증하지 않는다** — 없는 코드는 공급자가 0건으로 답해 `NO_DATA`(→ 매핑을 고친다)가 되며 DQ-02가 그 경로를 이미 설계했다. **소속은 우리가 알고 내용은 공급자가 안다.** **(4) ★★★ 대조 대상이 «수집 레지스트리»가 아니라 «전체 명부»다**(`KNOWN_PROVIDER_IDS`). 컷 1이 어댑터를 세웠으나 등재하지 않았으므로(수집기가 없어 CR-08이 된다) 레지스트리를 보면 **이 화면이 컷 3까지 아무 값도 저장할 수 없다.** 전체 명부를 보면 매핑을 미리 넣어 둘 수 있고 **수집기가 첫 실행부터 대상을 갖는다** — 그 분리가 컷 2b를 컷 3보다 먼저 쓸모 있게 만든다. **(5) §4.5는 조회를 «넓히지 않는다»** — 임베드이므로 왕복이 그대로다. `contracts.test.ts`의 왕복 예산 `{assets:1, els_products:1}`과 `total = 2`가 **무변화임을 실측**했다(그 단언이 `listAssetPrices`를 실제로 덮는지 확인한 뒤에 그렇게 적는다). 자식에 `limit`을 걸지 않는 근거는 매핑 수가 공급자 수만큼이고 그 수를 코드가 정한다는 것이다 — 절단이 구조적으로 불가능하다. **(6) ★★★★ 구현 중 잡힌 결함 둘을 적어 둔다.** ⓐ **V-21이 조용히 사라졌다** — `V21_knownProvider`는 `provider`가 «있는데 소속이 틀린» 경우를 기록하므로 파서가 객체를 돌려주는데, 계약이 `parsed == null`만 검사해 **위반이 남은 채 저장이 진행됐다.** e2e가 잡았고 `!p.isEmpty`를 함께 본다. **부류: 검증을 추가했으나 그 결과를 반환하는 줄을 빠뜨렸다.** ⓑ **공유 타입에 한쪽 경로의 필드를 얹었다** — `AssetWithPricesRow`를 `loadLatestPrices`가 공유하는데 그쪽은 임베드하지 않으면서 셰이프를 단언하므로 **거짓 타입**이 됐다(읽는 코드가 없어 전부 초록). 타입을 갈랐다. **(7) `hasPriceProvider`의 `true` 갈래가 «처음» 실행됐다** — `asset_provider_symbols`가 저장소 전체에서 비어 있었기 때문에 그 파생값은 항상 `false`였다. 픽스처 하나를 심으니 §4.9의 단언이 뒤집혔고, 반대 갈래도 나란히 두어 파생이 실제로 «가른다»를 고정했다. **(8) 형식 검사가 조용히 통과하고 있었다** — `formats.test.ts`는 «관측된 잎»을 기준으로 대조하므로 배열이 항상 비면 잎이 0개이고 미분류에 걸리지 않는다. **분류와 픽스처는 함께 와야 한다.** 스위트 1071 · 233 · 154 |
| 3.5 | 2026-08-05 | 민서 | **P5a 컷 0 — §7.1에 CR-10 신설, `CronResult`·§5.8에 `unmapped`·`skipped` 신설, AQ-31(b) 문언 정정. 문서 선행이며 `src/` 0줄이다.** **(1) ★ CR-10 신설 — 「공급자가 없다」와 「공급자의 열쇠가 없다」는 다른 상태다.** 어느 문서도 이 갈래를 답하지 않았고, 공급자가 자격증명을 요구하는 순간(P5a) 같은 부류의 결함이 **두 번째 변수**에서 생긴다. 503으로 답하면 사용자가 「수동 입력으로 갱신한다」를 듣는데 **공급자는 등록되어 있고 고칠 것은 환경변수 하나**이며, 200 + 전부 `CALL_FAILED`는 더 나쁘다(「기다린다」인데 기다려서 해결되지 않고 `isStale`이 5일 뒤 **틀린 진단**과 함께 뜬다). **근거는 CR-06의 것을 그대로 옮긴 것**이고 대칭도 맞는다 — 두 비밀의 부재가 같은 부류의 배포 결함이다. **판정 순서를 규칙으로 못박았다(CR-07 → CR-10)** — 공급자가 0개면 열쇠를 물을 대상이 없다. ★★ 그리고 이 규칙이 **「레지스트리를 자격증명으로 세지 않는다」를 전제**함을 적었다: 키 없는 공급자를 명부에서 빼면 CR-10이 도달 불가가 되고 CR-07이 설정 결함을 흡수하는데, 그것은 **관측되는 상태가 의도된 상태와 똑같아지는** 절대 규칙 #6의 fail-open 형태다. **CR-04 ⓒ를 구하지는 못한다**는 것도 함께 적었다(v2.8이 이미 그 부류를 배제했다 — `cron_runs`의 세 번째 근거는 온전하다). 구현은 P5a 컷 3이며 그때까지 `tests/app/cron.decide.test.ts`의 `NOT_A_VERDICT`에 사유와 함께 등재된다. **(2) ★ `CronResult.unmapped` 신설 — 없으면 수가 맞지 않거나 결함이 보이지 않는다.** 미매핑 자산은 ADR-007이 「설계된 정상 경로」로 못박았으므로 `failed[]`에 담으면 정상 상태가 매일 오류로 보고되고(ST-03 위반), `targetCount`에서 빼면 **매핑이 지워진 것이 보이지 않는다**(대상이 조용히 줄고 카운터는 전부 초록 — 절대 규칙 #6의 형태이며 **줄어드는 객체가 「매핑 행」**이다). 세어야 불변식 `targetCount === succeeded + skipped + unmapped + failed.length`를 값으로 단언할 수 있고, **이 숫자가 DOC-008 SQ-08 표식의 데이터 원천**이다. `failed[].failure`도 함께 실었다 — 부류가 `reason` 문구 안에만 있으면 화면이 **문구를 파싱**해야 두 조치를 갈라 표시하므로, ADR-004 보정이 판별 가능한 값으로 만든 것이 계약 경계에서 다시 접힌다. **(3) §5.8에 `skipped`·`unmapped` 신설 — CR-05 뒤집기가 만든 UX 결함이다.** `{succeeded, failed}`로는 「이미 최신이다」와 「아무 일도 하지 못했다」가 **구별되지 않고**(둘 다 `succeeded: 0, failed: []`), 배치가 14:00에 돌고 사용자가 그 뒤에 누르는 것이 **흔한 경우**이므로 화면이 「0건」을 말한다 — **정상적으로 최신인 상태가 고장으로 읽힌다.** 그리고 필드 집합이 갈려 있으면 「7장의 배치와 동일 로직」이 반환에서 참이 아니게 된다. 두 계약에 남는 차이(`executedAt`·`targetCount` vs `assetName`)는 **의도**이며 한쪽이 다른 쪽의 부분집합이 아니라 **공통 코어의 두 투영**임을 적었다. **(4) ★ AQ-31(b) 문언 정정 — 종전 문언이 항진명제다.** 「`source='AUTO'` **UPSERT**가 I-16을 통과한다」는 CR-05가 「자동값 우선」이던 시절의 것이고, **v2.7이 뒤집으면서 배치가 UPDATE를 하지 않게 됐다**(DOC-010 AQ-11이 그 사실을 이미 적었다). I-16은 `BEFORE UPDATE` 트리거이므로 **INSERT만 하는 배치는 그 트리거에 닿지 않고**, 그 케이스는 무엇을 하든 초록이다. 대체 명제 셋(기존 `MANUAL` 행 보존 · `23505` → `skipped` · 음성 대조로 좌표 UPDATE는 여전히 `23514`)이 실제로 걸리는 것들이며, 그 셋은 **I-16이 살아 있음과 배치가 그것을 필요로 하지 않음을 함께** 증명한다. 취소선으로 남긴다(U-03) |
| 3.3 | 2026-08-01 | 민서 | **P6 컷 6 — §4.4 `ScheduleItem`에 상품 단위 넷과 `proceeds` 신설. §8.1의 일곱째 사례이며 부류는 D다. 본 버전은 선행 명세다.** (1) **다섯이 없어서 SCR-301 상품별 카드를 만들 수 없었다** — 원금·연쿠폰율·계좌유형·전체 차수·차수별 금액. **D 부류가 두 번째이고 그것이 요점이다**: 컷 9의 여섯째 뒤에 만든 「요소 ↔ 뷰 필드」 대조가 **SCR-101에만 있고**, 이 절의 마지막 문단이 「나머지 화면에는 없다 — AQ-35로 등재한다」고 적었는데 **그 등재된 공백에서 정확히 일곱째가 나왔다.** 그래서 재발 방지는 §4.4를 고치는 것이 아니라 AQ-35의 네 번째 자리에 SCR-301을 놓고 DOC-008 §5의 「항목 표시」를 두 행으로 가르는 것이다(SCR-201 v1.9와 같은 형태). (2) **★ 상품 쪽 넷은 조회를 넓히지 않는다** — `PRODUCT_SELECT`가 이미 싣고 판정이 쓰는 값을 **매퍼가 읽고 버렸다.** §4.2 v3.1의 `terms`와 같은 근거이며 select 변경 0·마이그레이션 0이다. 새로 드는 것은 **세율 한 왕복뿐**이고(§4.0 표를 2→3으로 고쳤다) **물결은 둘 그대로다** — `loadAllTaxYears`가 `ctx`에만 의존해 첫 물결에 합류한다(`getDashboard`·`getForecast`가 같은 형태). (3) **★ 세율 연도를 «기준일의 연도» 하나로 못박았다 — 차수의 귀속연도가 아니다.** 차수별로 풀면 `resolveTaxYear`가 시드 이전 연도를 **거부**하므로 2025년 평가일을 가진 상품 하나가 **SCR-301을 전원에게 500으로 만든다**(모든 SELECT 정책이 `using (true)`이므로 §8.2가 기록한 부류다). 그 데이터는 지금 만들 수 있다 — 발행일에 하한이 없고 기실현 등재는 과거 이력을 옮기는 화면이다. `year(asOf)`로 두면 그 분기가 **구조적으로 도달 불가**가 된다. **`resolveTaxYear`를 고쳐서 풀지 않는다** — 그 거부는 신고 산출값에 대해 옳고 §4.6·§5.4가 의존한다. 값이 아니라 **호출 인자**를 바꾼다. 지금은 시드가 2026뿐이라 이 선택이 숫자를 바꾸지도 않는다 — **차수별 해석이 사는 것은 크래시뿐이다**(DOC-010 AQ-66). (4) **★ 화면이 뺄 수 있는 값도 계약에 둔다.** `expectedPnl`은 `expectedGross − principal`이지만 `page.tsx`가 어떤 스위트의 import 그래프에도 없으므로(AQ-23) 그 뺄셈의 옳음과 §4.3 `projection`과의 일치를 **아무도 대조하지 않는다.** `barrierGap`이 두 값을 받는 형태로 있는 이유(「화면에서 뺄셈이 일어나지 않게」)가 그대로 적용된다. `expectedNet`은 합성조차 불가능하다 — 세율이 DB에 있고 순수 모듈은 상수를 인자로만 받는다(절대 규칙 #3·#5). 그래서 `expectedWithholding`과 `separateTaxationRate`도 함께 싣는다: 전자가 없으면 화면이 `세전 − 세후`를 계산하고, 후자가 없으면 화면 고지가 「15.4%」를 하드코딩하게 된다. **세율이 값과 함께 이동하므로 둘이 갈릴 수 없다.** (5) **`proceeds`를 묶음으로 둔 이유** — 독립 nullable 다섯이면 「넷은 있고 하나만 없다」가 타입상 표현 가능해지는데 그 조합은 실재하지 않는다. §4.3의 `projection: {…} | null`과 같은 형태다. (6) **★ 상품별 «보기»가 생겨도 계약의 루트를 상품으로 바꾸지 않았다.** 바꾸면 `from`·`to`가 임베드 필터가 되고 v0.7이 적은 함정(적용 차수가 **잘린 일정 집합**에서 승격되어 `conditionResult`가 엉뚱한 차수에 그럴싸하게 붙는다)이 되살아난다. **묶는 것은 화면의 순수 함수(`groupByProduct`)이고 계약의 형태가 아니다** — 그래야 두 보기가 같은 계약·같은 필터·같은 판정을 공유하고 묶는 규칙이 상시 스위트에 보인다. (7) **억제 규칙이 다섯에 미치지 않는다** — 결함 상품도 계약 조건은 온전하고 이 값들은 시세를 하나도 쓰지 않으며, 상환 완료도 같다. §4.3이 v0.6에서 정확히 이 실수를 했고 **v0.8이 되돌렸다**(원인의 범위를 넘어 억제하면 같은 상품이 §4.6에서는 과세에 기여하면서 여기서만 값을 잃는다). **억제는 화면의 일이다.** (8) **`totalRounds`가 필요한 이유는 기간 필터다** — 6차수 중 3~4차만 남으면 카드가 「3차부터 시작하는 상품」으로 읽힌다. 화면이 `max(roundNo)`로 합성하면 4가 나와 틀리므로 정본은 **행 수**다(§4.3의 같은 규약). `activeOnly`는 부모 조건이라 상품을 통째로 빼며, 한 상품의 차수를 **부분적으로** 자를 수 있는 것은 기간 조건뿐이다 |
| 3.4 | 2026-08-01 | 민서 | **P6 컷 7 — §4.2 `underlyingPrices` · §4.4 기초자산·KI 신설. 조회 넓힘 0 · 왕복 증가 0.** 선행은 DOC-008 v2.3이다. **(1) 두 계약 모두 시세를 «이미» 읽고 있었다.** §4.2는 `loadLatestPrices`로 워스트오브를 산출하고 §4.4는 같은 시세로 같은 판정을 하는데, **두 매퍼가 자산별 값을 접은 뒤 버렸다** — v3.1이 `terms`에 대해 쓴 근거(「조회를 넓히는 것이 아니라 이미 온 것을 노출한다」)와 같은 형태이며 select 변경 0·마이그레이션 0이다. **(2) ★★ §4.2에서 `terms` 안에 넣지 «않았다».** 그 필드는 「판정값이 아니다」가 정의이고 `termsOf(row)`가 **인자로 `prices`를 받지 않는 것**이 그 사실의 구조적 형태다(같은 상품에 기준일과 무관하게 같은 값을 낸다 — `tests/db/map.test.ts`가 그 성질을 단언한다). 무엇보다 D1 표의 첫 행이 `worstOf`·**`ratio`**·**`isWorst`**를 한 줄에 묶어 `UNDERLYING_MISSING`에서 억제한다고 규정하므로, 그 둘을 `terms`에 넣으면 **「D1이 이쪽에 미치지 않는다」가 거짓이 된다.** 그래서 `underlyingPrices`는 **형제 필드**이고 `assetId`로 짝을 이룬다 — 그 키를 위해 `terms.underlyings`에 `assetId`가 하나 늘었다. **(3) 이름·기준가를 사본으로 싣지 않는다.** 형제 필드는 관측 셋(`currentPrice`·`ratio`·`isWorst`)만 담는다. 실으면 같은 값이 한 뷰에 두 번 있게 되고, 둘이 갈리는 날 어느 쪽이 정본인지 말할 것이 없다. 화면이 둘을 합치는 일은 순수 함수(`underlyingLines`)가 하고 그 판단은 상시 스위트가 본다(AQ-23 — 화면은 어떤 스위트의 import 그래프에도 없다). **(4) §4.4는 «합쳐서» 담는다 — 비대칭이지만 근거가 있다.** `ScheduleItem`에는 계약/판정을 가르는 축이 애초에 없다(`barrier`는 계약이고 `worstOf`는 판정인데 한 평면에 있다). 축이 없는 뷰에 축을 만들면 `assetId` 짝짓기가 **아무것도 지키지 않는 채로** 화면에 노출된다. 대신 §4.2가 쓰는 것과 **같은 순수 함수의 출력 타입**을 담으므로 두 화면의 렌더러가 하나다. **(5) `isWorst`의 정의가 §4.3과 같다** — 동률이면 전부 참, 워스트오브를 산출할 수 없으면 전부 거짓. 세 뷰가 같은 `judge()`의 같은 `worstOf`와 대조하므로 갈릴 수 없다. **(6) 억제** — `UNDERLYING_MISSING`이면 기초자산이 0종이라 배열이 비고, E-01(시세 하나 없음)이면 그 자산만 `currentPrice = null`이며 `isWorst`는 **전부 거짓**이 된다(워스트오브가 `null`이므로). 후자가 §4.2 우선순위표의 3순위를 자산 단위로 분해한 값이다 |
| 3.2 | 2026-08-01 | 민서 | **P6 컷 5 — §5.11 `createRealizedProduct` 신설(열두 번째 변경 계약). §4.2에 셋째 억제 축.** 선행은 DOC-002 v1.0 `entry_mode`다. **(1) 계약이 열둘이 됐다.** 상품 1건 + 상환 1건을 **쓰기 함수 하나로** 만든다 — 요청 둘로 나누면 부분 실패가 「`REALIZED_ONLY`인데 상환이 없는 상품」을 남기고, §5.1의 잔해(기초자산 0건)와 달리 그것은 **`entry_mode`만 보는 조회 계층에서 정상으로 읽힌다.** **(2) ★★ §4.2에 셋째 축을 명문화했고, 그 절의 초안 근거가 거짓이어서 정정했다.** 종전 두 축(`integrityIssue` · E-05)에 기실현 등재가 더해진다. 초안은 「억제는 결함 이름이 아니라 부재를 따라야 하고, 어기면 기초자산 0종에 워스트오브를 물어 빈 집합의 `min()`이 되므로 화면이 전원에게 죽는다」였고 **그것을 위해 조회 구현에 함수를 하나 더 두었다.** ★ **음성 대조가 그 근거를 반증했다** — 억제를 결함 이름에 되매단 구현으로 89건이 **전부 초록**이었다. 방어가 이미 셋이었다: `worstOfRow`가 0건을 **스스로** 가드하고 · `asActive`가 상환 완료에서 판정을 죽이고(E-05) · `attentionReasonsFor`가 `REDEEMED`에서 먼저 반환한다. 기실현 등재는 **정의상 항상 상환 완료**이므로 뒤의 둘이 언제나 걸린다. **그래서 그 함수를 철회하고 케이스를 남겼다** — 지켜야 하는 것은 세 겹의 **도달 가능성**이고 그것을 단언하는 층이 없었다(셋 중 하나가 사라지면 기실현 상품에 「시세 없음」이 붙어 ST-06을 어긴다). 음성 대조 둘이 그 케이스만 깨뜨림을 확인했다. **교훈: 없는 위험을 지키는 분기는 자기가 무엇을 막는지 말하면서 아무것도 막지 않으므로, 다음 사람이 그 문장을 근거로 다른 결정을 한다.** **(3) 축의 판정이 `entry_mode` 단독이 아니라 `entry_mode` ∧ 상환 존재다.** 상환을 취소한 기실현 상품은 계약 조건도 상환도 없으므로 **다시 결함이다** — `entry_mode`만 보면 판정 입력이 하나도 없는 보유중 상품이 정상으로 읽힌다. **(4) `null`의 원인 표에 순위를 추가하지 않았다** — 기실현 등재는 정의상 항상 상환 완료이므로 2순위(E-05)가 정확히 그 상품을 설명한다(「판정 생략 — 표시값은 상환 실적이다」). **(5) §6에 V-id를 신설하지 않았다.** V-10(상환일 ≥ 발행일)은 비교 대상이 없고 V-13(조기·리자드는 차수 필수)은 입력에 `roundNo`가 없어 **위반이 표현 불가**다 — 예외를 「두는」 것이 아니라 입력의 형태가 전제를 없앤다(§5.4 v1.7과 같은 판단). **(6) §3.2.1 제약 이름 표 두 줄** — `redemptions_round_no_required_check` → **`redemptions_round_no_required`**(I-14가 트리거로 내려가며 교차 행 규칙이 되었고 접미사가 그 부류를 말한다. 계약 계층의 처리는 두 접미사에서 같아 화면 동작 불변) · `els_products_full_terms_check` 신설(I-18). **(7) 수정 경로를 열지 않았다** — 만들어진 상품은 즉시 상환 완료라 `els_products_redeemed_immutable`이 §5.2를 막는다. 상품명·투자원금·계좌유형을 고치는 경로는 **없고**, 계좌유형이 세액을 가르므로(DOC-007 §4.3) 조용히 고칠 수 있게 두지 않는 편이 낫다 |
| 3.1 | 2026-08-01 | 민서 | **P6 컷 2 — §4.2 `ProductListItem`에 `terms`(계약 조건)를 신설한다. 조회 넓힘 0.** **(1) ★★ 왕복이 늘지 않는다 — 그것이 이 확장의 근거다.** `loadProducts`의 `PRODUCT_SELECT`가 **이미** `els_underlyings(+assets)`·`redemption_schedules`를 임베드한다(상품 + 하위 전부, 1 왕복). 판정 삼종이 그 데이터를 쓰기 때문이며 v3.0까지 매퍼가 **그것을 읽고 버렸다.** 즉 이 확장은 조회를 넓히는 것이 아니라 **이미 온 것을 노출하는 것**이다 — select 변경 0, 왕복 증가 0, 마이그레이션 0. **(2) 이름이 구분을 나른다** — 나머지 필드는 대부분 판정의 결과이고(`status`·`worstOf`·`conditionResult`·`kiStatus`) `terms`는 사용자가 입력한 계약 그대로다. **억제 규칙(D1)이 이쪽에는 미치지 않는다**: 결함 상품도 계약 조건은 있다. **(3) ★ `getProduct`의 하위 형태를 재사용하지 않는다.** 상세의 `underlyings`는 `currentPrice`·`ratio`·`isWorst`를, `schedules`는 `expectedGross`·`conditionResult`·`isPast`를 담고 **전부 차수별 판정**이다 — 목록이 요구하지 않는다. 같은 형태를 쓰면 목록이 쓰지 않는 값을 계산하게 되고, 무엇보다 「목록은 계약 조건 · 상세는 판정」이라는 구분이 타입에서 사라진다. 좁은 형태를 따로 두는 것이 그 구분이다. **(4) 금액·비율은 문자열이다**(§4.0 Q-08) — `basePrice`는 `numeric(18,6)`, 비율은 `numeric(6,4)`의 `::text`이며 화면이 `priceDisplay`·`percent`로 표시만 바꾼다. 파라미터·필터·정렬·§8 매트릭스는 불변이다 |
| 3.0 | 2026-07-31 | 민서 | **P6 컷 1 — §9에 AQ-63을 신설한다. 계약면은 한 줄도 바뀌지 않았다** — `createProduct`·`updateProduct`의 입력·동작·권한, §5.2의 전체 교체, §6의 V-01~V-20, §8의 추적 매트릭스가 전부 그대로다(같은 컷이 SCR-204를 단일 페이지로 바꿨으나 그것은 **입력 경로**이고 계약이 아니다). **AQ-63 — V-03이 구조적으로 발동 불가다.** §6의 V-03이 `schedules.length`와 `totalRounds`를 비교하는데 화면의 파서가 **양쪽을 같은 칸에서 파생시키므로**(차수 행 루프의 상한이 곧 `totalRounds`다) **1~60 전 구간에서 항등**이고, 발화하는 것은 60 초과·0·비수치뿐인데 **그것들은 V-20이 이미 잡는다.** ★ **파급이 문서에 있었다는 것이 이 등재의 실질이다** — DOC-008 §5 SQ-04 각주가 배리어 auto-fill의 안전망으로 이 규칙을 명시적으로 인용했고(「V-03이 저장 시점에 같은 사실을 오류로 말한다」) **그 문장이 거짓이었다.** 즉 화면이 존재하지 않는 backstop을 근거로 auto-fill을 허용하고 있었다. DOC-008 v1.8에서 취소선으로 정정했다. ★★ **더 조용한 변종**: 총 차수가 비어 있으면 일괄 적용이 토큰 개수를 총 차수로 삼으므로 6차수 상품에 배리어 5개를 붙이면 **불일치 분기가 발화할 수 없고**(`rounds === tokens.length`) 경고 0으로 5차수 상품이 저장된다 — 6번째 평가일이 존재하지 않고 화면에 그 사실을 말할 자리가 없다. **고치지 않은 것은 범위 판단이다**(이번 컷은 평가일 규약과 단일 페이지화 둘이고 이 항목은 그 둘에 딸려오지 않는다). 종결 후보 둘을 §9에 적었고 그중 「빈 차수를 차수표에 지속되는 표식으로 남긴다」가 값이 크고 싸다 | **P5b 컷 9(P5b.5) — 「판단 시점 P5」 재배정과 표식 정정. 설계 변경은 없다.** §7.1의 플랫폼 인용 셋(`GET` 강제 · best-effort 배달 · 로그 보존 1시간 · 3xx 미기록)의 표식을 **「실측」에서 「인용」으로** 고쳤다. 출처가 `vercel.com/docs`이고 **재보지 않았다** — DOC-013 §1.2가 두 낱말을 가른 뒤 그 구분을 여기에도 적용한다. **정본은 DOC-013 §6.1**이며 여기는 사본이다. 계약 변경은 없다 |
| 2.8 | 2026-07-30 | 민서 | **P5b 컷 4 취소 — §7.1 CR-07 각주의 문장 하나를 정정했다. 계약 변경은 없다.** 종전 문언은 「503은 Vercel Cron 설정 화면의 마지막 실행 상태로 남으므로 **CR-04 ⓒ의 유일한 실행 경로**이기도 하다」였다. **절반이 미검증이고 절반이 곧 거짓이 된다.** **(1) 앞 절반은 미실측이다** — 그 화면이 503을 「실패」로 표시하는지도 보존 정책도 확인하지 않았고, 확인할 컷(P5b 컷 4)이 Vercel 토큰 미발급으로 취소됐다(원장 DOC-013 §6.5). **(2) ★★ 뒤 절반은 P5a가 착지하는 순간 거짓이 된다** — `providerCount > 0`이면 CR-07 갈래가 **도달 불가**이고, 남는 비2xx는 CR-06 하나인데 그것은 **실제 배포 결함**이라 관측용으로 만들 대상이 아니며 **CR-02가 부분 실패를 200으로 답한다.** 즉 **CR-04 ⓒ의 실행 경로가 0이 된다.** **무거운 이유:** v2.7이 CR-04를 「배포 첫날부터 사문화」에서 구한 논거가 **세 갈래 모두 살아 있는 수단을 갖는다**였고, **컷 4 취소 + P5a 착지가 겹치면 그 셋째 행이 무효가 되어 CR-04가 재정의 이전으로 절반 돌아간다.** DOC-013 §6.5의 대체 관측은 ⓐ(감지)만 강화하고 ⓒ를 복구하지 못한다. **(3) 종결 후보는 §7.2의 `cron_runs`이며 이 정정이 그 테이블의 *세 번째* 독립 근거다**(앞의 둘 — 지나간 중간 실패의 사후 진단 · 호출자 판별). **P5a 착지 전에 정해야 한다** — 후에 정하면 그 사이의 실행이 관측되지 않는다 |
| 2.7 | 2026-07-29 | 민서 | **P5b 컷 0 — §7.1을 전면 정정했다. 배포가 명세의 결함 넷을 드러냈고 그중 둘은 플랫폼이 강제했다.** (1) **`POST` → `GET`(U-03).** 실측 — 「To trigger a cron job, Vercel makes an HTTP **GET** request to your project's **production deployment** URL」. `POST`로 정의하면 Cron이 이 경로를 **부를 수 없다.** 플랫폼 강제이므로 설계 변경이 아니며, 부수 사실 둘이 함께 확정됐다(타임존은 **항상 UTC** · **production 배포만** 호출한다 → ADR-006의 `preview` 행이 애초에 성립하지 않았다). `GET`이 부수 효과를 갖는 예외를 정당화 셋과 함께 명시했다. (2) **CR-04 재정의(U-03).** 종전 문언(「결과를 로깅한다. 무음 실패를 만들지 않음」)이 **배포 첫날부터 사문화다** — Hobby 런타임 로그 보존이 **1시간**이고 Cron 정밀도가 **±59분**이라 일 1회 배치의 `console.log`는 다음에 볼 때 사라져 있고 「직후 확인」도 성립하지 않는다. 목적을 **감지**(SCR-302의 `isStale`·`as_of_date`·`source` — 영속적이고 **이미 구현돼 있다**)와 **진단**(멱등성을 이용한 재호출이 `CronResult`를 응답 본문으로 준다 — 보존과 무관)으로 갈랐고, **잔여를 적었다**: 재호출은 「지금」을 알려 주고 **「그때」를 알려 주지 않는다.** (3) **CR-05 뒤집기 — AQ-06 종결(U-03).** 종전 규칙(자동값 우선)과 같은 표의 `skipped`(「당일 데이터 이미 존재」)가 **양립하지 않아 둘 중 하나가 죽은 명세였다** — §8.1이 분류한 부류의 재발이다. `MANUAL`이 이긴다: 같은 `(asset_id, as_of_date)`에 행이 있으면 `source`와 무관하게 쓰지 않는다. 근거는 충돌이 **날짜 스코프라 영속하지 않는다**는 것이며, ★ **잘못된 `AUTO`의 정정 경로는 재수집이 아니라 §5.7**임을 함께 못박았다(적지 않으면 다음 사람이 skip 로직을 뚫는다). (4) **규칙 넷에 ID를 줬다 — CR-06·07·08·09.** 넷 다 v2.6에는 **어느 ID도 없었고** 그중 둘은 아예 표에 없었다. ID가 없으면 아무도 인용할 수 없고 그 표가 유일한 존재 장소가 된다. **CR-06**(`CRON_SECRET` 미설정 → **500, 401이 아니다** — 「비밀이 없다」와 「토큰이 틀리다」가 같게 보이면 조치가 갈리지 않는다. ST-06의 형태이며 **빈 문자열이면 `Bearer `로 시작하는 모든 헤더가 일치한다**는 점에서 특히 중요하다) · **CR-07**(공급자 0개 → **503**, 200 + 빈 결과가 아니다) · **CR-08**(공급자는 있으나 수집 로직이 없는 **세 번째 갈래**를 §5.8과 같은 판정으로 둔다 — 라우트는 세션이 없어 §5.8을 호출할 수 없으므로 구조적 분기가 실재하고, 둘만 미러하면 같은 상태가 UI에서 `INTERNAL`·cron에서 503이 된다) · **CR-09**(캐시 금지 헤더 3종 — v2.6까지 **코드 주석에만 있고 계약에 없었다.** `GET`이 되면서 위험이 두 배다: 캐시되면 배치가 조용히 안 돌고 **로그에도 남지 않는다**). (5) **`failed[].reason`을 두 부류로 갈랐다**(DQ-02 종결과 짝) — 「데이터 없음」/「호출 실패」이며 사용자의 조치가 다르다. **이 분류는 어댑터가 구분해 주지 않으면 만들 수 없으므로** ADR-004 보정의 판별 가능한 `failure` 값이 전제다. (6) **CR-03의 근거를 실측으로 교체했다** — 중복 실행 안전이 「있으면 좋은 성질」이 아니라 **플랫폼 성질**이다(Cron 배달은 best-effort로 누락도 중복도 가능하며 재시도가 없다). (7) **CR-02의 종단 관측이 P5a의 몫임을 명시했다** — 공급자 0개에서는 부분 실패가 **존재하지 않는다.** 적어 두지 않으면 P5b 뒤에 「CR-02도 검증됐다」로 읽힌다. **그리고 헤더 표의 버전 드리프트를 정정했다** — 표는 `2.4`를 적고 있었는데 변경 이력의 최신 행은 이미 `2.6`이었다(DOC-000 §1도 `2.6`이다). 계약 쪽 **코드 변경은 0줄**이다 |
| 2.6 | 2026-07-29 | 민서 | **P4b 컷 8 — SCR-402가 섰고 §8의 맵 상태 각주를 검산 결과로 갱신했다.** `/forecast`가 `PENDING_ROUTES`에서 `ROUTE_QUERIES: ['getForecast']`로 옮겨 가고 그 원장이 비었다. **v2.1이 예고한 「합성 대조가 자동으로 검산한다」가 그대로 일어났다** — 대리 기준이 옳았으므로 손으로 적은 `STALE_ROUTES`가 한 줄도 바뀌지 않았고, 그 근거인 「소속이 `getTaxSummary`와 같다」를 집합 동일성으로 박았다. **원장 셋이 전부 비었고 뒤의 둘을 같은 사실의 두 관측으로 적었다**(선언 ↔ 소스 실측) — 넷으로 세지 않는 것이 요점이며 그 일치 자체가 단언 대상이다. 계약 쪽 변경은 0줄이다 |
| 2.5 | 2026-07-29 | 민서 | **P4b 컷 7 — 아홉째 조회 계약을 세웠다. §4.1~§4.9가 전부 실재한다.** (1) **§4.0 왕복 표에 `getForecast \| 3` 한 줄** — 실측이며 코드 뒤에 왔다. 기본 여섯 연도인데 `getTaxSummary`와 **같은 수이고 같은 다중집합**(`{tax_years: 1, tax_profiles: 1, els_products: 1}`)이고 `years = 20`에서도 3이다. 두 이유가 각각 하나를 1로 묶는다 — `loadAllTaxYears` + 순수 `resolveTaxYear`의 연도별 재사용, 그리고 이월을 `.in(연도들)`이 아니라 `.lte(마지막 연도)` 한 번으로 받는 것. **연도마다 왕복하는 구현은 값이 옳으므로 이 표 말고는 어느 케이스에도 걸리지 않는다.** (2) **`FORECAST_MAX_YEARS = 20`을 §4.7에 배정했다** — v2.4가 이름만 정하고 값을 비워 두었고, 그대로 구현하면 코드가 조용히 정하게 되므로(AQ-08이 「코드에 기본값을 박는 순간 사실상 닫힌다」로 적은 형태) 구현 전에 문서에서 정했다. **그리고 그 수에 도메인 의미가 없다는 것을 함께 못 박았다** — 스키마에서 유도할 수 없고(V-20에 상한이 없어 만기가 무계다) AQ-08이 기본값 6에 준 근거는 「유용한 구간」의 근거이므로 상한의 근거가 아니다. 만족하는 조건은 둘뿐이다(기본값보다 크다 · 행 수가 렌더 위험이 될 수 없다). 나중에 이 수에서 의미를 읽지 않도록 각주가 그것을 명시한다. (3) **`profileFor`(이월)와 행 → 항목 사상을 순수 함수로 뗐다** — `resolveTaxYear`와 같은 이유다: 붙여 두면 「프로필이 아예 없는 사용자」·「2024년 것만 있는 사용자」를 만들려면 매번 DB를 세워야 하고 그 상태 중 일부는 커밋된 픽스처와 공존할 수 없다. **음성 대조를 함께 두었다** — 미래 연도 행을 고르지 않는 것과 입력 정렬에 의존하지 않는 것(질의의 `order`가 사라져도 같은 답). (4) **`loadTaxProfiles`가 `.lte()`인 이유를 독블록에 적었다** — 이월을 `.in()`으로 구현할 수 없다(전망 구간 **밖의** 과거 연도가 후보여야 한다). 그래서 행 수가 사용자가 저장한 연도 수만큼 늘어나므로 **Q-06 가드가 여기서는 의미가 있다.** 단수 `loadTaxProfile`은 남긴다 — `maybeSingle()`이 `(user_id, tax_year)` 유일성에 대한 DB 측 보장이다. (5) **`tests/app/forecast.test.ts`가 AQ-35의 두 번째 대조 축이다** — §5 SCR-402의 ①~⑫ ↔ `keyof ForecastRow`. 그 자리에 「파서가 열둘을 찾았다」를 두지 **않았다**: 위 `toEqual`에 완전히 함축되어 탐지력이 0이기 때문이다(SCR-101의 같은 자리가 그 형태다). 대신 **마커 ↔ 라벨의 짝짓기**를 대조한다 — P4 종료 대조 §5.1 ④가 「문서에서 ②와 ③의 문구를 맞바꾸면 그대로 통과한다」로 지목한, 실제로 검증되지 않던 성질이다. 실측으로 ⑧·⑪의 라벨을 맞바꿔 이 케이스만 빨간불이 되는 것을 확인했다 |
| 2.4 | 2026-07-29 | 민서 | **P4b 컷 4 — §4.7을 확정하고 AQ-08·AQ-25를 닫았다. 본 버전은 선행 명세다 — 계약 구현은 컷 7, 화면은 컷 8이다.** (1) **§4.7 미구현 해제** — 선행 조건 둘(DOC-007 §7.5 신설 · RD-02)이 닫혔으므로 계약을 확정했다. **개명 둘**: `totalAssets` → **`cumulativeAssets`**(산식은 옳고 이름이 틀렸다 — `Y₀` 이전 상환 상품이 두 항 어디에도 없으므로 「보유 자산의 총액」이 아니다. SCR-101 ②의 「총 자산 요약」과 같은 이름을 쓰면 두 화면이 같은 말로 다른 것을 가리킨다) · `healthInsurance` → **`totalInsurance`**(DOC-005 §5에서 「건강보험료」는 장기요양을 포함하지 않는다 — **절대 규칙 #9**. §4.6은 객체라 `.total`로 담을 수 있고 여기는 표의 한 칸이다). **미구현인 동안에만 개명이 자유롭다.** (2) **필드 셋 신설.** `thresholdGap`(DOC-008 §5의 「종합과세 기준 대비」는 **차액**이며 `isComprehensive`로 만족할 수 없다 — §4.6이 이미 같은 값을 갖고 같은 경로에서 나오므로 왕복 증가 0) · **`taxLawYear`를 행 단위로**(2027이 시드되는 날 앞 두 행은 정확, 뒤는 근사로 **갈리기 때문이다.** §4.6이 근사 표시를 계약으로 요구하는데 담을 자리가 없었다) · **`profileYear: number | null`**(아래 (3)). (3) **과세 프로필을 이월한다(LOCF)** — §4.6의 폴백(전부 `0` + `NONE`)을 여섯 연도에 쓰면 **종합과세 여부가 틀리고 보험료가 여섯 해 내내 0**이 된다. 오류도 빈 값도 아닌 **그럴싸한 숫자**다. 그 폴백의 논거는 「화면이 미입력으로 표시한다」였고 그것은 **편집기가 같은 화면에 있는 SCR-401에서 성립한다** — SCR-402에는 편집기가 없다. **기준은 `Y` 이하이고 `Y₀` 이하가 아니다** — §5.6이 시드 연도로 제한하지 않아 미래 연도 프로필이 실재하며(e2e가 그 방법을 쓴다) `Y₀` 기준이면 2027년 행이 2026년 값으로 계산된다. **표식을 `boolean`으로 두지 않는 이유는 §4.6이 이미 후회한 실수다** — `isSaved`가 두 원인을 한 거짓으로 접어 DOC-008 §5가 상태 셋을 표로 다시 풀어야 했다. 연도를 담으면 화면이 「2026년 프로필 적용」이라 말할 수 있다. (4) **빈 상태를 `[]`로 표현하지 않는다** — 상품 0건이어도 `years`개 행을 반환한다. `[]`는 상품 0건 + ELS 외 금융소득이 있는 사용자에게서 세금 행을 지워 **§8.1의 E 부류를 재현한다**(SCR-101의 빈 상태 분기와 같은 형태). (5) **`years`의 상한을 계약이 검사한다** — SCR-401의 연도 선택기가 상한 없이 주소 값을 받아 `?year=9999`에서 `<option>` 7,974개를 렌더한 적이 있다. 화면이 인자를 노출하지 않는 것이 1차 방어이고 계약의 상한이 2차다 — **화면 하나의 성질에 의존하지 않는다.** (6) **본인 전용 단언** — §4.6과 같은 규약이나 근거가 더 강하다(한 해가 아니라 `years`개 연도가 전부 과소 산출되고 이월이 그 오류를 연쇄시킨다). 왕복은 **3**이며 연도 수에 비례하지 않는다. (7) **§8 매트릭스의 SCR-402 행에서 「미구현」을 지웠다.** (8) **§9 AQ-08 해결 — 6.** 코드에 기본값을 박는 순간 사실상 닫히므로 구현 전에 확정한다. 근거는 만기(통상 3년)와 발행일 분산이며, 짧으면 만기가 먼 상품의 회수가 잘려 잔여 원금이 영구히 남는 것처럼 보이고 길면 근사 행만 늘어난다. (9) **§9 AQ-25 종결(컷 3에서 구현, 여기서 등재)** — 이 항목이 남긴 물음(「`null` 반환을 계약이 쓰는 곳이 있는가」)에 답했다: **없었다.** 방어 둘이 전부 도달 불가였고 원인은 함수가 아니라 **서명**이었다. `attributionYear`에 오버로드 셋을 두고 적용 차수 판정을 한 파일로 모아 **분기를 쓸 자리를 없앴다** — 제거가 아니라 표현 불가다 |
| 2.3 | 2026-07-29 | 민서 | **P4b 컷 1 — Q-06 감지 방식의 반전을 코드보다 먼저 적는다 (절대 규칙 #10). 본 버전은 선행 명세다 — 구현은 컷 2다.** (1) **§4.0 Q-06 규약 재작성** — v0.7~v2.2의 「`limit(상한 + 1)` 요청 후 `> 상한`으로 감지한다 — 정확히 상한 행수인 정상 결과를 오탐하지 않기 위함이다」를 **의도적으로 뒤집는다.** 그 판단은 **서버가 `상한 + 1`을 줄 수 있다고 전제**했고 그 전제가 거짓이었다 — `db-max-rows`는 클라이언트 `limit`을 상한으로 **깎으므로**(오류가 아니다) 응답 행수가 상한을 넘을 수 없고, 임계가 상한과 같으면 발화 조건이 **영원히 거짓**이다(P4.5 실측: 1,201행에 `limit=1001`·`limit=1200` → 둘 다 1000행, `Content-Range: 0-999/*`, **200**). 새 규약은 **요청 상한을 서버 상한과 같게 두고 앱 임계를 하나 작게** 둔다 — 서버가 깎지 않고 건넨 최대치가 곧 발화 조건이다. (2) **그 반전이 사는 오탐을 각주로 명시했다** — 요청 상한과 서버 상한이 같아지므로 「정확히 서버 상한 행수인 **온전한** 목록」과 「그보다 많아 **잘린** 목록」을 구별할 수 없고 조회 계층은 **양쪽 모두에 던진다.** 앞의 경우가 오탐이며, 받아들이는 근거는 **결론이 같다**는 것이다(어느 쪽이든 AQ-09를 닫아야 한다). 여유를 한 행으로 고정하는 이유가 그것이다 — 넓히는 만큼 온전한 목록을 오탐하는 구간이 늘어난다. (3) **임계를 값이 아니라 파생으로 정했다** — 「값만 고치면 `max_rows`가 오르는 날 사본이 낡고 아무것도 빨간불이 되지 않는다」가 v2.2 사문화와 **같은 형태**이므로, `POSTGREST_MAX_ROWS`를 설정의 사본으로 선언하고 임계·요청 상한을 그것에서 계산하며 **사본의 낡음을 `config.toml` 파싱 테스트로 막는다**(DB 없는 상시 스위트). (4) **§9 AQ-22** — 잔여 ②(사문화)를 닫고 **새 잔여 넷을 등재**했다: 클라우드 `max_rows`가 저장소에 없어 **운영에서는 여전히 사문화될 수 있다**(이 수정이 좁히지 못한 축이며 닫았다고 적지 않는다) · `config.toml`은 파일이고 실행 중인 컨테이너가 아니다 · **임베드 배열 축은 미측정이며 `assertNotTruncated`도 `count` 대안도 덮지 못한다** · 위 오탐. 셋을 함께 닫는 후보(`count: 'exact'`)를 평가해 **AQ-09를 다룰 때** 채택하기로 적었다 — 그때 `COUNT`가 페이지 번호에 필요해 순수 비용이 아니게 된다 |
| 2.2 | 2026-07-29 | 민서 | **P4.5 — 가장 값싸고 위험한 한 줄을 고쳤고, 코드 세 자리가 인용하던 규칙이 두 절 어디에도 없었음을 닫았다.** (1) **§4.1 `worstOf` 주석 정정 — `// null = 시세 없음`은 거짓이었다.** 무결성 결함 상품(`UNDERLYING_MISSING`)도 이 목록에 실리며 `worstOf = null`을 갖는다 — `judge()`가 `destroyed === 'PRICES'`에서 `worstOf`를 끊으면서 **`next`는 살려 반환하고** 이 목록의 유일한 필터가 `next != null`이기 때문이다(`willMeet`도 같은 두 원인에서 `null`이 된다). **그 주석을 믿고 구현하면 ST-06 위반이 된다** — 「null이면 시세 없음」으로 읽는 화면은 결함 상품에 정확히 그 금지된 표시를 하고 사용자를 영원히 오지 않을 시세를 기다리게 한다. 원인을 이 뷰에 담지 않는 것은 **결정**이며(원인은 ④ `attentionItems`가 말한다) 그래서 ①의 문구는 제3의 중립 문구여야 한다. **`worstOf`를 담는 뷰 넷 중 원인을 갈라 말할 수 있는 것은 셋**(§4.2·§4.3·§4.4가 `integrityIssue`를 함께 담는다 — 그 셋이 `deriveDisplay`의 소비자인 이유다. §4.1이 유일한 예외이며 그것이 이 정정의 내용이다). (2) **§4.3·§4.4에 `conditionResult`의 차수 범위를 명문화** — 「**적용 차수 한 행에만 값이 있다**」. 코드 세 자리가 이 규칙을 「§4.4」·「§4.3」으로 인용하고 **한 e2e 케이스의 기대값이 그것에 의존하는데 두 절 어디에도 문장이 없었다**(실재한 것은 §4.2 D1 표의 **상품 단위** 한 칸이다). 두 절에 넣어 인용을 참으로 만들었고 `null`의 원인 넷을 열거했으며, `isPast`와의 함의가 **한 방향뿐**임을 적었다(`isPast = true` ⟹ `null`이지만 역은 성립하지 않으므로 **화면은 `isPast`로 이 값의 유무를 판단할 수 없다**). 인용 셋도 문서의 실제 문장에 맞췄다. (3) **§4.6에 `override` 각 축의 형식·범위 신설** — 금액 두 축은 **저장 축의 구현과 같은 `/^\d+$/`**이고(§6의 V-19는 문자열 길이 규칙이며 이 형식이 아니다 — 저장 축의 위반이 그 ID로 기록되는 것은 ID 재사용 규약의 결과다) 인식 실패는 **그 축을 조정하지 않은 것으로 버린다**(열거 축이 이미 그 규약이다). 조정 축이 더 넓으면 **화면이 저장할 수 없는 숫자를 정상 결과로 렌더한다.** 실측 둘을 근거로 남겼다: `new Decimal('0x1f')` → **31**, `new Decimal('1e999')`는 `isFinite()`가 참이라 `dec()`를 통과한다 — 형식 검사가 없으면 「비숫자 → 오류 화면」보다 나쁜 경로가 둘 있다(오류는 보이고 이것들은 보이지 않는다). (4) **§4.4의 「다섯 화면」을 셋으로 정정** — `deriveDisplay`의 소비자는 셋이고(SCR-201·202·301) 나머지 둘은 입력 셋을 담지 않는 계약을 읽으므로 **부를 수 없다.** 규율 위반이 아니라 **기록의 오류**였으며, 그 기록을 근거로 세 파일이 자기를 「두 번째」·「다섯 번째 소비자」로 번호 매기고 그중 둘이 동시에 「두 번째」였다. 정본 목록을 `lib/format/derived.ts`의 머리글 표 하나로 옮겼다(서수는 소비자가 늘 때마다 낡는다). (5) **§8.1에 재발 방지 물음 넷째 — E 부류 신설.** 「화면이 계약이 준 필드를 **모든 분기에서** 렌더하는가」. 셋을 전부 만족하면서 사용자에게 도달하는 결함이 나왔다 — SCR-101의 빈 상태 분기가 요소 ③을 함께 지워, **상품 0건 + ELS 외 금융소득**인 사용자에게 §5의 세 물음 중 둘째가 답되지 않았다. D는 「계약에 없다」이고 E는 「**계약에 있고 화면이 조건부로 버린다**」이므로 대조 상대가 다르다(D는 문서↔계약, E는 계약↔화면의 분기). §4.1의 v2.0 자기 점검이 `judge()`의 여덟 값 중 **둘만** 물은 것도 같은 형태이며, **§8.1이 자기 교훈으로 적은 「개별 정정이 부류를 닫지 못했다」가 그 정정 자체의 점검에서 재현되었다.** (6) **§9 — AQ-22의 잔여를 실측해 성격을 바꿨고 AQ-25를 판별했다.** AQ-22: 1,201행을 태워 `db-max-rows`가 클라이언트 `limit`을 깎는 것을 확인했으므로 잔여는 「실측 부재」가 아니라 **「Q-06 가드가 사문화되어 있다」**다(고치는 방향 둘을 적었고 P4.5는 고치지 않았다 — 범위 밖이었다). AQ-25: `evaluation_date`가 널 불가임을 타입 탐침으로 확정했으므로(`TS2322`) 넷째 `null` 분기는 **죽은 코드**다 — 「불명」에서 「판별했고 죽었다」로 옮겼다 **★ 이 버전은 적대적 반증을 지났다** — 5축 반증이 이 커밋의 주장에서 결함을 냈고 전부 정정했다(BLOCKER 2종: 「실측 1,028개」가 계산값 1,027이고 그 주소는 `<option>`을 0개 렌더한다 · 음성 대조 표 두 줄의 건수. WRONG: V-19 인용이 거짓이었다(§6의 V-19는 문자열 길이 규칙이며 `/^\d+$/`는 구현이 ID 재사용 규약으로 빌린 것 — **내가 닫으려던 부류를 내가 만들었다**) · 「추가납부가 양수」가 0이다 · AQ-36의 「여덟 칸 중 여섯」이 다섯이다 · `worstOf`를 담는 뷰가 셋이 아니라 넷이다 · 문서 접두사 없는 § 참조 다섯 · 항진명제 케이스 둘 · 퇴화 픽스처 하나 · DOC-000 버전 표 드리프트 다섯 행). |
| 2.1 | 2026-07-29 | 민서 | **P4 컷 10 — §8.1 신설: 화면이 계약의 결함을 드러낸 여섯 사례를 부류로 묶었다.** 네 검증 단계(P3a·P3a.5·P3b·P3b.5)를 지난 계약에서 화면을 세우는 동안 여섯 번 결함이 나왔고, **넷이 두 부류에 몰린다** — A(파라미터를 채울 값이 반환에 없다: AQ-24 · §4.4 `ownerId` · §4.6 `seededYears` · §4.1 `ownerName`)와 B(`judge()`가 낸 값을 매퍼가 버린다: §4.3 판정 삼종 · §4.4 `status`). **컷 3과 컷 7이 같은 형태였다는 것이 이 절의 핵심이다** — v1.4가 §4.3에서 고친 부류가 넉 컷 뒤 §4.4에 그대로 남아 있었으므로 **개별 정정이 부류를 닫지 못했다.** 재발 방지는 「뷰마다 같은 필드 집합」이 아니다(그러면 컷 9의 확인이 결함으로 잡힌다) — 판정 기준은 **행 단위와 화면의 축**이며 세 물음으로 적었다. **D 부류(요소 자체가 계약에 없다)는 §8에 두었다** — 계약 문서 안에서는 보이지 않고 화면 목록과 나란히 놓아야 보이며, 이 매트릭스가 v1.9까지 「어느 화면이 어느 계약을 쓰는가」만 적고 「그 계약이 그 화면의 요소를 전부 덮는가」는 묻지 않았기 때문이다. 함께 기록한 판단: **DOC-001 §10이 화면설계서를 역작성하기로 한 근거가 §4의 `View` 타입에도 적용된다** — 계산 규칙(TC-01~22)과 스키마(I-01~16)는 P4 내내 무변경인데 뷰의 필드 집합만 여섯 번 흔들렸고, 그것은 「어느 화면이 무엇을 표시하는가」의 함수이므로 DOC-009와 같은 층이었다. **순서가 아니라 예상이 바뀌어야 했다**(정정을 결함 발견이 아니라 예정된 단계로 계획에 적는다). 나머지 화면의 요소 ↔ 필드 대조는 DOC-010 AQ-35로 등재 |
| 2.0 | 2026-07-29 | 민서 | **P4 컷 9 — §4.1에 `attentionItems[].ownerName`과 `recentRedemptions` 신설. 화면이 계약의 결함을 드러낸 다섯째·여섯째 사례이며, 여섯째는 앞의 다섯과 부류가 다르다.** (1) **`ownerName`** — 조치 목록의 사유는 저마다 조치를 지목하고 그 조치는 **소유자만 할 수 있는데**(`KI_BELOW` → SCR-202의 확정, 결함 둘 → SCR-204의 수정) 항목이 소유자를 말하지 않았다. `scope = 'ALL'`에서 사용자는 자기가 할 수 없는 일이 목록에 있는 이유를 상세로 들어가서야 안다. **같은 뷰의 `upcomingEvaluations`는 이미 `ownerName`을 담고 있으므로 한 뷰 안에서 두 목록의 주어가 달랐다** — v1.8의 `ownerId`와 같은 부류의 비대칭이고 이번에는 계약 사이가 아니라 **한 계약 안**이다. (2) **`recentRedemptions`** — DOC-008 §5가 규정한 주요 요소 다섯 중 **⑤(최근 상환 실적)에 자료원이 없었다.** §8은 이 화면에 `getDashboard` 하나를 배정하므로 그 요소는 문서에만 존재했고, `totals.realizedPnl`은 합계라 「무엇이 상환되었는가」를 말하지 않는다. 앞의 다섯 사례는 전부 **있는 값을 매퍼가 버리거나 파라미터와 반환이 비대칭인** 것이었고 이번은 **요소 자체가 계약에 없는** 것이다 — 즉 「화면의 주요 요소마다 그것을 읽는 필드가 있는가」를 묻는 축이 없었다는 신호이며, `tests/app/dashboard.test.ts`가 DOC-008 §5의 요소 셀을 파싱해 **요소 → 뷰 필드** 대응표와 대조한다(값은 `keyof DashboardView`이므로 필드 개명은 `typecheck`가, 요소 증가는 그 단언이 잡는다). **왕복은 늘지 않는다**(`loadProducts`가 이미 `redemptions`를 임베드로 읽고 `REDEMPTION_COLUMNS`가 필요한 다섯 열을 담는다 — 같은 행의 다른 투영이다). **기간 창을 두지 않으며 그것이 여기서는 검산 가능한 형태가 된다**: `totals.realizedPnl = Σ recentRedemptions[].realizedPnl`이 항등식이고 창을 넣으면 깨진다. 표시 건수와 자름의 표시는 화면이 정한다 |
| 1.9 | 2026-07-29 | 민서 | **P4 컷 8 — §4.6 `TaxSummaryView`에 `seededYears` 신설 + `isSaved`의 두 원인을 가르는 판단 기록.** (1) **`seededYears`** — DOC-008 §5는 「① 연도 선택」을 이 화면의 첫 요소로 규정하는데 **시드보다 과거인 연도는 본 계약이 예외를 던진다.** 즉 고를 수 있는 연도의 하한은 세율 시드에만 있는 지식이고, 화면이 추측하면(「올해 − 5년」) 그중 일부가 **오류 화면으로 가는 선택지**가 된다 — 사용자에게 제시된 항목이 앱을 멈추는 형태다. `taxLawYear`로 유도할 수 없다(그 값은 요청 연도 또는 **최신** 시드 연도이며 어느 경우에도 하한을 말하지 않는다). **왕복은 늘지 않는다** — `loadTaxYearContext`가 이미 `tax_years` 전체를 한 왕복으로 읽어 근사·거부를 판정한다. 상한은 계약이 정하지 않는다: 미래 연도는 근사로 허용되므로 화면이 `max(현재 연도, 마지막 시드 연도)`로 자르며, 그 이후는 SCR-402의 일이다. (2) **`isSaved = false`의 두 원인**(저장된 프로필 없음 / `override` 적용 중)은 표시가 정반대인데 한 거짓으로 접혀 있다. **계약에 두 번째 boolean을 두지 않는다** — `override`를 넘긴 것은 화면 자신이므로(SCR-401에서는 URL 질의에 있다) 화면이 이미 아는 사실로 가른다. 계약이 모르는 것을 계약에 묻지 않는다. 남는 공백(override 중에 저장 행의 존재를 알 수 없다)은 무해하다: 그 상태의 다음 행동이 「지금 값으로 저장」 하나이고 §5.6이 UPSERT다 |
| 1.8 | 2026-07-28 | 민서 | **P4 컷 7 — §4.4 `ScheduleItem`에 `ownerId`·`status` 신설. 화면이 계약의 결함을 드러낸 네 번째 사례이고, 이번에는 둘이다.** (1) **`ownerId` — 파라미터는 있는데 고를 값이 반환에 없었다.** 본 계약은 `params.ownerId`로 좁히고 DOC-008 §5는 소유자 필터를 요소로 규정하는데 반환에는 `ownerName`만 있어 **화면이 선택지를 만들 수 없었다**(이름 → UUID 대응이 어디에도 없다). §4.2의 `ProductListItem`은 둘을 담고 있고 같은 필터가 이 화면에도 있다는 사실만 §4.4에 반영되지 않았다 — **AQ-24와 같은 부류의 비대칭**이며(그쪽은 파라미터가 반환보다 좁았다) 둘 다 「필터의 입력과 출력이 한 계약 안에서 닫히는가」를 확인하지 않아 생겼다. 대안(`listUserSummaries`를 함께 읽기)은 §8의 배정을 늘리고 왕복 4 + 전 사용자 세금 계산을 부르므로 SCR-201이 버린 것과 같은 이유로 버린다. (2) **`status`** SCR-301은 행 단위가 **차수**이므로 상환 완료 상품의 남은 차수도 행으로 내려오는데(`activeOnly`가 꺼진 기본 상태), 뷰에 상품 상태가 없어 그 행이 **미상환 상품의 차수와 구별되지 않았다** — 도래하지 않을 날짜가 「다가오는 평가일」에 섞인다. `activeOnly`는 **숨기는** 수단이므로 이 문제를 대신하지 못한다(숨긴 것과 상환된 것도 구분되지 않는다). 근거는 v1.4의 판정 삼종과 같다: `judge()`가 이미 내는 값을 매퍼가 버리고 있었고, §4.2 우선순위표의 단일 구현(`deriveDisplay`)이 `{status, worstOf, integrityIssue}`를 요구하는데 셋 중 하나가 없어 **다섯 화면 중 이 화면만 E-05 단을 판정할 수 없었다.** v1.4보다 한 단계 더 나쁜 상태였다 — §4.3은 화면이 `redemption == null`로 합성할 수 있었으나(그 합성을 볼 층이 없다는 것이 문제였다) 여기는 상환 레코드도 상환일도 뷰에 없어 **합성할 입력조차 없다.** 차수마다 같은 값이 실리는 것은 `productName`·`ownerName`과 같은 형태이며, 상품별로 접으면 §4.4가 루트를 차수로 둔 근거가 무너진다. `isPast`와 직교하며 넷 중 넷이 실재한다(상환 완료 + 미래 차수 = I-01이 일정을 지우지 않는다) |
| 1.7 | 2026-07-28 | 민서 | **P4 컷 6 — §5.4의 미결(시드 이전 연도 원천징수 코드)을 닫았다.** `INTERNAL` → **`VALIDATION_FAILED` + `fields.withholdingTax`**. v1.1이 「원인이 `withholdingTax`가 비어 있는 것인지 `redemptionDate`가 시드 범위 밖인 것인지 갈린다」로 미뤄 둔 판단이며, **두 후보가 대칭이 아니다**: A-04가 실제 징수액을 정본으로 정했으므로 `withholdingTax`가 1차 입력이고 산출은 편의다. `redemptionDate`를 가리키면 「그 해는 지원하지 않는다」가 되어 **사용자가 가진 사실(실제 상환일)을 부정**하며, 그 안내를 따르면 상환 기록 자체를 포기하게 된다 — §5.4가 「결함 상품에도 상환을 기록할 수 있다」로 지킨 것과 같은 원칙이다. **V-id를 부여하지 않는다** — §6의 규칙은 입력의 형태에 대한 것이고 이 조건은 **시드 상태**에 달렸으므로, V-id를 주면 입력만 보고 판정할 수 있다는 거짓을 문서에 새긴다. 구현에서 필요해진 것 하나: `loadTaxYearContext`의 예외 두 종(그 연도 시드 없음 / 시드가 아예 없음)을 **타입으로 가른다**(`TaxSeedRangeError`). 가르지 않으면 마이그레이션 미적용 같은 진짜 장애가 「징수액을 입력하라」로 보고되고, 사용자가 몇 번을 입력해도 같은 오류가 난다 — §3.2가 `INTERNAL`을 「사용자가 고칠 수 없는 것」으로 정의한 이유가 그것이다. 조회 계약은 **그대로 던진다**(ADR-005의 재현성) |
| 1.6 | 2026-07-28 | 민서 | **P4 컷 4b — §9의 미결 둘을 닫았다. 둘 다 「화면이 붙은 뒤 정한다」로 미뤄 둔 것이며 실제로 화면이 붙은 뒤 정했다.** (1) **AQ-29 해결 — (a) 그대로 두고 계약 밖 호출을 신뢰하지 않는다.** 근거 셋: 소비자가 하나이고(SCR-204 → 계약 → 함수) 우회는 RLS 안에서의 자해이며, (b)는 서버 전용 비밀을 도입하거나 §6을 두 언어로 두는 대가를 부르고, 보상 수단이 실재한다(DQ-05가 총 차수를 행 수로 정했고 `integrityIssue`가 0건을 표시하며 `supabase/dev/` 표본은 V-04·V-07·V-09를 구조로 만족시킨다). **결정을 문서에만 두지 않고 케이스로 박았다** — 차수 `1, 2, 99` + 감소하는 평가일이 함수 직접 호출에서 **성공함**을 고정하고 같은 입력이 계약에서 거부됨을 나란히 둔다. SQL에 검증이 더해지면 그 케이스가 빨간불이 되고 그것이 좋은 소식이다. (2) **AQ-30 잔여 ③ 해결 — `.rpc()` payload를 열 사양에서 파생시켰다.** 형태는 「합성의 각 조각을 각 테이블에서 파생」이며 `MoneyFieldsOf<T>`가 금액 열 이름을 `SnakeToCamel`로 옮겨 `string`을 요구한다. **단언이 아니라 파생**이므로 새 금액 열은 컴파일 오류가 된다(음성 대조로 확인). **값 경로를 화면에서 실측했다** — 기준가 18자리가 폼 → `jsonb` → `::numeric`을 지나 상세 화면까지 정확하다. 남는 것은 SQL 함수 쪽 절반이며 그 상태는 조용하지 않다 |
| 1.5 | 2026-07-28 | 민서 | **P4 컷 4a — §4.9의 빈 질의를 「전량」으로 정한다 (U-03).** 구현은 빈 질의에 `[]`를 주고 있었고 사유를 "자동완성이 열릴 때마다 전 자산을 내려보내게 된다"로 적었다. **그 전제가 SCR-204에서 성립하지 않는다** — §1.2가 「조회를 서버 액션으로 감싸지 않는다」고 못 박았으므로 타이핑마다 서버에 묻는 경로가 애초에 없고, 화면이 실제로 하는 일은 **렌더 1회에 전량을 받아 클라이언트에서 좁히는 것**이다. 즉 `[]`는 아끼는 것이 아니라 **자동완성을 영구히 빈 목록으로 만드는** 값이었다(자산이 있어도 `+ 등록` 화면에서 하나도 고를 수 없다). 빈 질의는 이름 필터 없는 조회이고 **`SEARCH_LIMIT`(20)을 걸지 않는다** — 상한을 걸면 21번째 자산이 어떤 방법으로도 선택되지 않는데 화면에는 그 사실이 나타나지 않는다(AQ-22가 지적한 "호출부에 절단 신호가 없다"가 바로 이 형태다). 대신 Q-06의 `TRUNCATION_PROBE_LIMIT` + 절단 감지를 쓴다 — **의도된 자름(검색 상한)과 감지해야 하는 자름(서버 상한)을 다른 수단으로 다룬다.** 비-빈 질의의 동작은 그대로다(부분일치 + 상한 20 + 이스케이프) |
| 1.4 | 2026-07-28 | 민서 | **P4 컷 2·3 — 화면이 계약의 결함 둘을 드러냈다.** (1) **§4.2 `kiStatus` 파라미터를 5값으로 확장 — AQ-24 해결.** 반환은 5값인데 파라미터가 3값이어서 `BELOW`·`NO_KI` 상품을 **어떤 필터로도 뽑을 수 없었다**. 「조치 목록(§4.1)이 전담한다」는 대안을 버린 근거는 그쪽에 좁힘의 조합(소유자·상태와 함께 보기)이 없다는 것이다. 필터는 조회 후 적용(Q-05)이라 구현 3줄. 재발 방지로 리터럴 유니온을 다시 적지 않고 도메인 열거형을 색인한다 — 화면 선택지도 `Record<KiStatus, string>`의 키에서 만들므로 열거값이 늘면 셋이 함께 컴파일에서 깨진다. (2) **§4.3에 판정 삼종(`status`·`worstOf`·`kiStatus`) 신설.** 셋 다 이미 `judge()`가 산출하고 매퍼가 **버리고 있었다**. 근거는 편의가 아니라 §4.2 우선순위표의 단일 구현이다 — 그 함수의 입력이 정확히 `{status, worstOf, integrityIssue}`이므로, 뷰가 담지 않으면 SCR-202가 둘을 스스로 합성한 뒤 부르게 되고 **그 합성의 정확성을 확인할 층이 없다**(화면은 어떤 스위트의 import 그래프에도 없다 — DOC-010 AQ-23). 즉 「목록과 상세가 같은 판정을 낸다」가 검증 불가능한 합성에 의존하게 된다. `kiStatus`는 합성조차 불가능하며(등급 임계와 순서는 `lib/domain`의 재구현이 된다) DOC-008이 SCR-202의 주요 요소로 규정하고 §4.1의 `KI_BELOW` 조치가 이 화면을 지목한다. 동일성은 `tests/db/map.test.ts`가 두 뷰에 같은 함수를 걸어 대조한다 |
| 1.3 | 2026-07-28 | 민서 | **P4 컷 1b — §8에 무효화 실측을 기록한다.** 계획은 계약별 경로 목록을 손으로 적는 것이었고, 그 전에 네 경우를 실측하기로 게이트를 두었다(«의존하는 설계보다 실측을 앞에 둔다»). 결과가 설계를 바꿨다 — **세 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이 아홉 칸 전부 같았고**, 대조군이 초록인 것이 실험 실패가 아님을 `revalidatePath` 호출 로그로 확인했다(②는 일곱 경로, ③은 `/tax` 하나). 서버에 지울 것이 없기 때문이다. 그래서 §8에 남기는 것은 **판정 기준**(`affects` × `ROUTE_QUERIES`)이고 경로 목록은 그 곱으로 도출한다. 상세는 DOC-010 §9 AQ-02. 함께 기록한 두 반직관: 시세는 세금·전망을 낡게 하지 않고(§4.6의 추정 기여가 `grossExpected`뿐이다), 상환은 시세 화면을 낡게 한다(§4.5 `usedByActiveProducts`가 미상환 기준이다) |
| 1.2 | 2026-07-28 | 민서 | **P4 착수 전 선행 정정 (U-01) — 화면을 세우기 전에 매트릭스의 결함을 고친다.** (1) **§8에 `createAsset`을 SCR-302에도 배정** — v1.1까지 SCR-204 전용이었는데, 그러면 **SCR-302의 빈 상태가 순환한다.** DOC-008 §6의 빈 상태가 "등록된 기초자산 없음"이고 ST-02가 다음 행동을 요구하는데 자산을 만들 유일한 경로가 상품 등록이고 상품 등록은 기초자산 선택을 요구한다. 구현 0줄, 배정만 넓힌다. (2) **§8에 SCR-001 행 신설** — 종전 매트릭스는 SCR-101부터 시작해 **로그인 화면이 아예 없었다.** `signIn`·`signOut`은 §5의 열한 계약에 넣지 않는다(도메인 변경이 아니고, `src/app/actions.ts`의 "11개를 1:1로 노출한다"는 불변식을 희석한다) — `src/lib/auth/session.ts`에 두되 `ActionResult`는 재사용한다. (3) **§8 SCR-502에 표시명 변경 보류를 명기** — DB는 허용하나(`grant update (display_name)` + `users_update_self`) §5에 계약이 없다. (4) **§8 SCR-501에 SQ-01 해결 반영** — 화면을 만들지 않되 `listUserSummaries`는 남긴다. (5) **§4.0 왕복 표에 `getUser()` 2회 등재** — P4 선행 조건 ②의 프록시가 한 번 더 부르며 `cache()`가 프록시 경계를 건너지 못한다. **프록시의 답을 요청 헤더로 내려보내 합치지 않는다**(위조 가능한 신뢰 채널이며 `getSession()`이 아니라 `getUser()`를 쓰는 전제를 깬다) |
| 1.1 | 2026-07-28 | 민서 | **P3b 산출물 대조 검증(P3b.5)에 따른 정정. 감사 8건 중 문서가 정본인 것들을 먼저 고친다(U-01).** (1) **§3.2.1 제약 이름 표에 9행 추가 — 문서가 코드보다 뒤처져 있었다.** 표는 15개 이름을 열거했는데 `errors.ts`의 `BY_CONSTRAINT`는 24개였고, 빠진 것들(`redemptions_els_id_key`·`assets_name_market_key`·`tax_profiles_user_id_tax_year_key` 등)이 전부 **계약 경로에서 도달 가능한 제약**이다. 대조 단언이 `arrayContaining`이라 여분을 허용했으므로 그 뒤처짐이 어느 테스트도 실패시키지 않았다 — v1.1부터 `tests/db/docs-contract.test.ts`가 이 표를 파싱해 **양방향**으로 대조한다. `*_required` 두 개를 한 행에 합쳐 두었던 것도 갈랐다(합치면 `규칙` 열 분해가 파서에만 존재하는 특수 처리가 된다). (2) **§5.9에 `fields` 키를 명시 — V-18이 층마다 다른 칸을 가리키고 있었다.** 계약 계층은 `touchedAt`, DB 매핑(`els_products_ki_touched_check`)과 §6 V-18은 `kiTouchedAt`이었다. §3.1이 `fields` 키를 "계약 입력의 필드 이름"으로 정의했는데 이 계약의 입력은 위치 인자라 필드 이름이 없고, 그 공백에서 갈렸다. `kiTouchedAt`으로 통일한다. (3) **§6 V-20 대상에 `totalRounds` 추가**(구현은 처음부터 검사하고 있었고 목록에만 빠져 있었다. 저장되지 않는 값이라 이 검사가 유일한 방어다) **+ 규칙 ID 재사용 각주 신설** — 셰이프 파싱이 형태·열거·boolean 검사에 그 필드의 규칙 ID를 빌려 쓰는 사실과, **20개 안에서의 오태그는 어떤 단언도 잡지 못한다**는 대가를 함께 적었다. §6에 형태 규칙을 신설하지 **않는** 이유는 `RULE_IDS`가 §6에서 파생된다는 방향이 뒤집히기 때문이다. (4) **§5.4에 과거 연도 상환의 `INTERNAL`을 명시** — 시드보다 과거 연도는 조회 계층이 거부하므로(ADR-005) `withholdingTax` 미입력 시 `INTERNAL`이 된다. 그것이 옳은 코드인지는 정하지 않았고 이유(원인이 두 필드로 갈려 안내 문구가 정반대다)와 함께 P4로 미룬다. (5) **AQ-30 보완 — W-04가 구조로 걸리는 범위는 11개 중 9개다.** `.rpc()` 경유 2개는 린트 셀렉터가 보지 않고 `productPayload()`가 열 사양에서 파생되지 않는다. 새 금액 열이 생기면 빠뜨려도 아무것도 실패하지 않는다. (6) **AQ-31 신설** — `refreshPrices`의 성공 경로가 한 줄도 실행되지 않으며 ADR-007이 닫히는 순간 처음 실행된다 |
| 1.0 | 2026-07-28 | 민서 | **P3b 구현 완료 반영 — 이 버전부터 §5는 선행 명세가 아니라 구현 대조본이다.** (1) **§5.0.1 신설 — 왕복 수 실측표(계약 11개).** 테이블 다중집합으로 세며, 사전 조회가 필요한 계약만 2 이상이고 §5.5의 두 계약만 3인 이유(상품이 아니라 상환 `id`를 받는다)를 함께 적었다. **검증에서 거부되는 입력은 왕복 0**임도 실측했다. (2) **AQ-30 해결** — 생성 타입을 그대로 따르면 `99999999999.999999`가 `100000000000.000000`으로 저장된다는 것을 실측했다. **두 요청 모두 `201`이며** 거부도 경고도 없다 — 그 사실이 동시에 PostgREST가 `numeric` 열에 JSON 문자열을 그대로 받는다는 증거이므로, 어긋나는 쪽은 전송 계층이 아니라 생성 타입이다. `InsertPayload<T>`가 열 사양에서 금액 열을 파생하고 린트가 리터럴 우회를 막는다. 읽기·쓰기가 `CountingColumn` 하나를 공유하므로 두 방향이 갈릴 수 없으며 그 동치를 타입 수준에서 단언한다. (3) **AQ-27 해결** — 귀속연도 파생을 `currentYear()` 하나로 합쳤다. (4) **AQ-29 보완** — 계약과 함수 직접 호출의 차이를 실측해 등재했다(우회 시 잃는 것은 배열 인덱스와 "DB에 닿지 않음"이다). (5) §5.1·§5.2의 원자성을 **대조군과 함께** 측정했다 — 요청 3개로 나누면 기초자산 0건 상품이 실제로 남고(`UNDERLYING_MISSING`), 함수를 경유하면 상품 열·하위 행이 모두 되돌아간다 |
| 0.9 | 2026-07-27 | 민서 | P3b 변경 계약 구현 착수에 따른 선행 명세. **구현은 P3b 3단계 이후다.** (0) **§5.0 신설 — 변경 컨텍스트와 쓰기 규약 W-01~W-05.** §4.0이 조회에 대해 한 일을 변경에 대해 한다. (1) **§5.1·§5.2의 원자성 수단 확정(U-03).** "단일 트랜잭션"은 PostgREST가 요청당 1 트랜잭션이므로 요청 3개로는 만족되지 않는다 — 그대로 구현하면 부분 실패가 기초자산 0건 상태를 남기고 **§5.3의 "계약을 경유하는 어떤 조작도 0건 상태를 만들 수 없다"가 거짓이 된다.** 쓰기 함수 `create_els_product`·`update_els_product`를 경유하며, 그 함수가 I-07에 **DB 층 방어를 처음 부여**한다(DOC-010 AQ-14 부분 해소). (2) **§3.2에 오류 매핑 표 신설** — SQLSTATE는 거부의 형태이고 `ErrorCode`는 화면 처리이므로 둘은 1:1이 아니다. 제약 이름이 최종 판정자다. (3) **AQ-17 종결** — 순수 모듈의 예외는 전부 `RangeError`라 예외로는 입력 오류와 상태 결함을 구분할 수 없으므로 **호출 지점**이 코드를 부여한다. `CONFLICT`는 순수 모듈 예외에서 나오지 않는다. (4) **AQ-10 종결** — 스키마 검증 도구를 도입하지 않는다. (5) **§6 V-08을 필드별로 세분(U-03)** — `0 < x`가 DOC-007 §4.1의 원금상환형 리자드(`lizardCouponRate = 0`)를 거부하고 있었다. **V-19·V-20 신설**(문자열 길이·정수 범위) — 초과분이 `22001`·`22003`으로만 거부되어 어느 필드인지 알 수 없었다. (6) §5.4~§5.9 각 절에 산출 세부·2단계 삭제의 위치·기준일 의존·공급자 미선정 시 동작 명기. (7) **§9 AQ-26·AQ-27 처리, AQ-29 신설.** (8) **§3.2.1에 오류 본문 실측 표(P3b 2단계)** — 두 가지가 명세를 고쳤다: **plpgsql `RAISE`의 `constraint` 옵션이 HTTP 경계를 넘지 못하므로**(`pg` 직결에서는 오는데 PostgREST를 지나면 사라진다) `detail` 첫 줄에 이름을 함께 싣는 규약을 추가했고, **날짜 형식 오류는 `22P02`가 아니라 `22007`**이어서 매핑에 그 코드를 더했다 — 빠뜨리면 잘못 입력한 날짜가 `INTERNAL`이 된다 |
| 0.8 | 2026-07-27 | 민서 | P3a 산출물 대조 검증(P3a.5)에 따른 정정. (0) **§4.2에 D1의 억제 범위 신설 — 본 버전의 핵심.** v0.6이 정한 우선순위 표는 `conditionResult`·`kiStatus`만 규정했는데 구현이 그것을 **결함 상품 전체의 판정 중단**으로 해석했고, 그 결과 같은 결함 상품이 계약마다 다르게 보였다 — §4.3은 `projection`을 `null`로 두면서 §4.6은 같은 상품의 예상 과세소득을 숫자로 냈고, `SCHEDULE_MISSING` 상품은 `ratio`가 표시되는데 `isWorst`만 사라졌다. **억제는 그 결함이 파괴한 입력을 쓰는 값에만 미친다**(입력 기준)로 확정하고, `integrityIssue` 축과 E-05 축이 별개임을 함께 명기했다. (1) **§4.3 `projection`의 null 사유 재정의(U-03)** — v0.6의 "② `integrityIssue ≠ null`"을 철회한다. 이 값은 계약 조건에서만 나오고 시세를 쓰지 않으므로 `UNDERLYING_MISSING`에서도 산출된다. ②·③을 "적용 차수 없음" 하나로 합쳤다. (2) **§4.3 `isWorst` 정의 보강** — `SCHEDULE_MISSING`은 "산출 불가"에 해당하지 않는다. (3) **§4.1 `attentionItems`에 원칙 적용 + 표시 순서 고정** — 결함이 파괴하지 않은 입력에서 나오는 사유는 함께 보고한다. 일정 0건 상품은 §4.4에 행이 없고 `upcomingEvaluations`에도 없어 **이 목록이 유일한 창구**이므로, 억제하면 그 KI 하회가 시스템 어디에서도 보이지 않는다. `PRICE_MISSING`은 시세 입력이 파괴된 결함에서 내지 않는다. (4) **§4.0 Q-07에 시세 형식 분류 신설** — 시세(`numeric(18,6)`)는 금액·비율 어느 쪽도 아닌데 세 필드가 DB `::text` 원형을 그대로 통과시키고 있었다. 계약 계층에서 6자리로 정규화한다. (5) **§4.6 `contributingProducts[].integrityIssue` 신설** — 금액은 불변이고 표식만 붙는다. (6) **§4.2 `nextEvaluation` 주석 정정** — v0.6이 `projection`에만 적용한 "전 차수 경과 미상환" 정정을 전파. (7) **§4.8에 표식을 두지 않는 판단 기록.** (8) **§9 AQ-22·AQ-24~27 신설**, AQ-09·AQ-17 보완 |
| 0.7 | 2026-07-27 | 민서 | P3a 구현 완료에 따른 실측 반영. (1) **§4.0에 실측 각주 신설** — PostgREST의 `::text` 캐스팅은 postgrest-js 타입 파서가 이해하지만 **널 허용을 잃는다**(`ki_barrier::text`가 `string`으로 추론되나 런타임은 `null`을 준다). 조회 계층은 생성 타입에서 널 허용을 복원한다. 계약별 왕복 수 실측도 함께 등재. (2) **§4.4 구현 형태 명기** — 질의의 루트를 `redemption_schedules`로 둔다. 상품을 루트로 두고 날짜를 임베드 필터로 내리면 판정이 **잘린 일정 집합**에서 이루어져 `conditionResult`가 엉뚱한 차수에 붙는다. (3) **§4.6 `bracketLabel`의 최하단 구간 규칙 추가**(하한 0 → `"… 이하"`) — v0.6이 정하지 않은 경우를 구현 전에 문서에 등재. (4) **Q-06 감지 방식 구체화**(`limit(상한+1)` 후 `> 상한`). (5) **§9 AQ-18 각주** — `getForecast` 미구현 확정 |
| 0.6 | 2026-07-27 | 민서 | P3a 조회 계약 구현 착수에 따른 정정. **본 버전은 선행 명세다 — 구현은 P3a 2~8단계.** (1) **§4.0 신설** — 조회 컨텍스트(기준일·조회자)를 계약으로 등재. 기준일을 `Asia/Seoul`로 고정하고, 파생 필터의 적용 위치, 결과 절단 거부, 문자열 형식, 미인증 동작을 정한다. (2) **§4.2·§4.3·§4.4에 `integrityIssue` 신설 + §9 AQ-17의 조회 부분 철회(U-03)** — 기초자산 0건에서 §3.1의 예외 전파를 문자대로 두면 남의 결함 상품 1건이 SCR-101·201·301을 **전원에게** 죽이고(모든 SELECT가 `using (true)`), §8 매트릭스상 SCR-204도 `getProduct`를 쓰므로 유일한 복구 경로까지 막혀 UI로 고칠 수 없게 된다. (3) **§4.6·§4.8 범위 정정** — `tax_profiles` SELECT가 본인 한정이므로 타인의 `other_financial_income`을 읽을 수 없고, 그대로 구현하면 타인의 금융소득이 조용히 과소 표시된다. (4) **§4.7 미구현 명기** — `totalAssets`·`remainingPrincipal`이 어느 문서에도 정의되지 않았다. (5) **정의가 없던 필드 확정** — §4.1 창·`reason` 값, §4.3 `totalRounds`·`projection`·`expectedGross`·`isWorst`, §4.5 `isStale`, §4.6 `bracketLabel`·프로필 폴백·세율 연도. (6) **§5.3 각주 정정**, §6 V-03 재서술 |
| 0.2 | 2026-07-27 | 민서 | P1 구현 착수에 따른 정정. §4.6 `TaxSummaryView.tax.method1`·`method2`를 `string | null`로 변경. `F ≤ 종합과세 기준금액` 구간은 비교과세를 적용하지 않으므로(DOC-007 v0.2 §5.2) 두 방식 값이 존재하지 않는다 |
| 0.3 | 2026-07-27 | 민서 | DOC-007 v0.3 §9.1(E-05 반환 계약)에 맞춘 정정. §4.2 `ProductListItem.kiStatus`를 `... | null`로 변경 — 상환 완료 상품은 KI 판정을 수행하지 않으므로 등급이 존재하지 않는다. 같은 뷰의 `nextEvaluation`·`conditionResult`가 이미 `null`을 허용하는데 `kiStatus`만 값을 요구하여, 상환 완료 상품에서 계약을 만족시키려면 판정하지 않은 등급을 지어내야 했다 |
| 0.5 | 2026-07-27 | 민서 | P2 산출물 대조 검증(P2.5)에 따른 정정. (1) **§5.3에 하위 행 개별 삭제 계약의 부재를 명기** — DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓혔으므로, 기초자산·차수를 줄이는 경로가 `updateProduct`의 전체 교체 하나뿐임을 계약에 드러낸다. DB 층에는 방어가 없어 계약 한 층뿐임을 함께 기록한다. (2) **§5.2에 KI 세 필드의 동반 규칙 명기** — I-11·I-15가 DB 제약으로 승격되어 셋 중 일부만 비우는 입력이 `23514`가 된다. (3) **§5.7에 좌표 불변(I-16)과 `.upsert()` 사용 가능성 명기** — 좌표 불변을 열 단위 GRANT로 강제하면 `.upsert()`가 payload 전역을 `DO UPDATE SET`에 실어 실패하므로, 트리거로 강제해 클라이언트 도구를 그대로 쓸 수 있게 했다. (4) **§6 V-18 신설, V-02·V-03의 대상 명시, V-11·V-13·V-14·V-16에 대응 I-규칙 태그 추가.** (5) **§9 AQ-17 신설** |
| 0.4 | 2026-07-27 | 민서 | P2 스키마 결정 반영. (1) **§5.3 `deleteProduct` 동작 정정** — 상환 완료 상품은 삭제할 수 없고 `CONFLICT`를 반환한다. 종전 서술("하위 레코드(기초자산·일정·상환)를 함께 삭제한다")은 실현된 과세 이력을 조작 한 번으로 지우는 경로였고, 그 결과 해당 귀속연도의 세액이 조용히 바뀐다. 근거는 DOC-002 v0.3 §8.1. (2) **§6에 V-17 신설** — 미래 일자 시세 입력 거부. (3) §9 AQ-07을 DQ-01과 함께 해결로 갱신 |

---

## 1. 목적 및 접근 방식

본 문서는 화면과 데이터 계층 사이의 **계약**을 정의한다. 조회 계약, 변경 계약(서버 액션), 외부 엔드포인트, 에러 모델, 검증 규칙을 다룬다.

### 1.1 REST · OpenAPI를 채택하지 않은 이유

ADR-001에서 Next.js 풀스택을 채택했으므로 시스템의 실제 계약면은 다음과 같이 구성된다.

| 유형 | 실행 위치 | 호출 방식 |
|---|---|---|
| 조회 | 서버 컴포넌트 | 함수 직접 호출 |
| 외부 조회 *(v4.3)* | 서버 컴포넌트 | 함수 직접 호출 — §4.10. DB가 아니라 발행사 공개 페이지를 읽는다 |
| 변경 | 서버 액션 | 클라이언트 → 서버 자동 직렬화 |
| 외부 호출 | Route Handler | HTTP |

이 구조에서 HTTP 기반 REST 계층을 추가로 두면 **소비자가 없는 인터페이스를 유지보수하게 된다.** 화면과 서버가 동일 배포 단위 안에 있고 외부 클라이언트가 없으므로(O-06 네이티브 앱 제외), REST 계층은 코드량만 늘리고 새 가치를 만들지 않는다.

또한 OpenAPI 문서는 구현과 별도로 관리되므로 표류(drift) 위험이 있다. 반면 **타입 정의를 계약으로 삼으면 불일치가 컴파일 시점에 드러난다.**

**따라서 본 문서는 함수 시그니처를 계약으로 취급한다.** 유일한 HTTP 엔드포인트인 Cron은 7장에서 별도 정의한다.

> **향후 외부 클라이언트가 필요해질 경우**, 본 문서의 계약 함수를 그대로 재사용하는 Route Handler를 얇게 추가한다. 계약 정의는 변경되지 않는다.

### 1.2 조회를 서버 액션으로 정의하지 않는 이유

조회는 서버 컴포넌트에서 함수를 직접 호출한다. 서버 액션은 변경 작업에만 사용한다. 조회를 서버 액션으로 감싸면 캐싱·스트리밍 이점을 잃고 불필요한 왕복이 발생한다.

**외부 조회(§4.10)도 서버 액션이 아니다 (v4.3).** 검색은 GET 폼이고 선택은 링크다 — 주소가 상태이므로 JS 없이 동작하고(DOC-008 SCR-204) 뒤로 가기가 후보 목록으로 돌아간다. 서버 액션으로 두면 결과가 폼 상태에만 있어 주소로 다시 열 수 없다.

---

## 2. 표기 규약

```ts
// 계약 표기 예
function contractName(input: InputType): Promise<OutputType>
```

| 규약 | 내용 |
|---|---|
| 날짜 | ISO 8601 문자열 (`YYYY-MM-DD`) |
| 금액·비율 | **문자열로 전달**한다. 부동소수점 변환을 방지하기 위함 (DOC-002 M-03) |
| 비율 | 소수 정규화 값 (`"0.9"` = 90%). 입력 계층에서 변환 (M-04) |
| 식별자 | UUID 문자열 |
| 선택 필드 | `?` 표기 |
| 열거형 | DOC-005에 정의된 값만 사용 |
| 금액의 통화 *(v4.9 — 선행 명세, 구현 P8 컷 a2)* | 금액은 두 부류다 — **상품 통화 금액**(투자원금·실수령액과 그 파생)은 그 상품의 `currency`(`ProductCurrency` — §4.0) 단위이고, **과세 축 금액**(과세 금융소득·원천징수세액·세액·보험료)은 상품 통화와 무관하게 **언제나 원화**다(DOC-002 M-08). 문자열 형식은 §4.0 Q-07. 「통화」를 단독으로 쓰지 않는다 — 기초자산 통화(`assets.currency`)와 다른 축이다(DOC-005 §8.11) |

---

## 3. 공통 계약

### 3.1 결과 타입

모든 변경 계약은 예외를 던지지 않고 결과 객체를 반환한다. 예외 기반 흐름은 클라이언트에서 필드별 오류 표시를 어렵게 한다.

```ts
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: ActionError }

type ActionError = {
  code: ErrorCode
  message: string                        // 사용자 표시용 (한글)
  fields?: Record<string, string>        // 필드별 검증 오류
}
```

조회 계약은 결과 객체를 사용하지 않는다. 미존재는 `null`을 반환하고, 시스템 오류는 예외로 전파하여 에러 경계에서 처리한다.

> **미인증에서 두 계약면이 다르게 행동한다 (v0.9).** 조회는 예외를 던지고(§4.0 Q-04) 변경은 `UNAUTHENTICATED`를 **결과 객체로** 반환한다. 대칭이 아닌 것이 의도다 — §3.2의 에러 코드 표는 처음부터 변경 계약의 `ActionError` 표이며 `UNAUTHENTICATED`가 그 첫 줄이다. 변경은 사용자가 입력을 들고 있는 시점에 일어나므로, 예외로 전파해 에러 경계가 화면을 갈아치우면 **입력값이 사라진다**(DOC-008 §6이 SCR-203·204에 "입력값 보존"을 요구한다). 조회에는 보존할 입력이 없다.

### 3.2 에러 코드

| 코드 | HTTP 대응 | 의미 | 화면 처리 |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 미인증 | SCR-001로 이동 |
| `FORBIDDEN` | 403 | 소유자 아님 | SCR-902 |
| `NOT_FOUND` | 404 | 대상 없음 | SCR-901 |
| `VALIDATION_FAILED` | 400 | 입력 검증 실패 | 필드별 오류 표시, 입력값 보존 |
| `CONFLICT` | 409 | 상태 충돌 (예: 이미 상환됨) | 안내 후 화면 갱신 |
| `PROVIDER_UNAVAILABLE` | 503 | 시세 공급자 오류 | 폴백 안내 (ST-03) |
| `INTERNAL` | 500 | 그 외 | 일반 오류 안내 |

#### 3.2.1 DB 오류 → `ErrorCode` (v0.9 신설)

**SQLSTATE는 거부의 *형태*이고 `ErrorCode`는 *화면 처리*다.** 둘은 1:1이 아니다 — 같은 `23514`가 "입력을 고치면 되는 일"과 "상태가 충돌해 안내 후 화면을 갱신해야 하는 일" 양쪽에서 나온다. 따라서 **제약 이름이 최종 판정자**다(DOC-002 §8 명명 규약).

| SQLSTATE | 기본 `ErrorCode` | 근거 |
|---|---|---|
| `23505`(UNIQUE) · `23503`(FK) | `CONFLICT` | 다른 행의 존재가 원인이므로 입력만 고쳐서 풀리지 않는다. I-01 이중 상환, `redemptions`의 `RESTRICT`(§5.3)가 이 자리다 |
| `23514`(CHECK · 트리거) | `VALIDATION_FAILED` | 단일 행 불변식이므로 그 행의 값이 원인이다. **단 제약 이름이 상태 충돌 부류(`*_redeemed_immutable` · `*_recorded_immutable` *(v4.16 명세 · 구현 P8 컷 b2)*)면 `CONFLICT`로 올린다.** 접미사 `*_immutable` 전체가 아니다 — `*_coordinates_immutable`은 검증 오류다(아래 「P8 달러」 블록) |
| `42501` | `FORBIDDEN` | RLS 위반과 권한 미부여를 구분하지 않는다 — 둘 다 "이 조회자는 이 조작을 할 수 없다"이고 화면 처리(SCR-902)가 같다 |
| `22001`(길이) · `22003`(자릿수) · `22007`(날짜 형식) · `22P02`(그 밖의 형식) · `23502`(널) | `VALIDATION_FAILED` | 값의 형태가 원인이다. **대부분 필드를 특정할 수 없다** — V-19·V-20이 그 앞에서 잡는 이유다. `23502`만 예외로 `message`에 열 이름이 온다 |
| 그 외 | `INTERNAL` | 원문 메시지를 사용자에게 노출하지 않고 로그에 남긴다 |

제약 이름 → `fields` 키의 사상은 다음과 같다. 대응하는 계약 계층 규칙이 정상 경로에서 먼저 잡으므로, **이 표가 쓰이는 것은 규칙이 놓친 경우**다.

| 제약 이름 | 규칙 | `fields` 키 |
|---|---|---|
| `redemptions_els_id_key` | I-01 | — |
| `els_underlyings_els_id_asset_id_key` | I-02 / V-09 | `underlyings` |
| `redemption_schedules_els_id_round_no_key` | I-03 / V-04 | `schedules` |
| `redemption_schedules_lizard_barrier_check` | I-04 / V-05 | `schedules` |
| `redemption_schedules_lizard_coupon_check` | I-10 / V-06 | `schedules` |
| `els_products_ki_pair_check` | I-11 / V-16 | `kiObservation` |
| `els_products_ki_touched_check` | I-15 / V-18 | `kiTouchedAt` |
| `redemptions_maturity_loss_check` | I-08 / V-12 | `taxableIncome` |
| `redemptions_taxable_income_check` | I-12 / V-11 | `taxableIncome` |
| `redemptions_round_no_required` | I-14 / V-13 | `roundNo` |
| `redemptions_els_id_round_no_fkey` | I-13 / V-14 | `roundNo` |
| `asset_prices_coordinates_immutable` | I-16 | `assetId` · `asOfDate` |
| `els_products_principal_check` | I-17 / V-01 | `principal` |
| `els_products_evaluation_period_check` | I-17 / V-20 | `evaluationPeriodMonths` |
| `els_products_full_terms_check` | I-18 | `issueDate` · `annualCouponRate` |
| `redemption_schedules_barrier_check` | I-17 / V-08 | `schedules` |
| `redemptions_gross_amount_check` | I-17 | `grossAmount` |
| `els_products_principal_scale_check` | I-21 / V-23 | `principal` |
| `redemptions_gross_amount_digits_check` | I-21 / V-23 | `grossAmount` |
| `redemptions_gross_amount_scale` | I-21 / V-23 | `grossAmount` |
| `redemptions_exchange_rate_check` | I-22 / V-24 | `exchangeRate` |
| `exchange_rates_currency_check` | I-22 / V-24 | `currency` |
| `exchange_rates_rate_check` | I-22 / V-24 | `rate` |
| `exchange_rates_coordinates_immutable` | I-22 | `currency` · `asOfDate` |
| `els_products_underlyings_required` | I-07 / V-02 | `underlyings` |
| `els_products_schedules_required` | I-07 / V-03 | `schedules` |
| `els_products_redeemed_immutable` | 상태 충돌 → `CONFLICT` | — |
| `redemptions_els_id_fkey` | I-01 / §5.3 | — |
| `els_underlyings_asset_id_fkey` | §8.1 | `underlyings` |
| `assets_name_market_key` | §5.10 | `name` · `market` |
| `tax_profiles_user_id_tax_year_key` | I-06 | `year` |
| `asset_prices_asset_id_as_of_date_key` | I-05 | `asOfDate` |
| `exchange_rates_currency_as_of_date_key` | I-22 | `asOfDate` |

**이 표는 `errors.ts`의 `BY_CONSTRAINT`와 양방향으로 일치한다 (v1.1).** `tests/db/docs-contract.test.ts`가 이 표를 파싱해 이름 집합·`규칙`·`fields` 키를 대조하므로, 한쪽만 늘거나 줄면 실패한다. v1.0까지 이 표는 **9행이 모자랐고**(`redemptions_els_id_key`·`assets_name_market_key` 등 계약 경로에서 도달 가능한 것들이다) 대조 단언이 `arrayContaining`이라 여분을 영원히 허용했다 — 문서가 코드보다 뒤처진 사실이 어느 테스트도 실패시키지 않는 상태였다. **한 행에 이름을 둘 싣지 않는다** — `*_required` 두 개를 합쳐 두었던 행을 v1.1에서 갈랐다. 합치면 `규칙` 열의 `I-07 / V-02 · V-03`을 이름과 짝지어 분해해야 하고, 그 특수 처리가 파서에만 존재하게 된다.

**배열 인덱스를 붙이지 않는다.** DB 오류는 몇 번째 원소가 위반했는지 말하지 않는다. 인덱스가 있는 경로(`schedules[3].lizardBarrier`)는 계약 계층 검증이 담당하고, DB까지 도달한 것은 배열 단위로 표시한다 — 없는 정보를 지어내면 사용자가 엉뚱한 행을 고친다.

> **P8 달러 — 새 제약·라벨의 사상 (v4.9 선행 명세 — P8 컷 a1. 표 행은 해당 마이그레이션의 코드 커밋에 함께).** 위 표는 `BY_CONSTRAINT`와 양방향으로 대조되므로(바로 위) 이름이 코드보다 먼저 서면 그 커밋이 빨간불이다. 그래서 여기에 산문으로 적고 행은 그 커밋이 더한다. `규칙` 열의 불변식 번호는 DOC-002 I-21·I-22다.
>
> - **컷 a2 (M-a2)**
>   - `els_products_principal_scale_check` — `CHECK`. I-21 / V-23 · `principal`. 통화별 보조단위를 `coalesce(case currency … end, -1)`로 고르므로 **열거에 새 값이 생기면 닫힌 쪽으로 실패한다**(fail-closed — `else 2`였다면 새 통화가 조용히 소수 2자리를 받는다). 정수부 15자리 천장도 이 제약이 든다 — typmod를 떼면 `22003`(열 이름 없음)이던 거부가 **이름 있는** `23514`가 된다
>   - `redemptions_gross_amount_digits_check` — `CHECK`(`gross_amount < 1e15 and scale(gross_amount) <= 2`). I-21 / V-23 · `grossAmount`. **통화와 무관한 부분**(정수부 15자리 · 어느 통화든 소수 2자리 이하)은 한 행 안에서 판정되므로 트리거가 아니라 `CHECK`에 둔다 — 데이터 전용 복원은 트리거를 돌리지 않지만(`session_replication_role = replica`) `CHECK`는 **다시 검사한다**
>   - `redemptions_gross_amount_scale` — **트리거 라벨**(`RAISE`). `check_amount_scale_by_currency()`가 부모 상품의 `currency`를 읽는다 — `CHECK`는 다른 행을 볼 수 없다. **통화에 따라 갈리는 부분만** 본다(원화 부모 ⇒ 소수 0자리. 모르는 통화는 거부 — fail-closed). I-21 / V-23 · `grossAmount`. `tests/rls/constraint-names.test.ts`의 `RAISE_ONLY`에 함께 들고, 위 ①대로 `detail` 첫 줄에 `constraint=<이름>`을 싣는다. **라벨은 테이블마다 리터럴로 쓴다** — 그 테스트가 마이그레이션 텍스트에서 문자열을 찾으므로, 컷 b2가 같은 함수를 월수익 지급 기록에 걸 때도 테이블마다 분기하고 `TG_TABLE_NAME`으로 조립하지 않는다(DOC-002 §4.9)
>   - `redemptions_exchange_rate_check` — `CHECK`(`exchange_rate > 0`). I-22 / V-24 · `exchangeRate`
>   - 널 위반 `currency` → `fields.currency` — **`NOT_NULL_FIELD`에 이미 있다.** `assets.currency` 때문에 있던 키이고 사상이 **열 이름**으로 걸리므로 `els_products.currency`가 같은 키를 쓴다 — 행을 더하지 않는다. 이 경로는 확장 웨이브 동안 열 기본값이 가리므로 **축소 마이그레이션(M-a2c, 컷 a3) 이후에만 도달한다**(§5.1 — SB-12의 영구 단언)
> - **컷 a3 (M-a3 — `exchange_rates`)**
>   - `exchange_rates_currency_as_of_date_key` — `UNIQUE`. I-22 · `asOfDate`. §5.13이 UPSERT라 정상 경로에서는 도달하지 않는다 — `asset_prices_asset_id_as_of_date_key`(I-05)가 같은 사정인데도 표에 있는 것과 같다
>   - `exchange_rates_currency_check` — `CHECK`(`currency <> 'KRW'`). I-22 / V-24 · `currency`
>   - `exchange_rates_rate_check` — `CHECK`(`rate > 0`). I-22 / V-24 · `rate`
>   - `exchange_rates_coordinates_immutable` — **트리거 라벨**(I-16의 형태). I-22 · `currency` · `asOfDate`. `RAISE_ONLY`에 든다. **`VALIDATION_FAILED`다 — `CONFLICT`가 아니다**: 접미사 `*_immutable`을 상태 충돌로 일반화하지 않는다(`asset_prices_coordinates_immutable`이 같은 이유로 검증 오류다. 상태 충돌 접미사 `*_recorded_immutable`은 컷 b1의 몫이다)
>   - `exchange_rates_provider_check` — `CHECK`(`(source = 'AUTO') = (provider is not null)`). **사상하지 않는다 — `NOT_USER_REACHABLE`**(`tests/rls/constraint-names.test.ts`). 수집기만 `AUTO`를 쓰고 수동 입력(§5.13)은 `provider = null`을 **명시해** 실으므로 사용자 입력에서 도달하지 않는다 — **그 명시가 이 분류의 전제다**(§5.13 ★)

> **P8 월지급 — 새 제약·라벨의 사상 (v4.16 선행 명세 — P8 컷 b1. 표 행은 해당 마이그레이션의 코드 커밋(b2 · b4)에 함께).** 위 달러 블록과 같은 이유로 산문이다 — 위 표는 `BY_CONSTRAINT`와 양방향으로 대조되므로 이름이 코드보다 먼저 서면 그 커밋이 빨간불이다. 불변식 번호는 DOC-002 I-23~I-27, 규칙 번호는 §6 말미 「P8 월지급 — 규칙 일곱」이다. 트리거 라벨은 전부 `RAISE_ONLY`에 들고 위 ①대로 `detail` 첫 줄에 `constraint=<이름>`을 싣는다.
>
> - **컷 b2 (M-b2 — 열 · 두 테이블 · 트리거 · 쓰기 함수 꼬리 검사)**
>   - `els_products_monthly_terms_check` — `CHECK`(단일 행). I-23 / V-25 · V-08′. `entry_mode = 'FULL'`이면 — `MONTHLY ⇒ annual_coupon_rate = 0 ∧ monthly_coupon_annual_rate > 0`, `AT_REDEMPTION ⇒ monthly_coupon_annual_rate IS NULL`. **`entry_mode = 'REALIZED_ONLY'`이면 `monthly_coupon_annual_rate IS NULL`**(b1 개정 — DOC-002 DQ-17 ③ 해결. 비용 0으로 기실현에 월수익 조건이 남지 않게 한다 — D-07, 계약 조건이 없다). 식은 `coalesce(…, false)`로 감싼다 — `CHECK`는 `NULL`을 통과로 보므로 감싸지 않으면 `FULL` ∧ `MONTHLY` ∧ 월수익 연쿠폰율 `NULL`이 지난다(DOC-002 §8 I-23 각주 — 같은 개정에서 찾은 구멍). 율의 DB 쪽은 `> 0`뿐이고 상한은 계약(V-25 — V-08과 같은 상한, b1 개정)에만 있다 — 율 범위 `CHECK`가 없기 때문이다(받아들인 이탈). 필드는 `couponPayout`이다(b1 개정). 월지급 행에 연쿠폰율로 헤드라인 율을 넣으면 이 제약이 V-25와 함께 거부한다 — 이중 계상(DOC-005 「월수익 연쿠폰율」)
>   - `els_products_monthly_schedules_required` · `els_products_monthly_schedules_forbidden` · `els_products_monthly_lizard_forbidden` — **쓰기 함수 꼬리 검사의 라벨**(RPC 셋을 `create or replace` — `els_products_*_required`와 같은 형태). I-25 / V-25. 차례로 `FULL ∧ MONTHLY`인데 월수익 일정 0행 · `AT_REDEMPTION`인데 월수익 일정 행 있음 · `MONTHLY`인데 리자드 차수(월지급+리자드는 v2). 셋 다 `VALIDATION_FAILED`이고 필드는 `couponSchedules` · `schedules`다(일정 둘은 `couponSchedules`, 리자드는 `schedules`). **직접 INSERT로 우회하는 경로는 AQ-29 부류다** — `MONTHLY` 0행은 조회가 결함 `COUPON_SCHEDULE_MISSING`으로 탐지하고(§4.2), `AT_REDEMPTION` 아래의 일정 행은 **계산과 §4.12가 지급방식으로 거르므로 무해하다**(등재만 — b1 개정. §4.12의 자기 루트 쿼리는 일정 행을 루트로 읽으므로 부모 `coupon_payout = 'MONTHLY'` 조건이 그 무해함의 전제다)
>   - `els_products_coupon_recorded_immutable` — **트리거 라벨**. `els_products`의 `BEFORE UPDATE OF currency, coupon_payout` — 값이 바뀌고 그 상품에 `monthly_coupon_payments` 행이 있으면 거부한다. **상태 충돌 → `CONFLICT`**(DOC-002 DQ-14 · 민서 결정(2026-10-02) ④ — 어떤 쓰기 경로든 막는다. 단일 요청 순서에서다 — 첫 기록 INSERT와 동시에 도는 변경은 write skew로 둘 다 지날 수 있다, DOC-010 AQ-93). `fields` 없음 — `els_products_redeemed_immutable`과 같은 부류다
>   - `monthly_coupon_schedules_recorded_immutable` — **트리거 라벨**. `BEFORE UPDATE OF evaluation_date, payment_date, coupon_no` — **세 열 중 하나라도 OLD와 NEW가 다르고(`IS DISTINCT FROM`)** 그 달에 기록이 있으면 거부한다(b1 개정 — DOC-002 §4.13 · DQ-14 · DOC-010 AQ-79와 같은 문언). **상태 충돌 → `CONFLICT`**. 기록된 달의 행 **삭제**는 복합 FK `RESTRICT`가 막는다(`23503` → `CONFLICT` — 위 SQLSTATE 표의 기존 사상). ★ **값이 바뀔 때만 거부해야 한다** — §5.2가 기록된 달의 행을 `coupon_no` 기준 upsert로 같은 값을 다시 대입하므로(월수익 배리어는 고칠 수 있다), 「`UPDATE OF` 열」만으로 거부하면 기록이 있는 상품의 수정이 전부 거부된다 — PostgreSQL의 `UPDATE OF` 트리거는 값이 같아도 그 열이 `SET` 목록에 있으면 발화한다. `*_coordinates_immutable`이 §5.7·§5.13의 동일값 재대입을 통과시키는 것과 같은 형태다(I-16 · I-22). b2의 테스트 목록에 「동일값 재대입은 통과한다」를 단언으로 둔다 — 그 단언이 없으면 조건을 빠뜨린 트리거가 기록 없는 상품의 수정에서는 초록이다
>   - **접미사 `*_recorded_immutable`이 상태 충돌 부류에 든다** — `*_immutable` 전체로 일반화하지 않는다(`*_coordinates_immutable` 둘은 `VALIDATION_FAILED` — 위 달러 블록). 위 SQLSTATE 표의 `23514` 행이 두 이름을 함께 적는다
>   - `monthly_coupon_payments_outcome_check` — `CHECK`(단일 행). I-26 / V-28. `PAID ⇒ payment_date · gross_amount · taxable_income NOT NULL ∧ gross_amount > 0` · `UNPAID ⇒ payment_date · gross_amount · taxable_income · withholding_tax · exchange_rate 전부 NULL ∧ coupon_no NOT NULL`(미지급은 그 달을 가리켜야 의미가 있다 — 기실현의 순번 없는 미지급은 받지 않는다)
>   - `monthly_coupon_payments_gross_amount_digits_check` — `CHECK`(정수부 15 · scale ≤ 2). I-26 / V-23. `redemptions_gross_amount_digits_check`와 같은 이유로 `CHECK`다 — 데이터 전용 복원이 다시 검사한다
>   - `monthly_coupon_payments_gross_amount_scale` — **트리거 라벨**(원화 부모 ⇒ 소수 0자리). I-26 / V-23. `check_amount_scale_by_currency()`를 이 테이블에 걸되 **라벨은 리터럴이다** — 위 달러 블록의 「테이블마다 분기하고 `TG_TABLE_NAME`으로 조립하지 않는다」를 이 컷이 지킨다
>   - `monthly_coupon_payments_monthly_required` · `monthly_coupon_payments_coupon_no_required` · `monthly_coupon_payments_after_redemption` — **부모 트리거 라벨**. I-27 / V-27. 차례로 부모 `coupon_payout = 'MONTHLY'`(DQ-07 ③) · 부모 `FULL` ⇒ `coupon_no NOT NULL`, 부모 `REALIZED_ONLY` ⇒ `coupon_no IS NULL ∧ outcome = 'PAID'` · **부모에 상환이 있고 그 달 일정의 `evaluation_date > redemption_date`면 거부**(DQ-07 ② — 상환 뒤에 평가된 달의 기록은 흐름 밖 사건을 F에 넣는다). **결과(`PAID` · `UNPAID`)를 가리지 않는다** — 상환 쪽 트리거도 같은 집합을 본다(아래 — 대칭, b1 개정). **비교 키는 지급일이 아니라 그 달의 월수익 평가일이다**(b1 개정 — 흐름 끝 `t_k ≤ T_end`와 같은 키, DOC-007 RD-18 해결). 지급일로 비교하면 상환 대금이 그 달 월수익보다 하루라도 먼저 지급되는 상품에서 같은 날 평가된 마지막 월수익을 기록할 수 없다. **순번 없는 기실현 기록(`coupon_no IS NULL`)은 평가일이 없어 이 검사 밖이다** — 거래내역의 사실을 옮긴 것이다(등재만). 셋 다 `23514`이고 상태 충돌 접미사가 아니므로 위 SQLSTATE 표의 기본값은 `VALIDATION_FAILED`이며, 필드는 아래 「`fields` 키」의 여섯 중 하나다(제약마다의 사상 행은 b2 코드 커밋 — b1 개정). **다만 `monthly_coupon_payments_after_redemption`의 `ErrorCode`와 여섯 중 어느 칸인지, 그리고 접미사 표에 없는 라벨 셋(`*_after_redemption` · `*_before_coupon_payment` · `*_principal_only`)에 접미사 행을 둘지는 DOC-002 DQ-17 ②가 미결로 들고 있다**(b2 전에 정한다 — b1 개정은 키의 모양만 정했다)
>   - `redemptions_before_coupon_payment` · `redemptions_monthly_principal_only` — **`redemptions`의 트리거 라벨**(DQ-07 ②의 반대쪽 · ⑤ — DOC-010 AQ-87 ⓑ의 DB 쪽 강제). 상환 INSERT·UPDATE 때 `redemption_date <` **기록된 달(`PAID` · `UNPAID`)들의 `evaluation_date` 최댓값**이면 거부(b1 개정 — 위 `monthly_coupon_payments_after_redemption`과 같은 키이고 **같은 집합이다**. 순번 없는 기록은 평가일이 없어 세지 않는다) · 부모 `MONTHLY`면 `gross_amount <= principal ∧ taxable_income = 0`. 둘 다 `VALIDATION_FAILED`이고 필드는 `redemptionDate` · `grossAmount`/`taxableIncome`. **두 방향이 같은 집합을 보는 이유**(b1 개정 — 반박 검토 반영): 상환 쪽이 `PAID`만 보면 미지급 기록이 있는 채로 상환일을 그 달 평가일 앞으로 옮길 수 있고, 그렇게 흐름 끝 뒤에 남은 미지급 기록은 기록 쪽 트리거가 `UPDATE`에도 돌므로 비고 하나 고칠 수 없게 된다(지우기만 된다). 계약 규칙 V-29(§5.4·§5.5·§5.11)는 컷 b4이므로 **b2~b4 사이에는 `redemptions_monthly_principal_only`가 먼저 서고** 그 경로의 응답은 이 사상이다. `redemptions_before_coupon_payment`의 계약 겹(V-27의 양방향 사전 검사)은 b2에 함께 선다(§5.4). 교차 테이블 트리거 둘(기록 ↔ 상환)과 위 동결 트리거는 **단일 요청 순서에서** 막는다 — 각자 상대 테이블의 커밋된 행만 보므로 동시 트랜잭션의 write skew(READ COMMITTED)는 막지 못한다(DOC-010 AQ-93 — 부모 행 `SELECT … FOR UPDATE`로 직렬화할지 b2 전에 판단)
>   - **그 밖의 이름은 b2 마이그레이션이 정하고 그 커밋이 행을 더한다** — `monthly_coupon_schedules`의 I-24 넷(`UNIQUE(els_id, coupon_no)` · `coupon_no >= 1` · 월수익 배리어 범위 · `payment_date >= evaluation_date`) · `els_id` FK(`CASCADE` — 부모 삭제로는 오류가 나지 않는다. 기존 `redemption_schedules_els_id_fkey`도 위 표에 없다)와 `monthly_coupon_payments`의 `UNIQUE` 둘(`(els_id, coupon_no)` · `(els_id, payment_date)`) · 복합 FK `(els_id, coupon_no)` · `els_id` FK · **`coupon_no >= 1` `CHECK`**(I-26 — 일정과 같은 방어, V-20′) · 값 범위 셋(`taxable_income >= 0` · `withholding_tax >= 0` · `exchange_rate > 0`) *(두 이름은 b1 개정 — 반박 검토 반영으로 더했다)*. **SQLSTATE 기본값이 그대로 맞는다** — `UNIQUE`·FK는 `CONFLICT`, `CHECK`는 `VALIDATION_FAILED`. `monthly_coupon_payments.els_id`의 `RESTRICT`는 §5.3에서 `redemptions_els_id_fkey`와 같은 `CONFLICT`다. `UNIQUE(els_id, payment_date)`의 `CONFLICT`는 경합에서만 닿는다 — 정상 경로의 지급일 중복은 V-28이 행 키(`entries[i].paymentDate`)로 먼저 낸다(b1 개정)
>   - **`fields` 키 — 색인 없는 이름이다** *(b1 개정 — §9 ① 해결)*. DB 제약 → `fields`는 위 「배열 인덱스를 붙이지 않는다」 그대로다: **월수익 지급 기록의 제약은 `paymentDate` · `grossAmount` · `taxableIncome` · `withholdingTax` · `outcome` · `couponNo`, 월수익 일정의 제약은 `couponSchedules`, 지급방식 짝(I-23)은 `couponPayout`**이다. §5.14(다행)와 §5.15(한 행)가 같은 키를 받는다. **행 단위 키(`entries[i].…` · `couponSchedules[i].…`)는 계약 계층의 사전 검증(V-25~V-28)이 낸다** — DB 오류는 그 검증을 지난 뒤의 마지막 그물이므로 몇 번째 행인지 말하지 못해도 된다. 정확한 사상 행(제약마다 어느 키인가)은 b2의 코드 커밋이 위 표에 더한다(`BY_CONSTRAINT` 결속). `NOT_NULL_FIELD`는 **열 이름**으로 걸리므로 — `monthly_coupon_payments.is_confirmed` → `isConfirmed`는 이 원칙대로이고, `monthly_coupon_schedules`의 열(`evaluation_date` 등)의 널 위반은 이 원칙으로 `couponSchedules`여야 하므로 조기상환 일정의 `evaluationDate`와 **테이블로 갈라** 사상하는 일이 그 커밋에 든다(정상 경로에서는 계약 계층이 먼저 막아 도달하지 않는다)
> - **컷 b4 (M-b2c — 지급방식 기본값 제거)**
>   - 널 위반 `coupon_payout` → `fields.couponPayout` — **`NOT_NULL_FIELD`에 새 키가 필요하다**(`currency`와 달리 기존 키가 없다). 확장 웨이브(W4) 동안 열 기본값이 가리므로 **축소(M-b2c) 이후에만 도달한다**(§5.1 — SB-12의 거울)

**제약 이름의 출처 — 실측 (P3b 2단계).** `PostgrestError`는 `{code, message, details, hint}` 넷뿐이고 `pg`가 주는 `constraint` 필드가 **없다.** 실제 JWT로 열 형태를 위반시켜 본문을 측정했다(`tests/integration/error-shape.test.ts`가 이 표를 고정한다).

| 형태 | `code` | 이름·열의 위치 | `details` |
|---|---|---|---|
| 표준 `CHECK` | `23514` | `message`: `… violates check constraint "els_products_ki_pair_check"` | `null` |
| `UNIQUE` | `23505` | `message`: `duplicate key value violates unique constraint "assets_name_market_key"` | `null` — 키 값을 노출하지 않는다 |
| FK `RESTRICT` | `23503` | `message`: `… violates foreign key constraint "redemptions_els_id_fkey" …` | `Key is still referenced from table "redemptions".` |
| **plpgsql `RAISE`** | `23514` | **없다** — `message`는 한글 문구, `details`·`hint`는 `null` | `null` |
| RLS 정책 위반 | `42501` | 이름 없음. `message`에 `row-level security` | `null` |
| 권한 미부여 | `42501` | 이름 없음. `message`에 `permission denied` | `null` (`hint`에 `GRANT …` 문장) |
| 길이 초과 | `22001` | **열 이름 없음.** `value too long for type character varying(100)` — 타입만 말한다 | `null` |
| 자릿수 초과 | `22003` | **열 이름 없음.** `numeric field overflow` | `precision 18, scale 6 …` |
| 날짜 형식 | **`22007`** | `invalid input syntax for type date: "…"` | `null` |
| 널 위반 | `23502` | `message`에 **열 이름이 있다**: `null value in column "currency" of relation "assets" …` | `null` |

**두 가지가 명세를 고쳤다.**

① **plpgsql `RAISE`의 `constraint` 옵션은 HTTP 경계를 넘지 못한다.** I-16 트리거는 `using errcode = '23514', constraint = 'asset_prices_coordinates_immutable'`로 던지고 `tests/rls/`는 그 이름을 단언하는데, 그쪽은 `pg` **직결**이다. PostgREST를 지나면 이름을 얻을 채널이 **하나도 없다.** 그대로 두면 `saveManualPrice`의 유일한 `23514` 경로가 `fields`를 잃고, §5.7이 요구한 `assetId`·`asOfDate` 표시가 불가능해진다.

따라서 **plpgsql `RAISE`는 `detail`에도 이름을 싣는다** — 형식은 `details`의 **첫 줄**을 `constraint=<이름>`으로 고정한다. `constraint` 옵션은 `pg` 경로를 위해 **그대로 유지한다**(두 채널을 다 채우는 것이 어느 테스트도 깨지 않는 유일한 형태다). 계약 계층은 `message`의 `constraint "…"`를 먼저 보고, 없으면 `details`의 첫 줄을 본다.

② **날짜 형식 오류는 `22P02`가 아니라 `22007`이다.** `22P02`(`invalid_text_representation`)는 `uuid`·`numeric` 등에 나오고 `date`·`timestamp`는 `22007`(`invalid_datetime_format`)이다. 매핑에서 빠뜨리면 **잘못 입력한 날짜가 `INTERNAL`로 떨어진다** — 사용자가 고칠 수 있는 오류를 시스템 오류로 보고하는 형태다.

> **`22001`·`22003`이 열 이름을 주지 않는다는 것이 실측으로 확인됐다.** 이것이 V-19·V-20을 신설한 근거이며, 두 규칙 없이는 §3.2의 `VALIDATION_FAILED` 정의("필드별 오류 표시")를 만족하는 응답을 만들 수 없다. `varchar(100)`인 열이 둘 이상이면 추정조차 되지 않는다.

#### 3.2.2 순수 모듈의 예외 → `ErrorCode` (AQ-17 종결, v0.9)

`lib/domain`·`lib/tax`는 전제 위반을 `RangeError`로 거부한다(DOC-007 §3.1 등). 변경 계약은 예외를 던질 수 없으므로(§3.1) 이를 코드로 바꿔야 하는데, **예외 클래스로는 분류할 수 없다** — 같은 `RangeError`가 사용자 입력의 오류(`dec('abc')`)와 저장된 상태의 결함(`worstOf([])`) 양쪽에서 나오고, 둘의 화면 처리는 정반대다.

**따라서 예외가 아니라 호출 지점이 코드를 부여한다.** 순수 모듈을 부르는 자리마다 어느 부류인지 함께 적는다.

| 호출 지점 | 던지는 조건 | `ErrorCode` |
|---|---|---|
| `attributionYear` 등 날짜를 받는 순수 함수 (§5.4의 귀속연도 · §5.14·§5.15의 월수익 지급일 *(v4.16)*) | 날짜 형식 · 존재하지 않는 날짜 | `VALIDATION_FAILED` + 해당 날짜 필드 (§5.14는 `entries[i].paymentDate`) |
| `dec()` (금액 · 비율 파싱) | 유한한 수가 아님 | `VALIDATION_FAILED` + 해당 필드 |
| `assertPositiveInteger` | 양의 정수가 아님 | `VALIDATION_FAILED` + 해당 필드 |
| `loadTaxYearContext` · `toTaxConstants` (§5.4 원천징수 산출 · §5.14·§5.15 *(v4.16)*) | 세율 시드 없음 · 상수 누락 | `INTERNAL` (시드 범위보다 과거인 해는 §5.4 v1.7대로 `VALIDATION_FAILED` + `withholdingTax` — §5.14는 `entries[i].withholdingTax`, DOC-007 RD-16) |
| **그 밖의 모든 `RangeError`** | — | `INTERNAL` + 로그 |

> **§6의 검증이 순수 모듈 호출보다 앞선다.** 위 표는 그 앞선 검증을 통과한 뒤에도 남는 경로를 위한 것이다 — 예컨대 V-07은 날짜를 **문자열로** 비교한다(형식이 이미 `YYYY-MM-DD`로 검증되었으므로 사전순이 곧 시간순이다). 순수 모듈에 날짜를 넘기면 그쪽의 `RangeError`를 다시 변환해야 하므로, 변환 지점을 늘리지 않는 쪽을 고른다. 남는 것은 **계약이 저장된 값을 순수 모듈에 넘기는 자리**다.

**`CONFLICT`는 순수 모듈 예외에서 나오지 않는다.** 이것이 AQ-17이 물은 "`INTERNAL`인지 `CONFLICT`인지"의 답이다. 순수 모듈은 자기가 받은 인자만 보므로 "이미 상환됨"·"기초자산 0건"을 **알 수 있는 위치에 없다.** 상태 충돌은 계약 계층의 사전 조회와 DB 오류(§3.2.1)가 판정하며, 그 둘이 이미 그 일을 하고 있다.

**기본값을 `INTERNAL`로 두는 이유.** 예상 밖의 `RangeError`가 나왔다면 그것은 §6의 검증 규칙에 구멍이 있다는 신호다. `VALIDATION_FAILED`로 내면 사용자에게 **고칠 수 없는 것을 고치라고** 요구하게 되고(어느 필드가 원인인지 우리도 모른다), 그 화면은 사용자가 몇 번을 다시 입력해도 같은 오류를 낸다. §4.0 Q-06이 절단을 삼키지 않고 던져서 AQ-09의 신호로 만든 것과 같은 형태다 — 조용히 그럴싸한 응답으로 바꾸지 않는다.

### 3.3 권한 검증

권한은 **RLS가 1차로 강제**한다(ADR-002). 계약 계층은 사용자에게 적절한 오류를 반환하기 위해 보조 검증을 수행한다.

| 계층 | 역할 |
|---|---|
| RLS | 최종 강제. 우회 불가 |
| 계약 계층 | 사전 확인 후 `FORBIDDEN` 반환. UX 목적 |

계약 계층 검증이 누락되어도 데이터는 보호된다. 반대로 계약 계층만 검증하고 RLS가 없으면 보호되지 않는다.

---

## 4. 조회 계약

### 4.0 공통 조회 컨텍스트

본 절의 서명은 모두 **컨텍스트가 결속된 형태**다. 구현은 다음 컨텍스트를 받는 팩토리가 계약 함수를 생성하며, 서명 자체에는 컨텍스트가 나타나지 않는다.

```ts
type QueryContext = {
  db: UserSessionClient     // 로그인 사용자 세션. service_role을 쓰지 않는다
  asOf: string              // 기준일 (YYYY-MM-DD, Asia/Seoul)
  viewerId: string          // 조회자. isOwner·isMe·scope·본인 판정의 기준
}
```

| ID | 규약 | 근거 |
|---|---|---|
| Q-01 | 조회는 **사용자 세션으로만** 수행한다. `service_role`은 편의로도 쓰지 않는다 | RLS를 우회하면 정책 40개(v4.12 — `exchange_rates` 3. v4.8에 「32개」를 37로 정정 · 컷 b2 뒤 48 — 월수익 두 테이블에 넷씩, v4.16 명세)가 실제로 작동하는지 어떤 테스트도 증명하지 못한다 (ADR-002) |
| Q-02 | **기준일은 `Asia/Seoul` 기준으로 산출**하고 요청당 한 번만 해석한다 | 실행 환경(Vercel·Node)은 UTC다. UTC 날짜를 쓰면 매일 KST 00:00~09:00 동안 **전날**이 기준일이 되어 D-Day가 하루 어긋나고, "오늘"인 평가일이 미래로 분류되며, 경과 차수를 놓치고, 1월 1일 KST에는 귀속연도가 전년이 되어 세율 연도까지 어긋난다. 두 계약이 각자 오늘을 구하면 자정을 걸친 렌더에 한 화면 두 기준일이 생긴다 |
| Q-03 | 기준일은 순수 모듈과 **같은 값을 공유**한다 | DOC-007 §9.2의 `asOf`, `nextEvaluation`·`isPast`·`dDay`가 이미 기준일을 인자로 받는다 |
| Q-04 | 미인증 상태(`viewerId` 부재)에서 조회 계약은 **예외를 던진다** | §3.1대로 조회는 결과 객체를 쓰지 않는다. §3.2의 `UNAUTHENTICATED`는 변경 계약의 `ActionError` 표이므로 조회에 적용되지 않는다. SCR-001 유도는 화면 층의 책임이다 |
| Q-05 | 파생값 기반 필터·정렬은 **조회 후 적용**한다 | `status`·`kiStatus`·`conditionResult`·D-Day는 저장된 열이 아니라 판정 결과다. 반대로 `ownerId`·평가일 범위·미상환 여부는 열 조건이므로 질의로 내린다 |
| Q-06 | 결과가 서버 상한에 걸려 잘리면 **예외를 던진다.** 잘린 목록을 반환하지 않는다 | 조용히 넘기면 화면은 정상으로 보이고 목록만 짧아진다. 현재 규모(A-01)에서는 도달 불가하며, **도달했다면 AQ-09(페이지네이션)를 닫아야 한다는 신호**다. **감지는 두 임계로 한다 (v2.3에서 반전)** — 요청 상한을 서버 상한과 **같게** 두고(`TRUNCATION_PROBE_LIMIT = [api].max_rows`) 앱 임계를 그보다 **하나 작게** 둔다(`APP_MAX_ROWS = 서버 상한 − 1`). 서버가 깎지 않고 건넨 최대치가 곧 발화 조건이 된다 |
| Q-07 | 금액은 **통화 보조단위 자릿수로 고정한 문자열**, 비율은 **소수 4자리 고정 문자열**, 시세·**환율**은 **소수 6자리 고정 문자열**로 전달한다. **금액은 두 부류다 (v4.9 개정 — 선행 명세, 구현 P8 컷 a2)** — ⓐ **상품 통화 금액**(`principal`·`grossAmount`·`expectedGross`·`realizedPnl`·`activePrincipal`(`krwEstimate.activePrincipal`은 ⓑ), §4.4 `proceeds`의 금액 넷 — 달러 상품의 예상 원천징수도 여기다)은 그 상품 통화의 보조단위 자릿수다: KRW 0자리(`'100000000'`) · USD **정확히** 2자리(`'10000.50'`). `moneyString(value, currency)`가 만들고 **통화 인자에 기본값이 없다.** DB는 USD 금액의 소수 자릿수를 **2 이하**로만 강제하지만(DOC-002 I-21 — `10000.5`도 저장된다) 읽기에서 `moneyString`이 정확히 2자리로 정규화하므로, 이 고정 형식은 **저장된 어떤 값에도** 선다 ⓑ **과세 축 금액**(`taxableIncome`·`withholdingTax`·금융소득·세액·보험료·`thresholdGap`)과 **원화 환산 추정값**(`krwEstimate.activePrincipal` · §4.7의 원화 합계 열)은 **언제나 원화 정수**다 — `amountString`이며 종전과 바이트 동일하다. 환율은 시세와 같은 부류다(아래 「Q-07′」 각주) | §2가 형식을 정하지 않았다. 워스트오브는 나눗셈이므로 고정소수점 연산 결과를 그대로 문자열화하면 40자리가 나올 수 있고, 화면이 그것을 렌더링한다. 4자리는 저장 정밀도(`numeric(6,4)`)와 일치한다. 시세는 두 분류 어디에도 맞지 않는다 — 정수로 반올림하면 `412.55 → "413"`으로 값이 망가지고, 4자리로 접으면 저장 정밀도(`numeric(18,6)`)를 잃는다. **v4.9 개정의 근거** — 종전 「정수 문자열」은 모든 금액이 원이던 동안의 형식이다. 달러 금액을 정수로 접으면 `$10,000.50`이 `'10001'`이 되고 **형식 검사(`/^-?\d+$/`)를 통과한다** — 값만 틀린다. 통화 인자에 기본값을 두면 통화를 빠뜨린 호출부가 컴파일되고 조용히 원화가 된다(V-22가 입력에 기본값을 두지 않는 것과 같은 이유). KRW 분기는 `amountString`에 위임하므로 원화 전용 포트폴리오(현재 운영 전부로 보인다 — §4.1 「통화별 합계」)의 **모든 금액 문자열이** 바이트 단위로 같다. **응답 전체가 같은 것은 아니다** — 모양이 바뀐다: `currency`·`byCurrency`·`unconvertedCount`·`excludedForeignCount`·`exchangeRate: null` 등이 더해지고 `totals.activePrincipal`·`totals.realizedPnl`·`UserSummary.activePrincipal`은 통화별 필드로 옮겨 가며 최상위에서 사라진다 |
| Q-08 | 금액·비율은 DB 경계에서 **문자열로 수신**한다 | 수치형으로 받으면 JSON 파싱이 부동소수점을 경유한다(M-03, 절대 규칙 #2). 15자리 이내 금액은 부동소수점으로도 값이 맞아떨어지므로 **값 단언으로는 검출되지 않는다** — 타입 층에서 막는다 |

> **컨텍스트를 서명에 넣지 않는 이유.** 본 문서는 함수 시그니처를 계약으로 취급한다(§1.1). 컨텍스트를 인자로 노출하면 화면이 계약을 호출할 때마다 기준일·조회자를 직접 전달하게 되고, 그 순간 "요청당 한 번"(Q-02)이 규율이 된다. 결속을 팩토리로 옮기면 §4.1~§4.9의 서명이 문서 그대로 유지되면서 Q-02가 구조로 보장된다.

> **Q-06의 감지 방식을 v2.3에서 반전했다 — 그 전의 판단이 거짓 전제 위에 서 있었다.** v0.7~v2.2는
> 「감지는 `= 상한`이 아니라 `limit(상한 + 1)` 요청 후 `> 상한`으로 한다 — **정확히 상한 행수인 정상 결과를
> 오탐하지 않기 위함이다**」로 적었다. 그 판단은 **서버가 `상한 + 1`을 줄 수 있다고 전제**했고 그 전제가
> 거짓이었다. PostgREST의 `db-max-rows`는 클라이언트 `limit`을 상한으로 **깎는다**(오류가 아니다) —
> 실측(P4.5): 1,201행 테이블에 `limit=1001`·`limit=1200`을 각각 요청해 **둘 다 1000행**이 돌아왔다
> (`Content-Range: 0-999/*`, 상태 **200** — 206도 아니다). 즉 응답 행수가 서버 상한을 넘을 수 없으므로
> 임계가 상한과 같으면 **발화 조건이 영원히 거짓**이고, 1,001행짜리 목록은 조용히 1,000행으로 잘려 정상
> 화면이 된다 — 이 규약이 막으려던 바로 그 상태다. 자세한 경위는 §9 AQ-22.
>
> **그래서 오탐 하나를 사고 감지를 되살린다.** 요청 상한과 서버 상한이 같아진 결과, **「정확히 서버 상한
> 행수인 온전한 목록」과 「그보다 많아 잘린 목록」을 구별할 수 없다** — 조회 계층은 **양쪽 모두에 던지며,
> 앞의 경우가 오탐이다.** 받아들이는 근거는 결론이 같다는 것이다: 어느 쪽이든 목록이 서버 상한 행수이므로
> AQ-09를 닫아야 한다. 여유를 **한 행**으로 고정하는 이유도 그것이다 — 넓히는 만큼 온전한 목록을 잘렸다고
> 오탐하는 구간이 늘어난다.
>
> **앱 임계는 설정의 사본에서 파생시킨다.** 값을 두 곳에 손으로 적으면 `max_rows`가 오르는 날 사본이 낡고
> **아무것도 빨간불이 되지 않는다**(v2.2의 사문화가 정확히 그 형태였다). `POSTGREST_MAX_ROWS`를
> `[api].max_rows`의 사본으로 선언하고 임계·요청 상한을 그것에서 계산하며, **사본의 낡음은
> `tests/db/select.test.ts`가 `supabase/config.toml`을 파싱해 막는다**(DB 없이 도는 상시 스위트다).

> **Q-07의 시세 분류는 v0.8에서 추가했다.** v0.7까지 Q-07은 금액과 비율 둘만 정했고, 세 필드(§4.3 `basePrice`·`currentPrice`, §4.5 `latestPrice`)가 DB의 `::text` 원형을 그대로 통과시키고 있음을 P3a 대조 검증에서 발견해 문서에 먼저 등재했다 — 정의가 없는 필드를 구현이 임의로 정하지 않는다(U-01). §4.6 `bracketLabel`의 최하단 구간과 같은 부류의 발견이다.
>
> **DB 원형 통과가 아니라 계약 계층에서 정규화한다.** 원형을 통과시키면 형식의 주인이 열 선언이 되어, 열을 `numeric(18,4)`로 바꾸는 순간 API 출력 형식이 조용히 바뀐다. 비율이 `numeric(6,4)`인데도 `ratioString`이 DB 렌더링을 신뢰하지 않는 것과 같은 논거다. **지금 DB가 이미 6자리로 주므로 값은 변하지 않는다** — 이 규약이 막는 것은 원천이 바뀌었을 때(공급자 API가 `"95.0"`을 주는 경우) 화면 자릿수가 조용히 흔들리는 일이다.

> **Q-07′ — 달러가 들어오며 금액이 두 부류가 된다 (v4.9 선행 명세 — P8 컷 a1, 구현 a2).**
>
> **부류를 가르는 기준은 열이 아니라 «그 값이 무엇의 금액인가»다.** 상품 통화 금액은 사용자와 증권사 사이에 오간 돈이고(DOC-005 「상품 통화」), 과세 축 금액은 세법이 원화로 정하는 값이다(과세표준은 지급일 환율로 환산한 원화 — DOC-007 RD-13의 원문 확인분). 그래서 같은 상환 한 건 안에서 `grossAmount`는 `'10600.00'`이고 `taxableIncome`은 `'870000'`이다 — 달러 상품의 과세 금융소득·원천징수세액은 거래내역의 원화 값이 정본이다(DOC-001 A-04 · U1).
>
> **환율은 새 형식 부류를 만들지 않는다.** `exchange_rates.rate`·`redemptions.exchange_rate`는 `numeric(18,6)`이고 시세(`asset_prices.price`)와 같은 부류 — 공용 관측값이다(DOC-002 DQ-13). 그래서 위 시세 형식(소수 6자리, `'1392.400000'`)을 그대로 쓰고 표시 계층이 `1,392.40원/달러`로 접는다(DOC-005 §9 — 소수점에서 먼저 자른다. `withCommas`가 네 자리 이상 소수를 망가뜨린다).
>
> **기존 행의 `::text`는 한 글자도 바뀌지 않는다.** `principal`·`redemptions.gross_amount`는 `numeric(15,0)`에서 **정밀도 없는 `numeric`**이 되는데(DOC-002 M-08·DQ-12) typmod 해제는 재작성이 없고 저장된 scale을 그대로 둔다 — 원화 행의 `principal::text`는 `'100000000'` 그대로다. `numeric(17,2)`를 택하지 않은 이유가 이것이다: 배포 중인 구 코드가 `'100000000.00'`을 읽어 V-01(「정수」)이 수정 화면에서 깨진다. `moneyString`은 **출력에서** 자릿수를 고정하므로 저장된 scale이 응답 형식을 정하지 않는다 — 위 각주의 「형식의 주인은 열 선언이 아니다」의 연장이다.
>
> **Q-08의 방어가 달러에서 «필수»가 된다.** Q-08은 「15자리 이내 금액은 부동소수점으로도 값이 맞아떨어지므로 값 단언으로는 검출되지 않는다」고 적었다. 달러 금액은 정수부 15자리 + 소수 2자리 = **17자리**이고 float64의 유효 자릿수(약 15.9)를 넘는다 — 원화에서는 예방이던 `::text`·`InsertPayload<T>`가 달러에서는 값을 지키는 유일한 층이다. 컷 a2가 그 경계(`999999999999999.99`)를 `tests/integration/mutations.test.ts`에서 왕복시킨다.
>
> **검증 계기 — 통화 조상을 못 찾으면 던진다 (P8 반박 검토 SB-10, 컷 a2).** `tests/integration/helpers/formats.ts`의 금액 부류를 둘로 가른다 — 과세 축 `AMOUNT_KRW`(`/^-?\d+$/`, 종전 `AMOUNT`)와 상품 통화 `MONEY`. `MONEY`로 등재된 경로는 같은 객체 또는 조상 객체의 `currency`를 읽고, 거기 없으면 **루트의 `product.currency`**를 읽어(§4.3 — `product`는 `schedules[]`·`projection`·`redemption`의 조상이 아니라 **형제**다, 아래 「공통 타입」 규칙 1) KRW `/^-?\d+$/` · USD `/^-?\d+\.\d{2}$/`를 적용하고, **둘 다에서 `currency`를 찾지 못하면 KRW로 떨어지지 않고 던진다** — 떨어지면 USD 값이 원화 규칙으로 판정되어 `'10001'`이 초록이다. 부류는 **경로가** 정한다(분류표) — 같은 객체에 `currency: 'USD'`가 있어도 `taxableIncome` 경로는 `AMOUNT_KRW`다(§4.6 `contributingProducts[]`가 두 부류를 한 객체에 담는다). 이 부류가 서려면 금액을 담는 뷰 객체가 통화를 함께 담아야 하고(아래 「공통 타입」 규칙 1), 달러 픽스처는 **센트를 싣는다**(`principal = '10000.50'`) — 센트가 0이면 `amountString`의 반올림이 형식과 값 둘 다에서 보이지 않는다(v3.6의 「채워진 픽스처」 교훈). 환율 필드는 기존 `PRICE` 부류(`/^\d+\.\d{6}$/`)에 등재한다.

**Q-08의 실측 (v0.7).** `::text` 캐스팅의 효과를 런타임과 타입 양쪽에서 측정했다.

| select | 런타임 | postgrest-js 추론 |
|---|---|---|
| `principal` | `123456789` (number) | `number` — float64 위험 그대로 |
| `principal::text` | `"123456789"` | `string` |
| `annual_coupon_rate` | `0.08` (number) | `number` — **저장 정밀도 `0.0800`을 잃는다** |
| `annual_coupon_rate::text` | `"0.0800"` | `string` |
| `ki_barrier::text` (열이 `NULL`) | `null` | **`string`** ← 널 허용이 사라진다 |
| `els_underlyings(base_price::text)` | `"412.550000"` | `string` — 임베드 안쪽도 이해한다 |

파서가 `any`가 아니라 `string`을 주므로 "조용한 float64"는 아니다. 그러나 **널 허용이 사라지는 것은 타입이 사실과 어긋나는 별개의 결함**이다 — 노낙인 상품의 `ki_barrier`는 실제로 `null`로 오는데 타입은 `string`이라고 말한다. 그래서 조회 계층은 행 타입을 postgrest의 추론에 맡기지 않고 **생성 타입에서 널 허용을 복원**한다. select 문자열과 행 타입을 테이블별 열 사양 하나에서 함께 파생시켜 둘이 어긋날 수 없게 하고, 금액·비율 열을 캐스팅 없이 두면 **타입 오류**가 되게 한다(값 단언으로는 검출되지 않으므로).

**계약별 왕복 수 실측 (v0.7).** REST 요청 수이며, 요청당 `getUser()` 1회가 별도로 있다(`cache()`로 중복 제거).

| 계약 | 왕복 | 구성 |
|---|---|---|
| `listProducts` | 2 | 상품+하위 임베드 / 자산별 최신 시세 |
| `getProduct` | **3** | 상품+하위 임베드 / 자산별 최신 시세 / **추정 환율** *(v4.13 — P8 컷 a3)* |
| `listSchedule` | 3 | 차수+부모 임베드 / 자산별 최신 시세 / **세율 연도** |
| `searchAssets` | 1 | 이름 부분일치 |
| `listAssetPrices` | 2 | 자산+최신 시세 / 상품(참조 수 계산) |
| `getTaxSummary` | **4** | 세율 연도 / 프로필 / 상품 / **추정 환율** |
| `getForecast` | **4** | 세율 연도 / 프로필(`.lte`) / 상품 / **추정 환율** |
| `listUserSummaries` | **5** | 사용자 / 상품 / 세율 연도 / 프로필 / **추정 환율** |
| `getDashboard` | **5** | 상품 / 시세 / 세율 연도 / 프로필 / **추정 환율** |
| `listExchangeRates` | 2 | 환율(통화별 `limit(1)`) / 상품(미상환 수) *(v4.13 신설 — §4.11)* |

> **추정 환율 한 왕복이 다섯 계약에 붙었다 (v4.13 — P8 컷 a3, 아래 「왕복 — 컷 a3에서」의 이행).** 전부 **첫 물결에서 나란히** 나가므로 물결 수는 그대로다. `getProduct`는 종전 `loadProduct` → `loadLatestPrices` 순차였고, 환율을 `loadProduct`와 같은 물결에 두었다 — **상품이 없거나(`null`) 기초자산이 0건이어도 그 왕복은 이미 나갔다**(`tests/integration/contracts.test.ts`의 `getProductNoUnderlying` 예산이 `{els_products: 1, exchange_rates: 1}`이다). 상품을 읽은 뒤 통화를 보고 둘째 물결(시세와 나란히)에서 조건부로 내면 물결은 그대로 둘이고 원화 · 미존재 상품에서 왕복 하나를 아낀다 — **그래도 택하지 않는다.** 다섯 계약이 같은 모양(첫 물결 · 무조건)이어야 규칙 2가 한 문장으로 서고, 예산 다중집합이 상품의 통화와 무관하게 고정된다. 사용자 3명 규모에서 아끼는 왕복 하나는 그 균일함보다 싸다 *(v4.13 반박 검토 정정 — 초안은 「통화를 보고 고르면 물결이 셋이 된다」를 근거로 들었는데 사실이 아니었다)*.

> **`listSchedule`의 3은 v3.3에서 «세율 연도» 하나가 늘어난 것이며 물결은 여전히 둘이다 (P6 컷 6).** `loadAllTaxYears`는 `ctx`에만 의존하고 차수를 보지 않으므로 첫 물결에서 `loadScheduleRows`와 **나란히** 나간다 — `getDashboard`·`getForecast`가 이미 그 형태다. 순차인 것은 시세뿐이고(자산 id를 알아야 한다) 그것은 v0.7부터 그랬다. 늘어난 이유는 `expectedNet`이 `separate_taxation_rate`를 요구하는데 **절대 규칙 #5가 그 값을 코드에 두는 것을 금지**하기 때문이다. 상품 쪽 네 값(`principal`·`annualCouponRate`·`accountType`·`totalRounds`)은 **왕복을 늘리지 않았다** — 아래 §4.4 참조.
>
> ⚠️ ~~**소유자 필터가 «걸리면»**~~ → **기본 화면부터** SCR-301이 이 계약을 두 번 부르므로 `tax_years`도 두 번 읽힌다(`schedule/page.tsx`의 선택지 풀 조회). 물결은 여전히 둘이고 값도 같지만 REST 요청은 6이 된다. 요청 범위 캐시로 접는 길은 있으나 `cache()`가 `react`에서 오므로 `lib/db/queries`가 React 런타임을 끌게 되고 **DB 없는 `tests/db` 스위트가 그것을 못 견딘다** — 그래서 접지 않고 DOC-010에 등재만 한다.
>
> > ★ **「걸리면」이 v4.0에서 「항상」이 됐다** *(2026-08-07, DOC-008 v2.6)*. 소유자 필터의 기본값이 **본인**이 되면서 아무것도 고르지 않은 화면이 이미 좁혀진 상태다 — 두 번 부르지 «않는» 경우는 사용자가 소유자를 **「전체」로 고른** 주소뿐이며, 그것은 이제 예외 경로다. **계약은 한 줄도 바뀌지 않았다**(`params.ownerId`가 선택 필드인 것도, Q-05의 분류도 그대로다). 바뀐 것은 **화면이 그 파라미터를 언제 채우는가**이고, 그래서 이 경고의 «조건»만 이동한다. 대가를 받아들인 근거와 되돌리는 방법은 DOC-008 §5 SCR-201 ★★ ⓐ에 있다. SCR-201도 같은 형태다(`listProducts` 2 → 4).

> **`getForecast`의 ~~3~~은 실측이며 연도 수에 비례하지 않는다 (v2.5, P4b 컷 7).** *(v4.13 — P8 컷 a3에서 `exchange_rates: 1`이 더해져 **4**다. 다중집합은 `{tax_years: 1, tax_profiles: 1, els_products: 1, exchange_rates: 1}`이고 `years = 20`에서도 4임을 단언한다. 아래 논증은 그대로다 — 환율도 요청당 한 번이다.)* 기본 여섯 연도인데 `getTaxSummary`와 **같은 수이고 같은 다중집합**이다 — ~~`{tax_years: 1, tax_profiles: 1, els_products: 1}`~~(`tests/integration/contracts.test.ts`가 그 형태를 단언한다). 두 이유가 각각 하나를 1로 묶는다: `loadAllTaxYears`가 시드된 연도를 한 번에 가져와 **순수한** `resolveTaxYear`를 연도마다 재사용하고(P4 컷 8이 AQ-22를 부분 처리하며 만든 분해의 효과다), 프로필 이월은 `.in(연도들)`이 아니라 `.lte(마지막 연도)` **한 번**으로 받는다. `years = 20`으로도 3임을 함께 단언했다 — **연도마다 왕복하는 구현은 값이 옳으므로 이 표 말고는 어느 케이스에도 걸리지 않는다.**

`자산별 최신 시세`는 **부모별 `limit(1)`**이다 — 자산 3건에 시세 6행이 있을 때 각 부모가 정확히 1건(시세 없는 자산은 빈 배열)을 반환함을 실측했다. 평면 조회 후 JS에서 접으면 서버 상한에 걸려 **조용히 잘린 목록에서 "최신"을 고르는** 경로가 되고, 그때 틀리는 것은 값이 아니라 날짜이므로 화면에 드러나지 않는다.

> **`getUser()`가 요청당 2회가 된다 (v1.2, P4 선행 조건 ②).** 위 표의 "요청당 `getUser()` 1회"는 `src/lib/db/server.ts`의 `cache()` 기준이다. `src/proxy.ts`가 서면 **프록시가 한 번 더 부른다** — React의 요청 메모이제이션은 프록시 경계를 건너지 못하므로 `cache()`가 이를 합치지 못한다.
>
> **프록시의 답을 요청 헤더로 내려보내 합치지 않는다.** 그것은 위조 가능한 신뢰 채널이고, `server.ts`가 `getSession()`이 아니라 `getUser()`를 쓰는 이유가 정확히 "클라이언트가 준 주장을 믿지 않는다"이다. 비용을 줄이려고 그 전제를 깨면 Q-01(세션으로만 조회한다)이 형식만 남는다. 비용을 기록하고 감수한다.

#### 공통 타입 — 상품 통화와 환율 기준 (v4.9 선행 명세 — P8 컷 a1, 구현 a2·a3)

```ts
/** 상품 통화 (DOC-005 §3). 기초자산 통화(`assets.currency` — V-19)와 다른 축이다 (DOC-005 §8.11) */
type ProductCurrency = 'KRW' | 'USD'   // 선언 순서가 뜻을 갖는다 — 통화별 목록·정렬의 순서다 (KRW → USD)

/**
 * 원화 환산에 쓴 추정 환율 — **추정에만 붙는다** (DOC-008 ST-05)
 *
 * 거래내역에서 옮긴 확정 원화 값(A-04)에는 붙지 않는다. 확정값에 환율을 붙이면
 * 그 값이 추정처럼 읽히고, 추정값에서 빼면 확정처럼 읽힌다.
 */
type ExchangeRateBasisView = {
  currency: 'USD'          // 지원 외화 (V-24). KRW는 환율의 대상이 아니다
  rate: string             // 1달러당 원. 시세와 같은 소수 6자리 (Q-07)
  asOfDate: string         // `as_of_date ≤ asOf` 중 최신 1건의 기준일 (DOC-007 RD-09)
  source: 'AUTO' | 'MANUAL'
  isStale: boolean         // §4.5 `isStale`과 같은 5일 규칙
}
```

**규칙 넷.**

1. **금액이 있는 곳에 통화가 있다.** 상품 통화 금액을 담는 뷰 객체는 같은 객체(또는 그 조상)에 `currency: ProductCurrency`를 담는다 — 상품 단위 뷰는 그 상품 객체에, 목록 항목은 그 항목에, 통화별 합계는 그 행에. **§4.3은 `product.currency`가 형제 가지(`schedules[]`·`projection`·`redemption`)의 통화다** — 그 가지들은 `product`의 자식이 아니므로 조상에 통화가 없고, 그래서 `MONEY` 헬퍼는 조상 다음으로 **루트의 `product.currency`**를 본다(Q-07′ 검증 계기 — 둘 다 없으면 여전히 던진다). 화면이 다른 필드에서 통화를 «추론»하게 두지 않는다 — 화면의 합성은 어느 스위트도 대조하지 않는다(DOC-010 AQ-23). Q-07′의 검증 계기(`MONEY` 부류)가 이 규칙에 기대고, 규칙을 어긴 뷰는 통합 스위트에서 **던진다**.
2. **추정 환율은 요청당 한 번 읽고 통화당 하나다.** `loadEstimateRates(ctx)`가 `exchange_rates`에서 통화별 `as_of_date ≤ asOf` 최신 1건을 읽고(DOC-007 RD-09) 그 하나를 **모든 연도에** 쓴다. Q-02가 기준일을 요청당 한 번 해석하는 것과 같은 이유다 — 한 응답 안의 두 값이 다른 환율로 환산되면 둘을 비교할 수 없다. 통화별 `limit(1)`이므로 Q-06의 절단이 구조적으로 불가능하다.
3. **기본 환율은 없다.** 한 건도 없으면 환산하지 않고 그 값을 `null`로 두며 **빠졌다는 사실을 개수로 말한다**(DOC-007 E-09 · DOC-008 ST-07). `1`·상수·과거 평균 모두 쓰지 않는다 — `1`을 넣으면 달러 이익이 그대로 원으로 읽혀 그 기여가 약 1/1,400이 되고 형식은 정상이다. 그 사실을 말하는 필드는 뷰마다 다르다 — `unconvertedCount`(§4.1·§4.6, ~~건 수~~ **상품 수** *(v4.16 — 아래 「쿠폰 지급방식과 월수익」 규칙 4)*) · `exchangeRateMissing`(§4.6 상품 행) · `excludedForeignCount`(§4.7, 행마다 — 상품 수). `exchangeRateBasis = null`만으로는 「외화 금액이 없다」와 「환율이 없다」가 갈리지 않으므로 **둘을 가르는 것은 이 필드들이다.**
4. **확정 원화 값은 환율과 무관하게 늘 들어간다.** E-09는 상품이 아니라 **건** 단위다(DOC-007 E-09 — 반박 검토 SB-3) — 추정이 필요한 달러 건만 빠지고, 거래내역에서 옮긴 원화 과세는 환율이 없어도 합계에 있다. *(v4.16 — 「건」은 소득 사건이고, 빠진 사실을 **세는** 단위는 상품이다. 아래 「쿠폰 지급방식과 월수익」 규칙 4)*

**컷별 도달 — 필드가 서는 컷이 다르다.** 컷 a2(W1)에는 `exchange_rates`가 없으므로 추정 환율이 늘 없다 — 미상환 달러 상품의 추정은 전부 E-09이고(환율이 필요한 건 — 비과세 계좌 · 달러 이익 ≤ 0은 환율 없이 0이다, v4.11에서 좁혔다), 그래서 **개수 필드는 a2에서 선다.** `ExchangeRateBasisView`와 그것을 담는 필드(`exchangeRateBasis`·`krwEstimate`), 그리고 환산 건수 `convertedCount`(§4.1·§4.6)는 **a3에서 선다** — a2에 두면 모든 응답에서 `null`(건수는 0)인 **구조적 상수**가 된다(§4.1 v2.0이 `upcomingEvaluations.status`를 두지 않은 판단과 같다).

**왕복 — 컷 a3에서 다섯 계약이 하나씩 는다 (위 왕복 표는 a3의 코드 커밋에서 고친다 — v4.13에서 고쳤다).** 추정 환율 한 왕복(`exchange_rates` ×1)이 원화 환산을 하는 계약에 붙는다 — `getProduct` 2 → 3 · `getTaxSummary` 3 → 4 · `getForecast` 3 → 4 · `getDashboard` 4 → 5 · `listUserSummaries` 4 → 5. `ctx.asOf`에만 의존하므로 **첫 물결에서 나란히** 나가고 물결 수는 그대로다(`listSchedule` v3.3 각주의 `loadAllTaxYears`와 같은 형태). **붙지 않는 계약**: `listProducts`·`listSchedule`(금액을 상품 통화로만 싣는다 — §4.4 「달러 기준 참고」) · `listAssetPrices` · `searchAssets`. 신설 `listExchangeRates`(§4.11)는 2다. `tests/integration/contracts.test.ts`의 다중집합 예산이 같은 커밋에 `{exchange_rates: 1}`을 더한다 — **환율을 연도마다 읽는 구현도 값은 옳으므로** 그 예산 말고는 어느 케이스에도 걸리지 않는다(§4.7 `getForecast`의 v2.5 각주와 같은 자리).

#### 공통 타입 — 쿠폰 지급방식과 월수익 (v4.16 선행 명세 — P8 컷 b1, 구현 b2·b3·b4)

달러 절반(바로 위)의 짝이다. 용어는 DOC-005 v1.11 — 쿠폰 지급방식 · 월지급식 · 상환 시 지급 · 월수익 · 월수익 연쿠폰율 · 월수익 일정 · 월수익 평가일 · 월수익 지급일 · 월수익 순번 · 월수익 배리어 · 월수익 지급 기록 · 월수익 미기록 · 받은 월수익 · 조기상환 가정 밖 · 월수익 흐름 끝 · 잔여 월수익(`remainingCoupons` — b1 개정) · **소득 사건**(상환 사건 · 월수익 사건 — 코드 `IncomeEvent` · `incomeEventsOf`). 「월수익 기록」은 SCR-206의 **화면 · 동작 이름**이고(§5.14 · §5.15의 절 이름 · 「월수익 기록 전부 지우기」) 엔티티는 「월수익 지급 기록」이다 — SCR-203 「상환 처리」와 같은 갈림이다(b1 개정).

```ts
/** 쿠폰 지급방식 (DOC-005 §3). 입력(§5.1·§5.2·§5.11)과 뷰(§4.2·§4.3)에 쓴다 */
type CouponPayout = 'AT_REDEMPTION' | 'MONTHLY'

/** 월수익 지급 기록의 결과 (DOC-002 §4.14 `coupon_outcome`) */
type CouponOutcome = 'PAID' | 'UNPAID'

/**
 * 월수익 일정 한 행의 상태 — 아래 「구획」(DOC-007 §9.4 E-10)이 고른다.
 * 표시: 지급 · 미지급 · 미기록 · 예정 · 예정 · 조기상환 가정 밖 · 상환 후 없음 (라벨 축은 컷 b3의 코드 커밋)
 */
type CouponState =
  | 'PAID'               // 지급 — 기록이 정본이다(흐름 끝과 무관)
  | 'UNPAID'             // 미지급 — 같다
  | 'UNRECORDED'         // 미기록 — 흐름 끝 이내 · 기록 없음 · 월수익 지급일 < 기준일
  | 'SCHEDULED'          // 예정 — 흐름 끝 이내 · 기록 없음 · 월수익 지급일 ≥ 기준일
  | 'BEYOND_ASSUMPTION'  // 예정 · 조기상환 가정 밖 — 미상환 상품의 흐름 끝(적용 차수 평가일) 뒤 (민서 결정(2026-10-02) ③)
  | 'ENDED'              // 상환 후 없음 — 상환된 상품의 흐름 끝(상환일) 뒤. 상환된 상품에만 쓴다 (민서 결정(2026-10-02) ③)

/**
 * 다음 월수익 한 행의 조건 판정 — **표시 전용이다** (DOC-007 §3.5). F에 쓰지 않는다.
 * `UNKNOWN` = 그 행이 다음 행인데 워스트오브를 낼 수 없다(E-01) — §3.5의 판정 `null`이 이 값이다
 */
type CouponConditionResult = 'EXPECTED_PAID' | 'EXPECTED_UNPAID' | 'UNKNOWN'

/** 한 상품의 그 해 과세 기여가 무엇으로 이루어졌는가 (§4.6. 라벨 축은 컷 b4의 코드 커밋) */
type ContributionBasis = 'CONFIRMED' | 'ESTIMATED' | 'MIXED'
```

**월수익 흐름 끝(`T_end`)** — 추정에 넣는 마지막 월수익 평가일이다(DOC-005 · DOC-007 §7.6). 상환된 상품(`REDEEMED`)은 **상환일**, 적용 차수가 있는 미상환 상품(`ESTIMATED`)은 **적용 차수의 평가일**, 적용 차수가 없는 미상환 상품(`NO_ROUND`)은 **없음(무한)**이다. **비교 키는 월수익 평가일이고 경계를 포함한다**(`t_k ≤ T_end`) — 적용 차수와 같은 날 평가되는 그 달 월수익(지급은 +3영업일)이 흐름 안에 든다(DOC-007 RD-12 · U6). 이 정의가 V-27의 기록 상한 · DOC-002 DQ-07 ②와 짝이고 **비교 키가 같다** — 그쪽도 「그 달의 월수익 평가일 ≤ 상환일」이다(b1 개정 · DOC-007 RD-18 해결 · §9 ⑯). 지급일로 비교하면 상환 대금이 그 달 월수익보다 하루라도 먼저 지급되는 상품에서 같은 날 평가된 마지막 월수익이 흐름 안(추정 · 「미기록」)인데 기록할 수 없다. **전제 — 월수익 평가일이 조기상환 평가일과 겹친다**(EM2048 실측 — 6개월마다. b1 개정). 상환됨의 `T_end`(상환일 — 거래일자)와 미상환의 `T_end`(적용 차수 평가일)는 축이 달라, (상환 차수 평가일, 상환일] 사이에 평가된 달이 있으면 상환을 기록하는 순간 그 달의 상태가 「예정 · 조기상환 가정 밖」에서 추정(「미기록」 · 「예정」)으로 바뀐다. 겹치지 않는 상품의 처리는 DOC-007 RD-20이 들고 있다(b4 전에 정한다).

**구획 — `CouponState`를 고른다 (DOC-007 §9.4 E-10 · SB-8 · U5 — 둘 다 P8 계획 결정).**

| | 흐름 끝 이내 (`t_k ≤ T_end`) | 흐름 끝 이후 |
|---|---|---|
| 기록 없음 · `p_k < asOf` | `UNRECORDED` — 추정에 **지급으로** 넣고 주의를 띄운다 | 상환됨: `ENDED` · 적용 차수가 있는 미상환: `BEYOND_ASSUMPTION` — 추정에서 뺀다(민서 결정(2026-10-02) ③) |
| 기록 없음 · `p_k ≥ asOf` | `SCHEDULED` — 추정에 넣는다 | 위와 같다 |
| 기록 있음 | `PAID` · `UNPAID` — 기록이 정본이다(흐름 끝과 무관) | **단일 요청 순서에서는 도달하지 않는다 — `PAID` · `UNPAID` 모두**(b1 개정 — 대칭). 상환일 뒤에 평가된 달의 기록과, 기록된 달(지급 · 미지급)의 평가일보다 앞선 상환일을 계약(V-27 양방향)과 DB(I-27 · §3.2.1)가 함께 막는다. 동시 트랜잭션의 write skew는 그 보장 밖이다(DOC-010 AQ-93 — b2 전 판단) |

`t_k`는 월수익 평가일, `p_k`는 월수익 지급일이다(DOC-007 §2의 기호). **「상환 후 없음」은 상환된 상품에만 쓴다** — 미상환 상품의 가정된 상환 뒤 달은 「예정 · 조기상환 가정 밖」이다(민서 결정(2026-10-02) ③). 둘을 한 값으로 두면 「아직 상환되지 않았는데 상환 후」라는 거짓 문구가 생긴다.

**규칙 넷 — 소득 사건 (DOC-007 §7.6 · DOC-002 D-09).**

1. **한 상품의 소득 사건 = 상환 사건(0..1) + 월수익 사건(0..K).** 상품당 상환 1건(I-01) · 손실 상환 과세 0(I-08) · 상태는 상환 레코드로 유도(D-01)는 **그대로다** — 월지급식의 상환 사건은 원금만이고(세전 ≤ 투자원금 · 과세 0 — V-29) 수익은 전부 월수익 사건이다. 월수익 순번 k마다: **기록이 있으면** `PAID` → 확정 사건(귀속 = `year(기록.payment_date)`, 과세 = 기록값을 `couponTaxableIncome()`으로 — 비과세 계좌는 0) · `UNPAID` → 사건 없음. **기록이 없으면** `t_k ≤ T_end`일 때 추정 사건(지급된 것으로 추정 — U5. 귀속 = `year(일정.payment_date)` — 평가일이 아니다, SB-5 — P8 계획 결정. 금액 `q_k` = `P × r_m / 12`를 상품 통화 보조단위로 절사한 값(아래 「형식」 — b1 개정), 과세는 DOC-007 §4.7·§4.8), 아니면 사건 없음. **확정/추정의 기준은 기록 유무다**(A-04 — 상환과 같다). `is_confirmed`는 별도의 표시 축이다(ST-05).
2. **원금은 상환 사건에만 싣는다** — 월수익 사건의 원금 반환분은 0이다. §4.7의 배타 분할(한 상품의 원금은 잔여 원금 아니면 수령액 한쪽에만)이 이것 하나에 기댄다.
3. **추정 월수익은 시세를 쓰지 않는다.** 흐름 끝 안의 무기록 달은 조건과 무관하게 지급된 것으로 추정한다. §3.5의 조건 판정(`CouponConditionResult`)은 다음 한 행의 **표시 전용**이고 F에 쓰지 않는다 — 그래서 §8의 「`PRICE_WIDE`에는 세금이 없다」가 참으로 남는다.
4. **E-09는 사건 단위로 빼고, 세는 단위는 상품이다.** 빠지는 것은 환율이 없는 추정 달러 **사건**뿐이고(위 달러 규칙 4) 확정 원화 과세는 늘 들어간다. 그 사실을 세는 세 필드 — `unconvertedCount`(그 해 추정 달러 사건 중 환율이 없어 빠진 것이 하나라도 있는 **상품** 수) · `convertedCount`(그 해 환산한 사건이 하나라도 있는 **상품** 수 — 환율은 요청당 통화별 하나라 한 상품이 둘에 동시에 들지 않는다) · `excludedForeignCount`(§4.7 — 상품 수) — 는 전부 **상품 수**다. DOC-008 ST-07 「달러 상품 n건」의 n과 짝이다. 월지급식이 한 상품에 사건 여럿을 내기 전까지 둘은 같았다 — a2·a3의 「건 수」가 틀린 적은 없고 코드는 처음부터 기여 행(= 상품)을 셌다(`queries/tax.ts`).

**형식 (Q-07).** ⓐ 상품 통화 금액에 월수익 세전이 든다 — 기록의 `grossAmount` · `expectedAmount` · `remainingCoupons.byYear[].grossAmount` · `byCurrency[].receivedCoupons`. ⓑ 과세 축(원화 정수)에 기록의 `taxableIncome`·`withholdingTax` · `remainingCoupons.byYear[].taxableIncome` · §4.6 `breakdown`의 금액 · `income.confirmedElsTaxableIncome`·`estimatedElsTaxableIncome`이 든다. 비율 4자리에 `monthlyCouponAnnualRate`·`couponBarrier` · §4.2 `terms.monthlyCoupon`의 `annualRate`·`barrier`(b1 개정), 6자리(시세 부류)에 기록의 `exchangeRate`(적용 환율)가 든다. **월수익 금액의 정의는 하나다 — `q_k`는 `P × r_m / 12`를 상품 통화 보조단위로 절사한 값이다**(b1 개정 — DOC-007 RD-10 ③ 해결 · DOC-008 SQ-21 ⓒ 해결): 달러는 센트 미만 절사(투자설명서 원문 「센트미만은 절사」), 원화는 원 미만 절사(잠정 — RD-10 ①, 원문 근거가 없다). **F · 표시(`expectedAmount` · `remainingCoupons`) · 기록 화면(SCR-206)의 세전 기본값이 같은 값이다** — 같은 달의 금액을 두 화면이 다르게 적지 않는다. **절사는 집계의 반올림이 아니라 지급 금액의 정의다** — 월수익은 보조단위로 지급되므로 정확값 `P × r_m / 12`는 어디에도 지급되지 않는 수다. 그래서 DOC-007 §2 「집계는 반올림하지 않는다」와 충돌하지 않는다 — 합은 절사된 `q_k`들의 정확한 합이고 F 안에서 더 접지 않는다. `expectedAmount`가 Q-07의 `moneyString`을 지나도 값이 바뀌지 않는다(접을 자릿수가 이미 없다 — §5.1 `principal`과 같다). **달러 월수익의 원화 과세 `q_k × x`는 반올림하지 않는다**(검산 C — $202.00 × 1,385.20 = 279,810.4원, 출력에서만 Q-07 ⓑ로 접는다). 검산 값은 전부 그대로다(600,000 · $202.00 · 583,333 — 셋 다 이미 보조단위다). 원천징수의 끝수 규칙(Σ절사 대 절사Σ)은 여전히 RD-10 ②가 닫는다(검산 B-6). 월수익 금액을 담는 뷰 객체의 통화는 위 달러 규칙 1을 따른다 — §4.3의 `coupons[]`·`unnumberedCouponRecords[]`·`remainingCoupons`는 `product`의 형제이므로 `MONEY` 헬퍼가 루트의 `product.currency`를 본다.

**왕복 — 늘지 않는다.** 월수익 두 테이블(`monthly_coupon_schedules` · `monthly_coupon_payments`)은 **상품이 루트인 로더**(`loadProducts` · `loadProduct`)의 **임베드**로 읽는다 — 위 왕복 표의 `getProduct` · `listProducts` · `getDashboard` · `getTaxSummary` · `getForecast` · `listUserSummaries`(§4.1 · §4.2 · §4.3 · §4.6 · §4.7 · §4.8)가 그대로다. **차수가 루트인 `loadScheduleRows`(§4.4)의 상품 임베드에는 넣지 않는다**(b1 개정 — DOC-010 AQ-77의 방향 유지). 지금은 세 로더가 같은 `PRODUCT_SELECT`를 쓰므로(`queries/load.ts`) 거기에 두 테이블을 더하면 그 상품의 월수익 전부가 **차수 수만큼 복제된다** — 그래서 b3은 `PRODUCT_SELECT`에 넣는 것이 아니라 **상품 루트 셀렉트와 차수 루트 셀렉트를 가른다.** 대가는 페이로드다(상품마다 최대 60행 × 두 테이블) — 실측은 DOC-010 AQ-77(컷 b3). `loadProducts`를 쓰는 §4.5 `listAssetPrices` · §4.11 `listExchangeRates`도 같은 임베드를 받는다 — 읽지 않는 행이라 값은 그대로이고 페이로드만 늘므로 AQ-77이 함께 잰다. 평가일정의 월수익 행은 `listMonthlyCouponSchedule`(§4.12)의 자기 루트 쿼리이고 그 왕복은 b3의 코드 커밋이 재서 위 표에 행으로 적는다.

**컷별 도달 — §0의 원칙(스키마·계약 = b2, 화면 = b3, 세금·전망 = b4)대로 갈린다.**

- **b2** — `CouponPayout`·`CouponOutcome`과 입력·기록 계약(§5.1·§5.2·§5.11의 `couponPayout` · §5.14·§5.15). **§4.3 `product.couponPayout`과 입력 계층의 「쿠폰 지급」 선택 상자(SCR-204 · SCR-205 — 선택지 「선택」 · 「상환 시 지급」. 「월지급식」은 b4 — SB-13)가 V-25와 같은 b2 코드 커밋에 선다** *(b1 개정 — 반박 검토 반영)*. V-25(필수 · 기본값 없음)만 b2에 서고 칸과 초기값이 b3에 서면, b2 배포(W4)부터 b3 배포(W5)까지 운영 폼의 등록 · 수정 · 기실현 등재가 전부 `fields.couponPayout`으로 거부된다 — 오류가 붙을 칸도 화면에 없다. 통화의 선례와 같다(a2-3a — V-22와 「선택 · 원화」 선택 상자가 같은 커밋). 수정 폼은 `product.couponPayout`으로 저장값을 되돌려 보낸다 — 그래서 그 필드가 b3이면 수정 경로에는 보낼 값이 없다. 저장값이 `MONTHLY`인 상품(dev 표본 · 통합 픽스처 — 계약으로만 만들 수 있다)을 b2~b3의 폼이 열면 선택지에 그 값을 더한다(`currencyOptionsOf` 선례 — DOC-008 SCR-204). 그 밖의 조회는 아직 월수익을 모른다.
- **b3** — `CouponState`·`CouponConditionResult`와 표시 필드: §4.1 `receivedCoupons`·`COUPON_UNRECORDED`(와 그 `count`)·`realizedPnl`의 월수익 몫 · §4.2 `couponPayout`·`terms.monthlyCoupon`·`couponProgress` · §4.3 `monthlyCouponAnnualRate`·`coupons`·`unnumberedCouponRecords`·`realizedPnl`의 월수익 몫(§4.3 `couponPayout`은 b2 — 위) · 결함 `COUPON_SCHEDULE_MISSING` · §4.12.
- **b4** — `ContributionBasis`와 **과세에 닿는 것 전부**: 월수익 사건이 F에 들어간다(§4.1 `currentYearTax` · §4.3 `remainingCoupons` · §4.6 `basis`·`breakdown`·확정/추정 분할 · §4.7(가정 표식 `monthlyCouponAssumption` 포함) · §4.8). 같은 사건 집합을 읽는 필드는 한 컷에 함께 선다 — 갈라 서면 §4.3과 §4.6이 같은 상품에 다른 과세를 말한다(v0.8이 고친 「두 화면 모순」의 부류). `remainingCoupons`는 SCR-202 ⑤(화면)에 쓰이지만 이 이유로 b4에 둔다 — 이 경계를 b1 개정이 받아들였다(§9 ⑮ 해결).
- **b2~b4 사이** — 계약은 `MONTHLY`와 기록을 받지만(통합 테스트 · dev 표본 — SB-13) 과세는 아직 월수익 사건을 모르므로, 그 동안 월지급 상품의 F 기여는 상환 사건(원금만 — r = 0이라 과세 0)뿐이다. 폼이 b4까지 「월지급식」을 고를 수 없으므로 운영 사용자에게는 이 상태가 생기지 않는다.

### 4.1 대시보드 — SCR-101

```ts
function getDashboard(params: {
  scope: 'MINE' | 'ALL'
}): Promise<DashboardView>

type DashboardView = {
  upcomingEvaluations: Array<{
    productId: string
    productName: string
    ownerName: string
    roundNo: number
    evaluationDate: string
    dDay: number
    worstOf: string | null            // null = 산출 불가. **원인 둘** — 아래 각주
    barrier: string
    willMeet: boolean | null          // null = 판정 없음. 원인은 worstOf와 같은 둘
  }>
  totals: {
    activeCount: number                 // = Σ byCurrency[].activeCount — 개수는 통화를 넘어 더한다
    /** v4.9 (P8 컷 a2) — 통화별 사실. 통화를 넘어 더하지 않는다 (DOC-007 §7.7). 아래 「통화별 합계」 */
    byCurrency: Array<{
      currency: ProductCurrency
      activeCount: number
      activePrincipal: string           // 상품 통화 (Q-07 ⓐ)
      realizedPnl: string               // 상품 통화. 음수 가능. v4.16 — 상환된 상품만 · 월수익 포함 (아래 「통화별 합계」)
      /** v4.16 (P8 컷 b1 명세 · 구현 b3) — 받은 월수익: 보유중 월지급 상품의 PAID 월수익 합. 상품 통화 (민서 결정(2026-10-02) ②) */
      receivedCoupons: string
    }>                                  // KRW → USD 순. 상품 0건이면 [{ KRW, 0, '0', '0', '0' }]
    /** v4.9 (P8 컷 a3) — 원화 환산 추정. 보유중 외화 원금이 있을 때만 객체다 */
    krwEstimate: {
      activePrincipal: string | null    // 원화 + Σ 외화 × 추정 환율. null = 환율 없음 (E-09)
      exchangeRateBasis: ExchangeRateBasisView | null   // activePrincipal과 함께 빈다
    } | null
  }
  currentYearTax: {
    year: number
    financialIncome: string
    isComprehensive: boolean
    additionalTax: string
    exchangeRateBasis: ExchangeRateBasisView | null     // v4.9 (P8 컷 a3) — 달러 추정을 환산했으면
    convertedCount: number              // v4.9 (P8 컷 a3) — 추정 환율로 환산해 넣은 사건이 있는 상품 수 (v4.16 — 종전 「건 수」)
    unconvertedCount: number            // v4.9 (P8 컷 a2) — 환율이 없어 빠진 추정 사건이 있는 상품 수 (E-09 · v4.16 — 종전 「건 수」)
  }
  attentionItems: Array<{
    productId: string
    productName: string
    ownerName: string
    reason:
      | 'KI_NEAR'              // 표시 등급 WARNING
      | 'KI_BELOW'             // 배리어 하회 관측 — 사용자 확인 필요 (D-04)
      | 'KI_TOUCHED'
      | 'EVALUATION_PASSED'
      | 'PRICE_MISSING'
      | 'UNDERLYING_MISSING'   // 무결성 결함 (§4.2)
      | 'SCHEDULE_MISSING'
      | 'COUPON_SCHEDULE_MISSING'  // v4.16 (P8 컷 b1 명세 · 구현 b3) — 무결성 결함 (§4.2). 월지급식 FULL인데 월수익 일정 0행. 조치 사유로도 싣는다 (DOC-008 SQ-21 ⓓ 해결 — b1 개정)
      | 'COUPON_UNRECORDED'    // v4.16 (같음) — 월수익 미기록 (DOC-007 E-10). 상품 단위 · 상환된 상품에서도 뜬다
    /** v4.16 (구현 b3 · b1 개정) — `COUPON_UNRECORDED`에만: 그 상품의 미기록 달 수(「n개월 미기록」의 n). 다른 사유에는 없다 */
    count?: number
  }>
  recentRedemptions: Array<{
    productId: string
    productName: string
    ownerName: string
    redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
    redemptionDate: string
    currency: ProductCurrency         // v4.9 (P8 컷 a2) — grossAmount·realizedPnl의 통화
    grossAmount: string
    realizedPnl: string               // 파생값(포트폴리오 손익). 음수 가능. v4.16 — 월지급 상품은 Σ PAID 월수익 포함
    isConfirmed: boolean
  }>
}
```

> `currentYearTax`는 **로그인 사용자 본인 기준**으로만 산출한다. `scope = 'ALL'`이어도 세금은 합산하지 않는다(DOC-002 D-02).

> **`worstOf = null`의 원인은 둘이며 이 목록은 어느 쪽인지 말하지 않는다 (v2.2, P4.5).** 종전 주석은 `// null = 시세 없음`이었고 **그것은 거짓이다.** 무결성 결함 상품(`UNDERLYING_MISSING`)도 이 목록에 실리며 `worstOf = null`을 갖는다 — `judge()`가 `destroyed === 'PRICES'`에서 `worstOf`를 끊으면서 **`next`는 살려 반환하고**(`src/lib/db/queries/map.ts`의 그 분기), 이 목록의 유일한 필터가 `next != null`이기 때문이다. `willMeet`도 같은 두 원인에서 `null`이 된다(`conditionResult`가 같은 분기에서 끊긴다).
>
> **그 주석을 그대로 믿고 구현하면 ST-06 위반이 된다.** DOC-008 ST-06은 무결성 결함을 「시세 없음」과 **다른 문구**로 표시하라고 규정하는데, 이 필드를 「null이면 시세 없음」으로 읽는 화면은 정확히 그 금지된 표시를 하며 사용자를 **영원히 오지 않을 시세를 기다리게** 한다. §4.2 우선순위표가 존재하는 이유와 같은 자리다.
>
> **원인을 담지 않는 것은 결정이다.** 이 목록에 `integrityIssue`를 두지 않고, 원인은 같은 뷰의 ④ `attentionItems`가 `UNDERLYING_MISSING`으로 말한다 — 한 상품이 두 목록에 동시에 오르므로 정보는 화면에 있다. 따라서 ①의 문구는 「시세 없음」도 결함 문구도 아닌 **제3의 중립 문구**여야 한다(구현은 「판정 없음」이다). 원인별로 갈라 표시하려면 이 뷰에 필드를 더하는 것이 아니라 ④를 읽어야 한다.
>
> **`worstOf`를 담는 다른 세 뷰는 사정이 다르다** — §4.2 `ProductListItem`·§4.3 `ProductDetailView`·§4.4 `ScheduleItem`이 `integrityIssue`를 함께 담으므로 그쪽에서는 원인이 갈린다(그 셋이 `deriveDisplay`의 소비자인 이유다). 이 필드의 뜻이 뷰마다 다른 것이 아니라, **`worstOf`를 담는 뷰 넷 중 원인을 갈라 말할 수 없는 것이 이 뷰 하나**다.

**`upcomingEvaluations`는 기간 창을 두지 않는다.** 미상환 상품의 다음 평가일(DOC-007 §9.2 `nextEvaluation`) 전체를 `dDay` 오름차순으로 반환하며, 표시 건수는 화면이 정한다. "임박"의 경계를 계약에 박으면 그 값이 어느 문서에도 근거가 없는 상수가 되고, 창 밖의 상품은 화면에서 사라져 SCR-101의 목적("곧 평가일이 오는 상품이 있는가")이 조용히 좁아진다. 이미 경과한 차수는 이 목록이 아니라 `attentionItems`의 `EVALUATION_PASSED`가 담당한다(DOC-007 §9.2가 두 구간을 배타적으로 나눈다). **이 목록은 조기상환 차수만 담는다** *(v4.16 — P8 컷 b1, DOC-008 SQ-18 해소)* — 월수익 평가일은 매월이라 월지급 상품이 있으면 늘 「임박」이고, 섞으면 조기상환 평가일이 그 아래로 밀린다. 월수익 일정은 SCR-301(§4.12)과 SCR-202 ⑦(§4.3 `coupons`)이 보여 준다.

> **`KI_BELOW`를 신설한 이유 (v0.6).** 종전 열거값에는 표시 등급 `BELOW`(`W ≤ ki_barrier`, DOC-007 §3.4)와 터치 후보에 해당하는 값이 없었다. 그런데 시스템이 `ki_touched_at`을 자동 확정하지 않으므로(D-04) **이 상태가 사용자 확인이 필요한 유일한 상태**이고, 조치 목록의 존재 이유에 가장 가깝다. `KI_NEAR`(주의)로 접으면 확인 요청이 경고로 격하되고 `KI_TOUCHED`로 접으면 확정되지 않은 사실을 확정으로 표시한다.

**한 상품이 여러 사유를 올린다 — 결함은 나머지를 가리지 않는다 (v0.8).** 종전 구현은 결함이면 그것 하나만 보고했다. 그러나 조치 사유는 저마다 다른 입력에서 나오므로, **결함이 파괴하지 않은 입력에서 나오는 사유는 함께 보고한다**(§4.2의 입력 기준).

| 상황 | 결과 |
|---|---|
| `SCHEDULE_MISSING` + KI 하회 | `['SCHEDULE_MISSING', 'KI_BELOW']` |
| `UNDERLYING_MISSING` + 경과 평가일 | `['UNDERLYING_MISSING', 'EVALUATION_PASSED']` |
| `UNDERLYING_MISSING` | `PRICE_MISSING`을 **내지 않는다** |
| `SCHEDULE_MISSING` + 시세 없음 | `PRICE_MISSING`을 낸다 (진짜 E-01이다) |
| 상환 완료 + 결함 | 결함만. 상환은 결함을 해소하지 않는다 *(v4.16 — 월수익 미기록은 함께 뜬다, 아래 행)* |
| 상환 완료 + 월수익 미기록 *(v4.16)* | `['COUPON_UNRECORDED']` — **E-05의 조기 반환 앞에서** 계산한다(SB-1 — P8 계획 결정). 상환된 상품의 흐름 끝(상환일) 안 무기록 달은 추정에 지급으로 들어가 있으므로 기록을 요구할 이유가 상환 뒤에도 남는다 |
| 월수익 미기록 + KI 하회 *(v4.16)* | `['COUPON_UNRECORDED', 'KI_BELOW']` |
| `COUPON_SCHEDULE_MISSING` *(v4.16)* | 결함만이 아니다 — 파괴한 입력이 월수익뿐이므로(§4.2 D1) 시세·차수에서 나오는 사유(KI · `PRICE_MISSING` · `EVALUATION_PASSED`)는 그대로 함께 뜬다 |
| `COUPON_SCHEDULE_MISSING` + 다른 결함 *(v4.16 — b1 개정)* | **앞 결함 하나만** — 결함 사유는 `integrityIssue`(값 하나)에서 오므로 기존 결함 사유의 규칙 그대로다(`UNDERLYING_MISSING` → `SCHEDULE_MISSING` → `COUPON_SCHEDULE_MISSING` — §4.2 D1). 셋째 결함은 앞 결함을 고친 뒤 드러난다. 함께 뜨는 사유는 보고된 결함이 파괴한 입력을 따른다 |

> **억제하면 그 상태가 시스템 어디에서도 보이지 않는다.** 일정 0건 상품은 §4.4에 **행이 생기지 않고** `upcomingEvaluations`도 `nextEvaluation = null`로 제외하므로, **이 목록이 유일한 창구다.** `KI_BELOW`는 사용자 확인이 필요한 유일한 상태인데(D-04, 위 각주), 결함으로 가리면 결함을 고치기 전까지 그 확인 요청이 사라진다. 결함 수정(SCR-204)과 KI 확인은 **다른 조치**다.
>
> **`PRICE_MISSING`은 시세 입력이 파괴된 결함에서 내지 않는다.** 그 표시는 "시세가 수집되면 해소된다"는 약속인데, 기초자산 0건에서 그것은 **영원히 오지 않을 시세를 기다리게 하는** 바로 그 상태다(DOC-007 §3.1, §4.2 순위표가 존재하는 이유). 판별은 결함 이름이 아니라 **파괴된 입력**으로 한다 — 이름으로 판별하면 시세 입력을 파괴하는 세 번째 결함이 생겼을 때 조용히 틀린다.

> **셋째 결함도 조치 사유다 (v4.16 — b1 개정, 반박 검토 반영).** `COUPON_SCHEDULE_MISSING`은 위 유니온에 있고 화면은 계약이 준 사유를 거르지 않는다 — DOC-008 SQ-21 ⓓ의 「④가 결함 사유로도 싣는가」는 이 계약으로 해결이고, SCR-101 ④ 사유 표 · DOC-005 라벨 축(`attentionReason`)에 그 값이 b3 코드 커밋에 함께 온다(`ATTENTION_REASON_LABELS` · `ATTENTION_REASON_GRADES`가 `Record<AttentionReason, …>`이므로 유니온이 늘면 컴파일이 그것을 요구한다).

**배열의 순서는 결함 우선으로 고정한다 (v0.8).** 결함은 사용자가 직접 고쳐야 해소되고(SCR-204) 나머지는 시장 상황이므로 조치의 성격이 다르다. 순서를 정하지 않으면 구현이 임의로 정하고, 화면은 첫 사유를 대표값으로 읽는다. 결함 다음은 KI(`TOUCHED` → `BELOW` → `NEAR` 중 하나) → `PRICE_MISSING` → `EVALUATION_PASSED`다. *(v4.16 — P8 컷 b1 명세 · 구현 b3: **결함 → `COUPON_UNRECORDED` → (상환 완료면 여기서 끝 — E-05) → KI → `PRICE_MISSING` → `EVALUATION_PASSED`**(DOC-007 §9.4 E-10). 월수익 미기록이 KI보다 앞인 이유는 결함과 같다 — 사용자가 거래내역을 옮겨야 해소되고 시장 상황으로는 사라지지 않는다.)*

> **`COUPON_UNRECORDED`는 상품 단위다 (v4.16).** 미기록 달이 여럿이어도 한 상품에 한 항목이고 화면은 「n개월 미기록」으로 말한다(DOC-008 SCR-101 ④). 주의는 **월수익 지급일 다음 날부터**다 — `CouponState = 'UNRECORDED'`의 조건이 `p_k < asOf`이므로 경과일(`asOf − p_k`)은 1 이상이다(U5. DOC-007 검산 E — 지급일 2026-10-21 · 기준일 2026-10-25면 4일. 평가일부터 세지 않는다). **n은 그 항목의 `count`다** *(b1 개정 — §9 ② 해결)* — 그 상품에서 `CouponState = 'UNRECORDED'`인 달의 수이고 1 이상이다. 다른 사유의 항목에는 없다(선택 필드). 화면이 다른 뷰에서 세지 않는다 — 세면 E-10의 판정을 계약 밖에서 다시 하게 되고(DOC-010 AQ-23 부류) SCR-101 ③이 `convertedCount`를 계약에서 받는 근거와 같다.

> **`attentionItems[].ownerName` 신설 (v2.0, P4 컷 9).** 종전 항목은 `productId`·`productName`·`reason` 셋이었고 **소유자를 말하지 않았다.** `scope = 'ALL'`에서 그것이 문제가 된다 — 이 목록의 사유는 저마다 조치를 지목하는데(`KI_BELOW` → SCR-202에서 사용자가 터치를 확정한다, 결함 둘 → SCR-204에서 고친다) **그 조치는 소유자만 할 수 있다**(ST-04·W-01). 소유자를 모르면 사용자는 자기가 할 수 없는 일이 목록에 있는 이유를 알 수 없고, 상세로 들어가서야 액션이 없음을 발견한다. 같은 뷰의 `upcomingEvaluations`가 이미 `ownerName`을 담고 있으며 그 필드가 있는 이유가 정확히 이것이다 — **한 뷰 안에서 두 목록의 주어가 달랐다.** `scope = 'MINE'`에서는 전부 본인이므로 중복이지만, 그 중복은 표시 계층이 지우면 되고 부재는 채울 수 없다.

**⑤ 최근 상환 실적 — `recentRedemptions` 신설 (v2.0, P4 컷 9).** DOC-008 §5는 SCR-101의 주요 요소를 다섯으로 규정하는데 v1.9까지 본 계약은 **넷만 담았다**(①`upcomingEvaluations` ②`totals` ③`currentYearTax` ④`attentionItems`). ⑤에 해당하는 데이터가 어디에도 없고 §8이 이 화면에 배정한 조회 계약은 `getDashboard` 하나이므로, **그 요소는 자료원 없이 문서에만 존재했다.** `totals.realizedPnl`은 합계이며 「무엇이 상환되었는가」를 말하지 않는다.

**왕복은 늘지 않는다.** `loadProducts`가 이미 `redemptions`를 임베드로 함께 읽고(`totals.realizedPnl`이 그 값으로 계산된다) `REDEMPTION_COLUMNS`가 필요한 다섯 열을 전부 담고 있다. 즉 이 배열은 **같은 행에서 나오는 다른 투영**이다 — 대안(SCR-101에 `listProducts`를 함께 배정하고 `status = 'REDEEMED'`로 좁히기)은 §8의 배정을 늘리고 왕복을 2 더하며 같은 데이터를 두 계약이 반환한다.

**기간 창을 두지 않는다** — `upcomingEvaluations`와 같은 근거이며, 여기서는 그것이 **검산 가능한 형태**가 된다: 창이 없으므로 `totals.realizedPnl = Σ recentRedemptions[].realizedPnl`이 항등식이고, 창을 넣는 순간 그 항등식이 깨진다 *(v4.9부터 이 항등식은 통화별이다 — `totals.byCurrency[c].realizedPnl = Σ recentRedemptions[currency = c].realizedPnl`. 아래 「통화별 합계」)*. 정렬은 `redemptionDate` **내림차순**이다(「최근」이 그 뜻이다. 동일 일자는 상품명 오름차순으로 안정화한다). 표시 건수는 화면이 정하고 **자름을 화면이 표시한다**(AQ-22가 등재한 「호출부에 절단 신호가 없다」의 반대 방향).

> **`upcomingEvaluations`에는 `ownerId`·`status`를 두지 않는다 — 확인한 결과다 (v2.0, P4 컷 9).** §4.4가 v1.8에서 그 둘을 신설했으므로 같은 부류의 결함이 여기에도 있는지 보았고, **둘 다 없어도 된다**는 결론이 나왔다. 근거가 서로 다르다.
>
> | 필드 | 왜 필요하지 않은가 |
> |---|---|
> | `ownerId` | §4.4가 그것을 신설한 이유는 **소유자 필터의 선택지 값**이 반환에 없어 `params.ownerId`를 쓸 수 없었다는 것이다. SCR-101에는 그 필터가 없다 — 범위 축이 `scope`(열거값 둘)이므로 **선택지가 데이터에서 나오지 않는다.** 표시에 필요한 것은 이름이고 그것은 이미 있다 |
> | `status` | 이 목록은 `nextEvaluation != null`인 행만 담고 그 값은 **상환 완료 상품에서 항상 `null`이다**(DOC-007 §9.2·E-05 — 판정이 `next`를 끊는다). 즉 담아도 전 행이 `'ACTIVE'`인 **구조적 상수**이고, §4.4에서 그 필드가 뜻을 가진 이유(행 단위가 차수이므로 상환 완료 상품의 남은 차수가 행으로 내려온다)가 여기서는 성립하지 않는다 |
>
> **비대칭이 결함인지 사실인지 구분한 기록이다.** v1.8과 v2.0이 같은 물음에 다른 답을 냈고, 그 차이가 「행 단위가 무엇인가」와 「선택지가 어디서 오는가」에서 나온다 — 뷰마다 같은 필드 집합을 갖게 만드는 것이 목표가 아니다.
>
> **그 점검의 범위가 좁았다 (v2.2, P4.5).** 위 표가 물은 것은 **`judge()`가 내는 여덟 값 중 둘**이며, 실제로 물은 물음은 「§4.4가 신설한 그 둘이 여기도 필요한가」였다. 물음이 「**이 뷰가 버리는 값이 있는가**」였다면 `integrityIssue`가 나왔다 — 그것이 이 절의 첫 각주(`worstOf = null`의 원인 둘)가 드러낸 자리다. 결론은 바뀌지 않지만(원인을 ④가 말하므로 필드를 더하지 않는다) **점검이 그 결론에 도달하지 않았다.** §8.1의 재발 방지 물음 넷째가 이 형태를 담당한다.

`isConfirmed`를 담는 이유는 ST-05다 — `is_confirmed = false`인 상환은 증권사 지급명세서로 확인되지 않은 값이므로 확정값과 같은 모습으로 표시하면 안 된다(§4.3의 `RedemptionView`가 같은 필드를 담는 이유). `realizedPnl`은 **음수 가능**하며 과세 금융소득과 갈리는 지점이다(절대 규칙 #8 — 손실 상환의 과세소득은 0이지만 실현손익은 음수다).

#### 통화별 합계 — `totals` · `currentYearTax` (v4.9 선행 명세 — P8 컷 a1, 구현 a2·a3)

**원과 달러를 더하지 않는다.** 종전 `totals`의 `activePrincipal`·`realizedPnl`은 전 상품의 합이었고, 달러 상품이 들어오면 그 덧셈이 `$70,000 + 10,000,000원 = 10,070,000`을 만든다 — 형식은 정상이고 값만 거짓이다. 환산해서 더하는 것도 답이 아니다: 투자원금·손익은 **확정 사실**인데 추정 환율을 곱하는 순간 추정이 되고(ST-05) 환율이 없으면 합계 자체를 만들 수 없다. 그래서 사실은 **통화별로** 합하고(DOC-007 §7.7) 원화로 합친 값은 **표식이 붙은 추정**으로 따로 싣는다(`krwEstimate`). 두 필드는 `byCurrency[]`로 옮겨 가고 최상위에서 사라진다 — 남겨 두면 그 값이 무엇의 합인지 답이 없다.

| 필드 | 정의 |
|---|---|
| `activeCount` | 보유중 상품 수. **개수는 통화를 넘어 더한다** — 단위가 없으므로 `= Σ byCurrency[].activeCount`가 항등식이다 |
| `byCurrency[]` | 범위(`scope`) 안에 상품이 하나라도 있는 통화마다 한 행이며 **보유중·상환 완료를 가리지 않는다**(`realizedPnl`이 상환 완료 상품에서 나온다). 순서는 `ProductCurrency`의 선언 순서(KRW → USD)이고 금액 순이 아니다. **상품이 0건이면 `[{ currency: 'KRW', activeCount: 0, activePrincipal: '0', realizedPnl: '0', receivedCoupons: '0' }]` 한 행**이다(`receivedCoupons`는 v4.16) — 빈 배열을 주지 않는다(종전 `totals`가 0건에서 `'0'`을 준 것과 같은 모양이고, §4.7 「빈 상태를 `[]`로 표현하지 않는다」와 같은 판단) |
| `byCurrency[].realizedPnl` | 그 통화 상품들의 포트폴리오 손익 합(DOC-005 — 실수령액 − 투자원금. ~~월수익을 더하는 산식은 컷 b1의 명세~~). 음수 가능. **항등식은 통화별이다** — `byCurrency[c].realizedPnl = Σ recentRedemptions[currency = c].realizedPnl`. 통화를 넘는 합은 값이 아니므로 항등식도 아니다. *(v4.16 — P8 컷 b1 명세 · 구현 b3)* **상환된 상품만 넣는다**(민서 결정(2026-10-02) ②) — 상환된 월지급 상품의 손익은 상환 세전 + Σ 지급(`PAID`) 월수익 − 투자원금이다(DOC-007 §7.7 · 검산 B-2: 60,000,000 + 18,000,000 − 100,000,000 = −22,000,000). **항등식은 그대로 선다** — `recentRedemptions[].realizedPnl`의 정의를 같은 산식으로 넓혔고, 보유중 상품의 월수익은 이 합에도 저 배열에도 없다(아래 `receivedCoupons`) |
| `byCurrency[].receivedCoupons` *(v4.16)* | **받은 월수익** — 그 통화의 **보유중** 월지급 상품이 이미 받은 월수익(`PAID` 기록의 세전) 합. 상품 통화 · 0 이상. **실현손익에 넣지 않는다**(민서 결정(2026-10-02) ②) — 만기에 KI 손실이 나면 원금 손실과 월수익을 합쳐야 손익이 확정되므로, 상환 전의 월수익을 손익으로 부르면 나중에 부호가 뒤집힐 값을 확정처럼 보인다. 그 상품이 상환되는 순간 이 합에서 빠져 `realizedPnl`로 옮겨 간다. 상환 시 지급 상품만 있으면 `'0'`이고 화면은 그 줄을 그리지 않는다(DOC-008 SCR-101 ②) |
| `krwEstimate` | **보유중 외화 원금이 있을 때만** 객체다(외화 행의 `activeCount > 0`). 원화 전용이거나 외화 상품이 전부 상환 완료면 `null`이다 — 상환된 외화 상품의 손익은 환산하지 않는다(환차손익은 모델 밖 — DOC-002 DQ-15 · DOC-007 RD-15) |
| `krwEstimate.activePrincipal` | `Σ byCurrency[c].activePrincipal × x(c)`(원화는 `x = 1`)를 원 단위로 접은 값(Q-07 ⓑ). **외화 중 하나라도 추정 환율이 없으면 `null`이다 — 부분합을 주지 않는다.** 부분합은 합계처럼 보이고, 빠지는 몫이 원금 통째라 「건 단위로 빼고 센다」(§4.0 규칙 3)가 여기서는 정직한 표시가 되지 못한다 |
| `krwEstimate.exchangeRateBasis` | 쓴 추정 환율. `activePrincipal`과 **함께 빈다** |

**원화 전용 포트폴리오는 금액 문자열이 바이트 단위로 같다.** 운영 상품은 전부 원화로 **보인다**(9/20 덤프 26건 · 달러 0건 — DOC-008 SQ-16). 그 「달러 0건」은 **상품명·발행사로 추론한 값이다** — 통화 열이 아직 없어(M-a2 전) 덤프가 통화를 말하지 못한다. M-a2의 `default 'KRW'`가 기존 행을 전부 원화로 채우므로, 추론이 틀렸다면 그 상품은 원화로 **조용히** 읽힌다. 그 경우 `byCurrency`는 원화 한 행이고 그 세 값은 종전 `activeCount`·`activePrincipal`·`realizedPnl`과 같으며 `krwEstimate = null`이다 — SCR-101 ②가 그 한 행을 종전 두 줄로 렌더하면 문자열이 바뀌지 않는다(DOC-008 SCR-101. e2e의 `'616,000원'` 고정이 원화 경로의 회귀망이다).

**② 마커는 여전히 `totals` 한 키다.** `tests/app/dashboard.test.ts`의 `ELEMENT_SOURCES`가 ②를 `totals`로 사상하고 그 사상은 바뀌지 않는다 — 새 필드는 ②의 **안쪽**이다. ⑥을 만들지 않는다.

**`currentYearTax`의 세 필드.** 값은 §4.6 `income`과 **같은 집계**이고 E-09도 같다 — 확정 원화 과세는 늘 들어가고 추정이 필요한 달러 건만 환율이 없을 때 빠진다. `unconvertedCount`가 그 ~~건 수~~ **상품 수**이며(§4.6 `income.unconvertedCount`와 같은 값) `exchangeRateBasis`는 환산이 한 건이라도 일어났을 때의 추정 환율이다. **`convertedCount`는 환산해 넣은 달러 추정 ~~건 수~~ 사건이 있는 상품 수다** — 일반계좌 · 달러 이익 > 0 · 추정 환율 있음(§4.6 `income.convertedCount`와 같은 값). *(v4.16 — 세는 단위는 상품이다. §4.0 「쿠폰 지급방식과 월수익」 규칙 4. 월지급식은 한 상품에 사건이 여럿이라 둘이 갈린다 — 달러 추정 월수익의 과세에는 원금이 없으므로 `max(0, …)`가 없고 늘 환율이 필요하다, DOC-007 §4.8)* DOC-008 SCR-101 ③의 「달러 상품 n건의 추정을 원화로 환산해 포함했다」의 n이 이 값이고, `exchangeRateBasis ≠ null ⇔ convertedCount > 0`이다. 비과세 계좌(`TAX_FREE`)와 달러 이익 ≤ 0의 달러 추정은 환율 없이 0이므로(DOC-007 §4.8 · 검산 A-2) **어느 쪽으로도** 세지 않는다. 홈은 이 값들로 ③의 불완전함과 환산 사실을 말한다 — 문구는 DOC-008 ST-07이다.

**컷**: `byCurrency`·`recentRedemptions[].currency`·`unconvertedCount`는 a2, `krwEstimate`·`exchangeRateBasis`·`convertedCount`는 a3다(§4.0 「컷별 도달」 — a2에는 추정 환율이 없어 `convertedCount`가 늘 0인 구조적 상수다). *(v4.16)* `receivedCoupons` · `realizedPnl`의 월수익 몫 · `COUPON_UNRECORDED`(와 그 `count` — b1 개정) · `COUPON_SCHEDULE_MISSING`은 b3, `currentYearTax`에 월수익 사건이 드는 것은 b4다(§4.0 「쿠폰 지급방식과 월수익」 컷별 도달). `krwEstimate`는 바뀌지 않는다 — 원금만 환산하고 받은 월수익은 환산하지 않는다(사실은 통화별 — DOC-007 §7.7).

### 4.2 상품 목록 — SCR-201

```ts
function listProducts(params: {
  ownerId?: string
  status?: 'ACTIVE' | 'REDEEMED'
  // 반환 kiStatus와 **같은 다섯 값**이다 (v1.4, AQ-24 해결)
  kiStatus?: 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED'
  sortBy?: 'EVALUATION_DATE' | 'PRINCIPAL' | 'D_DAY'
}): Promise<ProductListItem[]>

type ProductListItem = {
  id: string
  name: string
  ownerId: string
  ownerName: string
  principal: string
  currency: ProductCurrency            // v4.9 (P8 컷 a2) — 상품 통화. `principal`의 단위 (§4.0)
  accountType: 'GENERAL' | 'TAX_FREE'
  status: 'ACTIVE' | 'REDEEMED'        // 파생값 (D-01)
  entryMode: 'FULL' | 'REALIZED_ONLY'  // 기실현 등재 여부 (v3.2, DOC-002 §4.6)
  nextEvaluation: {
    roundNo: number
    date: string
    dDay: number
    barrier: string
  } | null                              // 상환 완료 또는 전 차수 경과 미상환 시 null
  worstOf: string | null
  conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
  kiStatus: 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED' | null
  integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | 'COUPON_SCHEDULE_MISSING' | null  // 셋째는 v4.16 (구현 b3) — 아래 D1
  isOwner: boolean                      // 액션 버튼 노출 판단
  couponPayout: CouponPayout            // v4.16 (P8 컷 b1 명세 · 구현 b3) — 쿠폰 지급방식 (§4.0)

  /**
   * 월수익 진행 — v4.16 (구현 b3). DOC-008 SCR-201 ⑮ 「지급 5/36 · 다음 D-12」의 자료원.
   * `null` = 상환 시 지급(그 축이 없다), 또는 결함 `COUPON_SCHEDULE_MISSING`의 억제(D1 — 원인은 `integrityIssue`가 말한다),
   * 또는 기실현 월지급(일정 0행 — 분모가 없다. b1 개정 · §9 ⑤ 해결)
   */
  couponProgress: {
    paid: number                        // PAID 기록 수 — 「지급 5/36」의 분자. UNPAID는 세지 않는다
    recorded: number                    // 기록 수(PAID + UNPAID)
    total: number                       // 월수익 일정 행 수 — 분모
    nextEvaluationDate: string | null   // 다음 월수익 평가일 — 「다음 D-12」. 기준일 당일 포함. 상환 완료이거나 남은 평가일이 없으면 null
  } | null

  /**
   * 기초자산별 **관측** — `terms.underlyings`의 형제다 (v3.4 신설, DOC-008 §5 ⑧)
   *
   * `terms`에 넣지 않는 이유는 아래 D1 표의 첫 행이다 — `ratio`·`isWorst`는 거기서
   * `worstOf`와 한 줄에 묶여 `UNDERLYING_MISSING`에 억제되는 값이고, `terms`는
   * 「D1이 미치지 않는다」가 정의다. `assetId`로 짝을 이루며 **이름·기준가를 사본으로
   * 싣지 않는다**(같은 값이 한 뷰에 둘이면 갈리는 날 정본이 없다).
   *
   * 순서는 `terms.underlyings`와 같은 `sequence`이지만 **화면은 순서가 아니라
   * `assetId`로 합친다** — 그 합침은 순수 함수이고 상시 스위트가 본다(AQ-23).
   */
  underlyingPrices: Array<{
    assetId: string
    currentPrice: string | null         // null = E-01 시세 없음. 그 자산만 빌 수 있다
    ratio: string | null                // 기준가 대비. `currentPrice`와 «함께» 빈다
    /** 워스트오브와 같은 비율인가. 동률이면 전부 true, `worstOf = null`이면 전부 false */
    isWorst: boolean
  }>

  /**
   * 계약 조건 — **판정값이 아니다** (v3.1 신설)
   *
   * 위의 필드는 대부분 판정의 결과이고(`status`·`worstOf`·`conditionResult`·
   * `kiStatus`) 이것은 사용자가 입력한 상품 계약 그대로다. 그 구분이 이름의
   * 이유이며, 억제 규칙(D1)이 이쪽에는 미치지 않는다 — 결함 상품도 계약 조건은
   * 있다(오히려 그때 화면이 보여줄 것이 이것뿐이다).
   */
  terms: {
    /**
     * `null` = 기실현 등재 (v3.2. `entryMode`의 짝이며 I-18이 `FULL`에서 보장한다).
     * v4.16 — 월지급식 FULL이면 `'0.0000'`이다(I-23 · V-08′). 수익은 아래 `monthlyCoupon`에 있다
     */
    annualCouponRate: string | null
    /**
     * v4.16 (구현 b3) — 월지급식 FULL의 월수익 조건. 상환 시 지급 · 기실현 등재(일정 없음)면 null (I-23 · b1 개정).
     * `barrier` = 모든 월수익 일정 행의 월수익 배리어가 같을 때 그 값, 다르면 null(화면 「월수익 배리어 달마다 다름」)
     */
    monthlyCoupon: { annualRate: string; barrier: string | null } | null
    kiBarrier: string | null            // null = 노낙인 (I-11의 짝)
    kiObservation: 'CONTINUOUS' | 'CLOSING' | null
    /**
     * `sequence` 순서. 기초자산이 0종인 결함 상품과 기실현 등재는 빈 배열이다.
     * `assetId`는 위 `underlyingPrices`와 짝짓는 **키**다(v3.4) — 표시값이 아니다.
     */
    underlyings: Array<{ assetId: string; assetName: string; basePrice: string }>
    /** 차수 순서. 스텝다운 표기의 정본이며 일괄 입력 형식(SQ-04)과 같은 순서다 */
    barriers: string[]
    /** 리자드가 붙은 차수만. 없으면 빈 배열 */
    lizards: Array<{
      roundNo: number
      barrier: string
      couponRate: string | null         // '0.0000' = 원금상환형 (Q-04)
      requiresNoKi: boolean
    }>
  }
}
```

> **`terms`를 담아도 왕복이 늘지 않는다 (v3.1) — 그것이 이 확장의 근거다.**
> `loadProducts`의 `PRODUCT_SELECT`가 **이미** `els_underlyings(+assets)`와
> `redemption_schedules`를 임베드한다(상품 + 하위 전부, 1 왕복). 판정 삼종이 그
>데이터를 쓰기 때문이며, v3.0까지 매퍼가 **그것을 읽고 버렸다.** 즉 이 확장은 조회를
> 넓히는 것이 아니라 **이미 온 것을 노출하는 것**이다 — select 변경 0, 왕복 증가 0,
> 마이그레이션 0.
>
> **`getProduct`의 하위 형태를 재사용하지 않는다.** 상세의 `schedules`는
> `expectedGross`·`conditionResult`·`isPast`를 담는다 — **차수별 판정**이고 목록이
> 요구하지 않는다. 같은 형태를 쓰면 목록이 쓰지 않는 값을 계산하게 되고, 무엇보다
> 「목록은 계약 조건 · 상세는 판정」이라는 구분이 타입에서 사라진다.
>
> **기초자산 쪽은 v3.4에서 겹치되 «형태가 다르다».** 세 값(`currentPrice`·`ratio`·
> `isWorst`)은 같지만 상세는 그것을 이름·기준가와 **한 객체로 평평하게** 담고
> (`priceAsOf`·`priceSource`도 함께 — SCR-202가 자산마다 출처와 갱신 시각을 적는다)
> 목록은 `terms`와 `underlyingPrices` **둘로 가른다.** 그 가름이 이 계약의 「계약 조건 ·
> 판정」 구분이며, 상세에는 그 축이 없으므로 형태가 갈리는 것이 정상이다. 값의 정의는
> 하나다 — 세 뷰가 같은 `judge()`의 같은 `worstOf`와 대조한다.
>
> **금액·비율은 문자열이다** — `basePrice`는 `numeric(18,6)`, 비율은 `numeric(6,4)`의
> `::text`다(§4.0 Q-08). 화면이 `priceDisplay`·`percent`로 표시만 바꾼다.

> **월수익 세 필드 — `couponPayout` · `terms.monthlyCoupon` · `couponProgress` (v4.16 선행 명세 — P8 컷 b1, 구현 b3).** `terms`에 드는 것은 **계약 조건**(월수익 연쿠폰율 · 월수익 배리어)뿐이고 진행(`couponProgress`)은 기록에서 나오는 관측이라 `terms` 밖에 둔다 — `terms`가 「D1이 미치지 않는다」로 정의된 것과 같은 가름이다(진행은 결함에 억제된다). **왕복은 늘지 않는다** — 월수익 두 테이블이 `loadProducts`(상품 루트)의 임베드로 오기 때문이다(§4.0 「쿠폰 지급방식과 월수익」 — 차수 루트 셀렉트에는 넣지 않는다, b1 개정). `couponProgress.paid`는 **`PAID`만** 센다 — 「지급 5/36」은 받은 달 수이고 미지급을 기록한 달은 분자에 들지 않는다(DOC-008 SCR-201 ⑮). `nextEvaluationDate`는 §4.2 `nextEvaluation`과 같은 규칙(기준일 당일 포함 가장 이른 날, 상환 완료면 `null`)을 월수익 일정에 적용한 것이고 **조기상환 차수와 섞지 않는다**. **SCR-201 ⑮의 「월수익 배리어 50%」는 `terms.monthlyCoupon.barrier`다** *(b1 개정 — §9 ③ 해결. 표시어가 「월수익 배리어」인 것은 DOC-005 §8.2가 수식어 없는 「배리어」를 금하기 때문이다)*. 월수익 배리어는 일정 **행마다** 있으므로 대표값을 따로 정의한다: 모든 행이 같으면 그 값, 다르면 `null`이고 화면은 「월수익 배리어 달마다 다름」을 적는다. 결함 `COUPON_SCHEDULE_MISSING`(일정 0행)이면 고를 값이 없어 `null`이다 — `terms`는 D1이 억제하지 않으므로 `annualRate`는 남는다. **그래서 `barrier = null`의 뜻이 둘이고 `integrityIssue`가 가른다** *(b1 개정 — 반박 검토 반영)* — `integrityIssue = 'COUPON_SCHEDULE_MISSING'`인 상품은 화면이 월수익 요약을 그리지 않고 결함 문구를 따른다(DOC-008 SCR-201 · ST-06 — 「달마다 다름」은 일정이 있을 때만 참이다).

**`sortBy = 'PRINCIPAL'`은 상품 통화로 먼저 묶고 그 안에서 원금 큰 순이다 (v4.9 선행 명세 — P8 컷 a1, 구현 a2. DOC-008 SQ-15의 계약 쪽 규칙).** 종전 정렬은 `principal`만 비교했고(`queries/products.ts`) 통화를 보지 않는다 — 달러 상품이 들어오면 `$70,000`(약 9,700만 원)이 `10,000,000원`보다 뒤에 온다. 형식은 정상이고 순서만 거짓이다.

- **통화 순서는 `ProductCurrency`의 선언 순서(KRW → USD)다.** 그 안에서 원금 큰 순이고, 동률은 종전처럼 입력 순서를 지킨다(안정 정렬).
- **환산해서 비교하지 않는다.** 그러면 순서가 추정 환율에 따라 날마다 바뀌고 환율이 없으면(ST-07) 정렬 자체가 정의되지 않는다. 정렬 키가 추정이 되는데 그 사실을 화면이 표시할 자리도 없다.
- **묶음은 계약이 한다 — 화면이 아니다.** 화면은 계약의 정렬 뒤에 페이지로 자르므로(`products/page.tsx`의 `paginate`) 화면에서 묶으면 페이지마다 통화 경계가 달라진다. Q-05대로 조회 후 정렬이고 왕복은 그대로다.
- **평가일·D-Day 정렬은 통화와 무관하므로 바뀌지 않는다.**

**`kiStatus` 파라미터가 반환과 같은 다섯 값이다 (v1.4, AQ-24 해결).** v1.3까지 파라미터는 3값(`SAFE`·`WARNING`·`TOUCHED`)이고 반환은 5값이어서 **`BELOW`·`NO_KI` 상품은 어떤 필터로도 뽑을 수 없었다.** 그중 `BELOW`는 §4.1이 「사용자 확인이 필요한 유일한 상태」라고 규정한 값이므로, 목록에서 그것만 골라볼 수 없다는 것은 설계가 아니라 결함이었다. 필터는 어차피 조회 후에 적용하므로(Q-05) 비용은 없다.

> **구현은 리터럴 유니온을 다시 적지 않고 도메인 열거형(`KiStatus`)을 색인한다.** 다시 적으면 두 목록이 갈릴 수 있고 AQ-24는 정확히 그 갈림이었다. 화면의 선택지도 같은 이유로 `KI_STATUS_LABELS`(`Record<KiStatus, string>`)의 키에서 만든다 — 열거값이 여섯째로 늘면 파라미터·라벨·뱃지 등급이 함께 컴파일에서 깨진다. 비대칭이 규율이 아니라 타입으로 막힌다.
>
> **`kiStatus`가 `null`인 상품은 여전히 어떤 값으로도 뽑히지 않으며 그것은 정의다.** `null`은 상태가 아니라 **판정의 부재**이고 원인이 셋이다(바로 아래 표) — 셋을 한 필터 값으로 묶으면 성격이 다른 상태 셋을 하나로 제시하게 되고, 그중 상환 완료는 이미 `status` 필터가 가른다. 화면은 그 셋을 `deriveDisplay()`로 구분해 표시한다.

**`conditionResult`·`kiStatus`의 `null`은 세 가지 원인을 갖는다.** 화면은 셋을 구분해 표시하며, **판정 순서는 아래 표의 위에서 아래다.**

| 순위 | 원인 | 조건 | 표시 |
|---|---|---|---|
| 1 | **무결성 결함 (I-07)** | `integrityIssue ≠ null` | "기초자산 없음 — 수정 필요". 시세를 기다려도 해소되지 않는다. SCR-204로 유도한다 |
| 2 | E-05 상환 완료 | `status = 'REDEEMED'` | 판정 생략 — 표시값은 상환 실적이다. 영구적이다 |
| 3 | E-01 시세 없음 | `status = 'ACTIVE'` 이고 `worstOf = null` | "시세 없음" — 시세가 수집되면 값이 생긴다 |

> **1순위의 조건은 「판정 입력을 파괴한 결함」이다 (v4.16 — P8 컷 b1 명세 · 구현 b3).** `COUPON_SCHEDULE_MISSING`은 `integrityIssue ≠ null`이지만 파괴한 입력이 **월수익뿐이라**(아래 D1) `conditionResult`·`kiStatus`를 억제하지 않는다. 그 상품의 `null`은 결함 때문이 아니므로 1순위로 잡으면 시세가 없는 것을 「수정 필요」로 잘못 설명한다 — 그 상품의 `null`은 2·3순위가 그대로 가른다. 판별은 결함 **이름**이 아니라 **파괴된 입력**으로 한다(§4.1 `PRICE_MISSING`이 이미 그 규칙이다). 결함 자체의 표시는 DOC-008 ST-06이다.

**순위가 필요한 이유.** 무결성 결함 상품은 `status = 'ACTIVE'`이고 `worstOf = null`이므로 3순위 조건을 **그대로 만족한다.** 순서를 정하지 않으면 화면이 "시세 없음"을 표시하며 **영원히 오지 않을 시세를 기다린다** — DOC-007 §3.1의 각주가 막으려던 바로 그 상태다. `integrityIssue`는 그 두 상태와 성질이 다르므로 `status`로 구분할 수 없고 별도 필드가 필요하다.

> **v0.5까지 별도 필드를 두지 않았던 이유와 그 철회(U-03).** v0.3은 "`status`로 두 경우가 구분되므로 별도 필드를 두지 않는다"고 적었고, 그 판단은 원인이 둘일 때는 옳았다. DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓히면서 세 번째 원인이 계약에 도달했다 — 계약을 경유하는 조작으로는 만들 수 없으나 DB에서는 여전히 도달 가능하다(DOC-010 AQ-14). 상세는 §9 AQ-17.

#### D1의 우선순위가 미치는 범위 (v0.8에서 확정)

위 표는 `conditionResult`·`kiStatus`만 규정했다. v0.7 구현은 그것을 **결함 상품 전체의 판정 중단**으로 해석했고, 그 결과 같은 결함 상품이 계약마다 다르게 보였다 — §4.3은 `projection`을 `null`로 두면서 §4.6은 **같은 상품의 같은 계산**으로 예상 과세소득을 냈고, `SCHEDULE_MISSING` 상품은 `ratio`가 표시되는데 `isWorst`만 전부 `false`가 됐다.

**억제는 그 결함이 파괴한 입력을 쓰는 값에만 미친다.** §9 AQ-17이 조회에서 정한 "멈추는 범위가 원인의 범위를 넘지 않는다"와 같은 논리다 — 거기서는 상품 1건의 결함이 목록 **전체**를 죽이지 않게 했고, 여기서는 한 **입력**의 결함이 무관한 파생값을 죽이지 않게 한다.

| 파생값 | 입력 | `UNDERLYING_MISSING` | `SCHEDULE_MISSING` |
|---|---|---|---|
| `worstOf`·`ratio`·`isWorst` | 시세 + 기초자산 | **억제** (산출 불가) | 산출 |
| `kiStatus` | 위 + KI 배리어 | **억제** | 산출 |
| `conditionResult`·`willMeet` | 위 + 적용 차수 | **억제** | 차수가 없어 `null` |
| `nextEvaluation` | 평가일정 | 산출 | 차수가 없어 `null` |
| `expectedGross` | 계약 조건 | 산출 | 해당 차수 없음 |
| `projection` | 계약 조건 + 적용 차수 | **산출** | 차수가 없어 `null` |
| §4.6 과세 기여 | 계약 조건 + 적용 차수 | **산출** (표식과 함께) | 차수가 없어 제외 |
| §4.1 조치 사유 | 사유별로 다르다 | §4.1의 표 | §4.1의 표 |

> `SCHEDULE_MISSING` 열의 `null`은 **억제가 아니라 자연 결과**다 — 차수가 0건이면 고를 적용 차수가 없다. 둘을 구분하지 않으면 차수가 생겼을 때 무엇이 되살아나야 하는지 알 수 없다.

> **셋째 결함 `COUPON_SCHEDULE_MISSING` (v4.16 선행 명세 — P8 컷 b1, 구현 b3).** 월지급식(`MONTHLY`) FULL인데 월수익 일정이 0행이다(I-25 위반 — 쓰기 함수 꼬리 검사 `els_products_monthly_schedules_required`가 계약 경로를 막고, 직접 INSERT 우회만 남는다 — §3.2.1. **그 꼬리 검사는 b2의 쓰기 쪽이고 이 결함의 판정 · 표시는 b3다** — 둘은 다른 것이다, b1 개정 · DOC-008 ST-06). **파괴한 입력은 월수익이다** — `DestroyedInput`에 `'COUPONS'`가 더해지고, 억제는 **월수익 사건과 그 표시뿐**이다. 위 표의 모든 행이 이 결함에서 「산출」이다(상환 판정은 산다). 월수익 쪽 파생값(§4.2 `couponProgress` · §4.3 `coupons`·`remainingCoupons` · §4.6 월수익 사건 · §4.1 `COUPON_UNRECORDED`)은 억제된다 — 일정이 없어 어차피 비지만, `SCHEDULE_MISSING` 열과 같은 이유로 「억제」와 「자연 결과」를 이름으로 가른다. **`integrityIssue`는 값이 하나다** — 우선순위는 **기존 결함 다음**이다(`UNDERLYING_MISSING` → `SCHEDULE_MISSING` → `COUPON_SCHEDULE_MISSING`). 결함이 둘인 상품은 앞의 것만 보고되고, 뒤의 것은 앞의 것을 고친 뒤에 드러난다 — `DESTROYED_BY`도 값이 하나이므로 억제가 보고된 결함을 따른다. **기실현 월지급은 이 결함이 아니다** — 일정 0행이 정의다(I-25는 `FULL`만 본다).

**★ 이 표는 `integrityIssue` 축만 규정한다 — E-05는 별개 축이다.** 위 표의 "산출"은 **결함 축이 막지 않는다**는 뜻이지 값이 반드시 나온다는 뜻이 아니다. E-05(상환 완료)는 **독립적으로 적용되며**, 두 축이 겹치면 둘 다 걸리고 막는 쪽이 이긴다.

| 축 | 막는 것 | 기전 |
|---|---|---|
| `integrityIssue` | 위 표 | 파괴된 입력에 따른 판정 게이트 |
| **E-05 (상환 완료)** | `kiStatus` · `conditionResult` · `nextEvaluation` · `projection` · 결함 외 조치 사유 | `asActive`가 `null`을 준다(DOC-007 §9.1) + `status = 'REDEEMED'` 분기 |

> **구체 예 — `SCHEDULE_MISSING` + 상환 완료의 `kiStatus`는 위 표의 "산출"이 아니라 `null`이다.** 표만 읽고 구현하면 어긋난다.
>
> `worstOf`·`ratio`·`isWorst`는 **두 축 어디에도 막히지 않는다** — 위 표의 `SCHEDULE_MISSING` 열이 그렇게 정하고, E-05는 이 세 값을 규정한 적이 없다(상환 완료 상품도 `worstOf`를 표시한다). 이것은 v0.8이 바꾸는 사항이 아니라 현행 동작의 확인이다.

#### ★★ 셋째 축 — 기실현 등재 (v3.2, DOC-002 D-07)

`entry_mode = 'REALIZED_ONLY'`인 상품은 기초자산 0종·평가일정 0건이다. **같은 부재를 만들지만 결함이 아니다** — 그래서 축이 하나 더 필요하다.

| 축 | `integrityIssue` | 판정 억제 |
|---|---|---|
| `UNDERLYING_MISSING` (I-07 위반) | `'UNDERLYING_MISSING'` | 위 표 |
| **기실현 등재** | **`null`** | **같다** — 시세·차수 입력이 둘 다 없다 |

**★ 억제를 새로 만들 필요가 없다 — 이미 세 겹이 이 경우를 덮는다 (실측).** 이 절의 초안은 「억제는 결함 이름이 아니라 부재를 따라야 하고, 어기면 기초자산 0종에 워스트오브를 물어 빈 집합의 `min()`이 되므로 화면이 전원에게 죽는다」였다. **그 근거가 거짓이다.** 억제를 결함 이름에 매단 구현으로 음성 대조를 돌렸더니 **89건 전부 초록**이었고, 원인을 찾아보니 방어가 이미 셋이었다.

| 무엇이 막는가 | 어디 |
|---|---|
| `worstOfRow`가 기초자산 0건을 **스스로** 가드한다 | 조회 구현. 「0건이면 `worstOf`를 호출하지 않는다」 |
| `asActive`가 상환 완료에서 `kiStatus`·`conditionResult`를 죽인다 | DOC-007 §9.1 (E-05) |
| `attentionReasonsFor`가 `REDEEMED`에서 먼저 반환한다 | §4.1 조치 사유 |

기실현 등재는 **정의상 항상 상환 완료**이므로(D-07) 뒤의 둘이 언제나 걸린다. 따라서 `destroyed`를 어느 쪽으로 계산해도 뷰의 값이 한 칸도 달라지지 않는다.

> **그래서 방어 코드를 두지 않고 케이스를 둔다.** 지켜야 하는 것은 위 세 겹의 **도달 가능성**이고, 그것을 단언하는 층이 없었다 — 셋 중 하나가 사라지면 기실현 상품에 `PRICE_MISSING`이 붙어 SCR-101이 「시세 없음」을 표시하고, 사용자는 **영원히 오지 않을 시세를 기다린다**(ST-06이 금지한 상태). 계기는 `tests/db/map.test.ts`의 「조치 사유가 비어 있다」이며 음성 대조 둘이 그 케이스**만** 깨뜨림을 확인했다(① `REDEEMED` 조기 반환 제거 → `['PRICE_MISSING']` ② `entry_mode` 가드 제거 → `['UNDERLYING_MISSING']`).
>
> **없는 위험을 지키는 분기보다 있는 위험을 판별하는 단언이 싸다** — 그 분기는 자기가 무엇을 막는지 말하면서 실제로는 아무것도 막지 않으므로, 다음 사람이 그 문장을 근거로 다른 결정을 한다. 초안의 `RangeError` 서술이 정확히 그런 문장이었다.

**`worstOf`는 이 축에서 값이 없다.** 위 각주의 「두 축 어디에도 막히지 않는다」는 셋째 축에 대해서는 참이 아니다 — 그 문장은 **입력이 있는 상품**을 전제하며, 기실현 등재는 기초자산이 0종이라 비교할 기준가가 없다(`worstOfRow`가 `null`을 준다). `null`의 원인 표(§4.2 위)에서는 **2순위(E-05 상환 완료)로 잡힌다** — 기실현 등재는 정의상 항상 상환 완료이므로 「판정 생략 — 표시값은 상환 실적이다」가 그 상품에 대한 정확한 문구다. 새 순위를 만들지 않는다.

**단 하나의 예외 — 상환이 취소된 기실현 상품은 결함이다.** `deleteRedemption`이 그 상품을 보유중으로 되돌리면 계약 조건도 상환도 없는 상태가 되고(DOC-002 §7), 그때는 `integrityIssue = 'UNDERLYING_MISSING'`이다. 즉 이 축의 판정은 `entry_mode`만이 아니라 **`entry_mode` ∧ 상환 존재**다. `entry_mode`만 보면 판정 입력이 하나도 없는 보유중 상품이 정상으로 읽힌다.

> **기실현 월지급 (v4.16 선행 명세 — P8 컷 b1).** `coupon_payout = 'MONTHLY'`인 기실현 등재는 연쿠폰율도 월수익 연쿠폰율도 `NULL`이고(I-23 — `REALIZED_ONLY`는 계약 조건이 없다, D-07) 월수익 일정이 0행이며, 월수익 이력은 등재 뒤 §5.14로 **순번 없는 `PAID` 기록**을 적는다(I-27 · DOC-008 SQ-17). 그 기록은 **확정 사건**이다(귀속 = 지급일 연도 — §4.0 「쿠폰 지급방식과 월수익」 규칙 1). 일정 0행이 정의이므로 `COUPON_SCHEDULE_MISSING`이 **아니다**(위 D1 각주). **표시는 b1 개정이 정했다**(§9 ⑤ 해결 · DOC-008 SQ-17의 계약 쪽) — 목록(§4.2)에서 `terms.monthlyCoupon = null` · `couponProgress = null`(분모가 없다), 상세(§4.3)에서 `coupons = []`이고 순번 없는 기록은 형제 필드 `unnumberedCouponRecords`(지급일 순)에 실린다 — `coupons`는 일정 행마다라 순번 없는 기록이 들 자리가 없기 때문이다. 상품당 기록은 60건 이하다(V-27 — b1 개정).

### 4.3 상품 상세 — SCR-202

```ts
function getProduct(id: string): Promise<ProductDetailView | null>

type ProductDetailView = {
  product: {
    id: string
    name: string
    issuer: string | null
    ownerId: string
    ownerName: string
    isOwner: boolean
    /** `null` = 기실현 등재 (v3.2). `entryMode = 'FULL'`이면 항상 있다(I-18) */
    issueDate: string | null
    principal: string
    currency: ProductCurrency           // v4.9 (P8 컷 a2) — principal과 아래 상품 통화 금액의 단위 (§4.0)
    evaluationPeriodMonths: number
    totalRounds: number                 // 파생값 = schedules.length (DOC-002 §4.6)
    // ↓ 판정 삼종 (v1.4 신설). §4.2 우선순위표의 입력이며 목록과 **같은 세 필드**다
    status: 'ACTIVE' | 'REDEEMED'       // 파생값 (D-01)
    entryMode: 'FULL' | 'REALIZED_ONLY' // v3.2. 목록과 같은 필드다
    worstOf: string | null
    kiStatus: 'NO_KI' | 'SAFE' | 'WARNING' | 'BELOW' | 'TOUCHED' | null
    integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | 'COUPON_SCHEDULE_MISSING' | null  // 셋째는 v4.16 (§4.2 D1)
    annualCouponRate: string | null     // v3.2 — 위 issueDate와 같은 짝. v4.16 — 월지급식 FULL이면 '0.0000' (V-08′)
    couponPayout: CouponPayout          // v4.16 (P8 컷 b1 명세 · 구현 b2 — b1 개정: 수정 폼의 초기값이라 「쿠폰 지급」 선택 상자 · V-25와 같은 커밋, §4.0 컷별 도달) — 쿠폰 지급방식
    /** v4.16 (구현 b3 · b1 개정) — 월수익 연쿠폰율. 4자리. 월지급식 FULL만 값, 상환 시 지급 · 기실현 등재면 null (I-23). SCR-204 수정 화면의 초기값 */
    monthlyCouponAnnualRate: string | null
    kiBarrier: string | null
    kiObservation: 'CONTINUOUS' | 'CLOSING' | null
    kiTouchedAt: string | null
    accountType: 'GENERAL' | 'TAX_FREE'
    note: string | null
  }
  underlyings: Array<{
    assetId: string
    assetName: string
    basePrice: string
    currentPrice: string | null
    priceAsOf: string | null
    priceSource: 'AUTO' | 'MANUAL' | null
    ratio: string | null
    isWorst: boolean
  }>
  schedules: Array<{
    roundNo: number
    evaluationDate: string
    barrier: string
    lizardBarrier: string | null
    lizardCouponRate: string | null
    lizardRequiresNoKi: boolean | null
    expectedGross: string | null        // null = 연쿠폰율이 없어 산출할 수 없다
    conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
    isPast: boolean
  }>
  projection: {
    appliedRoundNo: number
    expectedGross: string               // 상품 통화
    /** v4.9 (P8 컷 a2) — 원화(과세 축). null = E-09 — 달러 상품인데 추정 환율이 없다 */
    expectedTaxableIncome: string | null
    exchangeRateBasis: ExchangeRateBasisView | null   // v4.9 (P8 컷 a3) — 원화 환산에 쓴 추정 환율
    attributionYear: number
  } | null                              // 아래 두 경우에 null
  redemption: RedemptionView | null

  /**
   * v4.16 (P8 컷 b1 명세 · 구현 b3) — 월수익 일정 행마다 하나, 월수익 순번 오름차순.
   * null = 상환 시 지급, 또는 결함 `COUPON_SCHEDULE_MISSING`의 억제(§4.2 D1).
   * 기실현 월지급은 [] — 일정 행이 없다(b1 개정). 아래 「월지급 상품」
   */
  coupons: CouponObservationView[] | null
  /**
   * v4.16 (구현 b3 · b1 개정) — 순번 없는 월수익 지급 기록(기실현 월지급의 `PAID`), 월수익 지급일 순.
   * `coupons`는 일정 행마다라 이 기록이 들 자리가 없다. 그 밖의 상품은 [] (FULL의 기록은 늘 순번이 있다 — I-27)
   */
  unnumberedCouponRecords: CouponRecordView[]
  /**
   * v4.16 (구현 b4 · 모양은 b1 개정) — 잔여 월수익(DOC-005 §6): 흐름 끝 안 **추정** 월수익을 연도별로. `projection`의 **형제**다 — 안에 두지 않는다:
   * `projection`은 NO_ROUND · 상환 완료에서 null인데 이 사건들은 F에 남는다.
   * null = `coupons`와 같은 경우(상환 시 지급 · `COUPON_SCHEDULE_MISSING`의 억제). 추정이 없으면 `byYear`가 빈 배열
   */
  remainingCoupons: {
    byYear: Array<{
      year: number                      // 귀속연도 = year(월수익 지급일)
      count: number                     // 그 해의 추정 월수익 사건 수
      grossAmount: string               // 상품 통화 — Σ q_k (q_k는 보조단위 절사값 — §4.0 「형식」, b1 개정)
      taxableIncome: string | null      // 원화(과세 축). null = E-09 — 달러 · 추정 환율 없음. 비과세 계좌는 '0'
    }>
    /** 달러 추정 월수익을 환산한 추정 환율. 원화 상품 · 환산하지 않았으면 null (projection이 null인 상품에서도 남는다) */
    exchangeRateBasis: ExchangeRateBasisView | null
  } | null
}

/** v4.16 — 월수익 일정 한 행과 그 달의 기록·상태 */
type CouponObservationView = {
  couponNo: number                      // 월수익 순번 — 화면 표시 「5번째 · 2027-02-16」(순번 + 월수익 평가일 — 민서 결정(2026-10-02) ①)
  evaluationDate: string                // 월수익 평가일
  paymentDate: string                   // 월수익 지급일 (일정의 값)
  couponBarrier: string                 // 월수익 배리어. 4자리
  state: CouponState                    // §4.0 「구획」
  record: CouponRecordView | null       // 그 달의 월수익 지급 기록. 없으면 null
  expectedAmount: string                // 상품 통화 — q_k(보조단위 절사값 — §4.0 「형식」, b1 개정). F · SCR-206 기본값과 같은 값
  conditionResult: CouponConditionResult | null   // 다음 한 행에만 값. 나머지 행은 null (DOC-007 §3.5)
}

/** v4.16 — 월수익 지급 기록 하나. `coupons[].record`와 `unnumberedCouponRecords[]`가 같은 모양이다(b1 개정) */
type CouponRecordView = {
  id: string                            // §5.15의 대상
  outcome: CouponOutcome
  paymentDate: string | null            // 기록의 월수익 지급일(거래내역). UNPAID면 null (I-26). 일정의 지급일과 다를 수 있다
  grossAmount: string | null            // 상품 통화. UNPAID면 null (I-26)
  taxableIncome: string | null          // 원화. UNPAID면 null
  withholdingTax: string | null         // 원화
  exchangeRate: string | null           // 적용 환율(참고) — 계산에 쓰지 않는다
  isConfirmed: boolean
  note: string | null
}

type RedemptionView = {
  id: string
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo: number | null
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax: string | null
  exchangeRate: string | null           // v4.9 (P8 컷 a2) — 적용 환율(참고). 계산에 쓰지 않는다
  isConfirmed: boolean
  realizedPnl: string                   // 파생값(포트폴리오 손익). 상품 통화. 음수 가능. v4.16 — 월지급 상품은 Σ PAID 월수익 포함
  note: string | null
}
```

#### 판정 삼종을 뷰에 담는다 (v1.4 신설, P4 컷 3)

v1.3까지 이 뷰에는 `integrityIssue`만 있었고 `status`·`worstOf`·`kiStatus`가 없었다. **셋 다 이미 산출되어 있었고 매퍼가 버렸다** — 같은 `judge()`가 §4.2의 목록 항목에는 그 셋을 담는다. 신설의 근거는 편의가 아니라 **§4.2 우선순위표의 단일 구현**이다.

우선순위표(무결성 결함 > E-05 상환 완료 > E-01 시세 없음)를 구현하는 함수의 입력이 정확히 `{status, worstOf, integrityIssue}` 셋이다. 뷰가 그 셋을 담지 않으면 **SCR-202가 두 개를 스스로 합성한 뒤 그 함수를 부르게 된다.**

| 화면이 합성해야 했던 것 | 합성 방법 | 왜 위험한가 |
|---|---|---|
| `status` | `redemption == null ? 'ACTIVE' : 'REDEEMED'` | D-01의 정의를 화면이 다시 진술한다 |
| `worstOf` | `underlyings.find(u => u.isWorst)?.ratio` | 동률·`isWorst` 전부 false 두 경우에 의존한다 |

두 합성은 **오늘은 옳다.** 문제는 옳음을 확인할 층이 없다는 것이다 — 화면(`page.tsx`)은 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어가지 못한다(DOC-010 AQ-23). 즉 「SCR-201과 SCR-202가 같은 판정을 낸다」는 주장이 **검증 불가능한 합성의 정확성에 의존**하게 된다. 뷰가 셋을 담으면 두 화면이 같은 함수에 같은 모양을 넘기고, 그 동일성은 순수 모듈 수준에서 대조된다(`tests/db/map.test.ts`).

`kiStatus`는 합성조차 불가능하다. 등급 판정은 「주의」 임계 배수와 `NO_KI`·`TOUCHED`·`BELOW`의 순서를 요구하므로 `lib/domain`의 재구현이 되며(DEP-04의 취지 위반) DOC-008 SCR-202는 「④ KI 상태」를 주요 요소로 규정한다. §4.1의 `KI_BELOW` 조치가 「사용자가 터치 여부를 확정한다(**SCR-202**)」로 이 화면을 지목하므로, 그 화면이 등급을 표시하지 못하면 조치의 목적지가 조치의 근거를 보여주지 않는다.

**억제 규칙은 §4.2와 동일하다** — 셋은 `judge()`가 내는 같은 값이므로 §4.2의 D1 표와 E-05 축이 그대로 적용된다. 예: `SCHEDULE_MISSING` + 상환 완료의 `kiStatus`는 `null`이다.

**필드 정의 (v0.6에서 확정)**

| 필드 | 정의 |
|---|---|
| `product.status`·`product.worstOf`·`product.kiStatus` | §4.2의 같은 이름 필드와 **같은 값**이다(같은 `judge()`). 목록과 상세가 한 상품에 대해 다른 판정을 표시할 수 없다는 것이 이 세 필드의 존재 이유다 |
| `product.totalRounds` | `schedules.length`. **`max(round_no)`가 아니다** — 차수 번호의 연속성(V-04)은 계약 계층에만 있어 DB는 `1, 2, 99`를 허용하므로 두 값이 갈릴 수 있다. 정본은 행 수다(DOC-002 §4.6) |
| `underlyings[].isWorst` | 최저 비율인 기초자산. **동률이면 전부 `true`**, `worstOf`를 산출할 수 없으면(어느 하나라도 시세 없음, 또는 기초자산 0건) 전부 `false`. 동률에서 하나만 고르면 그 선택이 표시 순서에 의존하는 임의값이 된다. **일정 0건(`SCHEDULE_MISSING`)은 "산출 불가"에 해당하지 않는다 (v0.8)** — 시세 입력이 온전하므로 `ratio`와 `isWorst`를 그대로 산출한다. v0.7 구현은 결함이면 `worstOf`를 통째로 죽여 `ratio`는 표시되는데 `isWorst`만 사라지는 상태를 만들었다 |
| `schedules[].expectedGross` | **판정과 무관하게 전 차수에 정의된다** — "그 차수에 조기상환된다고 가정한 세전 수령액"이며 DOC-007 §4.1의 `EARLY` 가정을 따른다. 상품의 계약 조건에서 나오는 값이므로 상환 완료 상품에서도 의미가 있다(실제 수령액은 `redemption.grossAmount`이고 둘은 다른 값이다) |
| `schedules[].conditionResult` | **적용 차수 한 행에만 값이 있다 (v2.2에서 명문화, P4.5).** 나머지 차수는 전부 `null`이므로 6차 상품이면 여섯 행 중 **최대 하나**가 값을 갖는다. 적용 차수는 `nextEvaluation`(DOC-007 §9.2)이 고른다. **다른 차수의 배리어로 지금 시세를 판정하면 그 차수가 도래했을 때의 결과인 척하는 값이 된다** — 바로 위 `expectedGross`가 전 차수에 정의되는 것과 **정반대**이고, 그 차이는 편의가 아니라 입력에서 나온다(`expectedGross`는 계약 조건만, 이 값은 시세 + **적용 차수**). §4.2 D1 표의 `conditionResult` 행이 입력을 「위 + 적용 차수」로 적은 것이 **상품 단위**의 같은 규칙이며, 이 표의 이 행이 그것을 **차수 배열의 어느 행인가**로 옮긴 것이다. **`null`의 원인은 넷이고 이 필드로는 갈리지 않는다** — ① 그 행이 적용 차수가 아니다 ② 적용 차수가 없다(상환 완료 E-05 · 전 차수 경과 미상환 · 일정 0건) ③ 무결성 결함 `UNDERLYING_MISSING`(§4.2 D1) ④ 시세 없음 E-01(`evaluateCondition`이 `worstOf == null`에서 `null`을 반환한다, TC-22). ①만 이 뷰에서 갈릴 수 있다(`schedules`의 다른 행에 값이 있는가) |
| `projection` | 다음 **두 경우**에 `null`이다. ① 상환 완료 ② **적용 차수가 없다** — 전 차수가 경과했는데 미상환이거나(DOC-007 §9.2가 이 경우 적용 차수를 결정할 수 없다고 규정한다), 평가일정이 0건(`SCHEDULE_MISSING`)인 경우다. **무결성 결함은 그 자체로 사유가 아니다 (v0.8에서 정정, U-03)** — `projection`은 계약 조건(원금·쿠폰율·평가주기·차수·계좌구분)에서만 나오고 **시세를 하나도 쓰지 않으므로** `UNDERLYING_MISSING` 상품에서도 산출한다. 바로 위 `expectedGross`가 판정과 무관하게 전 차수에 정의되는 것과 같은 이유이며, §4.6이 같은 상품의 과세 기여를 산출하는 것과도 같은 근거다. **v0.5의 주석("상환완료 시 null")은 ②를 놓쳤고, v0.6의 "② `integrityIssue ≠ null`"은 반대로 원인의 범위를 넘어 억제했다** — 같은 상품이 §4.6에서는 과세에 기여하면서 §4.3에서만 값을 잃어 두 화면이 서로 모순되게 보였다(§4.2의 입력 기준) |

#### 달러 상품 — 상품 통화와 원화 과세 (v4.9 선행 명세 — P8 컷 a1, 구현 a2·a3)

**한 상품 안에서 금액이 두 통화다.** `product.currency`가 `principal`·`schedules[].expectedGross`·`projection.expectedGross`·`redemption.grossAmount`·`redemption.realizedPnl`의 단위이고, `projection.expectedTaxableIncome`·`redemption.taxableIncome`·`redemption.withholdingTax`는 **통화와 무관하게 원화**다(Q-07 ⓐ·ⓑ).

| 필드 | 원화 상품 | 달러 상품 |
|---|---|---|
| `projection.expectedTaxableIncome` | 종전 값 그대로(`taxableIncome()` — 비과세 계좌 0 포함) | 일반 계좌: `max(0, expectedGross − principal)_USD × x`를 원 단위로 접은 값(DOC-007 §4.8). `x`는 추정 환율(§4.0 규칙 2). 없으면 `null`(E-09). 비과세 계좌: 환율 없이 `'0'`(검산 A-2) |
| 〃 — 일반 계좌 · 달러 이익 ≤ 0 | — | **환율 없이 `'0'`**(DOC-007 §4.8 — `x`보다 먼저 본다). E-09가 아니며 세지 않는다. a1 범위의 이 값(조기상환 가정)에서는 V-08이 연쿠폰율 `> 0`을 요구해 도달하지 않지만, 이 분기가 없으면 월지급식(컷 b1 — 조기상환·만기 수익률 0)의 달러 추정이 전부 E-09로 표시된다. *(v4.16 — 도달한다: V-08′가 월지급식 FULL에 연쿠폰율 0을 요구하므로 `expectedGross = principal`이고 이 줄이 그 상품의 상환 추정이다)* |
| `projection.exchangeRateBasis` | 항상 `null` | 환산했으면 그 추정 환율, 아니면 `null` |
| `redemption.taxableIncome`·`withholdingTax` | 거래내역 값 | 거래내역의 **원화** 값(A-04 · U1). 환율을 곱해 만든 값이 아니다 |
| `redemption.exchangeRate` | 항상 `null`(V-24가 원화 상품에서 거부한다) | 사용자가 거래내역에서 옮긴 지급일 환율 — 참고값이다 |

**환산은 이익에만 한다 — 원화로 바꾼 두 금액의 차가 아니다.** `expectedGross × x₁ − principal × x₀`(지급일·청약일 환율로 각각 바꾼 차)을 쓰지 않는다. 그러면 원금의 환차익이 과세표준에 들어가는데, 투자설명서의 「발행가액 대비 초과소득」·「지급일 … 환산」 문언과 국세청 유사 예규가 가리키는 방향은 **달러 이익을 지급일 환율로 환산**이다. **다만 원금 환차익 비과세를 명시한 1차 출처는 확인하지 못했다** — 이 산식은 그 문언에서의 **추론**이며 DOC-007 RD-13이 미결로 들고 있다. 청약 시점 환율 `x₀`는 저장하지도 않는다(DOC-002 DQ-15).

**`projection` 자체의 `null` 두 경우는 그대로다.** 안쪽 `expectedTaxableIncome = null`은 **셋째이며 뜻이 다르다** — 적용 차수와 귀속연도는 있고(산출은 됐다) 원화로 바꿀 환율만 없다. 같은 상품이 §4.6에서 `exchangeRateMissing = true`로 나오므로 두 화면이 같은 사실을 말한다. 화면 문구는 DOC-008 ST-07이다.

**`redemption.exchangeRate`는 어떤 계산에도 쓰이지 않는다.** 과세 금융소득·원천징수세액의 정본은 거래내역의 원화 값이고(U1) 추정 환율의 원천도 아니다 — 추정 환율은 `exchange_rates`에서만 나온다(DOC-007 RD-09). 한 상품의 지급일 환율을 다른 상품의 추정에 쓰면 그 환율의 날짜가 기준일과 무관해진다.

**`redemption.realizedPnl`은 상품 통화의 포트폴리오 손익이다** — `grossAmount − principal`이고 환차손익을 넣지 않는다(DOC-005 §8.5). ~~월수익을 더하는 산식(`portfolioPnl`)은 컷 b1의 명세다.~~ → 월지급 상품은 `grossAmount + Σ PAID 월수익 − principal`이다 — 아래 「월지급 상품」 *(v4.16)*.

**컷**: `currency`·`exchangeRate`·`expectedTaxableIncome`의 `null`(E-09)은 a2, `exchangeRateBasis`와 실제 환산은 a3다. a2~a3 사이 미상환 달러 상품의 `expectedTaxableIncome`은 **일반 계좌 · 달러 이익 > 0이면** 늘 `null`이다(비과세 계좌와 이익 ≤ 0은 환율 없이 `'0'` — 위 표. v4.11에서 범위를 좁혔다).

#### 월지급 상품 — 월수익 목록과 손익 (v4.16 선행 명세 — P8 컷 b1, 구현 b3 · `remainingCoupons`는 b4)

**상환 쪽은 그대로다.** 월지급식 FULL은 연쿠폰율이 0이므로(V-08′) `schedules[].expectedGross`·`projection.expectedGross`가 투자원금이고 `projection.expectedTaxableIncome`은 `'0'`이다(r = 0 — 이익이 없다. 달러도 위 표의 「이익 ≤ 0」 줄로 환율 없이 0). **수익은 전부 `coupons`와 `remainingCoupons`가 말한다** — `projection`에 월수익을 접지 않는다. `projection`은 상환 사건 하나의 추정이고(§4.0 「쿠폰 지급방식과 월수익」 규칙 1) 월수익을 넣으면 상환 시 지급 상품과 같은 필드가 다른 것을 뜻한다.

**`coupons` — 일정 행마다 하나.**

- **`state`는 §4.0의 「구획」이 고른다.** 흐름 끝(`T_end`)은 `redemption`이 있으면 그 상환일, 없으면 `projection.appliedRoundNo` 차수의 평가일, 적용 차수가 없으면 무한이다 — **`projection`의 적용 차수와 같은 차수다**(DOC-007 §7.6. 두 값이 갈리면 「예정 · 조기상환 가정 밖」의 경계가 ⑤의 가정과 어긋난다). 기록이 있으면 `record`가 정본이고 `state`는 `PAID`·`UNPAID`다.
- **`expectedAmount`는 모든 행에 정의된다** — `q_k`는 계약 조건(투자원금 · 월수익 연쿠폰율)에서만 나오고 시세를 쓰지 않는다. `PAID` 행의 실제 금액은 `record.grossAmount`이고 둘은 다른 값이다(`schedules[].expectedGross`와 `redemption.grossAmount`의 관계와 같다). SCR-202 ⑦의 금액 표시가 이 값이다. **값은 `q_k` — 보조단위 절사값이고 F · SCR-206의 세전 기본값과 같다**(§4.0 「형식」 — b1 개정, DOC-007 RD-10 ③ 해결).
- **`conditionResult`는 다음 한 행에만 값이 있다** — 기준일 당일 포함 가장 이른 월수익 평가일의 행이고, **보유중 상품만**이다(DOC-007 §3.5 — `W(t_k) ≥ β_k`면 `EXPECTED_PAID`, 경계 포함. `W`를 낼 수 없으면 `UNKNOWN`). 나머지 행과 상환 완료 상품의 모든 행은 `null`이다. 최신 시세로 판정하므로 **그 달의 결과를 예고하는 표시일 뿐이고** F에도 기록에도 쓰지 않는다(§4.0 규칙 3). `schedules[].conditionResult`(적용 차수 한 행 — v2.2)의 거울이고 근거도 같다: 다른 달의 배리어로 지금 시세를 판정하면 그 달이 왔을 때의 결과인 척하는 값이 된다. **지난 달의 결과를 제안하지 않는다**(DOC-007 RD-14 부분 해소) — 기록 화면(SCR-206)은 결과 빈칸에서 시작한다. KI 터치와 무관하다(기본형 — GQ-06 · DOC-002 DQ-16).
- **`record.id`가 SCR-202 ⑦의 액션 대상이다** — 행마다 「수정」(SCR-206의 한 행 폼 → §5.15 `updateCouponPayment`) · 「삭제」(§5.15 `deleteCouponPayments`) · 구획의 「월수익 기록 전부 지우기」(같은 계약에 그 상품의 기록 id 전부). 표시 문구는 DOC-008 SCR-202 ⑦이다.
- **`record.paymentDate`는 기록의 값이다** — 거래내역의 지급일이고 일정의 `paymentDate`와 다를 수 있다(SCR-206은 일정의 지급일로 채우고 사용자가 거래내역의 날짜로 고친다). 확정 사건의 귀속이 이 값의 연도이고(§4.0 규칙 1) 수정 폼(`?edit=<id>`)의 초기값이 이 값이다. *(b1 결정의 `record` 목록에는 없던 필드다 — b1 개정이 순번 없는 기록을 「지급일 순」으로 싣게 하면서 그 기록의 유일한 날짜가 되었고, 순번 있는 기록에서도 §5.15 전체 교체의 초기값이 이것이므로 같은 모양 `CouponRecordView`에 둔다)*

**`unnumberedCouponRecords` — 순번 없는 기록 (구현 b3 · b1 개정).** 기실현 월지급 상품의 월수익 지급 기록(전부 `PAID` — I-27)을 월수익 지급일 순으로 싣는다. 그 상품은 일정이 없어 `coupons = []`이고 §4.2 `couponProgress = null`이다(분모가 없다). 이 기록도 **확정 사건**이다(귀속 = 기록의 지급일 연도 — §4.0 규칙 1). SCR-202 ⑦의 「수정」 · 「삭제」 · 「월수익 기록 전부 지우기」가 이 배열의 `id`에도 같다. 상품당 60건 이하다(V-27 — b1 개정). 그 밖의 상품은 `[]`다 — FULL의 기록은 늘 순번이 있다(I-27).

**`remainingCoupons` — 잔여 월수익 (구현 b4 · 모양은 b1 개정).** 낱말은 DOC-005 §6 「잔여 월수익」이다 — 「잔여 원금」의 짝이고 「잔여」는 「아직 오지 않은」이 아니라 **「아직 기록되지 않은」**이다 *(b1 개정 — 반박 검토 반영: 종전 이 절은 같은 것을 「연도별 추정 월수익」이라 불러 DOC-008 SCR-202 ⑤의 낱말과 동의어가 둘이었다)*. `byYear`는 기록이 없고 흐름 끝 안(`t_k ≤ T_end`)인 달 — 곧 **추정 월수익 사건 전부**를 귀속연도(`year(일정.payment_date)`)별로 묶은 것이고 연도 오름차순이다. **미기록(지급일이 지난 무기록 달)도 든다** — 추정 사건이므로 F에 들어가 있다(U5). 그래서 이 배열은 §4.6의 그 상품 그 해 `breakdown.coupons`의 추정 몫과 **같은 사건 집합**이다 — `remainingCoupons.byYear`의 `year = Y` 원소의 `taxableIncome` = `getTaxSummary(Y)`의 그 상품 행 `breakdown.coupons.estimatedTaxableIncome`. 컨테이너가 `null`인 것은 `coupons`와 같은 경우다(상환 시 지급 · `COUPON_SCHEDULE_MISSING`의 억제). 기실현 월지급은 추정 사건이 없으므로 `{ byYear: [], exchangeRateBasis: null }`이다.

- **`projection` 밖에 두는 이유** — `projection`은 상환 완료와 적용 차수 없음(NO_ROUND)에서 `null`이지만 **두 경우 모두 추정 월수익이 F에 남는다.** 상환된 상품은 흐름 끝(상환일) 안의 무기록 달이, NO_ROUND 상품은 흐름 끝이 무한이라 남은 모든 달이 추정 사건이다. 안에 두면 F에 든 값이 이 화면에서만 사라진다 — v0.8이 고친 「§4.3·§4.6 모순」의 재발이다.
- **`taxableIncome`** — 원화 일반계좌는 `Σ q_k`, 달러 일반계좌는 `Σ q_k × x`(DOC-007 §4.8 — 원금이 없으므로 `max(0, …)`가 필요 없다), 비과세 계좌는 `'0'`(환율 없이). 달러인데 추정 환율이 없으면 `null`(E-09) — `count`·`grossAmount`는 남는다.
- **`exchangeRateBasis` — 쓴 추정 환율은 이 컨테이너가 싣는다** *(b1 개정 — §9 ⑥ 해결)*. `projection.exchangeRateBasis`는 `projection`이 `null`인 상품(NO_ROUND · 상환 완료)에서 함께 사라지는데 그 상품들의 추정 월수익은 남으므로, 근거를 값 곁에 둔다(DOC-008 SCR-202 ⑤ 「환율 기준 또는 「환율 없음」」). 달러 추정 월수익을 환산했으면 그 추정 환율이고, 원화 상품 · 비과세 계좌(환율 없이 0) · 추정 환율 없음(E-09 — `taxableIncome = null`이 말한다)이면 `null`이다. 추정 환율이 요청당 통화별 하나이므로(§4.0 달러 규칙 2) `projection.exchangeRateBasis`가 함께 있으면 같은 값이다.
- **검산 B-1** (DOC-007 — 원화 · 일반계좌 · P 100,000,000 · 월수익 연쿠폰율 0.072 · 기준일 2026-07-28 · 기록 없음 · 흐름 끝 2027-01-19): `{ byYear: [{ year: 2026, count: 5, grossAmount: '3000000', taxableIncome: '3000000' }, { year: 2027, count: 1, grossAmount: '600000', taxableIncome: '600000' }], exchangeRateBasis: null }` — 6번째 달(평가 2027-01-19 · 지급 2027-01-22)은 흐름 끝과 같은 날 평가되므로 든다(경계 포함). 상환 사건의 과세는 0이다(r = 0). 0.072를 연쿠폰율에 넣는 틀린 일괄 모델이면 F(2026) = 0 · F(2027) = 3,600,000이다.

**`redemption.realizedPnl` — 상환된 월지급 상품은 월수익을 포함한다.** 포트폴리오 손익 = 상환 세전 + Σ 지급(`PAID`) 월수익(상품 통화) − 투자원금이다(DOC-007 §7.7 · 민서 결정(2026-10-02) ②). `UNPAID`는 더하지 않는다. 검산 B-2: 만기 손실 상환 세전 60,000,000 + `PAID` 30달 18,000,000 − 100,000,000 = **−22,000,000** · B-3: 1차 조기상환 세전 = 투자원금 + 6달 `PAID` → **+3,600,000**. **보유중 상품에는 이 값이 없다**(`redemption = null`) — 받은 월수익은 §4.1 `receivedCoupons`가 통화별로 말하고 실현손익에 넣지 않는다(민서 결정(2026-10-02) ②).

**결함 `COUPON_SCHEDULE_MISSING`** — `product.integrityIssue`가 그 값이고 `coupons`와 `remainingCoupons`는 `null`이다(억제 — §4.2 D1. `remainingCoupons`의 `null`은 b1 개정이 컨테이너를 nullable로 둔 뒤의 표기다). 상환 쪽(`schedules[]`·`projection`·`kiStatus`)은 산다.

> **수정 화면이 같은 계약을 읽는다** — SCR-204 수정 모드의 초기값(`productValuesOf`)이 `getProduct`에서 온다. 월수익 일정의 행 값(순번 · 평가일 · 지급일 · 배리어)은 `coupons`가, 월수익 연쿠폰율은 `product.monthlyCouponAnnualRate`가 싣는다 *(b1 개정 — §9 ④ 해결. 종전에는 그 율을 싣는 필드가 §4.3에 없었다)*. 쿠폰 지급방식은 `product.couponPayout`이 싣고 **그 필드만 b2다**(「쿠폰 지급」 선택 상자 · V-25와 같은 커밋 — §4.0 컷별 도달, b1 개정). 율과 일정의 초기값은 월지급 블록과 함께 b3다 — 그 사이 저장값이 `MONTHLY`인 상품(dev 표본 · 통합 픽스처뿐 — 운영 폼은 b4까지 「월지급식」을 고를 수 없다)의 수정 저장은 V-25에 걸린다.

### 4.4 평가일정 — SCR-301

```ts
function listSchedule(params: {
  from?: string
  to?: string
  ownerId?: string
  activeOnly?: boolean
}): Promise<ScheduleItem[]>

type ScheduleItem = {
  productId: string
  productName: string
  ownerId: string                      // v1.8 신설 — 소유자 필터의 선택지 값
  ownerName: string
  roundNo: number
  evaluationDate: string
  dDay: number
  barrier: string
  hasLizard: boolean
  status: 'ACTIVE' | 'REDEEMED'        // v1.8 신설 — §4.2 우선순위표의 E-05 단
  worstOf: string | null
  conditionResult: 'EARLY' | 'LIZARD' | 'CARRY_OVER' | null
  integrityIssue: 'UNDERLYING_MISSING' | 'COUPON_SCHEDULE_MISSING' | null   // 둘째는 v4.16 (구현 b3) — 아래 「한 값뿐인 이유」
  isPast: boolean

  // v3.3 신설 다섯 — SCR-301 상품별 보기. 앞의 넷은 차수마다 «같은 값»이다
  principal: string                    // 카드 머리의 투자원금. 차수 손익의 기준선
  currency: ProductCurrency            // v4.9 (P8 컷 a2) — principal·proceeds의 통화. 차수마다 «같은 값»이다
  annualCouponRate: string | null      // 카드 머리의 연쿠폰율. `proceeds`와 «같은 조건»으로 빈다
  accountType: 'GENERAL' | 'TAX_FREE'  // 원천징수 유무를 가르는 축 (DOC-007 §4.3)
  totalRounds: number                  // 그 상품의 «전체» 차수. 행 수이며 max(round_no)가 아니다
  proceeds: ScheduleProceeds | null    // `annualCouponRate == null`일 때만 null

  // v3.4 신설 셋 — SCR-301 카드 머리(DOC-008 §5 ⑨⑩). 차수마다 «같은 값»이다
  kiBarrier: string | null             // null = 노낙인 (I-11의 짝. §4.2 `terms`와 같은 정의)
  kiObservation: 'CONTINUOUS' | 'CLOSING' | null
  /** `sequence` 순서. 기초자산이 0종인 결함 상품은 빈 배열이다 */
  underlyings: Array<{
    assetName: string
    basePrice: string                  // 계약 조건 — 발행 시점에 확정된다
    currentPrice: string | null        // null = E-01 시세 없음. 그 자산만 빌 수 있다
    ratio: string | null               // `currentPrice`와 «함께» 빈다
    isWorst: boolean                   // §4.2·§4.3과 같은 정의
  }>
}

/**
 * 차수별 금액 — **다섯이 함께 있거나 함께 없다.**
 * 독립 nullable로 흩으면 「넷은 있고 하나만 없다」가 타입상 표현 가능해지는데
 * 그 조합은 실재하지 않는다. §4.3의 `projection: {…} | null`과 같은 형태다.
 */
type ScheduleProceeds = {
  expectedGross: string        // 세전. DOC-007 §4.1의 `EARLY` 가정 (§4.3의 같은 이름과 같은 값)
  expectedWithholding: string  // 예상 원천징수. `TAX_FREE`는 `'0'`. 달러 상품은 «달러 기준 참고»값 (v4.9 — 아래)
  expectedNet: string          // 세후 예상 수령액 = 세전 − 예상 원천징수. **잔차다**
  expectedPnl: string          // 예상 손익 = 세전 − 투자원금
  separateTaxationRate: string // 위 셋에 «실제로 쓰인» 분리과세율. 화면 고지가 이것을 렌더한다
  taxLawYear: number           // 그 세율의 연도. 기준일의 연도와 다르면 근사다
}
```

**`ownerId`가 없으면 `ownerId` 파라미터를 쓸 수 없다 (v1.8 신설, P4 컷 7).** 본 계약은 `params.ownerId`로 소유자를 좁히고 DOC-008 §5는 소유자 필터를 이 화면의 요소로 규정하는데, 반환에는 `ownerName`만 있었다 — 즉 **좁힐 값을 이 계약에서 얻을 수 없었다.** 화면이 선택지를 만들려면 이름을 UUID로 되돌려야 하고 그 대응은 어디에도 없다. §4.2의 `ProductListItem`은 처음부터 `ownerId`·`ownerName` 둘을 담았고(그래서 SCR-201의 소유자 필터가 성립한다) 같은 필터가 이 화면에도 있다는 사실만 §4.4에 반영되지 않았다.

> **AQ-24와 같은 부류의 비대칭이다.** 그쪽은 파라미터가 반환보다 좁아 두 상태를 고를 수 없었고(3값 vs 5값), 이쪽은 **파라미터는 있는데 고를 값이 반환에 없다.** 둘 다 「필터의 입력과 출력이 같은 계약 안에서 닫히는가」를 확인하지 않아 생겼다. 대안(사용자 목록을 `listUserSummaries`로 따로 읽기)은 §8이 이 화면에 배정한 조회 계약을 늘리는 일이고, 그쪽은 왕복 4(당시 — v4.13 이후 5)에 전 사용자의 세금을 계산한다 — SCR-201이 같은 대안을 같은 이유로 버렸다.

**`status`가 필요한 이유 — 필터로 숨기는 것과 표시로 구분하는 것은 다르다 (v1.8 신설, P4 컷 7).** `activeOnly`는 상환 완료 상품의 차수를 **목록에서 빼는** 수단이고, 그 필터가 꺼진 상태(기본)에서 이 뷰는 그 차수를 **미상환 상품의 차수와 똑같은 모습으로** 내려보낸다. 상환된 상품의 남은 평가일은 도래하지 않으므로 화면은 「다가오는 평가일」에 **오지 않을 날짜**를 섞어 보여 주게 되고, 사용자가 그 사실을 알 방법이 뷰 안에 없다. 필터를 켜면 사라지지만 사라진 것과 상환된 것도 구분되지 않는다.

> **§4.3의 판정 삼종(v1.4)과 같은 부류이고 근거도 같다.** `judge()`가 이미 `status`를 내고 매퍼가 **버리고 있었다.** §4.2 우선순위표(무결성 결함 > **E-05 상환 완료** > E-01 시세 없음)의 단일 구현(`deriveDisplay`)이 입력으로 `{status, worstOf, integrityIssue}`를 요구하는데, 이 뷰에는 셋 중 하나가 없어 **그 함수를 부를 수 있는 세 화면 중 이 화면만 그 판정을 할 수 없었다.** 그리고 §4.3과 달리 **화면이 합성할 수조차 없다** — 상환 레코드도 상환일도 이 뷰에 없으므로(§4.4는 차수 단위다) 유도할 입력 자체가 없다. v1.4가 「합성의 정확성을 확인할 층이 없다」를 근거로 삼았다면 여기는 그보다 한 단계 앞이다.
>
> **「다섯 화면」이 아니다 (v2.2에서 정정, P4.5).** v1.8은 이 자리를 「다섯 화면 중 이 화면만」으로 적었고 그 수는 `deriveDisplay` 머리글의 「이 판정을 하는 화면이 다섯이다(SCR-101·201·202·301·401)」에서 왔다. **소비자는 셋이다**(SCR-201·202·301). 나머지 둘은 **부를 수 없다** — §4.1 `upcomingEvaluations`와 §4.6 `contributingProducts`는 입력 셋을 담지 않고, 담지 않기로 한 것이 각 절에 근거와 함께 기록된 판단이다. 두 화면은 다른 수단으로 같은 목적을 이룬다(§4.1은 중립 문구 + ④가 원인을 말한다, §4.6은 표식만 붙인다). **틀린 것은 구현이 아니라 기록이며**, 그 기록을 근거로 세 파일이 자기를 「두 번째」·「다섯 번째 소비자」로 번호 매겼고 그중 둘이 동시에 「두 번째」였다. 정본 목록은 `lib/format/derived.ts`의 머리글 표 하나로 옮겼다 — 서수는 소비자가 늘 때마다 낡는다.
>
> **차수마다 같은 값이 실린다** — `productName`·`ownerName`이 이미 그 형태다. 행 단위가 차수인 뷰에서 상품 단위 사실을 나르는 유일한 방법이고, 상품별로 접어 내려보내면 §4.4가 루트를 차수로 둔 이유(날짜 범위가 루트 열 조건이어야 한다)가 무너진다.
>
> ★ **상품별 «보기»가 생겨도 계약의 루트를 상품으로 바꾸지 않는다 (v3.3, P6 컷 6).** 바꾸는 순간 `from`·`to`가 임베드 필터가 되고 아래 「질의의 루트」 각주가 적은 함정(적용 차수가 **잘린 일정 집합**에서 승격되어 `conditionResult`가 엉뚱한 차수에 그럴싸하게 붙는다)이 되살아난다. **묶는 것은 화면의 순수 함수(`groupByProduct`)이고 계약의 형태가 아니다** — 그러면 두 보기가 같은 계약·같은 필터·같은 판정을 공유하고, 묶는 규칙이 상시 스위트에 보인다. v3.3이 다섯 필드를 더하면서도 이 절의 구조를 건드리지 않은 것이 그 결정이다.

**`isPast`와 `status`는 직교한다.** 앞은 그 차수의 평가일이 기준일보다 앞서는가이고 뒤는 그 상품이 상환되었는가다. 넷 중 셋이 실재한다 — 미상환의 경과 차수(E-07 · §4.1의 `EVALUATION_PASSED`), 미상환의 미래 차수, 상환 완료의 과거 차수. 남은 하나(상환 완료 + 미래 차수)도 정상이며 그것이 이 필드를 만든 상태다: **상환일 이후의 차수 행은 지워지지 않는다**(I-01은 상환을 상품당 하나로 제한할 뿐 일정을 지우지 않는다).

**`integrityIssue`가 여기서는 ~~한 값뿐인~~ 좁은 이유.** 일정 0건인 상품은 이 목록에 **행 자체가 생기지 않으므로** `SCHEDULE_MISSING`은 도달할 수 없다. §4.2·§4.3과 같은 유니온을 주면 결코 관측되지 않는 값을 화면이 처리하게 되고, 타입이 사실과 어긋난다. *(v4.16 — P8 컷 b1 명세 · 구현 b3)* **`COUPON_SCHEDULE_MISSING`은 도달한다** — 그 상품은 **조기상환** 차수가 있으므로 이 목록에 행을 갖는다(없는 것은 월수익 일정이다). 그래서 유니온이 둘이 된다 — 같은 논증(「행 단위가 차수다」)이 이번에는 넓히는 쪽으로 작동한다. 이 결함은 이 목록의 판정을 억제하지 않는다(§4.2 D1 — 파괴한 입력이 월수익뿐이다). ⚠ **판정에는 그 상품의 월수익 일정 존재 여부가 필요한데, 이 계약의 상품 임베드(차수 루트)에는 월수익 두 테이블을 넣지 않는다**(아래 「월지급 상품의 차수 행」 — b1 개정). 「전부」를 넣지 않는 것이지 존재 탐침까지 막는 것은 아니지만 그 형태(행 하나만 · 열 하나만 · 이 목록에서는 결함을 싣지 않기)는 b1 명세에 없다 — §9 「P8 월지급 — b2 전에 정한다」 ⑰(b3 전).

**월지급 상품의 차수 행은 그대로다 (v4.16 — P8 컷 b1).** 이 목록은 **조기상환 차수만** 담는다. 월지급식 FULL은 연쿠폰율이 0이므로(V-08′) `proceeds.expectedGross`가 투자원금이고 `expectedPnl`은 0 · `expectedWithholding`은 0이다 — **월수익은 차수의 금액에 들지 않는다**(같은 날 지급되는 그 달 월수익도 별개다 — U6). 월수익 행은 별도 계약 §4.12 `listMonthlyCouponSchedule`이 낸다. 이 유니온(`ScheduleItem`)에 섞지 않는 이유는 그 절에 있다 — 화면의 `groupByProduct`가 `roundNo`로 정렬하므로 순번이 다른 축의 행이 들어오면 그 정렬이 깨진다. **이 계약의 상품 임베드(`loadScheduleRows` — 차수 루트)는 월수익 두 테이블을 담지 않는다**(b1 개정 · DOC-010 AQ-77) — 담으면 그 상품의 월수익 전부가 차수 행 수만큼 복제되는데 이 목록은 그것을 읽지 않는다. 그래서 b3은 지금 공유하는 `PRODUCT_SELECT`를 상품 루트 셀렉트와 차수 루트 셀렉트로 가른다(§4.0 「쿠폰 지급방식과 월수익」 왕복).

**`conditionResult`는 적용 차수 한 행에만 값이 있다 (v2.2에서 명문화, P4.5).** 정의는 §4.3 필드 정의 표의 `schedules[].conditionResult`와 **같다** — 두 뷰가 같은 `judge()`의 같은 값을 같은 조건으로 싣는다(적용 차수와 행의 차수가 일치할 때만). 상품 하나가 여섯 차수를 가지면 그 상품에서 나온 여섯 행 중 최대 하나가 값을 갖는다.

> **차수 단위 뷰에서 이 규칙의 함의가 하나 더 있다.** §4.3은 한 상품의 차수를 배열로 주므로 화면이 「이 배열의 어느 행이 적용 차수인가」를 볼 수 있다. **본 계약은 여러 상품의 차수를 한 목록으로 섞으므로** 값이 없는 행 앞에서 화면은 「적용 차수가 아니다」와 「적용 차수인데 판정할 수 없다」를 **구분할 수 없다** — 원인 넷(§4.3의 같은 항목) 중 ①만 §4.3에서 갈리고 여기서는 그것조차 갈리지 않는다. `status`·`integrityIssue`·`worstOf`가 그 원인 중 셋을 각각 말하며(상환 완료 · 결함 · 시세 없음), 그 셋이 이 뷰에 있는 이유가 이것이다.
>
> **`isPast`와의 함의는 한 방향뿐이다.** `nextEvaluation`은 `evaluation_date < asOf`인 차수를 **고르지 않으므로**(DOC-007 §9.2 — 경과 차수는 E-07이 담당한다) 적용 차수는 항상 `isPast = false`다. 따라서 **`isPast = true` ⟹ `conditionResult = null`**이 보장된다. 역은 성립하지 않는다 — 미래 차수 중 값을 갖는 것은 **가장 이른 하나**이고 나머지 미래 차수는 전부 `null`이다. 그래서 **화면은 `isPast`로 이 값의 유무를 판단할 수 없다**(그 역이 필요한 방향이다). 판단할 수 있는 것은 반대뿐이다: 경과 행에 값이 있으면 그것은 결함이다.

**금액 다섯이 계약에 있는 이유 — 「화면이 합성할 수 있다」와 「그 옳음을 볼 층이 있다」는 다르다 (v3.3 신설, P6 컷 6).** `expectedPnl`은 `expectedGross − principal`이고 화면이 뺄 수 있다. 그러나 §4.3이 판정 삼종에 대해 v1.4에서 적은 것이 그대로 성립한다 — **`page.tsx`는 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어가지 못한다**(DOC-010 AQ-23). 화면이 빼면 그 뺄셈이 옳은지, 그리고 §4.3의 `projection`이 같은 상품에 같은 답을 내는지를 **아무도 대조하지 않는다.** 계약이 담으면 `tests/db/map.test.ts`가 두 뷰의 동일성을 순수 모듈 수준에서 본다. `lib/format`에 두는 길도 없다 — `barrierGap`이 두 값을 받는 형태로 있는 이유가 「화면에서 뺄셈이 일어나지 않게」이고, 같은 규약이 여기에도 적용된다.

> **`expectedNet`은 합성조차 «불가능»하다.** 세율이 `tax_constants`에 있고 순수 모듈은 상수를 인자로만 받으므로(절대 규칙 #3·#5) 화면이 그 값을 얻을 경로가 계약 말고는 없다. 원천징수를 함께 싣는 것도 같은 이유다 — 없으면 화면이 `세전 − 세후`를 계산하게 된다.
>
> **`separateTaxationRate`가 값과 «함께» 이동한다.** 화면의 고지(「세후는 15.4% 분리과세 기준」)는 절대 규칙 #5에 따라 그 숫자를 코드에 적을 수 없다. 별 조회 계약을 만드는 것보다 값을 만든 세율을 값 옆에 두는 편이 낫다 — **둘이 갈릴 수 없다.**

**조회를 넓히지 않는다 — 상품 쪽 넷은 «이미 오던 것»이다.** `loadScheduleRows`의 상품 임베드가 이미 `principal::text`·`annual_coupon_rate::text`·`account_type`·`evaluation_period_months`를 싣고 판정이 그것을 쓴다. v3.2까지 **매퍼가 그것을 읽고 버렸다.** `totalRounds`도 마찬가지다 — 임베드된 부모가 자기 일정 **전체**를 담으므로(위 「질의의 루트」 각주가 그 이유를 적는다) 행 수를 세기만 하면 된다. 즉 select 변경 0·왕복 증가 0이며, §4.2가 v3.1에서 `terms`를 더할 때 쓴 근거와 같은 형태다. 새로 드는 것은 **세율 한 왕복뿐**이고 스키마 변경은 0이다.

**v3.4의 셋도 같다 — 시세는 이 계약이 «이미» 읽는다.** `listSchedule`은 자산별 최신 시세를 받아 `worstOf`를 산출하고 있었고(그것이 `worstOf`·`conditionResult`의 입력이다) 매퍼는 **자산 단위 값을 접은 뒤 버렸다.** KI 두 열도 상품 임베드에 이미 있다(`judge()`가 `kiStatus`에 쓴다). 그래서 select·왕복·스키마 모두 그대로다.

> **§4.2와 달리 «합쳐서» 담는다 — 비대칭이지만 근거가 있다.** 그쪽은 `terms`(계약 조건)와 `underlyingPrices`(관측)를 가르고 `assetId`로 짝짓는데, **본 계약에는 그 축이 애초에 없다** — `barrier`(계약)와 `worstOf`(판정)가 이미 한 평면에 있다. 없는 축을 여기서 만들면 짝짓기 키가 **아무것도 지키지 않는 채로** 화면에 노출된다. 대신 §4.2가 화면에서 쓰는 것과 **같은 순수 함수의 출력 타입**을 담으므로 두 화면의 렌더러가 하나다(DOC-008 §5가 「표기가 바이트 동일하다」로 그것을 요구한다).
>
> **`assetId`를 담지 않는 것이 그 결정의 짝이다.** 이 배열은 합쳐진 결과이므로 짝지을 상대가 없고, 담으면 「무엇과 짝짓는 키인가」에 답이 없는 필드가 된다.
>
> **차수마다 같은 값이 실린다** — `principal`·`annualCouponRate`와 같은 형태이며 근거도 같다(루트가 차수인 뷰에서 상품 단위 사실을 나르는 유일한 방법이다). 화면이 `groupByProduct`로 접고, 그 접기가 첫 항목에서 값을 취하는 것을 §4.4의 이 보장이 정당화한다.
>
> **억제** — `UNDERLYING_MISSING`이면 배열이 빈다(기초자산이 0종이다). 시세가 하나만 없으면 그 자산의 `currentPrice`·`ratio`만 `null`이고 `isWorst`는 **전부 거짓**이다(워스트오브가 `null`이므로 대조할 값이 없다). `kiBarrier`·`kiObservation`은 계약 조건이므로 어느 축에도 억제되지 않는다.

> **`totalRounds`가 필요한 이유는 기간 필터다.** `from`·`to`가 6차수 중 3~4차만 남기면 카드는 「3차부터 시작하는 상품」으로 읽힌다. 화면이 `max(roundNo)`로 합성하면 그 경우 **4가 나와 틀린다**. 정본은 행 수이며 `max(round_no)`가 아니라는 규약은 §4.3의 같은 이름 필드가 이미 세웠다(V-04는 계약 계층에만 있어 DB는 1, 2, 99를 허용한다). **`activeOnly`는 이 값을 흔들지 않는다** — 그 필터는 부모 조건이라 상품을 통째로 빼며, 한 상품의 차수 집합을 **부분적으로** 자를 수 있는 것은 기간 조건뿐이다.

**세율 연도는 «기준일의 연도» 하나다 — 차수의 귀속연도가 아니다 (v3.3).** 사용자 결정이 「15.4% 고정 · 참고용」이므로 목록 전체가 한 세율을 쓰고, `taxLawYear`가 그 세율이 어느 해 것인지 드러낸다.

> ★ **차수별로 푸는 길은 «화면 전체를 죽인다».** `resolveTaxYear`는 시드보다 과거인 연도를 **거부한다**(`TaxSeedRangeError`) — ADR-005의 재현성이 근거이고 §4.6·§5.4가 그 성질에 의존한다. 그런데 이 화면은 **지난 차수를 구획으로 반드시 렌더하고**, 2025년 평가일을 가진 상품은 지금 만들 수 있다(발행일에 하한이 없고 기실현 등재는 과거 이력을 옮기는 화면이다). 차수별로 풀면 **남의 상품 하나가 SCR-301을 전원에게 500으로 만든다** — 모든 SELECT 정책이 `using (true)`이므로 §8.2가 기록한 그 부류다. `year(asOf)`로 못박으면 `asOf`가 과거가 될 수 없으므로 그 분기가 **구조적으로 도달 불가**가 된다.
>
> **`resolveTaxYear`를 고쳐서 해결하지 않는다.** 그 함수의 거부는 신고 산출값에 대해 옳고, 그것을 무르면 §4.6·§5.4가 함께 무른다. 값이 아니라 **호출 인자**를 바꾸는 것이 이 결정이다.
>
> 지금은 이 선택이 숫자를 바꾸지도 않는다 — 시드가 2026 하나뿐이라 2027~2029 차수는 어차피 전부 2026으로 근사된다(`resolveTaxYear`의 미래 분기). **차수별 해석이 사는 것은 크래시뿐이다.** 2027이 시드되는 날 한 목록이 두 세율을 갖게 되는지는 그때 관측한다(DOC-010 AQ-66).

**억제 규칙이 이 다섯에 미치지 않는다.** 결함 상품(`UNDERLYING_MISSING`)도 계약 조건은 온전하고 이 값들은 **시세를 하나도 쓰지 않는다.** 상환 완료 상품도 같다 — §4.3의 `expectedGross` 필드 정의가 「판정과 무관하게 전 차수에 정의된다」이고, E-05가 파괴하는 입력이 여기엔 하나도 없다. §4.3이 v0.6에서 정확히 이 실수를 했고(「`integrityIssue ≠ null`이면 억제」) **v0.8이 되돌렸다** — 원인의 범위를 넘어 억제하면 같은 상품이 §4.6에서는 과세에 기여하면서 여기서만 값을 잃어 두 화면이 모순되게 보인다. **억제는 화면의 일이다**(DOC-008 §5가 상환 완료 카드의 표시를 정한다).

**`annualCouponRate`가 널일 수 있는가 — 도달 불가지만 유니온에 남긴다.** `REALIZED_ONLY` 상품은 일정이 0건이라 **이 목록에 행 자체가 생기지 않고**(위 `integrityIssue` 각주와 같은 논리) `FULL`에는 I-18이 두 열을 보장한다. 그럼에도 `string | null`로 두는 이유는 그 보장이 **`entry_mode` 열에 걸린 CHECK**이지 「일정이 있으면 쿠폰율이 있다」가 아니기 때문이다 — 손으로 넣은 일정 행 하나가 그 조합을 만든다(§4.3의 `expectedGross`가 같은 자리에서 같은 이유로 널을 허용한다). `proceeds`가 이 필드와 **동시에** 비는 것이 계약의 보장이다.

**`from`·`to`·`ownerId`·`activeOnly`는 질의 조건으로 내린다**(Q-05). 네 값 모두 저장된 열의 조건이며, 특히 평가일 범위는 이 화면을 위해 만들어진 인덱스(`redemption_schedules_evaluation_date_idx`)가 처리한다. 본 계약은 행 단위가 **차수**여서 상품 수보다 훨씬 빠르게 늘어나므로, 범위 조건을 조회 후로 미루면 Q-06의 상한에 가장 먼저 닿는다.

> **질의의 루트는 `redemption_schedules`다 (v0.7, 구현 형태 확정).** 상품을 루트로 두고 일정을 임베드하면 `from`·`to`를 **임베드 필터**로 내려야 하는데, 그러면 적용 차수 판정(`nextEvaluation`)이 **잘린 일정 집합**에서 이루어진다. 적용 차수가 범위 밖일 때 범위 안의 아무 차수가 적용 차수로 승격되어 `conditionResult`가 **엉뚱한 차수에 붙는다** — 값이 비어 있지 않고 그럴싸하므로 화면에서 드러나지 않는다.
>
> 루트를 차수로 두면 날짜 조건이 루트 열 조건이 되어 위 인덱스를 그대로 쓰고, 임베드된 부모가 **자기 일정 전체**를 다시 담으므로 판정이 온전하다. `ownerId`는 부모 열 조건(`els_products.owner_id`), `activeOnly`는 중첩 to-one 조건(`els_products.redemptions=is.null`)으로 내린다 — 셋 다 실측으로 확인했고, `activeOnly`가 3행을 1행으로 실제로 좁힌다.

#### 달러 상품의 차수별 금액 — 「달러 기준 참고」 (v4.9 선행 명세 — P8 컷 a1, 구현 a2. DOC-001 결정 U8)

**`ScheduleProceeds`는 단일 통화이고 환율을 쓰지 않는다.** 네 금액(`expectedGross`·`expectedWithholding`·`expectedNet`·`expectedPnl`)이 전부 그 행의 `currency`이고, 달러 상품의 예상 원천징수는 **달러로** 계산한다.

```
expectedWithholding = separateTaxationWithholding({
  taxableIncome: max(0, expectedGross − principal),         // 상품 통화. TAX_FREE면 0
  constants,                                                // separate_taxation_rate — 조회한다 (절대 규칙 #5)
  rounding: { unit: MINOR_UNITS[currency].unit, mode: 'TRUNCATE' },   // KRW '1' · USD '0.01'
})
expectedNet = expectedGross − expectedWithholding           // 잔차 — 통화마다 성립한다
```

- **그래서 「세후 = 세전 − 원천징수」가 통화마다 성립한다.** 한 행 안에 원화 원천징수와 달러 세전이 섞이면 그 뺄셈이 정의되지 않는다. 원화로 바꾼 참고값을 싣는 대안은 `expectedNet`을 `null`로 비워야 하고 SCR-301이 환율마다 바뀐다.
- **근사다 — 표시가 그것을 말해야 한다.** 실제 원천징수는 지급일 환율로 원화 과세표준을 만든 뒤 소득세 14%와 지방소득세(소득세의 10%)를 각각 10원 미만 절사해 **원화로** 징수하고, 그 세액을 달러 수령액에서 환전해 뺀다(EM2048 투자설명서 원문 — DOC-007 §4.5). 이 참고값은 실제 달러 차감액과 **−1~+1.5센트** 안에서 갈리고(15.4% 단일 곱은 두 단계 10원 절사보다 원화로 **0~19원 크다** — DOC-007 §4.5 각주. 환전 환율 = 지급일 환율일 때), 환전 차감 환율은 미확인이라 그 밖으로 수 센트 더 어긋날 수 있다. 그래서 화면은 달러 ⑬ 값에 「≈」를 붙이고 그 머리글 · 모바일 라벨에 「달러 기준 참고」를 단다(「세후 예상 (달러 기준 참고)」) — 「≈」는 값이 근사라는 것을, 라벨은 그 근사가 환율 없이 달러로 곱한 데서 온다는 것을 말한다. 달러 카드가 하나라도 있는 목록의 세후 고지에는 「참고 — 달러 상품의 실제 세액은 지급일 환율로 원화 계산 후 달러에서 환전 차감되며 …」 한 문장이 더해진다(DOC-008 SCR-301). **확정 원천징수세액은 언제나 거래내역의 원화 값이다**(§5.4 — 이 값으로 채우지 않는다).
- **환율에 의존하지 않으므로 SCR-301은 환율 저장에 낡지 않는다.** `listSchedule`은 `EXCHANGE_RATE_WIDE`에 들지 않고(§5.13) 왕복도 3 그대로다(§4.0 「공통 타입」). 원화 과세는 SCR-202 ⑤(§4.3 `projection`)와 SCR-401(§4.6)이 말한다.
- **세율은 조회한다.** 「15.4%」를 코드에 적지 않고 `separateTaxationRate`를 이 행에 함께 싣는 v3.3의 규칙이 그대로다 — 달러 분기가 상수를 따로 갖지 않는다.
- **원화 상품은 한 글자도 바뀌지 않는다** — `MINOR_UNITS.KRW.unit = '1'`이 종전 `DEFAULT_ROUNDING`(`{ unit: '1', mode: 'TRUNCATE' }`)과 같으므로 절사와 문자열이 같다.

### 4.5 시세 — SCR-302

```ts
function listAssetPrices(): Promise<AssetPriceView[]>

type AssetPriceView = {
  assetId: string
  name: string
  market: string | null
  currency: string
  latestPrice: string | null
  asOfDate: string | null
  source: 'AUTO' | 'MANUAL' | null
  usedByActiveProducts: number         // 참조 중인 미상환 상품 수
  isStale: boolean                     // 아래 정의
  providerSymbols: Array<{ provider: string; symbol: string }>   // v3.6 — 아래 ★
}
```

> **★ `providerSymbols`를 신설한다 (v3.6, P5a 컷 2b). 조회를 «넓히지 않는다».**
>
> `assets`에 임베드로 함께 오므로 **왕복이 늘지 않는다** — §4.2 v3.1의 `terms`와 같은
> 근거이며 §4.0의 왕복 수 표가 움직이지 않는다(`tests/integration/contracts.test.ts`의
> 왕복 예산 `{assets: 1, els_products: 1}`이 그대로임을 실측했다).
>
> **자식에 `limit`을 걸지 않는다** — 자산당 매핑은 `UNIQUE(asset_id, provider)` 아래에서
> **공급자 수만큼**이고 그 수는 코드가 정한다. 즉 절단이 구조적으로 불가능하므로
> `asset_prices`처럼 부모별 `limit(1)`을 둘 이유가 없다.
>
> **★★ 빈 배열이 「미매핑」이며 그것은 실패가 아니다.** ADR-007이 수동 입력을 설계된
> 정상 경로로 못박았으므로 화면은 그 상태를 **`neutral` 등급**으로 말한다(「자동 수집 안 함」) —
> `attention`(사용자가 조치한다)도 `defect`(데이터를 고친다)도 아니다. 그리고 **표식이
> «있는» 것이 요점이다**: 없으면 「자동 수집되지 않는 것」과 「자동 수집되는데 값이 아직
> 없는 것」이 같게 보이고 사용자가 감시되고 있다고 오해한다 — DOC-008 SQ-08이 지목한
> ST-06의 형태이며, 그 항목이 「소멸」인 것은 **이 필드와 표식이 그 자리를 채웠기 때문**이다.
>
> **`id`를 담지 않는다** — 화면이 쓰는 좌표는 `(assetId, provider)`이고 §5.12가 그 좌표로
> UPSERT·DELETE 한다. `id`를 실으면 좌표가 둘이 된다.

**`isStale`의 정의 (v0.6에서 확정).** `asOfDate`가 기준일보다 **5일 이상** 앞서면 `true`.

| 경우 | 값 |
|---|---|
| 시세 행이 없음 (`latestPrice = null`) | `false` — 경과 판단의 대상이 아니다. 화면은 E-01("시세 없음")로 표시하며, 그 표시가 경과 여부보다 앞선다 |
| `asOf − asOfDate < 5일` | `false` |
| `asOf − asOfDate ≥ 5일` | `true` |

> **왜 하루가 아니고 5일인가.** 수집은 일 1회이고(ADR-006) 시장은 주말·휴장일에 닫힌다. 기준을 하루로 두면 **금요일 종가가 토요일부터 경과로 표시**되어 정상값이 매주 경고가 되고 신호가 죽는다. 월요일 기준으로 금요일 종가는 3일 경과이므로 3일도 같은 이유로 부족하다. 주말 2일에 연휴 여유를 더해 5일로 둔다 — 금요일 종가가 다음 주 수요일까지 정상으로 표시된다.
>
> 이 값은 법령 상수가 아니라 **표시 임계값**이므로 `tax_constants`가 아니라 구현 모듈의 상수로 둔다. DOC-007 §3.4의 KI 주의 배수(`× 1.1`)와 같은 부류다. 영업일 기준으로 세밀화하는 것은 DOC-007 RD-03(평가일 영업일 조정)이 결정된 뒤에 함께 다룬다.

### 4.6 세금 — SCR-401

```ts
function getTaxSummary(params: {
  ownerId: string
  year: number
  override?: {                          // 시뮬레이션용. 저장하지 않음
    otherIncomeBase?: string            // /^\d+$/ — 아래 「각 축의 형식과 범위」
    otherFinancialIncome?: string       // /^\d+$/ — 같음
    healthInsuranceType?: HealthInsuranceType
  }
}): Promise<TaxSummaryView>

type TaxSummaryView = {
  year: number
  taxLawYear: number                    // 적용된 세율·상수의 연도. year와 다르면 근사다
  seededYears: number[]                 // v1.9 신설 — 시드된 세율 연도 전체(오름차순)
  profile: {
    otherIncomeBase: string
    otherFinancialIncome: string
    healthInsuranceType: HealthInsuranceType
    isSaved: boolean                    // false = override 적용 중
  }
  income: {
    elsTaxableIncome: string
    /** v4.16 (P8 컷 b1 명세 · 구현 b4) — elsTaxableIncome의 확정/추정 분할. 둘의 합이 elsTaxableIncome이다 */
    confirmedElsTaxableIncome: string   // 확정 사건(상환 기록 · PAID 기록)의 과세 합. 환율과 무관하다
    estimatedElsTaxableIncome: string   // 추정 사건 중 F에 들어간 것(원화 · 환산된 달러 · 비과세 0)의 합
    otherFinancialIncome: string
    total: string                       // F
    isComprehensive: boolean            // F > 종합과세 기준금액
    thresholdGap: string                // 초과분 또는 여유분
    exchangeRateBasis: ExchangeRateBasisView | null  // v4.9 (P8 컷 a3) — 달러 추정을 환산한 추정 환율
    convertedCount: number              // v4.9 (P8 컷 a3) — 추정 환율로 환산해 F에 넣은 사건이 있는 상품 수 (v4.16 — 종전 「건 수」)
    unconvertedCount: number            // v4.9 (P8 컷 a2) — 환율이 없어 F에서 빠진 추정 사건이 있는 상품 수 (E-09 · v4.16 — 종전 「건 수」)
  }
  tax: {
    method1: string | null              // 분리 기준 (DOC-007 §5.2). null = 비교과세 미적용
    method2: string | null              // 종합 기준. null = 비교과세 미적용
    computedTax: string                 // max(①,②) − T(A), 또는 분리과세 종결액
    localTax: string
    totalTax: string
    withheld: string
    additionalPayment: string
    effectiveRate: string
  }
  healthInsurance: {
    assessmentBase: string
    healthPremium: string
    longTermCarePremium: string
    total: string
    isEstimate: true                    // 항상 추정 (A-06)
  }
  marginalRates: Array<{
    bracketLabel: string
    incomeTaxRate: string
    realMarginalRate: string
  }>
  contributingProducts: Array<{        // v4.16 — 상품당 한 행. 그 상품의 그 해 사건을 접는다 (아래 「월지급 상품의 기여」)
    productId: string
    productName: string
    currency: ProductCurrency           // v4.9 (P8 컷 a2) — 그 상품의 통화. taxableIncome은 늘 원화다
    taxableIncome: string | null        // v4.9 — 원화. null = 환율이 없어 뺐다 (아래 「건 단위 E-09」). v4.16 — 사건이 «전부» 빠졌을 때만 null
    isEstimated: boolean                // v4.16 — 유지한다. = basis !== 'CONFIRMED'
    basis: ContributionBasis            // v4.16 (P8 컷 b1 명세 · 구현 b4) — 확정 · 추정 · 둘 다
    /** v4.16 (구현 b4) — 사건 종류별 내역. 그 해에 그 종류의 사건이 없으면 null */
    breakdown: {
      redemption: { taxableIncome: string | null; isEstimated: boolean } | null
      coupons: {
        confirmedCount: number          // PAID 기록 수
        confirmedTaxableIncome: string  // 원화 — 기록값(couponTaxableIncome). 환율과 무관하다
        estimatedCount: number          // 추정 월수익 사건 수
        estimatedTaxableIncome: string | null   // 원화. null = 달러 추정인데 추정 환율이 없다 (E-09)
      } | null
    }
    exchangeRateMissing: boolean        // v4.9 (P8 컷 a2) — 이 상품의 추정분이 E-09로 빠졌다. v4.16 — 추정 달러 사건이 «하나라도» 빠졌으면 참
    integrityIssue: 'UNDERLYING_MISSING' | 'SCHEDULE_MISSING' | 'COUPON_SCHEDULE_MISSING' | null  // 셋째는 v4.16 (§4.2 D1)
  }>
}
```

**`contributingProducts[].integrityIssue` (v0.8 신설).** 결함 상품도 과세 기여를 낸다 — §4.2의 입력 기준대로, 예상 수령액은 계약 조건에서만 나오고 결함이 파괴한 입력(기초자산·시세)을 쓰지 않으므로 **그 금액은 유효하다.** 표식은 금액을 바꾸지 않는다.

> **표식이 없으면 두 화면이 모순으로 읽힌다.** SCR-202에서는 `integrityIssue`로 "수정 필요"가 표시되는 같은 상품이 SCR-401에는 아무 표식 없이 숫자로만 나타난다. 사용자는 그것을 데이터 오류로 읽는다.
>
> **`isEstimated`와 다른 필드로 둔다.** `isEstimated`는 "증권사 확정값이 아니라 시스템 추정"을 뜻하고 미상환 상품이면 전부 `true`다. 결함 여부는 그것과 **직교**하며, 결함 상품의 확정 상환도 존재한다(아래 표). *(v4.16 — 「미상환 상품이면 전부 `true`」는 상환 시 지급 상품에서만 참이다. 확정 월수익만 있는 해의 미상환 월지급 상품은 `basis = 'CONFIRMED'`이고 `isEstimated = false`다 — `isEstimated`는 이제 `basis !== 'CONFIRMED'`의 파생이다. 아래 「월지급 상품의 기여」)*
>
> **§4.4처럼 한 값으로 좁히지 않는다 — `SCHEDULE_MISSING`도 도달한다.** "일정 0건이면 적용 차수가 없어 기여하지 않는다"는 **추정 분기에서만** 참이다. 상환 완료 분기가 일정 검사보다 **먼저** 반환하고, I-13 FK(`redemptions(els_id, round_no)` → `redemption_schedules`)는 `MATCH SIMPLE`이라 **`round_no IS NULL`인 만기 상환은 검사하지 않는다**(DOC-002 §4.9가 의도한 상태이며 마이그레이션 주석이 명시한다). 즉 만기 상환 상품은 일정 행이 전부 지워져도 `ON DELETE RESTRICT`에 걸리지 않고, 증권사 확정값으로 기여하면서 `SCHEDULE_MISSING`이다.
>
> §4.4의 좁힘은 **구조적 도달 불가**(행 단위가 차수라 일정 0건 상품은 행 자체가 생기지 않는다)에서 나왔고, §4.6은 행 단위가 상품이라 그 논거가 옮겨가지 않는다. 좁히면 §4.4가 피하려던 오류의 **정반대 방향** — 관측되는 값을 타입이 부정하는 상태 — 가 된다.

| | `UNDERLYING_MISSING` | `SCHEDULE_MISSING` |
|---|---|---|
| `isEstimated = true` (추정) | 도달 | **불가** — 적용 차수가 없다 |
| `isEstimated = false` (확정) | 도달 | **도달** — 만기 상환 + 일정 0건 |

> *(v4.16)* **셋째 결함 `COUPON_SCHEDULE_MISSING`은 두 행 모두 도달한다** — 파괴한 입력이 월수익뿐이라 상환 사건(추정 · 확정)은 산다(§4.2 D1). 그 행의 `breakdown.coupons`는 `null`이다(월수익 사건이 억제된다). 위 표의 `SCHEDULE_MISSING` 열 「불가」는 **상환** 사건의 진술이다 — 일정 0건이라도 `NO_ROUND`인 월지급 상품의 추정 **월수익** 사건은 흐름 끝이 무한이라 남는다(§4.3 `remainingCoupons`).

**본 계약은 본인 전용이다.** `ownerId ≠ 조회자`이면 예외를 던진다(§3.1의 시스템 오류, 즉 호출부의 프로그래밍 오류다).

> **RLS가 이 범위를 이미 정했다.** `tax_profiles`의 조회 정책은 본인 한정이며(DOC-010 §7), 이는 금융소득 외 종합소득이 ELS와 무관한 개인 소득 정보라는 판단에서 나왔다. 그런데 `F`의 산출에는 `other_financial_income`이 필요하므로, 타인의 `ownerId`로 호출하면 그 값을 **`0`으로 읽고 계산을 끝낸다** — 오류 없이, 실제보다 낮은 금융소득과 틀린 종합과세 판정을 반환한다. 조용히 틀리는 것을 막으려면 범위를 계약에 명시하는 수밖에 없다. `ownerId`를 인자로 남기는 것은 호출부의 의도를 드러내 이 단언이 걸리게 하기 위함이다.

**`seededYears`가 없으면 연도 선택기를 만들 수 없다 (v1.9 신설, P4 컷 8).** DOC-008 §5는 「① 연도 선택」을 이 화면의 첫 요소로 규정하는데, **시드보다 과거인 연도는 본 계약이 예외를 던진다**(아래 표). 즉 화면이 고를 수 있는 연도의 하한은 세율 시드에만 있는 지식이며, 화면이 그것을 추측하면(예: 「올해 − 5년」) 그중 일부가 **오류 화면으로 가는 선택지**가 된다 — 사용자가 고를 수 있게 제시된 항목이 앱을 멈추는 형태다.

> **`taxLawYear`로는 유도할 수 없다.** 그 값은 요청 연도가 시드에 있으면 그 연도, 없으면 **최신** 시드 연도다 — 어느 경우에도 **하한**을 말하지 않는다. 근사 여부(`year ≠ taxLawYear`)와 선택 가능 범위는 다른 질문이다.
>
> **상한은 계약이 정하지 않는다.** 시드보다 미래인 연도는 근사로 허용되므로(아래 표) 상한은 화면의 판단이다. SCR-401은 `max(현재 연도, 마지막 시드 연도)`까지만 제시한다 — 그 이후 연도의 추정은 SCR-402(다년도 전망)의 일이고, 두 화면이 같은 것을 다르게 보여 주면 어느 쪽이 정본인지 알 수 없다.
>
> 이 필드는 **계약이 이미 읽은 값이다** — `loadTaxYearContext`가 `tax_years` 전체를 한 왕복으로 읽어 근사·거부를 판정하므로 왕복이 늘지 않는다(§4.0의 예산 불변).

**세율 연도의 취급.** 세율·상수는 연도별 데이터이며(ADR-005) 시드된 연도만 존재한다.

| 대상 연도 | 동작 |
|---|---|
| 시드가 있는 연도 | 그 연도의 값을 쓴다. `taxLawYear = year` |
| 시드보다 미래 | **최신 시드 연도로 근사**하고 `taxLawYear`에 그 연도를 담는다. 화면은 근사임을 표시한다 |
| 시드보다 과거 | **예외.** 뒤 연도의 법으로 과거를 계산하면 ADR-005가 보장하려는 재현성(K-08의 전제)이 깨진다. 없는 값을 근사하는 것보다 없다고 말하는 것이 맞다 |

> **이 규칙이 없으면 홈 화면이 날짜만으로 죽는다.** §4.1 `currentYearTax`도 당해 연도의 구간·상수를 요구하므로, 2027년 1월 1일이 되면 코드 변경 없이 SCR-101이 예외로 멈춘다. 연도 선택기가 있는 SCR-401에서는 과거 연도 선택이 같은 경로를 탄다.

**`marginalRates[].bracketLabel`의 합성 규칙.** `tax_brackets`에는 하한만 있고 표시 문자열의 원천이 없으므로 계약 계층이 합성한다 — 해당 구간의 하한과 **다음 구간의 하한**으로 `"1,400만~5,000만"` 형태를, 최상단 구간은 `"10억 초과"` 형태를 만든다. 만 단위 한글 표기를 쓰고, 1억 이상은 억 단위로 적는다(`"1억 5,000만"`, `"3억"`, `"10억"`).

> **최하단 구간(하한 0)은 `"1,400만 이하"` 형태다 (v0.7에서 추가).** v0.6은 중간 구간과 최상단만 정했고, 하한이 0인 첫 구간에 규칙을 적용하면 `"0~1,400만"`이 되어 표기가 어색하다. 구현 단계에서 발견해 문서에 먼저 등재했다 — 정의가 없는 필드를 구현이 임의로 정하지 않는다(U-01).

**`profile`의 폴백.** 해당 연도의 `tax_profiles` 행이 없으면 `otherIncomeBase = '0'`, `otherFinancialIncome = '0'`, `healthInsuranceType = 'NONE'`을 쓰고 `isSaved = false`로 표시한다. 따라서 `isSaved = false`는 **"저장된 프로필이 없거나 `override` 적용 중"**을 뜻한다(v0.5까지는 후자만 서술했다). `'NONE'`은 건강보험료를 `0`으로 만들므로, 화면은 이 상태를 계산 결과가 아니라 **미입력**으로 표시해야 한다 — DB의 `health_insurance_type`은 `NOT NULL`이고 기본값이 없어 폴백 값을 계약이 정할 수밖에 없다.

> `override`는 시뮬레이션 전용이며 `tax_profiles`에 저장되지 않는다. 저장은 `saveTaxProfile`(5.6)로 별도 수행한다. 이 분리로 "값을 조정해봤을 뿐인데 저장되는" 문제를 방지한다. **프로필 행이 없는 연도에 `override`로 조회해도 행이 생기지 않는다.**

> **`isSaved = false`의 두 원인을 화면이 가른다 (v1.9 확인, P4 컷 8).** 위 정의대로 이 값은 「저장된 프로필이 없다」와 「`override` 적용 중」을 **한 거짓으로 접는다.** 두 상태의 표시가 정반대이므로(앞은 「미입력」 경고, 뒤는 「시뮬레이션 중 — 저장되지 않았다」) 가르는 수단이 필요한데, **그것을 계약에 추가하지 않는다** — 두 번째 boolean(`hasStoredProfile`)을 두는 것보다 **화면이 이미 아는 사실**을 쓰는 편이 정확하다: `override`를 넘긴 것은 화면 자신이다(SCR-401에서는 URL 질의에 그 값이 있다). 계약이 모르는 것을 계약에 묻지 않는다.
>
> 남는 것 하나는 **`override` 적용 중에 저장된 프로필이 있는지 알 수 없다**는 것이며, 무해하다 — 그 상태에서 화면이 제시하는 다음 행동은 「지금 값으로 저장」 하나이고 §5.6이 UPSERT이므로 행의 존재 여부가 결과를 바꾸지 않는다.

#### `override` 각 축의 형식과 범위 (v2.2 신설, P4.5)

v2.0까지 본 계약은 `override`의 **타입만** 적었고 값의 형식·범위를 정하지 않았다. §6의 V 규칙은 **변경 계약의 입력**만 다루므로 조회 계약의 이 필드에는 규정이 없었고, 그 공백에서 화면이 서로 다른 두 규약을 만들었다 — 열거 축은 제시 집합으로 좁혀 인식 실패를 **버리는데** 금액 두 축은 쉼표·공백만 지워 **그대로 넘겼다.**

| 축 | 받는 형식 | 인식 실패의 처리 |
|---|---|---|
| `otherIncomeBase` · `otherFinancialIncome` | **`/^\d+$/`** — 0 이상의 정수. 부호·소수점·지수 표기·16진 접두사를 받지 않는다. 쉼표·공백은 호출부가 지운 뒤 이 검사를 지난다 | **그 축을 조정하지 않은 것으로 버린다.** 오류로 만들지 않는다 |
| `healthInsuranceType` | `HealthInsuranceType` 열거값 | 같음 (이미 그렇게 구현되어 있었다) |

**형식을 `/^\d+$/`로 정한 근거는 저장 축과의 일치다.** §5.6 `saveTaxProfile`의 **구현**이 두 금액에 `requireAmount(min: 'zero', integer: true)`를 걸고 그 조합의 패턴이 정확히 이것이다. **§6의 V-19를 근거로 인용하지 않는다** — 그 규칙은 「문자열 필드 — 열 선언 길이 이내」이고 이 형식과 다르다. 저장 축의 위반이 `V-19`로 **기록되는** 것은 §6 각주의 ID 재사용 규약 때문이며 그 규약 자체가 「이 검사에 대응하는 §6 규칙이 없다」는 뜻이다. 따라서 두 축이 같은 값을 쓰는 근거는 §6이 아니라 **구현의 대칭**이고, 조정 축 형식의 정본은 이 절이다. 조정 축이 더 넓으면 **화면이 저장할 수 없는 숫자를 정상 결과로 렌더한다** — 사용자는 `-5000000`이나 `1.5`로 계산된 세액을 보고 「지금 값으로 저장」을 눌렀다가 거부당하며, 그 거부의 원인이 방금 본 정상 화면에 없다. 두 축을 같은 패턴으로 두면 조정 화면에 나타나는 모든 값이 저장 가능하다.

**인식 실패를 버리는 근거는 이 계약이 조회라는 것이다.** 변경 계약은 `ActionResult`로 필드별 오류를 돌려줄 수 있지만 조회 계약에는 그 통로가 없다 — v2.1까지의 구현은 그 값이 `dec()`에 닿아 **오류 화면**이 됐다(`new Decimal('abc')`가 `Error`를 던지며, 실측상 `RangeError`조차 아니어서 §3.2.2의 분류를 지나지도 않는다). 주소는 사용자가 손으로 고칠 수 있고 링크로 공유될 수 있으므로 **한 글자가 화면을 죽이는 형태**이며, 같은 파일이 다른 축에 대해 이미 「인식하지 못한 값은 버린다 — 오류로 만들지 않는다」를 규약으로 선언해 두었다.

**버림이 조용하지 않다.** 버린 축은 `override`에 실리지 않으므로 저장값(또는 폴백)이 그 자리에 쓰이고, 화면의 입력란에는 그 값이 다시 렌더된다 — 사용자가 적은 글자가 사라지는 것이 신호다. 세 축이 전부 버려지면 `override`가 `null`이 되어 화면이 「시뮬레이션 중」을 표시하지 않는다. 즉 **조정하지 않은 상태와 같아진다**는 것이 정의된 결과다.

> **실측 두 건을 근거로 남긴다 (P4.5).** ① `new Decimal('0x1f')` → **31**이다. 16진 접두사를 받으므로 `?otherFinancialIncome=0x1f`가 오류 없이 31원으로 계산된다 — 형식 검사가 없으면 **틀린 값이 조용히 정상 결과가 되는** 경로가 실재한다. ② `new Decimal('1e999')` → `1e+999`이고 `isFinite()`가 참이므로 `dec()`의 검사를 통과한다. 두 경우 모두 「비숫자는 오류 화면」보다 나쁘다(오류는 보이고 이것들은 보이지 않는다). `/^\d+$/`가 셋을 함께 닫는다.

> **`method1`·`method2`가 nullable인 이유.** `F ≤ 종합과세 기준금액`이면 분리과세로 종결되어 비교과세를 적용하지 않는다(DOC-007 §5.2). 이 구간에서 두 방식의 산식을 그대로 계산한 값을 내려보내면 화면이 무의미한 비교를 렌더링하고, 심지어 `max(①,②) − T(A)`가 실제 세액과 어긋난다(§5.2 참조). 따라서 미적용을 `null`로 표현하고 `isComprehensive = false`와 함께 해석한다.

#### 달러 상품의 기여 — 건 단위 E-09 (v4.9 선행 명세 — P8 컷 a1, 구현 a2·a3)

**F는 언제나 원화다.** `income.elsTaxableIncome`은 원화 과세 금융소득의 합이고 달러 상품의 기여는 두 경로로 들어온다.

| 기여 | 값 | 환율 |
|---|---|---|
| 상환 완료 (확정) | 거래내역의 원화 `taxable_income`(A-04 · U1) | 쓰지 않는다 — **환율이 없어도 늘 들어간다** |
| 미상환 (추정) | `max(0, 예상 수령액 − 투자원금)_USD × x`(DOC-007 §4.8). 비과세 계좌는 0 | 추정 환율 `x`. 없으면 **그 건만** 뺀다(E-09) |
| 미상환 (추정) · 달러 이익 ≤ 0 | 0 | 쓰지 않는다 — **환율 없이 0**(DOC-007 §4.8 — `x`보다 먼저 본다). E-09가 아니며 어느 건수에도 세지 않는다. 월지급식(컷 b1)의 상환 추정이 이 줄이다 |
| 월수익 `PAID` 기록 (확정) *(v4.16)* | 거래내역의 원화 `taxable_income`을 `couponTaxableIncome()`으로(비과세 계좌 0 — 상환의 `taxableIncome()`과 같은 규칙) | 쓰지 않는다 — **환율이 없어도 늘 들어간다**(A-04 · U1). 귀속 = `year(기록.payment_date)` |
| 월수익 추정 (무기록 · 흐름 끝 안) *(v4.16)* | 원화 일반계좌 `q_k` · 달러 일반계좌 `q_k × x` · 비과세 계좌 0 (DOC-007 §4.7·§4.8) | 달러 일반계좌만 추정 환율 `x` — 원금이 없으므로 `max(0, …)`가 없고 **늘** 환율이 필요하다. 없으면 **그 사건만** 뺀다(E-09). 귀속 = `year(일정.payment_date)` — 평가일이 아니다(SB-5) |
| 월수익 `UNPAID` 기록 *(v4.16)* | — | **사건이 아니다** — F에도 건수에도 들지 않는다 |

- **E-09는 건 단위다 — 상품 단위가 아니다**(DOC-007 E-09). 빠지는 것은 추정이 필요한 달러 건뿐이고 `income.unconvertedCount`가 그 수다. 상품 단위로 빼면 확정된 원화 과세까지 F에서 사라진다 — 월지급식이 들어오면 한 상품에 확정 월수익과 추정 상환이 함께 있다(컷 b1). *(v4.16 — 「건」은 소득 사건이다. **빼는 단위는 사건이고 세는 단위는 상품이다** — `unconvertedCount`는 빠진 사건이 하나라도 있는 상품 수다. §4.0 「쿠폰 지급방식과 월수익」 규칙 4)*
- **빠진 상품도 기여 행에 남는다.** 한 상품 한 행(`productId`가 화면의 키다)이고 `taxableIncome = null` · `exchangeRateMissing = true`다 — 행을 지우면 「그 상품은 올해 과세되지 않는다」로 읽힌다. **컷 a1의 범위(상환 시 일괄)에서는 한 상품의 기여가 한 건이므로 `exchangeRateMissing ⇔ taxableIncome = null`이다.** 월지급식이 들어오면 확정 월수익이 있는 채로 추정분만 빠질 수 있어 이 동치가 깨진다 — 그때의 확정·추정 분할은 ~~**컷 b1의 명세**다~~ → 아래 「월지급 상품의 기여」 *(v4.16)*.
- **비과세 계좌의 달러 추정은 환율 없이 0이다**(DOC-007 검산 A-2) — E-09가 아니며 세지 않는다.
- **`income.exchangeRateBasis`는 환산이 한 건이라도 일어났을 때의 추정 환율이다.** 기여 행마다 두지 않는다 — 추정 환율은 요청당 통화별 하나이므로(§4.0 규칙 2) 행마다 같은 값이 된다.
- **`income.convertedCount`는 환산해 F에 넣은 달러 추정 ~~건 수~~ 사건이 있는 상품 수다 (컷 a3 · 단위는 v4.16)** — 일반계좌 · 달러 이익 > 0 · 추정 환율 있음. DOC-008 SCR-401 환율 기준 줄 「달러 상품 n건의 추정을 … 환산했다」의 n이 이 값이고, `exchangeRateBasis ≠ null ⇔ convertedCount > 0`이다. 비과세 계좌와 달러 이익 ≤ 0인 건은 환율 없이 0이라 `convertedCount`에도 `unconvertedCount`에도 들지 않는다. 추정 환율이 요청당 통화별 하나이므로 지원 외화가 `USD` 하나인 동안 **둘 중 하나는 늘 0이다.**
- **`total`·`isComprehensive`·`tax`는 뺀 뒤의 F로 계산한다.** 빠진 몫만큼 종합과세 판정이 낮은 쪽으로 틀릴 수 있으므로 화면은 `unconvertedCount > 0`이면 판정 옆에 그 사실을 말한다(DOC-008 ST-07). 기본 환율로 채워 판정을 «완성»하지 않는다 — 그 판정은 그럴싸한 숫자다.
- **§4.1 `currentYearTax` · §4.7의 첫 행 · §4.8의 본인 행과 같은 사건 집합, 같은 추정 환율이다.** 그래서 `getTaxSummary(Y₀).income.total` = `getForecast()`의 `Y₀` 행 `financialIncome` = 본인 `UserSummary.currentYearFinancialIncome`의 항등이 환율 유무와 무관하게 유지된다. `listUserSummaries`는 `contributionOf`의 **둘째 소비자**이므로 서명 변경이 두 곳에 함께 닿아야 하고, 컷 a3의 통합 스위트가 달러 픽스처로 그 항등을 단언한다.

> **코드가 한 컷 앞섰다 (P8 컷 b0, `d675efb` — v4.16에서 기록).** 소득 사건 모델이 이 문서보다 먼저 코드에 섰다 — `src/lib/db/queries/income.ts`의 `incomeEventsOf(row, asOf, rates, only?)`가 상품 → 사건의 단일 원천이고, `contributionOf`(§4.6 · §4.1 · §4.8)는 그 해의 사건을 **접는** 함수가 되었다. 사건이 상품당 최대 하나(상환)인 것을 **별칭 없는 튜플**(`readonly []` 또는 원소 하나)로 단언하므로, 월수익 사건이 들어와 반환형이 넓어지는 컷(b4)에서 `contributionOf`의 대입이 **컴파일 오류**가 된다 — 사건 여럿을 접는 규칙(아래 「월지급 상품의 기여」)을 정하지 않은 채 첫 사건만 읽는 구현이 조용히 서지 않는다. `only.year`는 **값을 계산하기 전에** 연도로 거른다(다른 해에 귀속되는 사건의 산식이 그 해의 조회를 죽이지 않게 — DOC-010 AQ-92). **동작 불변**이다(HEAD 대 작업 트리 차분 0 — 기존 고정값 전부 그대로). ⚠ **b0의 조기 반환 셋은 상품 단위다** *(b1 개정 — 반박 검토 반영)* — 적용 차수 없음(`NO_ROUND`) · 다른 해(`only.year` ≠ 상환 사건의 귀속연도) · 계약 조건 없음이면 그 상품의 사건 전부가 `[]`다. 사건이 상환 하나뿐인 동안은 같은 말이지만 월지급식에서는 틀린다 — `NO_ROUND` 월지급 상품은 흐름 끝이 무한이라 일정 전부가 추정 사건이고, 상환이 2027년에 귀속되는 상품의 2026년 월수익도 있다(DOC-007 검산 B-1). 그래서 **b4가 조기 반환을 상환 사건에만 적용되도록 내리고 연도 거름을 사건마다로 바꾼다**(상환 = 귀속연도 · 월수익 = 지급일의 연도 — DOC-007 §7.6의 b0/b4 대조표). 검산 B-1을 `contributionOf(only.year = 2026 · 2027)` 경로로도 단언하고 「연도마다 Σ `contributionOf` = Σ `forecastItemsOf`」에 월지급 표본(`NO_ROUND` 포함)을 넣는다(b4 테스트 목록) — 매퍼 경유(`only` 없음)만으로는 이 거름을 지나지 않는다.

#### 월지급 상품의 기여 — 상품당 한 행 · 확정/추정 분할 (v4.16 선행 명세 — P8 컷 b1, 구현 b4)

**행은 여전히 상품당 하나다** — `productId`가 화면의 키이고(DOC-008 SCR-401) 한 행이 그 상품의 **그 해 사건 전부**를 접는다. 사건마다 행을 두면 같은 상품이 한 표에 여러 번 나오고, 상품 단위인 `integrityIssue`·`exchangeRateMissing`이 행마다 반복된다.

| 필드 | 정의 |
|---|---|
| `basis` | 그 해 그 상품의 사건이 **전부 확정**(상환 기록 · `PAID` 기록)이면 `CONFIRMED`, **전부 추정**이면 `ESTIMATED`, 둘 다 있으면 `MIXED`다. 확정/추정의 기준은 기록 유무다(A-04) — `is_confirmed`는 별도의 표시 축이다(ST-05) |
| `isEstimated` | **유지한다** — `basis !== 'CONFIRMED'`와 같다. 상환 시 지급 상품에서는 종전 값과 같다(사건이 하나다) |
| `breakdown.redemption` | 그 해에 상환 사건이 있으면 `{ taxableIncome, isEstimated }`, 없으면 `null`. `taxableIncome = null`은 그 상환 추정이 E-09로 빠졌다는 뜻이다 |
| `breakdown.coupons` | 그 해에 월수익 사건이 하나라도 있으면 객체, 없으면 `null`(상환 시 지급 상품은 늘 `null`). `confirmedCount`·`confirmedTaxableIncome`은 `PAID` 기록 — 환율과 무관해 `null`이 없다. `estimatedCount`·`estimatedTaxableIncome`은 추정 사건 — 달러 일반계좌인데 추정 환율이 없으면 `estimatedTaxableIncome = null`이다(환율은 요청당 통화별 하나라 한 상품의 추정 달러 월수익은 함께 들어가거나 함께 빠진다). `UNPAID`는 어느 수에도 들지 않는다 |
| `taxableIncome` | **들어간 사건**(확정 + 환산된 추정 + 원화 추정 + 비과세 0)의 합이다. **`null`은 그 상품의 그 해 사건이 전부 빠졌을 때만이다** — 확정 월수익이 있는 채로 추정분만 빠지면 확정분의 합이 남는다(`MIXED`) |
| `exchangeRateMissing` | 그 해 그 상품의 **추정 달러 사건이 하나라도** 빠졌으면 참이다. 그래서 a2의 동치 `exchangeRateMissing ⇔ taxableIncome = null`이 월지급식에서 **깨진다** — 위 둘째 항목이 예고한 대로다. 화면은 `taxableIncome`이 있어도 이 표식이 서면 「일부 빠짐」을 말한다(DOC-008 SCR-401 · ST-07) |
| `income.confirmedElsTaxableIncome` · `estimatedElsTaxableIncome` | `elsTaxableIncome`의 확정/추정 분할 — 모든 기여 행의 확정 사건 과세 합과 들어간 추정 사건 과세 합. **둘의 합이 `elsTaxableIncome`이다**(빠진 사건은 어느 쪽에도 없다). SCR-401의 분할 표시가 이 둘이다 |

- **귀속은 사건마다다** — 상환은 종전 그대로(상환일 · 추정은 적용 차수 평가일의 연도), 기록된 `PAID` 월수익은 `year(payment_date)`, 추정 월수익은 `year(일정.payment_date)`다(DOC-007 §7.2 — 평가일이 아니다. 검산 B-4: 평가 2026-12-29 · 지급 2027-01-04 → **2027 귀속**). 그래서 한 상품이 여러 해의 기여 행에 나타난다. 상환 추정(평가일 연도 — RD-02)과 월수익 추정(지급일 연도)이 같은 날 평가되어 해를 가를 수 있다 — DOC-007 RD-17(연말 경계)이 미결로 들고 있고 화면 문구는 두지 않는다.
- **흐름 끝 밖의 달은 어느 행에도 없다** — 「예정 · 조기상환 가정 밖」(민서 결정(2026-10-02) ③)은 추정에서 빠지고, 「상환 후 없음」은 사건이 없다(§4.0 「구획」).
- **세는 단위는 상품이다** — `income.unconvertedCount` = 그 해 추정 달러 사건 중 빠진 것이 하나라도 있는 상품 수 = `exchangeRateMissing = true`인 행 수, `income.convertedCount` = 그 해 환산한 사건이 하나라도 있는 상품 수다(§4.0 규칙 4).
- **검산 B-1** (원화 · 일반계좌 — §4.3 「월지급 상품」): `getTaxSummary(2026)`의 그 행은 `basis = 'ESTIMATED'` · `breakdown.redemption = null` · `breakdown.coupons = { confirmedCount: 0, confirmedTaxableIncome: '0', estimatedCount: 5, estimatedTaxableIncome: '3000000' }` · `taxableIncome = '3000000'`이고, 2027은 상환 사건(과세 `'0'` — r = 0)과 6번째 달(`'600000'`)이 한 행에 접힌다. **검산 C** (달러 · P $10,000 · 월수익 연쿠폰율 0.2424 · 추정 환율 1,385.20): 한 달의 추정 과세는 `q_k` $202.00 × 1,385.20 = **279,810.4**원이고 F 안에서 반올림하지 않는다(화면 279,810 — Q-07 ⓑ는 출력에서 접는다).
- **`tax.withheld`는 바꾸지 않는다** — 기록의 원천징수 합과 F의 원천징수가 원 단위로 갈리는 것(검산 B-6 — 건별 절사 12건 1,077,996원 대 연간 1,077,999원, 3원)은 기대값이고 DOC-007 RD-10 · RD-01이 함께 닫는다.

### 4.7 다년도 전망 — SCR-402

> **선행 조건 둘이 닫혔다 (v2.4, P4b) — 산식은 DOC-007 §7.5, 적용 차수는 §11 RD-02.**
>
> v0.6~v2.3은 `totalAssets`·`remainingPrincipal`이 **어느 문서에도 정의가 없다**는 이유로 이 계약을 미구현으로 두었다. 두 값이 「그 연도 말에 아직 상환되지 않은 상품」의 집합에 의존하고 그 집합이 **적용 차수**로 결정되므로(DOC-007 §7.2), RD-02가 열려 있는 동안 산식을 확정하면 그것이 닫힐 때 두 값과 그 위의 누적을 다시 손대게 된다는 판단이었다. **둘 다 닫혔으므로 이 절이 계약을 확정한다.**
>
> **`totalAssets` → `cumulativeAssets`로 개명했다.** 산식은 옳고 **이름이 틀렸다** — `Y₀` 이전에 상환된 상품은 두 항 어디에도 없으므로(§7.5의 분할 표 둘째 줄) 이 값은 「보유 자산의 총액」이 아니라 **전망 구간 안의 누적**이다. 「총자산」은 어느 문서에도 정의가 없는 말이고 SCR-101 ②의 「총 자산 요약」(= `activePrincipal` + `realizedPnl`)과 **전혀 다른 값**이므로, 같은 이름을 쓰면 두 화면이 같은 말로 다른 것을 가리킨다. DOC-001 S-08이 실제로 쓰는 표현이 「**누적** 자산 추이」다(DOC-005 §4·§8.8에 등재).
>
> **`healthInsurance` → `totalInsurance`로 개명했다.** DOC-005 §5에서 「건강보험료」는 **장기요양보험료를 포함하지 않는다.** 이 필드는 표의 한 칸이므로 둘의 합이며, 그 이름으로 부르면 용어가 두 가지를 가리킨다(절대 규칙 #9). §4.6은 객체이므로 `healthInsurance.total`로 담을 수 있고 여기는 그럴 자리가 없다. **미구현이었던 동안에만 개명이 자유롭다** — `cumulativeAssets`와 같은 이유로 지금 고친다.

```ts
function getForecast(params: {
  ownerId: string                       // 본인 전용 — 조회자와 다르면 예외
  years?: number                        // 기본 6 (AQ-08 확정). 1 이상 FORECAST_MAX_YEARS 이하
}): Promise<ForecastRow[]>              // 항상 years개. 비어 있지 않다

type ForecastRow = {
  year: number
  taxLawYear: number                    // 적용된 세율·상수의 연도. year와 다르면 근사다
  profileYear: number | null            // 적용한 과세 프로필의 연도. null이면 미입력
  grossProceeds: string
  financialIncome: string
  thresholdGap: string                  // 종합과세 기준금액 대비. 양수면 초과
  isComprehensive: boolean
  effectiveRate: string
  additionalTax: string
  totalInsurance: string                // 건강보험료 + 장기요양보험료 (DOC-005 §5)
  netProceeds: string
  cumulativeNet: string
  remainingPrincipal: string
  cumulativeAssets: string              // 건보료 차감 전 — DOC-007 §7.5
  hasEstimates: boolean                 // 이 행의 값이 적용 차수 가정에 의존한다 · v4.9 — 또는 원화 환산을 포함한다
  /** v4.9 (P8 컷 a3) — 이 행의 원화 환산에 쓴 추정 환율. 표 밖 표식 다섯째 — 넷째는 a2의 `excludedForeignCount` (DOC-008 SCR-402) */
  exchangeRateBasis: ExchangeRateBasisView | null
  excludedForeignCount: number          // v4.9 (P8 컷 a2) — 환율이 없어 이 행의 원화 합계에서 빠진 외화 상품 수
  /** v4.16 (P8 컷 b1 명세 · 구현 b4 · b1 개정) — 표 밖 표식 여섯째. 그 표에 추정 월수익 사건이 하나라도 있으면 참 — 「월지급식은 적용 차수까지 매월 지급 가정」 */
  monthlyCouponAssumption: boolean
}
```

**연도 범위는 `[Y₀, Y₀ + years − 1]`이다.** `Y₀`는 기준일의 연도(§4.0 Q-02)이며 `years = 6`이면 여섯 행이다. **상한을 계약이 검사하고 위반은 던진다**(§3.1의 시스템 오류 — 호출부의 프로그래밍 오류다). SCR-402는 이 인자를 화면에서 노출하지 않으므로 조작된 주소가 이 축에 닿지 않는다.

> **상한을 두는 이유가 SCR-401에서 실현된 적이 있다.** 그쪽의 연도 선택기가 상한 없이 주소의 값을 받아 `?year=9999`에서 `<option>`을 7,974개 렌더했다(DOC-008 §5 SCR-401 v1.2). 여기서는 화면이 인자를 노출하지 않는 것이 1차 방어이고 계약의 상한이 2차 방어다 — **화면 하나의 성질에 의존하지 않는다.**

> **`FORECAST_MAX_YEARS = 20`이다 (v2.5, P4b 컷 7). 그리고 이 수에는 도메인 의미가 없다 — 그 사실이 이 각주의 요점이다.**
>
> v2.4가 이 상한의 **이름**을 정하고 값을 비워 두었다. 그 상태로 구현하면 값을 코드가 조용히 정하게 되므로(AQ-08이 「코드에 기본값을 박는 순간 사실상 닫힌다」로 적은 것과 같은 형태) **구현 전에 여기서 정한다.**
>
> **근거가 되지 못하는 것을 먼저 적는다.** 스키마에서 유도할 수 없다 — `evaluation_period_months >= 1`에 상한이 없으므로(V-20) 상품의 만기가 구조적으로 무계이고, 「모든 상품이 상환을 마치는 해」를 계약이 계산할 수 없다. AQ-08이 **기본값** 6에 준 근거(만기 통상 3년의 두 배 안쪽)는 「유용한 구간」의 근거이고 **상한의 근거가 아니다** — 상한은 유용함이 아니라 오류를 막는다.
>
> **그래서 이것은 가드이며 두 조건만 만족한다.** ① 기본값보다 확실히 크다 — 6이 동시에 천장이면 `years` 인자가 장식이 되어 AQ-08의 「인자를 남겨 둔다」가 무효가 된다(기본값을 상수로 두는 것과 인자를 없애는 것이 다르다는 그 판단이 상한과 기본값이 같으면 성립하지 않는다). ② 행 수가 렌더 위험이 될 수 없다 — 20행은 위 SCR-401 사례(7,974개)와 세 자릿수 차이다.
>
> **이 수에 나중에 의미를 읽지 않도록 여기 못 박는다.** 「20년까지 전망이 유효하다」는 뜻이 **아니다.** 시드가 2026 하나인 동안 두 번째 행부터 이미 전부 근사이며(§4.7 세율 연도 취급), 근사의 유효 범위는 이 상한과 무관하다. 늘리거나 줄일 때 필요한 근거도 도메인이 아니라 위 두 조건뿐이다.

**본인 전용이다.** `ownerId ≠ 조회자`이면 예외를 던진다 — §4.6과 같은 규약이며 **근거는 더 강하다.** `tax_profiles`의 조회가 본인 한정이므로 타인의 전망은 `other_financial_income`을 `0`으로 읽어 조용히 과소 산출되는데, §4.6은 한 해가 틀리고 **본 계약은 `years`개 연도가 전부 틀린다.** 아래 프로필 이월 규칙이 그 오류를 연쇄시키기까지 한다.

**세율 연도의 취급은 §4.6과 같고, 행 단위다.** 시드된 연도는 `taxLawYear = year`이고 시드보다 미래인 연도는 최신 시드 연도로 근사한다. **행마다 담는 이유는 갈리기 때문이다** — 2027년이 시드되는 날 2026·2027행은 정확하고 2028년 이후 행은 근사가 된다. 현재 시드는 2026 하나이므로 여섯 행이 전부 근사이며, §4.6이 「화면은 근사임을 표시한다」를 계약으로 요구하므로 그 표시의 자료원이 이 필드다.

#### 과세 프로필은 이월한다 (LOCF)

```
profileFor(profiles, Y) = argmax { p.tax_year | p ∈ profiles, p.tax_year ≤ Y }
                        = §4.6의 폴백 (otherIncomeBase 0, otherFinancialIncome 0, NONE)   if 그런 p가 없다
```

`profileYear`가 그 결과의 연도이며 **세 상태를 하나의 값으로 표현한다** — `= year`(그 해의 저장값) · `< year`(이월) · `null`(미입력).

> **§4.6의 폴백을 그대로 쓸 수 없다.** 그 규칙(행이 없으면 전부 `0` + `NONE`)을 여섯 연도에 적용하면 `other_financial_income = 0`이라 **종합과세 여부가 틀리고 보험료 열이 여섯 해 내내 0**이 된다. 오류도 빈 값도 아닌 **그럴싸한 숫자**다. §4.6의 폴백 논거는 「화면이 미입력으로 표시한다」였고 그것은 **편집기가 같은 화면에 있는 SCR-401에서 성립한다** — SCR-402에는 편집기가 없다.
>
> **`boolean`으로 두지 않는 이유는 §4.6이 이미 후회한 실수다.** `isSaved`가 「저장 없음」과 「`override` 적용 중」을 한 거짓으로 접어서 DOC-008 §5가 상태 셋을 표로 다시 풀어야 했다(그 절의 「미입력과 0원을 가른다」). 여기도 상태가 셋이므로 `isProjectedProfile: boolean`은 뒤의 둘을 접는다. 연도를 담으면 화면이 **「2026년 프로필 적용」이라고 말할 수 있다.**
>
> **이월의 기준은 `Y` 이하이고 `Y₀` 이하가 아니다.** §5.6 `saveTaxProfile`은 시드 연도로 제한하지 않으며 실제로 미래 연도의 프로필이 저장된다(`tests/e2e/tax.test.ts`가 그 방법을 쓴다). `Y₀` 이하로 두면 2027년 프로필이 실재하는데 2027년 행이 2026년 값으로 계산된다.

#### 빈 상태를 `[]`로 표현하지 않는다

상품이 0건이어도 **`years`개 행을 반환한다.** `[]`를 주면 상품 0건 + ELS 외 금융소득이 있는 사용자에게서 세금 행이 사라져 **§8.1의 E 부류를 재현한다** — SCR-101의 빈 상태 분기가 요소 ③을 함께 지운 것과 같은 형태다(그 사용자의 종합과세 여부와 보험료는 상품과 무관하게 실재한다). 「전망할 데이터 없음」(DOC-008 §6)의 판정은 화면 층의 순수 함수가 담당한다.

**나머지 필드는 §4.6과 같은 집계·세액 경로를 쓴다.** `grossProceeds`는 그 해에 귀속된 ~~상품의~~ **사건(상환 · 월수익)의** 세전 실수령액 합계이고 *(v4.16 — 아래 「월지급 상품의 전망」)*(§7.5의 `Σ gross`), 세액·부담률·보험료는 §5·§6이며, `financialIncome`·`isComprehensive`·`thresholdGap`은 §4.6의 `income`과 같은 값이다.

**왕복은 4다** *(v4.13 — 종전 3에 추정 환율이 더해졌다)* — 세율 연도 전체(1) + 본인의 과세 프로필 전체(1) + 상품(1) + 추정 환율(1 — `loadEstimateRates`, 첫 물결에서 나란히). §4.6과 같은 수이며 연도 수에 비례하지 않는다: `loadAllTaxYears`가 시드된 연도를 한 번에 가져오고(§9 AQ-22가 그 분해의 부수 효과로 적었다) 프로필은 `tax_year ≤ Y₀ + years − 1` 한 번으로 받아 위 LOCF를 적용하며, 추정 환율도 요청당 한 번 읽어 모든 연도에 쓴다(§4.0 규칙 2).

#### 달러 상품의 전망 — 원화 합계와 E-09 (v4.9 선행 명세 — P8 컷 a1, 구현 a2·a3)

**전망표는 원화 표다.** 열 전부가 한 행의 합이므로 통화별로 가를 수 없고(가르면 누적 두 열이 통화마다 생긴다), 달러 상품의 금액은 **추정 환율로 원화 환산해 더한다** — 상환 완료의 확정 달러 수령액도 원화로 더하는 순간 추정이다(ST-05).

| 열 | 달러 상품의 몫 |
|---|---|
| `financialIncome` (F) | §4.6과 **같다** — 확정 원화 과세는 늘, 추정은 `× x` 또는 E-09 |
| `grossProceeds`·`netProceeds`·`cumulativeNet`·`remainingPrincipal`·`cumulativeAssets` | 달러 금액 `× x`. 원금과 수령액을 **같은 `x`로** 바꾸므로 DOC-007 §7.5의 배타 분할(한 상품의 원금은 잔여 원금 아니면 수령액 한쪽에만)이 그대로 성립한다 |

- **추정 환율이 없으면 그 상품은 이 행의 원화 합계 열에서 빠지고 `excludedForeignCount`가 센다** — 단 F의 확정 원화 과세는 빠지지 않는다(§4.6의 표 첫 줄). 매퍼의 「항목을 떨어뜨리지 않는다 — 떨어뜨리면 그 원금이 표에서 사라진다」(`queries/forecast.ts`)의 **예외**이고, 예외인 이유가 그 규칙의 이유와 같다: 사라지는 것을 숨기지 않으려고 센다. 기본 환율로 채우면 원금이 약 1/1,400로 «있는 것처럼» 보인다.
- **행마다 센다 — 그 상품이 처음 원화 합에 필요해진 행부터 마지막 행까지다.** 누적 두 열(`cumulativeNet`·`cumulativeAssets`)이 **뒤 행에서도** 그 상품을 잃기 때문이다(DOC-007 §7.5 — `cumulativeNet(Y)`는 `[Y₀, Y]`의 합이다). 미상환 달러 상품은 상환 연도 전의 행에서는 잔여 원금으로, 상환 연도에는 수령액으로, **그 뒤 행에서는 누적으로** 빠지므로 첫 행부터 마지막 행까지 각각 1이다. `Y₀`에 상환된 달러 상품도 첫 행부터 1이고, `Y₀` 이전에 상환된 상품은 어느 열에도 없으므로(DOC-007 §7.5 분할 표 둘째 줄) 세지 않는다. 「상환 연도까지」만 세면 뒤 행의 누적 두 열이 그 상품 없이 짧은데 건수는 0으로 읽힌다. *(v4.16 — 「`Y₀` 이전에 상환된 상품」은 **`Y₀` 이전의 사건**으로 넓어진다: 확정이든 추정이든 기준 연도 이전의 사건은 어느 열에도 없고 세지 않는다 — 상환된 상품의 흐름 끝 안 무기록 월수익이 전년도일 수 있다(U5). 그리고 **세는 단위는 상품이다** — 한 상품의 사건 여럿이 빠져도 1이다(`excludedForeignCountOf` — P8 컷 b0)*
- **`hasEstimates`는 환산에도 참이다.** 종전 뜻(적용 차수 가정에 의존한다)에 「원화 환산을 포함한다」를 더한다 — 확정 상환만 있는 해라도 달러 수령액을 환산했으면 참이다.
- **`exchangeRateBasis`는 표 밖 표식 다섯째다**(넷째는 a2의 `excludedForeignCount` — DOC-008 SCR-402, 반박 검토 반영). 열이 아니라 표 전체의 조건이므로 `taxLawYear`·`profileYear`·`hasEstimates`와 같은 부류이며 DOC-008 SCR-402의 「표 밖 표식」 행이 규정한다. **`excludedForeignCount`도 열이 아니다** — `tests/app/forecast.test.ts`의 `OutsideTable`이 둘을 다 더해야 `_NoUnmappedField`가 선다(a2가 `excludedForeignCount`, a3가 `exchangeRateBasis`). 추정 환율이 요청당 하나이므로(§4.0 규칙 2) 환산이 있는 행들의 값은 같다.
- **어느 행에 붙는가 — `excludedForeignCount`와 같은 규칙이다 (v4.13 — 구현에서 정함).** 환산한 외화 상품이 처음 원화 합에 필요해진 행부터 **마지막 행까지**이고, 그 규칙에서는 보유중 · `Y₀` 상환 상품이 첫 행부터 필요하므로 **모든 행이 같은 값**이다. 기준 연도 이전에 상환된 외화 상품은 어느 열에도 없으므로 환율이 있어도 표식을 세우지 않는다(~~`forecastItemOf`의~~ `forecastItemsOf` 항목의 `estimateRate` — `excludedForeign`의 거울이며 한 항목에 둘이 동시에 서지 않는다. *v4.16 — P8 컷 b0이 `forecastItemOf`를 `forecastItemsOf`로 바꿨고 `estimateRate`는 `ForecastProductItem`의 필드다. 「기준 연도 이전에 상환된 상품」은 「기준 연도 이전의 사건」으로 넓어진다 — 위 항목*). 「귀속연도 행에만」으로 두면 뒤 행의 누적 두 열이 환산값을 담는데 근거가 비어 확정처럼 읽힌다(ST-05).
- **`hasEstimates`의 행 축은 그대로다 (v4.13 — 정리).** 종전 뜻은 「그 해의 귀속 항목 또는 잔여 항목이 가정에 의존한다」이고 누적 두 열의 **앞 행 몫은 세지 않는다** — 원화 추정 상환(`Y₀`)도 뒤 행의 `cumulativeNet`에 들어 있지만 그 행의 `hasEstimates`는 거짓이다. 달러 환산도 같은 규칙을 따른다: `Y₀`에 상환된 달러 상품은 `Y₀` 행에서 참이고 뒤 행에서는 누적에만 있다. 누적이 환산을 담는다는 사실은 표 전체의 조건인 `exchangeRateBasis`가 말한다 — 행 축을 넓히면 원화 추정과 달러 환산에 다른 규칙이 생긴다(`lib/tax/forecast.ts`는 바뀌지 않는다).
- **모든 미래 연도에 같은 환율을 쓴다**(DOC-007 RD-09) — 연도별 전망 환율을 두지 않는다. 화면 고지가 그 가정을 말한다(DOC-008 SCR-402).

#### 월지급 상품의 전망 — 사건마다 항목 하나 (v4.16 선행 명세 — P8 컷 b1, 구현 b4)

**코드가 한 컷 앞섰다 (P8 컷 b0, `d675efb`).** `forecastItemOf`(상품 → 항목 하나)가 `forecastItemsOf`가 되었다 — 상품마다 `incomeEventsOf`를 **한 번** 읽어 **사건마다 항목 하나**를 만들고, **원금을 돌려주는 사건(상환)이 없으면 원금 항목 하나**를 둔다(귀속 = 적용 차수의 연도, 적용 차수가 없으면 `null` — 전 연도의 잔여 원금, E-07의 시각적 형태). 원화 합계에서 빠진 외화 상품은 평탄화 **전에** 상품 단위로 센다(`excludedForeignCountOf`). 그 컷까지 사건은 상품당 최대 하나라 **동작 불변**이다(HEAD 대 작업 트리 차분 0). 이 절은 그 형태가 월지급식에서 무엇을 뜻하는지 적는다.

- **원금은 상환 항목에만 싣는다** — 월수익 항목의 원금 반환분은 0이다(§4.0 「쿠폰 지급방식과 월수익」 규칙 2). DOC-007 §7.5의 배타 분할(한 상품의 원금은 잔여 원금 아니면 수령액 한쪽에만)이 그대로 선다.
- **조건이 「사건이 없음」이 아니라 「원금을 돌려주는 사건이 없음」인 이유** — 적용 차수가 없는(NO_ROUND) 월지급 상품은 흐름 끝이 무한이라 월수익 사건은 있는데 상환 사건이 없다. 「사건이 없으면 원금 항목」으로 두면 그 원금이 표에서 증발한다(b0 반박 검토가 찾았다 — `queries/forecast.ts`의 주석).
- **`grossProceeds`·`netProceeds`의 항은 사건이다** — 월수익 사건의 세전은 `PAID` 기록의 세전 또는 추정 `q_k`이고 원금이 없다. 그래서 월지급 상품의 한 해 세후 회수에는 그 해의 월수익(추정 포함)이 들고 원금은 상환 사건의 해에 한 번만 든다(DOC-007 §7.4).
- **기준 연도 이전의 사건은 확정이든 추정이든 어느 열에도 없다** — 상환된 상품의 흐름 끝 안 무기록 월수익은 추정 사건이면서 전년도일 수 있다(U5). 그런 사건은 세지도 않는다(`excludedForeignCount` · `exchangeRateBasis` — 위 달러 항목의 v4.16 각주).
- **`excludedForeignCount`는 상품 수다** — 한 상품의 월수익 사건 여럿이 빠져도 그 행에서 1이다(§4.0 규칙 4).
- **`hasEstimates`는 그 해에 추정 월수익 사건이 있어도 참이다** — 무기록 달을 지급된 것으로 넣는 것도 가정이다. 정의를 새로 쓰지 않는다 — 항목이 사건마다 하나이고 추정 사건의 항목이 추정 표식을 싣는다(DOC-007 §7.5). **정의는 위 v4.13 각주 그대로다** *(b1 개정 — 반박 검토 반영)* — 그 해에 귀속되는 항목 중 추정이 있거나, **연도 말에 남은 항목**(그 해까지 돌려받지 않은 항목) 중 추정이거나 귀속이 `null`인 것이 있으면 참이다(`lib/tax/forecast.ts`). 그래서 월지급식에서는 **원금 0인 미래 추정 월수익 항목이 남은 항목으로 앞 행을 참으로 만든다** — 그 행의 값은 그 항목에 의존하지 않는데도 그렇다. 그 항목을 「남은 항목」 판정에서 뺄지는 DOC-007 RD-19 ⓑ가 들고 있다(b4 전에 정한다).
- **가정 문장 — 「월지급식은 적용 차수까지 매월 지급 가정」** — 표 밖 표식이다(열이 아니다 — `taxLawYear`·`profileYear`·`hasEstimates`·`excludedForeignCount`·`exchangeRateBasis`와 같은 부류). 미상환 월지급 상품의 추정은 적용 차수(가정된 상환)의 평가일까지 매월 지급된다고 놓고 그 뒤 달은 넣지 않는다(「예정 · 조기상환 가정 밖」 — 민서 결정(2026-10-02) ③). **결속된 면책 문장을 고치지 않고 별개 문장이다** — 문구 상수는 b4의 코드 커밋에 선다(DOC-008 SCR-402). **표식은 `monthlyCouponAssumption: boolean` — 표 밖 표식 여섯째다** *(b1 개정 — §9 ⑦ 해결)*. 그 표(연도 범위 `[Y₀, Y₀ + years − 1]`)에 추정 월수익 사건이 하나라도 있으면 참이고 그것이 문장의 조건이다 — 표 전체의 조건이므로 모든 행이 같은 값이다(`exchangeRateBasis`와 같은 형태). 기준 연도 이전의 사건은 표에 없으므로 세지 않는다(위 항목). 구현 b4의 코드 커밋에서 `tests/app/forecast.test.ts`의 `OutsideTable`이 이 필드를 더해야 `_NoUnmappedField`가 선다. **화면 전체 고지의 조건(DOC-007 RD-19)은 그대로 b4 전에 정한다** — 이 필드는 표의 표식이고 그 미결을 닫지 않는다.
- **검산 B-7** (DOC-007 — §4.3의 B-1 상품 · 기준 연도 2026 · 다른 소득 0): 2026 행 `grossProceeds` 3,000,000 · `netProceeds` **2,538,000** · `remainingPrincipal` 100,000,000 · `cumulativeAssets` **102,538,000** / 2027 행 `grossProceeds` **100,600,000**(상환 투자원금 + 6번째 달) · `netProceeds` **100,507,600** · `remainingPrincipal` 0 · `cumulativeAssets` **103,045,600**. 음성 대조 — 월수익 항목에 원금을 실으면 2026 잔여 원금 200,000,000 · 누적 자산 202,538,000(이중 계상). 매퍼(`forecastItemsOf`)를 거쳐 검증한다(`tests/db/income.test.ts` — SB-9, P8 계획 결정).

### 4.8 사용자별 현황 — SCR-501

```ts
function listUserSummaries(): Promise<UserSummary[]>

type UserSummary = {
  userId: string
  displayName: string
  isMe: boolean
  activeCount: number
  /** v4.9 (P8 컷 a2) — 통화별. KRW → USD 순. 보유중 상품이 없으면 [{ currency: 'KRW', activePrincipal: '0' }] */
  activePrincipalByCurrency: Array<{ currency: ProductCurrency; activePrincipal: string }>
  currentYearFinancialIncome: string
  includesOtherFinancialIncome: boolean  // false = ELS 과세소득만. 실제보다 낮다
  isComprehensive: boolean | null        // null = 판정 불가 (타인)
}
```

> 합계 행을 제공하지 않는다. 금융소득종합과세는 개인 단위이므로 사용자 간 합산은 오해를 유발한다.

**타인 행은 ELS 과세소득만 담는다 (v0.6 정정).**

| 대상 | `currentYearFinancialIncome` | `includesOtherFinancialIncome` | `isComprehensive` |
|---|---|---|---|
| 본인 | ELS 과세소득 + `other_financial_income` | `true` | 판정값 |
| 타인 | ELS 과세소득만 | `false` | `null` |

> **RLS가 타인의 `other_financial_income`을 감춘다.** `tax_profiles`의 조회는 본인 한정이므로(DOC-010 §7) 타인의 `F`를 완전하게 산출할 방법이 없다. v0.5의 계약을 그대로 구현하면 **읽지 못한 값을 `0`으로 두고 계산이 끝나** 타인의 금융소득이 실제보다 낮게, 종합과세 여부는 틀리게 표시된다. 오류도 빈 값도 아니라 **그럴싸한 숫자**로 나타나므로 화면에서 발견되지 않는다.
>
> **축소만 하고 표식을 두지 않으면 같은 문제가 남는다.** 값을 줄이는 것으로 끝내면 화면은 그것이 완전한 금융소득인 줄 알고 렌더링한다. `includesOtherFinancialIncome`으로 불완전함을 타입에 드러내고, 판정 불가를 `null`로 표현한다 — §4.6의 `method1`·`method2`가 미적용을 `null`로 표현한 것과 같은 방식이다.
>
> **`security definer` 함수로 파생 boolean만 반환하는 대안은 채택하지 않았다.** 그 방식이 `other_financial_income` 자체를 노출하지 않으므로 누출은 더 적지만, PostgREST에 RPC 노출면과 `search_path` 관리가 새로 생긴다. 그리고 SCR-501의 존치 자체가 미결이므로(DOC-008 SQ-01, "P4 이후") 버려질 수 있는 인프라다. SQ-01이 존치로 닫히고 타인의 종합과세 여부가 실제로 필요하다고 판단되면 그때 도입한다.
>
> 이 정정은 `tests/rls/tax-profiles.test.ts`가 P3에 남긴 메모("조회 제한은 오류가 아니라 빈 결과다 — 0행이 '없음'이 아니라 '볼 수 없음'일 수 있다")를 조회 계약 쪽에서 해소한 것이다.

**결함 상품의 기여를 포함하며, 여기에는 표식을 두지 않는다 (v0.8에서 판단 기록).** `currentYearFinancialIncome`은 §4.6 `income.total`과 같은 산출 경로를 쓰므로 결함 상품의 기여를 포함하고, 두 계약의 값이 일치한다.

> **§4.6과 달리 표식을 두지 않는 이유.** `includesOtherFinancialIncome`은 *읽지 못한 값이 빠져 있다*는 뜻인데, 결함 상품의 기여에는 **빠진 값이 없다** — 금액은 완전하고 정확하다(§4.2의 입력 기준). 그리고 §4.8은 상품 단위 분해가 없는 롤업이라 표식을 걸 자리가 행 전체뿐이고, 그러면 "이 사용자의 금융소득이 불완전하다"는 **틀린 뜻**이 된다. 결함은 SCR-101의 `attentionItems`와 SCR-201에서 드러난다.
>
> 표식을 추가하게 되더라도 **반드시 별도 필드**여야 하며 `includesOtherFinancialIncome`에 접으면 안 된다 — 두 값은 다른 것을 말한다. 다음 대조 검증이 이 항목을 다시 다투지 않도록 판단을 남긴다.

> **`activePrincipal` → `activePrincipalByCurrency` (v4.9 선행 명세 — P8 컷 a1, 구현 a2).** §4.1 `totals`와 같은 이유로 통화를 넘어 더하지 않는다. 행은 그 사용자에게 **보유중** 상품이 있는 통화마다 하나이고(원금만 담으므로 §4.1과 달리 상환 완료를 세지 않는다) 없으면 원화 0 한 행이다. 원화 환산 합계는 두지 않는다 — 화면이 없고(SQ-01) 사용자 간 비교에 추정을 섞을 이유가 없다.
>
> **`currentYearFinancialIncome`은 §4.6과 같은 E-09를 따른다** — 환율이 없으면 추정 달러 건이 빠진 값이다. **그 불완전함의 표식은 지금 두지 않는다.** 화면이 없고(SQ-01), 위 v0.8 판단대로 표식을 더하게 되면 `includesOtherFinancialIncome`에 접지 않고 **별도 필드**여야 한다 — 앞은 RLS가 감춘 값이고 뒤는 환율이 없어 만들지 못한 값이다. SQ-01이 존치로 닫히면 그때 연다.
>
> **월지급식에서도 변경이 없다 (v4.16 선행 명세 — P8 컷 b1, 구현 b4).** `currentYearFinancialIncome`은 같은 `contributionOf`를 지나므로(SB-4 — P8 계획 결정) 월수익 사건(확정 · 추정)을 §4.6과 **같은 사건 집합**으로 담는다 — 서명도 필드도 그대로이고, 확정/추정 분할과 표식은 여전히 두지 않는다(위 v0.8 판단 · SQ-01). **본인 행의 F가 §4.6 `income.total`과 같다는 통합 테스트를 b4에 둔다** — `listUserSummaries`가 `contributionOf`의 둘째 소비자라 사건을 접는 규칙이 한쪽에만 닿으면 두 화면이 갈린다(§4.6 마지막 항목의 항등). `activePrincipalByCurrency`는 원금만이라 월수익과 무관하다.

### 4.9 자산 검색 — SCR-204

```ts
function searchAssets(query: string): Promise<AssetOption[]>

type AssetOption = {
  id: string
  name: string
  market: string | null
  currency: string
  assetType: 'STOCK' | 'INDEX' | 'ETF' // v4.5 — 불러오기의 연결 후보가 같은 유형만 본다
  hasPriceProvider: boolean            // 자동 조회 가능 여부
  providerSymbols: Array<{ provider: string; symbol: string }>  // v4.3 — §4.5와 같은 형태. 불러오기가 기초자산을 심볼로 잇는다(§4.10)
}
```

> **`providerSymbols`를 싣는 이유 (v4.3).** 불러온 상품의 기초자산은 키움 코드(`3:PLTR`)로 온다. 앱 자산과 **이름으로** 잇지 않는다 — 이름은 사용자가 쓴 값이고(개발 시드는 `[DEV] 코스피200`, 키움은 `KOSPI200지수`) 틀린 연결은 자동 시세가 되어 판정에 들어간다. `hasPriceProvider`는 이 배열이 비어 있지 않다는 것과 같다. **왕복이 늘지 않는다** — 종전 select가 이미 `asset_provider_symbols`를 임베드했고 열만 넓힌다.

**입력값을 필터 문법으로부터 격리한다.** `query`는 이름 부분일치 검색에 쓰이며 그대로 필터에 실린다. 구분자(`,`)와 와일드카드(`%`·`_`·`*`)를 이스케이프하고 결과 건수에 상한을 둔다 — 이스케이프하지 않으면 사용자가 입력한 쉼표가 필터를 쪼개고, `%` 한 글자가 전체 목록을 반환한다.

**빈 질의(`''`·공백만)는 「전량」이다** (v1.5, U-03). 이름 필터를 걸지 않고 자산 전체를 이름 순으로 반환하며, **검색 상한(20)을 적용하지 않는다.** 두 경로가 자름을 다르게 다루는 것이 이 규정의 요점이다.

| 질의 | 이름 필터 | 상한 | 넘칠 때 |
|---|---|---|---|
| 비어 있지 않음 | `ilike %q%` (이스케이프) | 20 — **의도된 자름** | 조용히 자른다. 사용자가 더 좁게 적으면 된다 |
| 비어 있음 | 없음 | `TRUNCATION_PROBE_LIMIT` — **감지용** | Q-06으로 **던진다**(AQ-09 신호) |

종전 구현은 빈 질의에 `[]`를 주었고 사유는 "자동완성이 열릴 때마다 전 자산을 내려보내게 된다"였다. **SCR-204에서 그 전제가 성립하지 않는다** — §1.2가 조회를 서버 액션으로 감싸지 않으므로 타이핑마다 묻는 경로가 없고, 화면은 렌더 1회에 전량을 받아 클라이언트에서 좁힌다(A-01 규모에서 즉시성도 더 낫다). 그 상태에서 `[]`는 절약이 아니라 **자동완성을 영구히 비게 만드는 값**이었다.

빈 질의에 상한 20을 물려 두지 않는 이유도 같은 종류다 — 21번째 자산이 **어떤 방법으로도** 선택되지 않는데 화면에는 그 사실이 나타나지 않는다. AQ-22가 이 계약에 대해 "§4.9가 상한을 명시했으므로 위반은 아니나 호출부에 절단 신호가 없다"고 적은 자리이며, 소비자가 생기면서 그 공백이 선택 불가능한 자산으로 실현되었다.

### 4.10 외부 조회 — 상품 조건 불러오기 (v4.3 신설, DOC-001 S-12)

```ts
function searchKiwoomProducts(query: string): Promise<LookupOutcome<KiwoomProductCandidate[]>>
function getKiwoomProductTerms(productCode: string): Promise<LookupOutcome<KiwoomProductTerms>>
function listKiwoomAssets(): Promise<LookupOutcome<ListedAsset[]>>

type LookupOutcome<T> =
  | { ok: true; data: T; truncated?: boolean }            // truncated — 검색 결과가 더 있다(100001)
  | { ok: false; failure: FailureClass; code: ProviderFailureCode; detail: string }
```

세 함수는 `createKiwoomProductSource({ fetchImpl })`가 만드는 `KiwoomProductSource`의 메서드다(`src/lib/providers/kiwoom/terms.ts`). 타입의 필드 전수는 `terms-types.ts`가 정본이며 이 절은 **규칙**을 정한다. 원천의 판정 근거·실측 함정은 DOC-010 ADR-009다.

**규칙 X — §4.0의 Q 규칙이 적용되지 않는 이유와 대신 서는 것**

| ID | 외부 조회 규칙 | 근거 |
|---|---|---|
| X-01 | **인증 뒤에만 부른다.** 화면이 `getQueries()`(미인증이면 던진다 — Q-04)를 **먼저** 부르고 그 뒤에 외부 조회를 시작한다. **수정 라우트(v4.6)는 `getProduct`와 소유 확인 뒤다** — 비소유자(SCR-902)·상환 처리된 상품(§5.2 `CONFLICT`)에서는 부르지 않는다 | 프록시가 우회되어도 미인증 요청이 서버로 하여금 키움을 부르게 만들 수 없다. 외부 조회 자체는 세션이 필요 없으므로 이 순서가 유일한 문지기다 |
| X-02 | **던지지 않는다** — 실패는 값이다 | 던지면 `app/error.tsx`가 SCR-204 **전체를** 내려 수동 등록까지 막는다. 불러오기는 보조 기능이므로 실패가 「직접 입력」으로 접혀야 한다(ST-03) — `PriceProvider`의 의무 ①과 같다 |
| X-03 | **캐시하지 않는다** — `cache: 'no-store'` | 사용자가 불러오기를 누른 그 시점의 값이어야 한다. 화면은 이미 `cookies()`로 동적이지만 명시가 의도를 문서화하고 설정 변경을 견딘다 |
| X-04 | **결과를 저장하지 않는다** | DB에 닿는 경로는 §5.1·§5.2(상품 — 수정은 v4.6)·§5.10(자산)·§5.12(매핑)뿐이며 **V-규칙이 전부 적용된다.** 불러온 값은 사용자가 폼에서 확인한 뒤 그 계약을 지난다 |
| X-05 | **`Queries` 묶음 밖, 무효화 축 밖이다** | 무효화할 DB 상태가 없다 — `QueryName`에 넣으면 `_queryAxisIsExhaustive`가 어느 변경의 `affects`에도 없는 이름을 거부하고, 넣으려면 가짜 `affects`를 지어내야 한다. 대신 **라우트별 외부 조회 원장**(`ROUTE_EXTERNAL_LOOKUPS`)에 등재하고 §8이 그 원장과 대조한다 |
| X-06 | **시간 예산** — 요청당 8초, 한 번의 렌더 안에서 15초. 쿠키를 싣지 않는다 | 배치(15초/요청)보다 짧다 — 사람이 기다리는 화면이다. 쿠키 규약은 ADR-008 §2 ③과 같다 |
| X-07 | **불러온 상품 통화가 저장값과 다르면 투자원금을 비운다** *(v4.15 · P8 컷 a4 — 앞절반)*. 「불러온 상품 통화」는 DOC-010 ADR-009 §7 `productCurrencyOf`의 확정 판정이고, 증인이 없으면 통화도 투자원금도 저장값이다. 같으면 아무것도 비우지 않는다. 비운 렌더는 「일부 채움」이다 | 통화와 투자원금은 함께 움직인다 — 투자원금은 원천에 없어 저장값이 남는데 통화만 바뀌면 `10000000`(원)이 $10,000,000.00이 된다. 형식이 정상이고 자릿수가 맞아 V-23도 못 잡는다. 환산하지 않는다(환율은 계약 조건이 아니다). 기록 있는 상품의 거부(뒷절반)는 §9 — ~~b1이 컷을 정한다~~ **컷 b4**다 *(v4.16 — 뒷절반의 규칙 문언은 b4의 코드 커밋이 이 행에 더한다)* |

**`resp_code`(검색)의 해석** — HTTP는 항상 200이고 성패가 본문에 있다.

| `resp_code` | 결과 |
|---|---|
| `100000` | `ok` |
| `100001` | `ok` + `truncated` — 다음 페이지를 따라가지 않는다. 화면이 「검색어를 더 적는다」를 말한다(Q-06의 정신 — 조용히 자르지 않는다) |
| `505065` | `ok([])` — **실패가 아니다.** 결과 없음이다 |
| `520050`, 그 밖 | `CALL_FAILED`(`HTTP`) — 코드·문구를 `detail`에 싣는다 |

**상세의 빈 템플릿은 `NO_DATA`(`EMPTY`)다** — 없는 코드도 HTTP 200이기 때문이다(ADR-009 ①).

> **조회 계약이 아니다 — 그래서 §4.0의 Q 규칙 대부분이 무관하다.** Q-01(세션·RLS)·Q-04(미인증 시 던진다)·Q-06(절단은 던진다)·Q-08(`::text`)은 DB를 전제한다. X-01이 Q-04의 **자리**를 대신하고(던지는 것은 앞의 `getQueries()`다), X-02가 Q-06과 **반대 방향**을 택한다 — 조회 계약은 잘린 목록을 옳은 목록처럼 보여 주지 않으려고 던지고, 외부 조회는 원천 장애가 화면을 죽이지 않도록 값으로 돌려준다. 둘 다 「거짓을 보이지 않는다」를 지키는 방식이 다를 뿐이다.

### 4.11 환율 — SCR-302 (v4.9 선행 명세 — P8 컷 a1, 구현 a3)

```ts
function listExchangeRates(): Promise<ExchangeRateView[]>

type ExchangeRateView = {
  currency: 'USD'                      // 지원 외화마다 한 원소 — 행이 없어도 원소는 있다
  latestRate: string | null            // 1달러당 원. 소수 6자리 (Q-07). null = 환율 없음 (ST-07)
  asOfDate: string | null
  source: 'AUTO' | 'MANUAL' | null
  provider: string | null              // AUTO일 때만 — exchange_rates_provider_check (DOC-002 I-22)
  isStale: boolean                     // §4.5와 같은 5일 규칙. latestRate = null이면 false
  usedByActiveProducts: number         // 이 통화의 미상환 상품 수 — 이 환율로 추정되는 상품
  autoCollected: boolean               // 환율 자동 수집 레지스트리가 비어 있지 않은가 (ADR-010)
}
```

**`latestRate`는 추정 환율과 «같은 행»이다.** `as_of_date ≤ asOf` 중 최신 1건이고(DOC-007 RD-09) §4.0 `loadEstimateRates`와 같은 규칙이다 — 규칙이 다르면 SCR-302가 보여 주는 환율과 SCR-401이 쓴 환율이 갈린다. 그래서 같은 요청에서 `ExchangeRateBasisView`의 `rate`·`asOfDate`·`source`·`isStale`과 같은 값이다.

**원소는 지원 외화마다 늘 하나다 — 빈 배열이 「환율 없음」이 아니다.** 행이 한 건도 없으면 `latestRate = null`인 원소가 온다. 그래야 화면이 환율이 없다는 사실을 그 통화의 자리에서 말할 수 있다(ST-02 · ST-07 — 문구의 정본은 DOC-008 SCR-302 「최신 값」 행이다. v4.13에서 이 절의 예시 문구를 지웠다). 순서는 `ProductCurrency`의 선언 순서에서 KRW를 뺀 것이다.

**`autoCollected`는 실행 시점의 사실이다 — 게이트의 분기를 화면에 박지 않는다.** 환율 자동 수집 레지스트리(`EXCHANGE_RATE_PROVIDERS` — 시세의 `PRICE_PROVIDERS`와 **다른** 목록이다. 섞으면 V-21의 「코드가 아는 공급자」가 오염된다 — ADR-010)가 비어 있지 않으면 `true`다. ADR-010 게이트가 분기 C(통과 없음)로 닫히면 영구히 `false`이고 화면은 그 상태를 `neutral`로 말한다(「자동 수집 안 함 — 수동 입력이 정상 경로」, DOC-008 SCR-302) — §4.5 `providerSymbols`의 빈 배열이 「미매핑」이며 실패가 아닌 것과 같은 판단이다. **컷 a3에서는 늘 `false`다** — 수집기는 분기 A/A′일 때 컷 c1·c2다. 그래도 **구조적 상수가 아니다**(§4.0 「컷별 도달」과 대조): 값이 코드의 레지스트리에서 파생되므로 c2가 등재하는 순간 화면이 따라온다. 화면에 문구를 박으면 c2에서 그 문구가 조용히 거짓이 된다.

**`usedByActiveProducts`는 §4.5와 같은 뜻이다** — 그 통화의 **미상환** 상품 수이며 §4.5처럼 **조회자가 볼 수 있는 전 사용자의 상품**을 센다(소유자로 좁히지 않는다 — v4.13 명시). 화면이 환율 절을 펼칠지의 입력이다(DOC-008 SCR-302). 그래서 상품 축의 변경이 이 계약을 함께 낡게 한다(§5.13 무효화 각주).

**왕복은 2다** — 환율(통화별 `limit(1)`) 1 + 상품(미상환 외화 상품 수) 1. 둘 다 `ctx`에만 의존하므로 나란히 나간다. `exchange_rates`는 하루 한 행씩 늘지만 통화별 `limit(1)`이라 Q-06의 절단이 구조적으로 불가능하다. **이력을 반환하지 않는다** — SCR-302에 환율 추이 요소가 없다.

**권한:** 인증 사용자 전체. 환율은 공용 관측 데이터이며(DOC-002 DQ-13) SELECT 정책이 `using (true)`다.

**조회 계약 9 → 10 (컷 a3).** 결속 원장이 같은 커밋에 움직인다 — `Queries` 묶음(`queries/context.ts`의 「9개」), `tests/integration/`의 `formats.test.ts`·`serialization.test.ts`·`contracts.test.ts`·`integrity-inputs.test.ts`의 계약 수, `ROUTE_QUERIES['/prices']`, §8 SCR-302 행(표 행은 그 코드 커밋에 함께 — §8 말미 각주).

### 4.12 월수익 일정 — SCR-301 (v4.16 선행 명세 — P8 컷 b1, 구현 b3)

```ts
function listMonthlyCouponSchedule(params: {
  from?: string
  to?: string
  ownerId?: string
  activeOnly?: boolean
}): Promise<MonthlyCouponScheduleItem[]>   // 행 = 월수익 일정 한 행(상품 × 월수익 순번)

/** v4.16 (b1 개정 — §9 ⑧ 해결) — 월수익 일정 한 행. 정의는 §4.3 `CouponObservationView`와 같다 */
type MonthlyCouponScheduleItem = {
  productId: string
  productName: string
  ownerName: string
  currency: ProductCurrency             // expectedAmount · record.grossAmount의 통화 (§4.0 달러 규칙 1 — 금액이 있는 곳에 통화가 있다)
  couponNo: number                      // 월수익 순번 — 「5번째 · 2027-02-16」
  evaluationDate: string                // 월수익 평가일
  paymentDate: string                   // 월수익 지급일 (일정의 값)
  couponBarrier: string                 // 월수익 배리어. 4자리
  state: CouponState                    // §4.0 「구획」
  expectedAmount: string                // 상품 통화 — q_k(보조단위 절사값 — §4.0 「형식」)
  record: { outcome: CouponOutcome; grossAmount: string | null } | null   // 그 달의 기록. UNPAID면 grossAmount null
  conditionResult: CouponConditionResult | null   // 다음 한 행에만 값 (§4.3과 같다)
}
```

**인자는 §4.4 `listSchedule`과 같다.** 네 값 모두 저장된 열의 조건이므로 질의로 내린다(Q-05). 날짜 범위는 **월수익 평가일**에 걸린다 — `monthly_coupon_schedules.evaluation_date`의 인덱스가 이 화면을 위한 것이다(DOC-002 §4.13). `ownerId`는 부모 열 조건, `activeOnly`는 부모의 상환 부재 조건이다(§4.4와 같은 형태). **그리고 인자와 무관하게 부모 `coupon_payout = 'MONTHLY'`인 행만 읽는다** *(b1 개정 — 반박 검토 반영)*. 계약 밖 쓰기(직접 INSERT · 기록 없는 상품의 지급방식 직접 UPDATE — 동결 트리거는 기록이 있을 때만 발화한다)로 상환 시 지급 상품 아래에 일정 행이 남을 수 있는데(§3.2.1 — AQ-29 부류), 그 행은 월수익 연쿠폰율이 `NULL`이라(I-23) `expectedAmount`(`q_k`)가 정의되지 않는다. 걸러 내지 않으면 그 행이 SCR-301에 월수익 행으로 나오고, 산식이 던지면 SELECT가 `using (true)`이므로 남의 상품 하나가 모든 사용자의 평가일정을 죽인다(DOC-010 AQ-92와 같은 부류). 지급방식은 부모 열 조건이므로 질의로 내린다(Q-05).

**질의의 루트는 `monthly_coupon_schedules`다 — 자기 루트 쿼리.** §4.4 「질의의 루트」 각주와 같은 이유다: 상품을 루트로 두고 월수익 일정을 임베드하면 `from`·`to`가 임베드 필터가 되어 **잘린 일정 집합**에서 다음 행(조건 판정)을 고르게 된다. 루트를 월수익 행으로 두고 부모 상품이 자기 월수익 일정 · 기록 · 조기상환 일정 · 상환 **전체**를 다시 담으면 상태(§4.0 「구획」 — 흐름 끝이 적용 차수 · 상환일에서 나온다)와 다음 행 판정이 온전하다. ⚠ **그 「전체」는 상품마다 월수익 행 수만큼 복제된다** — 한 상품에서 K행(최대 60)이 저마다 부모의 K행을 다시 담으므로 K²이다. b1 개정이 차수 루트(§4.4)에서 피한 복제와 같은 부류이고 크기만 다르다(그쪽은 차수 수 × 월수익 수). 다음 행 판정과 흐름 끝에 필요한 것은 부모의 월수익 평가일들과 기록 유무이므로 부모 임베드를 그 열로 좁힐 수 있는지는 b1 명세에 없다 — §9 「P8 월지급 — b2 전에 정한다」 ⑰(b3 전, 페이로드 실측은 DOC-010 AQ-77).

**`ScheduleItem` 합집합을 쓰지 않는다.** §4.4의 행과 한 유니온으로 섞으면 화면의 `groupByProduct`가 `roundNo`로 정렬하는 것이 깨진다 — 월수익 순번은 차수가 아니다(DOC-005 §8.3). 그리고 차수 행의 판정(`conditionResult` · `isPast` · `proceeds`)을 월수익 행에서 다시 해석해야 하고, 그 해석은 어느 스위트도 대조하지 않는 화면 합성이 된다(DOC-010 AQ-23). **두 계약을 화면이 나란히 읽는다** — 상품별 보기의 카드에는 월수익 평가일 하위 목록(다음 월수익 하나 + 펼치기 — DOC-008 SQ-14 해소)이, 시간순 보기에는 「종류」 필터와 함께 월수익 행이 선다(DOC-008 SCR-301 ⑮⑯).

**상태와 조건 판정은 §4.3 `coupons`와 같은 정의다** — 같은 상품의 같은 달에 두 화면이 다른 상태를 말할 수 없다. 판정 삼종을 §4.2·§4.3·§4.4가 같은 `judge()`로 내는 것과 같은 이유이며, 구현은 한 함수를 공유한다.

**Q-06 — 이 계약이 상한에 가장 먼저 닿는다.** 행 단위가 월수익 행이라 월지급 상품 × 약 36행(최대 60 — V-26)으로 늘어 `listSchedule`(상품 × 약 6차수)보다 빠르다. 상한에 닿으면 던진다 — 그때가 AQ-09(페이지네이션)를 닫을 신호다.

**무효화 — 세금이 없다.** `PRODUCT_WIDE`(상품 · 상환 — 행의 존재와 흐름 끝, 「상환 후 없음」이 바뀐다) · `PRICE_WIDE`(다음 행의 조건 판정이 최신 시세를 쓴다) · `COUPON_RECORD_WIDE`(행의 상태와 기록 — §5.14·§5.15)에 든다. 이 계약이 `PRICE_WIDE`에 들어도 그 축의 「세금이 없다」는 그대로다(§8 · §5.14 무효화 각주). **`createProduct` · `updateProduct`의 `affects`에도 든다**(b1 개정 — §9 ⑭) — 새 월지급 상품이 월수익 행을 만들고 수정이 행을 바꾼다. `updateProduct`는 `PRODUCT_WIDE`를 쓰고 `createProduct`는 축을 쓰지 않고 따로 적으므로(`routes/invalidation.ts`) 둘 다에 더한다 — `listSchedule`이 `createProduct`에 드는 것과 같은 근거다. `createRealizedProduct`에는 들지 않는다 — 기실현은 월수익 일정이 없어 이 목록에 행이 생기지 않는다(`listSchedule`이 들지 않는 것과 같다). **`EXCHANGE_RATE_WIDE`에는 들지 않는다**(b1 개정) — 위 행 타입이 원화 환산 값을 싣지 않는다.

**왕복**은 b3의 코드 커밋이 재서 §4.0 왕복 표에 행으로 적는다(예상을 적지 않는다 — §5.0.1의 §5.12 각주와 같은 태도).

**조회 계약 10 → 11 (컷 b3).** 결속 원장이 같은 커밋에 움직인다 — `Queries` 묶음(`queries/context.ts`의 「10개」) · `tests/integration/`의 계약 수(`formats.test.ts`·`serialization.test.ts`·`contracts.test.ts`·`integrity-inputs.test.ts`) · `ROUTE_QUERIES[PATHS.schedule]` · `INVALIDATION`의 세 축(`_queryAxisIsExhaustive`가 어느 `affects`에도 없는 조회를 거부한다) · §8 SCR-301 행(표 행은 그 코드 커밋에 함께 — §8 말미 각주). **`tests/app/scheduleMarkers.test.ts`도 b3에서 넓힌다** — SCR-301 요소 마커가 `keyof ScheduleItem`을 전수로 보는데 ⑮⑯의 월수익 마커가 이 계약의 타입을 가리키게 된다(마커 자체도 b3 코드 커밋 — DOC-008 SCR-301).

---

## 5. 변경 계약 (서버 액션)

### 5.0 공통 변경 컨텍스트 (v0.9 신설)

본 절의 서명도 §4와 같이 **컨텍스트가 결속된 형태**다. 컨텍스트를 받는 팩토리가 계약 함수를 생성하며 서명 자체에는 나타나지 않는다.

```ts
type MutationContext = {
  db: UserSessionClient     // 로그인 사용자 세션. service_role을 쓰지 않는다
  asOf: string              // 기준일 (YYYY-MM-DD, Asia/Seoul)
  viewerId: string          // 변경자. owner_id 설정·소유자 판정의 기준
}
```

| ID | 규약 | 근거 |
|---|---|---|
| W-01 | 변경도 **사용자 세션으로만** 수행한다. `service_role`을 쓰지 않는다 | Q-01과 같다. 쓰기에서는 더 무겁다 — 조회의 우회는 남의 데이터를 보는 것이고 쓰기의 우회는 **남의 데이터를 바꾸는 것**이다 |
| W-02 | 기준일은 조회와 **같은 값**을 쓴다 | V-17(미래 일자 시세 거부)이 기준일을 요구한다. 변경 계약이 자기 시각을 따로 구하면 KST 00:00~09:00에 어제 날짜 시세가 "미래"로 거부되거나 그 반대가 된다(Q-02의 9시간 창) |
| W-03 | 미인증은 예외가 아니라 `UNAUTHENTICATED` **결과 객체**다 | §3.1 각주. 입력값 보존이 화면 요구사항이다(DOC-008 §6) |
| W-04 | 금액·비율은 **문자열로 보낸다.** 쓰기 함수의 `jsonb` payload도 `->>`로 꺼내 `::numeric`으로 캐스팅하며 `->`로 JSON 수치를 쓰지 않는다 | Q-08의 쓰기 방향이다. 숫자로 실으면 JS 쪽에서 이미 float64를 경유했으므로 DB가 받는 값이 무엇이든 늦다. **생성 타입이 이 규약과 어긋난다** — `Insert`·`Update`는 금액·비율 열을 `number`로 요구하므로 타입을 그대로 따르는 코드가 곧 위반이다(실측, AQ-30). 열 사양에서 파생한 `InsertPayload<T>`로 그 열들을 `string`으로 바꿔 **캐스팅을 한 곳에 모은다** — `defineColumns`가 읽기 방향에서 한 일의 대응물이다 |
| W-05 | 소유권은 RLS가 강제하고(§3.3) 계약은 **사전 조회로 `FORBIDDEN`·`NOT_FOUND`를 구분**한다. 그리고 **변경의 영향 행 수를 확인한다** | RLS의 `USING`은 UPDATE·DELETE에서 **오류 없이 0행**으로 거부한다(`tests/rls/helpers/expect.ts`의 형태 표). 그 0행을 성공으로 넘기면 사용자는 "저장됐다"는 화면을 보고 데이터는 그대로다 — 조용히 틀리는 것 중 가장 나쁜 부류다 |

> **W-05를 사전 조회 하나로 대신할 수 없다.** 사전 조회와 변경 사이에 다른 요청이 상태를 바꿀 수 있고(상환 등록·삭제), 그 창에서 RLS가 0행으로 막으면 사전 조회는 이미 통과한 상태다. 두 겹이 필요하다 — 사전 조회는 **오류를 구분**하기 위한 것이고(§3.3의 UX 목적), 영향 행 수 확인은 **성공을 주장하지 않기** 위한 것이다.

#### 5.0.1 왕복 수 — 실측 (P3b 9단계)

`tests/integration/mutations.test.ts`가 계약별로 **테이블 다중집합**을 센다. 총합만 세면 "상품 2회"와 "상품 1회 + 시세 1회"가 구분되지 않으므로 §4.0의 예산 계수와 같은 규약을 쓴다.

| 계약 | 왕복 | 구성 |
|---|---|---|
| §5.1 `createProduct` | **1** | `rpc:create_els_product` ×1 |
| §5.2 `updateProduct` | **2** | `els_products` ×1 (사전 조회) + `rpc:update_els_product` ×1 |
| §5.3 `deleteProduct` | **2** | `els_products` ×2 (사전 조회 + 삭제) |
| §5.4 `createRedemption` | **2** / 3 | `els_products` ×1 + `redemptions` ×1. 원천징수액 미입력이면 `tax_years` ×1이 붙는다 |
| §5.5 `updateRedemption` | **3** / 4 | `redemptions` ×2 (참조 + 갱신) + `els_products` ×1 (+ `tax_years` ×1) |
| §5.5 `deleteRedemption` | **3** | `redemptions` ×2 (참조 + 삭제) + `els_products` ×1 |
| §5.6 `saveTaxProfile` | **1** | `tax_profiles` ×1 |
| §5.7 `saveManualPrice` | **1** | `asset_prices` ×1 |
| §5.8 `refreshPrices` | **5** / 5+N / 2 | **매핑 0건**(이 표의 픽스처 — 잰 것은 이 경우뿐이다): `els_products` · `assets` · `asset_provider_symbols` · `asset_prices`(창 안 기존 날짜 사전 확인) · `cron_runs` 각 ×1. 새 종가 N건을 받으면 `asset_prices`가 1+N이다(`writeQuote`가 행마다 INSERT 한 번 — CR-05). 미상환 기초자산이 0건이면 대상 적재가 일찍 끝나 `els_products` · `cron_runs` 2다 *(v4.13 정정 — 종전 「0 · 공급자 0개이므로 DB에 닿지 않는다」는 P5a 컷 3이 어댑터를 등재하기 전의 값이다. 테스트는 그 컷부터 다섯을 단언했고 이 행만 낡았다. 5+N · 2는 코드 읽기로 정했다 — 재지 않았다)* |
| §5.9 `setKiTouched` | **2** | `els_products` ×2 (사전 조회 + 갱신) |
| §5.10 `createAsset` | **1** | `assets` ×1 |
| §5.11 `createRealizedProduct` | **1** / 2 | `.rpc()` ×1 (상품 + 상환 두 행). 원천징수액 미입력이면 `tax_years` ×1이 붙는다. **사전 조회가 없다** — 부모 상품이 없으므로 소유·상환 중복을 볼 대상이 없고, 소유자는 함수가 `auth.uid()`로 박는다 |
| §5.13 `saveExchangeRate` | **1** | `exchange_rates` ×1 *(v4.13 — P8 컷 a3)*. 공용 관측 데이터라 소유자가 없고 사전 조회가 없다(§5.7과 같다) |

> §5.12 `saveProviderSymbol`은 이 표에서 잰 적이 없다 *(v4.13 확인 — 그 계약이 선 P5a 컷 2b가 이 표에 행을 더하지 않았다)*. 형태는 §5.7과 같은 UPSERT 한 번이지만 측정이 아니므로 행으로 적지 않는다.

> **§5.14·§5.15의 행은 b2의 실측 커밋에 둔다 (v4.16 선행 명세).** 예상을 행으로 적지 않는다(바로 위와 같은 태도). 형태만 적는다 — 세 계약 모두 부모 상품의 사전 조회가 있고(W-05 · V-27), `recordCouponPayments`는 다행 INSERT **한 번**이며 원천징수 기본값이 필요한 행이 있으면 **그 지급일의 연도마다** `tax_years`를 한 번씩 읽는다(같은 해는 다시 읽지 않는다 — §5.14). 그래서 이 계약의 왕복은 입력에 따라 변하고, 다중집합 예산은 경우를 갈라 단언해야 한다(§5.8 `refreshPrices` 행과 같은 형태). **아래 ②는 b2에서 낡는다** — §5.15 `updateCouponPayment`도 상품이 아니라 기록 `id`를 받아 부모를 얻는 왕복을 강제하므로 「§5.5의 두 계약만」이 아니게 된다.

세 가지가 이 표에서 읽힌다.

① **사용자 데이터를 바꾸는 계약에서는 사전 조회가 필요한 계약만 2 이상이다.** `createProduct`·`saveTaxProfile`·`saveManualPrice`·`createAsset`·`saveExchangeRate`는 소유자를 판정할 대상이 없거나(생성) 소유자 개념이 없으므로(공용 데이터) 1이다. W-05의 비용이 어디에 붙는지가 그대로 보인다. §5.8 `refreshPrices`(5)는 이 명제 밖이다 — 사전 조회가 아니라 수집 대상을 읽고 결과를 쓰는 왕복이며 소유자 판정이 없다 *(v4.13 — 그 행을 정정하면서 이 명제를 좁혔다)*.

② **§5.5의 두 계약만 3이다.** 상품이 아니라 **상환 `id`를 받기 때문**이며, 그 하나가 부모를 얻는 왕복을 강제한다. 상품까지 임베드해 2로 줄일 수 있으나 그러려면 `PRODUCT_SELECT`를 이 방향으로 한 번 더 적어야 하고, 그 순간 열 사양의 출처가 둘이 되어 `select.ts`가 막아 둔 것(캐스팅과 선언이 같은 상수에서 나온다)이 사본에서 풀린다. **왕복 하나가 그 대가보다 싸다.**

③ **원천징수 산출이 왕복을 하나 늘린다.** 사용자가 실제 징수액을 적어 넣으면(A-04의 정본) 그 왕복이 사라진다 — 산출은 미입력 시에만 일어나므로 정상 경로가 더 싸다.

**검증에서 거부되는 입력은 왕복이 0이다.** V-02(기초자산 0건)를 실측했다. 계약 계층 검증의 값이 "필드별 오류 표시"만이 아니라는 뜻이다 — 잘못된 입력이 DB에 닿지 않는다.

### 5.1 상품 생성 — SCR-204

```ts
function createProduct(input: ProductInput): Promise<ActionResult<{ id: string }>>

type ProductInput = {
  name: string
  issuer?: string
  issueDate: string
  currency: ProductCurrency             // v4.9 (P8 컷 a2) — 상품 통화. 필수, 기본값 없음 (V-22)
  principal: string                     // 상품 통화 금액 — V-01′ · V-23
  evaluationPeriodMonths: number
  totalRounds: number
  annualCouponRate: string              // v4.16 — 월지급식이면 '0' (V-08′)
  couponPayout: CouponPayout            // v4.16 (P8 컷 b1 명세 · 구현 b2) — 쿠폰 지급방식. 필수, 기본값 없음 (V-25)
  monthlyCouponAnnualRate?: string      // v4.16 — 월수익 연쿠폰율(비율 문자열). MONTHLY면 필수, AT_REDEMPTION이면 없다 (V-25)
  couponSchedules?: Array<{             // v4.16 — 월수익 일정. MONTHLY면 1..60행 (V-25 · V-26), AT_REDEMPTION이면 없다
    couponNo: number
    evaluationDate: string
    paymentDate: string
    couponBarrier: string
  }>
  kiBarrier?: string
  kiObservation?: 'CONTINUOUS' | 'CLOSING'
  accountType: 'GENERAL' | 'TAX_FREE'
  note?: string
  underlyings: Array<{
    assetId: string
    basePrice: string
    sequence: number
  }>
  schedules: Array<{
    roundNo: number
    evaluationDate: string
    barrier: string
    lizardBarrier?: string
    lizardCouponRate?: string
    lizardRequiresNoKi?: boolean
  }>
}
```

**동작**

- `owner_id`는 **인증 사용자로 서버에서 설정**한다. 입력값으로 받지 않는다
- 상품·기초자산·평가일정을 단일 트랜잭션으로 생성한다 — **쓰기 함수 `create_els_product(payload jsonb)`를 경유한다**(v0.9). 아래 참조
- 배리어 일괄 입력(`90-85-80-…`)의 파싱은 클라이언트에서 수행하며, 계약은 배열만 받는다
- **평가일은 칸의 값이다**(v4.2). 빈 칸을 산식(`발행일 + n × 평가주기 − 1일`)으로 채우는 것은 입력 계층(SCR-204 폼)의 일이며, 계약은 `schedules[].evaluationDate`를 받은 그대로 V-07로 검사한다 — 산식에서 왔는지 사용자·불러온 값에서 왔는지 계약은 모른다(DOC-002 §4.8 v1.6)
- **상품 통화는 입력이며 기본값이 없다** (v4.9 선행 명세 — P8 컷 a1, 구현 a2). `currency`가 없거나 `KRW`·`USD` 밖이면 V-22로 거부한다. 원화로 채우지 않는 이유 — `$10,000` 상품이 `10,000원`으로 저장되면 모든 금액이 약 1,400배 틀리는데 **형식은 정상**이라 어느 검증에도 걸리지 않는다(DOC-001 U7 — 직접 입력은 빈칸에서 시작한다). `principal`은 그 통화의 보조단위 자릿수로 검사하고(V-23) **V-23을 지난 뒤** `moneyString`으로 정규화해 싣는다 — 값은 바뀌지 않는다(접을 자릿수가 이미 없다). **순서를 뒤집으면 안 된다** — 정규화가 먼저면 `10000.555`가 `10000.56`으로 조용히 접혀 V-23이 볼 것이 사라진다(AQ-16과 같은 부류)
- **쓰기 함수가 `payload->>'currency'`를 읽는다** (컷 a2 — M-a2). **확장 웨이브(W1) 동안만** `coalesce(payload->>'currency', 'KRW')`로 받는다 — `db push`와 배포 사이에 통화를 보내지 않는 **구 코드**가 돌기 때문이다(열의 `default 'KRW'`도 같은 이유로 그 웨이브에만 있다). 새 코드는 V-22 때문에 언제나 보낸다. **축소 마이그레이션(M-a2c — 컷 a3, W2)이 열 기본값과 `coalesce`를 함께 뗀다.** 그 뒤로 통화 없는 payload는 `23502` → `VALIDATION_FAILED` + `fields.currency`다(§3.2.1 — `NOT_NULL_FIELD`의 `currency` 키는 이미 있다). **그 거부를 영구 단언으로 둔다**(반박 검토 SB-12) — 이 함수를 이후 다시 `create or replace`하는 컷(b2 · b4의 M-b2c — DOC-002 §4.6)이 축소 이전 본문에서 출발하면 `coalesce`가 조용히 돌아오고, 그 회귀는 값이 옳아 보이는 원화 상품을 만든다
- **쿠폰 지급방식은 입력이며 기본값이 없다** (v4.16 선행 명세 — P8 컷 b1, 구현 b2). `couponPayout`이 없거나 `AT_REDEMPTION`·`MONTHLY` 밖이면 V-25로 거부한다 — 빈칸은 그 칸의 오류이고 V-22(상품 통화)와 같은 형태다(DOC-001 U7). 상환 시 지급으로 채우지 않는 이유는 통화와 같다 — 월지급 상품이 상환 시 지급으로 저장되면 월수익이 통째로 사라지는데 **형식은 정상**이다. **그 값을 싣는 칸이 같은 b2 코드 커밋에 선다** *(b1 개정 — 반박 검토 반영)* — SCR-204 평가 조건 구획 맨 위와 SCR-205의 「쿠폰 지급」 선택 상자(선택지 「선택」 · 「상환 시 지급」)와 수정 폼의 초기값 §4.3 `product.couponPayout`이다. V-25만 먼저 서면 b2(W4)~b3(W5) 동안 폼의 모든 저장이 칸 없는 오류로 거부된다(§4.0 컷별 도달 — 통화 a2-3a 선례). 칸을 숨겨 `AT_REDEMPTION`을 몰래 실으면 그것이 곧 기본값이다(DOC-001 U7)
- **월지급식의 계약 조건** (v4.16, V-25 · V-08′ · V-26). `MONTHLY`이면 `annualCouponRate = '0'`(DOC-002 DQ-11 — 수익은 전부 월수익 연쿠폰율에서 나온다. 0이 아니면 연 24.24%가 상환 시 일괄 쿠폰으로도 읽혀 **이중 계상**된다) · `monthlyCouponAnnualRate > 0`(상한은 연쿠폰율과 같은 V-08의 `x ≤ 2` — b1 개정) · `couponSchedules` 1..60행 · 리자드 차수 없음(월지급+리자드는 v2). `AT_REDEMPTION`이면 `monthlyCouponAnnualRate`·`couponSchedules`가 없다. **월수익 평가일 · 지급일은 칸의 값이다** — 산식(평가일 = 발행일 + k개월 − 1일, 지급일 = 평가일 + 3영업일 — 주말만 건너뛴다)으로 채우는 것은 입력 계층(SCR-204 폼)의 일이고 계약은 받은 그대로 V-26으로 검사한다(위 「평가일은 칸의 값이다」(v4.2)와 같다). 지급일 기본값의 「+3영업일」은 투자설명서 원문이다(EM2048 — §9 X-08)
- **쓰기 함수가 지급방식 · 월수익 연쿠폰율 · 월수익 일정을 함께 싣는다** (v4.16 — 구현 b2, M-b2). 상품 · 기초자산 · 조기상환 일정 · **월수익 일정**이 한 트랜잭션이다. 함수 꼬리 검사 셋이 I-25를 DB 층에서 한 번 더 막는다 — `els_products_monthly_schedules_required`(`FULL ∧ MONTHLY`인데 일정 0행) · `els_products_monthly_schedules_forbidden`(`AT_REDEMPTION`인데 일정 행) · `els_products_monthly_lizard_forbidden`(`MONTHLY`인데 리자드 — §3.2.1). **확장 웨이브(W4) 동안만** `coalesce(payload->>'coupon_payout', 'AT_REDEMPTION')`로 받는다 — `db push`와 배포 사이에 지급방식을 보내지 않는 구 코드가 돈다(열의 `default 'AT_REDEMPTION'` 백필도 그 웨이브에만 있다). **축소(M-b2c — 컷 b4, W6)가 기본값과 `coalesce`를 함께 뗀다** — 그 뒤로 지급방식 없는 payload는 `23502` → `VALIDATION_FAILED` + `fields.couponPayout`이다(§3.2.1 — `NOT_NULL_FIELD`에 새 키). **그 거부도 영구 단언으로 둔다** — 위 통화의 SB-12와 같은 이유이고, 이 함수를 b2와 b4가 두 번 `create or replace`하므로 그 회귀 경로가 둘이다
- **계약은 b2부터 `MONTHLY`를 받는다 — 폼은 b4까지 「월지급식」을 고를 수 없다** (v4.16 — SB-13). 통합 테스트와 dev 표본이 월지급 상품을 계약으로 만들어야 b2·b3가 검증된다. 운영 사용자가 그 상품을 만드는 경로(SCR-204의 선택지)는 세금·전망이 월수익 사건을 아는 컷(b4)에 함께 열린다 — 먼저 열면 F가 월수익 없이 계산되는 상품이 운영에 생긴다(§4.0 「쿠폰 지급방식과 월수익」 컷별 도달). 그 전의 폼이 저장값 `MONTHLY`인 상품을 열면 선택지에 그 값을 더한다(`currencyOptionsOf` 선례 — b1 개정, DOC-008 SCR-204) — 더하지 않으면 수정 화면이 「선택」으로 떨어져 저장이 V-25 오류이거나 지급방식이 뒤집힌다

**권한:** 인증 사용자 누구나 (본인 소유로 생성)

> **"단일 트랜잭션"의 수단을 확정한다 (v0.9, U-03).** v0.8까지 이 줄은 수단을 정하지 않았고, 그 상태로 구현하면 **요청 3개 = 트랜잭션 3개**가 된다. PostgREST는 요청당 하나의 트랜잭션을 열고 닫으며 임베드된 관계에 쓰기를 지원하지 않으므로, `els_products` → `els_underlyings` → `redemption_schedules`가 각각 독립적으로 확정된다.
>
> 그 결과가 이 명세의 다른 문장을 깨뜨린다. 두 번째 요청이 실패하면(예: 같은 자산 중복으로 `23505`) **기초자산 0건인 상품이 남고**, 그것은 §5.3이 "계약을 경유하는 어떤 조작도 만들 수 없다"고 단언한 바로 그 상태다. 보상 삭제로 대부분 되돌릴 수 있으나 보상 자체가 실행되지 못하는 경우(타임아웃·프로세스 종료)가 남고, `updateProduct`는 **하위 행을 지운 뒤 죽으면 되돌릴 원본이 없다.**
>
> **함수를 쓰는 이유는 원자성 하나가 아니다.** ① `owner_id`를 함수가 `auth.uid()`로 박으므로 "입력값으로 받지 않는다"가 규율이 아니라 구조가 된다. ② 함수 말미에서 하위 행 수를 검사하면 **I-07이 DB 층 방어를 처음 갖는다** — DOC-002 §8이 I-07을 애플리케이션 검증으로 분류하고 DOC-010 AQ-14가 "예방이 한 층뿐"으로 남긴 항목이 여기서 두 층이 된다.
>
> **함수는 새로운 fail-open 축이다.** `EXECUTE`는 기본으로 `PUBLIC`에 부여되므로 회수 후 `authenticated`에만 명시 부여한다 — 뷰의 `security_invoker`(AQ-20)·신규 테이블의 TRUNCATE(§7.1)와 같은 부류이며, 카탈로그 테스트가 함수 축을 열거하지 않으면 어떤 단언도 이를 잡지 못한다. `SECURITY INVOKER`(기본값)를 유지하므로 함수 안의 INSERT에도 RLS가 그대로 적용된다 — `SECURITY DEFINER`로 쓰면 정책 ~~37개(v4.8 정정 — 종전 「32개」)~~ 전부(현재 40 — Q-01, v4.12. 컷 b2 뒤 48)를 우회하는 쓰기 경로가 생긴다 *(v4.16 — 이 수는 v4.12에서 낡았다. a3가 Q-01만 고쳤다)*. DOC-010 §7·AQ-28.

### 5.2 상품 수정 — SCR-204

```ts
function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult<{ id: string }>>
```

**권한:** 소유자
**동작:** 쓰기 함수 `update_els_product(p_id uuid, payload jsonb)`를 경유한다 — 상품 열 갱신과 하위 배열 **전체 교체**(삭제 + 삽입)가 한 트랜잭션 안에서 일어난다(v0.9. 근거는 §5.1 각주). *(v4.16 — P8 컷 b1 명세 · 구현 b2)* **전체 교체는 기초자산과 조기상환 일정의 규칙이다 — 월수익 일정은 아니다.** 월수익 일정은 **입력에 없는 순번의 행을 삭제하고 입력의 행은 `coupon_no` 기준 upsert**한다(DOC-002 DQ-14 — 아래 「월수익 일정은 전체 교체가 아니다」. b1 개정 — 종전 「기록 없는 달만 삭제」는 입력에서 빠진 기록된 달을 조용히 남겼다).
**제약**
- 상환 완료 상품은 수정 불가 → `CONFLICT`. 계약이 사전 조회로 판정하고, 함수도 `els_products_redeemed_immutable`로 거부한다 — 사전 조회와 변경 사이의 창을 막는 두 번째 겹이다(W-05)
- `kiBarrier`·`kiObservation`은 함께 설정하거나 함께 비운다(V-16, I-11). **낙인형을 해제하면 `kiTouchedAt`도 함께 비워야 한다**(V-18, I-15) — 셋 중 일부만 비우는 입력은 DB가 `23514`로 거부한다
- 하위 배열 교체가 V-02·V-03을 만족해야 한다. 기초자산·차수를 0건으로 줄이는 수정은 거부된다 (I-07) — v0.9부터 계약 계층과 **함수 말미 검사** 두 층이 이를 막는다
- **상품 통화를 바꿀 수 있다 — 미상환 상품에서** (v4.9 선행 명세 — P8 컷 a1, 구현 a2). 상환 완료 상품은 위 첫 제약이 이미 막으므로 상환 금액의 scale(DOC-002 I-21 — 부모 통화를 읽는 트리거)이 뒤늦게 어긋날 경로가 계약에는 없다(직접 UPDATE 우회는 DOC-010 AQ-79). `principal`은 **새** 통화로 V-23을 다시 지난다. 계약은 두 필드의 **뜻의 짝**(통화를 원화에서 달러로 바꿨는데 원금 `10000000`을 그대로 두었는가)을 판정할 수 없다 — 형식은 둘 다 정상이다. 그 짝은 입력 계층이 지킨다: 불러오기는 X-07(컷 a4)이, 직접 수정은 SCR-204가(DOC-008). **V-22에 기본값이 없는 것이 수정 경로의 방어이기도 하다** — 수정 폼의 초기값(`productValuesOf`)이 통화를 빠뜨리면 원화로 조용히 뒤집히지 않고 V-22가 거부한다. 쓰기 함수는 확장 웨이브 동안 `coalesce(payload->>'currency', 저장값)`으로 받는다(§5.1과 같은 이유). ~~월수익 기록이 있는 상품의 통화 동결은 컷 b1의 명세다~~ → 아래 항목 *(v4.16)*
- **월수익 지급 기록이 있는 상품은 상품 통화 · 쿠폰 지급방식을 바꿀 수 없다 → `CONFLICT`** (v4.16 선행 명세 — P8 컷 b1, 구현 b2. DOC-002 DQ-14 · 민서 결정(2026-10-02) ④). DB 트리거 `els_products_coupon_recorded_immutable`이 **어떤 쓰기 경로든** 막는다(§3.2.1 — 상태 충돌. 단일 요청 순서에서 — 동시 트랜잭션의 write skew는 DOC-010 AQ-93). 통화가 바뀌면 기록의 세전(상품 통화)과 자릿수 규칙(I-26)이 뒤늦게 다른 통화로 읽히고, 지급방식이 상환 시 지급으로 바뀌면 월수익 지급 기록이 F와 「받은 월수익」에서 통째로 사라진다. **원금 · 월수익 연쿠폰율 · 월수익 배리어는 고칠 수 있다** — 기록은 거래내역의 값이고 계약 조건으로 재계산되지 않는다(A-04)
- **기록된 달의 월수익 일정은 바꿀 수도 지울 수도 없다 → `CONFLICT`** (v4.16). **계약이 사전 조회로 먼저 본다** *(b1 개정 — 반박 검토 반영)*: 그 상품의 기록된 순번 집합이 입력의 순번 집합에 포함되지 않으면(기록된 달이 입력에서 빠졌다 — 총 차수를 줄였거나 행을 지웠다) `CONFLICT`이고 문구는 그 달을 가리킨다(「기록된 달은 지울 수 없다 — 5번째 · 2027-02-16」 — 민서 결정(2026-10-02) ①의 표시). 기록된 순번은 위 첫 제약(상환 완료)을 판정하는 사전 조회에서 함께 읽는다 — 왕복은 b2가 잰다(§5.0.1). 그 창을 지난 경합은 DB가 막는다 — 평가일 · 지급일 · 순번을 바꾸면 `monthly_coupon_schedules_recorded_immutable`, 입력에 없는 기록된 달을 지우려 하면 복합 FK `RESTRICT`(`23503` — 마지막 그물)다(§3.2.1). 그 달의 기록을 먼저 지우면(§5.15) 고치거나 지울 수 있다. 수정 화면은 기록된 달을 `readOnly`로 그린다(DOC-008 SCR-204)
- **지급방식 · 월수익 조건의 짝은 생성과 같다** — V-25 · V-26과 함수 꼬리 검사 셋(§5.1). `couponPayout`은 확장 웨이브 동안 `coalesce(payload->>'coupon_payout', 저장값)`으로 받는다(통화와 같은 이유 — 구 코드가 보내지 않는다). 새 코드의 수정 폼은 §4.3 `product.couponPayout`(b2 — b1 개정)으로 저장값을 싣는다

> **함수의 반환 `null`은 "영향 행 0"이다 (v0.9).** 대상이 없거나 RLS의 `USING`이 감춘 경우이며, 둘을 함수가 구분하지 않는다 — 구분할 문맥은 계약 계층의 사전 조회에 있다(W-05). 함수가 `42501`을 던지게 만들면 **없는 상품도 권한 오류**가 되어 `NOT_FOUND`를 만들 수 없다.
>
> **생성 타입은 이 `null`을 말하지 않는다.** `supabase gen types`가 `update_els_product`의 `Returns`를 `string`으로 선언하므로(실측) 계약 계층은 `string | null`로 복원해서 받는다 — `::text` 캐스팅이 널 허용을 잃는 것과 같은 부류이며(§4.0 Q-08 실측), 복원하지 않으면 "0행"이 성공으로 읽힌다.

> **전체 교체가 평가일을 보존한다 — 폼이 저장값을 싣기 때문이다 (v4.2).** 평가일이 차수별 입력값이 되면서(DOC-002 §4.8 v1.6) 「교체가 조정한 날짜를 되돌린다」는 v0.7의 우려가 다시 물을 자리가 생겼다. 답은 계약 쪽 예외가 아니라 입력 쪽이다 — SCR-204 수정 모드의 초기값(`productValuesOf`)이 저장된 날짜를 싣고, 교체는 그 값을 다시 넣는다. 종전 근거(「재생성이 멱등」, DOC-002 v0.9)는 산식이 정본이던 동안만 참이었다.

> **전체 교체가 원자적이어야 하는 이유는 `createProduct`보다 강하다.** 생성은 실패해도 "만들어지지 않은 상품"이 남을 뿐이고 보상 삭제로 지울 수 있다. 교체는 **기존 행을 지운 상태**를 경유하므로, 그 사이에 끊기면 0건 상태가 남고 원본은 이미 없다. 되돌리려면 계약이 삭제 전 행을 들고 있다가 다시 넣어야 하는데, 그 재삽입이 또 실패할 수 있으므로 규율의 층을 늘리는 것으로는 닫히지 않는다.

> **월수익 일정은 전체 교체가 아니다 (v4.16 선행 명세 — P8 컷 b1, 구현 b2. DOC-002 DQ-14).** 전체 교체로는 **기록이 하나라도 있는 월지급 상품을 수정할 수 없다** — 기록된 달의 행을 지우면 복합 FK `RESTRICT`(`monthly_coupon_payments(els_id, coupon_no)` → 일정)에 걸리고, 지우지 않고 다시 넣으면 `UNIQUE(els_id, coupon_no)`에 걸린다. 그래서 쓰기 함수는 **입력에 없는 순번의 행을 지우고, 입력의 행은 `coupon_no` 기준으로 upsert**한다 *(b1 개정 — 반박 검토 반영)* — 기록된 달은 upsert가 같은 평가일 · 지급일 · 순번을 다시 대입하므로 동결 트리거(값이 바뀔 때만 거부 — §3.2.1)를 지나고 월수익 배리어만 바뀐다. 입력이 기록된 달의 날짜 · 순번을 바꾸면 `CONFLICT`다(위 제약). **기록된 달이 입력에서 빠지면 계약의 사전 검사가 `CONFLICT`로 막고, 그 창을 지나면 그 행의 삭제가 복합 FK에 걸린다**(`23503` → `CONFLICT` — 위 제약). 종전 문언(「기록 없는 달만 지운다」)은 그 행을 지우려 하지 않으므로 23503도 나지 않고 **저장이 성공하며 그 행이 조용히 남았다** — 총 차수를 줄이면 저장된 일정이 `1..K′`에 남은 기록된 달이 붙은 불연속이 되고, V-26은 입력만 보며 DB는 연속을 보지 않으므로(I-24) 어느 겹도 그것을 거부하지 않는다. **V-26은 입력에 적용한다 — 입력이 곧 저장 결과다**(입력에 없는 순번은 남지 않는다). 그래서 「월수익 횟수의 정본은 행 수」(DOC-002 §4.13)와 §4.2 `couponProgress.total`이 입력의 K를 읽는다. 원자성은 같다 — 함수 하나가 한 트랜잭션이다. 위 「전체 교체가 평가일을 보존한다」(v4.2)의 논거(폼이 저장값을 싣는다)는 월수익 일정에도 그대로 성립한다.

### 5.3 상품 삭제 — SCR-202

```ts
function deleteProduct(id: string): Promise<ActionResult<void>>
```

**권한:** 소유자
**동작:** 기초자산·평가일정을 함께 삭제한다(FK `CASCADE`). *(v4.16)* 월수익 일정도 `CASCADE`다(DOC-002 §4.13 — 상세 테이블).
**제약**
- **상환 완료 상품은 삭제할 수 없다** → `CONFLICT`. `redemptions.els_id`의 FK가 `RESTRICT`이므로 DB가 거부한다(DOC-002 §8.1, I-01)
- **월수익 지급 기록이 있는 상품은 삭제할 수 없다** → `CONFLICT` *(v4.16 선행 명세 — P8 컷 b1, 구현 b2)*. `monthly_coupon_payments.els_id`의 FK가 `RESTRICT`다(`23503` — DOC-002 §4.14. 기록은 상환과 같은 트랜잭션 테이블이다 — 과세 이력이라 지우는 경로가 좁다). 미지급(`UNPAID`) 기록만 있어도 같다
- **~~하위 행을 개별 삭제하는 계약은 존재하지 않는다.~~ 기초자산·평가일정을 개별 삭제하는 계약은 존재하지 않는다** *(v4.16 — 범위를 I-07의 대상으로 좁혔다. 월수익 지급 기록은 §5.15 `deleteCouponPayments`가 행 단위로 지운다 — 일정이 아니라 과세 이력이고, 지우는 경로가 있어야 상품을 지울 수 있다)*. 기초자산·평가일정을 줄이는 유일한 경로는 §5.2 `updateProduct`의 전체 교체이며 그 입력은 V-02·V-03이 검증한다. 결과적으로 계약을 경유하는 어떤 조작도 기초자산 0건·차수 0건 상태를 만들 수 없다 (I-07)

> **상환을 먼저 취소해야 하는 이유.** 상환 실적은 증권사가 확정한 외부 값이고 시스템이 유도할 수 없다(A-04). 상품 삭제가 상환까지 연쇄 삭제하면 조작 한 번으로 실현된 과세 이력이 사라지고, 해당 귀속연도의 금융소득 합계와 세액이 **아무 경고 없이** 바뀐다. `deleteRedemption`(§5.5) → `deleteProduct`의 2단계로 두면 사용자가 과세 이력을 지운다는 사실을 명시적으로 확인한다. DQ-01(소프트 삭제)을 도입하지 않기로 한 결정의 짝이다. *(v4.16)* **월지급 상품은 최대 3단계다** — 월수익 기록 전부 지우기(§5.15 `deleteCouponPayments`) → 상환 취소(§5.5) → 상품 삭제. 월수익 지급 기록도 과세 이력이므로 같은 근거로 연쇄 삭제하지 않는다(DOC-002 DQ-14).

> **I-07은 생성 시점 규칙이 아니다.** DOC-002 v0.4가 I-07의 적용 범위를 모든 변경 경로로 넓혔다. `createProduct`만 검증하면 등록 직후에 하위 행을 지워 0건에 도달할 수 있다. `deleteUnderlying` 같은 계약을 만들지 않는 것 자체가 이 방어의 형태다 — 하위 행은 항상 상품 단위로 통째로 교체된다.
>
> **v0.5의 "상품 상세(SCR-202)가 렌더링되지 않는다"는 서술을 철회한다(v0.6, U-03).** 그 문장은 렌더링 실패를 수용된 결과로 적었으나, §8 추적 매트릭스에서 **SCR-204(수정)도 `getProduct`를 쓴다**는 사실을 놓쳤다. 상세와 수정이 함께 막히면 0건 상태를 UI로 고칠 방법이 남지 않아 수동 SQL 외에는 복구 경로가 없다. 조회 계약은 §4.2의 `integrityIssue`로 이 상태를 표시하며 렌더링을 유지한다 — 방어를 포기한 것이 아니라, 결함을 **고칠 수 있는 형태로** 드러낸다.
>
> **DB 층 방어가 절반 생겼다 (v0.9).** v0.8까지는 "방어가 계약 한 층뿐"이었다. 쓰기 함수(§5.1·§5.2)가 말미에 하위 행 수를 검사하므로 **계약을 경유하는 경로에는 두 층이 생긴다.** 그러나 RLS는 여전히 소유자의 행 단위 DELETE를 허용하므로(DOC-010 AQ-14) 마이그레이션·수동 SQL·`supabase-js` 직접 호출로는 0건 상태를 만들 수 있다 — **계약 밖 경로의 예방은 아직 없고, 탐지와 복구만 있다**(§4.2 `integrityIssue`). AQ-14는 부분 해소이며 완전 해소는 행 단위 DELETE 권한을 계약 범위로 좁힐 때다.

### 5.4 상환 처리 — SCR-203

```ts
function createRedemption(
  productId: string,
  input: RedemptionInput
): Promise<ActionResult<{ id: string }>>

type RedemptionInput = {
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  roundNo?: number
  redemptionDate: string
  grossAmount: string                   // 상품 통화 금액 — V-23 (v4.9)
  taxableIncome: string                 // 원화 — 상품 통화와 무관하다 (V-11)
  withholdingTax?: string               // 원화 — 같음
  exchangeRate?: string                 // v4.9 (P8 컷 a2) — 적용 환율(참고). V-24. 계산에 쓰지 않는다
  isConfirmed: boolean
  note?: string
}
```

**동작**

- 단일 트랜잭션으로 `redemptions` 1건 생성. 원본 삭제·이관 없음 (K-03) — 행이 하나이므로 **요청 하나로 원자적이며 쓰기 함수가 필요하지 않다**
- `withholdingTax` 미입력 시 `taxableIncome × 분리과세율`로 산출
- 상태는 레코드 존재로 유도되므로 별도 갱신 없음 (D-01)

**권한:** 소유자
**제약:** 이미 상환된 상품 → `CONFLICT` (`UNIQUE(els_id)`, I-01)

> **원천징수액 산출의 세부 (v0.9).** 세 가지가 정해져 있지 않았다.
>
> | 항목 | 확정 |
> |---|---|
> | 어느 상수인가 | `separate_taxation_rate`(15.4%)다. `separate_taxation_income_tax_rate`(14%)가 아니다 — 원천징수액은 이미 지방소득세를 포함한 실제 징수액이다(DOC-007 §2·§5.5) |
> | 어느 연도의 상수인가 | **`year(redemptionDate)`의 상수다.** 기준일의 연도가 아니다 — 상환의 귀속연도는 상환일이 결정하며(DOC-007 §7.2), 12월 상환을 1월에 입력하면 두 값이 갈린다 |
> | 어떻게 접는가 | 원 단위 절사(DOC-007 §2 "세액·보험료 최종값", RD-01의 기본값). `gross_amount`·`withholding_tax`가 `numeric(15,0)`이므로 접지 않으면 DB가 반올림한다 — **접는 규칙을 DB에 맡기면 절사가 조용히 반올림이 된다**(AQ-16과 같은 부류) |
>
> 이 값은 **사용자가 덮어쓸 수 있는 기본값**이다. 증권사가 확정한 실제 징수액이 있으면 그것이 정본이며(A-04) 계약은 입력값을 그대로 저장한다. 산출은 미입력 시에만 일어난다.
>
> **코드가 한 컷 앞섰다 (P8 컷 b0, `d675efb` — v4.16에서 기록).** 이 산출은 `withholdingFor(ctx, { date, taxableIncome, withholdingTax? }, dateField)` + `withholdingInputOf`(상환 입력 → 그 셋)로 일반화되었다 — 종전에는 `RedemptionInput.redemptionDate`를 직접 읽어 상환에 묶여 있었다. 날짜 칸은 `WithholdingDateField = 'redemptionDate'` 하나이고, 칸마다 **귀속 규칙**과 **형식 오류 문구**를 표 둘(`Record<WithholdingDateField, …>`)이 정의하므로 칸을 더하면 두 표가 함께 컴파일을 요구한다. §5.5 · §5.11이 같은 함수를 지난다. **동작 불변**이다. §5.14가 `'paymentDate'`를 더한다(귀속 = 월수익 지급일의 연도).

> **시드보다 과거 연도의 상환은 산출할 수 없다 (v1.1).** 산출이 `year(redemptionDate)`의 상수를 요구하는데 조회 계층은 시드보다 과거 연도를 **거부한다** — 뒤 연도의 법으로 과거를 계산하면 재현성이 깨진다(ADR-005). **정상 경로는 막히지 않는다** — 실제 징수액이 정본이므로 값을 적어 넣으면 그대로 저장되고 세율 조회 자체가 일어나지 않는다.
>
> **그때의 코드는 `VALIDATION_FAILED` + `fields.withholdingTax`다 (v1.7, P4 컷 6).** v1.1은 「원인이 `withholdingTax`가 비어 있는 것인지 `redemptionDate`가 시드 범위 밖인 것인지 갈린다」며 화면이 서는 시점으로 판단을 미뤘다. 화면(SCR-203)이 서고 보니 **두 후보가 대칭이 아니다.**
>
> | 가리킬 칸 | 사용자에게 하는 말 | 왜 아닌가/맞는가 |
> |---|---|---|
> | `redemptionDate` | "그 해는 지원하지 않는다" | 사용자가 **가진 사실**(증권사가 확정한 상환일)을 부정한다. 안내를 따르면 상환 기록 자체를 포기하게 되고, 그것은 §5.4가 「결함 상품에도 상환을 기록할 수 있다」로 지킨 원칙을 뒤집는다 |
> | `withholdingTax` | "자동 산출할 수 없다 — 실제 징수액을 적는다" | A-04가 실제 징수액을 **정본**으로 정했으므로 이 칸이 1차 입력이고 산출은 편의다. 사용자가 지급명세서를 보고 고칠 수 있다 |
>
> **V-id를 부여하지 않는다.** §6의 규칙은 입력의 **형태**에 대한 것이고 이 조건은 시드 상태에 달렸다 — V-id를 주면 「입력만 보고 판정할 수 있다」는 거짓을 문서에 새긴다.
>
> **예외 두 종을 타입으로 가른다.** `loadTaxYearContext`는 두 가지를 던진다: ① 그 연도가 시드 범위보다 과거 ② 시드가 **아예 없다**(마이그레이션 미적용). ②를 같이 내려 보내면 진짜 장애가 「징수액을 입력하라」로 보고되고 사용자는 몇 번을 입력해도 같은 오류를 본다 — §3.2가 `INTERNAL`을 「사용자가 고칠 수 없는 것」으로 정의한 이유다. 그래서 ①에만 전용 오류 타입(`TaxSeedRangeError`)을 두고 계약이 그것만 `VALIDATION_FAILED`로 옮긴다. **조회 계약은 둘 다 그대로 던진다** — 세금 화면이 「입력하라」고 말할 칸이 없고, ADR-005의 재현성은 조회에서 타협되지 않는다.

> **결함 상품에도 상환을 기록할 수 있다 (v0.9).** `integrityIssue`가 있는 상품의 상환을 막지 않는다 — 상환 실적은 증권사가 확정한 외부 사실이고(A-04) 결함은 우리 쪽 데이터의 문제이므로, 사실의 기록을 우리 결함이 막으면 과세 이력이 누락된다. 단 `EARLY`·`LIZARD`는 `round_no`가 실재해야 하므로(I-13) `SCHEDULE_MISSING` 상품에서는 DB가 `23503`으로 거부하며 `CONFLICT`가 된다 — 그때 사용자가 할 일은 상환을 포기하는 것이 아니라 **일정을 먼저 복구하는 것**이고, 그 경로가 §4.2·SCR-204로 열려 있다.

> **달러 상품의 상환 (v4.9 선행 명세 — P8 컷 a1, 구현 a2).**
>
> **통화는 입력이 아니라 부모 상품에서 온다.** `grossAmount`는 **그 상품의** `currency`로 V-23을 지난다. 계약이 이미 하는 사전 조회(§5.0.1 — `els_products` ×1)의 select에 `currency`를 더하므로 **왕복이 늘지 않는다.** DB 쪽 두 번째 겹은 둘이다 — 통화와 무관한 정수부 15자리 · 소수 2자리 이하는 `CHECK` `redemptions_gross_amount_digits_check`가, 부모 통화에 따라 갈리는 부분(원화 부모 ⇒ 소수 0자리)은 부모 통화를 읽는 트리거 `check_amount_scale_by_currency()`가 보고 라벨은 `redemptions_gross_amount_scale`이다(DOC-002 I-21 · §3.2.1).
>
> **과세 두 값은 원화 그대로다.** `taxableIncome`·`withholdingTax`는 달러 상품에서도 거래내역의 **원화** 값이다(DOC-001 A-04 · U1). 그래서 **원천징수 기본값(위 「원천징수액 산출의 세부」)이 그대로 유효하다** — 원화 과세 금융소득 × 분리과세율을 원 단위로 절사한다. 실제 원천징수와의 차(소득세·지방소득세 각 10원 미만 절사 — 최대 19원, DOC-007 §4.5 각주)는 원화 상품과 같은 DOC-007 RD-01의 몫이다.
>
> **`exchangeRate`는 참고값이다.** 거래내역에 적힌 지급일 환율을 옮겨 둘 뿐이고, 과세 금융소득·원천징수세액을 이 값으로 **산출하지 않으며** 추정 환율의 원천도 아니다(DOC-007 RD-09 — 추정 환율은 `exchange_rates`에서만 나온다). 원화 상품에 실으면 V-24가 거부한다 — 저장되지 않을 값을 조용히 버리지 않는다.
>
> **SCR-203은 달러 상품의 과세 금융소득 칸을 미리 채우지 않는다** (입력 계층 — DOC-008 SCR-203). 원화 상품은 `세전 − 원금`을 미리 채우는데 달러 상품에서 같은 뺄셈은 **달러 수**다 — 원화 칸에 들어가면 약 1/1,400인 과세소득이 V-11(0 이상)을 지나 저장된다. 형식이 정상이므로 계약은 그 값을 가릴 수 없고, 막을 수 있는 층은 채우지 않는 입력 계층뿐이다. 칸을 비워 두고 거래내역의 원화 값을 옮기게 한다.
>
> **§5.5 `updateRedemption`도 같은 입력이다** — 통화는 참조 조회(`redemptions` → `els_products`)의 부모에서 오고 왕복은 그대로다.

> **월지급 상품의 상환 (v4.16 선행 명세 — P8 컷 b1. 구현 — V-29는 b4 · DB 겹 둘과 상환일 쪽 사전 검사(V-27)는 b2).**
>
> **상환은 원금만이다 — V-29.** 월지급식 상품의 상환은 `grossAmount ≤ principal` **이고** `taxableIncome = 0`이다. 수익은 전부 월수익이고(연쿠폰율 0 — V-08′) 조기상환·만기의 상환금액은 원금을 넘지 않는다(DOC-005 「월지급식」). **같은 날 나오는 그 달 월수익은 상환에 합치지 않고 §5.14로 따로 적는다**(DOC-001 U6 — 거래내역도 둘을 따로 적는다). 합치면 그 달 월수익이 월수익 사건이 아니라 상환으로 셈해진다 — 받은 달 수(「지급 n/K」)와 월수익 지급 기록이 그 달을 모르고, 무기록 달로 남은 그 달이 추정에 한 번 더 든다. 검산 B-3: 1차 조기상환 세전 100,600,000(투자원금 + 6번째 달 월수익)은 V-29가 거부한다 · B-2: 36번째 달 월수익을 만기 손실 상환 행에 합친 입력도 거부한다.
>
> **부모의 지급방식은 사전 조회에서 온다.** 계약이 이미 하는 사전 조회(§5.0.1 — `els_products` ×1)의 select에 `coupon_payout`을 더하므로 **왕복이 늘지 않는다** — 통화(v4.9)와 같은 자리다. 원천징수 기본값은 과세 0이므로 0이다(위 산출 그대로).
>
> **DB 겹이 둘이고 b2에 먼저 선다**(§3.2.1 — DOC-010 AQ-87 ⓑ의 DB 쪽 강제). `redemptions_monthly_principal_only`가 V-29를, `redemptions_before_coupon_payment`가 DOC-002 DQ-07 ②의 반대쪽 — **상환일이 기록된 달(`PAID` · `UNPAID`)들의 월수익 평가일 최댓값보다 앞서면** 거부한다(`VALIDATION_FAILED` · `redemptionDate`). 비교 키는 지급일이 아니라 **월수익 평가일**이다(b1 개정 — 흐름 끝과 같은 키, DOC-007 RD-18 해결). 앞쪽(기록이 상환 뒤로 가는 것)은 V-27과 `monthly_coupon_payments_after_redemption`이 막는다. **두 쪽이 같은 집합(지급 · 미지급 모든 기록)을 본다** *(b1 개정 — 반박 검토 반영)* — 상환 쪽만 `PAID`를 보면 흐름 끝 뒤에 미지급 기록이 남고, 그 기록은 기록 쪽 검사 때문에 고칠 수 없다(§3.2.1). 계약 계층 V-29는 b4이므로 b2~b4 사이 V-29 입력의 응답은 DB 사상이다(필드는 같다).
>
> **상환일 쪽 사전 검사 — V-27의 양방향 문언이다** *(b1 개정 — §9 ⑨ 해결)* *(V-27 — 구현 b2. 이 블록 머리의 b4는 V-29의 몫이다 — 반박 검토 반영)*. §5.4 · §5.5 · §5.11은 사전 조회로 **「상환일 ≥ 기록된 달(`PAID` · `UNPAID`)들의 월수익 평가일 최댓값」**을 먼저 보고, 어기면 `VALIDATION_FAILED` · `fields.redemptionDate`다. V-27의 표 행이 b2에 서고 그 대상에 상환 쪽 셋이 들므로 `RULE_TARGETS` · `CASES`의 양방향 대조가 b2 커밋에 이 케이스를 요구한다. 새 규칙 ID를 만들지 않는다 — 기록 쪽(「상환이 있으면 그 달의 월수익 평가일 ≤ 상환일」)과 같은 사실을 반대쪽에서 보는 것이므로 V-27이 두 방향을 함께 진다(§6 말미). DB 트리거 `redemptions_before_coupon_payment`가 마지막 그물이다(사전 조회와 쓰기 사이의 창 — 단일 요청 순서에서. 동시 트랜잭션의 write skew는 DOC-010 AQ-93). 순번 없는 기실현 기록은 평가일이 없어 이 검사 밖이다(§3.2.1). 부모의 기록(지급 · 미지급)과 그 달의 평가일은 위 「부모의 지급방식」과 같은 사전 조회의 임베드로 읽는다 — 그렇게 두면 왕복이 늘지 않고, 실측은 b2(§5.0.1 각주)다.
>
> **SCR-203은 과세 금융소득 칸을 0으로 미리 채우고 고칠 수 없게 그린다**(DOC-008 SCR-203 · b1 개정) — V-29가 저장을 막는 것과 별개로 입력 전에 알린다. 계약은 받은 값을 그대로 검사한다.
>
> **상환 뒤의 월수익 일정** — 상환일이 흐름 끝이 된다. 상환일 이전 평가의 무기록 달은 추정에 남고(「미기록」 — 주의가 상환 뒤에도 뜬다, §4.1) 그 뒤 달은 「상환 후 없음」이다(§4.0 「구획」). 기실현 월지급(§5.11)도 같은 V-29를 지난다.

### 5.5 상환 수정 · 취소 — SCR-202

```ts
function updateRedemption(id: string, input: RedemptionInput): Promise<ActionResult<void>>
function deleteRedemption(id: string): Promise<ActionResult<void>>
```

**권한:** 상품 소유자
**제약**
- `updateRedemption`이 `roundNo`를 바꾸면 **귀속연도가 이동한다.** 아래 참조
- 두 계약 모두 상품이 아니라 상환 `id`를 받는다. 소유자 판정은 부모 상품을 경유한다(정책이 `exists (select 1 from els_products …)`로 판정하는 것과 같은 경로)
- **월지급 상품이면 `updateRedemption`도 V-29를 지난다** *(v4.16 — 구현 b4 · DB 겹 `redemptions_monthly_principal_only`는 b2)*. **상환일을 기록된 달(`PAID` · `UNPAID`)들의 월수익 평가일 최댓값보다 앞으로 옮기면 사전 검사가 거부한다** *(V-27의 양방향 문언 — 구현 b2. b1 개정 — 반박 검토 반영)*. 그 창을 지나면 `redemptions_before_coupon_payment`가 거부한다(`VALIDATION_FAILED` · `redemptionDate` — §5.4 「월지급 상품의 상환」. 비교 키는 지급일이 아니라 평가일이다 — b1 개정). 상환일을 옮기면 **월수익 흐름 끝이 함께 움직인다** — 그 사이 무기록 달이 「미기록」과 「상환 후 없음」 사이를 오가고 그 해의 F가 바뀐다(§4.0 「구획」)

> **`deleteRedemption`은 상품을 보유중 상태로 되돌린다.** 잘못 입력한 상환을 취소하는 유일한 경로이므로 반드시 제공한다. 실행 전 확인 절차를 둔다.

> **이것이 상품 삭제 2단계의 첫 단계다 (v0.9).** §5.3이 상환 완료 상품의 삭제를 `CONFLICT`로 막으므로, 상품을 지우려는 사용자는 반드시 이 계약을 먼저 통과한다. **그 순서가 우연이 아니라 설계다** — 상품 삭제가 상환까지 연쇄 삭제하면 조작 한 번으로 실현된 과세 이력이 사라지고 해당 귀속연도의 금융소득 합계와 세액이 아무 경고 없이 바뀐다(DOC-002 §8.1). 2단계로 쪼개면 사용자가 **과세 이력을 지운다는 사실을 명시적으로 확인**하게 되고, 확인 문구도 두 단계에서 서로 다른 것을 말한다 — 첫 단계는 "이 해의 금융소득이 바뀐다", 둘째 단계는 "상품이 사라진다"다. DQ-01(소프트 삭제)을 도입하지 않기로 한 결정의 짝이다. *(v4.16)* **월수익 지급 기록이 있으면 그 앞에 한 단계가 더 있다(최대 3단계)** — 월수익 기록 전부 지우기(§5.15) → 이 계약 → 상품 삭제(§5.3). 상환 취소만으로는 기록이 남아 상품 삭제가 `monthly_coupon_payments.els_id`의 `RESTRICT`에 걸린다. 상환을 취소해도 기록은 지워지지 않는다 — 월수익은 상환과 별개의 사건이다(DOC-002 D-09).
>
> **세액 영향은 `updateRedemption`에도 있다.** `taxableIncome`·`redemptionDate`를 고치면 §4.6의 연도별 집계가 그대로 바뀌므로, 이 계약도 "값을 고치는 일"이 아니라 "확정된 과세 이력을 고치는 일"이다. 화면은 두 계약에 같은 수준의 확인을 둔다.
>
> **`roundNo` 변경은 두 가지를 동시에 움직인다.** ① I-13의 복합 FK가 새 차수의 실재를 요구하고, 그 차수의 일정 행은 그 순간부터 `RESTRICT`로 고정된다(DOC-002 §8.1). ② 미상환 상품의 귀속연도는 적용 차수의 평가일에서 나오지만 **상환 완료 상품은 상환일에서 나오므로**(DOC-007 §7.2) 이미 상환된 건의 `roundNo` 변경은 귀속연도를 바꾸지 않는다 — 바뀌는 것은 "어느 차수에서 상환되었는가"라는 사실 기록이다. 두 값을 함께 고쳐야 하는 정정(차수와 상환일이 모두 틀림)에서 한쪽만 고치면 사실 기록과 귀속연도가 어긋나며, 계약은 그것을 막지 않는다 — 한 번의 UPDATE로 함께 보내는 것이 그 방어다.

### 5.6 과세 프로필 저장 — SCR-401

```ts
function saveTaxProfile(input: {
  year: number
  otherIncomeBase: string
  otherFinancialIncome: string
  healthInsuranceType: HealthInsuranceType
}): Promise<ActionResult<void>>
```

**권한:** 본인만 (조회도 본인 한정. DOC-010 §7)
**동작:** `UNIQUE(user_id, tax_year)` 기준 UPSERT. `user_id`는 **인증 사용자로 서버에서 설정**한다 — 입력값으로 받지 않는 것이 §5.1의 `owner_id`와 같은 이유다
**제약:** `year`는 4자리 정수이며 `smallint` 범위 안이어야 한다 (V-20)

> **`tax_years`에 시드된 연도로 제한하지 않는다 (v0.9).** `tax_profiles.tax_year`에는 FK가 없고(DOC-002 §4.2) 그것이 의도다 — 조회 계층은 시드보다 미래 연도를 **최신 시드로 근사**하고 `taxLawYear`로 드러내므로(§4.6), 2027년 프로필을 2027년 세율 마이그레이션 전에 저장하는 것은 정상 경로다. 반대로 시드보다 과거 연도는 조회가 거부하지만(재현성, ADR-005) 그 거부는 조회 시점의 판단이므로 저장을 막을 근거가 되지 않는다.

### 5.7 수동 시세 입력 — SCR-302

```ts
function saveManualPrice(input: {
  assetId: string
  asOfDate: string
  price: string
}): Promise<ActionResult<void>>
```

**권한:** 인증 사용자 전체 (시세는 공용 데이터)
**동작:** `UNIQUE(asset_id, as_of_date)` 기준 UPSERT. `source = 'MANUAL'`
**제약**
- 관측 좌표(`assetId`·`asOfDate`)는 기존 행에서 변경할 수 없다 (I-16)
- `asOfDate`는 **기준일 이후일 수 없다** (V-17). 이 계약이 §5.0 W-02(기준일)를 요구하는 유일한 이유이며, 그래서 변경 컨텍스트도 조회와 같은 기준일을 갖는다 — 계약이 자기 시각을 구하면 KST 00:00~09:00에 오늘 종가 입력이 "미래"로 거부된다

> **`.upsert()`를 그대로 쓸 수 있다.** `DO UPDATE SET`이 payload 전역(`asset_id`·`as_of_date` 포함)을 실어도 동일값 재대입이므로 I-16 트리거를 통과한다. 좌표를 **바꾸는** UPDATE만 `23514`로 거부되며, 좌표가 다른 시세는 정정이 아니라 새 관측이므로 새 행으로 넣는다. 조회한 행을 그대로 되싣는 형태도 안전하다 — `created_at`은 동결 대상이 아니므로 `timestamptz`(마이크로초)와 JavaScript `Date`(밀리초)의 정밀도 차이가 문제를 만들지 않는다(DOC-002 §8 I-16 참조).

### 5.8 시세 수동 갱신 — SCR-302

```ts
function refreshPrices(): Promise<ActionResult<{
  succeeded: number
  skipped: number                       // v3.5 신설 — 아래 ★
  unmapped: number                      // v3.5 신설 — §7.1과 같은 뜻
  failed: Array<{
    assetId: string
    assetName: string
    reason: string
    failure: 'NO_DATA' | 'CALL_FAILED'
  }>
}>>
```

**동작:** 7장의 배치와 동일 로직. 부분 실패를 허용하며 실패 목록을 반환한다

> **★ `skipped`를 신설한다 (v3.5, P5a 컷 0). 없으면 «정상»과 «고장»이 같게 보인다.**
>
> v3.4까지 이 반환은 `{succeeded, failed}`였고, 그 형태로는 **「이미 최신이다」와 「아무 일도
> 하지 못했다」가 구별되지 않는다** — 둘 다 `succeeded: 0, failed: []`다.
>
> **그리고 CR-05가 뒤집힌 뒤로 그것이 SCR-302의 «흔한» 경우가 됐다.** 배치는 14:00~14:59 KST에
> 돌고 사용자는 그 뒤에 갱신 버튼을 누른다 → 기준일 행이 이미 있으므로 전부 skip →
> 화면이 「0건」을 말한다. **정상적으로 최신인 상태가 고장으로 읽힌다.**
>
> `unmapped`도 같은 이유로 함께 싣는다 — 그쪽 근거는 §7.1의 표에 있다. **둘 다 §7.1의
> `CronResult`와 같은 뜻이며, 그래야 「7장의 배치와 동일 로직」이 반환에서도 참이 된다**
> (그 문장이 v2.7부터 하중을 지는데 필드 집합이 갈려 있으면 무엇이 「동일」인지 말할 수 없다).
>
> **두 계약의 차이가 남는 것은 «의도»다** — `CronResult`에는 `executedAt`·`targetCount`가 있고
> 여기에는 없다(요청 자체가 시점이고 화면이 호출자다). 반대로 여기에는 `assetName`이 있고
> 그쪽에는 없다(cron 응답에는 그것을 렌더할 화면이 없다). 즉 **한쪽이 다른 쪽의 부분집합이
> 아니라 공통 코어의 두 투영**이다 — 구현은 하나이고 투영이 둘이어야 한다.

> **공급자가 선정되지 않은 동안의 동작 (v0.9).** ADR-004는 어댑터 인터페이스를 확정했으나 구체 공급자는 ADR-007로 분리되어 있고 아직 미결이다(AQ-01). 등록된 공급자가 **0개인 동안 이 계약은 `PROVIDER_UNAVAILABLE`을 반환한다** — `ok: true`에 `succeeded: 0`을 담지 않는다. 둘의 차이는 화면 처리다: 전자는 ST-03(수동 입력 폴백)으로 유도하고 후자는 "갱신했으나 대상이 없었다"로 읽힌다.
>
> **★ P5a 컷 3에서 공급자가 «등재됐다» — ADR-008(키움 es040) 하나.** 위 규칙은 그대로
> 유지되지만 **정상 경로가 처음으로 실행된다.** 그리고 **세 번째 갈래(「등록됐으나 수집
> 로직 없음」 → `INTERNAL`)는 도달할 수 없게 됐다** — 등재와 수집기가 같은 컷에 왔기
> 때문이다(R-05). 컷 1이 어댑터를 세우고도 등재하지 «않은» 이유가 정확히 그것이었다:
> 등재만 하면 매일 「배포 결함」 응답이 나오고 그것은 503(설계된 상태)보다 나쁘다.
>
> **구현은 이 계약 «안»에 없다.** §7.1의 배치와 필드 집합이 갈리므로 한쪽이 다른 쪽을
> 부를 수 없고, 그래서 공통 코어(`collectAndRecord`) 하나 + 투영 둘이다 —
> 위 「공통 코어의 두 투영」이 코드에서 참이 되는 자리이며 §7.1 CR-08 각주가 그 층을 적는다.
>
> **스텁 어댑터로 실제 UPSERT까지 흐르게 하지 않는다.** ADR-004가 "개발 중에는 고정값을 반환하는 스텁으로 진행 가능"이라고 적었으나, 그 값이 `asset_prices`에 `source = 'AUTO'`로 들어가면 **타인 상품의 워스트오브와 조건 판정이 조용히 틀린다** — 형식은 정상이고 값만 거짓이므로 화면에 드러나지 않으며, D6이 `asOf` 상한으로 막는 종류의 결함도 아니다. 스텁은 테스트 안에서만 쓴다.

### 5.9 KI 터치 확정 — SCR-202

```ts
function setKiTouched(
  productId: string,
  touchedAt: string | null              // null = 터치 해제
): Promise<ActionResult<void>>
```

**권한:** 소유자
**제약**
- `kiBarrier`가 없는 상품(노낙인)에는 터치를 설정할 수 없다 → `VALIDATION_FAILED` + `kiTouchedAt` (V-18, I-15). 계약이 사전 조회로 판정하며 DB `CHECK`가 최종 보장이다
- `touchedAt`은 `YYYY-MM-DD` 형식이어야 한다. `null`은 해제이며 노낙인 상품에서도 허용된다 — 이미 없는 것을 없애는 요청은 거부할 이유가 없다

> **`fields` 키는 `kiTouchedAt`이다 (v1.1).** 파라미터 이름은 `touchedAt`이지만 화면이 가리키는 것은 상품의 `kiTouchedAt` 칸이고, 같은 규칙을 DB가 잡을 때(`els_products_ki_touched_check`)도 같은 키다 — **층에 따라 다른 칸을 가리키면 안 된다.** §3.1이 `fields`의 키를 "계약 입력의 필드 이름"으로 정의했는데 이 계약의 입력은 **위치 인자**라 필드 이름이 없고, 그 공백에서 계약 계층만 `touchedAt`을 쓰고 있었다(v1.0까지의 구현). §6 V-18의 대상과 §3.2.1의 사상이 처음부터 `kiTouchedAt`이었으므로 그쪽으로 맞춘다.

> 시스템은 KI 터치를 자동 확정하지 않는다(DOC-002 D-04). 수집 시세로 하회가 관측되면 화면에 후보로 표시하고, 확정은 본 계약을 통해 사용자가 수행한다.

> **미래 일자 터치를 거부하지 않는다 (v0.9).** V-17은 시세에만 걸린다. 터치 확정일은 사용자가 증권사 통지에서 옮겨 적는 외부 사실이고, 기준일보다 앞선 날짜가 들어오는 것은 입력 오류이기 이전에 **관측일과 통지일의 시차**일 수 있다. 판정 쪽에서도 `ki_touched_at`은 존재 여부만 쓰이고 날짜 비교에 들어가지 않으므로(DOC-007 §3.4), 미래 일자가 판정을 틀리게 만드는 경로가 없다 — 시세와 다른 점이다.

### 5.10 자산 등록 — SCR-204

```ts
function createAsset(input: {
  name: string
  assetType: 'STOCK' | 'INDEX' | 'ETF'
  market?: string
  currency: string
}): Promise<ActionResult<{ id: string }>>
```

**권한:** 인증 사용자 전체
**제약**
- `UNIQUE(name, market)` 위반 시 `CONFLICT`. **`market`이 `null`인 경우도 중복으로 판정된다** — 인덱스가 `nulls not distinct`이므로(DOC-002 §4.3) 시장 정보 없는 자산도 한 번만 등록된다
- `currency`는 **정확히 3자** 대문자여야 한다 (V-19). 열이 `char(3)`이므로 짧은 값은 공백으로 채워져 `'US '`로 저장되고, 그 값은 조회에서 그대로 화면에 나오지만 어떤 통화 코드와도 일치하지 않는다
- `name`·`market`은 열 선언 길이 이내여야 한다 (V-19). 초과는 `22001`이며 그 코드로는 어느 필드인지 알 수 없다

> **SCR-204 불러오기에서도 부른다 (v4.3).** 미해결 기초자산의 「자산 추가」가 이 계약 다음 §5.12를 **순서대로** 부른다. 원자적이지 않다 — 둘째가 실패하면 자산은 있고 매핑이 없는데, 그것이 **미매핑 자산**이며 ADR-007이 정상 상태로 정했다. 재시도는 §5.12만 부른다(UPSERT이므로 멱등이다). 같은 `(name, market)`을 다시 보내면 `CONFLICT`이고 화면은 그것을 「기존 자산에 연결」로 안내한다. 14번째 계약(두 쓰기를 묶는 함수)을 만들지 않는 이유는 AQ-74.

### 5.11 기실현 등재 — SCR-205 (v3.2 신설)

```ts
function createRealizedProduct(
  input: RealizedProductInput
): Promise<ActionResult<{ id: string }>>

type RealizedProductInput = {
  name: string
  issuer?: string
  currency: ProductCurrency             // v4.9 (P8 컷 a2) — 필수, 기본값 없음 (V-22)
  couponPayout: CouponPayout            // v4.16 (P8 컷 b1 명세 · 구현 b2) — 필수, 기본값 없음 (V-25). 일정·율은 받지 않는다
  principal: string                     // 상품 통화 금액 — V-01′ · V-23
  accountType: 'GENERAL' | 'TAX_FREE'
  redemptionType: 'EARLY' | 'LIZARD' | 'MATURITY_GAIN' | 'MATURITY_LOSS'
  redemptionDate: string
  grossAmount: string
  taxableIncome: string
  withholdingTax?: string
  exchangeRate?: string                 // v4.9 (P8 컷 a2) — 적용 환율(참고). V-24
  isConfirmed: boolean
  note?: string
}
```

**동작**

- 쓰기 함수 `create_realized_els_product`로 **`els_products` 1건 + `redemptions` 1건을 한 트랜잭션에** 만든다. `entry_mode`는 함수가 `REALIZED_ONLY`로 박는다 — 입력값으로 받지 않는다(`owner_id`와 같은 이유: 규율이 아니라 구조)
- 기초자산·평가일정은 **만들지 않는다.** `issue_date`·`annual_coupon_rate`는 `NULL`이다 *(v4.16 — 월지급식 기실현도 같다: 월수익 일정을 만들지 않고 `monthly_coupon_annual_rate`도 `NULL`이다. DOC-002 I-23의 지급방식 짝은 `FULL`만 보고, `REALIZED_ONLY`는 두 율 모두 `NULL` — 그중 월수익 연쿠폰율은 같은 `CHECK`가 `REALIZED_ONLY ⇒ monthly_coupon_annual_rate IS NULL`로 강제한다(b1 개정 — DOC-002 DQ-17 ③ 해결 · §3.2.1. `annual_coupon_rate`의 기실현 `NULL`은 종전대로 이 함수가 넣는 값이다 — DOC-002가 강제를 넓히지 않았다). DQ-11의 「`MONTHLY`면 연쿠폰율 0」은 계약 조건이 있는 `FULL`의 규칙이다)*
- **쿠폰 지급방식은 받는다** *(v4.16 선행 명세 — P8 컷 b1, 구현 b2)*. `couponPayout`은 필수이고 기본값이 없다(V-25 — §5.1과 같은 형태). 쓰기 함수가 `->>`로 읽고 확장 웨이브(W4) 동안만 `coalesce(…, 'AT_REDEMPTION')`을 둔다(§5.1). SCR-205의 「쿠폰 지급」 선택 상자(「선택」 · 「상환 시 지급」)가 같은 b2 코드 커밋에 선다(§5.1 — b1 개정). **`MONTHLY` 기실현의 월수익 이력은 등재 뒤 §5.14로 적는다** — 일정이 없으므로 `couponNo: null`인 `PAID` 행이다(DOC-002 I-27 · DOC-008 SQ-17 · SCR-206의 「빈 행 추가」)
- `round_no`는 **항상 `NULL`이다.** 입력에 그 필드가 없다 — 일정 행이 0건이므로 실재하는 차수가 없고(I-13), 조기·리자드 상환도 그렇다(I-14 트리거가 면제한다)
- `withholdingTax` 미입력 시 `taxableIncome × 분리과세율`로 산출한다 — **§5.4와 같은 산출을 쓴다**(같은 상수·같은 연도·같은 절사)
- 반환하는 `id`는 **상품 id**다. 화면이 상세(SCR-202)로 이동한다

**권한:** 인증 사용자 전체 (자기 소유로만 만들어진다)
**제약**
- `principal > 0` (V-01 / I-17) · `taxableIncome >= 0` (V-11 / I-12) · 만기손실이면 `taxableIncome = 0` (V-12 / I-08) · `grossAmount >= 0` (I-17)
- **달러 기실현** (v4.9 선행 명세 — P8 컷 a1, 구현 a2) — `currency`는 V-22(기본값 없음), `principal`·`grossAmount`는 **입력의** `currency`로 V-23을 지난다(부모가 아직 없으므로 사전 조회가 아니라 같은 입력에서 온다). `exchangeRate`는 §5.4와 같은 참고값이며 V-24가 원화에서 거부한다. 쓰기 함수가 `currency`·`exchangeRate`를 `->>`로 읽고(W-04) 확장 웨이브 동안만 `coalesce(…, 'KRW')`를 둔다(§5.1과 같다). 과세 두 값과 원천징수 기본값은 §5.4와 같다
- **월지급 기실현** *(v4.16 — 구현 b4 · DB 겹은 b2)* — 상환은 원금만이다: `grossAmount ≤ principal` ∧ `taxableIncome = 0`(V-29 — §5.4 「월지급 상품의 상환」). 수익은 등재 뒤 §5.14의 월수익 지급 기록으로 들어온다. 상환일 쪽 사전 검사(V-27의 양방향 문언 — 구현 b2, b1 개정)의 대상이지만 이 계약에서는 걸릴 일이 없다 — 상품과 상환이 한 트랜잭션에 함께 태어나 그 전에 기록이 없고, 그 뒤의 기록은 순번이 없어 평가일 검사 밖이다(§3.2.1)
- 문자열 길이는 열 선언 이내 (V-19)

> **적용되지 않는 규칙이 둘이다.** V-10(`redemptionDate >= issueDate`)은 **비교 대상이 없다** — 발행일을 입력받지 않으므로 검사할 수 없고, 그 사실이 이 계약의 정의다. V-13(조기·리자드는 차수 필수)은 **입력에 `roundNo`가 없어** 위반이 표현 불가다. 두 규칙에 예외를 「두는」 것이 아니라 **입력의 형태가 그 규칙의 전제를 없앤다** — §6의 규칙은 입력의 형태에 대한 진술이므로 새 V-id를 부여하지 않는다(§5.4 v1.7이 시드 범위 조건에 V-id를 주지 않은 것과 같은 판단).

> **왜 쓰기 함수인가 — §5.1과 같은 이유이고 더 무겁다.** PostgREST는 요청당 1 트랜잭션이므로 요청 둘로 나누면 부분 실패가 **`REALIZED_ONLY`인데 상환이 없는 상품**을 남긴다. 그것은 DOC-002 §4.6 표의 빈 칸이며, 계약 조건도 상환도 없으므로 **판정의 모든 입력이 없다.** §5.1의 잔해(기초자산 0건 상품)는 `integrityIssue`가 드러내 주지만, 이 잔해는 조회 계층이 `entry_mode`만 보고 면제하면 **정상으로 읽힌다** — 그래서 조회 계층이 「`REALIZED_ONLY` + 상환 없음」을 결함으로 표시하고(§4.2), 그 표시가 필요 없게 만드는 것이 이 함수다. 두 방어는 대체가 아니라 보완이다.

> **§5.2 수정 경로는 열리지 않는다.** 만들어진 상품은 즉시 상환 완료이므로 `update_els_product`가 `els_products_redeemed_immutable`로 거부한다. 고쳐야 하는 것은 **상환 값**이며 그 경로가 §5.5(`updateRedemption`)로 이미 있다 — 상품명·투자원금·계좌유형을 고치는 경로는 **없다.** 잘못 등재하면 상환을 취소하고 상품을 지운 뒤 다시 등재한다(DOC-002 §7). 계좌유형이 세액을 가르므로(DOC-007 §4.3) 그 값을 조용히 고칠 수 있게 두지 않는 편이 낫다.

### 5.12 공급자 심볼 매핑 — SCR-302 (v3.6 신설, P5a 컷 2b)

```ts
function saveProviderSymbol(input: ProviderSymbolInput): Promise<ActionResult<void>>

type ProviderSymbolInput = {
  assetId: string
  provider: string
  /** `null` = 매핑 해제(행 삭제). 아래 ★ */
  providerSymbol: string | null
}
```

**권한:** 인증 사용자 전체 (공급자 매핑은 공용 데이터 — `assets`·`asset_prices`와 같다)

**배정 (v4.3):** SCR-302(매핑 폼) · **SCR-204 불러오기**(「기존 자산에 연결」 · 「자산 추가」의 둘째 단계). `provider`는 폼 칸이 아니라 코드 상수(`KIWOOM_ES040`)다 — 불러오기가 키움 심볼만 다루기 때문이며 V-21이 그 값을 다시 확인한다.

**동작**

- `UNIQUE(asset_id, provider)` 기준 UPSERT. `providerSymbol`이 `null`이면 그 좌표의 행을 **삭제**한다
- 없는 행을 삭제하는 요청은 **성공이다** — 이미 없는 것을 없애는 요청은 거부할 이유가 없다(§5.9가 같은 판단을 한다)

> **★ 계약을 «하나»로 둔다 — `deleteProviderSymbol`을 만들지 않는다.**
>
> P5a 컷 2a가 `DELETE` 권한을 열었으므로 삭제 경로가 필요한데, **§5.9 `setKiTouched`가
> 이미 같은 형태의 선례다**(`touchedAt: string | null`, `null = 터치 해제`). 그쪽과 같은
> 이유로 여기서도 `null`이 해제다 —
> ⓐ 좌표가 같고(`(assetId, provider)`) 두 연산이 **같은 한 칸을 다룬다**
> ⓑ 화면의 조작이 하나다(그 칸을 비우는 것)
> ⓒ **계약 수가 12 → 13에서 멈춘다.** 둘로 쪼개면 14가 되고 `MutationName`을 세는 원장
> 여럿이 두 번 움직인다
>
> **삭제를 «필요»로 만드는 것은 `UNIQUE(asset_id, provider)`다** — 그 제약 아래에서
> UPDATE로는 매핑을 없앨 수 없다(공급자를 바꿀 수는 있어도). 그래서 이 계약이 UPSERT와
> DELETE를 함께 갖는 것이 규약 위반이 아니라 **좌표의 성질**이다.

**제약**

- `assetId`는 실재하는 자산이어야 한다 (FK · V-19)
- `provider`는 **코드가 아는 공급자 id여야 한다** — 아래 ★★ (V-21 신설)
- `providerSymbol`은 `varchar(50)` 이내이고 앞뒤 공백이 없다 (V-19)

> **★★ `provider`의 «소속»을 검증한다 — 형식만 보지 않는다 (V-21).**
>
> 열은 `varchar(30)`이므로 아무 문자열이나 들어간다. 그런데 **어느 수집기도 모르는
> `provider` 값은 그 매핑을 «영구히 쓰이지 않는 행»으로 만든다** — 자산은 매핑된 것처럼
> 보이고(`providerSymbols`가 비어 있지 않다) 수집은 되지 않으며, `unmapped`도 세지 않는다.
> 즉 **화면이 「자동 수집됨」으로 읽히는데 실제로는 아무 일도 일어나지 않는다.**
> 오타 하나가 만드는 조용한 상태이므로 계약이 막는다.
>
> **`provider_symbol`의 «내용»은 반대로 검증하지 않는다.** 그것은 공급자만 아는 값이고,
> 화면이 판단자가 되면 「공급자 목록에 있는데 화면이 거부한다」가 생긴다. 없는 코드는
> 공급자가 0건으로 답하고 그것이 `NO_DATA`(→ 「매핑을 고친다」)다 — DQ-02가 이미 그 경로를
> 설계했다. **소속은 우리가 알고 내용은 공급자가 안다**는 것이 이 비대칭의 근거다.

> **★★★ 「코드가 아는 공급자」와 「수집에 «켜진» 공급자」는 다른 집합이다.**
>
> P5a 컷 1이 어댑터를 세웠으나 `PRICE_PROVIDERS`(수집 레지스트리)에 **등재하지 않았다** —
> 등재하면 `providerCount > 0`인데 수집기가 없어 CR-08(배포 결함)이 되기 때문이다.
> 그래서 이 계약의 V-21은 **레지스트리가 아니라 «전체 명부»**를 본다.
>
> **그 덕에 이 화면이 수집기보다 «먼저» 쓸모를 갖는다** — 민서가 지금 매핑을 넣어 두면
> 컷 3의 수집기가 첫 실행부터 대상을 갖는다. 반대로 레지스트리를 봤다면 이 화면은
> 컷 3까지 아무 값도 저장할 수 없다.

### 5.13 수동 환율 입력 — SCR-302 (v4.9 선행 명세 — P8 컷 a1, 구현 a3)

```ts
function saveExchangeRate(input: {
  currency: 'USD'                       // 지원 외화 (V-24). KRW는 거부한다
  asOfDate: string                      // V-17 — 기준일 이후일 수 없다
  rate: string                          // 1달러당 원. V-24 — 0보다 크고 소수 6자리 이내
}): Promise<ActionResult<void>>
```

**권한:** 인증 사용자 전체 (환율은 공용 관측 데이터 — DOC-002 DQ-13. 소유자 열이 없다)
**동작:** `UNIQUE(currency, as_of_date)` 기준 UPSERT. `source = 'MANUAL'`, **`provider = null`을 명시해 싣는다**(아래 ★). §5.7 `saveManualPrice`와 같은 형태다
**제약**
- 관측 좌표(`currency`·`asOfDate`)는 기존 행에서 바꿀 수 없다 — `exchange_rates_coordinates_immutable`(DOC-002 I-22 — I-16의 형태). §5.7처럼 `DO UPDATE SET`이 좌표를 동일값으로 재대입하므로 UPSERT는 통과한다
- **삭제 계약이 없다** — `exchange_rates`에는 DELETE의 GRANT도 정책도 없다(두 겹, DOC-002 I-22). 틀린 환율은 같은 좌표에 다시 넣어 **덮어써서** 고친다

> **★ `provider = null`이 이 계약의 한 줄짜리 요점이다.** `exchange_rates_provider_check`는 `(source = 'AUTO') = (provider is not null)`이다(DOC-002 I-22). PostgREST의 UPSERT는 payload에 **있는** 열만 `DO UPDATE SET`에 싣는다 — `provider`를 빼고 보내면, 자동 수집이 넣은 행(`source = 'AUTO'` · `provider = <원천>`)을 수동으로 **정정할 때** 결과가 `source = 'MANUAL'` + `provider ≠ null`이 되어 그 제약에 걸린다. 그리고 그 제약은 §3.2.1에서 **`NOT_USER_REACHABLE`**(사용자 입력으로 도달하지 않는다)로 분류되어 사상이 없으므로 응답이 **`fields` 없는 `VALIDATION_FAILED`**(SQLSTATE `23514`의 기본값 · 「입력값을 확인한다.」)다 *(v4.13 정정 — 종전 「응답이 `INTERNAL`이다」는 사상 규칙과 달랐다. `tests/db/errors.test.ts`가 그 사상을 고정한다)* — 사용자가 고칠 칸이 없는 오류로 **틀린 자동 환율의 유일한 정정 경로가 막힌다.** `provider: null`의 명시가 그 분류의 **전제**다. 자동 수집 행은 게이트 분기 A/A′의 컷 c2 이후에만 생기므로 그 전에는 이 경로가 운영에서 관측되지 않는다 — 그래서 컷 a3의 `tests/rls/`가 AUTO 행을 소유자 권한으로 먼저 넣고 수동 정정이 성공함(`provider`가 `null`이 됨)을 단언한다.
>
> §5.7의 `asset_prices`에는 이 짝 제약이 없어 같은 생략이 조용히 지나간다 — 자동 시세를 수동으로 정정해도 `provider`가 남는다(`source = 'MANUAL'`인데 `provider = 'KIWOOM'`). 그 열을 읽는 조회가 없어 지금 드러나는 값은 없다. 이 절의 범위 밖이며 등재는 DOC-010의 몫이다.

> **UPSERT인 이유 — 수동이 자동을 이긴다.** 시세의 AQ-06 결정(「같은 좌표에 행이 있으면 배치는 쓰지 않는다 — 잘못된 `AUTO`의 정정 경로는 재수집이 아니라 §5.7이다」)을 환율에 그대로 옮긴다 — 배치는 기존 좌표를 덮어쓰지 않고(CR-12, 컷 c2) 사람은 덮어쓴다. **환율의 정정은 시세보다 무겁다** — 틀린 시세는 판정 표시를 틀리게 하지만 틀린 환율은 **세금 추정과 종합과세 판정**을 틀리게 한다(아래 무효화).
>
> **`asOfDate`는 V-17을 재사용한다** — 기준일 이후의 환율은 존재할 수 없고, 미래 날짜 행은 `as_of_date ≤ asOf` 규칙 때문에 오늘은 쓰이지 않다가 그날이 오면 **조용히** 추정 환율이 된다. §5.7과 같이 이 계약이 변경 컨텍스트의 기준일(W-02)을 요구하는 이유다.
>
> **확정값을 만들지 않는다.** 이 환율은 추정에만 쓰인다 — 상환의 원화 과세는 거래내역에서 오고(A-04) 이 값으로 재계산되지 않으므로, 어떤 날짜의 환율을 고쳐도 확정 기여는 한 원도 움직이지 않는다. 추정 환율은 `as_of_date ≤ asOf` 중 **최신 1건**이므로 최신보다 오래된 날짜를 고치면 현재 추정도 움직이지 않는다 — 그래도 `affects`를 값에 따라 고르지 않는다(§8의 판정 기준은 「어느 입력을 읽는가」다).

> **무효화 — `EXCHANGE_RATE_WIDE` 신설 (컷 a3). 세금이 «있는» 것이 요점이다.**
>
> | 조회 계약 | 이 환율을 읽는 자리 |
> |---|---|
> | `listExchangeRates` | 값 자체(§4.11) |
> | `getProduct` | `projection.expectedTaxableIncome`·`exchangeRateBasis`(§4.3) |
> | `getDashboard` | `currentYearTax`·`totals.krwEstimate`(§4.1) |
> | `getTaxSummary` | `income` — 달러 추정 건(§4.6) |
> | `listUserSummaries` | `currentYearFinancialIncome` — 같은 집계(§4.8) |
> | `getForecast` | F와 원화 합계 열 전부(§4.7) |
>
> **들지 않는 것**: `listProducts`·`listSchedule`(금액을 상품 통화로만 싣는다 — §4.4의 「달러 기준 참고」가 환율을 쓰지 않는 것이 SCR-301을 이 축 밖에 두는 근거다) · `listAssetPrices` · `searchAssets`.
>
> **거울상도 지킨다 — `PRICE_WIDE`에는 세금이 계속 없다.** 추정 과세가 시세를 쓰지 않으므로(§8 「판정 기준의 특이한 두 자리」 ①) 그 축의 「세금이 없는 것이 요점이다」가 참으로 남는다. §5.8 `refreshPrices`가 환율을 함께 모으면 그 문장이 거짓이 되므로 **모으지 않는다**(DOC-008 SQ-19 — 자동 수집은 배치 라우트의 둘째 단계에서만, 컷 c2). 컷 a3가 두 방향을 케이스로 박는다: `saveExchangeRate`는 `/tax`를 낡게 하고, `refreshPrices.affects`에는 세금 조회가 **없다**.
>
> **`listExchangeRates`는 상품 축에도 든다** — `usedByActiveProducts`(§4.11)가 미상환 외화 상품 수이므로 `PRODUCT_WIDE`와 `createProduct`가 이 계약을 함께 낡게 한다. `createRealizedProduct`는 아니다(즉시 상환 완료라 「미상환」에 들지 않는다 — `listAssetPrices`를 빼는 것과 같은 이유). `setKiTouched`도 아니다.

**변경 계약 13 → 14 (컷 a3).** 결속 원장이 같은 커밋에 움직인다 — `INVALIDATION`(`satisfies Record<MutationName, …>`가 축을 정하지 않은 계약을 컴파일에서 거부한다) · `MUTATION_NAMES` 길이 단언(`tests/app/invalidation.test.ts`) · `tests/db/mutations.test.ts`의 `CONTRACTS` · `createUnauthenticatedMutations` · `mutations/context.ts`·`app/actions.ts`의 「13개」 · §8 SCR-302 행(표 행은 그 코드 커밋에 함께 — §8 말미 각주). **왕복 1** — `exchange_rates` ×1(§5.7과 같다 — 소유자가 없으므로 사전 조회가 없다). §5.0.1 표의 행과 `tests/integration/mutations.test.ts`의 다중집합도 그 커밋에 함께다.

### 5.14 월수익 기록 — SCR-206 (v4.16 선행 명세 — P8 컷 b1, 구현 b2)

```ts
function recordCouponPayments(
  productId: string,
  input: { entries: CouponPaymentInput[] }   // 1..60건
): Promise<ActionResult<{ ids: string[] }>>  // 만든 기록의 id, 입력 순서 (b1 개정 — §9 ⑩ 해결)

/** 월수익 한 달의 지급 기록 (DOC-005 「월수익 지급 기록」). 타입 이름은 이 문서의 표기 — `RedemptionInput`의 짝 */
type CouponPaymentInput = {
  couponNo: number | null               // 월수익 순번. FULL이면 일정에 있는 순번, 기실현이면 null (V-27)
  outcome: CouponOutcome
  paymentDate?: string                  // PAID면 필수 · UNPAID면 없다 (V-28)
  grossAmount?: string                  // 상품 통화 — 부모 상품의 통화로 V-23. PAID면 필수
  taxableIncome?: string                // 원화 — V-11. PAID면 필수
  withholdingTax?: string               // 원화. PAID이고 없으면 서버가 채운다 (아래)
  exchangeRate?: string                 // 적용 환율(참고) — V-24ⓐ. 외화 상품의 PAID만
  isConfirmed: boolean
  note?: string
}
```

**권한:** 상품 소유자
**동작**

- **`entries` 1..60건을 다행 INSERT 한 번으로 저장한다** — 요청 하나가 트랜잭션 하나이므로 **전부 아니면 전무**다. 한 행이라도 DB가 거부하면 아무 행도 남지 않는다. 쓰기 함수가 필요하지 않다 — §5.4의 「행이 하나이므로 요청 하나로 원자적」과 같은 근거가 다행 INSERT 한 문장에도 선다. 상한 60은 월수익 일정의 상한(V-26)과 같다 — `FULL` 상품의 한 화면 제출이 일정 전체를 넘지 않는다.
- **사전 조회** — 부모 상품(소유자 · 지급방식 · `entry_mode` · 통화 · 월수익 일정 · 기록 · 상환)을 읽어 W-05의 `FORBIDDEN`·`NOT_FOUND`를 가르고 V-27 · V-28 · V-23 · V-24ⓐ를 판정한다. 왕복 수는 b2가 잰다(§5.0.1 각주).
- **원천징수 기본값** — `PAID`이고 `withholdingTax`가 없으면 `withholdingFor(ctx, { date: paymentDate, taxableIncome }, 'paymentDate')`로 채운다 — §5.4와 **같은 함수**다(분리과세율 조회 · 원 단위 절사 — DOC-007 §4.7). **`WithholdingDateField`에 `'paymentDate'`를 더한다** — 귀속 = `year(paymentDate)`(월수익의 귀속연도는 지급일이다 — DOC-005 「월수익 지급일」), 형식 오류 문구는 「월수익 지급일을 YYYY-MM-DD 형식으로 입력한다.」다. 세율은 조회한다(절대 규칙 #5). `UNPAID`는 원천징수가 없다(I-26). 이 값은 덮어쓸 수 있는 기본값이고 거래내역·지급명세서의 실제 징수액이 정본이다(A-04).
- **연도별로 세율을 한 번씩 읽는다.** 12월 · 1월에 걸친 묶음은 두 해의 세율을 각각 한 번 읽고, 같은 해는 다시 읽지 않는다. 행마다 읽는 구현도 값은 옳으므로 §5.0.1의 다중집합 예산 말고는 어느 케이스에도 걸리지 않는다(§4.7 `getForecast`의 v2.5 각주와 같은 자리).
- **세율 시드가 없는 해의 빈 원천징수는 `entries[i].withholdingTax`에 `VALIDATION_FAILED`다**(DOC-007 RD-16 — 시드를 더하지 않는다). 문구는 상환의 `taxSeedError`와 같은 규칙이다(§5.4 v1.7 — 「그 해는 지원하지 않는다」가 아니라 「실제 징수액을 입력한다」). 2026년 이전에 받은 기실현 월수익이 이 경로다. 시드가 **아예 없는** 장애는 여전히 `INTERNAL`이다(§3.2.2).
- **오류 경로는 행 단위 `entries[i].<필드>`다.** 계약 계층은 몇 번째 행인지 알므로 색인을 붙인다 — §3.2.1의 「배열 인덱스를 붙이지 않는다」는 **DB 오류 사상**의 규칙이다(DB는 몇 번째 행인지 말하지 않는다). `withholdingFor`가 내는 칸(`paymentDate` · `withholdingTax`)도 계약이 `entries[i].`를 붙여 옮긴다. 건수(1..60)의 위반은 `entries`다. DB까지 간 거부의 키는 **색인 없는 이름**이다(`paymentDate` · `grossAmount` · … — §3.2.1, b1 개정) — DB는 몇 번째 행인지 말하지 않고, 그 거부는 이 사전 검증을 지난 뒤의 마지막 그물이다.
- **반환은 만든 기록의 id다** *(b1 개정 — §9 ⑩ 해결)* — `{ ids }`, `entries`의 입력 순서. 다행 INSERT 한 번의 결과 행에서 나오므로 왕복이 늘지 않는다.
- **달러 상품** — `grossAmount`는 부모 통화로 V-23을 지난 **뒤** `moneyString`으로 정규화해 싣는다(§5.1의 순서와 같은 이유). 과세 두 값은 거래내역의 **원화** 값이고(A-04 · U1) `exchangeRate`는 참고값이다 — 과세를 이 값으로 산출하지 않는다. SCR-206은 달러 상품의 과세 칸을 미리 채우지 않고 힌트만 준다(「≈ 세전 × 최신 추정 환율」 — DOC-008 SCR-206. §5.4의 SCR-203과 같은 이유 — 달러 수가 원화 칸에 들어간다).
- **기록이 그 달의 사건을 바꾼다** — `PAID`를 적으면 그 달은 추정에서 빠지고 기록값의 확정 사건이 되며, `UNPAID`를 적으면 사건이 사라진다(§4.0 규칙 1 · DOC-007 검산 E). `isConfirmed`는 표시 축이다(ST-05).

**제약**

- V-27(기록 대상) · V-28(형태) · V-23 · V-24ⓐ · V-11 · V-20′(`couponNo`). DB 겹은 §3.2.1의 I-26(형태 · 자릿수) · I-27(부모) · `UNIQUE` 둘 · 복합 FK다
- **부모가 상환 시 지급이면 기록할 수 없다** — V-27. DB 겹 `monthly_coupon_payments_monthly_required`(DQ-07 ③)
- **이미 기록된 달은 다시 기록할 수 없다** — V-27(입력 안의 중복 포함). 정정은 §5.15다. DB 겹 `UNIQUE(els_id, coupon_no)` → `CONFLICT`
- **`PAID`의 지급일은 겹치지 않는다** — 그 상품의 다른 `PAID` 기록 · 같은 입력의 다른 행과 같은 지급일이면 `entries[i].paymentDate`에 `VALIDATION_FAILED`(V-28 — b1 개정, 반박 검토 반영). DB 겹 `UNIQUE(els_id, payment_date)` → `CONFLICT`는 사전 검사와 쓰기 사이의 경합에서만 닿는다. 순번이 없는 기실현 기록에서는 이 규칙이 유일한 중복 방어다
- **상환이 있으면 그 달의 월수익 평가일 ≤ 상환일** — V-27. **결과를 가리지 않는다 — 지급 · 미지급 모두**이고 상환 쪽(§5.4 · §5.5 — 기록된 달 전부의 평가일)과 같은 집합이다(b1 개정 — 대칭). 비교 키는 지급일이 아니라 평가일이다(b1 개정 — 흐름 끝과 같은 키, DOC-007 RD-18 해결). 그래서 상환 대금이 먼저 지급되어도 같은 날 평가된 마지막 달은 기록할 수 있다. 순번 없는 기실현 기록은 평가일이 없어 이 검사 밖이다. DB 겹 `monthly_coupon_payments_after_redemption`(DQ-07 ②)
- **기실현 월지급 상품의 순번 없는 기록은 상품당 60건 이하다** — V-27(b1 개정). 일괄 기록(1..60)과 「월수익 기록 전부 지우기」(§5.15 — 1..60)가 한 번에 되도록 맞춘다. `FULL` 상품은 일정(V-26 — 60행 이하)과 `UNIQUE(els_id, coupon_no)`가 이미 같은 상한을 준다. DB 겹은 없다(계약에만 있다 — 직접 INSERT 우회는 AQ-29 부류)
- **아직 오지 않은 지급은 기록하지 않는다** — `PAID`의 지급일 ≤ 기준일(V-28 — V-17과 같은 이유로 DB 제약이 아니다: `current_date`는 `CHECK`에 쓸 수 없다)

> **무효화 — `COUPON_RECORD_WIDE` 신설 (컷 b2 · `listMonthlyCouponSchedule`은 그 계약이 서는 b3). 세금이 «있다».** §5.14 · §5.15의 세 계약이 이 축을 쓴다. 판정 기준은 §8 그대로 「어느 입력을 읽는가」다.
>
> | 조회 계약 | 이 기록을 읽는 자리 |
> |---|---|
> | `getProduct` | `coupons[].state`·`record` · `unnumberedCouponRecords` · `remainingCoupons` · `redemption.realizedPnl`(§4.3) |
> | `listProducts` | `couponProgress`(§4.2) |
> | `getDashboard` | `receivedCoupons` · `realizedPnl` · `COUPON_UNRECORDED`와 그 `count` · `currentYearTax`(§4.1) |
> | `getTaxSummary` | 확정 월수익 사건 · `basis` · `breakdown`(§4.6) |
> | `listUserSummaries` | `currentYearFinancialIncome` — 같은 사건 집합(§4.8) |
> | `getForecast` | F와 금액 열(§4.7) |
> | `listMonthlyCouponSchedule` | 행의 `state`(§4.12) |
>
> **들지 않는 것**: `listSchedule`(조기상환 차수만 — §4.4) · `listAssetPrices` · `searchAssets` · `listExchangeRates`(기록은 상환 여부를 바꾸지 않으므로 「미상환」 수가 그대로다 — §4.11).
>
> **`PRODUCT_WIDE`와 `PRICE_WIDE`에도 `listMonthlyCouponSchedule`이 든다 (b3)** — 상품·상환은 행의 존재와 흐름 끝을, 시세는 다음 행의 조건 판정을 바꾼다. **`createProduct`의 `affects`에도 든다**(b1 개정 — 그 계약은 축을 쓰지 않고 따로 적으므로 따로 더한다. §4.12). **`PRICE_WIDE`에는 여전히 세금이 없다** — 추정 월수익은 시세를 쓰지 않는다(§4.0 「쿠폰 지급방식과 월수익」 규칙 3). v4.13이 박은 단언(`refreshPrices`·`saveManualPrice`의 `affects`에 세금 계약 셋 다 없음 — SB-17)이 그대로 지킨다. 월지급식이 기본형만인 것이 이 문장의 전제다 — KI 터치 후 중단형(변형 명칭은 DOC-005 GQ-06 미결 — b1 개정)을 들이면 시세·KI 터치가 F를 움직인다(DOC-002 DQ-16 ②).

**변경 계약 14 → 17 (컷 b2 — 셋이 한 커밋에).** 결속 원장이 같은 커밋에 움직인다 — `INVALIDATION`(`satisfies Record<MutationName, …>`가 축을 정하지 않은 계약을 컴파일에서 거부한다) · `MUTATION_NAMES` 길이 단언(`tests/app/invalidation.test.ts` 「계약 14개가 모두 항목을 갖는다」) · `tests/db/mutations.test.ts`의 `CONTRACTS` · `createUnauthenticatedMutations` · `mutations/context.ts`·`app/actions.ts`의 「14개」 · §8 매트릭스(변경 칸 대조가 **양방향**이므로 세 이름이 b2 커밋에 선다 — b1 개정. SCR-206 화면 행은 b3이고, b2~b3 동안 `recordCouponPayments` · `updateCouponPayment`가 서는 행은 §9 ⑭의 남은 몫이다) · §5.0.1 표의 행과 `tests/integration/mutations.test.ts`의 다중집합.

### 5.15 월수익 기록 수정 · 삭제 — SCR-206 · SCR-202 (v4.16 선행 명세 — P8 컷 b1, 구현 b2)

```ts
function updateCouponPayment(
  id: string,
  input: Omit<CouponPaymentInput, 'couponNo'>    // 한 기록 전체 교체 — 순번 · 상품은 바꾸지 않는다(입력에 없다)
): Promise<ActionResult<void>>

function deleteCouponPayments(
  productId: string,
  input: { ids: string[] }                       // 1..60건
): Promise<ActionResult<void>>
```

**권한:** 상품 소유자 — `updateCouponPayment`는 기록 `id`를 받으므로 소유자 판정이 부모 상품을 경유한다(§5.5와 같은 경로).

**`updateCouponPayment` — 한 기록 전체 교체.**

- 순번과 상품은 **입력에 없다** — 바꿀 수 없다. 다른 달의 기록이면 지우고 그 달에 새로 적는다(§5.14). 결과(`outcome`)는 바꿀 수 있다 — 전체 교체이므로 미지급 ↔ 지급 정정도 이 계약이다(I-26의 형태를 새 결과로 다시 지난다).
- 규칙은 §5.14의 한 행과 같다 — V-27(그 기록 자신을 뺀 「아직 기록되지 않았고」) · V-28(지급일 중복도 그 기록 자신을 뺀다 — b1 개정) · V-23 · V-24ⓐ · V-11. 원천징수 기본값도 같다(`withholdingFor(…, 'paymentDate')` — §5.5가 §5.4를 따르는 것과 같다). **오류 경로는 색인 없는 필드 이름**이다(`withholdingTax` · `paymentDate` — 한 행이다).
- W-05 — 영향 행 수가 1이 아니면 성공을 주장하지 않는다.

**`deleteCouponPayments` — 한 상품의 기록 1..60건.**

- **사전 조회 뒤 한 문장이다** *(b1 개정 — §9 ⑪ 해결)*. 사전 조회가 `ids` 전부가 그 상품의 기록인지 먼저 본다 — 다른 상품의 id가 섞이면 지우기 전에 거부한다. 그 뒤 **`DELETE … WHERE els_id = $1 AND id = ANY($2)` 한 문장**으로 지운다 — 한 문장은 원자적이다(쓰기 함수가 필요하지 않다). **영향 행 수가 `ids`의 길이와 다르면 `CONFLICT`다** — 사전 조회와 DELETE 사이에 다른 요청이 그 기록을 지웠거나 옮겼다는 뜻이고, `requireAffected`(W-05 — 「그 사이에 상태가 바뀌었다. 화면을 갱신한다」)와 같은 판정이다. `els_id = $1` 조건이 있으므로 그 사이 다른 상품으로 옮겨진 기록은 지우지 않는다. 남는 상태는 「요청한 기록 중 아직 그 상품에 있던 것이 전부 지워졌다」이고 사용자는 화면을 갱신해 확인한다.
- **「월수익 기록 전부 지우기」도 이 계약이다** — 그 상품의 기록 id 전부를 싣는다. `FULL` 상품은 기록 수가 일정 행 수 이하이고 일정은 60행 이하이므로(V-26) 한 번에 된다. 기실현 월지급의 순번 없는 기록도 상품당 60건 이하이므로(V-27 — b1 개정, §9 ⑫ 해결) 한 번에 된다.
- **삭제 동선은 최대 3단계다** — 월수익 기록 전부 지우기(이 계약) → 상환 취소(§5.5) → 상품 삭제(§5.3). `monthly_coupon_payments.els_id`가 `RESTRICT`다(DOC-002 DQ-14). 지급 기록은 확정 과세 이력이고, 지우면 흐름 끝 안의 그 달은 다시 추정(「미기록」)이 된다 — 그 해의 F가 바뀐다(§5.5의 「세액 영향」과 같은 부류다).
- 기록을 지우면 그 달의 일정 동결도 풀린다 — 평가일 · 지급일을 고치거나 그 달을 입력에서 빼 지울 수 있게 된다(§5.2 — 기록된 달이 입력에서 빠지면 사전 검사가 `CONFLICT`다, b1 개정).

**무효화**: 두 계약 모두 `COUPON_RECORD_WIDE`(§5.14 각주). **왕복**은 b2 실측(§5.0.1 각주 — `updateCouponPayment`는 기록 `id`로 부모를 찾는다).

---

## 6. 검증 규칙

`VALIDATION_FAILED` 응답의 `fields`에 필드명과 사유를 담는다.

| ID | 대상 | 규칙 |
|---|---|---|
| V-01 | `principal` | 0보다 크다. 자릿수는 V-23이 본다 — 종전 「정수」는 V-23의 원화 경우다 *(v4.11 — P8 컷 a2)* |
| V-02 | `underlyings` (`createProduct`·`updateProduct`) | 1개 이상 (I-07). v0.9부터 쓰기 함수가 함께 강제한다 |
| V-03 | `schedules` (`createProduct`·`updateProduct`) | 1개 이상, 그리고 길이 = 입력의 `totalRounds` (I-07). 1개 이상은 v0.9부터 쓰기 함수가 함께 강제한다 — **`totalRounds` 대조는 계약 계층에만 있다**(저장되지 않는 값이므로 DB가 볼 수 없다) |
| V-04 | `roundNo` | 1부터 연속, 중복 없음 (I-03) |
| V-05 | `lizardBarrier` | 존재 시 `barrier` 이하 (I-04) |
| V-06 | `lizardCouponRate` | `lizardBarrier` 존재 시 필수 |
| V-07 | `evaluationDate` | 차수 순으로 증가. 최초 차수 ≥ `issueDate` |
| V-08 | 비율 필드 | 상한은 전부 `x ≤ 2`. 하한은 필드별로 다르다 — `annualCouponRate`·`barrier`·`lizardBarrier`·`kiBarrier`는 `x > 0`, **`lizardCouponRate`는 `x ≥ 0`** (아래) |
| V-09 | `assetId` | 상품 내 중복 불가 (I-02) |
| V-10 | `redemptionDate` | `issueDate` 이후 |
| V-11 | `taxableIncome` | 0 이상 (I-12) |
| V-12 | `MATURITY_LOSS` | `taxableIncome = 0` 강제 (I-08, DOC-007 §4.4) |
| V-13 | `roundNo` (상환) | `EARLY`·`LIZARD`인 경우 필수 (I-14) |
| V-14 | `LIZARD` | 해당 차수가 실재하고(I-13) 그 차수에 리자드 조건이 정의되어 있어야 함 |
| V-15 | `price` · **`basePrice`** | 0보다 큼 (v0.9에서 `basePrice` 추가 — 아래) |
| V-16 | `kiObservation` | `kiBarrier` 존재 시 필수. 부재 시 입력 불가 (I-11) |
| V-17 | `asOfDate` | 미래 일자 거부. 기준일 이후의 시세·환율은 존재할 수 없다(§5.7 · §5.13 — 환율은 v4.13) |
| V-18 | `kiTouchedAt` | `kiBarrier` 부재 시 입력 불가 (I-15) |
| V-19 | 문자열 필드 | 열 선언 길이 이내. `currency`는 정확히 3자 대문자 |
| V-20 | 정수 필드 | `smallint` 범위 이내(`roundNo`·`sequence`·`evaluationPeriodMonths`·`totalRounds`·`year`). `evaluationPeriodMonths ≥ 1`, `year`는 4자리 |
| V-21 | `provider` | **코드가 아는 공급자 id여야 한다.** 형식만 보지 않는다 — 아무 문자열이나 저장되면 그 매핑은 「영구히 쓰이지 않는 행」이 되고, 화면은 「자동 수집됨」으로 읽히는데 실제로는 아무 일도 일어나지 않는다(오타 하나가 만드는 조용한 상태). 대조 대상은 **수집 레지스트리가 아니라 전체 명부**다 — §5.12 ★★★ |
| V-22 | `currency` (상품 통화) | `KRW`·`USD` 중 하나여야 하고 **기본값이 없다** — 빈 값은 오류다. V-19의 `currency`(기초자산 통화 — §5.10)와 다른 필드다(DOC-005 §8.11). 대상 §5.1·§5.2·§5.11 *(v4.11 — P8 컷 a2)* |
| V-23 | 상품 통화 금액 (`principal` · `grossAmount`) | 소수 자릿수가 **상품 통화의 보조단위 이내**(KRW 0 · USD 2)이고 정수부가 15자리 이내. 통화는 `principal`·기실현이면 같은 입력의 `currency`, 상환(§5.4·§5.5)이면 **부모 상품의** `currency`다. `currency`가 V-22를 어기면 판정하지 않는다. 통과한 값은 보조단위 고정 자릿수로 정규화해 저장한다. **`taxableIncome`·`withholdingTax`는 통화와 무관하게 원화 정수다**(V-11·V-19) *(v4.11 — P8 컷 a2)* |
| V-24 | 환율 (`exchangeRate`) | ⓐ 적용 환율(§5.4·§5.5·§5.11, 참고값): 선택이며, 있으면 0보다 크고 정수부 12자리 · 소수 6자리 이내이고 **상품 통화가 외화일 때만** 둘 수 있다 — 원화 상품이면 거부한다. 과세 금융소득·원천징수세액을 이 값으로 산출하지 않는다. ⓑ 환율 입력(§5.13): `rate`는 **필수**이고 ⓐ와 같은 수치 규칙(0 초과 · 정수부 12자리 · 소수 6자리 이내)이며, `currency`는 **지원 외화(`USD`)만** — `KRW`는 거부한다(`exchange_rates_currency_check`가 두 번째 겹) *(v4.11 — P8 컷 a2 · ⓑ v4.13 — 컷 a3)* |

> **V-20에 `totalRounds`를 추가했다 (v1.1).** 구현은 처음부터 `min: 1` + `smallint` 상한으로 검사하고 있었는데 대상 목록에만 빠져 있었다. 규칙 신설이 아니라 누락 정정이다 — `totalRounds`는 저장되지 않으므로(DQ-05) DB가 볼 수 없고, 이 검사가 유일한 방어다.

> **셰이프 파싱은 필드가 속한 규칙의 ID를 재사용한다 (v1.1).** `inputs.ts`의 형태·열거·boolean 검사는 §6에 대응 규칙이 없으므로 그 필드를 다루는 규칙 ID를 빌린다 — 예컨대 `accountType`의 열거값 검사는 `V-19`로, `redemptionType`의 열거값 검사는 `V-13`으로 기록된다. **§6에 형태 규칙을 신설하지 않는 것이 의도다.** 이 표는 도메인 검증 규칙의 정본이고, 코드 사정으로 행을 늘리면 `RULE_IDS`가 §6에서 파생된다는 방향이 뒤집힌다.
>
> 그 대가를 적어 둔다. **20개 안에서의 오태그는 어떤 단언도 잡지 못한다** *(v4.16 — 수가 낡았다: a2부터 24개, P8 뒤 29개다. 「20개를 전수 확인」은 P3b.5 당시의 수다. 규칙이 늘수록 오태그의 후보가 는다)*. `tests/db/docs-contract.test.ts`가 "§6에 없는 ID는 존재할 수 없다"를 강제하고 `RuleId` 타입이 오타를 막지만, 둘 다 *어느* ID를 골랐는지는 보지 않는다. P3b.5 감사가 20개를 전수 확인한 결과 **오태그만으로 덮이는 규칙은 현재 없다**(모든 규칙에 자기 내용을 검사하는 케이스가 하나 이상 있다). 새 필드 검사를 쓸 때 ID는 이 표에서 고르고, 마땅한 것이 없으면 그 필드가 다루는 도메인 규칙을 먼저 찾는다.

> **V-08의 의도.** 사용자가 `90`을 입력했는데 정규화되지 않고 전달되면 배리어가 9000%가 된다. 상한 검사로 이런 유입을 차단한다.

> **V-08을 필드별로 세분했다 (v0.9, U-03).** v0.8까지 이 규칙은 "비율 필드는 `0 < x ≤ 2`"였다. 그 하한이 **DOC-007 §4.1과 충돌한다** — §4.1은 "원금만 상환되는 리자드 변형은 `'0'`으로 표기하며 `null`로 표기하지 않는다"고 규정하고 `applicableCouponRate`가 `null`을 거부하는 근거로 그 문장을 쓴다. 즉 `lizardCouponRate = 0`은 명세가 요구하는 정상 입력인데 검증이 거부하게 되어 있었고, 그 결과 원금상환형 리자드는 **어느 값으로도 저장할 수 없는 상태**가 된다(`0`은 V-08이, `null`은 V-06·I-10이 거부한다).
>
> 하한을 필드마다 따로 두는 것이 옳은 이유는 0의 의미가 다르기 때문이다. 배리어 0은 "어떤 시세에서도 충족"이라는 무의미한 조건이고 연쿠폰율 0은 수익이 없는 상품이므로 둘은 입력 오류로 보는 것이 맞다. 반면 리자드 쿠폰율 0은 **실재하는 상품 구조**다.

> **V-15에 `basePrice`를 추가했다 (v0.9, U-03).** v0.8까지 V-15의 대상은 `price` 하나였고 **기준가격에는 어떤 규칙도 없었다.** 그런데 DOC-007 §3.1의 `underlyingRatio`는 기준가격이 등락률의 분모이므로 `0` 이하를 `RangeError`로 거부한다. 즉 `basePrice = 0`인 행이 저장되면 그 상품을 읽는 **모든 조회가 던지고**, 조회 계층은 그것을 상태로 바꾸지 않는다 — `integrityIssue`는 하위 행 0건만 다루므로 이 경우는 걸러지지 않고, 모든 SELECT가 `using (true)`이므로 **남의 결함 상품 1건이 목록을 전원에게 죽인다.** AQ-17의 조회 절이 막으려던 바로 그 결과이며, 그것을 막는 유일한 층이 입력 검증이다. DQ-06의 값 범위 승격 목록에도 `base_price > 0`이 없으므로 DB 층에도 없다.

> **V-19·V-20을 신설한 이유 (v0.9).** 두 규칙이 없으면 초과 입력이 DB까지 가서 `22001`(길이)·`22003`(자릿수)로 거부되는데, **그 코드는 어느 열이 원인인지 말하지 않는다.** §3.2.1이 두 코드를 `VALIDATION_FAILED`로 매핑하면서도 "필드를 특정할 수 없는 경우가 있다"고 적은 자리가 여기다 — 필드별 오류 표시가 §3.2의 `VALIDATION_FAILED` 정의인데 그것을 채울 수 없는 응답이 나온다. `currency`는 특히 조용하다: `char(3)`이 짧은 값을 **공백으로 채워** 저장하므로 오류조차 나지 않는다.

> **V-03은 저장된 값과 대조하지 않는다 (v0.6).** DOC-002 v0.5가 `total_rounds` 컬럼을 삭제했으므로(DQ-05) `totalRounds`는 입력 안에만 존재하고, V-03은 **같은 입력의 두 필드를 서로 대조**한다. 자기 검증처럼 보이지만 의미가 있다 — 총 차수는 사용자가 직접 입력하고 배리어 스케줄(`90-85-80-…`)은 일괄 파싱되므로, 파싱 결과의 길이가 입력한 차수와 다르면 그것은 파서나 입력의 오류다. 저장 후에는 일정 행 수가 곧 총 차수이므로 대조할 대상이 없다.

> **V-17을 DB 제약으로 두지 않는 이유.** `CHECK (as_of_date <= current_date)`는 만들 수 없다 — `current_date`는 IMMUTABLE이 아니므로 CHECK 표현식에 쓸 수 없고, 넣더라도 오늘 유효했던 행이 내일 제약을 위반하는 상태가 된다. 계약 계층 검증으로 둔다. 미래 일자 시세는 워스트오브를 실제와 다르게 만들어 존재하지 않는 조기상환을 표시하게 하므로, 입력 시점에 막는 것이 유일한 방어다.

#### P8 달러 — 규칙 넷 (v4.9 선행 명세 — P8 컷 a1. **표 행은 컷 a2의 코드 커밋에 함께**)

위 표에 지금 행을 더하지 않는다 — `tests/db/docs-contract.test.ts`가 이 표를 **순서까지** 파싱해 `RULE_IDS`와 대조하므로 행이 코드보다 먼저 서면 그 커밋이 빨간불이다(V-21 v3.6의 선례). 컷 a2가 아래 문언으로 V-01 행을 고치고 V-22~V-24를 **V-21 뒤에 이 순서로** 붙이며, 같은 커밋에 `RULE_IDS`·`RULE_TARGETS`·`CASES`(`tests/db/validate.test.ts` — 양방향)가 움직인다. V-24의 `saveExchangeRate` 몫(ⓑ)은 그 계약이 서는 컷 a3에서 문언에 더한다 *(v4.13 — 더했다. 위 표 V-24 행의 ⓑ)*.

- **V-01′** `principal` — **0보다 크다.** 자릿수는 V-23이 본다 — 종전 「정수」는 V-23의 원화 경우가 된다. 대상 계약은 §5.1·§5.2·§5.11. 기존 케이스 「원금에 소수점은 거부된다」는 원화 한정으로 좁히고 V-23으로 다시 태그한다.
- **V-22** `currency` (상품 통화) — **`KRW`·`USD` 중 하나여야 하고 기본값이 없다** — 빈 값은 오류다. 형식만 보지 않는 이유는 V-21과 같다(아무 문자열이나 받으면 DB의 enum이 막기는 하지만 `22P02`는 필드를 특정하지 못한다). 원화로 채우지 않는 이유는 §5.1. 대상 계약은 §5.1·§5.2·§5.11이다. **V-19의 `currency`(기초자산 통화 — `assets.currency char(3)`, §5.10)와 다른 필드다**(DOC-005 §8.11) — 키 이름이 같지만 계약이 달라 한 입력에 함께 오지 않는다. 셰이프 파싱의 열거 검사도 이 ID를 빌린다(위 「셰이프 파싱은 필드가 속한 규칙의 ID를 재사용한다」).
- **V-23** 상품 통화 금액(`principal`·`grossAmount`) — **소수 자릿수가 상품 통화의 보조단위 이내**(KRW 0 · USD 2)이고 **정수부가 15자리 이내**다. 통화는 `principal`이면 같은 입력의 `currency`, 상환(§5.4·§5.5)의 `grossAmount`면 **부모 상품의** `currency`, 기실현(§5.11)이면 같은 입력의 `currency`다. **`currency`가 V-22를 어기면 판정하지 않는다** — 어느 자릿수로 볼지 모르는 채로 판정하면 V-22의 오류 하나가 두 칸의 오류가 된다. **`taxableIncome`·`withholdingTax`는 이 규칙의 대상이 아니다** — 통화와 무관하게 원화 정수이며 종전 형식 검사(정수 · V-11의 0 이상)가 그대로다. 정수부 한도는 종전 `numeric(15,0)`의 천장을 옮긴 것이다 — typmod를 떼면(DOC-002 M-08) DB가 `22003`(열 이름 없음)으로 거부하던 자리가 이름 있는 `CHECK`·트리거(§3.2.1)가 되지만 **필드별 오류는 여전히 계약이 먼저 낸다**(V-20의 근거와 같다).
- **V-24** 환율 — ⓐ **적용 환율**(`exchangeRate` — §5.4·§5.5·§5.11, 참고값): 선택이며, 있으면 **0보다 크고 정수부 12자리 이내 · 소수 6자리 이내**이고 **상품 통화가 외화일 때만** 둘 수 있다 — 원화 상품이면 거부한다(저장되지 않을 값을 조용히 버리지 않는다). 과세 금융소득·원천징수세액을 이 값으로 산출하지 않는다. ⓑ **환율 입력**(§5.13 `rate`, 컷 a3): 같은 수치 규칙이고 `currency`는 **지원 외화**(`USD`)여야 한다 — `KRW`는 거부한다(1원 = 1원은 관측이 아니다. `exchange_rates_currency_check`가 두 번째 겹이다). 그 계약의 `asOfDate`는 V-17이다. 6자리는 저장 정밀도(`numeric(18,6)`)와 같다 — 넘으면 DB가 조용히 반올림한다(AQ-16과 같은 부류). **정수부 12자리도 같은 열 선언에서 나온다**(18 − 6) — 넘으면 DB가 `22003`(열 이름 없음)으로 거부해 필드 없는 오류가 되므로 계약이 먼저 필드별로 낸다(V-23의 정수부 한도와 같은 이유).

#### P8 월지급 — 규칙 일곱 (V-08′ · V-20′ · V-25~V-29) (v4.16 선행 명세 — P8 컷 b1. **표 행은 코드 커밋에 함께** — V-08′·V-20′·V-25~V-28은 b2, V-29는 b4)

위 표에 지금 행을 더하지 않는다 — 달러 넷과 같은 이유다(`tests/db/docs-contract.test.ts`가 표를 **순서까지** `RULE_IDS`와 대조한다). 컷 b2가 아래 문언으로 V-08 · V-20 행을 고치고 V-25~V-28을 **V-24 뒤에 이 순서로** 붙이며, 같은 커밋에 `RULE_IDS` · `RULE_TARGETS` · `CASES`(`tests/db/validate.test.ts` — 양방향)가 움직인다. V-29는 그 계약 규칙이 서는 b4에서 붙인다 — DB 겹(`redemptions_monthly_principal_only`)은 b2에 먼저 선다(§3.2.1). **표로 쓰지 않는다** — 같은 머리글의 표가 둘이면 그 파서가 「같은 헤더가 둘 이상이다」로 빨간불이다.

- **V-08′** 비율 필드 — `annualCouponRate`의 하한 `x > 0`은 **상환 시 지급**의 규칙이다. **월지급식(`MONTHLY`) FULL이면 `annualCouponRate = 0`이다**(DOC-002 DQ-11 · I-23 — 수익은 전부 월수익 연쿠폰율에서 나온다. 0이 아니면 헤드라인 율이 상환 시 일괄 쿠폰으로도 읽혀 예상 수령액이 월수익만큼 **이중 계상**된다 — DOC-005 「월수익 연쿠폰율」). 상환 시 지급은 종전 규칙 그대로다. 월수익 쪽 두 비율의 범위는 V-25(월수익 연쿠폰율 > 0 — 상한은 연쿠폰율과 같은 V-08의 `x ≤ 2`) · V-26(월수익 배리어 0 초과 1 이하)이 정한다 *(월수익 연쿠폰율의 상한은 b1 개정 — §9 ⑬ 해결. DB는 `> 0`만 본다 — 율 범위 `CHECK`가 없다, 받아들인 이탈)*. *v4.8 §9의 「V-08(월수익 비율 필드 추가 …)」를 이 문언으로 좁혔다.*
- **V-20′** 정수 필드 — 대상에 **`couponNo`**를 더한다: `smallint` 범위 이내이고 **1 이상**이다(DOC-002 I-24 · I-26의 `coupon_no >= 1` `CHECK` — `redemption_schedules.round_no`에 없던 하한을 새 테이블에서 되풀이하지 않는다, DOC-010 AQ-92). 대상은 §5.1·§5.2의 `couponSchedules[].couponNo`와 §5.14의 `entries[i].couponNo`(`null`이 아니면)다. *v4.8 §9의 「V-20(`couponNo`)」 그대로다. b1 결정의 「V-20 정의에 지급방식 조건을 더한다」는 이 해석으로 받아들여졌다(b1 개정) — 지급방식 조건은 V-25가 진다.*
- **V-25** 쿠폰 지급방식 ⇔ 월수익 조건 — `couponPayout`은 `AT_REDEMPTION`·`MONTHLY` 중 하나이고 **기본값이 없다** — 빈칸은 그 칸의 오류다(V-22와 같은 형태 · DOC-001 U7). **`MONTHLY` FULL** ⇒ 월수익 연쿠폰율 > 0이고 V-08의 상한(`x ≤ 2`) 이내(b1 개정) · 월수익 일정 ≥ 1행 · 리자드 차수 없음(월지급+리자드는 v2) · 연쿠폰율 0(V-08′). **`AT_REDEMPTION`** ⇒ 월수익 연쿠폰율 없음 · 월수익 일정 없음. 대상 §5.1·§5.2·§5.11(§5.11은 지급방식 하나 — 기실현은 율도 일정도 받지 않는다). DB 겹은 `els_products_monthly_terms_check`(I-23)와 쓰기 함수 꼬리 검사 셋(I-25 — §3.2.1). 셰이프 파싱의 열거 검사도 이 ID를 빌린다.
- **V-26** 월수익 일정 — **1..60행** · 월수익 순번 **1..K 연속** · 월수익 평가일 **엄격 증가** · 발행일 이상 · **만기(마지막 차수 평가일) 이하** · 월수익 지급일 ≥ 월수익 평가일 · 월수익 배리어 **0 초과 1 이하**. 대상 §5.1·§5.2의 `couponSchedules`. **§5.2에서도 입력에 적용한다 — 쓰기 함수가 입력에 없는 순번을 지우므로 입력이 곧 저장 결과다**(b1 개정). 기록된 달이 입력에서 빠지는 것은 이 규칙이 아니라 §5.2의 사전 검사(`CONFLICT` — 상태 충돌)가 막는다. DB 겹은 I-24(`UNIQUE(els_id, coupon_no)` · `coupon_no >= 1` · 배리어 하한 · `payment_date >= evaluation_date`)뿐이다 — **연속 · 증가 · 발행일 · 만기 · 배리어 상한 1은 계약에만 있다**(V-04 · V-07과 같은 처지 — 직접 호출 우회는 AQ-29 부류). 행 오류는 `couponSchedules[i].<필드>`로 색인한다(계약 계층 — §3.2.1 「배열 인덱스」는 DB 사상의 규칙이다).
- **V-27** 기록 대상 — 부모 상품이 `MONTHLY`여야 한다. **FULL** ⇒ 월수익 순번이 그 상품의 일정에 있고, 그 월수익 평가일 ≤ 기준일이며, 아직 기록되지 않았고(입력 안의 중복 포함 — §5.15는 그 기록 자신을 뺀다), **상환이 있으면 그 달의 월수익 평가일 ≤ 상환일**(b1 개정 — 비교 키는 흐름 끝과 같은 평가일이다. 지급일이 아니다 — DOC-007 RD-18 해결). FULL의 조건은 **지급 · 미지급 공통이다** — 결과를 가리지 않는다. **REALIZED_ONLY** ⇒ 순번 `null` · `PAID`만 · **상품당 60건 이하**(b1 개정 — 일괄 기록 · 「월수익 기록 전부 지우기」의 1..60과 맞춘다). 순번 없는 기록은 평가일이 없어 상환일 비교 밖이다. **양방향이다** *(b1 개정)* — 상환 쪽(§5.4 · §5.5 · §5.11)도 같은 사실을 반대에서 본다: 「상환일 ≥ 기록된 달(`PAID` · `UNPAID`)들의 월수익 평가일 최댓값」, 어기면 `fields.redemptionDate`. **두 방향이 같은 집합을 본다** *(b1 개정 — 반박 검토 반영. 종전 상환 쪽은 `PAID`만 보아 흐름 끝 뒤에 고칠 수 없는 미지급 기록이 남을 수 있었다)*. 새 규칙 ID를 두지 않는다. 대상 §5.14·§5.15 · (상환 쪽) §5.4·§5.5·§5.11 — **상환 쪽 몫도 b2다**(이 행이 b2에 서므로). DB 겹은 I-27 트리거 셋 · `redemptions_before_coupon_payment` · `UNIQUE` 둘 · 복합 FK(§3.2.1) — 60건 상한은 계약에만 있다. **SCR-206 기본 목록은 기록 없는 달 중 `t_k ≤ min(기준일, T_end)`이다**(DOC-008 SCR-206 — b1 개정) — 상환된 상품은 `T_end`가 상환일이므로 이 규칙의 두 상한(기준일 · 상환일)과 같고, 「상환 후 없음」 달을 기록 대상으로 내보이지 않는다. 평가는 끝났고 지급일 전인 달은 V-28 때문에 미지급만 적을 수 있다.
- **V-28** `PAID`/`UNPAID` 형태 — **`PAID`**: 지급일 · 세전(상품 통화 자릿수 — V-23) · 과세(V-11) 필수, **지급일 ≤ 기준일**(아직 오지 않은 지급은 기록하지 않는다 — V-17과 같은 이유로 DB 제약이 아니다), FULL이면 **지급일 ≥ 그 달 월수익 평가일**, 그리고 **지급일은 그 상품의 다른 `PAID` 기록 · 같은 입력의 다른 행과 겹치지 않는다** → `entries[i].paymentDate`에 `VALIDATION_FAILED`(§5.15는 자기 자신을 빼고 키는 `paymentDate`) *(b1 개정 — 반박 검토 반영)*. **`UNPAID`**: 금액(세전 · 과세 · 원천징수) · 지급일 · 환율이 없다. 대상 §5.14·§5.15. DB 겹은 `monthly_coupon_payments_outcome_check`(I-26)와 값 범위 셋, 지급일 중복은 `UNIQUE(els_id, payment_date)`다 — 계약이 먼저 보지 않으면 입력 실수가 행 키 없는 `CONFLICT`(상태 충돌 — 「화면을 갱신한다」)로 돌아온다. 기실현 「빈 행 추가」는 순번이 없어 이 검사가 유일한 중복 방어다(V-09가 자산 중복을 계약에서 잡는 것과 같은 자리).
- **V-29** 월지급식 상품의 상환 — **세전 ≤ 투자원금 ∧ 과세 금융소득 0**. 대상 §5.4·§5.5·§5.11. 같은 날의 그 달 월수익은 상환에 합치지 않고 §5.14로 적는다(DOC-001 U6 · 검산 B-2 · B-3). DB 겹은 `redemptions_monthly_principal_only`(§3.2.1 — DOC-010 AQ-87 ⓑ). 만기 손실(`MATURITY_LOSS`)의 V-12(과세 0)와 겹쳐도 충돌하지 않는다 — 둘 다 0을 요구한다.

**대상 확장 셋 — 새 ID가 아니다.** V-23(상품 통화 금액)의 대상에 §5.14·§5.15의 `grossAmount`(통화는 **부모 상품의** `currency`), V-24ⓐ(적용 환율)의 대상에 기록의 `exchangeRate`, V-11(과세 0 이상)의 대상에 기록의 `taxableIncome`을 더한다. 문언은 각 행의 「대상」 칸에 b2가 더한다.

---

## 7. Route Handler

### 7.1 시세 배치 수집

```
GET /api/cron/prices
```

| 항목 | 내용 |
|---|---|
| 호출자 | Vercel Cron (일 1회, **UTC**) |
| 메서드 | **`GET`** — 플랫폼 강제다. 아래 각주 |
| 인증 | `Authorization: Bearer <CRON_SECRET>` (SEC-04). **Vercel이 자동으로 붙인다** |
| 대상 | **미상환 상품이 참조하는 기초자산만** |
| 응답 헤더 | **캐시 금지 3종을 반드시 싣는다** — 아래 CR-09 |
| 운영 | 스케줄·리전·로그 보존은 DOC-013 §6·§7 |

> **`POST` → `GET`으로 정정했다 (v2.7, U-03). 플랫폼 강제이며 설계 변경이 아니다.**
> **인용**(vercel.com/docs/cron-jobs — 재보지 않았다. 정본은 DOC-013 §6.1) —
> 「To trigger a cron job, Vercel makes an HTTP **GET** request to your project's
> **production deployment** URL」(vercel.com/docs/cron-jobs). 즉 `POST`로 정의하면 Cron이
> 이 경로를 부를 수 없다. **부수 사실 둘이 함께 확정됐다:** 타임존은 **항상 UTC**이고,
> 호출 대상은 **production 배포뿐**이다(그래서 ADR-006의 `preview` 행이 애초에 성립하지
> 않았다 — DOC-013 §2.2).
>
> **`GET`이 부수 효과를 갖는 것은 여기서 의도된 예외다.** 정당화는 셋이다 — ⓐ 플랫폼이
> 메서드를 고른다 ⓑ **멱등이다**(CR-03·CR-05) ⓒ 토큰 없이는 401이므로 크롤러·프리페치가
> 실행시킬 수 없다. 그리고 **캐시되면 안 되는 이유가 여기서 두 배가 된다**(CR-09).

**응답**

```ts
type CronResult = {
  executedAt: string                    // ISO 8601
  targetCount: number
  succeeded: number
  failed: Array<{ assetId: string; reason: string; failure: 'NO_DATA' | 'CALL_FAILED' }>
  skipped: number                       // 기준일 데이터 이미 존재 (CR-05)
  unmapped: number                      // 공급자 매핑이 없다 — 실패가 아니다 (v3.5)
}
```

> **★ `unmapped`를 신설한다 (v3.5, P5a 컷 0). 없으면 수가 «맞지 않거나» 결함이 보이지 않는다.**
>
> 미매핑 자산은 **실패가 아니다** — ADR-007이 「수동 입력은 폴백이 아니라 설계된 정상 경로」로
> 못박았으므로 `failed[]`에 담으면 정상 상태가 오류로 보고된다. 그런데 그 자산도
> 「미상환 상품이 참조하는 기초자산」이므로 `targetCount`에는 들어간다. 즉 **셋 중 하나다:**
>
> | 선택 | 결과 |
> |---|---|
> | `failed[]`에 담는다 | 정상 상태가 매일 오류로 보고된다. ST-03 위반 |
> | `targetCount`에서 뺀다 | **매핑이 지워진 것이 보이지 않는다** — 대상이 조용히 줄고 카운터는 전부 초록이다 |
> | **`unmapped`로 «센다»** | 합이 맞고 결함이 드러난다 |
>
> 둘째가 위험한 이유가 절대 규칙 #6의 형태이며 **여기서 줄어드는 객체는 「매핑 행」**이다.
> 그래서 불변식을 값으로 단언할 수 있게 만든다 —
> **`targetCount === succeeded + skipped + unmapped + failed.length`.**
> 그리고 이 숫자가 **DOC-008 SQ-08 표식의 데이터 원천**이다(「자동 감시되지 않는 자산이
> 몇 개인가」에 답할 수단이 없으면 그 표식을 화면에 세울 수 없다).
>
> **`failed[].failure`도 함께 싣는다** — 부류가 `reason` 문구 안에만 있으면 화면이 **문구를
> 파싱해야** 두 조치를 갈라 표시할 수 있다. ADR-004 보정이 어댑터에서 판별 가능한 값으로
> 만든 것을 계약 경계에서 다시 문자열로 접으면 그 노력이 여기서 사라진다.

`failed[].reason`은 **두 부류로 갈린다**(DQ-02) — 사용자의 조치가 다르기 때문이다.

| 부류 | 무엇인가 | 사용자의 조치 |
|---|---|---|
| **데이터 없음** | 공급자가 그 심볼의 그날 데이터를 주지 않았다 — 휴장 · 상장폐지 · **심볼 오류** | **매핑을 고친다**(SCR-302) 또는 그냥 정상(휴장) |
| **호출 실패** | API 호출 자체가 실패했다 — 네트워크 · 인증 · 한도 초과 | **기다린다.** 고칠 것이 없다 |

> **이 분류는 어댑터가 구분해 주지 않으면 만들 수 없다.** ADR-004 보정이 반환에
> `failure: 'NO_DATA' | 'CALL_FAILED'`를 넣는 이유가 이것이며, 문자열이 아니라 **판별 가능한
> 값**이어야 두 부류가 층을 넘어 살아남는다(V-18이 층마다 다른 칸을 가리켰던 함정과 같은 형태).

**동작 규칙**

| ID | 규칙 | 근거 |
|---|---|---|
| CR-01 | 헤더 부재·토큰 불일치 시 **401**. 처리하지 않음 | SEC-04 |
| CR-02 | 부분 실패가 전체 배치를 중단시키지 않음. 실패는 `failed[]`에 담기고 응답은 **`ok`** | — |
| CR-03 | 중복 실행 안전. **두 겹이다** — 기준일 행 사전 확인(CR-05)과 `UNIQUE(asset_id, as_of_date)`. 사전 확인은 **콜 절약**이고 최종 보장은 **제약**이다 | **중복 호출은 선택이 아니라 플랫폼 성질이다** — Vercel Cron 배달은 best-effort로 「누락도 중복도 가능」하며 재시도는 없다(**인용**, DOC-013 §6.1) |
| CR-04 | **감지와 진단을 가른다.** ⓐ **감지** — 배치가 조용히 죽은 것은 SCR-302의 `isStale`·`as_of_date`·`source`가 드러낸다(영속적이며 이미 구현돼 있다) ⓑ **진단** — 멱등성을 이용한 재호출이 `CronResult`를 **응답 본문**으로 준다 ⓒ **전면 실패** — 비2xx로 응답한다. `console.*` 로깅은 유지하되 **그것이 이 규칙을 성립시키는 수단은 아니다** | v2.7에서 재정의했다(U-03) — 아래 각주 |
| CR-05 | **같은 `(asset_id, as_of_date)`에 행이 있으면 쓰지 않는다. `source`와 무관하다.** 건너뛴 건수가 `skipped`다 | **v2.7에서 뒤집었다**(AQ-06 종결, U-03) — 아래 각주 |
| CR-06 | **`CRON_SECRET`이 미설정이거나 빈 문자열이면 500.** 401이 아니다 | 아래 각주 |
| CR-07 | **공급자 레지스트리가 비어 있으면 503** + 이유. 200 + 빈 `CronResult`가 아니다 | 아래 각주 |
| CR-08 | **공급자는 있으나 수집 로직이 없으면 배포 결함으로 다룬다** — §5.8의 `INTERNAL`과 **같은 판정**이어야 한다 | 아래 각주 |
| CR-09 | **캐시 금지 헤더 3종을 응답에 싣는다** — `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` · `Expires: 0` · `Pragma: no-cache` | 아래 각주 |
| CR-10 | **공급자는 등록됐으나 그 자격증명이 없으면 500 `INTERNAL`.** 503이 아니다 | 아래 각주 (v3.5 신설) |

> **CR-04를 재정의했다 (v2.7, U-03). 종전 문언이 배포 첫날부터 사문화이기 때문이다.**
> v2.6까지 CR-04는 「결과를 로깅한다. 무음 실패를 만들지 않음」이었다. **실측이 그것을
> 무너뜨린다** — Vercel Hobby의 런타임 로그 보존은 **1시간**이고(docs/logs/runtime Limits 표)
> Cron 정밀도는 **±59분**이다. 일 1회 배치의 `console.log`는 다음에 볼 때 사라져 있고,
> ±59분이라 「예정 시각 직후에 확인」도 성립하지 않는다.
>
> 목적을 둘로 가르면 하나는 **이미 영속적**이고 하나는 **요청 시점에 만들 수 있다.** 감지는
> 시세의 최신성(SCR-302)이 담당하고 — 그것이 배치 실패의 사용자 표면이다 — 진단은 멱등성을
> 이용한 재호출로 얻는다(건너뛴 자산은 `skipped`로 세어지므로 재호출이 상태를 바꾸지 않는다).
> **잔여를 정직하게 적는다:** 재호출은 「지금」을 알려 주고 **「그때」를 알려 주지 않는다** —
> 지나간 실행의 중간 실패 목록은 복원할 수 없다. 종결 후보는 `cron_runs` 테이블이며
> DOC-013 §7.2가 그 비용(테이블 12→13이 카탈로그·RLS·GRANT·권한 표를 끌고 온다)을 적었다.
>
> **CR-05를 뒤집었다 (v2.7, AQ-06 종결, U-03).** v2.6까지 CR-05는 「기존 `MANUAL` 값은 자동
> 수집 값으로 덮어쓴다(자동값 우선)」였다. **그 규칙과 같은 표의 `CronResult.skipped`(「당일
> 데이터 이미 존재」)가 양립하지 않았다** — AUTO가 항상 덮어쓰면 `skipped`는 영원히 0이고,
> 반대로 건너뛰면 CR-05가 실행되는 경로가 없다. **둘 중 하나가 죽은 명세였고** 그것은 §8.1이
> 분류한 부류(계약의 필드가 규칙과 어긋난다)의 재발이다.
>
> 정정 근거는 **충돌이 날짜 스코프라 영속하지 않는다**는 것이다 — 07-29의 수동 정정이 남아도
> 07-30은 `AUTO`가 정상적으로 채운다. 반대로 AUTO가 이기면 정정이 **하루만 살고**, 단일 자산
> 재수집 경로가 없어 되돌릴 수단도 없다. 부수 이득 셋: `skipped`가 실재하는 값이 되고 ·
> 사전 확인으로 공급자 호출을 건너뛰어 C-03에 유리하며 · 배치에 `asset_prices` **UPDATE가
> 불필요해져** AQ-11의 권한 한 칸이 함께 닫힌다.
>
> **★ 잘못된 `AUTO`의 정정 경로는 재수집이 아니라 §5.7 `saveManualPrice`다.** 적지 않으면
> 나중에 누가 「재실행으로 고칠 수 있어야 한다」며 skip 로직을 뚫고, 그러면 원점이다.
>
> **CR-06 — 미설정을 401로 뭉개지 않는다.** Vercel 공식 예제는
> `if (!cronSecret || authHeader !== …) return 401`이지만 이 프로젝트에서는 틀린 선택이다:
> 「비밀이 설정되지 않았다」(배포 결함, 내가 고친다)와 「토큰이 틀리다」(외부 호출, 고칠 것이
> 없다)가 같은 응답이 되면 **조치가 갈리지 않는다** — DOC-008 ST-06이 금지한 형태다.
> **빈 문자열도 미설정으로 다룬다**(`env.ts`의 기존 규약). 비밀에서 이 구분이 특히 중요하다:
> 빈 값이면 `Bearer `로 시작하는 **모든** 헤더가 일치한다. **어느 경우에도 「인증 없이 통과」는
> 없다.**
>
> **CR-07 — 공급자 0개를 200으로 답하지 않는다.** 200 + 빈 `CronResult`면 「할 일이 없었다」와
> 「공급자가 없다」가 같게 보인다. 503은 Vercel Cron 설정 화면의 마지막 실행 상태로 남으므로
> ~~**CR-04 ⓒ의 유일한 실행 경로**이기도 하다~~. P5a가 공급자를 등록할 때까지 이 응답이 매일
> 기록되는 것은 노이즈가 아니라 **정확한 상태 보고**이며, R-05의 의도된 이탈로 DOC-013 §6.4에
> 적었다.
>
> **★★ 위 취소선 둘을 정정한다 (v2.8) — 그 문장은 절반이 미검증이고 절반이 곧 거짓이 된다.**
>
> **앞 절반(「화면의 마지막 실행 상태로 남는다」)은 미실측이다.** 그 화면이 503을 「실패」로
> 표시하는지도, 보존 정책이 무엇인지도 확인하지 않았다. 확인할 컷이 **P5b 컷 4**였고 그 컷은
> 취소됐다(Vercel 토큰 미발급). 원장은 DOC-013 **§6.5**다.
>
> **뒤 절반(「CR-04 ⓒ의 유일한 실행 경로」)은 P5a가 착지하는 순간 거짓이 된다.** 그때
> `providerCount > 0`이므로 CR-07 갈래가 **도달 불가**가 되고, 남는 비2xx는
> **CR-06 하나뿐인데 그것은 실제 배포 결함**이므로 관측을 위해 만들 대상이 아니다. 그리고
> **CR-02가 부분 실패를 `ok`(200)으로 답한다.** 즉 **CR-04 ⓒ(「전면 실패 → 비2xx」)의 실행
> 경로가 0이 된다.**
>
> **이것이 무거운 이유:** v2.7이 CR-04를 「배포 첫날부터 사문화」에서 구한 논거가 **세 갈래
> 모두 살아 있는 수단을 갖는다**는 것이었다. **컷 4 취소 + P5a 착지가 겹치면 그 논거의 셋째
> 행이 무효가 되고 CR-04는 재정의 이전 상태로 절반 돌아간다.** DOC-013 §6.5가 등재한
> 대체 관측은 **ⓐ(감지)만 강화하고 ⓒ를 복구하지 못한다.**
>
> **지금 닫지 않는 이유와 종결 후보.** ⓒ의 자리를 메우려면 「전면 실패」를 **응답이 아니라
> 데이터로** 관측해야 하고 그것이 **DOC-013** §7.2의 `cron_runs`다 — 즉 **이 정정은 그 테이블의 세 번째
> 독립 근거**다(앞의 둘: 지나간 중간 실패의 사후 진단 · ~~호출자 판별~~).
>
> **★ 「호출자 판별」은 v3.8에서 철회했다 *(P5a 컷 5. U-03)*.** 운영이 ⓐ′(배치가 민서 자신의
> 계정을 재사용)로 정해져 `actor_id`가 모든 행에서 같으므로 **Cron·SCR-302 버튼·진단 `curl`을
> 가르지 못한다**(남는 `caller`는 요청이 스스로 주장하는 값이다). **근거 ①·③은 온전하므로 이
> 세 번째 근거는 그대로 서고 테이블도 정당하다** — DOC-002 §4.11 · DOC-013 AQ-69. 테이블 12 → 13이
> 카탈로그·RLS·GRANT·권한 표를 함께 끌고 오므로 문서 선행이 필요한 별개 결정이며, **P5a가
> 착지하기 전에 정해야 한다** — 착지 후에 정하면 그 사이의 실행이 관측되지 않는다.
>
> **CR-08 — 미러가 사라졌다 *(v3.7 정정, P5a 컷 3. 종전 문언은 취소선으로 남긴다 — U-03)*.**
>
> ~~Route Handler는 세션이 없어 §5.8을 **호출할 수 없으므로** 구조적 분기가 실재한다. 두
> 갈래만 미러하면 같은 상태가 UI에서 `INTERNAL`, cron에서 503이 되므로 **셋을 모두
> 미러한다.**~~
>
> **그 전제가 AQ-57 = ⓐ로 사라졌다.** 배치가 **GoTrue 계정으로 로그인하므로**
> `MutationContext`를 다른 사용자와 **정확히 같은 방식으로** 조립한다(`src/lib/db/batch.ts`).
> 즉 미러할 이유가 없다.
>
> ★ 종전에는 「배치가 **전용** GoTrue 서비스 계정을 가지므로」였다 — 운영이 ⓐ′로 정해지면서
> **「전용」이 거짓이 됐고 결론은 그대로다**(P5a 컷 5). 세션을 얻는다는 것이 하중을 지는
> 부분이고 그 계정이 새것인지 기존 것인지는 이 각주와 무관하다.
>
> ★ **그런데 「라우트가 §5.8을 호출한다」도 정확하지 않고, 그 차이가 설계다.** 두 계약의
> 반환 필드 집합이 갈리므로(§5.8에는 `assetName`이 있고 `targetCount`가 없다 · `CronResult`는
> 반대다 — 위 §5.8 각주의 「공통 코어의 두 투영」) **한쪽이 다른 쪽을 부를 수 없다.**
> 그래서 구현을 하나 두고 투영을 둘 둔다:
>
> | 층 | 무엇 |
> |---|---|
> | `src/lib/cron/collect.ts` | 순수 오케스트레이션 — CR-02·CR-05·DQ-02의 분기표. 포트 주입 |
> | `src/lib/db/mutations/collect.ts` | 포트 구현 + `cron_runs` 기록 + **`collectAndRecord`(공통 코어)** |
> | `src/lib/cron/report.ts` | 두 투영 — `toRefreshResult` · `toCronResult` |
> | `src/lib/cron/respond.ts` | `ErrorCode` → HTTP. **CR-07·CR-08·CR-09가 여기로 옮겨졌다** |
>
> **결과: 사전 판정(`decide.ts`)이 넷에서 «셋»으로 줄었다** — CR-06·CR-01·CR-10만 남는다.
> CR-07·CR-08은 판정이 아니라 **사상**이 되었고, 그 전수는
> `tests/cron/respond.test.ts`가 본다. `tests/app/cron.decide.test.ts`의 「글자까지 같다」
> 대조 블록은 **지웠다** — 갈릴 수 있는 두 벌이 애초에 없으면 대조할 것이 없다.
>
> ★★ **그리고 §5.8의 세 번째 갈래(「등록됐으나 수집 로직 없음」)는 이제 도달할 수 없다.**
> 등록과 수집기가 **같은 컷**에 왔기 때문이다(R-05 — 컷 1이 어댑터를 세우고도 등재하지 않은
> 이유가 정확히 그것이었다). CR-08이 답하는 것은 이제 **대상 조회 실패**(수집기가 던졌다)와
> **레지스트리 이상**(둘 이상 등재 — 대조 원천의 처리가 정의되지 않았다)이다.
>
> **CR-09 — Route Handler는 캐시 금지 헤더를 스스로 실어야 한다.** 서버 액션은 응답이 POST라
> Next가 캐시하지 않아 생략이 허용되지만(§5.0) Route Handler에는 그 보호가 없다. 그리고
> **`GET`이 되면서 위험이 두 배가 된다** — 정적 최적화되거나 CDN에 캐시되면 ⓐ 배치가 조용히
> 돌지 않고 ⓑ **Vercel 로그에도 남지 않는다**(**인용** — 「when cron jobs respond with a redirect
> or a cached response, they will not be shown in the logs」). 즉 `src/proxy.ts`의 매처가
> `api/cron`을 제외한 것과 **같은 부류의 조용한 죽음**이다. 이 요구는 v2.6까지 코드 주석에만
> 있었고 계약에 없었다.
>
> **CR-10 — 「공급자가 없다」와 「공급자의 열쇠가 없다」는 다른 상태다 *(v3.5 신설, P5a 컷 0)*.**
> 어느 문서도 이 갈래를 답하지 않았다. CR-06은 `CRON_SECRET` 전용이고, 공급자가 자격증명을
> 요구하는 순간(P5a) 같은 부류의 결함이 **두 번째 변수**에서 생긴다.
>
> **셋 중 무엇을 답하든 사용자가 듣는 말이 달라지고, 둘은 틀린 말이다:**
>
> | 선택 | 사용자가 듣는 말 | 왜 틀린가 |
> |---|---|---|
> | 503 `PROVIDER_UNAVAILABLE` | 「공급자가 등록되어 있지 않다. **수동 입력으로 갱신한다**」 | 공급자는 **등록되어 있다.** 고칠 것은 환경변수 하나인데 영구히 수동 입력을 하게 된다 |
> | 200 + 전부 `CALL_FAILED` | 「기다린다. 고칠 것이 없다」 | **가장 나쁘다** — 고칠 것이 있고, `isStale`은 5일 뒤에 **틀린 진단과 함께** 뜬다 |
> | **500 `INTERNAL`** | 「처리 중 오류가 발생했다」 + 본문의 `rule: 'CR-10'` | 「배포 결함, 내가 고친다」와 「외부 원인, 고칠 것 없다」가 **갈린다** |
>
> **근거는 CR-06의 것을 그대로 옮긴 것이다** — 둘을 같은 응답으로 뭉개면 조치가 갈리지 않고,
> 그것이 DOC-008 ST-06이 금지한 형태다. 대칭도 맞는다: `CRON_SECRET` 부재와 공급자 키 부재는
> **같은 부류의 배포 결함**이므로 같은 부류의 답을 받아야 한다.
>
> **★ 판정 순서가 규칙이다 — CR-07이 CR-10보다 앞이다.** 「등록된 공급자가 0개」인 상태에서는
> 열쇠를 물을 대상 자체가 없다. 뒤집으면 공급자가 없는 배포가 「키가 없다」로 보고된다.
>
> **★★ 그리고 이 규칙은 «레지스트리를 자격증명으로 세지 않는다»를 전제한다.** 키 없는 공급자를
> 명부에서 빼서 `providerCount`를 0으로 만드는 구현은 이 규칙을 **도달 불가**로 만들고 CR-07이
> 설정 결함을 흡수한다 — 관측되는 상태가 의도된 상태와 **똑같아지는** 형태이며, 절대 규칙 #6이
> 열거한 fail-open과 같다. 그래서 `providerCount`는 **코드가 등록한 정적 명부**에서 나온다.
>
> **CR-04 ⓒ를 구하지는 못한다** — v2.8이 이미 그 부류를 배제했다(「실제 배포 결함이므로 관측을
> 위해 만들 대상이 아니다」). 즉 **`cron_runs`의 세 번째 근거는 온전하다.** 적어 두지 않으면
> 나중에 「비2xx가 둘 생겼으니 그 테이블이 불필요하다」로 읽힌다.
>
> **★★★ 적용 범위 — 「쓰는 공급자」에만 걸린다.** 이 규칙의 대상은 `asset_prices`에 **쓰는**
> 공급자다. **대조 전용 원천은 여기 해당하지 않는다** — 그쪽의 자격증명이 없으면 대조를 하지
> 못할 뿐이고, 주 원천의 수집은 정상이므로 **500으로 답하면 건강한 배치를 죽인다.**
> 즉 대조 실패는 `outcome`을 바꾸지 않고 `cron_runs`에 값으로 남는다.
> **따라서 두 종류의 원천이 같은 레지스트리에 있으면 안 된다** — `providerCount`가
> 「쓰는 공급자의 수」라는 뜻을 잃고 CR-07·CR-10 둘 다 대상이 흐려진다.
> 그 분리의 구체 형태는 **P5a 컷 1c**에서 정한다(대조 원천이 처음 생기는 컷이다).
>
> **구현 시점은 P5a 컷 3이다.** 그때까지 이 ID는 `tests/app/cron.decide.test.ts`의
> `NOT_A_VERDICT`에 사유와 함께 등재된다 — CR-02·CR-05가 이미 쓰는 패턴이며, 그 등재가
> **「새 규칙이 응답 갈래인지 누군가 판단했다」의 기록**이다.

> **CR-02의 종단 관측은 P5a의 몫이다.** 공급자가 0개인 동안 **부분 실패는 존재하지 않으므로**
> 이 규칙은 P5b에서 실행되지 않는다. P5b가 관측하는 것은 CR-01·CR-03·CR-04·CR-05~09이며,
> CR-02는 스텁 어댑터로 일부 성공·일부 실패를 만드는 P5a 컷 3에서 처음 실행된다. 적어 두지
> 않으면 P5b가 끝난 뒤 「CR-02도 검증됐다」로 읽힌다.

> **이 엔드포인트를 §8 추적 매트릭스에 넣지 않는다.** 그 표의 주어는 **화면**이고 이것은
> 화면이 아니다. DOC-008 §4의 화면 목록에도 넣지 않는다.

---

## 8. 화면 – 계약 추적 매트릭스

| 화면 | 조회 계약 | 변경 계약 |
|---|---|---|
| SCR-001 로그인 | — | `signIn` (§5 밖 — `src/lib/auth/session.ts`) |
| SCR-101 홈 | `getDashboard` | — |
| SCR-201 목록 | `listProducts` | — |
| SCR-202 상세 | `getProduct` | `deleteProduct`, `deleteRedemption`, `updateRedemption`, `setKiTouched` |
| SCR-203 상환 | `getProduct` | `createRedemption` |
| SCR-204 등록·수정 | `getProduct`, `searchAssets` · 외부 조회(§4.10 — 등록·수정, v4.6) `searchKiwoomProducts`, `getKiwoomProductTerms`, `listKiwoomAssets` | `createProduct`, `updateProduct`, `createAsset`, `saveProviderSymbol`(불러오기의 자산 추가·연결 — v4.4) |
| **SCR-205 기실현 등재** | **—** | **`createRealizedProduct`** (§5.11) |
| SCR-301 일정 | `listSchedule` | — |
| SCR-302 시세 | `listAssetPrices`, **`listExchangeRates`** (v4.13 — 환율 절) | `saveManualPrice`, `refreshPrices` (공급자 등재 — §5.8, P5a 컷 3 · *v4.13 — 종전 「공급자 미등재」는 그 컷 이후 낡았다*), **`createAsset`**, **`saveProviderSymbol`** (v3.6), **`saveExchangeRate`** (v4.13) |
| SCR-401 세금 | `getTaxSummary` | `saveTaxProfile` |
| SCR-402 전망 | `getForecast` | — |
| SCR-501 사용자 | `listUserSummaries` | — (**화면을 만들지 않는다 — DOC-008 SQ-01 해결.** 계약은 남는다) |
| SCR-502 설정 | — | `signOut` (§5 밖). **표시명 변경은 v1 보류** — DB는 허용하나 §5에 계약이 없다 |

> **무효화 — 실측이 형태를 정했다 (v1.3, P4 컷 1b).** 이 매트릭스의 코드 측 짝이 `src/lib/routes/invalidation.ts`이며, 거기에 두는 것은 **판정 기준**이다: `affects`(어느 변경이 어느 조회 계약의 값을 바꾸는가)와 `ROUTE_QUERIES`(어느 **라우트**가 무엇을 읽는가). 후자가 화면 단위가 아니라 라우트 단위인 이유는 SCR-204가 라우트 둘이고 입력이 다르기 때문이다 — `/products/new`는 `searchAssets`만, `/products/[id]/edit`은 `getProduct`도 읽는다. 화면 단위로 두면 「시세를 저장했으니 등록 화면도 낡았다」는 잘못된 합성이 나온다.
>
> **경로 목록은 손으로 적지 않는다.** 네 경우를 실측한 결과 **세 설정(무효화 없음 / 정확한 경로 / 무관한 경로만)의 관측이 전부 같았다** — 서버에 지울 것이 없다(모든 데이터 화면이 동적이고 Supabase 요청은 `cache: 'no-store'`다). 대조군이 초록인 것이 실험 실패가 아님은 `revalidatePath` 호출 로그로 확인했다(②는 일곱 경로, ③은 `/tax` 하나). 그래서 효과는 `revalidatePath('/', 'layout')` 한 줄이고, 낡는 라우트는 위 두 데이터의 곱(`staleRoutesFor()`)으로 도출한다. 전체 근거는 DOC-010 §9 AQ-02.
>
> **P4 종료 시점의 맵 상태 (v2.1, 컷 10).** `ROUTE_QUERIES`가 **라우트 열**을 담고 `PENDING_ROUTES`가 **하나**(`/forecast`)다. 빈 배열은 `/settings` 하나이고 그것이 옳은 유일한 자리다 — 그 화면은 로그아웃과 앱 정보·면책뿐이므로 낡을 값이 없고, **같은 사실 때문에 `next build`가 정적으로 프리렌더한다**(DOC-008 §5 SCR-502의 각주 — 그래서 날짜를 표시할 수 없다). `tests/app/invalidation.test.ts`가 그 셋을 케이스로 박았다: 어느 변경도 `/settings`를 낡게 하지 않는다 · 빈 항목이 그 하나뿐이다 · 자리표시 원장이 `/forecast` 하나다. **P4b가 `getForecast`를 만들면 마지막 항목이 실명으로 바뀌고 합성 대조가 자동으로 검산한다.**
>
> **── 컷 8에서 그렇게 되었고 대조가 실제로 검산했다 (v2.6).** `/forecast`가 `PENDING_ROUTES`에서 `ROUTE_QUERIES: ['getForecast']`로 옮겨 갔고 **`PENDING_ROUTES`는 비었다**(`{}`). 대리 기준(`invalidatedWith: 'getTaxSummary'`)이 옳았음이 사후 증거로 남았다 — 컷 7이 `getForecast`를 `affects`에 등재했을 때 그 소속이 `getTaxSummary`와 **정확히 같은 일곱**으로 나왔으므로, 손으로 적은 `STALE_ROUTES` 표가 **한 줄도 바뀌지 않았다.** 그 동일성 자체를 케이스로 박았다(개수로 적으면 어느 일곱인지 갈려도 통과한다). 빈 항목은 여전히 `/settings` 하나다 — `ROUTE_QUERIES`에 새로 들어온 항목이 비어 있지 않기 때문이다. **원장 셋이 전부 비었다**: `PENDING_ROUTES` = `{}` · `PENDING_PARTS` = `{}` · `placeholderRoutes()` = `[]`. 뒤의 둘은 **같은 사실의 두 관측**이므로(선언과 소스 실측) 넷으로 세지 않고, 그 일치 자체를 단언한다 — 갈리는 경우가 「원장만 앞서갔다」와 「원장이 뒤처졌다」 둘이고 **앞의 것이 더 위험하다**(화면이 섰다고 말하면서 실제로는 자리표시다).
>
> 판정 기준의 특이한 두 자리를 기록한다. ① **시세는 세금·전망을 낡게 하지 않는다** — §4.6의 추정 기여는 `grossExpected(원금·연쿠폰율·평가주기·차수)`뿐이고 시세도 `conditionResult`도 쓰지 않는다(§4.3의 `EARLY` 가정). *(v4.16 — 추정 월수익도 그렇다: `q_k`(`P × r_m / 12`의 보조단위 절사 — §4.0 「형식」)와 월수익 일정 · 기록 · 흐름 끝(적용 차수 · 상환일)뿐이고 §3.5의 조건 판정을 쓰지 않는다 — 흐름 끝 안의 무기록 달은 조건과 무관하게 지급으로 추정한다(U5 · DOC-007 §7.6). 이 근거가 없으면 이 문장은 월지급식에서 거짓이 된다)* ② **상환은 시세 화면을 낡게 한다** — §4.5 `usedByActiveProducts`가 "참조 중인 **미상환** 상품 수"이므로 상환 등록·취소가 그 값을 바꾼다. 둘 다 직관과 반대이므로 `tests/app/invalidation.test.ts`에 케이스로 박았다.

> **`createAsset`을 SCR-302에도 배정했다 (v1.2).** v1.1까지 이 계약은 SCR-204에만 있었는데, **그러면 SCR-302의 빈 상태가 순환한다** — DOC-008 §6이 정한 빈 상태는 "등록된 기초자산 없음"이고 ST-02는 빈 상태가 **다음 행동을 제시할 것**을 요구하는데, 자산을 만들 유일한 경로가 SCR-204(상품 등록)이므로 안내가 "자산을 등록하려면 상품을 등록하세요"가 된다. 그리고 상품 등록은 기초자산 선택을 요구한다. 계약은 화면에 묶여 있지 않으므로 배정만 넓히면 되고 구현은 0줄이다.

> **P8 달러가 이 매트릭스에 더할 것 (v4.9 선행 명세 — 표 행은 컷 a3의 코드 커밋에 함께).** SCR-302 행의 조회 계약에 `listExchangeRates`(§4.11), 변경 계약에 `saveExchangeRate`(§5.13)가 더해진다. ~~지금 행에 적으면 `tests/app/invalidation.test.ts`의 매트릭스 대조(「문서가 배정한 변경 계약이 전부 맵에 있다」)가 실재하지 않는 이름으로 빨간불이다.~~ *(v4.13 — 더했다. 위 SCR-302 행 · `ROUTE_QUERIES['/prices']`)* **나머지 화면의 배정은 그대로다** — 달러 상품의 표시는 이미 배정된 계약의 **필드**로 한다(§4.1~§4.4·§4.6~§4.8의 v4.9 필드). `ROUTE_QUERIES['/prices']`에 `listExchangeRates`가 같은 커밋에 든다.

> **P8 월지급이 이 매트릭스에 더할 것 (v4.16 선행 명세 — P8 컷 b1. 표 행은 b2·b3의 코드 커밋에 함께).** 지금 행에 적으면 위 대조가 실재하지 않는 이름으로 빨간불이다(`tests/app/invalidation.test.ts` — 변경 칸은 `MUTATION_NAMES`와 **양방향**, 행 수는 13).
>
> - **SCR-206 월수익 기록 행 신설** — 변경 계약 `recordCouponPayments`(§5.14) · `updateCouponPayment`(§5.15 — 행마다의 「수정」이 이 화면의 한 행 폼이다, `?edit=<id>`). 행 수가 13 → 14가 되고 DOC-008 화면 원장(15 → 16)과 SCR-206 라우트가 함께 선다(b3 — DOC-008).
> - **SCR-202 상세 행** — 변경 계약에 `deleteCouponPayments`(§5.15 — 행마다의 「삭제」와 구획의 「월수익 기록 전부 지우기」).
> - **SCR-301 일정 행** — 조회 계약에 `listMonthlyCouponSchedule`(§4.12, b3)과 `ROUTE_QUERIES[PATHS.schedule]`.
> - **나머지 화면은 필드로 한다** — SCR-101(§4.1) · SCR-201(§4.2) · SCR-202 ⑦(§4.3) · SCR-203(§5.4 V-29) · SCR-204(§5.1·§5.2) · SCR-205(§5.11) · SCR-401(§4.6) · SCR-402(§4.7)는 이미 배정된 계약의 v4.16 필드·규칙이다.
> - **넣는 시점** *(b1 개정 — §9 ⑭ 부분 해결)* — **세 변경 이름은 b2**(계약이 서는 커밋 — 변경 칸 대조가 양방향이므로 `MUTATION_NAMES`가 17이 되는 그 커밋에 매트릭스에 서야 한다), **SCR-206 화면 행은 b3**(화면 · 라우트와 함께). `createProduct` · `updateProduct`의 `affects`에 `listMonthlyCouponSchedule`이 든다(§4.12). ⚠ **남은 몫 둘** — b2~b3 동안 `recordCouponPayments` · `updateCouponPayment`가 어느 기존 행에 서는가(그 행을 b3이 SCR-206 행으로 옮긴다)는 b1 명세가 시점만 정하고 행을 정하지 않았다(§9 ⑭ — b2 전). SCR-206이 읽는 조회 계약(`getProduct`가 후보 — 원천징수는 서버가 채우므로 세율을 뷰에 싣지 않는다, DOC-008 SCR-206)은 화면 세부라 DOC-008 SQ-21 ⓘ가 들고 있다(b3 전 — b1 개정).

### 8.1 화면이 계약의 결함을 드러낸 사례 — 부류와 재발 방지 (v2.1 신설, P4 컷 10 · v3.3에서 일곱째)

> **제목에서 수를 뺐다 (v3.3).** 종전 제목은 「**여섯** 사례」였고 일곱째가 나오면서 낡았다. 같은 교훈이 §4.4에 이미 적혀 있다 — 「서수는 소비자가 늘 때마다 낡는다」. 아래 표가 정본이고 제목은 세지 않는다.

P4의 아홉 컷에서 **계약의 결함이 여섯 번 드러났다.** 전부 화면을 세우는 도중이며, P3a·P3a.5·P3b·P3b.5의 네 검증 단계를 지난 뒤였다. 그 사실이 이 절의 이유다 — 계약끼리 대조해서는 보이지 않는 부류가 있다.

| # | 컷 | 무엇 | 부류 |
|---|---|---|---|
| 1 | 2 | §4.2 `kiStatus` 파라미터가 3값, 반환이 5값 (AQ-24) | **A. 파라미터와 반환의 비대칭** |
| 2 | 3 | §4.3에 판정 삼종(`status`·`worstOf`·`kiStatus`)이 없다 | **B. 매퍼가 `judge()`의 값을 버린다** |
| 3 | 4a | §4.9 빈 질의가 `[]` — 자동완성이 영구히 빈 목록 | C. 인자의 뜻이 호출부의 전제와 달랐다 |
| 4 | 7 | §4.4에 `ownerId`(필터의 선택지 값)가 없다 | **A** |
| 5 | 7 | §4.4에 `status`가 없다 — 상환 완료 차수를 구별할 수 없다 | **B** |
| 6 | 9 | §4.1에 ⑤(최근 상환 실적)의 자료원이 없다 | **D. 요소 자체가 계약에 없다** |
| 7 | **P6 컷 6** | §4.4에 원금·연쿠폰율·세전·세후·손익이 없다 — 상품별 카드를 만들 수 없다 | **D** |

*(같은 컷의 §4.1 `attentionItems[].ownerName`은 4·5와 같은 A 부류이며 한 계약 안이라는 점만 다르다. §4.6 `seededYears`(컷 8)도 A다 — 선택기의 하한이 반환에 없었다.)*

> **일곱째가 D를 «두 번째»로 만들었고, 그것이 셋째 물음의 관측 공백을 실증한다 (v3.3, P6 컷 6).** 6과 7은 같은 부류다 — 화면이 요구하는 것을 읽을 필드가 계약에 없다. 그런데 6이 나온 뒤 만든 대조(`tests/app/dashboard.test.ts`가 DOC-008 §5의 요소 셀을 파싱해 `keyof DashboardView`와 짝짓는다)는 **SCR-101에만 있다.** 「나머지 화면에는 그 대조가 없다 — AQ-35로 등재한다」고 이 절의 마지막 문단이 적었고, **그 등재된 공백에서 정확히 일곱째가 나왔다.** SCR-301은 그 대조를 갖지 않은 화면이었고, 「주요 요소마다 그것을 읽는 필드가 있는가」를 이 화면에 묻는 층이 어디에도 없었으므로 다섯 값이 계약에 없는 채로 남았다.
>
> **그러므로 이 사례의 재발 방지는 §4.4를 고치는 것이 아니다** — 그것은 개별 정정이고, 이 절이 자기 교훈으로 적은 「개별 정정이 부류를 닫지 못했다」에 그대로 걸린다. AQ-35의 네 번째 자리로 SCR-301을 등재하고, DOC-008 §5의 「항목 표시」를 **두 행으로 갈라**(공통 / 상품별) 마커 ①~⑪이 `keyof ScheduleItem`과 전수 대조되게 한다 — SCR-201이 v1.9에서 같은 이유로 같은 분할을 했고 `tests/app/productList.test.ts`가 그 형태의 정본이다.

**A와 B가 넷이고 둘 다 「필터·판정의 입력과 출력이 한 계약 안에서 닫히는가」를 묻지 않아 생겼다.** A는 파라미터를 채울 값이 반환에 없는 것이고 B는 이미 산출한 판정값을 뷰가 버리는 것이다. **컷 3과 컷 7이 같은 형태였다는 것이 이 절의 핵심이다** — `judge()`가 내는 `{status, worstOf, kiStatus}`를 §4.3이 버렸고(v1.4가 고쳤다) 넉 컷 뒤에 §4.4가 `status`를 같은 방식으로 버리고 있었다. 한 번 고친 부류가 다른 절에서 그대로 남아 있었으므로 **개별 정정이 부류를 닫지 못했다.**

**재발 방지는 「뷰마다 같은 필드 집합을 갖게 한다」가 아니다.** 그것이 답이라면 컷 9의 확인(`upcomingEvaluations`에 `ownerId`·`status`를 두지 않는다 — §4.1의 각주)이 결함으로 잡혔을 것이다. 판정 기준은 **그 뷰의 행 단위와 그 화면의 축**이다.

| 물음 | 언제 묻는가 |
|---|---|
| 이 계약의 파라미터를 채울 값이 **반환에 있는가** (없으면 화면이 그 축을 쓸 수 없다) | 파라미터를 신설·확장할 때 |
| `judge()`가 내는 값 중 이 뷰가 **버리는 것**이 있는가. 버린다면 화면이 합성해야 하는가 | 뷰를 신설할 때 |
| DOC-008 §5의 **주요 요소마다** 그것을 읽는 필드가 있는가 | 화면을 배정할 때 (D 부류) |
| 화면이 계약이 준 필드를 **모든 분기에서** 렌더하는가 (v2.2 추가, P4.5 — E 부류) | 화면에 분기를 넣을 때 |

#### 넷째 물음 — E 부류: 필드는 있고 분기가 지운다 (v2.2 신설, P4.5)

**세 물음의 목록이 늘지 않으면 다음 컷에서 같은 부류가 다시 나온다.** P4.5의 대조가 그것을 실증했다 — 위 셋을 전부 만족하면서 사용자에게 도달하는 결함이 나왔다.

**SCR-101의 빈 상태 분기가 요소 ③을 함께 지웠다.** 상품이 0건이면(`activeCount === 0` 이고 상환 0건) 화면이 다섯 절을 **통째로** 지우는데, ③의 값은 상품에 의존하지 않는다 — §4.1이 본인 과세 프로필의 `other_financial_income`을 함께 읽어 `elsTotal.plus(other)`를 내므로 상품 0건에서도 남는다. 도달 경로가 열려 있다: §5.6은 상품을 요구하지 않고 SCR-401은 상품 0건에서 정상 동작한다. **상품 0건 + ELS 외 금융소득 3,000만 원**이면 **`isComprehensive`가 참인데** 홈은 「내 상품이 없다」만 적었다(그 예시의 추가납부는 **0이다** — 금융소득 외 종합소득이 저장되어 있지 않으면 비교과세 ①이 원천징수액과 같아진다. 실측: 산출세액 4,200,000 < 원천징수 4,620,000. **결론은 그것과 무관하다** — ③이 답하는 물음은 「올해 종합과세 대상인가」이고 그 답이 이미 참이다). DOC-008 §5가 이 화면의 요구를 「스크롤이나 클릭 없이 세 가지를 안다」로 규정하고 **그 둘째가 「올해 종합과세 대상인가」**이므로, 그 상태에서 화면이 자기 목적 하나를 수행하지 않는다.

**셋 중 어느 물음도 이것을 묻지 않는다.** 첫째는 파라미터 축이고, 둘째는 `judge()` ↔ 뷰이며, 셋째(D)는 「요소마다 **그것을 읽는 필드가 있는가**」다 — ③에는 필드가 있다(`currentYearTax`). D의 대조는 요소와 필드의 **존재**를 짝지을 뿐 **어느 분기에서 렌더되는가**를 묻지 않으므로, `tests/app/dashboard.test.ts`의 축이 전부 초록인 채로 이 결함이 남았다.

**같은 형태가 이 문서 안에서 한 번 더 있었다.** §4.1의 v2.0 각주는 「같은 부류의 결함이 여기에도 있는지」 스스로 점검했는데 `judge()`가 내는 **여덟 값 중 둘**만 물었다(`ownerId`·`status`). 물음이 「이 뷰가 버리는 값이 있는가」였다면 `integrityIssue`가 나왔고, 그것이 §4.1 첫 각주의 거짓 주석(`// null = 시세 없음`)이 살아 있던 이유다. **즉 §8.1이 자기 교훈으로 적은 「개별 정정이 부류를 닫지 못했다」가 그 정정 자체의 점검에서 재현되었다.**

**넷째 물음의 관측 지점.** `tests/app/dashboard.test.ts`의 `hasFinancialIncomeToReport` describe가 그 자리다 — 판정을 순수 모듈로 뺀 만큼(그 판정이 실제로 절을 렌더하는지는 `src/app/**`의 DOM 성질이므로 AQ-32의 잔여에 남는다). **D와 E의 차이가 이 물음을 별 행으로 두는 이유다**: D는 「계약에 없다」이고 E는 **「계약에 있고 화면이 조건부로 버린다」**이므로 대조 상대가 다르다 — D는 문서 ↔ 계약이고 E는 계약 ↔ **화면의 분기**다. 그리고 E의 대조에는 문서 쪽 정본이 없다(§5의 「주요 요소」 셀은 요소를 열거하지만 **어느 상태에서 사라지는가**를 적지 않는다) — §6의 빈 상태 열이 그 자리인데 화면 단위이고 절 단위가 아니다. 그래서 넷째 물음은 지금 **규율이며 파싱 대조가 없다**; 그 공백은 DOC-010 AQ-35와 같은 자리이고 P6에서 함께 정한다.

**D는 앞의 둘과 부류가 다르고 그것이 이 절을 §8에 둔 이유다.** 1~5는 계약 문서 안에서 보이는 형태이지만(파라미터 ↔ 반환, `judge()` ↔ 뷰) 6은 **화면 목록과 계약을 나란히 놓아야** 보인다. §8이 그 대조의 자리이고, v1.9까지 이 매트릭스는 「어느 화면이 어느 계약을 쓰는가」만 적어 **계약이 그 화면의 요소를 전부 덮는가**는 묻지 않았다. 지금은 `tests/app/dashboard.test.ts`가 SCR-101에 대해 그것을 기계적으로 대조한다(요소 셀 파싱 ↔ 요소 → 뷰 필드 대응표). **나머지 화면에는 그 대조가 없다** — DOC-010 AQ-35로 등재한다.

> **DOC-001 §10이 화면설계서를 역작성하기로 한 판단이 계약에도 적용됐어야 했다는 신호다.** 그 결정의 근거는 「화면의 세부는 구현하며 정해지므로 미리 쓰면 틀린다」였는데, **계약도 같은 성질을 가진 부분이 있었다.** 계산 규칙(DOC-007)과 스키마(DOC-002)는 화면 없이 확정할 수 있었고 실제로 흔들리지 않았다 — TC-01~22와 I-01~16은 P4 내내 무변경이다. 흔들린 것은 **뷰의 필드 집합**이고, 그것은 「어느 화면이 무엇을 표시하는가」의 함수다. 즉 §4의 `View` 타입들은 DOC-007·DOC-002와 같은 층이 아니라 **DOC-009와 같은 층**이었다.
>
> 그렇다고 §4를 P4로 미뤘어야 한다는 뜻은 아니다 — 조회 계약이 없으면 화면을 세울 수 없고(위상 정렬), P3a가 없었으면 여섯이 아니라 훨씬 많이 나왔을 것이다. **바뀌어야 했던 것은 순서가 아니라 예상이다**: 뷰의 필드 집합은 화면이 서면서 정정될 것으로 계획에 적혀 있어야 했고, 그러면 여섯 번의 정정이 「결함 발견」이 아니라 **예정된 단계**로 기록되었을 것이다. P4b·P5에 새 계약(`getForecast`·시세 수집)이 있으므로 그 단계의 계획에 이 예상을 적는다.

> **SCR-001·SCR-502의 행을 신설했다 (v1.2).** 종전 매트릭스는 SCR-101부터 시작해 **로그인 화면이 아예 없었다.** `signIn`·`signOut`은 §5의 열한 계약에 속하지 않는다 — Supabase Auth의 세션 조작이지 도메인 변경이 아니고, `src/app/actions.ts`가 "§5의 11개를 1:1로 노출한다"를 불변식으로 삼고 있어 열두 번째 export가 그것을 희석한다. `src/lib/auth/session.ts`에 두고 화면별 어댑터(`src/app/(auth)/login/actions.ts`)에서 부른다. 반환 타입은 `ActionResult`를 재사용한다 — §3.2가 프로젝트의 단일 오류 어휘이고 로그인 폼도 입력값 보존과 필드별 오류가 필요하다.

---

## 9. 미결정 사항

| ID | 항목 | 상태 | 비고 |
|---|---|---|---|
| AQ-06 | 자동 수집이 수동 입력값을 덮어쓸지 | **해결 (P5b 컷 0) — `MANUAL`이 이긴다** | **§7.1 CR-05를 뒤집었다(U-03).** 결정을 강제한 것은 취향이 아니라 **모순이다** — 종전 CR-05(「자동값 우선」)와 같은 표의 `CronResult.skipped`(「당일 데이터 이미 존재」)가 양립하지 않아 **둘 중 하나가 죽은 명세였다**(§8.1이 분류한 부류의 재발). 정정: 같은 `(asset_id, as_of_date)`에 행이 있으면 **쓰지 않는다 — `source`와 무관하다.** 근거는 충돌이 **날짜 스코프라 영속하지 않는다**는 것(다음 날은 `AUTO`가 정상적으로 채운다)이고, 반대 선택은 정정을 **하루만** 살리면서 되돌릴 수단도 주지 않는다. 파급 셋: `skipped`가 실재하는 값이 된다 · 사전 확인이 공급자 호출을 절약한다(C-03) · **배치에 `asset_prices` UPDATE가 불필요해져 DOC-010 AQ-11의 권한 한 칸이 함께 닫힌다.** ★ 잘못된 `AUTO`의 정정 경로는 **재수집이 아니라 §5.7**이다 |
| AQ-07 | 상품 삭제 시 소프트 삭제 여부 | **해결 (P2)** | 하드 삭제. 단 상환 완료 상품은 삭제 불가(§5.3). DOC-002 DQ-01과 동일 |
| AQ-08 | 전망 기본 연수 | **해결 (P4b) — 6** | v0.6부터 「현재 6년 가정」으로 열려 있었고 **코드에 기본값을 박는 순간 사실상 닫히므로** 구현 전에 확정한다. **6인 근거는 상품의 만기다** — 이 프로젝트가 다루는 ELS의 만기가 통상 3년이고(DOC-001) 발행일이 흩어져 있으므로, 지금 보유한 상품 전부가 상환을 마치는 데 필요한 구간이 그 두 배 안쪽이다. 6보다 짧으면 **만기가 먼 상품의 회수가 표에서 잘려** 잔여 원금이 마지막 행에 영구히 남는 것처럼 보이고, 길면 시드된 세율이 하나뿐이라(2026) 뒤 행이 전부 같은 근사인데 행 수만 늘어난다. **`years`를 인자로 남겨 둔다** — 기본값을 상수로 두는 것과 인자를 없애는 것은 다르고, 상한(`FORECAST_MAX_YEARS`)이 그 인자의 조작을 막는다(§4.7). 화면은 이 인자를 노출하지 않으므로(DOC-008 §5 SCR-402의 요소에 연도 수 컨트롤이 없다) **현재 6은 코드의 기본값 하나로만 존재한다**. **── 컷 7에서 그 상한도 배정했다: `FORECAST_MAX_YEARS = 20`**(§4.7 각주). v2.4가 이름만 정하고 값을 비워 두었던 것을 구현 전에 닫았다 — 비워 둔 채 구현하면 이 항목이 경고한 형태가 상한에 대해 반복된다(코드가 값을 정하고 그것이 사실상 결정이 된다). **그리고 그 수에는 도메인 의미가 없다는 것을 함께 적었다** — 이 항목이 6에 준 근거(만기 통상 3년의 두 배)는 「유용한 구간」의 근거이고 상한의 근거가 아니며, 스키마에서도 유도할 수 없다(V-20의 `evaluation_period_months >= 1`에 상한이 없어 만기가 구조적으로 무계다). 코드 측 단언도 `=== 20`이 아니라 **`> FORECAST_DEFAULT_YEARS`**다 — 그 부등호가 이 항목의 「인자를 남겨 둔다」를 지키는 성질이기 때문이다(상한과 기본값이 같으면 유효한 값이 하나뿐이라 인자가 장식이 된다) |
| AQ-09 | 목록 페이지네이션 | 미결 | A-01(사용자 10명 이하) 기준 불필요 판단. 상품 수 증가 시 재검토. **§4.0 Q-06이 판단 시점을 만든다** — 결과가 서버 상한에 걸리면 잘린 목록을 반환하지 않고 예외를 던지므로, 이 항목을 닫아야 할 시점이 조용히 지나가지 않는다. 행 단위가 차수인 §4.4가 가장 먼저 닿는다. **P3a.5 보완** — 그 판단 시점이 **모든 경로에 있지는 않다.** Q-06을 적용하지 않은 로더가 존재하므로(AQ-22) 그 경로로 상한에 닿으면 이 항목은 여전히 조용히 지나간다 |
| AQ-10 | 계약 계층 입력 검증 라이브러리 | **해결 (P3b)** | **도구를 도입하지 않는다.** 손으로 쓴 조합기를 쓰고 V-규칙 ID를 함수 이름으로 삼는다. 근거는 세 가지다. ① **강제 변환 벡터.** Q-08의 방어는 `Number()`·`parseFloat`·단항 `+`를 차단하는 **구문 수준 린트**인데, 스키마 라이브러리의 `coerce`는 라이브러리 호출이라 그 린트가 보지 못한다 — 금액·비율이 float64를 경유하는 경로가 규칙 밖에 하나 생긴다. ② **타입 정본의 이원화.** §5의 입력 타입이 정본인데 스키마에서 타입을 추론하면 정본이 둘이 되고, 문서와 어긋나도 컴파일은 통과한다. ③ **검증 대상이 대부분 교차 필드다.** V-03·V-04·V-05·V-07·V-09·V-12~V-14는 어느 라이브러리에서도 커스텀 코드로 쓰게 되므로, 도구가 줄여 주는 것은 원시 타입 검사뿐이다. 대신 **규칙 ID 전수 열거 단언**을 둔다 — V-01~V-20에 케이스가 하나라도 없으면 테스트가 실패한다 |
| AQ-17 | 순수 모듈의 예외를 변경 계약에서 어떻게 변환할지 | **해결 (P3b)** | **§3.2.2로 종결.** 예외 클래스가 아니라 **호출 지점**이 코드를 부여한다 — 순수 모듈의 거부는 전부 `RangeError`이므로 클래스로는 입력 오류와 상태 결함을 구분할 수 없다. **`CONFLICT`는 순수 모듈 예외에서 나오지 않는다**(순수 모듈은 "이미 상환됨"을 알 수 있는 위치에 없다). 기본값은 `INTERNAL`이며, 예상 밖의 `RangeError`는 §6에 구멍이 있다는 신호로 취급한다. 조회 부분의 결정·철회 기록은 아래에 남긴다 |
| AQ-18 | `listUserSummaries`의 타인 종합과세 여부를 `security definer`로 제공할지 | 미결 | §4.8이 타인 행의 `isComprehensive`를 `null`로 두었다. DOC-008 SQ-01(SCR-501 존치)이 닫히고 그 값이 실제로 필요하다고 판단되면 파생 boolean만 반환하는 함수를 도입한다. **P4 이후** |
| AQ-22 | Q-06 절단 방어의 적용 범위와 검증 | **부분 해결 (P4 컷 8)** | **규약은 조회 전체를 말하는데 구현은 로더 5개에만 있다.** `loadTaxYearContext`는 상한도 감지도 없으며 `getTaxSummary`·`listUserSummaries`·`getDashboard` 세 계약이 그 경로를 탄다. 루트가 `tax_years`라 현재 규모에서는 도달 불가하지만, "도달했다면 AQ-09를 닫으라는 신호"라는 Q-06의 목적이 그 경로에서는 작동하지 않는다. `searchAssets`는 §4.9가 상한을 명시했으므로 위반은 아니나 **호출부에 절단 신호가 없다** — 두 규약이 충돌하는 지점이며 조정된 적이 없다. **P4 컷 4a 보완: 그 충돌이 소비자에서 실현되어 빈 질의 경로가 갈라졌다.** 자동완성이 전량을 한 번 받는 형태이므로 상한 20을 물리면 21번째 자산이 어떤 방법으로도 선택되지 않고 화면에 그 사실이 나타나지 않는다 — 그래서 빈 질의는 `TRUNCATION_PROBE_LIMIT` + `assertNotTruncated`로 옮겼다(§4.9 v1.5). 남는 것은 **비-빈 질의의 상한 20**이며 그쪽은 의도된 자름이다(더 좁게 적으면 된다). 로더 목록의 나머지 공백(`loadTaxYearContext`)과 `SERVER_MAX_ROWS` 실측 부재는 그대로다. 검증도 반쪽이다: `assertNotTruncated`는 가짜 배열로만 단위 시험되고 PostgREST에 1000행을 실제로 태우는 테스트가 없어, `SERVER_MAX_ROWS`가 서버 설정과 어긋나도 드러나지 않는다. **P4 컷 8 — 로더 목록의 공백을 닫았다.** `loadTaxYearContext`를 `loadAllTaxYears`(I/O + `TRUNCATION_PROBE_LIMIT` + `assertNotTruncated`) + `resolveTaxYear`(순수 판정)로 분해했다. 분해가 방어와 함께 온 이유는 **판정의 세 분기 중 하나를 통합 스위트로 관측할 수 없다**는 것이다 — 시드가 아예 없는 상태를 만들면 다른 216건이 함께 죽는다(컷 6이 `TaxSeedRangeError`의 분류를 순수 함수로 뗀 것과 같은 이유이며, 이번에는 던지는 쪽을 뗐다). 이제 `tests/db/tax-year.test.ts`가 시드 있음·미래 근사·과거 거부·시드 없음·**한쪽만 시드된 연도**를 DB 없이 본다. 부수 효과로 P4b의 `getForecast`가 여러 연도를 **한 왕복**으로 얻을 수 있다(`loadAllTaxYears`를 재사용한다 — 6개 연도에 왕복 6번을 하지 않는다). **남는 것 둘**: ① `searchAssets`의 비-빈 질의 상한 20은 그대로다(의도된 자름이며 §4.9가 명시한다 — 호출부에 신호가 없는 것은 그 화면이 「더 좁게 적으면 된다」로 대응 가능하기 때문이다) ② **`SERVER_MAX_ROWS` 실측 부재** — `assertNotTruncated`는 여전히 가짜 배열로만 단위 시험되고 PostgREST에 1000행을 실제로 태우는 테스트가 없다. 그 절반은 이 컷에서 좁혀지지 않았다. **P4.5 — ②를 실측했고 결과가 잔여의 성격을 바꿨다. 「검증 부재」가 아니라 「가드가 사문화되어 있다」다.** `asset_prices`에 **1,201행**을 넣고 PostgREST에 `limit=1001`·`limit=1200`을 각각 요청했더니 **둘 다 1000행**이 돌아왔다(`Content-Range: 0-999/*`, 상태 **200** — 206도 아니다). 원인은 설정과 임계가 **같은 값**이라는 것이다: `supabase/config.toml`의 `[api].max_rows = 1000`이고 실행 중인 컨테이너에 `PGRST_DB_MAX_ROWS=1000`이 실측되며(`docker inspect`), `assertNotTruncated`의 발화 조건은 `rows.length > SERVER_MAX_ROWS`(= `> 1000`)다. **`db-max-rows`가 클라이언트 `limit`을 상한으로 깎으므로 `rows.length`는 1000을 넘을 수 없고 그 조건은 영원히 거짓이다.** 즉 Q-06의 「잘린 목록을 반환하지 않고 던진다」는 **현 설정에서 성립하지 않으며**, 1,001행짜리 목록은 조용히 1,000행으로 잘려 정상 화면이 된다 — 이 항목이 막으려던 바로 그 상태다. (측정 픽스처는 삭제했다: 1,201행 + 자산 1행, 잔여 0.) **`TRUNCATION_PROBE_LIMIT = SERVER_MAX_ROWS + 1`의 주석이 그 함정을 정확히 반대로 적고 있다** — 「하나 더 요청해서 `> 1000`을 본다」는 서버가 1,001행을 **줄 수 있을 때만** 참이다. **고치는 방향 둘**: (a) `SERVER_MAX_ROWS`를 `max_rows`보다 **작게** 둔다(예: 999) — 그러면 `TRUNCATION_PROBE_LIMIT = 1000`을 요청해 1,000행을 받는 것이 `> 999`로 발화하고, 서버가 실제로 깎는 경계와 코드가 보는 경계가 갈라진다. (b) `max_rows`를 코드 임계보다 크게 올린다 — 설정과 코드가 두 곳으로 갈리므로 (a)가 낫다. **어느 쪽이든 `select.ts`의 두 상수 주석이 함께 정정되어야 한다**(현재 「설정이 바뀌어 이 값이 낡으면 상한보다 먼저 감지가 걸리므로 안전한 방향으로 틀린다」고 적는데, **같은 값일 때는 아예 걸리지 않는다**는 경우가 그 서술에 없다). **P4.5는 고치지 않았다** — 이 감사의 범위가 §7.1의 넷이고 이 항목은 등재 대상이었다. 판단 시점은 **다음 컷**이며 한 줄 변경이므로 미루지 않는 편이 낫다. 관련: DOC-010 AQ-38이 이 예외를 에러 경계 관측의 레버로 쓰려다 같은 사실에 걸렸다. **P4b 컷 1·2 — 사문화를 닫았다. 고치는 방향 (a)를 골랐고 「값을 고치는 것」이 아니라 「관계를 파생시키는 것」으로 넓혔다.** 임계를 낮추기만 하면 `max_rows`가 오르는 날 사본이 낡고 **아무것도 빨간불이 되지 않는다** — 그것이 v2.2의 사문화와 같은 형태다. 그래서 `POSTGREST_MAX_ROWS`(= `[api].max_rows`의 사본)를 두고 `APP_MAX_ROWS = POSTGREST_MAX_ROWS − 1`, `TRUNCATION_PROBE_LIMIT = APP_MAX_ROWS + 1`(= 서버 상한)로 **파생**시켰다. 사본의 낡음은 `tests/db/select.test.ts`가 `supabase/config.toml`을 파싱해 막고, 부등호 사슬 `APP_MAX_ROWS < TRUNCATION_PROBE_LIMIT ≤ [api].max_rows`를 단언한다. 파서는 전제 여섯을 스스로 단언한다(파일 정체 · `[api]` 머리가 하나 · `max_rows` 대입이 파일 전체에 하나 · 주석 처리된 키를 읽지 않음 · `[api.tls]`에서 멈춤 · 없는 키는 빈 배열) — `[api]`와 `[api.tls]`에 `enabled`가 다른 값으로 **실재하므로** 경계 단언이 대조군을 갖는다. **v2.2의 네 케이스가 전부 상수에 상대적이어서 사문화 상태에서도 초록이었으므로**(`SERVER_MAX_ROWS + 1`·`new Array(SERVER_MAX_ROWS)`) 새 케이스 둘은 배열 길이를 `config.toml`에서 온 수로 만든다 — 「서버가 건넬 수 있는 최대 행수로 실제로 던진다」와 「그보다 한 행 적으면 던지지 않는다」이며, **전자는 수정 전 값에서 빨간불이다**(min(1001, 1000) = 1000, 임계 1000 → 던지지 않는다). 상수 이름도 고쳤다 — `SERVER_MAX_ROWS`는 이제 서버의 것이 아니므로 `APP_MAX_ROWS`다. Q-06 규약(§4.0)의 반전과 새 오탐은 이 커밋보다 **먼저** 문서에 적었다(절대 규칙 #10). **남는 잔여 다섯** — ① `searchAssets`의 비-빈 질의 상한 20(의도된 자름, 그대로) ② **클라우드 `max_rows`가 저장소에 없다** — 이 단언은 로컬 스택의 **파일**만 본다. 배포된 프로젝트의 상한이 `APP_MAX_ROWS` 이하로 설정되면 **운영에서 다시 사문화되고** `npm run test`가 그것을 볼 수 없다. 이 수정이 좁히지 못한 축이며 닫았다고 적지 않는다 ③ **파일은 실행 중인 서버가 아니다** — `config.toml`은 `supabase start`가 읽는다(`db:reset`이 아니다. `tests/integration/global-setup.ts`가 `enable_signup`에 대해 같은 사실을 적었다). 컨테이너 ↔ 코드는 여전히 아무도 단언하지 않는다 ④ **`max_rows`가 임베드 배열에 적용되는지는 미측정이다** — `assertNotTruncated`는 루트 행수만 보고 `PRODUCT_SELECT`는 `els_underlyings`·`redemption_schedules`를 무제한 배열로 임베드한다. 확인에는 부모 하나에 1,000행 넘는 자식이 필요하고 P4.5의 1,201행 픽스처는 측정 후 삭제했다(잔여 0). DOC-010 AQ-40 ③이 지적한 그 제목의 실체이며, 제목을 좁히는 것으로 이름 결함만 닫고 이 축은 별 잔여로 남긴다 ⑤ 위 오탐(정확히 서버 상한 행수인 온전한 목록도 던진다)을 **받아들인다** — 결론이 같다(§4.0의 각주). **②③④를 함께 닫는 후보는 하나다: `count: 'exact'`로 받아 `count > rows.length`로 던진다.** 설정과 무관하고 오탐이 없으며 상수 둘과 config 파싱 테스트가 함께 사라진다. 대가는 로더 **일곱**을 고치는 것과 **목록 질의마다 `COUNT`**이며, `'planned'`는 과소 계수가 가능해 대체할 수 없고 **임베드 축은 그것도 덮지 못한다**(루트 행만 센다). 그래서 **AQ-09(페이지네이션)를 다룰 때 채택한다** — 그때 총 건수가 페이지 번호에 필요하므로 `COUNT`가 순수 비용이 아니라 공유 비용이 된다. 지금 넣으면 도달 불가한 경로의 정확성을 영구 요청 비용으로 사는 것이다 |
| AQ-24 | 계약 파라미터와 반환 유니온의 비대칭 | **해결 (P4 컷 2)** | **파라미터를 반환과 같은 다섯 값으로 넓혔다** — §4.2. 종전에는 3값(`SAFE`·`WARNING`·`TOUCHED`)이어서 `BELOW`·`NO_KI` 상품을 어떤 필터로도 뽑을 수 없었고, 그중 `BELOW`는 §4.1이 「사용자 확인이 필요한 유일한 상태」로 규정한 값이다. 「조치 목록이 전담한다」는 대안을 택하지 않은 이유는 **조치 목록에는 창이 없다**는 것이다 — §4.1은 미상환 상품의 조치 사유를 주고 SCR-101이 그것을 보여주지만, 「KI를 하회한 상품 전체」를 소유자·상태와 **함께** 좁혀 보는 자리는 목록뿐이다. 구현은 3줄(필터는 조회 후 적용, Q-05)이었고, 비대칭이 재발하지 않도록 **리터럴 유니온을 다시 적지 않고 도메인 열거형을 색인**한다. **잔여 없음** — `kiStatus = null`이 필터되지 않는 것은 남은 결함이 아니라 정의다(§4.2 각주: `null`은 상태가 아니라 판정의 부재이고 원인이 셋이며, 그중 상환 완료는 `status` 필터가 가른다) |
| AQ-25 | `projection`의 4번째 `null` 분기 | **판별 완료 — 죽은 코드다 (P4.5). 제거는 미결** | 구현은 §4.3이 정한 두 경우 외에 `attributionYear`가 `null`일 때도 `null`을 반환한다(방어적 분기). 그 함수가 언제 `null`을 주는지 계약에 서술이 없어 **도달 조건이 불명**이고, 따라서 죽은 코드인지 실재하는 경우인지 판별되지 않는다. DOC-007 §7.2의 귀속연도 산출을 정리할 때 함께 닫는다. **P4.5 — 판별했다. 타입으로 도달 불가가 확정되므로 죽은 코드다.** 그 분기에 닿기 전에 `j.next == null`이 이미 걸러지므로 `attributionYear`의 인자는 `{ evaluationDate: j.next.evaluation_date }`이고, `attributionYear`는 **두 인자가 모두 `null`/`undefined`일 때만** `null`을 반환한다. 그런데 `evaluation_date`는 **널 불가**다 — 타입 수준 탐침으로 실측했다(`const probe: Sched['evaluation_date'] = null` → `TS2322: Type 'null' is not assignable to type 'string'`). `redemptionDate`는 애초에 넘기지 않는다. 따라서 `year == null`은 성립할 수 없다. **「불명」에서 「판별했고 죽었다」로 옮긴다.** DOC-007 §7.2를 정리할 때 함께 닫는다는 계획은 유지하되 조건이 달라졌다 — 그때 물을 것은 「이 경우가 실재하는가」가 아니라 **「`attributionYear`의 `null` 반환을 계약이 쓰는 곳이 있는가」**다. 없으면 그 함수의 반환 타입에서 `null`을 빼는 것이 이 분기와 함께 사라지는 방향이다(DB `not null`이 이미 그 사실을 보장하고 있으므로 타입만 낙관을 잃고 있다). **제거를 P4.5에서 하지 않은 이유**는 순수 모듈의 반환 타입 변경이 `lib/domain`의 공개 계약을 좁히는 일이고 다른 호출부(§7.2 정리 대상)와 함께 보아야 하기 때문이다 **P4b 컷 3 — 종결했다. 제거가 아니라 표현 불가로 닫혔다.** 이 항목이 「그때 물을 것은 「`attributionYear`의 `null` 반환을 계약이 쓰는 곳이 있는가」다」로 남긴 물음에 답했다 — **쓰는 곳이 없었다.** 두 자리가 그 값을 방어했고 둘 다 도달 불가였다: `projectionOf`의 넷째 분기와 `mutations/redemptions.ts`의 `console.error` + `INTERNAL` 반환(후자가 이 항목이 「다른 호출부와 함께 보아야 한다」고 미룬 것이다). **원인은 함수가 아니라 서명이었다** — 두 근거가 모두 없을 때만 `null`인데 타입이 그 조건을 말하지 않았다. 그래서 `attributionYear`에 **오버로드 셋**을 두어 근거를 하나라도 확실히 넘기면 `number`가 되게 했다(본문 무변경). 동시에 적용 차수 판정을 `queries/attribution.ts` 하나로 모아 `Attribution`의 `kind`가 「귀속연도가 없는 경우」를 판별하게 했으므로, `projectionOf`는 `kind !== 'ESTIMATED'` 한 줄이 되고 **넷째 분기를 쓸 자리가 사라졌다** — 각주가 적어 온 「두 경우」와 코드의 분기 수가 처음으로 일치한다. `mutations/redemptions.ts`의 방어는 삭제했고 그 자리에 타입 수준 근거를 주석으로 남겼다. **동작은 불변이다** — 기존 727건이 그대로 초록이고 신규 11건이 세 `kind`와 「차수 없음」 세 경우를 본다(음성 대조: 상환·일정 검사 순서를 뒤집으면 「만기 상환 + 일정 0건」 한 건이 빨간불이 된다) |
| AQ-26 | 필터 문법 격리의 검증 범위 | **해결 (P3b 4단계)** | 이스케이프 대상 10문자 전부에 케이스를 두고, 특히 **`\`의 순서 의존성**(먼저 처리하지 않으면 자기가 넣은 백슬래시를 다시 이스케이프한다)을 단언한다. 검증 계층의 테스트와 같은 파일에 둔다 — 둘 다 "사용자 입력을 문법에서 격리한다"는 같은 일이다 |
| AQ-27 | 기준일 → 귀속연도 파생 지점의 이원화 | **해결 (P3b 10단계)** | 파생 지점을 `today.ts`의 `currentYear()` 하나로 합쳤다. `tax.ts:430`의 문자열 자르기를 그 호출로 교체했다 — Q-02가 "요청당 한 번"을 구조로 만든 것과 같은 이유로 파생 규칙도 한 곳에만 있어야 한다. **교체가 형식 검사도 함께 들여왔다** — 종전 자리에는 그것이 없어 `asOf`가 깨지면 `NaN`이 조용히 세율 조회로 흘렀다 |
| AQ-30 | 생성 타입의 쓰기 방향이 Q-08·W-04와 어긋난다 | **해결 (P3b 7단계)** | **실측이 두 번 있었다.** ① P3b 2단계 — `supabase gen types`의 `Insert`·`Update`가 금액·비율 열을 `number`로 선언한다. ② **P3b 7단계 — 그것을 따르면 값이 실제로 바뀐다.** `asset_prices.price`(`numeric(18,6)`)에 같은 값을 두 형태로 실어 `::text`로 되읽었다: 문자열 `"99999999999.999999"` → **`201`** + `99999999999.999999`(정확) / JSON 수치(생성 타입이 요구하는 형태) → **`201`** + **`100000000000.000000`**. **두 요청 모두 `201`이다** — 거부도 경고도 없이 값만 달라졌고, DB에 닿기 전에 `JSON.stringify`가 float64를 직렬화하며 자릿수를 잃었다. 첫 경우가 동시에 **PostgREST가 `numeric` 열에 JSON 문자열을 그대로 받는다**는 증거이므로 어긋나는 쪽은 전송 계층이 아니라 생성 타입이다. 그리고 `numeric(15,0)` 금액은 15자리까지 float64로 정확하므로 **값 단언으로는 영원히 드러나지 않는다.** 방어는 두 겹이다 — (a) `InsertPayload<T>`가 열 사양에서 금액 열을 파생해 `string`으로 바꾸고, 읽기 쪽 `MustCastColumn`과 **같은 `CountingColumn` 하나**를 공유하므로 두 방향이 "무엇이 금액인가"에 대해 갈릴 수 없다(`tests/db/payload.test.ts`가 6개 테이블에 대해 두 집합의 동치를 타입 수준으로 단언한다). (b) 린트 `els/db-layer`가 `.insert()`·`.upsert()`·`.update()`의 첫 인자로 **객체 리터럴을 금지**해 `toInsert()`/`toUpdate()`를 지나지 않는 경로를 막는다. 단언은 그 두 함수 안의 **두 개가 전부**다. **남는 문제:** ① `db:types` 재생성이 열 타입을 바꾸면 파생 타입이 조용히 따라간다 — 드리프트 대조는 수동 스위트에만 있다(AQ-19와 같은 자리). ② 테스트 픽스처는 `pg`로 직접 넣으므로 이 타입을 지나지 않는다. ③ **구조로 걸리는 범위는 계약 11개 중 9개다 (P3b.5 보완).** `toInsert`/`toUpdate` + 린트를 지나는 것이 6개(`createRedemption`·`updateRedemption`·`setKiTouched`·`saveTaxProfile`·`saveManualPrice`·`createAsset`), 쓰기가 없는 것이 3개(`deleteProduct`·`deleteRedemption`·`refreshPrices`), **`.rpc()` jsonb를 지나는 2개(`createProduct`·`updateProduct`)는 둘 다 아니다** — 린트 셀렉터가 `/^(insert\|upsert\|update)$/`라 `.rpc()`를 보지 않고, `productPayload()`는 열 사양에서 파생되지 않은 손으로 쓴 `Json`이다. 지금 값이 옳은 것은 `ProductInput`이 금액을 `string`으로 선언하고 쓰기 함수가 `->>`+`::numeric`으로 받으며 왕복이 실측되어 있기 때문이며(`99999999999.999999`), **방어의 종류가 다르다** — `els_products`·`els_underlyings`·`redemption_schedules`에 새 금액 열이 생기면 `.insert()` 경로는 `InsertPayload<T>`가 자동으로 따라오지만 `productPayload`와 SQL 함수는 손으로 고쳐야 하고 **빠뜨려도 아무것도 실패하지 않는다.** **P4 컷 4b — 잔여 ③을 닫았다. 형태는 「합성의 각 조각을 각 테이블에서 파생시킨다」다.** payload가 세 테이블의 합성이라 `InsertPayload<T>`를 그대로 쓸 수 없다는 것이 미결의 이유였고, 답은 테이블 단위로 쪼개는 것이었다 — `MoneyFieldsOf<T>`(= 그 테이블의 금액 열을 `SnakeToCamel`로 옮겨 `string | null`을 요구하는 매핑 타입)를 `els_products`·`els_underlyings`·`redemption_schedules` 세 조각에 각각 걸어 `ProductPayload`를 만든다. **단언이 아니라 파생이라는 것이 요점이다** — 테스트로 물으면 실패가 보고되지만, 파생시키면 새 금액 열이 **컴파일 오류**가 되어 고칠 곳이 하나로 정해진다. 음성 대조로 확인했다: 생성 타입의 `els_products` Insert에 `hedge_premium: number`를 넣자 `products.ts`에서 «Property 'hedgePremium' is missing in type … but required in type 'MoneyFieldsOf<"els_products">'»가 떴다(같은 대조가 `payload.test.ts`의 읽기↔쓰기 동치 단언도 함께 깨뜨렸다 — 두 방어가 다른 우회로를 막는다는 뜻이다). **그리고 값 경로를 화면에서 실측했다.** 기준가 `99999999999.999999`(`numeric(18,6)`, 유효숫자 18자리)를 SCR-204의 네 단계로 입력해 저장하고 SCR-202에서 되읽어 `99,999,999,999.999999`가 그대로 표시됨을 확인했다 — 폼(쉼표 제거) → `jsonb` → `->>` + `::numeric`을 지나는 경로다. 음성 대조로 `productPayload`가 `basePrice`를 JSON 수치로 실게 바꾸자 **그 단언만** 실패했다. 원금(`numeric(15,0)`)으로는 이 결함이 영원히 드러나지 않으므로(15자리까지 float64로 정확하다) 픽스처가 기준가여야 한다. **남는 잔여는 셋이 아니라 셋의 절반이다**: ①(`db:types` 드리프트)·②(픽스처가 `pg` 직결)는 그대로이고, ③은 **SQL 함수 쪽만** 남는다 — payload가 새 키를 요구하게 되어도 함수가 그 키를 `->>`로 읽는지는 타입이 보지 못한다. 다만 그 상태는 조용하지 않다: `not null` 금액 열이면 `23502`로 죽고, 널 허용이면 컴파일 오류가 이미 「함수도 고쳐라」를 가리키고 있다 |
| AQ-29 | 쓰기 함수가 계약 계층 검증을 우회하는 경로 | **해결 (P4 컷 4b) — (a) 그대로 두고 계약 밖 호출을 신뢰하지 않는다** | **함수는 I-07(하위 행 수)과 상태 충돌만 검사하고 §6의 나머지 규칙은 보지 않는다.** 계약을 경유하면 V-01~V-20이 먼저 걸리지만, 함수는 `authenticated`에게 `EXECUTE`가 열려 있으므로 `supabase-js`나 SQL로 직접 부르면 V-04(차수 연속성)·V-07(평가일 증가)·V-09(자산 중복)를 통과하지 않은 상품이 만들어진다. **DB 제약이 있는 규칙(I-02·I-03·I-04·I-10)은 그래도 막히지만 나머지는 막히지 않는다** — 예를 들어 차수 `1, 2, 99`인 상품이 함수로 만들어질 수 있고, 그것은 DQ-05가 총 차수 정본을 `max(round_no)`가 아니라 행 수로 정한 이유와 같은 상태다. 함수 안으로 검증을 옮기는 것은 규칙을 두 언어로 두 번 쓰는 일이므로 하지 않는다. 남은 선택은 (a) 그대로 두고 계약 밖 호출을 신뢰하지 않는다 (b) 함수 시그니처를 계약 계층만 알 수 있는 형태로 좁힌다 — P4에서 화면이 붙은 뒤 실제 위험을 보고 정한다. **P3b 9단계 보완 — 두 층의 경계를 실측했다.** 같은 입력(기초자산 0건 / 자산 중복)을 계약과 함수 양쪽에 넣어 무엇이 다른지 기록한다: 계약은 `VALIDATION_FAILED` + **배열 인덱스까지 붙은** `fields`(`underlyings[1].assetId`)를 내고 **왕복 0**으로 끝나며, 함수 직접 호출은 `23514`·`23505`를 낸다. 즉 우회 경로에서 잃는 것은 "막힘" 자체가 아니라 **어느 원소가 문제인지**와 **DB에 닿지 않음**이다 — DB 제약이 없는 V-04·V-07은 그마저도 없다. **P4 컷 4b 결정 — (a)를 고른다.** 화면이 붙은 뒤 실제 위험을 보고 정하기로 한 시점이며, 본 것은 셋이다. ① **소비자가 하나다** — SCR-204가 계약을 부르고 계약만이 함수를 부른다. 우회는 로그인한 사용자가 자기 JWT로 RPC를 손으로 만들어야 하고, RLS가 그대로 적용되므로 **자기 데이터에 대한 자해**이며 경계를 넘지 못한다(W-01). ② **(b)의 대가가 위험보다 크다** — 함수 시그니처를 계약 계층만 알 수 있는 형태로 좁히려면 서버 전용 비밀을 도입해야 하는데, 우리 서버는 사용자 세션과 anon 키만 들고 있으므로(W-01) 새 비밀·저장·회전이 전부 따라온다. 검증을 SQL로 옮기는 대안은 §6의 규칙을 두 언어로 두는 일이라 이미 배제되어 있다. ③ **보상 수단이 실재한다** — DQ-05가 총 차수 정본을 `max(round_no)`가 아니라 **행 수**로 정했으므로 `1, 2, 99`가 화면의 숫자를 틀리게 만들지 않고, 0건 상태는 `integrityIssue`가 표시한다. 그리고 `supabase/dev/`의 표본은 V-04·V-07·V-09를 **구조로** 만족시킨다(차수는 `generate_series`, 평가일은 `발행일 + n×주기`) — 규율이 아니라 계산 결과다. **결정을 문서에만 두지 않는다**: `tests/integration/mutations.test.ts` ⑦이 차수 `1, 2, 99` + 감소하는 평가일을 함수에 직접 넣어 **성공함을 고정하고**, 같은 입력이 계약에서는 `VALIDATION_FAILED` + `schedules`·`schedules[2].evaluationDate`로 거부됨을 나란히 둔다. 누군가 SQL 쪽에 검증을 더하면 그 케이스가 빨간불이 되고 **그것이 좋은 소식**이다(AQ-28의 `PUBLIC` 실행 권한 케이스와 같은 자리). 만들어진 상품이 조회 계층에서 어떻게 보이는지도 함께 단언한다 — 총 차수 3, 결함 없음, 차수 번호 `[1, 2, 99]`. **조용히 틀리지 않는다**는 것이 (a)를 고른 근거의 나머지 절반이다 |
| AQ-31 | `refreshPrices` 성공 경로의 검증 공백 | **종결** (P5a 컷 3) | **공급자 0개인 동안 §5.8은 항상 `PROVIDER_UNAVAILABLE`로 끝나므로 반환 타입 `{succeeded, failed}`를 조립하는 코드가 한 줄도 실행되지 않는다.** 부분 실패 병합, 실패 목록의 `assetId`·`assetName`·`reason` 구성, `asset_prices`의 `source = 'AUTO'` UPSERT가 전부 그 뒤에 있다. 지금 이 계약을 검증하는 것은 "공급자가 0개면 `PROVIDER_UNAVAILABLE`이고 왕복이 0이다" 둘뿐이며(`tests/db/mutations.test.ts`·`tests/integration/mutations.test.ts`), 그것은 **분기 하나만 증명한다.** ADR-007(AQ-01)이 닫히는 순간 검증 없는 코드가 처음 실행된다 — AQ-01은 "어느 공급자를 고를까"이고 이 항목은 "고른 뒤 무엇이 미검증인가"라 성격이 다르므로 번호를 따로 둔다. 공급자 도입 시 (a) 스텁 어댑터로 부분 실패 경로(일부 성공·일부 실패) ~~(b) `source = 'AUTO'` UPSERT가 I-16 트리거를 통과하는지~~ (c) `PROVIDER_UNAVAILABLE`↔`INTERNAL` 분기 — 셋을 **같은 커밋에서** 세운다. §5.8이 "스텁은 테스트 안에서만 쓴다"고 한 것이 그 전제다 — **★ (b)를 정정한다 (v3.5, P5a 컷 0). 종전 문언은 «항진명제»다.** 그 문언은 CR-05가 「자동값 우선」이던 시절의 것이고, **v2.7이 CR-05를 뒤집으면서 배치가 `asset_prices`에 UPDATE를 하지 않게 됐다**(DOC-010 AQ-11이 그 사실을 이미 적었다 — 「AQ-06이 뒤집히면서 UPDATE가 불필요해져 권한 한 칸이 함께 닫힌다」). I-16은 **`BEFORE UPDATE`** 트리거이므로 **INSERT만 하는 배치는 그 트리거에 애초에 닿지 않는다** — 즉 「UPSERT가 I-16을 통과한다」를 시험하는 케이스는 무엇을 하든 초록이고 아무것도 증명하지 않는다. **대체 명제 셋이 실제로 걸리는 것들이다:** ⓐ 기존 `MANUAL` 행이 있는 좌표에 AUTO INSERT를 하면 `23505` / `asset_prices_asset_id_as_of_date_key`이고 **그 행의 `price`·`source`·`provider`가 바이트 동일하게 남는다**(MANUAL이 이긴다 — CR-05의 실체) ⓑ 그 `23505`가 `failed`가 아니라 **`skipped`로 세어진다**(경합이 정확히 CR-05의 상태이며, 실패로 보고하면 건강한 동시 실행이 고장으로 보인다) ⓒ **음성 대조로** 좌표를 바꾸는 UPDATE가 여전히 `23514` / `asset_prices_coordinates_immutable`이다 — 즉 **I-16은 살아 있음을 증명하면서 배치가 그것을 필요로 하지 않음을 함께 증명한다.** 종전 문언을 지우지 않고 취소선으로 남긴다(U-03). **★★ 종결 (P5a 컷 3) — 셋을 같은 커밋에 세웠다.** ⓐ `tests/cron/collect.test.ts`가 **한 번의 실행에서 일곱 갈래**를 관측한다(성공 2 · `EMPTY` 1 · `AUTH` 1 · 미매핑 1 · 사전확인 skip 1 · `23505` skip 1). 그것이 가능한 이유는 오케스트레이션이 **순수**이기 때문이며(포트 주입) 그래서 이 검증이 **상시 스위트**에 있다 — 원 클라이언트에 붙였으면 `tests/integration/`으로 밀려나 실제 공급자 실패를 재현해야 했다(비싸고 비결정적). ⓑ 정정된 명제 셋은 `tests/integration/collect.test.ts`가 실제 PostgREST로 본다. ⓒ 이제 **3방향**이 아니라 **둘**이다 — CR-07(503)·CR-08(500)이고 CR-10은 사전 판정으로 갈라졌으며, 그 사상표의 전수는 `tests/cron/respond.test.ts`가 본다. **그리고 이 항목이 예고한 것이 실제로 일어났다**: 미검증 코드가 처음 실행되기 전에 검증이 섰다 |
| AQ-63 | **V-03(차수 개수 대조)이 구조적으로 발동 불가다 — 그리고 일괄 적용이 총 차수를 «정한다»** | 미결 (P6 컷 1 신설) | **§6의 V-03은 `schedules.length`와 `totalRounds`를 비교하는데, 화면의 파서가 «양쪽을 같은 칸에서 파생시킨다».** `totalRounds = countOf(values.totalRounds)`이고 차수 행 루프의 상한이 `roundCountOf(values) = min(같은 값, 60)`이므로 **1~60 전 구간에서 `schedules.length === totalRounds`가 항등**이다. 즉 이 규칙은 60 초과·0·비수치에서만 발화하며 **그것들은 V-20이 이미 잡는다.** ★ **파급은 문서에 있었다** — DOC-008 §5 SQ-04 각주가 「총 차수가 비어 있을 때만 토큰 개수로 채운다 … **V-03이 저장 시점에 같은 사실을 오류로 말한다**」고 적어 auto-fill의 안전망으로 이 규칙을 인용했는데 **그 문장이 거짓이다**(v1.8에서 취소선으로 정정했다). 실제로 저장을 막는 것은 빈 차수 칸의 배리어 필수 오류(V-08 계열)이며, 그것은 **개수 불일치가 아니라 값 부재**를 말한다. ★★ **그래서 더 조용한 변종이 하나 있다** — 총 차수가 **비어 있으면** 일괄 적용이 토큰 개수를 총 차수로 삼는다. 6차수 상품에 배리어 5개를 붙여넣으면 `rounds === tokens.length`가 되어 불일치 안내 분기가 **발화할 수 없고** V-03도 통과하므로 **경고 0으로 5차수 상품이 저장된다.** 6번째 평가일이 존재하지 않으며 화면에 그 사실을 말할 자리가 없다. **P6 컷 1은 고치지 않았다** — 사용자가 범위를 둘로 좁혔고(평가일 규약 · 단일 페이지화) 이 항목은 그 둘에 딸려오지 않는다. **종결 후보 둘**: ⓐ V-03의 대조 대상을 「사용자가 적은 총 차수」와 「배리어가 채워진 차수의 수」로 바꾼다(두 값이 실제로 독립이 되는 유일한 형태다) ⓑ auto-fill이 총 차수를 정했을 때 그 사실을 안내에 적고, 배리어가 빈 차수를 차수표에 **지속되는 표식**으로 남긴다(현재 안내 문구는 한 왕복만 살고 다음 제출에서 사라진다). ⓑ가 값이 크고 싸다 |
| AQ-73 | **`asset_provider_symbols`에 `UNIQUE(provider, provider_symbol)`이 없다 — 한 심볼이 두 자산에 매핑될 수 있다** | 미결 (v4.3 신설) | 현재 제약은 `UNIQUE(asset_id, provider)`(자산당 공급자 하나)뿐이다. 두 자산이 같은 키움 심볼을 가지면 불러오기의 해석(심볼 → 자산)이 둘 중 하나를 **조용히** 고를 수 있으므로, **2개 이상이면 미해결로 둔다**(DOC-008 SCR-204). 정면 해소는 제약 추가이며 마이그레이션이 운영의 기존 행과 충돌할 수 있다(실측 전) — 운영 6종은 전부 서로 다른 심볼이다(ADR-008 §4). 수동 매핑(SCR-302)이 같은 심볼을 다른 자산에 넣는 것도 지금은 막히지 않는다 |
| AQ-74 | **자산 추가가 두 계약(§5.10 → §5.12)이며 원자적이지 않다** | **수용 (v4.3 신설)** | 둘째가 실패하면 자산은 있고 매핑이 없다 — **미매핑 자산**이며 ADR-007이 설계된 정상 상태로 정했다. 두 쓰기를 한 함수로 묶는 대안은 새 `public` 함수(권한 회수·`security invoker` — AQ-28)와 14번째 계약을 부르고, 얻는 것은 「미매핑 자산이 잠깐 생기지 않는다」뿐이다. 재시도가 멱등이므로(§5.12 UPSERT) 수용한다. **뒤집힐 조건:** 중간 상태가 화면 어디에서 결함으로 읽히기 시작하면(예: 미매핑 자산이 경고 표식을 얻으면) 묶는다 |
| CR-11 | **환율 단계는 시세 단계와 실패 영역이 갈린다 — HTTP 상태를 바꾸지 않는다** | 예정 (P8 컷 c2 — ADR-010 분기 A/A′일 때만, v4.8 등재) | 환율 수집은 별도 라우트·별도 cron이 아니라 **`GET /api/cron/prices`의 둘째 단계**다(ADR-010 — `ROUTE_HANDLERS` 1개·`crons` 길이 1을 유지하고, `refreshPrices`는 환율을 부르지 않는다). 그 단계의 실패는 **응답 상태를 바꾸지 않는다** — 시세 단계가 `ok`면 200이고, 환율 단계의 결과는 `CronResult`와 `cron_runs`(`job` 열 expand — `PRICES`·`EXCHANGE_RATE`)로만 보고한다. 근거 둘: ⓐ 비2xx는 CR-04 ⓒ 「전면 실패」의 신호인데 환율 한 건 때문에 그것을 내면 시세가 성공한 날이 실패로 읽힌다 ⓑ 환율은 수동 입력(`saveExchangeRate`)이 **모든 분기에서 동작하는** 공용 입력이므로(민서 결정 2026-09-29 · DOC-001 C-03) 그 실패는 CR-02의 「부분 실패」 크기다. **거꾸로 조용해질 위험을 함께 적는다** — 상태 코드가 늘 200이면 환율 수집이 매일 죽어도 응답만으로는 보이지 않는다. 감지는 SCR-302 환율 절의 기준일·경과 표식이 진다(CR-04 ⓐ의 환율판). **표 행은 컷 c2의 코드 커밋에 함께** — §7.1 표는 `tests/app/cron.decide.test.ts:348`(`toHaveLength(10)`)과 `NOT_A_VERDICT` 분류에 결속되어 있다. 분기 C면 「해당 없음」으로 닫는다 |
| CR-12 | **같은 `(currency, as_of_date)`에 행이 있으면 쓰지 않는다 — 날짜는 원천의 날짜다** | 예정 (P8 컷 c2 — ADR-010 분기 A/A′일 때만, v4.8 등재) | CR-05의 환율판이며 `source`와 무관하다 — 근거도 AQ-06과 같다(충돌이 날짜 스코프라 영속하지 않는다). 두 겹도 CR-03과 같다 — 사전 확인은 콜 절약이고, 최종 보장은 `UNIQUE(currency, as_of_date)`와 좌표 동결 트리거다(`exchange_rates`는 DELETE가 GRANT·정책 둘 다 없다 — DOC-002, 컷 a3). **`as_of_date`는 원천이 그 값에 붙인 날짜다** — 수집 시각의 KST 날짜가 아니다. 분기 A′(14:59 이후 게시)에서 배치가 전날 값을 받아 오늘 날짜로 적으면 추정 환율의 기준일이 하루 거짓이 된다. 휴일·게시 전이라 원천이 그 날의 값을 주지 않으면 **`NO_DATA`**이고 `CALL_FAILED`가 아니다(§7.1 `failure`의 두 부류 — 휴일은 결함이 아니다). 표 행은 컷 c2의 코드 커밋에 함께 |
| CR-13 | **환율 키가 없으면 환율 단계만 끈다 — CR-10의 전체 500이 아니다** | 예정 (P8 컷 c2 — ADR-010 분기 A/A′일 때만, v4.8 등재) | CR-10은 「공급자는 등록됐으나 자격증명이 없으면 **배치 전체**를 500」이다 — 시세 공급자의 키 부재는 배포 결함이고 수집할 것이 없기 때문이다. 환율은 다르다: 수동 입력이 **설계된 정상 경로**이므로(DOC-001 C-03 · ADR-010 분기 C) 키 부재가 시세 수집까지 멈추게 하면 부분의 결함이 전체를 죽인다 (아래 AQ-17 철회 기록의 원리 — 멈추는 범위가 원인의 범위를 넘으면 안 된다). 따라서 CR-13은 사전 판정(`decide`)의 갈래가 아니다 — c2에서 `NOT_A_VERDICT`에 사유와 함께 선다. **미결 하나를 함께 등재한다** — 끈 사실을 결과에서 어떻게 드러낼지. 조용히 꺼지면 CR-10이 막으려던 「설정 누락이 정상처럼 보인다」가 환율 쪽에서 재현된다. 형태는 c2 명세에서 정한다. 환경변수 연결은 `env.ts`·`.env.example`·DOC-013 §5.1·DOC-010 §7.2·`env.test.ts`다. 표 행은 컷 c2의 코드 커밋에 함께 |
| X-07 | **불러온 상품 통화가 저장값과 다르면 투자원금을 비운다 · 월수익 지급 기록이 있는 상품은 통화·쿠폰 지급방식이 다른 불러오기를 거부한다** | **앞절반 해결** (P8 컷 a4-2 — §4.10 표 행 v4.15) · 뒷절반 예정 — **컷 b4** *(v4.8 등재 · v4.14 판정 규칙 · v4.16 컷 배정)* | 수정 화면 불러오기(v4.6 · DOC-008 v2.12 「원천에 있는 칸은 불러온 값, 없는 칸은 저장값」)에 더하는 규칙이다. **통화와 투자원금은 함께 움직인다** — 투자원금은 원천에 없는 칸이라 저장값이 남는데(`src/lib/forms/importMerge.ts` `IMPORT_KEEPS_STORED`), 통화만 원천 값으로 바뀌면 `10000000`(원)이 $10,000,000.00이 된다. 형식이 정상이고 값만 거짓인 부류다 — 자릿수가 맞으므로 V-23도 잡지 못한다. 환산하지 않고 **비워서** 사용자가 다시 적게 한다(환율은 계약 조건이 아니다). **기록 거부의 근거는 X-01과 같다** — 기록이 있으면 저장이 `els_products_coupon_recorded_immutable`(`CONFLICT`, DOC-002 · 컷 b2)로 거부되므로 결과를 쓸 수 없는 폼을 채우지 않는다. **★ 뒷절반은 a4에서 도달할 수 없다** — 월지급식은 컷 b4에서야 선택 가능하므로(DOC-000 P8 — 월지급식 선택은 컷 b4) 기록 있는 상품이 계약 경로로 생기지 않는다. a4에서 세우면 b4까지 발동 불가인 분기이고 그 동안의 초록은 아무것도 증명하지 않는다 — 그 절반을 세울 컷은 b1 명세에서 정한다. 표 행(§4.10)은 코드 커밋에 함께. **v4.14 — 앞절반의 판정 규칙(선행 명세 · 구현 a4-2).** 「불러온 상품 통화」는 DOC-010 ADR-009 §7 `productCurrencyOf`의 **확정** 판정이다. **증인 없음**이면 불러온 통화가 없으므로 통화도 투자원금도 저장값이 남는다. 확정 통화가 저장값과 **다르면** 통화는 불러온 값, 투자원금은 **빈칸**이며 구획이 「상품 통화가 저장값과 다르다 — 투자원금을 비웠다」를 말하고 상태는 **「일부 채움」**이다(DOC-008 SCR-204) — 빈 투자원금은 사람이 채울 곳이고, 「불러옴」으로 두면 그 문구 「투자원금 · 계좌유형 · 비고는 저장값 그대로다」가 거짓이 된다. **같으면 아무것도 비우지 않는다** — 같은 상품을 다시 불러와도 투자원금이 지워지지 않는다. 충돌 · 지원 밖은 거부이므로 폼은 저장값 그대로다. **v4.16 — 뒷절반의 컷은 b4다**(P8 컷 b1). 월지급식이 **폼에서 선택 가능해지는 컷**이다(SB-13) — 그 전에는 화면 경로로 기록 있는 상품이 생기지 않으므로, 먼저 세운 분기는 발동 불가인 채 초록이다(위 ★와 같은 논거). 계약은 b2부터 `MONTHLY`와 기록을 받지만(통합 테스트 · dev 표본) 그 사이의 저장은 b2의 `els_products_coupon_recorded_immutable`이 막는다 — 결과를 쓸 수 없는 폼을 채우는 것이 b2~b4의 남는 결함이고, 화면 경로로는 도달하지 않는다. X-08은 그대로 b5/b5′다 |
| X-08 | **월수익 평가일 — 투자설명서에서 읽으면 실제 날짜, 못 읽으면 산식 날짜로 채우고 산식임을 표시한다** | 예정 (P8 컷 b5/b5′, v4.8 등재) | 원천 사실(2026-09-30, EM2048): 월수익지급평가일 1~36회의 **실제 날짜 표는 투자설명서 PDF에만 있다**(`www.kiwoom.com/wm/upload/gds/BEM2048.pdf` — 팝업·목록에는 없다). 지급일은 원문 「평가일 후 3영업일」, 월수익은 「액면금액 × 2.02%(연 24.24%)」이며 미지급분 누적 조항이 없다(기본형). **b5′ 게이트가 통과하면** PDF에서 실제 날짜·월 쿠폰율·지급 규칙을 읽어 채운다(FILLED). **실패하면** 산식 날짜(평가일 = 발행일 + k개월 − 1일, 지급일 = 평가일 + 3영업일, 주말만 건너뜀)로 채우고 **그 행이 산식임을 표시한다**(ADR-009 ⑰, PARTIAL — 게이트 실패는 설계된 정상 경로다). 어느 쪽이든 **조기상환 평가일과 겹치는 달은 실제 날짜**다 — 조기상환 일정은 원천이 날짜로 준다. 산식 날짜는 공휴일을 모르므로 **사용자 확인 대상**이다(DOC-007 RD-03 ⓐ 보강). X-04는 그대로다 — 채운 값은 저장되지 않고 §5.1·§5.2(와 월수익 일정 규칙 V-26)를 지난다. 표 행(§4.10)은 b5/b5′의 코드 커밋에 함께 |

**P8 계약면 증가 — 예정 (v4.8 등재, P8 컷 0b · v4.9 달러 절반 명세, 컷 a1)**

P8이 늘리는 계약면을 한 자리에 적는다. **명세는 컷 a1(달러)·b1(월지급)이 쓰고, 파서에 결속된 표·원장의 행은 코드 커밋에 함께 선다** — 문서가 먼저 서면 그 커밋이 빨간불이고(V-21 v3.6 · §8 외부 조회 v4.3 → v4.4의 선례), 코드가 먼저 서면 절대 규칙 #10이 깨진다. 그 사이에는 이 표가 유일한 기록이다.

| 대상 | 지금 | P8 후 | 명세 | 표 행 · 결속 원장 |
|---|---|---|---|---|
| 변경 계약 (§5) | ~~13~~ **14** *(v4.13 — a3)* | **17** — `saveExchangeRate` · `recordCouponPayments` · `updateCouponPayment` · `deleteCouponPayments` | a1 · b1(§5.14 · §5.15 — v4.16) | a3(`saveExchangeRate`) · b2(나머지 셋). `MUTATION_NAMES` 길이 단언(`tests/app/invalidation.test.ts` 「계약 14개가 모두 항목을 갖는다」 — v4.13, 줄 번호 대신 케이스 이름) · `INVALIDATION` · §8 |
| 조회 계약 (§4) | ~~9~~ **10** *(v4.13 — a3)* | **11** — `listExchangeRates` · `listMonthlyCouponSchedule` | a1 · b1(§4.12 — v4.16) | a3 · b3. `ROUTE_QUERIES` · §8 |
| 검증 규칙 (§6) | ~~V-01~V-21~~ **V-01~V-24** *(v4.11 — a2 · V-24ⓑ는 v4.13)* | **V-01~V-29** — 신설 V-22 상품 통화(∈ {KRW, USD} · 빈칸 오류) · V-23 상품 통화 금액 자릿수 · V-24 환율 · V-25 MONTHLY ⇔ 월수익 조건 · V-26 월수익 일정 · V-27 기록 대상 · V-28 PAID·UNPAID 형태 · V-29 월지급 상환(세전 ≤ 투자원금 ∧ 과세 0). 개정 V-01(「정수」 → 상품 통화 보조단위) · V-08(~~월수익 비율 필드 추가 ·~~ `annualCouponRate` 하한 `x > 0`을 `MONTHLY`에서 `= 0`으로 — DOC-002 DQ-11. *v4.16 — 월수익 두 비율의 범위는 V-25·V-26이 정한다*) · V-20(`couponNo`) | a1(V-01′·V-22~24) · b1(V-08′·V-20′·V-25~29 — 앞의 둘은 대상 필드가 월수익 쪽이다. §6 말미 「P8 월지급 — 규칙 일곱」 — v4.16) | a2 · b2 · b4(V-29). `RULE_IDS`가 §6을 **순서까지** 파싱한다(`tests/db/docs-contract.test.ts`) · `CASES`·`RULE_TARGETS` 양방향(`tests/db/validate.test.ts` 「CASES가 RULE_IDS 전부를 덮는다」 · 「RULE_TARGETS가 RULE_IDS와 양방향으로 일치한다」 — v4.13, 줄 번호 대신 케이스 이름) |
| 조회 규약 Q-07 (§4.0) | 금액은 정수 문자열 | 상품 통화 금액은 **보조단위 고정 자릿수**(KRW 0 · USD 2), 과세 축 금액은 **KRW 정수**, 환율은 시세와 같은 6자리 | a1 | a2(`moneyString` — KRW는 `amountString`과 같다) |
| §3.2.1 제약 → `ErrorCode` | — | 새 제약·트리거 이름(예: `els_products_coupon_recorded_immutable` → `CONFLICT`) | a1 · b1(§3.2.1 「P8 월지급」 — v4.16) | 해당 마이그레이션의 코드 커밋(`BY_CONSTRAINT` · `RAISE_ONLY` · `NOT_NULL_FIELD`) |
| §8 무효화 | — | `EXCHANGE_RATE_WIDE`(세금을 **포함**한다 — 환율은 추정 과세의 입력이다) · `COUPON_RECORD_WIDE` · `PRICE_WIDE`에는 `listMonthlyCouponSchedule`만 더하고 **세금은 계속 없다**(`refreshPrices.affects`에 세금이 없음을 단언) | a1 · b1(§5.14 무효화 각주 · §8 말미 각주 — v4.16) | a3 · b2 · b3 |

> **v4.9 (컷 a1) — 달러 절반의 명세를 썼다. 표 행·결속 원장은 여전히 0줄이다.** 위 표에서 a1 몫의 명세 자리는 다음이다 — 변경 계약 `saveExchangeRate` → §5.13(구현 a3, 13 → **14**) · 조회 계약 `listExchangeRates` → §4.11(구현 a3, 9 → **10**) · V-01′·V-22·V-23·V-24 → §6 말미 「P8 달러 — 규칙 넷」(표 행 a2, V-24의 `saveExchangeRate` 몫 a3) · Q-07′ → §4.0 Q-07 행과 「Q-07′」 각주(구현 a2) · §3.2.1 → 그 절의 「P8 달러 — 새 제약·라벨의 사상」(행 a2·a3) · §8 → `EXCHANGE_RATE_WIDE`는 §5.13의 무효화 각주, 매트릭스 행은 §8 말미 각주(a3). 뷰의 새 필드는 §4.0 「공통 타입」과 §4.1~§4.4·§4.6~§4.8의 v4.9 표기다. **17·11은 P8 전체의 수이고 a3 뒤의 수는 14·10이다** — 나머지 셋·하나는 컷 b1의 명세(구현 b2·b3)다. 월수익 쪽(V-08′·V-20′·V-25~29 · `COUPON_RECORD_WIDE` · `*_recorded_immutable`)은 한 줄도 쓰지 않았다.

> **v4.13 (컷 a3-2) — 달러 절반의 계약면이 전부 섰다.** `saveExchangeRate`(14) · `listExchangeRates`(10) · V-24ⓑ · `EXCHANGE_RATE_WIDE` · 왕복 +1 · §8 SCR-302 행이 같은 코드 커밋이다. 남은 것은 월수익 쪽(b1 명세 · b2·b3 구현)뿐이다.

> **v4.16 (컷 b1) — 월수익 절반의 명세를 썼다. 표 행·결속 원장은 여전히 0줄이다.** 위 표에서 b1 몫의 명세 자리는 다음이다 — 변경 계약 셋 → §5.14 `recordCouponPayments` · §5.15 `updateCouponPayment` · `deleteCouponPayments`(구현 b2, 14 → **17**) · 조회 계약 → §4.12 `listMonthlyCouponSchedule`(구현 b3, 10 → **11**) · V-08′ · V-20′ · V-25~V-29 → §6 말미 「P8 월지급 — 규칙 일곱」(표 행 b2 · V-29는 b4) · §3.2.1 → 그 절의 「P8 월지급 — 새 제약·라벨의 사상」(행 b2 · `NOT_NULL_FIELD`의 `couponPayout`은 b4) · §8 → `COUPON_RECORD_WIDE`는 §5.14의 무효화 각주, 매트릭스 행은 §8 말미 각주(b2·b3). 뷰의 새 필드와 사건 규칙은 §4.0 「공통 타입 — 쿠폰 지급방식과 월수익」과 §4.1~§4.8의 v4.16 표기다. **17 · 11이 P8 전체의 수다** — 이 판으로 계약면 증가의 명세가 다 섰다. **「코드가 한 컷 앞섰다」(P8 컷 b0, `d675efb`)** — 소득 사건 모델(`incomeEventsOf` · 사건을 접는 `contributionOf` · `forecastItemsOf` · `excludedForeignCountOf` · `withholdingFor`의 날짜 칸)이 이 판보다 먼저 코드에 섰다. 동작 불변이며 이 판이 §4.6 · §4.7 · §5.4에 그 이름을 적었다. b1 명세가 답하지 않은 것은 아래 「P8 월지급 — b2 전에 정한다」에 있다 — b1 개정을 반영한 뒤 남은 것은 ⑭의 두 몫(b2 전 · b3 전)과 ⑰(b3 전)이다.

> **AQ-76~87은 DOC-010 §9에 있다 (v4.8).** P8의 구현 방어 범위 미결 열둘은 그 문서에만 둔다 — 사본을 두면 두 곳이 갈린다. 이 문서의 계약과 가장 가까운 것은 AQ-76(환율 = 세금을 움직이는 첫 공용 입력 → 위 `EXCHANGE_RATE_WIDE`)·AQ-77(임베드 페이로드)·AQ-79(직접 UPDATE 우회)·AQ-87(같은 날 상환·월수익 — V-29로 좁힘)이다. *(v4.16 — 컷 b1에서 AQ-79는 **결정**(민서 결정(2026-10-02) ④ — 동결을 DB 트리거로도, §3.2.1 `*_recorded_immutable`) · AQ-87 ⓑ는 **결정**(DB 트리거 `redemptions_monthly_principal_only` · `redemptions_before_coupon_payment`) · AQ-80(데이터 전용 복원이 트리거를 재검증하지 않는다)의 범위가 월수익 트리거로 넓어졌고 · AQ-92가 신설됐다(`redemption_schedules.round_no >= 1` `CHECK` 부재 — b0 반박 검토 발견, 새 두 테이블은 `coupon_no >= 1`을 둔다 · V-20′). 정본은 DOC-010 §9다)*

**P8 월지급 — b2 전에 정한다 (v4.16 등재, 컷 b1)**

b1 결정(컷 b1)이 답하지 않아 **지어내지 않은 것**이다. 본문의 ⚠ 표시가 여기를 가리킨다. 각 항목은 b2 착수 전에 닫고 닫은 판을 여기에 적는다. *(v4.16 개정 반영 — b1 개정이 ①~⑬ · ⑮ · ⑯을 닫았고 ⑭는 부분 해결이다. 등재 행을 지우지 않고 「→ 해결」과 답을 단다. ⑰은 b1 개정의 「차수 루트에는 월수익을 임베드하지 않는다」를 본문에 반영하다 드러난 것이라 새로 등재했고 화면 컷 앞에 닫는다 — 「b3 전에 정한다」)*

- **①** **월수익 제약의 `fields` 키**(§3.2.1 ⚠) — 기록의 제약(I-26 · I-27 · `UNIQUE` 둘 · 복합 FK · 값 범위)이 §5.14(다행 — `entries`)와 §5.15(한 행)에서 함께 도달하는데 `BY_CONSTRAINT`는 제약 → 키 하나다 — 배열 키로 둘지 열의 필드 키로 둘지. I-23 `els_products_monthly_terms_check`와 I-24 일정 넷의 키도 b1 명세에 없다. 그리고 `NOT_NULL_FIELD`의 **열 이름** 사상이 새 테이블에서 틀린 칸을 가리킨다(`evaluation_date` → `evaluationDate` · `is_confirmed` → `isConfirmed`) — 테이블로 갈라 사상할지 → **해결 (v4.16, b1 개정)** — DB 제약 → `fields`는 **색인 없는 이름**이다(§3.2.1 「배열 인덱스를 붙이지 않는다」 그대로): 월수익 지급 기록의 제약은 `paymentDate` · `grossAmount` · `taxableIncome` · `withholdingTax` · `outcome` · `couponNo`, 월수익 일정의 제약은 `couponSchedules`, 지급방식 짝(I-23)은 `couponPayout`. 행 단위 키(`entries[i].…` · `couponSchedules[i].…`)는 계약 계층의 사전 검증(V-25~V-28)이 낸다 — DB 오류는 그 뒤의 마지막 그물이다. 정확한 사상 행은 b2(결속 표). `NOT_NULL_FIELD`는 이 원칙으로 `is_confirmed` → `isConfirmed`가 맞고, 일정 테이블의 널 위반은 `couponSchedules`로 가도록 테이블로 갈라 사상하는 일이 그 행에 든다(§3.2.1). b1 개정은 키의 **모양**만 정했다 — `monthly_coupon_payments_after_redemption` 하나의 `ErrorCode`와 여섯 중 어느 칸인지(그리고 접미사 행)는 DOC-002 DQ-17 ②가 미결로 들고 있다(b2 전에 정한다 — 사본을 두지 않고 그 문서를 가리킨다)
- **②** **§4.1 「n개월 미기록」의 n** — `attentionItems` 항목에 그 수를 싣는 필드가 없다(DOC-008 SCR-101 ④). 항목에 더할지, 화면이 다른 뷰에서 셀지(그 합성은 DOC-010 AQ-23 부류) → **해결 (v4.16, b1 개정)** — `COUPON_UNRECORDED` 항목에 `count: number`(그 상품의 미기록 달 수). 다른 사유에는 없다(선택 필드). 화면이 세지 않는다(§4.1)
- **③** **§4.2 SCR-201 ⑮의 「배리어 50%」** — `terms.monthlyCoupon`은 연율 하나이고 월수익 배리어는 일정 **행마다** 있다. 대표값의 정의를 포함해 필드를 더할지, 화면 요소를 바꿀지 → **해결 (v4.16, b1 개정)** — `terms.monthlyCoupon = { annualRate: string; barrier: string | null }`. `barrier`는 모든 일정 행의 월수익 배리어가 같을 때 그 값, 다르면 `null`(화면 「월수익 배리어 달마다 다름」). 기실현은 `terms.monthlyCoupon = null`. 표시어는 「월수익 배리어 50%」(DOC-005 §8.2)
- **④** **§4.3 `getProduct`의 월수익 연쿠폰율** — SCR-204 수정 화면의 초기값(`productValuesOf`)이 필요로 하는데 §4.3 목록에 없다(§4.2 `terms.monthlyCoupon`과 같은 모양이 후보) → **해결 (v4.16, b1 개정)** — §4.3 `product.monthlyCouponAnnualRate: string | null`. 수정 폼의 월수익 일정 초기값은 `coupons[]`의 `couponNo` · `evaluationDate` · `paymentDate` · `couponBarrier`에서 온다(`productValuesOf`가 옮긴다 — b3)
- **⑤** **기실현 월지급(일정 0행)의 표시** — 순번 없는 `PAID` 기록이 §4.3 어디에 실리는가(SCR-202 ⑦의 수정 · 삭제 대상 — `coupons`는 일정 행마다다) · 그 상품의 `coupons` · §4.2 `couponProgress`의 값. DOC-008 SQ-17의 계약 쪽이다 → **해결 (v4.16, b1 개정)** — `coupons = []`(일정 행이 없다), 순번 없는 `PAID` 기록은 §4.3 형제 필드 `unnumberedCouponRecords: CouponRecordView[]`(지급일 순), §4.2 `couponProgress = null`. `CouponRecordView`에 기록의 `paymentDate`를 둔다(§4.3 — 그 기록의 유일한 날짜다)
- **⑥** **`remainingCoupons`의 환율 기준** — 달러 추정 월수익을 환산한 추정 환율(DOC-008 SCR-202 ⑤ 「환율 기준 또는 「환율 없음」」)을 싣는 자리. `projection.exchangeRateBasis`는 `projection`이 `null`인 상품(NO_ROUND · 상환 완료)에서 함께 사라진다 → **해결 (v4.16, b1 개정)** — `remainingCoupons = { byYear: Array<{ year; count; grossAmount; taxableIncome: string | null }>; exchangeRateBasis: ExchangeRateBasisView | null } | null`. 환율 근거를 그 컨테이너가 싣는다(projection이 `null`인 상품에서도 남는다). 원화 상품은 `exchangeRateBasis = null`
- **⑦** **§4.7 가정 표식** — 「월지급식은 적용 차수까지 매월 지급 가정」을 켜는 표 밖 표식의 필드 이름 · 모양 · 켜지는 조건(`tests/app/forecast.test.ts`의 `OutsideTable` · `_NoUnmappedField`). DOC-007 RD-19(화면 전체 고지와 상환된 상품의 추정 월수익)와 함께 정한다 → **해결 (v4.16, b1 개정)** — 표 밖 표식 여섯째 `monthlyCouponAssumption: boolean`(그 표에 추정 월수익 사건이 하나라도 있으면 참 — 문장의 조건). 구현 b4. DOC-007 RD-19(화면 전체 고지 조건)는 그대로 b4 전에 정한다
- **⑧** **§4.12의 반환 행** — 타입 이름(잠정 `MonthlyCouponScheduleItem`)과 필드: 상품 식별(§4.4 `ownerId` v1.8의 근거 — 소유자 필터의 선택지 값)과 월수익 행(§4.3 `CouponObservationView`의 부분집합이 후보). 그에 따른 `EXCHANGE_RATE_WIDE` 소속 → **해결 (v4.16, b1 개정)** — `MonthlyCouponScheduleItem = { productId; productName; ownerName; currency; couponNo; evaluationDate; paymentDate; couponBarrier; state; expectedAmount; record: { outcome; grossAmount } | null; conditionResult }`. 인자는 `listSchedule`과 같다. `affects`에 드는 축은 `COUPON_RECORD_WIDE` · `PRODUCT_WIDE` · `PRICE_WIDE`이고 `EXCHANGE_RATE_WIDE`에는 들지 않는다(원화 과세를 싣지 않는다)
- **⑨** **상환일 쪽 계약 계층 검사** — §5.4 · §5.5가 「상환일 < 기록된 `PAID` 지급일」을 사전 조회로 먼저 거부할지(그때의 규칙 ID 포함). 정하지 않으면 `redemptions_before_coupon_payment`가 유일한 겹이고 응답은 같다(`VALIDATION_FAILED` · `redemptionDate`) → **해결 (v4.16, b1 개정)** — §5.4 · §5.5 · §5.11이 사전 조회로 「상환일 ≥ ~~`PAID`로~~ 기록된 달(지급 · 미지급)들의 월수익 평가일 최댓값」을 본다(반박 검토 반영 — 기록 쪽과 같은 집합, 대칭). **V-27의 양방향 문언**이고 새 규칙 ID는 없으며 구현은 b2다(V-27 표 행과 같은 커밋). 비교 키는 지급일이 아니라 평가일이다(⑯과 같은 키). DB 트리거가 마지막 그물이다
- **⑩** **§5.14의 반환 데이터** — 잠정 `void`. 만든 기록의 id를 돌려줄지(SCR-206 제출 뒤의 이동이 그것을 필요로 하는가) → **해결 (v4.16, b1 개정)** — `ActionResult<{ ids: string[] }>`(만든 기록의 id, 입력 순서)
- **⑪** **`deleteCouponPayments`의 부분 삭제** — 사전 조회와 DELETE 사이의 경합으로 일부만 지워지면 한 문장의 DELETE는 이미 확정이다(W-05는 성공을 주장하지 않을 뿐 되돌리지 못한다). 쓰기 함수(트랜잭션 안의 행 수 검사)로 할지, 수용하고 근거를 적을지 → **해결 (v4.16, b1 개정)** — 사전 조회로 `ids`가 전부 그 상품의 기록인지 확인한 뒤 **한 문장** `DELETE … WHERE els_id = $1 AND id = ANY($2)`(한 문장은 원자적이다). 영향 행 수 ≠ `ids` 길이면 `CONFLICT`(경쟁 — `requireAffected` 선례). 쓰기 함수를 두지 않는다
- **⑫** **기실현 월지급 기록의 상한** — 순번 없는 기록은 V-26의 60행에 묶이지 않는다(`UNIQUE(els_id, payment_date)`만 있다). 60건을 넘으면 「전부 지우기」(`ids` ≤ 60)와 일괄 기록(1..60)이 한 번에 되지 않는다 → **해결 (v4.16, b1 개정)** — 기실현 월지급 상품의 순번 없는 기록도 **상품당 60건 이하**(V-27에 더한다 — 일괄 기록 · 전부 지우기의 1..60과 맞춘다). 계약에만 있다
- **⑬** **월수익 연쿠폰율의 상한** — V-08의 「상한은 전부 `x ≤ 2`」를 따를지(V-25는 `> 0`만 말한다). DB 상한은 DOC-002의 율 범위를 따른다 → **해결 (v4.16, b1 개정)** — 연쿠폰율과 같은 계약 범위(V-08의 상한 `x ≤ 2`)를 따른다(V-25). DB는 `> 0`만 — 율 범위 `CHECK`가 없다(받아들인 이탈. 위 「DB 상한은 DOC-002의 율 범위를 따른다」는 사실과 달랐다)
- **⑭** **§8 매트릭스와 SCR-206 · `createProduct`의 무효화** — 세 변경 이름은 `MUTATION_NAMES`가 17이 되는 b2 커밋에 매트릭스에 서야 하는데(양방향 대조) SCR-206 행은 화면과 함께 b3다: b2에 SCR-206 행을 미구현 화면(`UNBUILT_SCREENS` · DOC-008 화면 원장)으로 세울지, b2 동안 다른 행에 둘지. SCR-206이 읽는 조회 계약(`getProduct`가 후보). 그리고 `createProduct.affects`에 `listMonthlyCouponSchedule` — b1 명세는 `PRODUCT_WIDE` · `PRICE_WIDE`만 적었는데 코드의 `createProduct`는 그 축을 쓰지 않고 따로 적는다(새 월지급 상품이 월수익 행을 만든다 — `listSchedule`이 드는 것과 같은 근거) → **부분 해결 (v4.16, b1 개정)** — 세 변경 이름은 **b2**(계약이 서는 커밋), SCR-206 화면 행은 **b3**. `createProduct` · `updateProduct`의 `affects`에 `listMonthlyCouponSchedule`이 든다. **남은 것**: ⓐ b2~b3 동안 `recordCouponPayments` · `updateCouponPayment`가 서는 기존 행(b1 명세는 시점만 정했다 — **b2 전에 정한다**) ⓑ SCR-206이 읽는 조회 계약 — 화면 세부라 DOC-008 SQ-21 ⓘ로 넘긴다(**b3 전에 정한다** — b1 개정)
- **⑮** **뷰 필드의 b3/b4 경계** — §4.0 「컷별 도달」은 b1 원칙(화면 = b3, 세금 · 전망 = b4)으로 갈랐다. `remainingCoupons`는 SCR-202 ⑤(화면)에 쓰이지만 F와 같은 사건 집합이라 b4에 두었다 — 그 사이 SCR-202 ⑤의 월수익 줄이 비어도 되는지 확인한다 → **해결 (v4.16, b1 개정)** — 이 문서의 배정을 받아들였다: `coupons` · `couponProgress` · `terms.monthlyCoupon` · `attentionItems.count` · §4.12는 b3, `remainingCoupons` · §4.6 `basis`/`breakdown` · 확정/추정 분할 · §4.7 표식은 b4
- **⑯** **V-27의 「지급일 ≤ 상환일」과 흐름 끝의 비교 키(평가일)의 틈** — DOC-007 RD-18의 계약 쪽. 상환일 이전에 평가되고 상환일 **뒤에** 지급되는 달은 흐름 안(추정 · 「미기록」)인데 `PAID` 기록은 V-27과 `monthly_coupon_payments_after_redemption`이 거부한다 — 그 달은 기록할 길 없이 주의로 남는다. RD-18과 함께 정한다 → **해결 (v4.16, b1 개정 · DOC-007 RD-18 해결)** — 비교 키를 **그 달의 월수익 평가일**로 바꿨다: V-27 「상환이 있으면 그 달의 월수익 평가일 ≤ 상환일」 · `monthly_coupon_payments_after_redemption`(그 달 일정의 `evaluation_date > redemption_date`면 거부) · `redemptions_before_coupon_payment`(`redemption_date <` ~~`PAID`로~~ 기록된 달(지급 · 미지급)들의 `evaluation_date` 최댓값이면 거부 — 반박 검토 반영, 대칭). 흐름 끝 `t_k ≤ T_end`와 같은 키라 틈이 없다. 순번 없는 기실현 기록은 평가일이 없어 이 검사 밖이다(등재만)
- **⑰** **상품 루트 · 차수 루트 · 월수익 루트 셀렉트의 임베드 범위** *(v4.16 개정 반영에서 등재 — b1 개정의 뒤따름. **b3 전에 정한다**)* — b1 개정은 차수 루트(`loadScheduleRows`)에 월수익 두 테이블을 넣지 않게 했다. 그 결과 ⓐ §4.4 `integrityIssue`의 `COUPON_SCHEDULE_MISSING`은 그 상품의 월수익 일정 존재 여부를 알아야 하는데 차수 루트가 그것을 싣지 않는다 — 존재 탐침(행 하나 · 열 하나)을 둘지, §4.4에서 그 결함을 싣지 않을지(그 결함은 §4.4의 판정을 억제하지 않는다 — §4.2 D1). ⓑ §4.12 자기 루트 쿼리는 부모가 자기 월수익 일정 · 기록 전체를 다시 담으면 상품마다 K²행(최대 3,600)이 된다 — 다음 행 판정 · 흐름 끝에 필요한 열로 좁힐지. 페이로드 실측은 DOC-010 AQ-77(b3)과 함께

**AQ-17의 조회 부분 — 결정과 철회 기록 (v0.6, U-03)**

v0.5는 "**조회 계약은 §3.1이 이미 '시스템 오류는 예외로 전파하여 에러 경계에서 처리'로 규정했으므로 문제가 없다**"고 적었다. **이 판단을 철회한다.**

철회 사유는 예외 전파가 화면에 미치는 범위다. 모든 SELECT 정책이 `using (true)`이므로(DOC-010 §7) 결함 상품은 소유자만의 문제가 아니다.

| 경로 | 예외를 전파할 때의 결과 |
|---|---|
| `listProducts`·`listSchedule`·`getDashboard` | **남의 결함 상품 1건이 SCR-101·201·301을 전원에게 죽인다.** 자기 데이터가 멀쩡한 사용자도 목록을 볼 수 없다 |
| `getProduct` | SCR-202가 죽고, §8 추적 매트릭스상 **SCR-204(수정)도 같은 계약을 쓰므로 유일한 복구 경로까지 막힌다.** 계약으로는 0건을 만들 수 없으니 계약으로 고칠 수도 없어, 수동 SQL 외에 복구 수단이 없다 |

따라서 조회 계층은 `worstOf`에 0건을 넘기지 않고 §4.2의 `integrityIssue`로 상태를 드러낸다. **순수 모듈의 거부는 그대로 둔다** — DOC-007 §3.1은 변경되지 않으며, DB를 경유해 도달한 0건에 대한 최종 안전망으로 남는다(DOC-010 AQ-14). 조회 계층은 위반을 삼키지 않고 로그로 남긴다.

> **이것은 "시끄럽게 멈추는 것이 낫다"의 포기가 아니다.** 결함은 여전히 화면에 드러나며, 시세 없음(E-01)과 구분되고, 조치 목록(§4.1 `attentionItems`)에도 오른다. 달라진 것은 **드러나는 범위**다 — 결함 있는 한 행이 시끄럽게 표시되는 것과, 관계없는 사용자의 화면 세 개가 멈추는 것은 같은 시끄러움이 아니다.

**남은 절반을 P3b에서 닫았다 (v0.9).** AQ-17이 원래 물은 것은 "**변경 계약**이 순수 모듈의 예외를 어떤 `ErrorCode`로 바꾸는가"이며(§3.1의 `ActionResult`는 예외를 던지지 않는다), `INTERNAL`인지 `CONFLICT`인지가 화면 처리를 갈라놓는다(§3.2). 답은 **§3.2.2**에 있다 — 변환의 주체를 예외가 아니라 호출 지점으로 옮기고, `CONFLICT`는 이 경로에서 나오지 않음을 확정했다.

> **두 절반의 답이 같은 모양이다.** 조회 쪽은 "예외를 어디서 멈출 것인가"를 물었고 답은 행 단위 격리였다. 변환 쪽은 "예외를 무엇으로 바꿀 것인가"를 물었고 답은 호출 지점별 부여였다. 둘 다 **예외 자체가 담지 못하는 문맥을 예외 바깥에서 공급**한다 — `RangeError`는 자기가 어느 상품의 어느 입력에서 났는지 모르고, 그 문맥을 아는 것은 항상 부르는 쪽이다.

> **같은 원리의 두 번째 적용 (P3a.5).** 위 철회의 근거는 "**멈추는 범위가 원인의 범위를 넘으면 안 된다**"였다 — 상품 1건의 결함이 목록 전체를 죽이지 않게 했다. §4.2의 입력 기준(v0.8)은 같은 원리를 **한 단계 안쪽**에 적용한 것이다: 한 **입력**의 결함이 그 입력을 쓰지 않는 파생값까지 죽이지 않게 한다. v0.6~v0.7은 첫 번째 적용은 했으나 두 번째를 하지 않아, 결함 상품이 계약마다 다르게 보이는 상태를 남겼다.

---

*본 문서는 프로젝트 진행에 따라 갱신되며, 주요 변경은 변경 이력에 기록한다.*
