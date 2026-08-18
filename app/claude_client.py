"""Claude 호출 — 키워드 추출 / 카드뉴스 구성.

두 단계로 나눕니다.
  1) extract_keywords : 주제 → 키워드·앵글 후보 (사용자가 고르고 수정)
  2) compose_cardnews : 확정된 앵글 → 카드 스펙 + 캡션 + 자가진단
"""
from __future__ import annotations

import json
from typing import Any

import anthropic

from . import config, strategy

MAX_TOKENS = 16000
# 원문 붙여넣기 상한. 넘으면 잘라내고 사용자에게 알린다(조용히 버리지 않는다).
SOURCE_MAX_CHARS = 60000


class ClaudeError(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    key = config.load_settings().get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise ClaudeError("ANTHROPIC_API_KEY가 없습니다. 설정 화면에서 입력하세요.")
    return anthropic.Anthropic(api_key=key)


def _model() -> str:
    return config.load_settings().get("CLAUDE_MODEL", "claude-opus-5")


def _call_json(system: str, user: str, schema: dict, effort: str = "high") -> dict:
    client = _client()
    try:
        response = client.messages.create(
            model=_model(),
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            thinking={"type": "adaptive"},
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
    except anthropic.AuthenticationError as exc:
        raise ClaudeError("Anthropic API 키가 올바르지 않습니다.") from exc
    except anthropic.RateLimitError as exc:
        raise ClaudeError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.") from exc
    except anthropic.APIStatusError as exc:
        raise ClaudeError(f"Claude API 오류 ({exc.status_code}): {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise ClaudeError("네트워크 연결에 실패했습니다.") from exc

    if response.stop_reason == "refusal":
        raise ClaudeError("이 주제는 안전 정책상 처리할 수 없습니다. 주제를 바꿔 다시 시도하세요.")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("응답이 잘렸습니다. 카드 수를 줄이거나 주제를 좁혀보세요.")

    text = next((b.text for b in response.content if b.type == "text"), "")
    if not text:
        raise ClaudeError("Claude가 빈 응답을 반환했습니다.")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ClaudeError(f"응답 JSON 파싱 실패: {text[:200]}") from exc


# ---------------------------------------------------------------- 0단계: 원문 요약

SOURCE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "원문의 제목. 없으면 내용으로 붙인다"},
        "kind": {
            "type": "string",
            "description": "원문 종류",
            "enum": ["블로그", "노트", "전자책", "후기", "상세페이지", "기타"],
        },
        "summary": {"type": "string", "description": "3~5줄 요약. 짧은 문장으로"},
        "key_points": {
            "type": "array",
            "description": "카드로 옮길 만한 핵심 포인트 5~8개",
            "items": {"type": "string"},
        },
        "facts": {
            "type": "array",
            "description": "원문에 실제로 적힌 구체적 사실·수치·사례만. 없으면 빈 배열",
            "items": {
                "type": "object",
                "properties": {
                    "claim": {"type": "string"},
                    "detail": {"type": "string", "description": "원문의 근거 표현"},
                },
                "required": ["claim", "detail"],
                "additionalProperties": False,
            },
        },
        "quotes": {
            "type": "array",
            "description": "카드에 그대로 써도 좋을 만한 원문 문장 0~4개",
            "items": {"type": "string"},
        },
        "suggested_topics": {
            "type": "array",
            "description": "이 원문으로 만들 수 있는 카드뉴스 주제 3개. 좁을수록 좋다",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "why": {"type": "string", "description": "왜 이 주제가 먹히는지 한 줄"},
                },
                "required": ["topic", "why"],
                "additionalProperties": False,
            },
        },
        "cautions": {
            "type": "string",
            "description": "카드뉴스로 옮길 때 주의할 점. 단정하면 안 되는 부분, 과장 위험 등",
        },
    },
    "required": [
        "title", "kind", "summary", "key_points", "facts",
        "quotes", "suggested_topics", "cautions",
    ],
    "additionalProperties": False,
}


