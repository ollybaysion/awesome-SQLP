---
title: SQL 옵티마이징 원리
tags: [옵티마이저, 실행계획, 통계정보, 비용기반, 규칙기반]
---
# SQL 옵티마이징 원리

**옵티마이저(Optimizer)**는 SQL을 받아 가장 효율적인 실행 계획을 선택하는 Oracle DBMS의 핵심 컴포넌트다.
개발자가 작성한 SQL은 옵티마이저를 거쳐 실제 실행 계획으로 변환되며, 이 과정에서 성능이 결정된다.

---

## 옵티마이저의 역할

```
SQL 문장 입력
     ↓
① Parser          — 문법 검사, 파싱 트리 생성
     ↓
② Query Transformer — 쿼리 변환 (서브쿼리 Unnesting, 뷰 Merging 등)
     ↓
③ Estimator       — 통계 정보로 비용 산정 (Selectivity, Cardinality, Cost)
     ↓
④ Plan Generator  — 후보 실행 계획 생성 (조인 순서, 조인 방식, 접근 방법)
     ↓
⑤ 최저 비용 실행 계획 선택
     ↓
Row Source Generator → 실행 트리 생성 → 실행
```

---

## 규칙 기반 옵티마이저 (RBO)

**RBO(Rule-Based Optimizer)**는 사전에 정의된 **우선순위 규칙**에 따라 실행 계획을 선택한다.
Oracle 10g부터 공식 지원 중단(Deprecated), 현재는 CBO만 권장.

### RBO 우선순위 규칙 (일부)

| 순위 | 접근 방법 |
|------|----------|
| 1 | ROWID에 의한 단일 행 접근 |
| 4 | Unique Index에 의한 단일 행 접근 |
| 8 | Composite Index에 의한 범위 스캔 |
| 9 | Single Column Index에 의한 범위 스캔 |
| 15 | Full Table Scan |

> 숫자가 낮을수록 우선순위가 높다 (1이 가장 유리).

**RBO의 한계**:
- 데이터 분포(통계) 무시 → 10건 테이블과 100만 건 테이블에 같은 Full Scan 규칙 적용
- 파티션, 병렬처리 등 신기능 지원 불가
- 현재는 사용하지 않음

---

## 비용 기반 옵티마이저 (CBO)

**CBO(Cost-Based Optimizer)**는 **통계 정보를 바탕으로 각 실행 계획의 비용을 산정**하여 최저 비용 계획을 선택한다.

### CBO의 비용 산정 3요소

```
① Selectivity (선택도)
   - 전체 행 중 조건에 맞는 행의 비율
   - 예: emp 14건 중 deptno=10인 행 3건 → Selectivity = 3/14 ≈ 0.21

② Cardinality (카디널리티)
   - 특정 조건에서 반환될 예상 행 수
   - Cardinality = 전체 행 수 × Selectivity
   - 예: 14 × 0.21 ≈ 3건

③ Cost (비용)
   - I/O 비용 + CPU 비용을 단일 수치로 환산
   - 단위: Single Block I/O 횟수 기준
   - 낮을수록 좋음
```

### CBO 통계 정보의 종류

| 통계 유형 | 수집 대상 | 주요 항목 |
|----------|---------|---------|
| **테이블 통계** | 테이블 | 총 행 수(num_rows), 블록 수(blocks), 평균 행 길이 |
| **컬럼 통계** | 컬럼 | NDV(Distinct Value 수), NULL 수, 최솟/최댓값, 히스토그램 |
| **인덱스 통계** | 인덱스 | Leaf Block 수, 레벨(Height), 클러스터링 팩터 |
| **시스템 통계** | I/O·CPU | Single/Multi Block Read Time, CPU Speed |

### 통계 수집

```sql
-- 테이블 + 인덱스 + 컬럼 통계 수집
EXEC DBMS_STATS.GATHER_TABLE_STATS(
    ownname  => 'SCOTT',
    tabname  => 'EMP',
    cascade  => TRUE,        -- 인덱스 통계도 함께 수집
    estimate_percent => DBMS_STATS.AUTO_SAMPLE_SIZE   -- 자동 샘플 크기
);

-- 스키마 전체 통계 수집
EXEC DBMS_STATS.GATHER_SCHEMA_STATS(ownname => 'SCOTT', cascade => TRUE);

-- 통계 조회
SELECT num_rows, blocks, last_analyzed FROM user_tables WHERE table_name = 'EMP';
SELECT column_name, num_distinct, num_nulls FROM user_tab_columns WHERE table_name = 'EMP';
```

---

## 히스토그램 (Histogram)

**히스토그램**은 컬럼의 데이터 분포가 균등하지 않을 때, 분포 특성을 통계에 반영하는 구조다.

```sql
-- 히스토그램 없을 때: NDV=4인 deptno → Selectivity = 1/4 = 25% 균등 가정
-- 실제: deptno=30에 직원 6명(43%), deptno=10에 3명(21%) → 불균등

-- 히스토그램 수집
EXEC DBMS_STATS.GATHER_TABLE_STATS(
    ownname => 'SCOTT', tabname => 'EMP',
    method_opt => 'FOR COLUMNS deptno SIZE AUTO'   -- 히스토그램 자동 생성
);

-- 조회
SELECT column_name, histogram, num_distinct, num_buckets
FROM   user_tab_col_statistics
WHERE  table_name = 'EMP';
```

