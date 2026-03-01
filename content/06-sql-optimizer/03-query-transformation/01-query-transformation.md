---
title: 쿼리 변환 (Query Transformation)
tags: [옵티마이저, 쿼리변환, Unnesting, 뷰Merging, 조건절Pushing]
---
# 쿼리 변환 (Query Transformation)

**쿼리 변환(Query Transformation)**은 옵티마이저가 SQL을 실행하기 전에 **의미는 동일하지만 더 효율적인 형태로 재작성**하는 단계다.
개발자가 작성한 SQL이 서브쿼리나 뷰를 포함하더라도, 옵티마이저가 자동으로 최적 형태로 변환한다.

---

## 주요 쿼리 변환 종류

| 변환 기법 | 설명 |
|----------|------|
| **서브쿼리 Unnesting** | WHERE 절 서브쿼리를 조인으로 변환 |
| **뷰 Merging** | 인라인 뷰를 메인 쿼리에 병합 |
| **조건절 Pushing** | 조건을 서브쿼리/뷰 내부로 이동 |
| **조인 조건 Pushdown** | 조인 조건을 뷰/서브쿼리 내부로 밀어 넣음 |
| **OR → UNION ALL** | OR 조건을 UNION ALL로 분리 |
| **공통 서브쿼리 제거** | 동일 서브쿼리 중복 실행 방지 |

---

## 1. 서브쿼리 Unnesting (Subquery Unnesting)

**Unnesting**은 WHERE 절의 서브쿼리를 **조인(JOIN)으로 변환**하는 기법이다.
서브쿼리를 그대로 실행하면 Outer 행마다 반복 실행되지만, 조인으로 변환하면 해시 조인·소트 머지 등 효율적인 조인 방식 사용이 가능하다.

### Unnesting 예시

```sql
-- 원본 SQL (서브쿼리)
SELECT e.empno, e.ename, e.sal
FROM   emp e
WHERE  e.deptno IN (SELECT d.deptno FROM dept d WHERE d.loc = 'DALLAS');

-- 옵티마이저가 내부적으로 변환하는 형태 (세미 조인)
SELECT e.empno, e.ename, e.sal
FROM   emp e, dept d
WHERE  e.deptno = d.deptno
AND    d.loc = 'DALLAS';
-- → 이제 Hash Join / NL Join 등 다양한 방식 적용 가능
```

```
실행 계획에서 Unnesting 여부 확인:

Unnesting 전 (서브쿼리 필터):
| Id | Operation            |
|  0 | SELECT STATEMENT     |
|* 1 |  TABLE ACCESS FULL  EMP    |
|* 2 |   TABLE ACCESS FULL DEPT   |  ← FILTER로 서브쿼리 반복 실행

Unnesting 후 (조인):
| Id | Operation            |
|  0 | SELECT STATEMENT     |
|  1 |  HASH JOIN SEMI      |   ← SEMI 조인으로 변환됨
|  2 |   TABLE ACCESS FULL EMP  |
|* 3 |   TABLE ACCESS FULL DEPT |
```

### Unnesting 힌트 제어

```sql
-- Unnesting 강제 (기본적으로 CBO가 유리하면 자동 수행)
SELECT e.empno, e.ename
FROM   emp e
WHERE  e.deptno IN (SELECT /*+ UNNEST */ d.deptno FROM dept d WHERE d.loc = 'DALLAS');

-- Unnesting 방지 (서브쿼리 필터로 실행하도록 강제)
SELECT e.empno, e.ename
FROM   emp e
WHERE  e.deptno IN (SELECT /*+ NO_UNNEST */ d.deptno FROM dept d WHERE d.loc = 'DALLAS');
-- → 서브쿼리가 작고 결과 캐싱이 유리할 때 NO_UNNEST가 더 빠른 경우도 있음
```

---

## 2. 뷰 Merging (View Merging)

**뷰 Merging**은 인라인 뷰나 저장 뷰의 쿼리를 **메인 쿼리에 병합**하여 하나의 쿼리로 최적화하는 기법이다.
병합되면 뷰 내부 결과셋을 먼저 만들지 않고, 메인 쿼리의 조건과 함께 최적화된다.

### 뷰 Merging 예시

