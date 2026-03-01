---
title: DBMS_XPLAN.DISPLAY_CURSOR — 실시간 실행 계획 분석
tags: [튜닝, DBMS_XPLAN, 실행계획, Row Source Operation]
---
# DBMS_XPLAN.DISPLAY_CURSOR — 실시간 실행 계획 분석

**DBMS_XPLAN.DISPLAY_CURSOR**는 SQL Trace/TKProf 없이 **Library Cache에 캐싱된 SQL의 실제 실행 계획과 통계**를 즉시 조회할 수 있는 함수다.
`V$SQL`, `V$SQL_PLAN_STATISTICS_ALL` 뷰를 기반으로 동작하며, 실시간 성능 분석에 가장 많이 사용된다.

---

## SQL Trace vs DBMS_XPLAN.DISPLAY_CURSOR 비교

| 구분 | SQL Trace + TKProf | DBMS_XPLAN.DISPLAY_CURSOR |
|------|-------------------|--------------------------|
| 사전 설정 | Trace 활성화 필요 | **불필요** (캐시에 있으면 바로 조회) |
| 조회 시점 | 실행 후 파일 변환 | **실행 직후 즉시** |
| 대상 | 특정 세션의 SQL | Library Cache의 모든 SQL |
| 실제 행 수 | Row Source Operation | **A-Rows** (실제 처리 행 수) |
| 메모리 사용 | 파일 기반 | 메모리 기반 (캐시 사라지면 조회 불가) |
| 상세도 | 대기 이벤트까지 | 실행 계획 + 통계 중심 |

---

## 기본 사용법

### 방법 1: 직전 실행 SQL 조회 (가장 많이 사용)

```sql
-- ① 분석할 SQL 실행
SELECT d.dname, e.ename, e.sal
FROM   dept d, emp e
WHERE  d.deptno = e.deptno
AND    d.loc = 'DALLAS';

-- ② 직전 SQL의 실행 계획 + 통계 조회
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));
```

```
결과 예시:
SQL_ID  8gf2h3kqz9w1v, child number 0
-------------------------------------
SELECT d.dname, e.ename, e.sal FROM dept d, emp e WHERE ...

Plan hash value: 3713469723

-------------------------------------------------------------------------------------------
| Id | Operation                    | Name           | Starts | E-Rows | A-Rows | A-Time |
-------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT             |                |      1 |        |      5 |00:00:00.01|
|  1 |  NESTED LOOPS                |                |      1 |      5 |      5 |00:00:00.01|
|  2 |   TABLE ACCESS FULL          | DEPT           |      1 |      1 |      1 |00:00:00.01|
|* 3 |   TABLE ACCESS BY INDEX ROWID| EMP            |      1 |      5 |      5 |00:00:00.01|
|* 4 |    INDEX RANGE SCAN          | IDX_EMP_DEPTNO |      1 |      5 |      5 |00:00:00.00|
-------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   3 - filter("E"."SAL">2000)
   4 - access("D"."DEPTNO"="E"."DEPTNO")
```

### 방법 2: SQL_ID로 특정 SQL 조회

```sql
-- SQL_ID 확인
SELECT sql_id, sql_text, executions
FROM   v$sql
WHERE  sql_text LIKE '%dname%ename%'
AND    sql_text NOT LIKE '%v$sql%';

-- SQL_ID와 child_number로 조회
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('8gf2h3kqz9w1v', 0, 'ALLSTATS LAST'));
```

---

## FORMAT 옵션 상세

세 번째 파라미터 `format`으로 출력 항목을 세밀하게 조정할 수 있다.

### 자주 쓰는 FORMAT 조합

```sql
-- ① ALLSTATS LAST: 가장 많이 사용. 마지막 실행의 실제 통계 포함
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));

-- ② ALLSTATS: 누적 실행 통계 (여러 번 실행한 평균 분석 시)
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS'));

-- ③ ADVANCED: 가장 상세. Predicate, Column Projection, Outline 등 포함
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ADVANCED ALLSTATS LAST'));

-- ④ BASIC: 핵심 항목만 (빠른 확인용)
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'BASIC'));
```