def summarize_source(text: str, origin: str = "") -> dict[str, Any]:
    """붙여넣은 MD/블로그 원문 → 요약 · 핵심 포인트 · 인용 가능한 사실 · 주제 후보."""
    text = (text or "").strip()
    if len(text) < 50:
        raise ClaudeError("원문이 너무 짧습니다. 50자 이상 붙여넣어 주세요.")

    truncated = len(text) > SOURCE_MAX_CHARS
    body = text[:SOURCE_MAX_CHARS]

    system = strategy.build_system_prompt(text[:400])
    user = f"""아래는 카드뉴스의 원재료가 될 원문입니다.
출처/파일: {origin or "(직접 붙여넣음)"}

--- 원문 시작 ---
{body}
--- 원문 끝 ---

이 원문을 카드뉴스로 옮기기 위해 정리하세요.

지켜야 할 것
1. **원문에 없는 내용을 지어내지 않습니다.** facts에는 원문에 실제로 적힌 것만 넣습니다.
2. key_points는 플레이북 4항대로 짧은 문장으로 씁니다. 전문용어는 쉬운 말로 풉니다.
3. suggested_topics는 플레이북 2항대로 좁게 잡습니다. 세 주제는 서로 달라야 합니다.
4. cautions에는 이 내용을 카드로 만들 때의 위험(단정·과장·의학적 확언 등)을 적습니다.
5. 원문이 브랜드와 무관해 보여도, 브랜드 타깃에게 어떤 의미인지로 연결해 주제를 뽑습니다.

JSON만 출력하세요."""

    result = _call_json(system, user, SOURCE_SCHEMA)
    result["origin"] = origin
    result["char_count"] = len(text)
    result["truncated"] = truncated
    if truncated:
        result["warning"] = (
            f"원문이 {len(text):,}자여서 앞 {SOURCE_MAX_CHARS:,}자만 요약했습니다. "
            "뒷부분이 중요하면 나눠서 만들어 주세요."
        )
    return result


def _source_block(source: dict | None) -> str:
    """구성 단계에 넘길 원문 근거. 원문 전체가 아니라 정리된 것만 넘긴다."""
    if not source:
        return ""
    facts = "\n".join(f"  - {f['claim']} ({f['detail']})" for f in source.get("facts", []))
    quotes = "\n".join(f"  - {q}" for q in source.get("quotes", []))
    return f"""

=========================
## 원문 근거 (이 범위 안에서만 씁니다)
=========================
제목: {source.get('title', '')} [{source.get('kind', '')}]
출처: {source.get('origin') or '직접 붙여넣음'}

요약:
{source.get('summary', '')}

핵심 포인트:
{chr(10).join('  - ' + p for p in source.get('key_points', []))}

원문에 적힌 사실:
{facts or '  (없음)'}

인용 가능한 문장:
{quotes or '  (없음)'}

주의:
{source.get('cautions', '')}
"""


# ---------------------------------------------------------------- 1단계: 키워드

