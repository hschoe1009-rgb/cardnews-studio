"""카드뉴스 스튜디오 — 로컬 웹앱."""
from __future__ import annotations

import base64
import io
import urllib.parse
import zipfile
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import claude_client, config, database, image_client, render, store, strategy

BASE = Path(__file__).resolve().parent

app = FastAPI(title="카드뉴스 스튜디오")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")

config.ensure_dirs()


@app.middleware("http")
async def capture_user_keys(request: Request, call_next):
    """사용자마다 자기 브라우저에 저장한 키를 헤더로 보낸다.

    이 요청 동안에만 유효하고 서버에는 저장되지 않으므로,
    여러 사람이 같은 서버를 써도 서로의 키가 섞이지 않는다.
    """
    config.set_request_keys({
        "ANTHROPIC_API_KEY": request.headers.get("x-anthropic-key", ""),
        "OPENAI_API_KEY": request.headers.get("x-openai-key", ""),
    })
    return await call_next(request)


def _page(name: str) -> HTMLResponse:
    return HTMLResponse((BASE / "templates" / name).read_text(encoding="utf-8"))


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return _page("index.html")


@app.get("/render", response_class=HTMLResponse)
def render_page() -> HTMLResponse:
    return _page("render.html")


@app.get("/cardnews-studio", response_class=HTMLResponse)
def landing() -> HTMLResponse:
    """제품 소개 랜딩페이지. 앱 화면(/)과 분리해 두어 서로 영향을 주지 않는다."""
    return _page("landing.html")


# ---------------------------------------------------------------- 설정

@app.get("/api/settings")
def get_settings() -> dict:
    settings = config.load_settings()
    sources = config.key_sources()
    return {
        "claude_model": settings.get("CLAUDE_MODEL", ""),
        # 글쓰기를 지금 누가 하는지 (anthropic / openai / none)
        "text_provider_pref": settings.get("TEXT_PROVIDER", "auto"),
        "text_provider": claude_client.provider(),
        "text_model": claude_client.active_text_model()[1],
        "openai_text_model": settings.get("OPENAI_TEXT_MODEL", ""),
        "openai_text_effort": settings.get("OPENAI_TEXT_EFFORT", "medium"),
        "image_model": settings.get("IMAGE_MODEL", ""),
        "image_size": settings.get("IMAGE_SIZE", "1024x1536"),
        "image_mode": settings.get("IMAGE_MODE", "api"),
        "require_user_key": str(settings.get("REQUIRE_USER_KEY", "")).lower() == "true",
        "has_anthropic_key": bool(settings.get("ANTHROPIC_API_KEY", "").strip()),
        "has_openai_key": bool(settings.get("OPENAI_API_KEY", "").strip()),
        # 어떤 키가 실제로 쓰이는지 (app=직접 입력 / env=PC 환경변수 / none=없음)
        "anthropic_source": sources["ANTHROPIC_API_KEY"],
        "openai_source": sources["OPENAI_API_KEY"],
        "anthropic_tail": config.key_tail(settings.get("ANTHROPIC_API_KEY", "")),
        "openai_tail": config.key_tail(settings.get("OPENAI_API_KEY", "")),
        "strategy_dirs": [str(p) for p in config.strategy_dirs()],
        "strategy_dirs_exist": [p.exists() for p in config.strategy_dirs()],
        "db_path": str(config.DB_PATH),
    }


@app.post("/api/settings")
def post_settings(payload: dict = Body(...)) -> dict:
    updates: dict[str, str] = {}
    for key in ("CLAUDE_MODEL", "IMAGE_MODEL", "IMAGE_SIZE", "IMAGE_MODE", "REQUIRE_USER_KEY",
                "TEXT_PROVIDER", "OPENAI_TEXT_MODEL", "OPENAI_TEXT_EFFORT"):
        value = payload.get(key)
        if value:
            updates[key] = value
    # API 키는 기본적으로 서버에 저장하지 않는다. 각 사용자의 브라우저에만 둔다.
    # share_keys=true 일 때만 이 PC의 공용 .env 에 쓴다(혼자 쓰는 PC용).
    if payload.get("share_keys"):
        for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
            value = payload.get(key)
            if value:
                updates[key] = value
    if payload.get("OBSIDIAN_STRATEGY_DIRS") is not None:
        import json

        updates["OBSIDIAN_STRATEGY_DIRS"] = json.dumps(
            payload["OBSIDIAN_STRATEGY_DIRS"], ensure_ascii=False
        )
    config.save_settings(updates)
    return get_settings()


