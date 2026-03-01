---
title: 데이터베이스 Call 최소화
tags: [튜닝, DB Call, 네트워크, ArrayProcessing, 부분범위처리]
---
# 데이터베이스 Call 최소화

**DB Call**은 애플리케이션이 Oracle에 SQL을 전송하는 통신 행위다.
Call 횟수가 많을수록 네트워크 왕복과 SQL 처리 오버헤드가 누적된다.
특히 루프 안에서 SQL을 실행하는 패턴은 성능 최악의 원인이 된다.

---

## DB Call의 종류

```
① User Call (사용자 Call)
   애플리케이션 ↔ Oracle 서버 간 네트워크를 통한 Call
   - Parse Call   : SQL 파싱 요청
   - Execute Call : SQL 실행 요청
   - Fetch Call   : 결과 행 인출 요청
   ↓
   네트워크 레이턴시 × Call 횟수 = 누적 대기 시간

② Recursive Call (재귀 Call)
   Oracle 서버 내부에서 발생하는 Call
   - 딕셔너리 조회, 동적 SQL 처리 등
   - 사용자에게 직접 영향 없음
```

---

## Call 횟수와 성능의 관계

```
예시: 1만 건의 주문에 대해 고객명을 조회하는 작업

❌ 나쁜 패턴 (루프 안에서 건별 조회):
   FOR 주문 IN 1..10000 LOOP
       SELECT 고객명 FROM 고객 WHERE 고객번호 = 주문.고객번호;  -- 10,000번 Call
   END LOOP;
   → Parse 10,000회 + Execute 10,000회 + Fetch 10,000회 = 30,000 Call
   → 네트워크 레이턴시 1ms × 30,000 = 30초 낭비

✅ 좋은 패턴 (조인으로 1번 조회):
   SELECT o.주문번호, c.고객명
   FROM   주문 o, 고객 c
   WHERE  o.고객번호 = c.고객번호;   -- 1번 Call
   → Parse 1회 + Execute 1회 + Fetch (1~수회) = 3~수 Call
```

---

## Array Processing (배치 I/O)

**Array Processing**은 Fetch를 건별이 아닌 **여러 행을 묶어서 한 번에** 가져오는 기법이다.

### Fetch Call 최소화

```
Array Size = 1 (기본 JDBC):
  Execute 1회 + Fetch 10,000회 (1건씩) = 10,001 Call

Array Size = 100:
  Execute 1회 + Fetch 100회 (100건씩) = 101 Call

Array Size = 1000:
  Execute 1회 + Fetch 10회 (1000건씩) = 11 Call

→ Array Size 증가 → Fetch Call 감소 → 네트워크 왕복 감소
```

### Java에서 Array Processing 설정

```java
// JDBC: fetchSize 설정
Connection conn = DriverManager.getConnection(url, user, pass);
PreparedStatement pstmt = conn.prepareStatement(
    "SELECT empno, ename, sal FROM emp WHERE deptno = ?"
);
pstmt.setFetchSize(100);   // 한 번 Fetch에 100건씩 가져옴 (기본값: 10)
pstmt.setInt(1, 10);
ResultSet rs = pstmt.executeQuery();
while (rs.next()) { ... }
```

### PL/SQL에서 BULK COLLECT 사용