```sql
-- 원본 SQL (인라인 뷰 포함)
SELECT e.ename, v.dname
FROM   emp e,
       (SELECT deptno, dname FROM dept WHERE loc = 'DALLAS') v   -- 인라인 뷰
WHERE  e.deptno = v.deptno;

-- 뷰 Merging 후 (옵티마이저가 병합)
SELECT e.ename, d.dname
FROM   emp e, dept d
WHERE  e.deptno = d.deptno
AND    d.loc = 'DALLAS';
-- → 인덱스 활용 범위가 넓어지고, 조인 방식 선택의 폭도 넓어짐
```

### 뷰 Merging이 발생하지 않는 경우

```sql
-- ① GROUP BY가 포함된 인라인 뷰 → Merging 불가
SELECT e.ename, dc.cnt
FROM   emp e,
       (SELECT deptno, COUNT(*) AS cnt FROM emp GROUP BY deptno) dc
WHERE  e.deptno = dc.deptno;
-- → 집계(GROUP BY) 결과를 먼저 산출해야 하므로 병합 불가

-- ② ROWNUM이 포함된 인라인 뷰 → Merging 불가
SELECT *
FROM   (SELECT empno, ename, ROWNUM AS rn FROM emp WHERE ROWNUM <= 10)
WHERE  rn >= 5;

-- ③ DISTINCT가 포함된 경우 → Merging 불가
SELECT e.ename
FROM   emp e,
       (SELECT DISTINCT deptno FROM dept WHERE loc != 'NEW YORK') v
WHERE  e.deptno = v.deptno;
```

### 뷰 Merging 힌트 제어

```sql
-- Merging 방지 (뷰를 별도로 먼저 처리하도록 강제)
SELECT e.ename, v.dname
FROM   emp e,
       (SELECT /*+ NO_MERGE */ deptno, dname FROM dept WHERE loc = 'DALLAS') v
WHERE  e.deptno = v.deptno;
-- → 뷰 내부 결과셋을 먼저 완성 후 조인 → 뷰 결과가 소량일 때 유리

-- Merging 강제
SELECT e.ename, v.dname
FROM   emp e,
       (SELECT /*+ MERGE */ deptno, dname FROM dept) v
WHERE  e.deptno = v.deptno
AND    v.loc = 'DALLAS';
```

---

## 3. 조건절 Pushing (Predicate Pushing)

**조건절 Pushing**은 메인 쿼리의 WHERE 조건을 **뷰나 서브쿼리 내부로 밀어 넣어** 조기 필터링을 유도하는 기법이다.
뷰 Merging이 불가한 경우에도 조건을 안쪽으로 밀어 넣어 처리 범위를 줄인다.

### Predicate Pushing 예시

```sql
-- 원본: 메인 쿼리 조건 e.sal > 2000이 뷰 바깥에 있음
SELECT *
FROM   (SELECT e.empno, e.ename, e.sal, d.dname
        FROM   emp e, dept d
        WHERE  e.deptno = d.deptno) v
WHERE  v.sal > 2000;

-- Predicate Pushing 후 (옵티마이저가 조건을 뷰 안으로 이동)
SELECT *
FROM   (SELECT e.empno, e.ename, e.sal, d.dname
        FROM   emp e, dept d
        WHERE  e.deptno = d.deptno
        AND    e.sal > 2000)    -- ← 조건이 뷰 안으로 이동
v;
-- → EMP 테이블 접근 시 sal > 2000 조건으로 먼저 필터링 → 처리 범위 축소
```

```
실행 계획에서 확인:
Predicate Pushing 전:
| Id | Operation        | Name |
|  0 | SELECT STATEMENT |      |
|* 1 |  VIEW            |      |   ← 뷰 밖에서 sal 필터
|  2 |   HASH JOIN      |      |
|  3 |    TABLE ACCESS FULL EMP |   ← sal 조건 없이 전체 읽음

Predicate Pushing 후:
|  0 | SELECT STATEMENT |      |
|  1 |  VIEW            |      |
|  2 |   HASH JOIN      |      |
|* 3 |    TABLE ACCESS FULL EMP |   ← sal > 2000 필터 적용됨 (A-Rows 감소)
```

---

## 4. OR → UNION ALL 변환

