"""카드 배경 이미지 생성.

두 가지 모드
  api    : OpenAI 이미지 모델로 직접 생성 (기본 gpt-image-2)
  manual : 프롬프트만 만들어 주고, 사용자가 ChatGPT에서 만든 파일을 넣는다

프롬프트는 카드에 실제로 적힌 글을 읽고 만듭니다. 배경이 문구와 따로 놀지 않도록,
카드 역할(후킹/문제/해결/상품/CTA)과 템플릿에 따라 여백 위치까지 지정합니다.
"""
from __future__ import annotations

import base64
from pathlib import Path

from . import config, strategy

# 인스타 4:5 세로에 가장 가까운 지원 크기
DEFAULT_SIZE = "1024x1536"

# 카드 역할별 화면 분위기. 글의 내용과 이미지가 같은 이야기를 하도록.
ROLE_MOOD = {
    "후킹": "A quiet, slightly tense everyday moment that makes the viewer stop and look. "
            "Understated, not dramatic.",
    "문제제기": "A scene that quietly shows the problem the text describes. "
               "Empathetic and calm, never distressing or pitiful.",
    "해결제안": "A calm, reassuring scene showing the situation improving. Soft and hopeful.",
    "상품연결": "A close, tactile product-in-use scene. Focus on material and texture, "
               "photographed like an honest lifestyle shot rather than an advertisement.",
    "CTA": "A warm, settled closing scene. Peaceful and inviting.",
}

# 템플릿별 여백 — 글자가 올라갈 자리를 비워둔다.
TEMPLATE_COMPOSITION = {
    "cover": "Leave the upper 45% of the frame visually calm and uncluttered "
             "(plain wall, sky, or soft shadow) so large headline text can sit there. "
             "Place the subject in the lower half.",
    "content": "Leave the top third and the bottom third relatively empty and low-contrast "
               "so text can sit above and below. Place the subject in the middle band.",
    "list": "Keep the right half calm and simple so a list of text can sit there. "
            "Place the subject on the left.",
    "quote": "Keep the centre of the frame calm and softly lit so a quote can sit over it. "
             "Keep the subject small and off to one side.",
    "final": "Leave the upper third calm for a closing headline and keep the lower area soft. "
             "Place the subject centrally but small.",
}


class ImageError(RuntimeError):
    pass


def _clean(text: str) -> str:
    return " ".join(str(text or "").replace("\n", " ").split())


def card_text_summary(card: dict) -> str:
    """카드에 실제로 찍히는 글. 배경이 이 내용을 따라가도록 프롬프트에 넣는다."""
    parts = [
        _clean(card.get("title")),
        _clean(card.get("subtitle")),
        _clean(card.get("body")),
        _clean(card.get("note")),
    ]
    return " / ".join(p for p in parts if p)


def build_prompt(card: dict, extra: str = "") -> str:
    """카드 글 + 역할 + 브랜드 비주얼 언어 → 최종 이미지 프롬프트."""
    brand = strategy.load_brand().raw
    role = card.get("role", "")
    template = card.get("template", "content")

    lines: list[str] = []

    base = _clean(card.get("image_prompt"))
    lines.append(
        base or "A calm, softly lit urban interior with a pet resting comfortably."
    )

    said = card_text_summary(card)
    if said:
        lines.append(
            f'This image is the background for a card that reads: "{said}". '
            "The scene must match that message: show the situation the words describe, "
            "not a generic stock photo."
        )

    if extra.strip():
        lines.append(f"Also include: {extra.strip()}")

    if role in ROLE_MOOD:
        lines.append(f"Mood: {ROLE_MOOD[role]}")

    lines.append(f"Composition: {TEMPLATE_COMPOSITION.get(template, TEMPLATE_COMPOSITION['content'])}")
    # 이미지 모델은 영어 지시를 훨씬 잘 따른다. 영문판이 있으면 그것을 쓴다.
    lines.append(f"Style: {brand.get('image_style_en') or brand.get('image_style', '')}")
    lines.append(f"Avoid: {brand.get('image_avoid_en') or brand.get('image_avoid', '')}")
    lines.append(
        "Photorealistic. Vertical 4:5 framing. Shallow depth of field. "
        "Absolutely no text, letters, numbers, captions, logos, or watermarks anywhere in the image."
    )
    return "\n".join(line for line in lines if line.strip().rstrip(":"))


# ---------------------------------------------------------------- OpenAI