```sql
-- ❌ 건별 FETCH (느림): Fetch Call = 커서 행 수
DECLARE
    CURSOR c IS SELECT empno, ename FROM emp WHERE deptno = 10;
    v_empno emp.empno%TYPE;
    v_ename emp.ename%TYPE;
BEGIN
    OPEN c;
    LOOP
        FETCH c INTO v_empno, v_ename;   -- 1건씩 Fetch
        EXIT WHEN c%NOTFOUND;
        -- 처리...
    END LOOP;
    CLOSE c;
END;
/

-- ✅ BULK COLLECT (빠름): 여러 건을 배열로 한 번에 Fetch
DECLARE
    TYPE t_empno IS TABLE OF emp.empno%TYPE;
    TYPE t_ename IS TABLE OF emp.ename%TYPE;
    v_empnos t_empno;
    v_enames t_ename;
BEGIN
    SELECT empno, ename
    BULK COLLECT INTO v_empnos, v_enames
    FROM   emp
    WHERE  deptno = 10;    -- 모두 한 번에 수집

    FOR i IN 1..v_empnos.COUNT LOOP
        -- 처리 (메모리 내에서 루프, DB Call 없음)
    END LOOP;
END;
/

-- ✅ LIMIT으로 메모리 제어 (대용량 시)
DECLARE
    CURSOR c IS SELECT empno, ename FROM emp;
    TYPE t_emp IS TABLE OF c%ROWTYPE;
    v_emps t_emp;
BEGIN
    OPEN c;
    LOOP
        FETCH c BULK COLLECT INTO v_emps LIMIT 1000;   -- 1000건씩 Fetch
        EXIT WHEN v_emps.COUNT = 0;
        FORALL i IN 1..v_emps.COUNT
            INSERT INTO emp_backup VALUES v_emps(i);
        COMMIT;
    END LOOP;
    CLOSE c;
END;
/
```

---

## FORALL로 DML Call 최소화

**FORALL**은 배열 데이터를 건별 DML이 아닌 **한 번의 DML로 일괄 처리**한다.

```sql
-- ❌ FOR LOOP 안에서 건별 INSERT (느림): DML Execute Call = 배열 크기
DECLARE
    TYPE t_emp IS TABLE OF emp%ROWTYPE;
    v_emps t_emp;
BEGIN
    SELECT * BULK COLLECT INTO v_emps FROM emp_source;
    FOR i IN 1..v_emps.COUNT LOOP
        INSERT INTO emp_target VALUES v_emps(i);   -- 14번 Execute Call
    END LOOP;
END;
/

-- ✅ FORALL: 배열 전체를 1번의 DML로 처리
DECLARE
    TYPE t_emp IS TABLE OF emp%ROWTYPE;
    v_emps t_emp;
BEGIN
    SELECT * BULK COLLECT INTO v_emps FROM emp_source;
    FORALL i IN 1..v_emps.COUNT
        INSERT INTO emp_target VALUES v_emps(i);   -- 1번 Execute Call
    COMMIT;
END;
/
-- → 14건이든 100만 건이든 Execute Call은 단 1회
```

### FORALL 오류 처리

```sql
-- SAVE EXCEPTIONS: 오류 발생 행만 기록하고 나머지 계속 처리
FORALL i IN 1..v_emps.COUNT SAVE EXCEPTIONS
    INSERT INTO emp_target VALUES v_emps(i);

-- 오류 확인
IF SQL%BULK_EXCEPTIONS.COUNT > 0 THEN
    FOR i IN 1..SQL%BULK_EXCEPTIONS.COUNT LOOP
        DBMS_OUTPUT.PUT_LINE('오류 인덱스: ' || SQL%BULK_EXCEPTIONS(i).ERROR_INDEX
            || ', 코드: ' || SQL%BULK_EXCEPTIONS(i).ERROR_CODE);
    END LOOP;
END IF;
```

---

## 부분 범위 처리 (Partial Range Processing)

**부분 범위 처리**는 전체 결과가 아닌 **필요한 만큼만 Fetch**하여 응답 시간을 줄이는 기법이다.
OLTP 화면에서 "처음 20건만 보기" 같은 페이지네이션에서 핵심이다.

```sql
-- ✅ 부분 범위 처리 패턴 (Oracle)
-- 인덱스 순서대로 읽으면서 N건만 가져옴 → 전체 소트 불필요
SELECT empno, ename, sal
FROM   (SELECT empno, ename, sal, ROWNUM AS rn
        FROM   (SELECT empno, ename, sal
                FROM   emp
                WHERE  deptno = 10
                ORDER  BY sal DESC)   -- 인덱스(deptno, sal) 있으면 소트 없이 순서 보장
        WHERE  ROWNUM <= 20)          -- STOPKEY: 20건 도달 시 즉시 중단
WHERE  rn >= 1;
```