### FORMAT 키워드 목록

| 키워드 | 설명 |
|--------|------|
| `ALLSTATS` | E-Rows, A-Rows, Starts, A-Time, Buffers, Reads 포함 |
| `LAST` | 마지막 실행 기준 통계 (ALLSTATS와 함께 사용) |
| `ADVANCED` | Outline, Column Projection, Peeked Binds 등 추가 |
| `PREDICATE` | Predicate Information (조건 적용 위치) |
| `PROJECTION` | 각 노드의 출력 컬럼 목록 |
| `ROWS` | 행 수 통계 포함 |
| `BUFFERS` | 논리 읽기(cr) 통계 포함 |
| `IOSTATS` | 물리 읽기(pr)/쓰기(pw) 통계 포함 |
| `MEMSTATS` | 메모리 사용량 통계 (Sort/Hash) |
| `TYPICAL` | 기본값. 주요 항목만 포함 |

---

## 출력 컬럼 상세 설명

```
| Id | Operation | Name | Starts | E-Rows | A-Rows | A-Time | Buffers | Reads |
```

| 컬럼 | 설명 |
|------|------|
| **Id** | 오퍼레이션 번호. `*` 표시는 Predicate(조건) 적용 위치 |
| **Operation** | 실행 오퍼레이션 종류 |
| **Name** | 테이블/인덱스 이름 |
| **Starts** | 해당 오퍼레이션 실행 횟수 (NL Inner는 Outer 건수만큼 반복) |
| **E-Rows** | 옵티마이저 **예상** 행 수 (Estimated) |
| **A-Rows** | **실제** 처리된 행 수 (Actual) — 핵심 지표 |
| **A-Time** | 해당 노드까지 누적 경과 시간 |
| **Buffers** | 논리 읽기 블록 수 (cr, Buffer Cache 포함) |
| **Reads** | 물리 읽기 블록 수 (pr, 디스크 I/O) |

> 💡 **E-Rows와 A-Rows 차이가 크면** 통계가 부정확한 것 → 실행 계획 오판 원인

---

## GATHER_PLAN_STATISTICS 힌트

기본적으로 `A-Rows` 등 실제 통계는 수집되지 않는다.
**GATHER_PLAN_STATISTICS 힌트**를 사용하거나 파라미터를 설정해야 수집된다.

```sql
-- 방법 1: 힌트 사용 (권장 — 해당 SQL만 적용)
SELECT /*+ GATHER_PLAN_STATISTICS */
       d.dname, e.ename, e.sal
FROM   dept d, emp e
WHERE  d.deptno = e.deptno;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));

-- 방법 2: 세션 파라미터 설정 (세션 내 모든 SQL에 적용)
ALTER SESSION SET statistics_level = ALL;

-- 방법 3: 시스템 파라미터 (전체 DB에 적용, DBA 권한)
ALTER SYSTEM SET statistics_level = ALL;
-- 기본값은 TYPICAL (A-Rows 미수집)
-- ALL로 설정하면 모든 SQL의 실행 통계 수집 → 오버헤드 주의
```

---

## Predicate Information 해석

```sql
SELECT /*+ GATHER_PLAN_STATISTICS */
       e.ename, e.sal, d.dname
FROM   emp e, dept d
WHERE  e.deptno = d.deptno
AND    e.sal > 2000
AND    d.loc = 'DALLAS';

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));
```

```
Predicate Information (identified by operation id):
---------------------------------------------------
   2 - filter("D"."LOC"='DALLAS')          ← Id=2에서 loc 조건 필터
   3 - filter("E"."SAL">2000)              ← Id=3에서 sal 조건 필터
   4 - access("E"."DEPTNO"="D"."DEPTNO")  ← Id=4에서 인덱스 접근 조건 (=조인)
```

| Predicate 종류 | 설명 |
|---------------|------|
| **access** | 인덱스 접근 조건. 인덱스 Range Scan 범위 결정 |
| **filter** | 접근 후 추가 필터. 인덱스 활용 안 됨 |
| **storage** | Exadata Smart Scan 조건 |

