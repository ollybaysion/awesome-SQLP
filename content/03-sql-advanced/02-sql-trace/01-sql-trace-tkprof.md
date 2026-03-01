---
title: SQL Trace와 TKProf - Row Source Operation 분석
tags: [튜닝, SQL Trace, TKProf, 실행계획, Row Source Operation]
---
# SQL Trace와 TKProf — Row Source Operation 분석

**SQL Trace**는 SQL 실행 중 발생하는 모든 이벤트(Parse, Execute, Fetch)를 raw 파일로 기록하는 Oracle 진단 도구다.
**TKProf**는 이 raw 트레이스 파일을 사람이 읽을 수 있는 형태로 변환해주는 유틸리티이며,
그 안에 담긴 **Row Source Operation**은 실제 실행된 오퍼레이션을 트리 형태로 보여준다.

---

## SQL Trace 활성화

### 세션 단위

```sql
-- 현재 세션에 SQL Trace 활성화
ALTER SESSION SET sql_trace = TRUE;

-- 쿼리 실행
SELECT d.dname, e.ename, e.sal
FROM   dept d, emp e
WHERE  d.deptno = e.deptno
AND    d.loc = 'DALLAS';

-- Trace 종료
ALTER SESSION SET sql_trace = FALSE;
```

### 바인드 변수 + 대기 이벤트 포함 (권장)

```sql
-- 10046 이벤트: 레벨별 수집 범위 조정
ALTER SESSION SET EVENTS '10046 trace name context forever, level 12';
-- level 1: 기본 (Parse/Execute/Fetch 통계)
-- level 4: 바인드 변수 값 포함
-- level 8: 대기 이벤트 포함
-- level 12: 바인드 변수 + 대기 이벤트 모두 포함

-- 쿼리 실행 ...

ALTER SESSION SET EVENTS '10046 trace name context off';
```

### 다른 세션에 Trace 활성화 (DBA)

```sql
-- SID, SERIAL# 확인
SELECT sid, serial#, username, status
FROM   v$session
WHERE  username = 'SCOTT';

-- 해당 세션에 Trace 활성화
EXEC DBMS_SYSTEM.SET_SQL_TRACE_IN_SESSION(sid => 142, serial# => 1234, sql_trace => TRUE);

-- 또는 DBMS_MONITOR 사용 (권장)
EXEC DBMS_MONITOR.SESSION_TRACE_ENABLE(session_id => 142, serial_num => 1234, waits => TRUE, binds => TRUE);
EXEC DBMS_MONITOR.SESSION_TRACE_DISABLE(session_id => 142, serial_num => 1234);
```

---

## 트레이스 파일 위치 확인

```sql
-- 트레이스 파일 경로 확인
SELECT value FROM v$parameter WHERE name = 'user_dump_dest';
-- 예: /u01/app/oracle/diag/rdbms/orcl/orcl/trace

-- 현재 세션의 트레이스 파일명 확인
SELECT tracefile FROM v$process WHERE addr = (SELECT paddr FROM v$session WHERE sid = SYS_CONTEXT('USERENV','SID'));
```

---

## TKProf 변환

```bash
# 기본 사용법
tkprof <trace_file>.trc <output_file>.txt

# 자주 쓰는 옵션
tkprof orcl_ora_12345.trc result.txt \
    sort=exeela \      # 실행 경과 시간 기준 정렬 (가장 느린 SQL 상위 노출)
    print=20 \         # 상위 20개 SQL만 출력
    sys=no \           # SYS 계정 재귀 SQL 제외
    explain=scott/tiger  # 실행 계획 추가 출력 (선택)

# sort 옵션 주요 값
# exeela: Execute Elapsed Time (실행 경과시간) ← 가장 많이 사용
# fchela: Fetch Elapsed Time
# prscnt: Parse Count
# exerow: Execute Rows
```

---

## TKProf 결과 구조 이해

