---
title: 대용량 배치 프로그램 튜닝
tags: [튜닝, 배치, 병렬처리, 파티션, 체크포인트, 대용량]
---
# 대용량 배치 프로그램 튜닝

**배치 프로그램**은 대용량 데이터를 일괄 처리하는 프로그램으로, OLTP와 달리 **처리량(Throughput)** 최적화가 목표다.
수백만~수억 건을 처리할 때는 쿼리 튜닝 외에 아키텍처 수준의 접근이 필요하다.

---

## 배치 vs OLTP 성능 목표 비교

| 구분 | OLTP | 배치 |
|------|------|------|
| 목표 | 응답 시간(Response Time) 최소화 | 처리량(Throughput) 최대화 |
| 동시성 | 많은 사용자 동시 접근 | 단일 또는 소수 프로세스 |
| 트랜잭션 크기 | 소량 (건별) | 대량 (수백만 건) |
| 인덱스 | 조회 성능 위해 필요 | 오히려 DML 성능 저하 요인 |
| 부분 범위 처리 | 필수 (페이지네이션) | 불필요 (전체 처리) |

---

## 배치 프로그램 성능 저하 원인

```
① 건별 처리 (Row-by-Row)
   → FOR LOOP 안에서 건별 SELECT/INSERT/UPDATE
   → DB Call 폭증, 인덱스 중복 접근

② 불필요한 인덱스
   → 대량 INSERT/UPDATE 시 인덱스 유지 비용 과다

③ 잦은 COMMIT
   → 너무 자주 → Redo 로그 스위치 빈번 + 성능 저하
   → 너무 드물게 → Undo 세그먼트 고갈, 롤백 시간 과다

④ 전체 테이블 반복 스캔
   → 이미 처리한 데이터를 반복해서 읽는 구조

⑤ 소트 과다
   → 중간 집계, ORDER BY 등에서 Temp 디스크 소트
```

---

## 전략 1: One SQL로 통합

```sql
-- ❌ 나쁜 패턴: 루프로 건별 처리 (100만 건 = 100만 번 DB Call)
BEGIN
    FOR r IN (SELECT * FROM orders WHERE status = 'PENDING') LOOP
        -- 건별 계산 후 UPDATE
        UPDATE order_summary
        SET    total_amt = r.amount * r.qty
        WHERE  order_id = r.order_id;
    END LOOP;
    COMMIT;
END;

-- ✅ 좋은 패턴: One SQL로 집합 처리 (1번 DB Call)
UPDATE order_summary os
SET    total_amt = (
           SELECT o.amount * o.qty
           FROM   orders o
           WHERE  o.order_id = os.order_id
           AND    o.status = 'PENDING'
       )
WHERE EXISTS (
    SELECT 1 FROM orders o
    WHERE  o.order_id = os.order_id
    AND    o.status = 'PENDING'
);
-- 또는 MERGE로 더 간결하게:
MERGE INTO order_summary os
USING (SELECT order_id, amount * qty AS total_amt FROM orders WHERE status = 'PENDING') src
ON    (os.order_id = src.order_id)
WHEN MATCHED THEN UPDATE SET os.total_amt = src.total_amt;
```

---

## 전략 2: Direct Path INSERT + NOLOGGING

```sql
-- 대량 INSERT 시 Direct Path + NOLOGGING 조합
ALTER TABLE target_table NOLOGGING;

INSERT /*+ APPEND */ INTO target_table
SELECT col1, col2, col3
FROM   source_table
WHERE  condition;

COMMIT;

ALTER TABLE target_table LOGGING;   -- 작업 후 복구

-- NOLOGGING + APPEND 조합 효과:
-- Redo 생성 최소화 + Buffer Cache 우회 = 대용량 INSERT 최대 성능
```

---

## 전략 3: 인덱스 Disable → 작업 → Rebuild

```sql
-- 대량 INSERT 전 인덱스 비활성화 → 작업 완료 후 재구성
ALTER INDEX idx_orders_date UNUSABLE;
ALTER INDEX idx_orders_status UNUSABLE;

-- Direct Path INSERT 수행
INSERT /*+ APPEND */ INTO orders SELECT * FROM orders_stage;
COMMIT;

-- 인덱스 재구성 (병렬 처리 가능)
ALTER INDEX idx_orders_date   REBUILD NOLOGGING PARALLEL 4;
ALTER INDEX idx_orders_status REBUILD NOLOGGING PARALLEL 4;
ALTER INDEX idx_orders_date   NOPARALLEL;
ALTER INDEX idx_orders_status NOPARALLEL;
```

---

## 전략 4: 범위 분할 병렬 처리

대용량 테이블을 **범위 단위로 분할**하여 여러 프로세스가 동시에 처리하는 패턴.

```
파티션 기반 병렬 처리 패턴:

테이블: orders (2024년 데이터 1,000만 건, 월별 파티션)

프로세스 1 → p_2024_01 처리 (83만 건)
프로세스 2 → p_2024_02 처리 (83만 건)
프로세스 3 → p_2024_03 처리 (83만 건)
...
프로세스 12 → p_2024_12 처리 (83만 건)

→ 단순 병렬 처리 대비 12배 빠름 (Lock 경합 없음)
```

```sql
-- Oracle 병렬 힌트를 이용한 배치 처리
INSERT /*+ APPEND PARALLEL(t, 4) */ INTO target_table t
SELECT /*+ PARALLEL(s, 4) */ *
FROM   source_table s
WHERE  reg_date >= DATE '2024-01-01';
```

