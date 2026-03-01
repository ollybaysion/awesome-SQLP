---
title: JOIN
tags: [SQL기본, 조인]
---
# JOIN

## JOIN이란?

두 개 이상의 테이블을 연결하여 데이터를 조회하는 방법. 관계형 데이터베이스의 핵심 개념.

## JOIN 종류

### INNER JOIN (내부 조인)

양쪽 테이블에서 **조건에 일치하는 행만** 반환.

```sql
-- ANSI 표준
SELECT e.ename, d.dname
FROM   emp e
  INNER JOIN dept d ON e.deptno = d.deptno;

-- Oracle 전통 방식
SELECT e.ename, d.dname
FROM   emp e, dept d
WHERE  e.deptno = d.deptno;
```

### LEFT OUTER JOIN

왼쪽 테이블의 **모든 행** + 오른쪽 일치 행. 불일치 시 NULL.

```sql
SELECT e.ename, d.dname
FROM   emp e
  LEFT OUTER JOIN dept d ON e.deptno = d.deptno;
```

### RIGHT OUTER JOIN

오른쪽 테이블의 **모든 행** + 왼쪽 일치 행.

```sql
SELECT e.ename, d.dname
FROM   emp e
  RIGHT OUTER JOIN dept d ON e.deptno = d.deptno;
```

### FULL OUTER JOIN

양쪽 테이블의 **모든 행** 반환. 불일치 행은 NULL.

```sql
SELECT e.ename, d.dname
FROM   emp e
  FULL OUTER JOIN dept d ON e.deptno = d.deptno;
```

### CROSS JOIN (교차 조인)

두 테이블의 **카티션 곱** (M × N 행).

```sql
SELECT e.ename, d.dname
FROM   emp e
  CROSS JOIN dept d;
```

### SELF JOIN

같은 테이블을 **별칭으로 두 번** 사용.

```sql
-- 사원과 해당 사원의 관리자 이름 조회
SELECT e.ename AS 사원, m.ename AS 관리자
FROM   emp e
  LEFT JOIN emp m ON e.mgr = m.empno;
```

## Oracle 전통 방식 Outer Join

```sql
-- LEFT OUTER JOIN과 동일 (+ 기호는 오른쪽에)
SELECT e.ename, d.dname
FROM   emp e, dept d
WHERE  e.deptno = d.deptno(+);

-- RIGHT OUTER JOIN과 동일 (+ 기호는 왼쪽에)
SELECT e.ename, d.dname
FROM   emp e, dept d
WHERE  e.deptno(+) = d.deptno;
```

## NATURAL JOIN

두 테이블에서 **이름이 같은 컬럼으로 자동 조인** (ANSI 표준).

```sql
SELECT ename, dname
FROM   emp
  NATURAL JOIN dept;
-- deptno가 공통 컬럼이면 자동 조인
```

> ⚠️ NATURAL JOIN, USING 절에서는 공통 컬럼에 테이블 별칭 사용 불가

## USING 절

특정 컬럼명을 명시하여 조인.

```sql
SELECT ename, dname
FROM   emp
  JOIN dept USING (deptno);
```

## 조인 조건 주의사항

```sql
-- N개 테이블 조인 시 최소 N-1개의 조인 조건 필요
-- 조인 조건이 부족하면 카티션 곱 발생!

SELECT e.ename, d.dname, l.city
FROM   emp e
  JOIN dept d ON e.deptno = d.deptno     -- 1번째 조인 조건
  JOIN loc  l ON d.loc_id = l.loc_id;    -- 2번째 조인 조건
-- 3개 테이블 → 최소 2개 조인 조건
```

## 시험 포인트

- INNER JOIN vs OUTER JOIN 차이 (NULL 처리)
- Oracle `(+)` 표기법 방향 주의: `(+)`가 있는 쪽이 NULL을 허용하는 쪽
- NATURAL JOIN, USING 절에서 공통 컬럼에 별칭 불가
- N개 테이블 조인 = 최소 N-1개 조인 조건
- CROSS JOIN은 WHERE 조건 없는 전통적 조인과 동일 결과