> 💡 조건이 `filter`로 분류되면 인덱스를 타지 않는 것 → 인덱스 컬럼 순서/조건 재검토 필요

---

## 실전 분석 패턴

### 패턴 1: E-Rows vs A-Rows 불일치 → 통계 문제

```
| Id | Operation            | E-Rows | A-Rows | Buffers |
|  2 |  TABLE ACCESS FULL   |      1 | 50,000 |   8,000 |

→ 1건 예상했지만 실제 5만 건 → 통계 오래됨
→ 옵티마이저가 NL 조인 선택했지만 실제론 Hash 조인이 유리했을 것
→ 해결: DBMS_STATS.GATHER_TABLE_STATS 로 통계 재수집
```

### 패턴 2: Starts가 큰 경우 → NL Inner 반복

```
| Id | Operation                    | Starts | A-Rows | Buffers |
|  3 |  TABLE ACCESS BY INDEX ROWID |  5,000 |  5,000 |  25,000 |
|  4 |   INDEX RANGE SCAN           |  5,000 |  5,000 |  15,000 |

→ Inner 테이블이 5,000번 반복 접근
→ Outer 건수(Starts)를 줄이거나 Hash 조인으로 전환 검토
```

### 패턴 3: Buffers 집중 → 병목 오퍼레이션 특정

```
| Id | Operation           | A-Rows | Buffers |
|  1 |  HASH JOIN          | 10,000 |  50,100 |
|  2 |   TABLE ACCESS FULL |  1,000 |     100 |  ← 적음
|  3 |   TABLE ACCESS FULL | 500,000|  50,000 |  ← 병목!

→ Id=3의 Full Scan이 전체 Buffers의 99% 차지
→ Id=3 테이블에 인덱스 추가 또는 파티션 검토
```

---

## DISPLAY_CURSOR 함수 시그니처

```sql
DBMS_XPLAN.DISPLAY_CURSOR(
    sql_id      IN VARCHAR2 DEFAULT NULL,   -- NULL이면 직전 SQL
    cursor_child_no IN NUMBER DEFAULT NULL, -- NULL이면 모든 child
    format      IN VARCHAR2 DEFAULT 'TYPICAL'
) RETURN DBMS_XPLAN_TYPE_TABLE;

-- 예시
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR());                        -- 직전 SQL, 기본 포맷
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST')); -- 직전 SQL, 실제 통계
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('abc123', 0, 'ADVANCED')); -- 특정 SQL
```

---

## DISPLAY vs DISPLAY_CURSOR 차이

| 함수 | 대상 | 특징 |
|------|------|------|
| `DBMS_XPLAN.DISPLAY` | `PLAN_TABLE` (EXPLAIN PLAN 결과) | 예상 실행 계획만, 실제 통계 없음 |
| `DBMS_XPLAN.DISPLAY_CURSOR` | `V$SQL_PLAN_STATISTICS_ALL` (캐시) | **실제 실행 통계 포함**, 즉시 조회 |

```sql
-- DISPLAY: EXPLAIN PLAN 실행 후 조회
EXPLAIN PLAN FOR SELECT * FROM emp WHERE deptno = 10;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY());

-- DISPLAY_CURSOR: SQL 실행 후 즉시 조회 (통계 포함)
SELECT /*+ GATHER_PLAN_STATISTICS */ * FROM emp WHERE deptno = 10;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));
```

---

## 시험 포인트

- **GATHER_PLAN_STATISTICS 힌트** 또는 `statistics_level=ALL` 설정 시 A-Rows 수집
- **`NULL, NULL`**: 직전에 실행한 SQL을 대상으로 조회
- **E-Rows vs A-Rows**: 차이가 크면 통계 부정확 → 실행 계획 오판
- **Starts**: NL 조인 Inner의 반복 횟수 — 크면 성능 문제
- **Buffers**: 논리 읽기 — 가장 큰 노드가 병목
- **`access` vs `filter`**: access는 인덱스 활용, filter는 인덱스 미활용
- **DISPLAY_CURSOR vs DISPLAY**: DISPLAY_CURSOR가 실제 실행 통계 포함 → 튜닝 시 우선 사용