KEYWORD_SCHEMA = {
    "type": "object",
    "properties": {
        "topic_refined": {"type": "string", "description": "좁혀진 주제 한 문장"},
        "audience": {"type": "string", "description": "이 편이 겨냥하는 사람"},
        "core_keywords": {
            "type": "array",
            "description": "카드뉴스 본문에 실제로 쓸 핵심 키워드 6~10개",
            "items": {"type": "string"},
        },
        "search_keywords": {
            "type": "array",
            "description": "검색·해시태그용 키워드 8~12개",
            "items": {"type": "string"},
        },
        "pain_points": {
            "type": "array",
            "description": "타깃이 실제로 겪는 고민 3~5개",
            "items": {"type": "string"},
        },
        "angles": {
            "type": "array",
            "description": "컨셉 5축 중 서로 다른 축을 쓴 앵글 후보 3개",
            "items": {
                "type": "object",
                "properties": {
                    "concept_axis": {
                        "type": "string",
                        "enum": ["기능", "판매자", "정체성", "상황", "구조"],
                    },
                    "post_format": {
                        "type": "string",
                        "enum": ["일상글", "정보성글", "구매성글", "프로모션글"],
                    },
                    "funnel_stage": {
                        "type": "string",
                        "description": "자동 퍼널 7칸 중 어디인지 (예: 3 배포 콘텐츠)",
                    },
                    "hook": {"type": "string", "description": "커버 후킹 한 줄 (부정어 또는 숫자)"},
                    "one_line": {"type": "string", "description": "이 앵글이 무엇을 말하는지 한 줄"},
                    "why": {"type": "string", "description": "왜 이 축을 골랐는지, 플레이북 근거로"},
                    "cta_keyword": {"type": "string", "description": "댓글 유도 키워드 2~4글자"},
                },
                "required": [
                    "concept_axis",
                    "post_format",
                    "funnel_stage",
                    "hook",
                    "one_line",
                    "why",
                    "cta_keyword",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "topic_refined",
        "audience",
        "core_keywords",
        "search_keywords",
        "pain_points",
        "angles",
    ],
    "additionalProperties": False,
}


def extract_keywords(topic: str, note: str = "", source: dict | None = None) -> dict[str, Any]:
    sources = strategy.gather_sources(topic)
    system = strategy.build_system_prompt(topic, sources)
    grounding = (
        "\n0. 아래 원문 근거 안에서만 사실을 씁니다. 원문에 없는 수치·효능을 지어내지 마세요."
        if source else ""
    )
    user = f"""주제: {topic}

추가 메모: {note or "(없음)"}
{_source_block(source)}
위 주제로 카드뉴스를 만들려 합니다. 다음을 뽑아주세요.
{grounding}
1. 주제를 더 좁힙니다. 플레이북 2항 — 주제는 좁을수록 강합니다.
2. 타깃이 실제로 겪는 고민(pain_points)을 브랜드 정보의 타깃 기준으로 씁니다.
3. 앵글 후보 3개를 만듭니다. **컨셉 축이 서로 달라야 합니다.**
   - 각 앵글의 hook은 플레이북 4항의 하드룰을 지킵니다(부정어 또는 숫자, 한 줄 12자 내외).
   - cta_keyword는 진입장벽이 낮은 짧은 단어여야 합니다.
   - why에는 어떤 근거(플레이북 항목 또는 원문 노트)를 썼는지 한 줄로 적습니다.

JSON만 출력하세요."""
    result = _call_json(system, user, KEYWORD_SCHEMA)
    result["_sources"] = [s["source"] for s in sources]
    return result


# ---------------------------------------------------------------- 2단계: 구성

def _cards_schema(card_count: int) -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "이 카드뉴스 편 제목 (내부 관리용)"},
            "concept_sentence": {
                "type": "string",
                "description": "'나는 [주제]에 진심인 [페르소나]로, [한 단어] 컨셉으로 쓴다' 형식",
            },
            "cards": {
                "type": "array",
                "description": f"정확히 {card_count}장",
                "items": {
                    "type": "object",
                    "properties": {
                        "slug": {"type": "string", "description": "영문 소문자 하이픈 식별자"},
                        "role": {
                            "type": "string",
                            "enum": ["후킹", "문제제기", "해결제안", "상품연결", "CTA"],
                        },
                        "template": {
                            "type": "string",
                            "enum": ["cover", "content", "list", "quote", "final"],
                        },
                        "badge": {"type": "string", "description": "상단 작은 라벨. 없으면 빈 문자열"},
                        "title": {"type": "string", "description": "한 줄 12자 내외, 최대 2줄. 줄바꿈은 \\n"},
                        "subtitle": {"type": "string", "description": "한 줄 20자 내외, 최대 2줄. 없으면 빈 문자열"},
                        "body": {"type": "string", "description": "한 줄 22자 내외, 최대 3줄. 없으면 빈 문자열"},
                        "note": {"type": "string", "description": "작은 보조 문구. 없으면 빈 문자열"},
                        "tip": {"type": "string", "description": "스티커용 2~5글자. 없으면 빈 문자열"},
                        "image_prompt": {
                            "type": "string",
                            "description": "이 카드 배경 이미지를 만들 영문 프롬프트. 브랜드 image_style을 반영하고 텍스트는 넣지 않는다",
                        },
                    },
                    "required": [
                        "slug",
                        "role",
                        "template",
                        "badge",
                        "title",
                        "subtitle",
                        "body",
                        "note",
                        "tip",
                        "image_prompt",
                    ],
                    "additionalProperties": False,
                },
            },
            "caption": {"type": "string", "description": "인스타 캡션 본문. 링크 금지, 짧은 문장 위주"},
            "hashtags": {
                "type": "array",
                "description": "해시태그 12~20개, # 포함",
                "items": {"type": "string"},
            },
            "cta_comment": {"type": "string", "description": "댓글 유도 CTA 한 줄"},
            "next_teaser": {"type": "string", "description": "다음 편 예고 한 줄 (각인의 법칙)"},
            "self_check": {
                "type": "array",
                "description": "플레이북 10항 30초 자가진단 5개 항목 결과",
                "items": {
                    "type": "object",
                    "properties": {
                        "item": {"type": "string"},
                        "pass": {"type": "boolean"},
                        "reason": {"type": "string"},
                    },
                    "required": ["item", "pass", "reason"],
                    "additionalProperties": False,
                },
            },
            "strategy_notes": {
                "type": "string",
                "description": "이 구성이 어떤 전략을 따랐는지 3~5줄. 플레이북 항목 번호를 인용",
            },
        },
        "required": [
            "title",
            "concept_sentence",
            "cards",
            "caption",
            "hashtags",
            "cta_comment",
            "next_teaser",
            "self_check",
            "strategy_notes",
        ],
        "additionalProperties": False,
    }


