"""프로젝트 저장소. 프로젝트 1개 = data/projects/<id>/ 폴더 1개."""
from __future__ import annotations

import json
import re
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

from . import config, strategy

CANVAS_W = 1080
CANVAS_H = 1350


def _slugify(text: str) -> str:
    text = re.sub(r"[^\w가-힣]+", "-", text.strip()).strip("-")
    return (text[:40] or "cardnews").lower()


def new_project_id(topic: str) -> str:
    stamp = datetime.now().strftime("%y%m%d-%H%M%S")
    return f"{stamp}-{_slugify(topic)}"


def project_dir(project_id: str) -> Path:
    safe = Path(project_id).name  # 경로 이탈 방지
    return config.PROJECTS_DIR / safe


def _spec_path(project_id: str) -> Path:
    return project_dir(project_id) / "project.json"


# ---------------------------------------------------------------- 레이어 생성

def _layers_for(card: dict, theme: dict) -> list[dict]:
    """카드 필드 → 편집 가능한 텍스트 레이어. 좌표는 % 단위."""
    template = card.get("template", "content")
    accent = theme.get("accent", "#F4D77B")
    ink = theme.get("ink", "#FFFFFF")
    sub = theme.get("ink_sub", "#C6CCD8")

    layers: list[dict] = []

    def add(lid, text, **kw):
        if not str(text).strip():
            return
        layer = {
            "id": lid,
            "text": str(text),
            "x": 8.0,
            "y": 10.0,
            "w": 84.0,
            "size": 44,
            "weight": 700,
            "color": ink,
            "align": "left",
            "lineHeight": 1.35,
            "letterSpacing": -0.02,
        }
        layer.update(kw)
        layers.append(layer)

    add("badge", card.get("badge"), y=7.5, size=24, weight=800, color=accent, letterSpacing=0.08)

    if template == "cover":
        add("title", card.get("title"), y=13.0, size=82, weight=800, lineHeight=1.22)
        add("subtitle", card.get("subtitle"), y=36.0, size=36, weight=500, color=sub, lineHeight=1.5)
        add("body", card.get("body"), y=50.0, size=30, weight=400, color=sub, lineHeight=1.55)
    elif template == "final":
        add("title", card.get("title"), y=14.0, size=64, weight=800, lineHeight=1.28)
        add("subtitle", card.get("subtitle"), y=34.0, size=32, weight=500, color=sub, lineHeight=1.5)
        add("body", card.get("cta") or card.get("body"), y=70.0, size=36, weight=700, color=accent, lineHeight=1.45)
        add("note", card.get("note"), y=84.0, size=24, weight=400, color=sub, lineHeight=1.5)
    else:
        add("title", card.get("title"), y=12.0, size=62, weight=800, lineHeight=1.26)
        add("subtitle", card.get("subtitle"), y=31.0, size=30, weight=500, color=sub, lineHeight=1.5)
        add("body", card.get("body"), y=72.0, size=34, weight=600, lineHeight=1.5)
        add("note", card.get("note"), y=88.0, size=23, weight=400, color=sub, lineHeight=1.5)

    if str(card.get("tip", "")).strip():
        layers.append(
            {
                "id": "tip",
                "text": str(card["tip"]),
                "x": 74.0,
                "y": 55.0,
                "w": 20.0,
                "size": 28,
                "weight": 800,
                "color": theme.get("bg", "#162033"),
                "align": "center",
                "lineHeight": 1.25,
                "letterSpacing": 0,
                "sticker": True,
            }
        )
    return layers


def build_project(
    topic: str,
    keywords: dict,
    angle: dict,
    composition: dict,
    theme_key: str = "navy",
    source: dict | None = None,
) -> dict:
    brand = strategy.load_brand()
    theme = dict(brand.theme(theme_key))
    theme["key"] = theme_key
    cards = composition.get("cards", [])

    for index, card in enumerate(cards):
        card.setdefault("image", "")
        card.setdefault("focus", [0.5, 0.5])
        card.setdefault("overlay", 0.55)
        card["index"] = index + 1
        card["layers"] = _layers_for(card, theme)

    return {
        "id": new_project_id(topic),
        "created": date.today().isoformat(),
        "updated": datetime.now().isoformat(timespec="seconds"),
        "topic": topic,
        "topic_refined": keywords.get("topic_refined", topic),
        "audience": keywords.get("audience", ""),
        "keywords": keywords,
        "angle": angle,
        "theme": theme,
        "canvas": {"w": CANVAS_W, "h": CANVAS_H},
        "brand": {
            "name": brand.raw.get("brand", ""),
            "product": brand.raw.get("product", ""),
            "product_en": brand.raw.get("product_en", ""),
        },
        "title": composition.get("title", topic),
        "concept_sentence": composition.get("concept_sentence", ""),
        "cards": cards,
        "caption": composition.get("caption", ""),
        "hashtags": composition.get("hashtags", []),
        "cta_comment": composition.get("cta_comment", ""),
        "next_teaser": composition.get("next_teaser", ""),
        "self_check": composition.get("self_check", []),
        "strategy_notes": composition.get("strategy_notes", ""),
        "sources": keywords.get("_sources", []),
        "source": source,
        "status": "작성중",
        "memo": "",
    }


# ---------------------------------------------------------------- 파일 IO

def save(project: dict) -> Path:
    project["updated"] = datetime.now().isoformat(timespec="seconds")
    path = _spec_path(project["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    (path.parent / "assets").mkdir(exist_ok=True)
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load(project_id: str) -> dict:
    path = _spec_path(project_id)
    if not path.exists():
        raise FileNotFoundError(f"프로젝트를 찾을 수 없습니다: {project_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def delete(project_id: str) -> None:
    target = project_dir(project_id)
    if target.exists():
        shutil.rmtree(target)


def list_projects() -> list[dict[str, Any]]:
    config.ensure_dirs()
    items: list[dict[str, Any]] = []
    for spec in config.PROJECTS_DIR.glob("*/project.json"):
        try:
            data = json.loads(spec.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items.append(
            {
                "id": data.get("id", spec.parent.name),
                "created": data.get("created", ""),
                "updated": data.get("updated", ""),
                "topic": data.get("topic", ""),
                "title": data.get("title", ""),
                "concept_axis": (data.get("angle") or {}).get("concept_axis", ""),
                "post_format": (data.get("angle") or {}).get("post_format", ""),
                "cards": len(data.get("cards", [])),
                "status": data.get("status", ""),
            }
        )
    items.sort(key=lambda item: item["updated"], reverse=True)
    return items
