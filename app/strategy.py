"""옵시디언 자료 → Claude 시스템 프롬프트(전략 지침) 구성.

playbook.md 가 헌법이고, 옵시디언 원문 노트는 근거 발췌로 덧붙입니다.
원문 노트는 읽기만 하며 절대 수정하지 않습니다.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from . import config

MAX_EXCERPT_CHARS = 2600
MAX_NOTES_PER_DIR = 6


@dataclass
class Brand:
    raw: dict

    @property
    def name(self) -> str:
        return self.raw.get("brand", "")

    def theme(self, key: str) -> dict:
        themes = self.raw.get("themes", {})
        return themes.get(key) or next(iter(themes.values()), {})

    def theme_keys(self) -> list[str]:
        return list(self.raw.get("themes", {}).keys())


def load_brand() -> Brand:
    path = config.KNOWLEDGE_DIR / "brand.json"
    if not path.exists():
        return Brand({})
    return Brand(json.loads(path.read_text(encoding="utf-8")))


def load_playbook() -> str:
    path = config.KNOWLEDGE_DIR / "playbook.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4 :]
    return text.strip()


def _score(text: str, terms: list[str]) -> int:
    lowered = text.lower()
    return sum(lowered.count(t.lower()) for t in terms)


def _excerpt(text: str, terms: list[str], limit: int = MAX_EXCERPT_CHARS) -> str:
    """주제 키워드가 가장 몰려 있는 구간을 잘라냅니다."""
    text = _strip_frontmatter(text)
    if len(text) <= limit:
        return text
    blocks = re.split(r"\n(?=#{1,3} )", text)
    ranked = sorted(blocks, key=lambda b: _score(b, terms), reverse=True)
    picked: list[str] = []
    total = 0
    for block in ranked:
        if total + len(block) > limit:
            continue
        picked.append(block)
        total += len(block)
        if total > limit * 0.8:
            break
    if not picked:
        return text[:limit]
    # 원래 순서 유지
    picked.sort(key=lambda b: blocks.index(b))
    return "\n\n".join(picked)


@lru_cache(maxsize=32)
def _read_note(path_str: str) -> str:
    try:
        return Path(path_str).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def gather_sources(topic: str, extra_terms: list[str] | None = None) -> list[dict]:
    """주제와 관련도가 높은 옵시디언 노트 발췌를 모읍니다."""
    terms = [t for t in re.split(r"[\s,·]+", topic) if len(t) >= 2]
    terms += extra_terms or []
    if not terms:
        terms = ["컨셉", "후킹", "CTA"]

    results: list[dict] = []
    for directory in config.strategy_dirs():
        if not directory.exists():
            continue
        scored: list[tuple[int, Path, str]] = []
        for note in sorted(directory.glob("*.md")):
            if note.name.startswith("00_"):
                continue
            body = _read_note(str(note))
            if not body:
                continue
            scored.append((_score(body, terms), note, body))
        scored.sort(key=lambda item: item[0], reverse=True)
        for score, note, body in scored[:MAX_NOTES_PER_DIR]:
            if score == 0 and len(results) > 3:
                continue
            results.append(
                {
                    "source": f"{directory.name}/{note.name}",
                    "score": score,
                    "excerpt": _excerpt(body, terms),
                }
            )
    return results


def build_system_prompt(topic: str, sources: list[dict] | None = None) -> str:
    brand = load_brand()
    playbook = load_playbook()
    sources = sources if sources is not None else gather_sources(topic)

    source_block = "\n\n".join(
        f"### [{s['source']}]\n{s['excerpt']}" for s in sources
    ) or "(옵시디언 원문 노트를 찾지 못했습니다. 플레이북만 사용하세요.)"

    return f"""당신은 {brand.name or '이 브랜드'}의 SNS 카드뉴스 기획자입니다.
아래 **전략 플레이북**과 **원문 근거**를 지침으로, 주어진 주제의 카드뉴스를 설계합니다.

절대 규칙
- 플레이북의 규칙(컨셉 5축 / 4포맷 / 구매성 4단 / 카드 텍스트 하드룰 / CTA 규칙)을 반드시 지킵니다.
- 근거에 없는 수치·효능·의학적 단정을 지어내지 않습니다.
- 링크를 카드 본문에 넣지 않습니다. CTA는 키워드 댓글 유도로 만듭니다.
- 한 줄 글자 수 제한을 어기면 카드가 깨집니다. 줄바꿈(\\n)을 직접 넣어 통제하세요.
- 출력은 항상 유효한 JSON 하나뿐입니다. 설명 문장이나 코드펜스를 덧붙이지 마세요.

=========================
## 전략 플레이북 (헌법)
=========================
{playbook}

=========================
## 브랜드 정보
=========================
{json.dumps(brand.raw, ensure_ascii=False, indent=2)}

=========================
## 옵시디언 원문 근거 (주제 관련도순 발췌)
=========================
{source_block}
"""