def compose_cardnews(
    topic: str,
    angle: dict,
    keywords: dict,
    card_count: int = 7,
    note: str = "",
    source: dict | None = None,
) -> dict[str, Any]:
    sources = strategy.gather_sources(topic, extra_terms=keywords.get("core_keywords", [])[:5])
    system = strategy.build_system_prompt(topic, sources)
    grounding = (
        "\n9. **원문 근거에 있는 내용만 사실로 씁니다.** 원문에 없는 수치·효능·사례를 만들지 마세요.\n"
        "   원문의 인용 문장은 그대로 쓰거나 짧게 다듬어 쓸 수 있습니다."
        if source else ""
    )
    user = f"""주제: {keywords.get('topic_refined') or topic}
타깃: {keywords.get('audience', '')}
고민: {', '.join(keywords.get('pain_points', []))}
핵심 키워드: {', '.join(keywords.get('core_keywords', []))}

선택된 앵글
- 컨셉 축: {angle.get('concept_axis')}
- 글 포맷: {angle.get('post_format')}
- 퍼널 단계: {angle.get('funnel_stage')}
- 후킹: {angle.get('hook')}
- 한 줄: {angle.get('one_line')}
- CTA 키워드: {angle.get('cta_keyword')}

추가 요청: {note or "(없음)"}
{_source_block(source)}
이 앵글로 카드뉴스 {card_count}장을 구성하세요.

지켜야 할 것
1. 플레이북 5항의 4단 구조를 {card_count}장에 매핑합니다. role 필드에 각 카드의 역할을 표시합니다.
2. 1번 카드는 template "cover", 마지막 카드는 "final"로 합니다.
3. 카드 텍스트 하드룰(플레이북 4항)을 반드시 지킵니다. 줄바꿈은 \\n 으로 직접 넣어 통제하세요.
4. 상품 연결 카드는 '팔지 말고 사게 한다'(9항). 설득이 아니라 기준을 세워주는 방식으로 씁니다.
5. 마지막 카드에는 CTA와 함께, 건강·행동 주제라면 브랜드 safety 고지를 note에 넣습니다.
6. cta_comment는 키워드 댓글 유도 형태(6항). 링크는 절대 쓰지 않습니다.
7. image_prompt는 영문으로, 브랜드 image_style을 반영하고 image_avoid를 피하며, 이미지 안에 글자가 없도록 명시합니다.
8. self_check는 플레이북 10항의 5개 항목을 그대로 쓰고 각각 판정합니다.
{grounding}
JSON만 출력하세요."""
    return _call_json(system, user, _cards_schema(card_count))


# ---------------------------------------------------------------- 카드 1장 재작성