```
TKPROF 출력 예시:

SQL ID: abc123xyz
SELECT d.dname, e.ename, e.sal
FROM   dept d, emp e
WHERE  d.deptno = e.deptno
AND    d.loc = 'DALLAS'

call     count       cpu    elapsed       disk      query    current        rows
------- ------  -------- ---------- ---------- ---------- ----------  ----------
Parse        1      0.00       0.00          0          0          0           0
Execute      1      0.00       0.00          0          0          0           0
Fetch        2      0.00       0.01          3         15          0           5
------- ------  -------- ---------- ---------- ---------- ----------  ----------
total        4      0.00       0.01          3         15          0           5
```

| 컬럼 | 설명 |
|------|------|
| **call** | Parse(파싱), Execute(실행), Fetch(인출) 단계 |
| **count** | 각 단계 실행 횟수 |
| **cpu** | CPU 사용 시간 (초) |
| **elapsed** | 경과 시간(Wall Time) — 대기 시간 포함 |
| **disk** | 물리적 디스크 읽기 블록 수 |
| **query** | 논리적 읽기 (Consistent Read) 블록 수 |
| **current** | Current Mode 읽기 블록 수 (DML 시 발생) |
| **rows** | 처리한 행 수 |

> 💡 `elapsed >> cpu` 이면 **대기 이벤트**(I/O, Lock 등)가 병목임을 의미한다.

---

## Row Source Operation

Row Source Operation은 TKProf 결과 하단에 출력되며, **실제로 실행된 오퍼레이션의 트리**와 각 노드별 통계를 보여준다.
EXPLAIN PLAN이 "예상" 실행 계획인 것과 달리, Row Source Operation은 **실제 실행 결과**다.

```
Rows (1st) Rows (avg) Rows (max)  Row Source Operation
---------- ---------- ----------  ----------------------------------------
         5          5          5  NESTED LOOPS  (cr=15 pr=3 pw=0 time=10521 us)
         1          1          1   TABLE ACCESS FULL DEPT (cr=7 pr=2 pw=0 time=4231 us cost=3 size=44 card=1)
         5          5          5   TABLE ACCESS BY INDEX ROWID EMP (cr=8 pr=1 pw=0 time=5890 us cost=2 size=30 card=5)
         5          5          5    INDEX RANGE SCAN IDX_EMP_DEPTNO (cr=3 pr=0 pw=0 time=1023 us cost=1 size=0 card=5)
```

### 각 항목 상세 설명

```
cr=15 pr=3 pw=0 time=10521 us
│     │    │    └── 해당 노드의 누적 경과 시간 (마이크로초)
│     │    └─────── Physical Writes: 물리 쓰기 블록 수
│     └──────────── Physical Reads: 물리 읽기 블록 수 (디스크 I/O)
└────────────────── Consistent Reads: 논리 읽기 블록 수 (Buffer Cache 포함)

cost=3 size=44 card=1
│      │       └── Cardinality: 옵티마이저 예상 행 수
│      └────────── 옵티마이저 예상 데이터 크기 (bytes)
└─────────────────── 옵티마이저 예상 비용
```

### 오퍼레이션 트리 읽는 법

```
Row Source Operation은 들여쓰기로 계층을 표현한다.
가장 안쪽(들여쓰기 깊은 쪽)이 먼저 실행된다.

NESTED LOOPS                          ← 4. 최종 결과
  TABLE ACCESS FULL DEPT              ← 1. DEPT 전체 스캔 (Outer)
  TABLE ACCESS BY INDEX ROWID EMP     ← 3. EMP 테이블 접근 (Inner, 반복)
    INDEX RANGE SCAN IDX_EMP_DEPTNO   ← 2. EMP 인덱스 스캔 (Inner, 반복)

실행 순서: ② → ③ → ① → ④  (Inner가 Outer 건수만큼 반복)
```

---

## EXPLAIN PLAN vs Row Source Operation 비교

| 구분 | EXPLAIN PLAN | Row Source Operation |
|------|-------------|---------------------|
| 시점 | 실행 **전** 예측 | 실행 **후** 실제 결과 |
| 행 수 | 옵티마이저 추정값 | **실제 처리된 행 수** |
| 비용 | 추정 cost | 실제 cr/pr/time |
| 신뢰성 | 통계 오래되면 부정확 | **항상 정확** |
| 용도 | 빠른 계획 확인 | 성능 문제 정밀 분석 |

