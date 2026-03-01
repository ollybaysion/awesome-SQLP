---
title: 토픽 추가 가이드
tags: [가이드]
---
# 새 토픽 추가 방법

새로운 개념을 대시보드에 추가하는 방법입니다.

## 1단계: 마크다운 파일 작성

해당 과목 폴더에 파일을 추가합니다.

```
content/
├── 01-data-modeling/   ← 1과목 파일 추가
├── 02-sql-basic/       ← 2과목 파일 추가
└── 03-sql-advanced/    ← 3과목 파일 추가
```

**파일명 규칙**: `번호-영문이름.md`

```
03-identifier.md    ← 1과목 세 번째 토픽
03-subquery.md      ← 2과목 세 번째 토픽
```

숫자 접두사가 사이드바 표시 순서를 결정합니다.

## 2단계: Front Matter 작성

파일 맨 위에 아래 형식을 반드시 포함합니다.

```markdown
---
title: 식별자(Identifier)
tags: [핵심개념, 모델링]
---

# 식별자(Identifier)

본문 내용...
```

| 항목 | 설명 |
|------|------|
| `title` | 사이드바와 상단에 표시될 제목 |
| `tags` | 태그 (쉼표로 구분, `[태그1, 태그2]` 형식) |

## 3단계: Push

```bash
git add content/02-sql-basic/03-subquery.md
git commit -m "docs: 서브쿼리 내용 추가"
git push
```

push 하면 GitHub Action이 자동으로:
1. `manifest.json` 업데이트
2. GitHub Pages 재배포

약 1~2분 후 사이드바에 새 토픽이 나타납니다.

## 새 과목 추가

기본 3과목 외에 과목을 추가하려면:

**1. 폴더 생성**: `content/04-새과목/`

**2. `_subject.json` 작성** (선택, 없으면 폴더명이 제목):

```json
{
  "title": "4과목: 새 과목 이름",
  "color": "#ef4444"
}
```

**3. MD 파일 추가 후 push** → 자동 반영

## 마크다운 작성 팁

### SQL 코드 블록

````markdown
```sql
SELECT ename, sal
FROM   emp
WHERE  deptno = 10;
```
````

SQL 구문 강조가 자동 적용됩니다.

### 표 (Table)

```markdown
| 컬럼1 | 컬럼2 |
|-------|-------|
| 값1   | 값2   |
```

### 인용구 (시험 포인트 강조)

```markdown
> 💡 시험에 자주 나오는 포인트입니다.

> ⚠️ 주의사항
```

### 권장 구조

```markdown
---
title: 토픽명
tags: [태그]
---
# 토픽명

## 정의
개념 설명

## 특징 / 종류
표나 목록으로 정리

## 예제
SQL 코드 예시

## 시험 포인트
- 암기 포인트 1
- 암기 포인트 2
```