REWRITE_SCHEMA = {
    "type": "object",
    "properties": {
        "badge": {"type": "string"},
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "body": {"type": "string"},
        "note": {"type": "string"},
        "tip": {"type": "string"},
        "image_prompt": {"type": "string"},
        "why": {"type": "string", "description": "무엇을 어떻게 고쳤는지 한 줄"},
    },
    "required": ["badge", "title", "subtitle", "body", "note", "tip", "image_prompt", "why"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- 이미지 프롬프트

IMAGE_PROMPT_SCHEMA = {
    "type": "object",
    "properties": {
        "image_prompt": {
            "type": "string",
            "description": "영문 이미지 프롬프트. 이 카드의 글이 말하는 장면을 구체적으로 묘사한다",
        },
        "scene_ko": {"type": "string", "description": "어떤 장면인지 한 줄 한국어 설명"},
        "why": {"type": "string", "description": "왜 이 장면이 이 카드 글에 맞는지 한 줄"},
    },
    "required": ["image_prompt", "scene_ko", "why"],
    "additionalProperties": False,
}


def refine_image_prompt(project: dict, card: dict, extra: str = "") -> dict[str, Any]:
    """카드에 지금 적힌 글을 읽고, 그 내용에 가장 맞는 배경 장면을 다시 쓴다."""
    brand = strategy.load_brand().raw
    topic = project.get("topic", "")
    neighbours = [
        f"{c.get('index')}. [{c.get('role', '')}] {(c.get('title') or '').replace(chr(10), ' ')}"
        for c in project.get("cards", [])
    ]

    system = f"""당신은 {brand.get('brand', '')}의 카드뉴스 아트 디렉터입니다.
카드에 적힌 글을 읽고, 그 글이 말하는 장면을 사진으로 옮기는 영문 프롬프트를 씁니다.

규칙
- **글의 내용을 그대로 그립니다.** 예쁜 스톡 사진이 아니라, 그 문장이 묘사하는 상황이어야 합니다.
- 브랜드 비주얼 언어를 지킵니다: {brand.get('image_style_en') or brand.get('image_style', '')}
- 피할 것: {brand.get('image_avoid_en') or brand.get('image_avoid', '')}
- 이미지 안에 글자·숫자·로고·워터마크가 절대 없어야 합니다. 프롬프트에 명시하세요.
- 세로 4:5 구도이며, 카드 글이 올라갈 자리를 비워 둡니다.
- 과장된 표정이나 슬픈 연출을 쓰지 않습니다. 차분한 실내 자연광.
- 출력은 유효한 JSON 하나뿐입니다."""

    user = f"""카드뉴스 주제: {topic}

이 편의 전체 흐름:
{chr(10).join(neighbours)}

지금 만들 카드
- 번호: {card.get('index')}
- 역할: {card.get('role', '')}
- 템플릿: {card.get('template', '')}
- 배지: {card.get('badge', '')}
- 타이틀: {card.get('title', '')}
- 서브: {card.get('subtitle', '')}
- 본문: {card.get('body', '')}
- 노트: {card.get('note', '')}

기존 프롬프트: {card.get('image_prompt', '') or '(없음)'}
추가 요청: {extra or '(없음)'}

이 카드의 글에 가장 맞는 배경 장면을 다시 쓰세요.
글이 '숨는다'고 하면 숨는 장면을, '자리를 옮긴다'고 하면 옮기는 장면을 그립니다.
같은 편의 다른 카드와 장면이 겹치지 않게 하세요.

JSON만 출력하세요."""

    return _call_json(system, user, IMAGE_PROMPT_SCHEMA, effort="medium")


def test_key() -> dict[str, Any]:
    """키가 실제로 통하는지, 지정한 모델을 쓸 수 있는지 확인한다."""
    model = _model()
    client = _client()
    try:
        info = client.models.retrieve(model)
    except anthropic.AuthenticationError as exc:
        raise ClaudeError("API 키가 올바르지 않습니다. 키를 다시 확인하세요.") from exc
    except anthropic.PermissionDeniedError as exc:
        raise ClaudeError("이 키로는 접근할 수 없습니다. 워크스페이스 권한을 확인하세요.") from exc
    except anthropic.NotFoundError as exc:
        raise ClaudeError(f"'{model}' 모델을 찾을 수 없습니다. 모델 이름을 확인하세요.") from exc
    except anthropic.APIStatusError as exc:
        raise ClaudeError(f"Anthropic 오류 ({exc.status_code}): {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise ClaudeError("네트워크 연결에 실패했습니다.") from exc
    return {"ok": True, "model": info.id, "display_name": info.display_name}


def rewrite_card(topic: str, card: dict, instruction: str) -> dict[str, Any]:
    system = strategy.build_system_prompt(topic)
    user = f"""주제: {topic}

현재 카드 (JSON):
{json.dumps(card, ensure_ascii=False, indent=2)}

요청: {instruction}

이 카드 한 장만 다시 씁니다. 카드 텍스트 하드룰(플레이북 4항)을 지키고,
비워야 하는 필드는 빈 문자열로 둡니다. JSON만 출력하세요."""
    return _call_json(system, user, REWRITE_SCHEMA, effort="medium")