```
부분 범위 처리 조건:
1. 인덱스 순서로 정렬 → ORDER BY가 소트 없이 처리됨
2. ROWNUM으로 Stop 조건 → 전체 읽지 않고 N건에서 중단
3. 실행 계획에 SORT ORDER BY STOPKEY 등장

부분 범위 처리가 깨지는 경우:
- ORDER BY 컬럼이 인덱스와 불일치 → 전체 소트 발생 → 부분 범위 처리 불가
- DISTINCT, GROUP BY, UNION 등 → 전체 결과가 필요한 집합 연산
```

---

## One SQL 원칙

여러 번 SQL을 호출하는 로직을 **하나의 SQL**로 통합하면 Call을 획기적으로 줄일 수 있다.

```sql
-- ❌ 나쁜 패턴: 루프로 각 부서의 평균 급여를 조회해서 UPDATE
FOR dept IN (SELECT deptno FROM dept) LOOP
    SELECT AVG(sal) INTO v_avg FROM emp WHERE deptno = dept.deptno;   -- N번
    UPDATE dept_stat SET avg_sal = v_avg WHERE deptno = dept.deptno;  -- N번
END LOOP;

-- ✅ One SQL로 통합: 1번의 Call로 처리
UPDATE dept_stat ds
SET    ds.avg_sal = (SELECT AVG(e.sal) FROM emp e WHERE e.deptno = ds.deptno);
-- 또는 MERGE 사용

-- 더 효율적: 서브쿼리 한 번만 계산
MERGE INTO dept_stat ds
USING (SELECT deptno, AVG(sal) AS avg_sal FROM emp GROUP BY deptno) ea
ON    (ds.deptno = ea.deptno)
WHEN MATCHED THEN UPDATE SET ds.avg_sal = ea.avg_sal;
```

---

## 프로시저 호출 vs SQL 직접 실행

```
애플리케이션 → DB 프로시저 Call → 프로시저 내부 SQL 실행
  장점: 네트워크 Call 횟수 감소, 로직 DB 내부 처리 → 전송 데이터 최소화
  단점: 비즈니스 로직이 DB에 종속

애플리케이션 → SQL 직접 실행 (Array Processing 적용)
  장점: 유연한 로직, DB 독립성
  단점: Call 횟수 많을 수 있음 (Array Processing으로 보완)
```

---

## DB Call 최소화 체크리스트

| 패턴 | 문제 | 해결 |
|------|------|------|
| 루프 안 SQL | Call 폭증 | 조인 또는 서브쿼리로 One SQL화 |
| 건별 FETCH | Fetch Call 과다 | Array Size / BULK COLLECT 사용 |
| 건별 DML | Execute Call 과다 | FORALL 사용 |
| 불필요한 전체 조회 | 네트워크 과부하 | 부분 범위 처리(ROWNUM) |
| 반복 파싱 | Hard Parse 폭증 | 바인드 변수 사용 |

---

## 시험 포인트

- **DB Call 종류**: Parse / Execute / Fetch — 각각 SQL 파싱·실행·인출 요청
- **Array Processing**: Fetch Call 횟수 감소 → `fetchSize` / `BULK COLLECT LIMIT N`
- **BULK COLLECT**: 여러 행을 배열로 한 번에 Fetch → PL/SQL 커서 Fetch Call 최소화
- **FORALL**: 배열 데이터를 1번의 DML Execute로 일괄 처리 (`SAVE EXCEPTIONS`로 오류 처리)
- **부분 범위 처리**: 인덱스 순서 + ROWNUM → `SORT ORDER BY STOPKEY` → 전체 결과 불필요
- **One SQL 원칙**: 루프 안 SQL → 조인/MERGE로 통합 → Call 횟수 N → 1
- **네트워크 레이턴시**: Call 횟수 × 레이턴시 = 누적 대기 → Call 최소화가 핵심