@app.post("/api/test-key")
def api_test_key(payload: dict = Body(...)) -> dict:
    provider = payload.get("provider")
    try:
        if provider == "anthropic":
            return claude_client.test_key()
        if provider == "openai":
            return image_client.test_key()
    except (claude_client.ClaudeError, image_client.ImageError) as exc:
        raise HTTPException(400, str(exc)) from exc
    raise HTTPException(400, "provider는 anthropic 또는 openai 여야 합니다.")


@app.get("/api/brand")
def get_brand() -> dict:
    brand = strategy.load_brand()
    return {"brand": brand.raw, "theme_keys": brand.theme_keys()}


# ---------------------------------------------------------------- 0단계: 원문

@app.post("/api/summarize")
def api_summarize(payload: dict = Body(...)) -> dict:
    text = payload.get("text") or ""
    try:
        return claude_client.summarize_source(text, payload.get("origin", ""))
    except claude_client.ClaudeError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---------------------------------------------------------------- 1단계·2단계

@app.post("/api/keywords")
def api_keywords(payload: dict = Body(...)) -> dict:
    topic = (payload.get("topic") or "").strip()
    if not topic:
        raise HTTPException(400, "주제를 입력하세요.")
    try:
        return claude_client.extract_keywords(
            topic, payload.get("note", ""), payload.get("source")
        )
    except claude_client.ClaudeError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/compose")
def api_compose(payload: dict = Body(...)) -> dict:
    topic = (payload.get("topic") or "").strip()
    angle = payload.get("angle") or {}
    keywords = payload.get("keywords") or {}
    if not topic or not angle:
        raise HTTPException(400, "주제와 앵글이 필요합니다.")
    count = int(payload.get("card_count") or 7)
    if not 3 <= count <= 10:
        raise HTTPException(400, "카드 수는 3~10장 사이여야 합니다.")
    source = payload.get("source")
    try:
        composition = claude_client.compose_cardnews(
            topic, angle, keywords, count, payload.get("note", ""), source
        )
    except claude_client.ClaudeError as exc:
        raise HTTPException(400, str(exc)) from exc
    project = store.build_project(
        topic, keywords, angle, composition, payload.get("theme", "navy"), source
    )
    store.save(project)
    return project


# ---------------------------------------------------------------- 프로젝트

@app.get("/api/projects")
def api_projects() -> list[dict[str, Any]]:
    return store.list_projects()


