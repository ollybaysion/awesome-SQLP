---
title: 소트 튜닝
tags: [튜닝, 소트, Sort Area, PGA, 소트회피]
---
# 소트 튜닝

SQL에서 **소트(정렬)**는 ORDER BY, GROUP BY, DISTINCT, UNION, 조인(Sort Merge) 등에서 발생한다.
소트는 **메모리(Sort Area)**를 사용하다가 부족하면 **디스크(Temp Tablespace)**를 사용하므로, 불필요한 소트를 없애고 소트 자체를 줄이는 것이 핵심이다.

---

## 소트가 발생하는 오퍼레이션

| SQL 구문 | 소트 발생 여부 | 비고 |
|---------|------------|------|
| `ORDER BY` | 항상 | 인덱스로 대체 가능 |
| `GROUP BY` | 기본 발생 | `HASH GROUP BY`로 대체 가능 |
| `DISTINCT` | 기본 발생 | `HASH UNIQUE`로 대체 가능 |
| `UNION` | 발생 (중복 제거 소트) | `UNION ALL`은 소트 없음 |
| `UNION ALL` | **없음** | 중복 허용 |
| `MINUS`, `INTERSECT` | 발생 | |
| Sort Merge Join | 발생 | Hash Join으로 대체 가능 |
| Window Function (OVER) | 발생 | PARTITION BY + ORDER BY 기준 |

---

## 소트 처리 방식

```
① 메모리 소트 (In-Memory Sort)
   Sort Area (PGA 내) 안에서 처리 완료
   → 빠름, 디스크 I/O 없음

② 디스크 소트 (To-Disk Sort / External Sort)
   Sort Area 초과 → Temp Tablespace에 임시 세그먼트 기록
   → 느림, 대량 디스크 I/O 발생

Sort Area 크기 파라미터:
  - workarea_size_policy = AUTO (기본): PGA_AGGREGATE_TARGET으로 자동 관리
  - workarea_size_policy = MANUAL: SORT_AREA_SIZE로 직접 지정 (구식)
```

### Temp 소트 발생 확인

```sql
-- 현재 세션의 Temp 사용량 확인
SELECT sql_id, sql_text, temp_space_allocated
FROM   v$sql
WHERE  temp_space_allocated > 0
ORDER  BY temp_space_allocated DESC;

-- 실행 계획에서 소트 오퍼레이션 확인 (Writes > 0 이면 디스크 소트)
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ALLSTATS LAST MEMSTATS'));
-- MEMSTATS 옵션: Used-Mem, Used-Tmp 컬럼 표시
```

---

## 소트 튜닝 전략

### 전략 1: 소트 자체를 없애기 — 인덱스 활용

```sql
-- ❌ 소트 발생: 인덱스 없이 ORDER BY
SELECT empno, ename, sal FROM emp ORDER BY sal;   -- SORT ORDER BY 오퍼레이션

-- ✅ 소트 제거: sal 인덱스 있으면 SORT ORDER BY 오퍼레이션 없음
-- 인덱스가 이미 정렬된 구조이므로 Index Full Scan 또는 Index Range Scan으로 대체
CREATE INDEX idx_emp_sal ON emp(sal);
SELECT empno, ename, sal FROM emp ORDER BY sal;   -- INDEX FULL SCAN (sort 없음)
```

```sql
-- GROUP BY도 인덱스로 소트 제거 가능
-- 선두 컬럼이 GROUP BY 컬럼과 일치할 때
SELECT deptno, COUNT(*) FROM emp GROUP BY deptno;
-- idx_emp_deptno 인덱스 있으면 INDEX FULL SCAN + SORT GROUP BY NOSORT
```

### 전략 2: UNION → UNION ALL로 변환

```sql
-- ❌ UNION: 중복 제거를 위해 소트 발생
SELECT deptno FROM emp
UNION
SELECT deptno FROM dept;

-- ✅ UNION ALL: 소트 없음 (중복 허용 or 중복 없음이 확실할 때)
SELECT deptno FROM emp
UNION ALL
SELECT deptno FROM dept WHERE deptno NOT IN (SELECT deptno FROM emp);
-- → 비즈니스 로직상 중복이 없거나 중복이 허용될 때 UNION ALL 우선 검토
```

### 전략 3: DISTINCT → EXISTS로 변환

```sql
-- ❌ DISTINCT: 소트 발생
SELECT DISTINCT d.deptno, d.dname
FROM   dept d, emp e
WHERE  d.deptno = e.deptno;

-- ✅ EXISTS: 소트 없음 (세미 조인으로 처리)
SELECT d.deptno, d.dname
FROM   dept d
WHERE  EXISTS (SELECT 1 FROM emp e WHERE e.deptno = d.deptno);
```

### 전략 4: MIN/MAX → 인덱스 활용