def _client(settings: dict):
    key = settings.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise ImageError(
            "OPENAI_API_KEY가 없습니다. 설정 탭에서 입력하거나, "
            "'프롬프트 복사'로 ChatGPT에서 만들어 끌어놓으세요."
        )
    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover
        raise ImageError("openai 패키지가 설치되어 있지 않습니다. pip install openai") from exc
    return OpenAI(api_key=key)


def _wrap_openai_errors(exc) -> ImageError:
    import openai as openai_pkg

    if isinstance(exc, openai_pkg.AuthenticationError):
        return ImageError("API 키가 올바르지 않습니다. 키를 다시 확인하세요.")
    if isinstance(exc, openai_pkg.PermissionDeniedError):
        return ImageError(
            "이 키로는 이미지 생성 권한이 없습니다. "
            "OpenAI 계정의 조직 인증(Verify Organization)을 확인하세요."
        )
    if isinstance(exc, openai_pkg.NotFoundError):
        return ImageError("모델을 찾을 수 없습니다. 설정에서 '사용 가능한 모델 보기'로 확인하세요.")
    if isinstance(exc, openai_pkg.RateLimitError):
        return ImageError("OpenAI 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.")
    if isinstance(exc, openai_pkg.BadRequestError):
        return ImageError(f"요청이 거부되었습니다: {exc.message}")
    if isinstance(exc, openai_pkg.APIStatusError):
        return ImageError(f"OpenAI 오류 ({exc.status_code}): {exc.message}")
    if isinstance(exc, openai_pkg.APIConnectionError):
        return ImageError("OpenAI 연결에 실패했습니다.")
    return ImageError(f"알 수 없는 오류: {exc}")


def list_image_models() -> list[str]:
    """이 키로 실제 쓸 수 있는 이미지 모델 목록. 모델 이름을 추측하지 않기 위해."""
    import openai as openai_pkg

    client = _client(config.load_settings())
    try:
        names = sorted(m.id for m in client.models.list())
    except openai_pkg.OpenAIError as exc:
        raise _wrap_openai_errors(exc) from exc
    picked = [n for n in names if "image" in n or n.startswith("dall-e")]
    return picked or names


def test_key() -> dict:
    """키가 통하는지, 지정한 이미지 모델을 쓸 수 있는지 확인한다."""
    settings = config.load_settings()
    model = settings.get("IMAGE_MODEL", "gpt-image-2")
    available = list_image_models()
    if model not in available:
        raise ImageError(
            f"키는 정상이지만 '{model}' 을(를) 쓸 수 없습니다.\n"
            f"이 키로 가능한 이미지 모델: {', '.join(available[:8]) or '없음'}\n"
            "설정에서 모델 이름을 바꾸거나, OpenAI 계정의 조직 인증을 확인하세요."
        )
    return {"ok": True, "model": model, "available": available}


def generate(card: dict, out_path: Path, extra: str = "") -> Path:
    """OpenAI 이미지 API로 생성해 out_path에 저장."""
    import openai as openai_pkg

    settings = config.load_settings()
    if settings.get("IMAGE_MODE", "api") == "manual":
        raise ImageError(
            "지금은 '프롬프트만 (수동)' 모드입니다. '프롬프트 복사'를 눌러 ChatGPT에서 만든 뒤 "
            "이미지를 끌어놓으세요. 자동 생성을 쓰려면 설정에서 방식을 바꾸세요."
        )

    client = _client(settings)
    model = settings.get("IMAGE_MODEL", "gpt-image-2")
    size = settings.get("IMAGE_SIZE", DEFAULT_SIZE)
    prompt = build_prompt(card, extra)

    try:
        result = client.images.generate(model=model, prompt=prompt, size=size, n=1)
    except openai_pkg.BadRequestError as exc:
        # 모델마다 지원 크기가 다르다. 크기 문제면 자동 크기로 한 번 더 시도한다.
        if "size" in str(exc).lower():
            try:
                result = client.images.generate(model=model, prompt=prompt, size="auto", n=1)
            except openai_pkg.OpenAIError as retry_exc:
                raise _wrap_openai_errors(retry_exc) from retry_exc
        else:
            raise _wrap_openai_errors(exc) from exc
    except openai_pkg.OpenAIError as exc:
        raise _wrap_openai_errors(exc) from exc

    if not result.data:
        raise ImageError("이미지 응답이 비어 있습니다.")
    data = result.data[0]
    if getattr(data, "b64_json", None):
        payload = base64.b64decode(data.b64_json)
    elif getattr(data, "url", None):
        import urllib.request

        with urllib.request.urlopen(data.url, timeout=120) as resp:
            payload = resp.read()
    else:
        raise ImageError("이미지 응답에 데이터가 없습니다.")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(payload)
    return out_path