@app.get("/api/projects/{project_id}")
def api_project(project_id: str) -> dict:
    try:
        return store.load(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.put("/api/projects/{project_id}")
def api_save_project(project_id: str, payload: dict = Body(...)) -> dict:
    if payload.get("id") != project_id:
        raise HTTPException(400, "프로젝트 ID가 일치하지 않습니다.")
    store.save(payload)
    database.upsert(payload)
    return {"ok": True, "updated": payload["updated"], "db": str(config.DB_PATH)}


@app.delete("/api/projects/{project_id}")
def api_delete_project(project_id: str) -> dict:
    store.delete(project_id)
    database.remove(project_id)
    return {"ok": True}


@app.post("/api/projects/{project_id}/cards/{index}/rewrite")
def api_rewrite(project_id: str, index: int, payload: dict = Body(...)) -> dict:
    project = store.load(project_id)
    cards = project.get("cards", [])
    if not 1 <= index <= len(cards):
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    try:
        result = claude_client.rewrite_card(
            project.get("topic", ""), cards[index - 1], payload.get("instruction", "")
        )
    except claude_client.ClaudeError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


# ---------------------------------------------------------------- 이미지

@app.post("/api/projects/{project_id}/cards/{index}/image")
def api_generate_image(project_id: str, index: int, payload: dict = Body(...)) -> dict:
    project = store.load(project_id)
    cards = project.get("cards", [])
    if not 1 <= index <= len(cards):
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    card = cards[index - 1]
    out = store.project_dir(project_id) / "assets" / f"card-{index:02d}.png"
    try:
        image_client.generate(card, out, payload.get("extra", ""))
    except image_client.ImageError as exc:
        raise HTTPException(400, str(exc)) from exc
    url = f"/api/projects/{project_id}/assets/card-{index:02d}.png"
    card["image"] = url
    store.save(project)
    return {"image": url}


@app.post("/api/projects/{project_id}/cards/{index}/upload")
def api_upload_image(project_id: str, index: int, payload: dict = Body(...)) -> dict:
    """ChatGPT 등에서 만든 이미지를 data URL로 받아 저장한다."""
    project = store.load(project_id)
    cards = project.get("cards", [])
    if not 1 <= index <= len(cards):
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    data_url = payload.get("data_url", "")
    if "," not in data_url or not data_url.startswith("data:image/"):
        raise HTTPException(400, "이미지 파일이 아닙니다.")
    header, _, encoded = data_url.partition(",")
    ext = "png"
    if "jpeg" in header or "jpg" in header:
        ext = "jpg"
    elif "webp" in header:
        ext = "webp"
    try:
        blob = base64.b64decode(encoded)
    except Exception as exc:
        raise HTTPException(400, "이미지 디코딩에 실패했습니다.") from exc
    name = f"card-{index:02d}.{ext}"
    out = store.project_dir(project_id) / "assets" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    url = f"/api/projects/{project_id}/assets/{name}"
    cards[index - 1]["image"] = url
    store.save(project)
    return {"image": url}


@app.get("/api/projects/{project_id}/image-prompt/{index}")
def api_image_prompt(project_id: str, index: int, extra: str = "") -> dict:
    project = store.load(project_id)
    cards = project.get("cards", [])
    if not 1 <= index <= len(cards):
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    return {"prompt": image_client.build_prompt(cards[index - 1], extra)}


@app.post("/api/projects/{project_id}/cards/{index}/refine-prompt")
def api_refine_prompt(project_id: str, index: int, payload: dict = Body(default={})) -> dict:
    """카드에 지금 적힌 글을 읽고 배경 장면을 다시 쓴다."""
    project = store.load(project_id)
    cards = project.get("cards", [])
    if not 1 <= index <= len(cards):
        raise HTTPException(404, "카드를 찾을 수 없습니다.")
    card = cards[index - 1]
    # 편집 중인 내용이 넘어오면 그것을 기준으로 삼는다
    for key in ("badge", "title", "subtitle", "body", "note", "role", "template"):
        if key in payload:
            card[key] = payload[key]
    try:
        result = claude_client.refine_image_prompt(project, card, payload.get("extra", ""))
    except claude_client.ClaudeError as exc:
        raise HTTPException(400, str(exc)) from exc
    card["image_prompt"] = result["image_prompt"]
    store.save(project)
    return result


@app.get("/api/image-models")
def api_image_models() -> dict:
    try:
        return {"models": image_client.list_image_models()}
    except image_client.ImageError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{project_id}/assets/{name}")
def api_asset(project_id: str, name: str) -> FileResponse:
    path = store.project_dir(project_id) / "assets" / Path(name).name
    if not path.exists():
        raise HTTPException(404, "이미지를 찾을 수 없습니다.")
    return FileResponse(path)


# ---------------------------------------------------------------- 내보내기

@app.post("/api/projects/{project_id}/export")
def api_export(project_id: str, request: Request, payload: dict = Body(default={})) -> dict:
    project = store.load(project_id)
    total = len(project.get("cards", []))
    indexes = payload.get("indexes") or list(range(1, total + 1))
    base_url = str(request.base_url).rstrip("/")
    try:
        files = render.export_cards(base_url, project_id, indexes)
    except render.RenderError as exc:
        raise HTTPException(500, str(exc)) from exc
    project["status"] = "내보냄"
    store.save(project)
    database.upsert(project)
    return {
        "files": [f.name for f in files],
        "folder": str(store.project_dir(project_id) / "cards"),
        "db": str(config.DB_PATH),
    }


@app.get("/api/projects/{project_id}/download")
def api_download(project_id: str) -> StreamingResponse:
    folder = store.project_dir(project_id) / "cards"
    files = sorted(folder.glob("card-*.png")) if folder.exists() else []
    if not files:
        raise HTTPException(404, "먼저 PNG로 내보내세요.")
    project = store.load(project_id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.name)
        caption = "\n".join(
            [
                project.get("caption", ""),
                "",
                project.get("cta_comment", ""),
                "",
                " ".join(project.get("hashtags", [])),
            ]
        )
        archive.writestr("caption.txt", caption)
    buffer.seek(0)
    # 프로젝트 ID에 한글이 들어가므로 RFC 5987 형식으로 파일명을 넘긴다
    quoted = urllib.parse.quote(f"{project_id}.zip")
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=cardnews.zip; filename*=UTF-8''{quoted}"
        },
    )


@app.get("/api/db")
def api_db() -> FileResponse:
    if not config.DB_PATH.exists():
        raise HTTPException(404, "아직 저장된 데이터가 없습니다.")
    return FileResponse(config.DB_PATH, filename=config.DB_PATH.name)


@app.exception_handler(FileNotFoundError)
def not_found_handler(request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=404)
