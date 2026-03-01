---
title: 파티셔닝 (Partitioning)
tags: [튜닝, 파티셔닝, PartitionPruning, 파티션인덱스, 대용량]
---
# 파티셔닝 (Partitioning)

**파티셔닝**은 대용량 테이블을 **논리적으로는 하나의 테이블이지만 물리적으로는 여러 세그먼트**로 분할하여 관리하는 기법이다.
파티션 키 조건이 SQL에 있을 때 **Partition Pruning**이 발생하여 필요한 파티션만 접근, I/O를 획기적으로 줄인다.

---

## 파티셔닝의 목적

| 목적 | 설명 |
|------|------|
| **성능** | Partition Pruning — 전체 테이블이 아닌 일부 파티션만 스캔 |
| **관리** | 오래된 데이터 파티션 단위로 DROP/TRUNCATE (빠름) |
| **가용성** | 특정 파티션 장애 시 다른 파티션 서비스 지속 |
| **병렬 처리** | 파티션별 병렬 스캔/처리 가능 |

---

## 파티션 종류

### 1. Range 파티셔닝

```sql
-- 날짜 범위로 파티셔닝 (가장 많이 사용)
CREATE TABLE orders (
    order_id   NUMBER,
    order_date DATE,
    amount     NUMBER
)
PARTITION BY RANGE (order_date) (
    PARTITION p_2022 VALUES LESS THAN (DATE '2023-01-01'),
    PARTITION p_2023 VALUES LESS THAN (DATE '2024-01-01'),
    PARTITION p_2024 VALUES LESS THAN (DATE '2025-01-01'),
    PARTITION p_max  VALUES LESS THAN (MAXVALUE)   -- 나머지 전부
);
```

### 2. List 파티셔닝

```sql
-- 특정 값 목록으로 파티셔닝
CREATE TABLE emp_part (
    empno  NUMBER,
    ename  VARCHAR2(20),
    region VARCHAR2(10)
)
PARTITION BY LIST (region) (
    PARTITION p_seoul   VALUES ('SEOUL', 'INCHEON'),
    PARTITION p_busan   VALUES ('BUSAN', 'ULSAN'),
    PARTITION p_others  VALUES (DEFAULT)   -- 나머지 전부
);
```

### 3. Hash 파티셔닝

```sql
-- 해시 함수로 균등 분산 (특정 키 범위 집중 방지)
CREATE TABLE large_table (
    id    NUMBER,
    data  VARCHAR2(100)
)
PARTITION BY HASH (id)
PARTITIONS 8;   -- 8개 파티션으로 균등 분산
```

### 4. Composite 파티셔닝 (복합 파티셔닝)

```sql
-- Range-Hash: 날짜로 Range 후 Hash로 균등 분산
CREATE TABLE sales (
    sale_id   NUMBER,
    sale_date DATE,
    region    VARCHAR2(10)
)
PARTITION BY RANGE (sale_date)
SUBPARTITION BY HASH (region) SUBPARTITIONS 4
(
    PARTITION p_2023 VALUES LESS THAN (DATE '2024-01-01'),
    PARTITION p_2024 VALUES LESS THAN (DATE '2025-01-01')
);
-- → 각 Range 파티션 내에 4개의 Hash 서브파티션 = 총 8개 파티션
```

---

## Partition Pruning

```sql
-- 파티션 조건(partition key)이 WHERE 절에 있으면 Pruning 발생
SELECT * FROM orders WHERE order_date >= DATE '2024-01-01';
-- → p_2024, p_max 파티션만 접근 (p_2022, p_2023 건너뜀)

-- 실행 계획에서 Pruning 확인
EXPLAIN PLAN FOR
SELECT * FROM orders WHERE order_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31';

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY());
```

```
Pruning 실행 계획 예시:
| Id | Operation             | Name   | Pstart | Pstop |
|  0 | SELECT STATEMENT      |        |        |       |
|  1 |  PARTITION RANGE SINGLE| |      3 |     3 |   ← Pstart=Pstop → 단일 파티션 접근
|  2 |   TABLE ACCESS FULL   | ORDERS |      3 |     3 |

Pstart / Pstop:
  - 동일 번호 → 단일 파티션
  - 범위 번호 → 여러 파티션 범위 접근
  - KEY → 런타임에 결정 (바인드 변수)
  - 1 / 1048575 → Pruning 안 됨 (전체 파티션 접근)
```

### Partition Pruning이 안 되는 경우

