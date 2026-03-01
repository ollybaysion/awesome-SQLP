---
title: 옵티마이저
tags: [튜닝, 옵티마이저]
---
# 옵티마이저(Optimizer)

## 개념

옵티마이저는 **SQL을 실행하는 가장 효율적인 방법(실행 계획)을 결정하는 DBMS의 핵심 엔진**이다.

```
SQL 문 → [파서] → [옵티마이저] → 실행 계획 → [실행 엔진] → 결과
```

## 옵티마이저 종류

### RBO (Rule-Based Optimizer, 규칙기반)

- **미리 정해진 우선순위 규칙**에 따라 실행 계획 수립
- 통계 정보 미사용
- Oracle 10g 이후 공식 지원 종료 (레거시)

### CBO (Cost-Based Optimizer, 비용기반)

- **통계 정보를 기반으로 비용(Cost)을 계산**하여 최소 비용 계획 선택
- 현재 대부분의 RDBMS가 사용
- 오브젝트 통계, 시스템 통계 활용

## 옵티마이저 구성 요소

```
SQL ─→ [Query Transformer] ─→ 변환된 SQL
              ↓
       [Plan Generator] ─→ 후보 실행 계획들
              ↓
       [Cost Estimator] ─→ 비용 계산
              ↓
       최저 비용 실행 계획 선택
```

| 구성요소 | 역할 |
|---------|------|
| Query Transformer | SQL을 더 나은 형태로 변환 (서브쿼리 Unnesting 등) |
| Plan Generator | 가능한 실행 계획 조합 생성 |
| Cost Estimator | 각 계획의 예상 비용 계산 |

## 실행 계획 (Execution Plan)

```sql
-- Oracle 실행 계획 확인
EXPLAIN PLAN FOR
SELECT e.ename, d.dname
FROM emp e JOIN dept d ON e.deptno = d.deptno
WHERE e.sal > 2000;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
```

### 실행 계획 읽는 법

```
Id | Operation               | Name    | Rows | Cost
---+--------------------------+---------+------+------
 0 | SELECT STATEMENT        |         |    5 |    6
 1 |  HASH JOIN              |         |    5 |    6
 2 |   TABLE ACCESS FULL     | DEPT    |    4 |    3
 3 |   TABLE ACCESS BY INDEX | EMP     |    5 |    3
 4 |    INDEX RANGE SCAN     | SAL_IDX |    5 |    1
```

- **들여쓰기**: 깊을수록 먼저 실행
- **같은 레벨**: 위쪽이 먼저 실행

## 통계 정보

CBO가 최적 계획 수립에 활용하는 정보:

| 유형 | 내용 |
|------|------|
| 테이블 통계 | 행 수, 블록 수, 평균 행 길이 |
| 컬럼 통계 | Distinct 값 수, NULL 비율, 최소/최대값, 히스토그램 |
| 인덱스 통계 | Leaf Block 수, 클러스터링 팩터, 높이 |
| 시스템 통계 | I/O 속도, CPU 속도 |

```sql
-- 통계 정보 수집 (Oracle)
EXEC DBMS_STATS.GATHER_TABLE_STATS('SCOTT', 'EMP');
EXEC DBMS_STATS.GATHER_SCHEMA_STATS('SCOTT');
```

## 옵티마이저 힌트

CBO의 판단을 무시하고 **특정 실행 계획을 강제**하는 방법.

```sql
-- 인덱스 힌트
SELECT /*+ INDEX(e SAL_IDX) */ ename, sal
FROM emp e
WHERE sal > 2000;

-- Full Table Scan 강제
SELECT /*+ FULL(e) */ ename, sal
FROM emp e
WHERE sal > 2000;

-- 조인 방식 강제
SELECT /*+ USE_NL(e d) */ e.ename, d.dname
FROM emp e, dept d
WHERE e.deptno = d.deptno;
```

| 힌트 | 설명 |
|------|------|
| `INDEX(t idx)` | 특정 인덱스 사용 |
| `FULL(t)` | Full Table Scan 강제 |
| `USE_NL(t1 t2)` | Nested Loop Join |
| `USE_HASH(t1 t2)` | Hash Join |
| `USE_MERGE(t1 t2)` | Sort Merge Join |
| `LEADING(t)` | 드라이빙 테이블 지정 |

## 바인드 변수 (Bind Variable)

```sql
-- 리터럴 SQL (하드 파싱 매번 발생)
SELECT * FROM emp WHERE empno = 7369;
SELECT * FROM emp WHERE empno = 7788;

-- 바인드 변수 사용 (소프트 파싱 재사용)
SELECT * FROM emp WHERE empno = :empno;
```

- 하드 파싱: SQL 파싱 + 실행 계획 수립 (비용 큼)
- 소프트 파싱: 공유 풀에서 실행 계획 재사용 (비용 작음)

## 시험 포인트

- RBO vs CBO 차이 (규칙 vs 비용/통계)
- CBO 3요소: Query Transformer, Plan Generator, Cost Estimator
- 실행 계획 읽기: 들여쓰기 깊을수록 먼저 실행
- 힌트 사용법과 주요 힌트 종류
- 바인드 변수의 장점 (소프트 파싱 재사용)
- 통계 정보가 부정확하면 잘못된 실행 계획 수립 가능
