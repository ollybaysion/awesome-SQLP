---
title: 고급 SQL 활용
tags: [튜닝, 윈도우함수, 계층쿼리, PIVOT, 분석함수, 고급SQL]
---
# 고급 SQL 활용

**고급 SQL 기법**을 사용하면 복잡한 비즈니스 로직을 여러 SQL을 순차 실행하거나 애플리케이션 코드 없이 **하나의 SQL**로 처리할 수 있다.
성능 향상과 코드 단순화를 동시에 달성한다.

---

## 1. 윈도우 함수 (Window Function / 분석 함수)

**윈도우 함수**는 집계를 수행하되 행 수를 줄이지 않고, **각 행에 집계 결과를 함께 출력**하는 함수다.

### 기본 구문

```sql
함수명() OVER (
    [PARTITION BY 컬럼]   -- 그룹 정의 (GROUP BY와 유사)
    [ORDER BY 컬럼]       -- 정렬 기준
    [ROWS|RANGE BETWEEN ... AND ...]  -- 프레임 정의
)
```

### 순위 함수

```sql
SELECT empno, ename, sal, deptno,
       RANK()        OVER (PARTITION BY deptno ORDER BY sal DESC) AS rank,
       DENSE_RANK()  OVER (PARTITION BY deptno ORDER BY sal DESC) AS dense_rank,
       ROW_NUMBER()  OVER (PARTITION BY deptno ORDER BY sal DESC) AS row_num
FROM   emp;
```

| 함수 | 동점 처리 | 예시 (1등 2명) |
|------|---------|------------|
| `RANK()` | 동점 같은 순위, 다음 순위 건너뜀 | 1, 1, 3 |
| `DENSE_RANK()` | 동점 같은 순위, 다음 순위 이어짐 | 1, 1, 2 |
| `ROW_NUMBER()` | 동점 관계없이 순번 부여 | 1, 2, 3 |

### 집계 윈도우 함수

```sql
-- 부서별 누적 합계 / 부서 합계 / 전체 합계
SELECT empno, ename, sal, deptno,
       SUM(sal) OVER (PARTITION BY deptno ORDER BY empno
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       SUM(sal) OVER (PARTITION BY deptno)   AS dept_total,
       SUM(sal) OVER ()                      AS grand_total,
       ROUND(sal / SUM(sal) OVER (PARTITION BY deptno) * 100, 1) AS pct_of_dept
FROM   emp;
```

### 행 이동 함수

```sql
-- 이전 행 / 다음 행 참조
SELECT empno, ename, sal,
       LAG(sal, 1, 0)  OVER (ORDER BY empno) AS prev_sal,   -- 이전 행의 sal
       LEAD(sal, 1, 0) OVER (ORDER BY empno) AS next_sal,   -- 다음 행의 sal
       sal - LAG(sal, 1, sal) OVER (ORDER BY empno)  AS sal_diff   -- 전 행과 차이
FROM   emp;
```

### FIRST_VALUE / LAST_VALUE

```sql
-- 파티션 내 첫 번째/마지막 값
SELECT empno, ename, sal, deptno,
       FIRST_VALUE(sal) OVER (PARTITION BY deptno ORDER BY sal) AS min_sal,
       LAST_VALUE(sal)  OVER (PARTITION BY deptno ORDER BY sal
                              ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS max_sal
FROM   emp;
-- LAST_VALUE는 기본 프레임이 CURRENT ROW까지이므로 반드시 UNBOUNDED FOLLOWING 지정
```

### NTILE

```sql
-- N등분 버킷 할당
SELECT ename, sal,
       NTILE(4) OVER (ORDER BY sal DESC) AS quartile   -- 4분위
FROM   emp;
```

---

## 2. 계층 쿼리 (Hierarchical Query)

**계층 쿼리**는 부모-자식 관계의 트리 구조 데이터를 탐색하는 Oracle 전용 문법이다.

