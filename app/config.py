"""설정 로드 / 저장. API 키는 프로젝트 루트의 .env 에 보관합니다."""
from __future__ import annotations

import contextvars
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
KNOWLEDGE_DIR = ROOT / "knowledge"
DATA_DIR = ROOT / "data"
PROJECTS_DIR = DATA_DIR / "projects"
DB_PATH = DATA_DIR / "cardnews_db.xlsx"

DEFAULT_SETTINGS = {
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
    "CLAUDE_MODEL": "claude-opus-5",
    "IMAGE_MODEL": "gpt-image-2",
    "IMAGE_SIZE": "1024x1536",
    "IMAGE_MODE": "api",  # "api" | "manual"
    # true 면 공용 .env / OS 환경변수 키를 무시하고, 각 사용자가 본인 키를 넣어야만 동작
    "REQUIRE_USER_KEY": "false",
    # 전략 근거로 함께 읽을 노트 폴더 (읽기 전용). 설정 화면에서 각자 지정한다.
    # 개인 경로라 기본값은 비워 둔다. 비어 있으면 playbook.md 만 근거로 쓴다.
    "OBSIDIAN_STRATEGY_DIRS": "[]",
}


def _parse_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


KEY_FIELDS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")

# 요청 하나 동안만 사는 키. 사용자마다 자기 브라우저의 키를 헤더로 보내면
# 여기에 담기고, 그 요청에서만 쓰입니다. 서버에 저장되지 않습니다.
_request_keys: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "request_keys", default={}
)


def set_request_keys(keys: dict[str, str]) -> None:
    _request_keys.set({k: (v or "").strip() for k, v in keys.items()})


def _request_key(name: str) -> str:
    return (_request_keys.get() or {}).get(name, "")


def _file_settings() -> dict[str, str]:
    settings = dict(DEFAULT_SETTINGS)
    if ENV_PATH.exists():
        settings.update(_parse_env(ENV_PATH.read_text(encoding="utf-8")))
    return settings


def load_settings() -> dict[str, str]:
    """키 우선순위: 사용자 본인 키(브라우저) > 이 PC의 .env > OS 환경변수.

    사용자마다 각자 키를 넣어 쓰기 때문에, 본인이 보낸 키가 항상 이깁니다.
    .env 와 환경변수는 혼자 쓸 때를 위한 대체 수단입니다.
    """
    settings = _file_settings()
    strict = str(settings.get("REQUIRE_USER_KEY", "")).lower() == "true"
    for key in KEY_FIELDS:
        mine = _request_key(key)
        if mine:
            settings[key] = mine
        elif strict:
            settings[key] = ""      # 공용 키로 대신 쓰지 않는다
        elif not settings.get(key, "").strip() and os.environ.get(key):
            settings[key] = os.environ[key]
    return settings


def key_sources() -> dict[str, str]:
    """각 키가 어디서 온 것인지. 어떤 키가 쓰이는지 화면에서 보이게 하려고."""
    stored = _file_settings()
    out: dict[str, str] = {}
    for key in KEY_FIELDS:
        if _request_key(key):
            out[key] = "user"       # 이 사용자가 자기 브라우저에 넣은 키
        elif str(stored.get("REQUIRE_USER_KEY", "")).lower() == "true":
            out[key] = "none"       # 각자 입력 강제 모드
        elif stored.get(key, "").strip():
            out[key] = "shared"     # 이 PC의 .env (공용)
        elif os.environ.get(key):
            out[key] = "env"        # OS 환경변수
        else:
            out[key] = "none"
    return out


def key_tail(value: str) -> str:
    """키를 노출하지 않고 구분만 되게. 예: sk-ant-…와 sk-ant-…의 구분."""
    value = (value or "").strip()
    return f"…{value[-4:]}" if len(value) >= 4 else ""


def save_settings(updates: dict[str, str]) -> dict[str, str]:
    settings = dict(DEFAULT_SETTINGS)
    if ENV_PATH.exists():
        settings.update(_parse_env(ENV_PATH.read_text(encoding="utf-8")))
    for key, val in updates.items():
        if val is not None:
            settings[key] = str(val)
    lines = ["# 카드뉴스 스튜디오 설정 — 이 파일은 커밋하지 마세요", ""]
    for key, val in settings.items():
        lines.append(f"{key}={val}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return settings


def strategy_dirs() -> list[Path]:
    raw = load_settings().get("OBSIDIAN_STRATEGY_DIRS", "[]")
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        items = [p.strip() for p in raw.split(";") if p.strip()]
    return [Path(p) for p in items]


def ensure_dirs() -> None:
    for path in (DATA_DIR, PROJECTS_DIR, KNOWLEDGE_DIR):
        path.mkdir(parents=True, exist_ok=True)
