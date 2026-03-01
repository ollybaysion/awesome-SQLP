---
title: DML 튜닝
tags: [튜닝, DML, INSERT, UPDATE, DELETE, 인덱스부하, DirectPathWrite]
---
# DML 튜닝

**DML(INSERT/UPDATE/DELETE)**은 데이터를 변경하는 SQL로, SELECT와 달리 **인덱스 유지 비용**, **Undo/Redo 생성**, **락(Lock)** 등 추가 부하가 발생한다.
대용량 데이터 처리 시 DML 성능 최적화는 필수적이다.

---

## DML과 인덱스 부하

테이블에 인덱스가 많을수록 DML 성능이 저하된다.
INSERT 1건이라도 **테이블 + N개 인덱스** 모두에 변경이 발생한다.

```
테이블에 인덱스 5개 존재 시 INSERT 1건의 실제 작업:
  ① 테이블 Block에 행 삽입 (1번)
  ② 인덱스 1 리프 블록 변경 (1번)
  ③ 인덱스 2 리프 블록 변경 (1번)
  ④ 인덱스 3 리프 블록 변경 (1번)
  ⑤ 인덱스 4 리프 블록 변경 (1번)
  ⑥ 인덱스 5 리프 블록 변경 (1번)
  + 각 변경에 대한 Undo/Redo 생성

→ 불필요한 인덱스 제거가 DML 성능 향상의 첫 번째 방법
```

### 인덱스와 DML 성능

| 인덱스 수 | INSERT | UPDATE | DELETE |
|---------|--------|--------|--------|
| 없음 | 빠름 | 빠름 | 빠름 |
| 1개 | 약간 느림 | 변경 컬럼 해당 시 느림 | 느림 |
| 많을수록 | 느려짐 | 변경 컬럼 수에 비례 | 느려짐 |

> UPDATE는 변경 대상 컬럼이 포함된 인덱스만 재구성하지만, DELETE/INSERT는 모든 인덱스에 영향을 미친다.

---

## Direct Path Insert (직접 경로 삽입)

일반 INSERT는 **Buffer Cache**를 거쳐 데이터를 삽입하지만,
**Direct Path Insert**는 **Buffer Cache를 우회**하여 데이터 파일에 직접 기록한다.

```sql
-- ① INSERT /*+ APPEND */ 힌트 (Direct Path Insert)
INSERT /*+ APPEND */ INTO target_table
SELECT * FROM source_table WHERE condition;
COMMIT;

-- ② INSERT /*+ APPEND PARALLEL */ 병렬 Direct Path
INSERT /*+ APPEND PARALLEL(target_table, 4) */ INTO target_table
SELECT * FROM source_table;
COMMIT;
```

### Direct Path Insert 동작 원리

```
일반 INSERT:
  Free List에서 여유 블록 찾기 → Buffer Cache 로드 → 행 삽입 → Dirty Block → Redo 기록

Direct Path Insert:
  HWM(High Water Mark) 위에 새 익스텐트 직접 할당 → 데이터 파일에 직접 기록
  → Buffer Cache 생략, Free List 검색 생략 → 대량 INSERT 시 매우 빠름
```

| 구분 | 일반 INSERT | Direct Path INSERT |
|------|-----------|-------------------|
| 경로 | Buffer Cache 경유 | Buffer Cache 우회, 직접 기록 |
| Undo 생성 | 발생 | **최소화** (Direct Load Undo만) |
| Redo 생성 | 발생 | **NOLOGGING 모드 시 최소화** |
| 빈 공간 재사용 | 기존 빈 블록 재사용 | HWM 위에 새 공간 할당 |
| 속도 | 보통 | 매우 빠름 (대량 처리 시) |
| 제약 | 없음 | Exclusive Lock, 다른 세션 대기 |

### Direct Path Insert 주의사항

```sql
-- ⚠️ Direct Path INSERT 후 COMMIT 전까지 같은 테이블 DML/SELECT 불가
INSERT /*+ APPEND */ INTO emp_backup SELECT * FROM emp;
-- 이 시점에서 같은 세션에서 emp_backup 접근 불가 (Exclusive Lock)
COMMIT;   -- COMMIT 후 다른 세션도 접근 가능

-- ⚠️ 인덱스가 있는 테이블에도 Direct Path INSERT 가능하지만
--    인덱스 변경은 여전히 발생 → 완전한 이점을 위해선 인덱스 비활성화 후 재생성 고려
ALTER INDEX idx_emp_deptno UNUSABLE;
INSERT /*+ APPEND */ INTO emp SELECT * FROM emp_source;
COMMIT;
ALTER INDEX idx_emp_deptno REBUILD;   -- 인덱스 재생성
```

---

## NOLOGGING 모드

**NOLOGGING** 설정 시 Redo Log 생성을 최소화하여 대량 DML 성능을 크게 향상시킨다.

```sql
-- 테이블을 NOLOGGING으로 변경
ALTER TABLE emp_backup NOLOGGING;

-- Direct Path INSERT + NOLOGGING 조합 (최대 성능)
INSERT /*+ APPEND */ INTO emp_backup SELECT * FROM emp;
COMMIT;

-- 작업 후 LOGGING으로 복구
ALTER TABLE emp_backup LOGGING;
```