```sql
-- 기본 구문
SELECT LEVEL,                         -- 계층 깊이 (루트=1)
       LPAD(' ', (LEVEL-1)*2) || ename AS org_chart,   -- 들여쓰기
       empno, mgr
FROM   emp
START WITH mgr IS NULL                -- 루트 조건 (최상위 관리자)
CONNECT BY PRIOR empno = mgr          -- 부모(empno) → 자식(mgr) 방향
ORDER SIBLINGS BY ename;              -- 같은 계층 내 정렬
```

```
결과 예시:
LEVEL  ORG_CHART
1      KING
2        JONES
3          SCOTT
4            ADAMS
3          FORD
4            SMITH
2        BLAKE
3          ALLEN
...
```

### 계층 쿼리 주요 함수/키워드

| 키워드/함수 | 설명 |
|-----------|------|
| `LEVEL` | 현재 행의 계층 깊이 (루트=1) |
| `CONNECT_BY_ROOT` 컬럼 | 루트 행의 해당 컬럼 값 |
| `SYS_CONNECT_BY_PATH(컬럼, 구분자)` | 루트부터 현재까지 경로 문자열 |
| `CONNECT_BY_ISLEAF` | 리프 노드 여부 (1=리프, 0=아님) |
| `CONNECT BY NOCYCLE PRIOR` | 순환 참조 감지 시 중단 |

```sql
-- 경로와 루트 활용 예시
SELECT empno, ename, mgr, LEVEL,
       CONNECT_BY_ROOT ename                   AS root_emp,
       SYS_CONNECT_BY_PATH(ename, '/')         AS path,
       CONNECT_BY_ISLEAF                       AS is_leaf
FROM   emp
START WITH mgr IS NULL
CONNECT BY PRIOR empno = mgr;
-- 결과: /KING/JONES/SCOTT/ADAMS 형태의 경로
```

---

## 3. PIVOT / UNPIVOT

**PIVOT**은 행 데이터를 열로 변환하고, **UNPIVOT**은 열 데이터를 행으로 변환한다.

### PIVOT

```sql
-- 부서별 직무별 인원 수를 크로스탭으로 표시
SELECT *
FROM (SELECT deptno, job FROM emp)
PIVOT (
    COUNT(*) FOR job IN (
        'CLERK'   AS clerk_cnt,
        'ANALYST' AS analyst_cnt,
        'MANAGER' AS manager_cnt,
        'SALESMAN'AS salesman_cnt,
        'PRESIDENT' AS president_cnt
    )
)
ORDER BY deptno;

-- 결과:
-- DEPTNO  CLERK_CNT  ANALYST_CNT  MANAGER_CNT  SALESMAN_CNT  PRESIDENT_CNT
--     10          1            0            1             0              1
--     20          2            2            1             0              0
--     30          1            0            1             4              0
```

### UNPIVOT

```sql
-- 열 데이터를 행으로 변환
SELECT deptno, job, cnt
FROM dept_job_summary
UNPIVOT (cnt FOR job IN (
    clerk_cnt   AS 'CLERK',
    analyst_cnt AS 'ANALYST',
    manager_cnt AS 'MANAGER'
));
```

---

## 4. 재귀 WITH (Recursive WITH)

Oracle 11g R2+에서 지원하는 **ANSI 표준** 재귀 쿼리. 계층 구조 외에도 시퀀스 생성 등에 활용.

```sql
-- 1부터 10까지 수열 생성
WITH numbers (n) AS (
    SELECT 1 FROM DUAL                 -- Anchor (초기값)
    UNION ALL
    SELECT n + 1 FROM numbers WHERE n < 10   -- Recursive (반복)
)
SELECT n FROM numbers;

-- 계층 구조 (CONNECT BY 대안)
WITH emp_hier (empno, ename, mgr, lvl, path) AS (
    SELECT empno, ename, mgr, 1, ename
    FROM   emp WHERE mgr IS NULL          -- 루트
    UNION ALL
    SELECT e.empno, e.ename, e.mgr, h.lvl + 1, h.path || '/' || e.ename
    FROM   emp e, emp_hier h
    WHERE  e.mgr = h.empno               -- 자식 조건
)
SELECT lvl, LPAD(' ', (lvl-1)*2) || ename AS org, path
FROM   emp_hier
ORDER  BY path;
```

---

## 5. 복잡한 집계 — GROUPING SETS / ROLLUP / CUBE

