"""가이드북에 쓸 실제 화면을 캡처한다.

두 가지를 지킨다.
  1) 비용 0원 — Anthropic·OpenAI 호출을 가로채 미리 준비한 응답으로 답한다.
     화면은 진짜 앱이 진짜로 그린 것이고, 오간 것은 가짜 응답뿐이다.
  2) 키 노출 0 — 캡처에는 sk-ant-…예시 같은 가짜 키만 들어간다.
     실제 .env 의 키는 이 스크립트가 아예 읽지 않는다.

사용법:
    python tools/build_webapp.py      # site/app/ 이 먼저 있어야 한다
    python tools/capture_guide.py
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "app" / "static" / "landing" / "guide"
PORT = 8861
BASE = f"http://127.0.0.1:{PORT}"

# 화면에 보일 가짜 키. 진짜처럼 생겼지만 어디에도 통하지 않는다.
# HTTP 헤더는 ISO-8859-1 만 실을 수 있어 한글을 넣으면 fetch 가 먼저 터진다.
FAKE_ANTH = "sk-ant-api03-EXAMPLE-0000-this-is-a-sample-key-for-the-guide-only"
FAKE_OAI = "sk-proj-EXAMPLE0000-this-is-a-sample-key-for-the-guide-only"

TOPIC = "고양이가 창가에만 앉아 있는 이유"

NL = chr(10)


# ─────────────────────────────────────────── 가짜 응답들
def anthropic_reply(payload: dict) -> dict:
    """스키마를 보고 어떤 요청인지 알아내 알맞은 가짜 결과를 만든다."""
    schema = payload.get("output_config", {}).get("format", {}).get("schema", {})
    props = set(schema.get("properties", {}))

    if "angles" in props:
        body = {
            "topic_refined": "창가를 고르는 진짜 이유",
            "audience": "1인 가구 집사",
            "core_keywords": ["창가", "체온", "관찰", "습관", "겨울"],
            "search_keywords": ["고양이 창가", "고양이 체온", "고양이 자리"],
            "pain_points": ["혼자 두고 나가는 게 마음에 걸린다",
                            "어디가 아픈 건지 구분이 안 된다"],
            "angles": [
                {"concept_axis": "상황", "post_format": "정보성글", "funnel_stage": "3 배포",
                 "hook": "창가, 사실은" + NL + "다른 이유였어요",
                 "one_line": "햇빛이 아니라 체온을 지키려는 자리 고르기입니다.",
                 "why": "통념을 첫 장에서 부정해 멈추게 합니다.",
                 "cta_keyword": "창가"},
                {"concept_axis": "일상", "post_format": "일상글", "funnel_stage": "2 관심",
                 "hook": "야근하는 날," + NL + "우리 냥이는요",
                 "one_line": "혼자 있는 시간에 창가를 고르는 이유를 함께 봅니다.",
                 "why": "1인 가구 집사가 자기 상황으로 바로 읽습니다.",
                 "cta_keyword": "야근"},
                {"concept_axis": "관찰", "post_format": "정보성글", "funnel_stage": "3 배포",
                 "hook": "오늘도 창가에" + NL + "앉아있길래",
                 "one_line": "관찰 기록으로 바꾸면 이상 신호가 보입니다.",
                 "why": "행동을 기록으로 바꾸자는 제안이라 저장률이 높습니다.",
                 "cta_keyword": "관찰"},
            ],
        }
    elif "cards" in props:
        def card(slug, role, tpl, badge, title, sub, bd, note, tip, prompt):
            return {"slug": slug, "role": role, "template": tpl, "badge": badge,
                    "title": title, "subtitle": sub, "body": bd, "note": note,
                    "tip": tip, "image_prompt": prompt}
        body = {
            "title": "창가의 이유",
            "concept_sentence": "나는 창가에 진심인 집사다",
            "cards": [
                card("hook", "후킹", "cover", "창가의 이유",
                     "창가에만" + NL + "앉는 이유", "그냥 햇빛 때문이 아닙니다",
                     "오늘 저녁 확인해 보세요", "", "",
                     "warm sunlight through a window, soft cushion, calm interior"),
                card("why", "문제제기", "content", "",
                     "체온을 지키는" + NL + "가장 쉬운 자리", "고양이 평열은 사람보다 높아요",
                     "따뜻한 곳을 찾는 건" + NL + "본능에 가깝습니다",
                     "며칠 이어지면 살펴보세요", "체온" + NL + "확인!",
                     "soft window light on a wooden floor, quiet room"),
                card("view", "해결제안", "content", "",
                     "창가는" + NL + "관찰하기도 좋습니다", "바깥이 보이는 자리를 고릅니다",
                     "높이와 시야가" + NL + "함께 맞는 곳입니다", "", "",
                     "cat height view of a window sill, afternoon light"),
                card("seat", "상품연결", "content", "",
                     "자리를 하나" + NL + "만들어 주세요", "익숙한 냄새가 있으면 더 좋아요",
                     "쿠션 하나면" + NL + "충분합니다", "", "",
                     "cushion by a sunny window, cozy interior"),
                card("cta", "CTA", "final", "",
                     "오늘 창가를" + NL + "한 번 봐 주세요", "어디에 앉는지 기록해 두면 좋습니다",
                     "댓글에 창가 라고 남겨주세요",
                     "행동 변화가 계속되면 전문가와 상담하세요", "",
                     "evening window, calm and warm"),
            ],
            "caption": "창가에 앉는 데는 이유가 있습니다." + NL + NL + "햇빛만은 아니에요.",
            "hashtags": ["#고양이", "#집사", "#창가", "#반려묘"],
            "cta_comment": "댓글에 창가 라고 남겨주세요.",
            "next_teaser": "다음 편 — 겨울철 자리",
            "self_check": [
                {"item": "첫 장에서 멈추는가?", "pass": True, "reason": "통념을 부정합니다"},
                {"item": "댓글을 달 이유가 있는가?", "pass": True, "reason": "키워드 CTA"},
            ],
            "strategy_notes": "상황 컨셉 + 정보성글 + 배포 단계",
        }
    else:                                   # 그 밖(문장 다듬기 등)
        body = {k: "" for k in props} or {"text": ""}

    return {"content": [{"type": "text", "text": json.dumps(body, ensure_ascii=False)}],
            "stop_reason": "end_turn"}


def sample_png() -> str:
    """배경 이미지 자리에 넣을 그럴듯한 그림 (파이썬으로 직접 그린다)."""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = 1024, 1536
    im = Image.new("RGB", (w, h), "#6b6153")
    d = ImageDraw.Draw(im)
    for y in range(h):                       # 위에서 아래로 따뜻한 그라데이션
        t = y / h
        d.line([(0, y), (w, y)],
               fill=(int(196 - 120 * t), int(170 - 108 * t), int(132 - 88 * t)))
    d.polygon([(120, 0), (560, 0), (700, 620), (240, 700)], fill=(255, 236, 190))
    d.polygon([(600, 0), (760, 0), (900, 520), (740, 560)], fill=(255, 228, 176))
    im = im.filter(ImageFilter.GaussianBlur(26))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 1180, w, h], fill=(58, 50, 42))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ─────────────────────────────────────────── 정적 서버
def serve() -> ThreadingHTTPServer:
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/app/", timeout=1).read()
            return srv
        except Exception:
            time.sleep(0.2)
    raise SystemExit("정적 서버가 뜨지 않았습니다.")


async def main() -> None:
    from playwright.async_api import async_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    img_b64 = sample_png()
    srv = serve()
    shots: list[str] = []

    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context(viewport={"width": 1440, "height": 900},
                                   device_scale_factor=2)
        pg = await ctx.new_page()
        errs: list[str] = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        # ── 바깥으로 나가는 요청을 전부 가로챈다 (여기서 비용이 0원이 된다)
        async def anth_models(route):
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"id": "claude-sonnet-5",
                                                 "display_name": "Claude Sonnet 5"}))

        async def anth_messages(route):
            payload = json.loads(route.request.post_data or "{}")
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps(anthropic_reply(payload), ensure_ascii=False))

        async def oai_models(route):
            ids = ["gpt-image-1", "gpt-image-2", "gpt-5.6-terra"]
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"data": [{"id": i} for i in ids]}))

        async def oai_images(route):
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps({"data": [{"b64_json": img_b64}]}))

        await pg.route("**/api.anthropic.com/v1/models/**", anth_models)
        await pg.route("**/api.anthropic.com/v1/messages", anth_messages)
        await pg.route("**/api.openai.com/v1/models", oai_models)
        await pg.route("**/api.openai.com/v1/images/**", oai_images)
        await pg.route("**/api.openai.com/v1/responses", anth_messages)

        async def shot(name: str, note: str = "") -> None:
            await pg.wait_for_timeout(450)
            await pg.screenshot(path=str(OUT / f"{name}.png"))
            shots.append(name)
            print(f"  {name}  {note}")

        await pg.goto(BASE + "/app/", wait_until="networkidle")
        await pg.wait_for_timeout(900)

        # ── 1. 설정 탭에서 키 넣기
        await pg.click('.tab[data-view="settings"]')
        await pg.wait_for_timeout(500)
        await shot("01-settings", "설정 탭을 연다")

        await pg.fill("#s-anthropic", FAKE_ANTH)
        await pg.fill("#s-openai", FAKE_OAI)
        await shot("02-keys", "본인 키를 붙여넣는다")

        await pg.click("#btn-save-settings")
        await pg.wait_for_timeout(900)
        await pg.click("#btn-test-anthropic")
        await pg.wait_for_timeout(900)
        await shot("03-test", "연결 테스트")

        # ── 2. 주제 → 전략
        await pg.click('.tab[data-view="create"]')
        await pg.wait_for_timeout(400)
        await pg.fill("#topic", TOPIC)
        await shot("04-topic", "주제 입력")

        await pg.click("#btn-keywords")
        await pg.wait_for_selector(".angle", timeout=30000)
        await pg.wait_for_timeout(600)
        await shot("05-strategy", "전략 3안")

        await pg.click(".angle")
        await pg.wait_for_timeout(400)
        await shot("06-angle", "하나 고른다")

        # ── 3. 카드 구성 → 편집기
        await pg.click("#btn-compose")
        await pg.wait_for_selector("#stage .layer", timeout=60000)
        await pg.wait_for_timeout(1200)
        await shot("07-editor", "카드 구성 결과")

        # ── 4. 배경 이미지
        await pg.click('.itab[data-panel="image"]')
        await pg.wait_for_timeout(500)
        await shot("08-image-panel", "이미지 탭")

        await pg.click("#btn-gen-image")
        await pg.wait_for_function(
            "() => { const e = document.getElementById('status');"
            " return e.classList.contains('ok') || e.classList.contains('error'); }",
            timeout=60000)
        await pg.wait_for_timeout(1200)
        await shot("09-image-done", "배경 생성 완료")

        # ── 5. 레이어 편집
        await pg.click('.itab[data-panel="layer"]')
        await pg.wait_for_timeout(400)
        await pg.click("#stage .layer")
        await pg.wait_for_timeout(600)
        await shot("10-layer", "글자 레이어 편집")

        # ── 6. 저장 → DB
        await pg.click("#btn-save")
        await pg.wait_for_timeout(1500)
        await shot("11-save", "저장 · DB 기록")

        await pg.click('.tab[data-view="library"]')
        await pg.wait_for_timeout(900)
        await shot("12-library", "보관함")

        await br.close()
        if errs:
            print("  JS 오류:", errs[:3])

    srv.shutdown()

    # 용량 줄이기 (있으면 WebP 로도 만든다)
    total = sum((OUT / f"{s}.png").stat().st_size for s in shots)
    print(f"\n{len(shots)}장, {total / 1024 / 1024:.2f} MB")
    return shots


if __name__ == "__main__":
    asyncio.run(main())
