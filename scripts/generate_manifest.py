#!/usr/bin/env python3
"""
SQLP 학습 대시보드 - manifest.json 자동 생성 스크립트

사용법:
  python scripts/generate_manifest.py

content/ 폴더 구조를 스캔하여 manifest.json을 자동 생성합니다.
각 MD 파일의 Front Matter(title, tags)를 파싱하여 메타데이터를 추출합니다.
"""

import os
import json
import re


CONTENT_DIR = "content"
OUTPUT_FILE = "manifest.json"

# 과목 폴더 패턴: 숫자로 시작하는 폴더
SUBJECT_FOLDER_PATTERN = re.compile(r"^\d+-.+")

# 기본 과목 설정 (없을 경우 _subject.json에서 읽음)
DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]


def parse_front_matter(content: str) -> tuple[dict, str]:
    """마크다운 파일에서 YAML Front Matter를 파싱합니다."""
    meta = {}
    body = content

    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n(.*)", content, re.DOTALL)
    if match:
        fm_text = match.group(1)
        body = match.group(2)
        for line in fm_text.splitlines():
            if ":" in line:
                key, _, value = line.partition(":")
                meta[key.strip()] = value.strip()

    return meta, body


def parse_tags(tag_str: str) -> list[str]:
    """'[tag1, tag2]' 또는 'tag1, tag2' 형식의 태그 문자열을 파싱합니다."""
    cleaned = tag_str.strip().strip("[]")
    return [t.strip() for t in cleaned.split(",") if t.strip()]


def load_subject_meta(folder_path: str, folder_name: str, index: int) -> dict:
    """_subject.json 파일에서 과목 메타데이터를 읽거나 기본값을 반환합니다."""
    meta_file = os.path.join(folder_path, "_subject.json")
    if os.path.exists(meta_file):
        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)

    # 기본값: 폴더 이름에서 과목명 추출
    title = folder_name.lstrip("0123456789-").replace("-", " ").title()
    color = DEFAULT_COLORS[index % len(DEFAULT_COLORS)]
    return {"title": title, "color": color}


def derive_topic_id(filename: str) -> str:
    """파일명에서 topic ID를 추출합니다. 숫자 접두사 제거."""
    name = os.path.splitext(filename)[0]          # 확장자 제거
    name = re.sub(r"^\d+-", "", name)              # 숫자 접두사 제거
    return name


def generate_manifest():
    """manifest.json을 생성합니다."""
    if not os.path.exists(CONTENT_DIR):
        print(f"[오류] '{CONTENT_DIR}' 폴더가 존재하지 않습니다.")
        return

    manifest = {"subjects": []}

    # 과목 폴더 탐색 (숫자 접두사 기준 정렬)
    subject_folders = sorted([
        f for f in os.listdir(CONTENT_DIR)
        if os.path.isdir(os.path.join(CONTENT_DIR, f))
        and SUBJECT_FOLDER_PATTERN.match(f)
        and f != "exam"
    ])

    for idx, folder_name in enumerate(subject_folders):
        folder_path = os.path.join(CONTENT_DIR, folder_name)

        # 과목 메타데이터 로드
        subject_meta = load_subject_meta(folder_path, folder_name, idx)
        subject_id = re.sub(r"^\d+-", "", folder_name)   # 폴더명에서 ID 추출

        subject = {
            "id": subject_id,
            "title": subject_meta.get("title", folder_name),
            "color": subject_meta.get("color", DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]),
            "topics": [],
        }

        # MD 파일 탐색 (파일명 기준 정렬)
        md_files = sorted([
            f for f in os.listdir(folder_path)
            if f.endswith(".md") and not f.startswith("_")
        ])

        for md_file in md_files:
            file_path = os.path.join(folder_path, md_file)
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            meta, _ = parse_front_matter(content)
            topic_id = derive_topic_id(md_file)

            topic = {
                "id": topic_id,
                "title": meta.get("title", topic_id),
                "file": f"{CONTENT_DIR}/{folder_name}/{md_file}",
                "tags": parse_tags(meta.get("tags", "")),
            }
            subject["topics"].append(topic)

        if subject["topics"]:
            manifest["subjects"].append(subject)
            print(f"  ✓ {subject['title']} ({len(subject['topics'])}개 토픽)")

    # manifest.json 저장
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    total = sum(len(s["topics"]) for s in manifest["subjects"])
    print(f"\n✅ {OUTPUT_FILE} 생성 완료 - {len(manifest['subjects'])}개 과목, {total}개 토픽")


if __name__ == "__main__":
    # 스크립트는 프로젝트 루트에서 실행해야 합니다
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    os.chdir(root_dir)

    print("📋 manifest.json 생성 중...\n")
    generate_manifest()