| 히스토그램 종류 | 설명 | 사용 조건 |
|--------------|------|---------|
| **Frequency** | 각 값의 빈도를 버킷에 저장 | NDV ≤ 254 |
| **Height-Balanced** | 동일 높이(행 수)로 버킷 분할 | NDV > 254 |
| **Hybrid** (12c+) | Frequency + HB 혼합 | NDV > 254, 인기 값 별도 |
| **Top-Frequency** (12c+) | 가장 빈도 높은 값 중심 | 소수 인기 값 편중 시 |

---

## 옵티마이저 힌트

힌트는 CBO의 판단을 개발자가 **강제로 오버라이드**할 때 사용한다.

### 자주 사용하는 힌트

```sql
-- 접근 방법 힌트
SELECT /*+ FULL(e) */  e.ename FROM emp e;         -- Full Table Scan 강제
SELECT /*+ INDEX(e IDX_EMP_DEPTNO) */ e.ename FROM emp e WHERE e.deptno = 10;

-- 조인 순서 힌트
SELECT /*+ LEADING(d e) */ e.ename, d.dname
FROM   emp e, dept d WHERE e.deptno = d.deptno;    -- DEPT → EMP 순서 강제

-- 조인 방식 힌트
SELECT /*+ USE_NL(e d) */   e.ename, d.dname FROM emp e, dept d WHERE ...;  -- NL 조인
SELECT /*+ USE_HASH(e d) */ e.ename, d.dname FROM emp e, dept d WHERE ...;  -- Hash 조인
SELECT /*+ USE_MERGE(e d) */e.ename, d.dname FROM emp e, dept d WHERE ...;  -- Sort Merge

-- 통계/쿼리 변환 힌트
SELECT /*+ NO_MERGE(v) */ * FROM (SELECT * FROM emp WHERE deptno = 10) v;   -- 뷰 Merging 방지
SELECT /*+ UNNEST */ * FROM emp WHERE deptno IN (SELECT deptno FROM dept);  -- Unnesting 강제
SELECT /*+ NO_UNNEST */ * FROM emp WHERE deptno IN (...);                   -- Unnesting 방지
```

### 힌트 사용 시 주의사항

```sql
-- ❌ 잘못된 힌트 (테이블 별칭과 불일치) → 힌트 무시됨 (오류 아님!)
SELECT /*+ INDEX(emp IDX_EMP_DEPTNO) */  -- 별칭 'e' 사용했는데 'emp' 지정 → 무시
       e.ename FROM emp e WHERE e.deptno = 10;

-- ✅ 올바른 힌트 (별칭과 일치)
SELECT /*+ INDEX(e IDX_EMP_DEPTNO) */
       e.ename FROM emp e WHERE e.deptno = 10;
```

---

## 옵티마이저 관련 파라미터

```sql
-- 현재 옵티마이저 모드 확인
SELECT value FROM v$parameter WHERE name = 'optimizer_mode';
-- ALL_ROWS (기본): 전체 처리량 최소화 (Hash Join, Full Scan 선호)
-- FIRST_ROWS_n: 처음 n행 빠르게 반환 (NL 조인, Index 선호)
-- FIRST_ROWS: 첫 번째 행 반환 속도 최적화 (규칙 기반 요소 혼용)

-- 세션 단위 변경
ALTER SESSION SET optimizer_mode = FIRST_ROWS_10;

-- 통계 수집 레벨
SELECT value FROM v$parameter WHERE name = 'statistics_level';
-- TYPICAL (기본): 주요 통계만 수집
-- ALL: 모든 통계 수집 (DBMS_XPLAN A-Rows 포함)
```

---

## 실행 계획 확인 방법 요약

| 방법 | 명령 | 특징 |
|------|------|------|
| EXPLAIN PLAN | `EXPLAIN PLAN FOR sql;` → `DBMS_XPLAN.DISPLAY` | 예상 계획만 (실제 통계 없음) |
| DBMS_XPLAN.DISPLAY_CURSOR | SQL 실행 후 `ALLSTATS LAST` | 실제 실행 통계 포함 (권장) |
| SQL Trace + TKProf | `sql_trace=TRUE` → tkprof | 상세 대기 이벤트 포함 |
| Autotrace | `SET AUTOTRACE ON` | SQL*Plus에서 즉시 확인 |

```sql
-- Autotrace (SQL*Plus)
SET AUTOTRACE ON EXPLAIN STATISTICS
SELECT e.ename, d.dname FROM emp e, dept d WHERE e.deptno = d.deptno;
```

---

## 시험 포인트

- **RBO vs CBO**: RBO는 규칙 우선순위, CBO는 통계 기반 비용 최소화 → Oracle 10g 이후 CBO만 사용
- **CBO 3요소**: Selectivity(선택도) → Cardinality(예상 행 수) → Cost(비용)
- **통계 부정확 시**: 잘못된 실행 계획 선택 → `DBMS_STATS.GATHER_TABLE_STATS`로 재수집
- **히스토그램**: 데이터 분포가 불균등한 컬럼에 필수 → Frequency/Height-Balanced/Hybrid
- **힌트**: `/*+ 힌트명(별칭) */` — 테이블 별칭과 반드시 일치, 불일치 시 힌트 무시(오류 아님)
- **optimizer_mode**: `ALL_ROWS`(기본, OLAP), `FIRST_ROWS_n`(OLTP, 빠른 첫 행 반환)