```sql
-- ❌ 파티션 키에 함수 적용 → Pruning 불가
SELECT * FROM orders WHERE TRUNC(order_date) = DATE '2024-06-01';

-- ❌ 파티션 키가 조건에 없음
SELECT * FROM orders WHERE amount > 10000;   -- order_date 조건 없음 → 전체 파티션

-- ✅ 파티션 키를 직접 조건으로 사용해야 Pruning 발생
SELECT * FROM orders WHERE order_date = DATE '2024-06-01';
```

---

## 파티션 인덱스

### Local 인덱스 vs Global 인덱스

| 구분 | Local 인덱스 | Global 인덱스 |
|------|------------|--------------|
| 정의 | 파티션별 독립 인덱스 | 전체 테이블에 하나의 인덱스 |
| 파티션 관리 | 파티션 DROP/TRUNCATE 시 해당 인덱스 자동 관리 | 파티션 변경 시 **인덱스 전체 재구성 필요** |
| 조회 성능 | 파티션 키 포함 쿼리에 최적 | 파티션 키 없는 고유성 보장에 유리 |
| 권장 | 파티션 키가 쿼리 조건에 자주 등장 시 | Unique 제약 등 파티션 키 무관 고유성 필요 시 |

```sql
-- Local 인덱스 (파티션별 생성)
CREATE INDEX idx_orders_amount ON orders(amount) LOCAL;

-- Global 인덱스 (파티션 무관 단일 인덱스)
CREATE UNIQUE INDEX idx_orders_id ON orders(order_id) GLOBAL;

-- Local Prefixed: 인덱스 선두 컬럼 = 파티션 키 → Pruning 최적
CREATE INDEX idx_orders_date_amt ON orders(order_date, amount) LOCAL;
-- → order_date 조건 있으면 인덱스도 Pruning

-- Local Non-Prefixed: 인덱스 선두 컬럼 ≠ 파티션 키
CREATE INDEX idx_orders_amt ON orders(amount) LOCAL;
-- → amount 조건만으로는 인덱스 Pruning 불가 (모든 파티션 인덱스 접근)
```

---

## 파티션 DDL 관리

```sql
-- 파티션 추가
ALTER TABLE orders ADD PARTITION p_2025 VALUES LESS THAN (DATE '2026-01-01');

-- 파티션 삭제 (해당 데이터도 삭제) → 매우 빠름 (테이블 DDL)
ALTER TABLE orders DROP PARTITION p_2022;

-- 파티션 데이터만 삭제 (구조 유지)
ALTER TABLE orders TRUNCATE PARTITION p_2022;

-- 파티션 분할 (SPLIT)
ALTER TABLE orders SPLIT PARTITION p_max
    AT (DATE '2026-01-01')
    INTO (PARTITION p_2025, PARTITION p_max2);

-- 파티션 병합 (MERGE)
ALTER TABLE orders MERGE PARTITIONS p_2022, p_2023 INTO PARTITION p_old;
```

---

## 파티션 활용 패턴 — Sliding Window

```sql
-- 월별 파티션에서 오래된 파티션을 아카이브로 이동하는 패턴

-- ① 가장 오래된 파티션을 아카이브 테이블로 교체 (순간 처리)
ALTER TABLE orders EXCHANGE PARTITION p_old
    WITH TABLE orders_archive_2022
    INCLUDING INDEXES;   -- 인덱스도 함께 교체

-- ② 오래된 파티션 삭제
ALTER TABLE orders DROP PARTITION p_old;

-- ③ 새 파티션 추가
ALTER TABLE orders ADD PARTITION p_new VALUES LESS THAN (DATE '2027-01-01');
```

---

## 시험 포인트

- **파티션 Pruning**: 파티션 키가 WHERE 조건에 **직접** 있어야 발생 (함수 감싸면 Pruning 불가)
- **실행 계획 Pstart/Pstop**: 동일 → 단일 파티션, KEY → 바인드 변수, `1/1048575` → Pruning 실패
- **Range 파티셔닝**: 날짜 범위 — OLAP/이력 테이블에서 가장 많이 사용
- **List 파티셔닝**: 특정 값 목록 — 지역/코드성 컬럼에 적합
- **Hash 파티셔닝**: 균등 분산 — hot block 방지
- **Local vs Global 인덱스**: Local은 파티션 관리 편리, Global은 파티션 변경 시 재구성 필요
- **Local Prefixed**: 인덱스 선두 = 파티션 키 → 인덱스도 Pruning
- **파티션 DROP/TRUNCATE**: DELETE보다 훨씬 빠름 (DDL 수준)
- **EXCHANGE PARTITION**: 파티션과 테이블 통째 교체 → 대용량 데이터 적재 패턴