---

## Row Source Operation으로 성능 병목 찾기

### 패턴 1: pr(Physical Read)이 큰 경우

```
cr=500 pr=480 pw=0 time=250000 us  TABLE ACCESS FULL LARGE_TABLE
→ pr이 cr에 가까움 → Buffer Cache 미스 → 디스크 I/O 병목
→ 해결: 인덱스 추가, 통계 갱신, Buffer Cache 크기 조정
```

### 패턴 2: 예상 rows vs 실제 rows 불일치

```
예상 (EXPLAIN PLAN):  card=1  (1건 예상)
실제 (Row Source Op): Rows=50000 (5만 건 실제)

→ 옵티마이저 오판 → 잘못된 실행 계획 선택
→ 해결: 통계 재수집, 히스토그램 생성, 힌트 사용
```

### 패턴 3: cr이 비정상적으로 큰 경우

```
Rows=10  cr=100000  TABLE ACCESS BY INDEX ROWID ...
→ 10건 조회에 10만 블록 읽기 → 인덱스 클러스터링 팩터 나쁨
→ 해결: 커버링 인덱스, 테이블 재구성
```

### 패턴 4: NL 조인 Inner 반복 횟수

```
Rows=1000  TABLE ACCESS FULL INNER_TABLE  (cr=500000)
→ Inner 테이블에 인덱스 없이 1000회 Full Scan
→ cr = 500 (블록) × 1000 (반복) = 500,000
→ 해결: Inner 테이블 조인 컬럼에 인덱스 생성
```

---

## 실전 분석 예시

```
SQL: SELECT * FROM orders o, order_detail d WHERE o.order_id = d.order_id AND o.status = 'OPEN'

Row Source Operation:
Rows        Row Source Operation
----------- -----------------------------------------------
    150,000 HASH JOIN (cr=25000 pr=8000 pw=0 time=12500000 us)
     50,000  TABLE ACCESS FULL ORDERS (cr=5000 pr=2000 pw=0 time=3000000 us cost=1200 card=50000)
  3,000,000  TABLE ACCESS FULL ORDER_DETAIL (cr=20000 pr=6000 pw=0 time=8000000 us cost=8000 card=3000000)

분석:
① HASH JOIN: pr=8000 → 물리 I/O 많음 → Hash Area 초과(Grace Hash Join) 가능성
② ORDERS: 예상 card=50000, 실제 50000 → 통계 정확
③ ORDER_DETAIL: 300만 건 Full Scan → 인덱스(order_id) 있는지 확인 필요
④ elapsed >> cpu라면 → I/O 대기 이벤트 병목

개선 방향:
  - ORDER_DETAIL(order_id) 인덱스 생성 → HASH JOIN 대신 NL 조인 유도
  - ORDERS에 status 조건 인덱스 → Full Scan 범위 축소
  - PGA 크기 증가 → Hash Area 확보 (Grace Hash Join 방지)
```

---

## 시험 포인트

- **SQL Trace**: `ALTER SESSION SET sql_trace = TRUE` 또는 10046 이벤트로 활성화
- **10046 level 12**: 바인드 변수 + 대기 이벤트 모두 수집 (가장 상세)
- **TKProf**: raw 트레이스 파일을 가독성 있는 텍스트로 변환 (`sort=exeela` 자주 사용)
- **elapsed > cpu** → 대기 이벤트(I/O, Lock) 병목
- **cr(Consistent Read)**: 논리 읽기 / **pr(Physical Read)**: 물리 읽기
- **Row Source Operation**: 실제 실행 결과 (EXPLAIN PLAN은 예측값)
- **card 불일치**: 예상 행 수 ≠ 실제 행 수 → 통계 재수집 필요
- **pr/cr 비율**: pr이 cr에 가까울수록 Buffer Cache 미스 → 디스크 I/O 과다