---

## 전략 5: 분할 COMMIT (Checkpoint)

```sql
-- 대량 처리를 청크 단위로 COMMIT하여 Undo 과다 방지
-- 체크포인트: 마지막으로 처리한 위치를 기록하여 재시작 가능하게 함

DECLARE
    v_last_id  NUMBER := 0;    -- 처리 재개 시작점
    v_count    NUMBER;
    c_batch    CONSTANT NUMBER := 100000;   -- 10만 건씩 처리
BEGIN
    -- 이전 중단 지점 복구 (체크포인트 테이블에서 읽기)
    SELECT NVL(MAX(last_processed_id), 0)
    INTO   v_last_id
    FROM   batch_checkpoint
    WHERE  job_name = 'ORDER_SUMMARY';

    LOOP
        -- 청크 단위 처리
        INSERT INTO order_summary
        SELECT order_id, SUM(amount) AS total
        FROM   orders
        WHERE  order_id > v_last_id
        AND    order_id <= v_last_id + c_batch
        AND    status = 'CLOSED'
        GROUP  BY order_id;

        v_count := SQL%ROWCOUNT;
        EXIT WHEN v_count = 0;

        v_last_id := v_last_id + c_batch;

        -- 체크포인트 갱신
        MERGE INTO batch_checkpoint cp
        USING DUAL ON (cp.job_name = 'ORDER_SUMMARY')
        WHEN MATCHED     THEN UPDATE SET cp.last_processed_id = v_last_id
        WHEN NOT MATCHED THEN INSERT VALUES ('ORDER_SUMMARY', v_last_id);

        COMMIT;   -- 청크 단위 커밋
    END LOOP;
END;
/
```

---

## 전략 6: 병렬 쿼리 (Parallel Query)

```sql
-- 테이블 레벨 병렬 설정
ALTER TABLE large_table PARALLEL 8;

-- 힌트로 병렬 처리 (더 권장 — 범위 지정 가능)
SELECT /*+ PARALLEL(t, 8) */ COUNT(*), SUM(amount)
FROM   orders t
WHERE  order_date >= DATE '2024-01-01';

-- 병렬 DML
ALTER SESSION ENABLE PARALLEL DML;
INSERT /*+ APPEND PARALLEL(t, 4) */ INTO target t SELECT * FROM source;
COMMIT;
ALTER SESSION DISABLE PARALLEL DML;

-- 적합한 케이스:
-- ✅ 대용량 집계/집계 쿼리 (Full Scan 필요한 배치)
-- ❌ OLTP 단건 조회 (오버헤드만 발생)
```

---

## 전략 7: 임시 테이블 (Global Temporary Table)

```sql
-- 배치 중간 결과를 임시 저장할 때 사용
-- Undo/Redo 최소 생성, 세션 간 격리

-- ON COMMIT DELETE ROWS: COMMIT 시 데이터 삭제 (기본)
CREATE GLOBAL TEMPORARY TABLE tmp_order_calc (
    order_id  NUMBER,
    calc_amt  NUMBER
) ON COMMIT DELETE ROWS;

-- ON COMMIT PRESERVE ROWS: 세션 종료 시 데이터 삭제
CREATE GLOBAL TEMPORARY TABLE tmp_order_calc (
    order_id  NUMBER,
    calc_amt  NUMBER
) ON COMMIT PRESERVE ROWS;

-- 배치 처리 패턴:
INSERT INTO tmp_order_calc SELECT order_id, amount * qty FROM orders WHERE ...;
-- GTT는 Undo 최소, 다른 세션에 보이지 않음 → 병렬 배치에서 유용
UPDATE orders o SET o.total = (SELECT calc_amt FROM tmp_order_calc t WHERE t.order_id = o.order_id);
COMMIT;
```

---

## 배치 성능 체크리스트

| 항목 | 체크 | 개선 방법 |
|------|------|---------|
| 루프 안 SQL | ❌ 루프 | BULK COLLECT + FORALL 또는 One SQL |
| 인덱스 수 | 많으면 DML 느림 | 배치 전 UNUSABLE, 후 REBUILD |
| COMMIT 주기 | 너무 빈번/드물게 | 10만~100만 건 단위 |
| 소트 발생 | Temp 사용 | 인덱스 활용, UNION ALL, 배치용 PGA 확대 |
| 병렬 처리 | 미사용 | PARALLEL 힌트 / 파티션 기반 분할 |
| 재시작 가능 | 중단 시 처음부터 | 체크포인트 패턴 구현 |

---

## 시험 포인트

- **배치 목표**: Throughput (처리량) 최대화 — OLTP의 Response Time 최소화와 대비
- **One SQL**: 루프 건별 처리 → 집합 SQL / MERGE 통합 → Call 횟수 N → 1
- **Direct Path + NOLOGGING**: 대량 INSERT 최적화 — Redo 최소 + Buffer Cache 우회
- **인덱스 UNUSABLE → REBUILD**: 대량 DML 전후 인덱스 비활성화/재구성
- **분할 COMMIT + 체크포인트**: Undo 과다 방지 + 중단 시 재시작 가능
- **병렬 처리**: `PARALLEL` 힌트 — Full Scan 배치에 적합, OLTP에는 부적합
- **GTT(Global Temporary Table)**: Undo/Redo 최소, 세션 간 격리 — 중간 결과 저장