```sql
-- OR 조건을 UNION ALL로 분리 → 각 부분에 인덱스 활용 가능
-- 원본
SELECT empno, ename FROM emp WHERE deptno = 10 OR job = 'MANAGER';

-- 옵티마이저가 변환 (또는 개발자가 직접 작성)
SELECT empno, ename FROM emp WHERE deptno = 10
UNION ALL
SELECT empno, ename FROM emp WHERE job = 'MANAGER' AND deptno <> 10;
-- → deptno 인덱스, job 인덱스 각각 활용 가능
-- → 중복 제거를 위해 두 번째 조건에 AND deptno <> 10 추가

-- USE_CONCAT 힌트로 강제
SELECT /*+ USE_CONCAT */ empno, ename FROM emp WHERE deptno = 10 OR job = 'MANAGER';
-- NO_EXPAND 힌트로 방지
SELECT /*+ NO_EXPAND */ empno, ename FROM emp WHERE deptno = 10 OR job = 'MANAGER';
```

---

## 5. 쿼리 변환 여부 확인 방법

```sql
-- EXPLAIN PLAN 또는 DBMS_XPLAN으로 변환 결과 확인
SELECT /*+ GATHER_PLAN_STATISTICS */
       e.empno, e.ename
FROM   emp e
WHERE  e.deptno IN (SELECT d.deptno FROM dept d WHERE d.loc = 'DALLAS');

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST'));

-- 실행 계획에 HASH JOIN SEMI 또는 NESTED LOOPS SEMI 등장 → Unnesting 발생
-- 실행 계획에 VIEW 없이 바로 TABLE ACCESS → 뷰 Merging 발생
-- Predicate Information에 뷰 내부 조건 → Predicate Pushing 발생
```

---

## 쿼리 변환 비교 요약

| 변환 기법 | 변환 대상 | 효과 | 힌트 |
|----------|---------|------|------|
| **Subquery Unnesting** | WHERE 서브쿼리 | 조인 방식 다양화 | `UNNEST` / `NO_UNNEST` |
| **View Merging** | 인라인 뷰·저장 뷰 | 조건 활용 범위 확대 | `MERGE` / `NO_MERGE` |
| **Predicate Pushing** | 뷰 외부 조건 | 조기 필터링으로 처리 범위 축소 | `PUSH_PRED` / `NO_PUSH_PRED` |
| **OR → UNION ALL** | OR 조건 | 각 브랜치별 인덱스 활용 | `USE_CONCAT` / `NO_EXPAND` |

---

## 쿼리 변환이 일어나지 않도록 막아야 할 때

```sql
-- ❌ 뷰 Merging으로 인해 원하는 실행 계획이 바뀌는 경우
-- 뷰 내부에서 행 수를 먼저 줄인 후 조인하고 싶을 때 NO_MERGE 사용

-- 예: 큰 테이블에서 소량 추출 후 작은 테이블과 조인
SELECT e.ename, v.total
FROM   emp e,
       (SELECT /*+ NO_MERGE */ deptno, SUM(sal) AS total
        FROM   emp
        WHERE  sal > 2000
        GROUP BY deptno) v
WHERE  e.deptno = v.deptno;
-- → 집계 결과(소량)를 먼저 만들고 EMP와 조인 → 조인 대상 행 수 감소
```

---

## 시험 포인트

- **쿼리 변환 = 의미 동일하되 더 효율적인 형태로 SQL 재작성** (옵티마이저가 자동 수행)
- **Subquery Unnesting**: WHERE 서브쿼리 → 조인 변환 → Hash/NL Join 활용 가능
  - 실행 계획에 `HASH JOIN SEMI` / `NESTED LOOPS SEMI` 등장
- **View Merging**: 인라인 뷰 → 메인 쿼리에 병합 → 더 넓은 최적화 범위
  - GROUP BY, ROWNUM, DISTINCT 포함 뷰는 Merging 불가
- **Predicate Pushing**: 외부 조건 → 뷰/서브쿼리 내부로 이동 → 처리 범위 조기 축소
- **OR → UNION ALL (`USE_CONCAT`)**: OR 조건 분리 → 각 조건에 독립 인덱스 활용
- **`NO_MERGE`**: 뷰를 먼저 처리하고 싶을 때 / `NO_UNNEST`: 서브쿼리 그대로 실행
- 힌트는 서브쿼리/뷰 **내부**에 작성 (메인 쿼리 힌트로는 제어 안 됨)