```sql
-- ROLLUP: 계층적 소계 + 총계
SELECT deptno, job, SUM(sal)
FROM   emp
GROUP BY ROLLUP(deptno, job);
-- 결과: (deptno, job) 조합 + (deptno 소계) + (전체 총계)

-- CUBE: 모든 조합의 소계
SELECT deptno, job, SUM(sal)
FROM   emp
GROUP BY CUBE(deptno, job);
-- 결과: (deptno, job) + (deptno 소계) + (job 소계) + (전체 총계)

-- GROUPING SETS: 원하는 조합만 선택
SELECT deptno, job, SUM(sal)
FROM   emp
GROUP BY GROUPING SETS ((deptno, job), (deptno), ());
-- ROLLUP과 동일한 결과

-- GROUPING() 함수로 소계 행 식별
SELECT DECODE(GROUPING(deptno), 1, '전체', TO_CHAR(deptno)) AS dept,
       DECODE(GROUPING(job),    1, '소계', job)              AS job,
       SUM(sal)
FROM   emp
GROUP BY ROLLUP(deptno, job);
```

---

## 6. 고급 조인 패턴

### Self Join (자기 참조 조인)

```sql
-- 직원과 해당 직원의 관리자 이름을 함께 조회
SELECT e.empno, e.ename, e.sal,
       m.ename AS manager_name, m.sal AS manager_sal
FROM   emp e LEFT OUTER JOIN emp m ON e.mgr = m.empno;
```

### Non-Equi Join (비동등 조인)

```sql
-- 급여 등급 테이블과 비동등 조인
SELECT e.ename, e.sal, sg.grade
FROM   emp e, salgrade sg
WHERE  e.sal BETWEEN sg.losal AND sg.hisal;
```

---

## 윈도우 함수 활용 — 실전 패턴

```sql
-- 패턴 1: 부서별 급여 Top 3 조회
SELECT *
FROM (
    SELECT empno, ename, sal, deptno,
           RANK() OVER (PARTITION BY deptno ORDER BY sal DESC) AS rnk
    FROM   emp
)
WHERE rnk <= 3;

-- 패턴 2: 전월 대비 매출 증감률 (LAG 활용)
SELECT ym, sales,
       LAG(sales) OVER (ORDER BY ym) AS prev_sales,
       ROUND((sales - LAG(sales) OVER (ORDER BY ym)) /
             LAG(sales) OVER (ORDER BY ym) * 100, 1) AS growth_pct
FROM   monthly_sales;

-- 패턴 3: 누적 합계가 전체의 80%에 해당하는 행까지 선택 (파레토 분석)
SELECT product_id, sales, cumulative_pct
FROM (
    SELECT product_id, sales,
           ROUND(SUM(sales) OVER (ORDER BY sales DESC) /
                 SUM(sales) OVER () * 100, 1) AS cumulative_pct
    FROM   product_sales
)
WHERE cumulative_pct <= 80;
```

---

## 시험 포인트

- **RANK vs DENSE_RANK vs ROW_NUMBER**: 동점 처리 방식 차이 (1,1,3 / 1,1,2 / 1,2,3)
- **LAST_VALUE**: 기본 프레임이 `CURRENT ROW`까지 → `UNBOUNDED FOLLOWING` 명시 필요
- **LAG/LEAD**: 이전/다음 행 참조 — 전월 비교, 이전 상태 비교에 활용
- **계층 쿼리**: `START WITH` + `CONNECT BY PRIOR` + `LEVEL`
  - `CONNECT_BY_ROOT`, `SYS_CONNECT_BY_PATH`, `CONNECT_BY_ISLEAF`
- **PIVOT**: 행 → 열 변환 / **UNPIVOT**: 열 → 행 변환
- **ROLLUP**: 계층 소계 + 총계 / **CUBE**: 모든 조합 소계 / **GROUPING SETS**: 지정 조합만
- **GROUPING()**: 소계 행 여부 식별 (1=소계, 0=일반 데이터)
- **재귀 WITH**: ANSI 표준 재귀 CTE — `CONNECT BY` 대안, 시퀀스 생성에도 활용