> ⚠️ **주의**: NOLOGGING 데이터는 Archive Log 기반 복구 불가.
> 운영 환경에서는 반드시 백업 후 사용하고, 작업 완료 후 즉시 백업 권장.

---

## 대량 UPDATE/DELETE 튜닝

### UPDATE 튜닝

```sql
-- ❌ 느린 방법: 건별 UPDATE (커서 루프)
-- 10만 건을 1건씩 UPDATE → 10만 번의 DML, Lock 경합

-- ✅ 집합 기반 UPDATE (1회 처리)
UPDATE emp e
SET    sal = sal * 1.1
WHERE  deptno = 10;

-- ✅ 상관 서브쿼리 UPDATE
UPDATE emp e
SET    e.sal = (SELECT d.sal_grade * e.sal FROM dept_grade d WHERE d.deptno = e.deptno)
WHERE  EXISTS (SELECT 1 FROM dept_grade d WHERE d.deptno = e.deptno);

-- ✅ Merge 문으로 대체 (더 유연)
MERGE INTO emp e
USING dept_grade dg ON (e.deptno = dg.deptno)
WHEN MATCHED THEN
    UPDATE SET e.sal = dg.sal_grade * e.sal;
```

### DELETE → TRUNCATE 대체

```sql
-- ❌ 느린 방법: 전체 데이터 삭제 시 DELETE 사용
DELETE FROM emp_log;   -- 건별 Undo 생성, 느림

-- ✅ TRUNCATE: 테이블 전체 삭제 시 DDL로 처리 → Undo 최소, 매우 빠름
TRUNCATE TABLE emp_log;
-- 단, TRUNCATE는 ROLLBACK 불가 (DDL이므로 자동 COMMIT)
-- 조건부 삭제는 TRUNCATE 불가 → DELETE 사용
```

### 대량 DELETE 분할 처리

```sql
-- ❌ 한 번에 대량 DELETE → Undo 과다, 락 장시간 보유
DELETE FROM order_log WHERE reg_date < '2020-01-01';   -- 수백만 건

-- ✅ 배치 단위로 분할 처리 → Undo 분산, 락 부담 감소
DECLARE
    v_count NUMBER := 1;
BEGIN
    WHILE v_count > 0 LOOP
        DELETE FROM order_log
        WHERE  reg_date < '2020-01-01'
        AND    ROWNUM <= 10000;    -- 1만 건씩 처리
        v_count := SQL%ROWCOUNT;
        COMMIT;
    END LOOP;
END;
/
```

---

## MERGE 문 (Upsert)

**MERGE**는 조건에 따라 INSERT 또는 UPDATE를 하나의 SQL로 처리하는 구문이다.
배치 처리에서 소스 테이블 기준으로 타겟 테이블을 동기화할 때 매우 유용하다.

```sql
MERGE INTO emp_target t
USING emp_source s ON (t.empno = s.empno)
WHEN MATCHED THEN
    UPDATE SET t.sal = s.sal,
               t.job = s.job
    WHERE  t.sal <> s.sal   -- 변경된 행만 UPDATE (불필요한 UPDATE 방지)
    DELETE WHERE s.status = 'INACTIVE'   -- UPDATE 후 삭제 조건 (선택)
WHEN NOT MATCHED THEN
    INSERT (t.empno, t.ename, t.sal, t.job)
    VALUES (s.empno, s.ename, s.sal, s.job)
    WHERE  s.status = 'ACTIVE';   -- INSERT 조건 (선택)
```

---

## 파티션 테이블 DML 활용

```sql
-- 파티션 Pruning: 해당 파티션만 접근 → DML 범위 축소
DELETE FROM orders PARTITION (p_2023) WHERE status = 'CANCELLED';

-- 파티션 EXCHANGE: 파티션 통째로 교체 (대용량 적재 패턴)
-- ① 스테이징 테이블에 데이터 Direct Path INSERT
INSERT /*+ APPEND */ INTO orders_stage SELECT * FROM orders_new;
COMMIT;
-- ② 파티션과 스테이징 테이블 교체 (DDL, 즉시 처리)
ALTER TABLE orders EXCHANGE PARTITION p_2024 WITH TABLE orders_stage;
-- → 수백만 건을 수초 내 교체 가능
```

---

## 시험 포인트

- **인덱스 = DML 부하**: 인덱스 수에 비례해 INSERT/DELETE 느려짐, UPDATE는 변경 컬럼 포함 인덱스만
- **Direct Path INSERT (`APPEND` 힌트)**: Buffer Cache 우회, HWM 위에 직접 기록 → 대량 INSERT 최적
- **NOLOGGING**: Redo 최소화 → 대량 처리 성능 향상, 단 복구 불가 주의
- **APPEND 후 COMMIT 전**: 같은 테이블 접근 불가 (Exclusive Lock)
- **TRUNCATE vs DELETE**: 전체 삭제 시 TRUNCATE가 훨씬 빠름 (DDL, Undo 최소), 단 ROLLBACK 불가
- **MERGE 문**: 조건부 INSERT/UPDATE를 1개 SQL로 처리 (Upsert 패턴)
- **대량 DELETE 분할**: `ROWNUM <= N` + COMMIT 루프로 Undo/Lock 분산