```sql
-- ❌ 소트 발생: 전체 스캔 후 최솟값 계산
SELECT MIN(sal) FROM emp;   -- SORT AGGREGATE 발생

-- ✅ 인덱스 MIN/MAX 최적화: sal 인덱스의 첫/마지막 키 하나만 읽음
-- (FIRST ROW / LAST ROW 오퍼레이션으로 자동 최적화됨)
-- 실행 계획: INDEX FULL SCAN (MIN/MAX)
```

### 전략 5: Top-N 쿼리 최적화

```sql
-- ❌ 전체 정렬 후 ROWNUM 필터 → 대용량 소트 발생
SELECT empno, ename, sal
FROM   (SELECT * FROM emp ORDER BY sal DESC)
WHERE  ROWNUM <= 5;

-- ✅ Top-N 소트 최적화: Sort Area에 상위 N건만 유지 (나머지 버림)
-- Oracle은 ROWNUM <= N + ORDER BY 조합을 자동으로 Top-N 소트로 최적화
-- 실행 계획: SORT ORDER BY STOPKEY (전체 소트가 아닌 N건 유지 소트)

-- ✅ 12c 이상: FETCH FIRST 사용 (더 직관적)
SELECT empno, ename, sal
FROM   emp
ORDER  BY sal DESC
FETCH  FIRST 5 ROWS ONLY;
```

---

## 소트 튜닝 실행 계획 키워드

| 실행 계획 키워드 | 의미 |
|---------------|------|
| `SORT ORDER BY` | ORDER BY 소트 |
| `SORT GROUP BY` | GROUP BY 소트 |
| `SORT GROUP BY NOSORT` | 인덱스로 소트 생략된 GROUP BY |
| `SORT AGGREGATE` | MIN/MAX/COUNT 집계 |
| `SORT ORDER BY STOPKEY` | Top-N 소트 (ROWNUM 최적화) |
| `HASH GROUP BY` | 소트 없는 GROUP BY (해시 집계) |
| `HASH UNIQUE` | 소트 없는 DISTINCT (해시 중복 제거) |
| `SORT JOIN` | Sort Merge 조인의 소트 단계 |

---

## 윈도우 함수와 소트

```sql
-- 윈도우 함수는 PARTITION BY + ORDER BY 기준으로 소트 발생
SELECT empno, ename, sal,
       RANK() OVER (PARTITION BY deptno ORDER BY sal DESC) AS rnk
FROM   emp;
-- 실행 계획: WINDOW SORT 오퍼레이션

-- ✅ PARTITION BY 컬럼에 인덱스가 있으면 소트 최적화 가능
-- ✅ 동일 PARTITION BY + ORDER BY를 공유하는 윈도우 함수는 소트 1회로 처리
SELECT empno, ename, sal,
       RANK()        OVER (PARTITION BY deptno ORDER BY sal DESC) AS rnk,
       DENSE_RANK()  OVER (PARTITION BY deptno ORDER BY sal DESC) AS d_rnk,
       ROW_NUMBER()  OVER (PARTITION BY deptno ORDER BY sal DESC) AS rn
FROM   emp;
-- → PARTITION BY deptno ORDER BY sal DESC 소트 1회로 3개 함수 처리
```

---

## PGA 크기 조정

```sql
-- 디스크 소트가 자주 발생한다면 PGA 크기 확대 검토
SELECT name, value FROM v$parameter WHERE name = 'pga_aggregate_target';
-- 기본값: 시스템 메모리의 약 20%

-- 현재 PGA 통계
SELECT name, value
FROM   v$pgastat
WHERE  name IN ('aggregate PGA target parameter',
                'total PGA allocated',
                'total PGA used for auto workareas',
                'over allocation count');   -- > 0이면 PGA 부족
```

---

## 시험 포인트

- **소트 발생 구문**: ORDER BY, GROUP BY, DISTINCT, UNION, Sort Merge Join, MINUS/INTERSECT
- **소트 없는 구문**: `UNION ALL` (중복 포함), `HASH GROUP BY`, `HASH UNIQUE`
- **Sort Area 초과 시**: Temp Tablespace로 디스크 소트 → 성능 급격히 저하
- **소트 회피 방법**:
  - 인덱스로 ORDER BY/GROUP BY 소트 제거
  - UNION → UNION ALL (중복 없음 확실할 때)
  - DISTINCT → EXISTS (소트 없는 세미 조인)
  - MIN/MAX → 인덱스 MIN/MAX 최적화 자동 적용
- **Top-N 소트**: `ROWNUM <= N` + `ORDER BY` → `SORT ORDER BY STOPKEY` 자동 최적화
- **실행 계획**: `SORT ORDER BY STOPKEY` (Top-N), `HASH GROUP BY` (소트 없는 집계)
