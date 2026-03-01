---
title: 인덱스(Index)
tags: [튜닝, 인덱스]
---
# 인덱스(Index)

## 개념

인덱스는 **데이터 검색 속도를 향상시키기 위한 별도의 데이터 구조**이다. 책의 색인(목차)과 유사한 역할.

> 인덱스 없이 테이블 전체 스캔(Full Table Scan) → 인덱스 Range Scan으로 속도 향상

## B*Tree 인덱스 구조

```
           [Root Block]
          /      |      \
    [Branch]  [Branch]  [Branch]
    /    \       |
[Leaf] [Leaf] [Leaf] ...
```

- **Root Block**: 최상위, 하나만 존재
- **Branch Block**: 중간 노드 (선택적)
- **Leaf Block**: 실제 인덱스 키 값 + ROWID 저장, 양방향 연결 리스트

## 인덱스 스캔 방식

| 방식 | 설명 | 사용 조건 |
|------|------|-----------|
| **Index Range Scan** | 범위 스캔, 가장 일반적 | 선두 컬럼 조건절 존재 |
| **Index Full Scan** | 인덱스 전체 스캔 | ORDER BY, GROUP BY에 인덱스 활용 |
| **Index Unique Scan** | 단 하나의 값 스캔 | Unique 인덱스 + 등치(=) 조건 |
| **Index Skip Scan** | 선두 컬럼 조건 없어도 가능 | 선두 컬럼 Distinct 값이 적을 때 |
| **Index Fast Full Scan** | 블록 단위 병렬 스캔 | 인덱스로만 쿼리 처리 가능 시 |

## 인덱스 사용 불가 조건

```sql
-- ❌ 인덱스 컬럼에 함수/연산 적용
WHERE TO_CHAR(join_date, 'YYYY') = '2024'  -- 함수 변환
WHERE sal * 12 > 30000                      -- 연산
WHERE sal + 0 > 3000                        -- 연산

-- ✅ 개선
WHERE join_date >= DATE '2024-01-01'
  AND join_date <  DATE '2025-01-01'
WHERE sal > 30000 / 12

-- ❌ 암묵적 형변환
WHERE emp_no = 1234      -- emp_no가 VARCHAR2 타입이면 변환 발생

-- ❌ LIKE 선두 와일드카드
WHERE ename LIKE '%SMITH'   -- ❌ Range Scan 불가
WHERE ename LIKE 'SMITH%'   -- ✅ Range Scan 가능

-- ❌ NOT 조건, IS NOT NULL
WHERE deptno != 10
WHERE comm IS NOT NULL
```

## 인덱스 설계 원칙

1. **카디널리티(Cardinality)** 높은 컬럼을 선두에 배치
2. **조건절 컬럼** 우선 고려
3. **등치(=) 조건 컬럼** → 범위 조건 컬럼 순서
4. 인덱스 컬럼 순서 = 조건절 사용 순서

```sql
-- 인덱스: (DEPTNO, JOB, SAL)
-- ✅ 효율적 사용
WHERE deptno = 10 AND job = 'CLERK' AND sal > 1000

-- ⚠️ 부분 사용 (DEPTNO만 Range Scan)
WHERE deptno = 10 AND sal > 1000  -- JOB 건너뜀
```

## 클러스터링 팩터 (Clustering Factor)

테이블 데이터의 **물리적 정렬 상태**와 인덱스 정렬의 유사도.

- CF 낮음 → 인덱스 스캔 효율 높음 (블록 I/O 최소)
- CF 높음 → 인덱스 스캔 비효율 (블록 I/O 증가)

## 인덱스 손익분기점

인덱스 Range Scan이 Full Table Scan보다 유리한 선택 비율:

- 일반적으로 **5~20%** 이하일 때 인덱스가 유리
- CF에 따라 달라짐 (CF 좋으면 더 높은 비율도 인덱스 유리)

## 시험 포인트

- B*Tree 인덱스 구조: Root → Branch → Leaf
- Leaf Block에 저장되는 것: 키 값 + **ROWID**
- 인덱스 스캔 방식 5가지와 각 사용 조건
- 인덱스 사용 불가 케이스 (함수 적용, 묵시적 형변환, 선두 와일드카드)
- 인덱스 컬럼 순서의 중요성 (선두 컬럼 조건 필수)
