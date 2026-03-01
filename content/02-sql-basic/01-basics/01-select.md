---
title: SELECT 문
tags: [SQL기본, DML]
---
# SELECT 문

## 기본 구조

```sql
SELECT [ALL | DISTINCT] 컬럼명, ...
FROM   테이블명
WHERE  조건식
GROUP BY 그룹화컬럼
HAVING 그룹조건
ORDER BY 정렬컬럼 [ASC | DESC];
```

## 실행 순서

> SQL은 작성 순서와 **실행 순서가 다르다!**

```
FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY
```

| 순서 | 절 | 설명 |
|------|-----|------|
| 1 | FROM | 테이블/뷰 식별 |
| 2 | WHERE | 행 필터링 |
| 3 | GROUP BY | 그룹화 |
| 4 | HAVING | 그룹 필터링 |
| 5 | SELECT | 컬럼 선택 및 표현식 계산 |
| 6 | ORDER BY | 정렬 |

## SELECT 절 옵션

```sql
-- ALL (기본값): 중복 포함
SELECT ALL   deptno FROM emp;

-- DISTINCT: 중복 제거
SELECT DISTINCT deptno FROM emp;

-- 와일드카드
SELECT * FROM emp;
```

## WHERE 절 조건

### 비교 연산자

```sql
WHERE sal > 2000
WHERE sal >= 2000 AND sal <= 3000
WHERE sal BETWEEN 2000 AND 3000   -- 2000, 3000 포함
```

### LIKE 연산자

```sql
WHERE ename LIKE 'S%'    -- S로 시작
WHERE ename LIKE '%S%'   -- S 포함
WHERE ename LIKE '_S%'   -- 두 번째 글자가 S
```

| 와일드카드 | 의미 |
|-----------|------|
| `%` | 0개 이상의 임의 문자 |
| `_` | 1개의 임의 문자 |

### IN 연산자

```sql
WHERE deptno IN (10, 20)      -- OR와 동일
WHERE deptno NOT IN (10, 20)  -- 주의: NULL 포함 시 예상 외 결과
```

### NULL 처리

```sql
-- NULL 비교는 IS NULL / IS NOT NULL 사용
WHERE comm IS NULL
WHERE comm IS NOT NULL

-- ❌ 잘못된 예 (항상 false)
WHERE comm = NULL
```

## GROUP BY / HAVING

```sql
SELECT   deptno, AVG(sal) AS avg_sal
FROM     emp
WHERE    job != 'PRESIDENT'
GROUP BY deptno
HAVING   AVG(sal) > 2000
ORDER BY avg_sal DESC;
```

> `WHERE`는 그룹화 전 행 필터, `HAVING`은 그룹화 후 필터

## ORDER BY

```sql
-- 컬럼명, 별칭, 순서 번호 모두 사용 가능
ORDER BY sal DESC, ename ASC;
ORDER BY 3 DESC;        -- SELECT 절 3번째 컬럼 기준
ORDER BY avg_sal DESC;  -- 별칭 사용 가능 (실행 순서상 ORDER BY는 마지막)
```

> NULL 값의 정렬: Oracle은 마지막, 표준 SQL은 NULL FIRST/LAST 지정 가능

## 집계 함수

| 함수 | 설명 |
|------|------|
| `COUNT(*)` | 전체 행 수 (NULL 포함) |
| `COUNT(col)` | NULL 제외 행 수 |
| `SUM(col)` | 합계 |
| `AVG(col)` | 평균 (NULL 제외) |
| `MAX(col)` | 최댓값 |
| `MIN(col)` | 최솟값 |

## 시험 포인트

- SQL 실행 순서: **FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY**
- `WHERE`에서는 집계 함수 사용 불가 → `HAVING` 사용
- NULL 비교: `= NULL` ❌ → `IS NULL` ✅
- `NOT IN`에 NULL이 포함된 경우 예상 외 결과 발생
- `BETWEEN A AND B`는 A, B 양 끝값 포함
