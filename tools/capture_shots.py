"""실제 앱 화면 캡처. API 호출은 저장된 실데이터로 가로채 비용 0원."""
import asyncio, io, json, sys, threading, time, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, ".")
from pathlib import Path
import uvicorn
from playwright.async_api import async_playwright
from app.main import app

PORT, OUT = 8801, Path("app/static/landing/shots")
BASE = f"http://127.0.0.1:{PORT}"
OUT.mkdir(parents=True, exist_ok=True)

# 이미지가 전부 들어간 프로젝트를 주인공으로
HERO = "260817-202513-집사-옷-냄새가-주는-안정감"
KW = json.loads(Path(f"data/projects/{HERO}/project.json").read_text(encoding="utf-8"))["keywords"]

srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="error"))
threading.Thread(target=srv.run, daemon=True).start()
for _ in range(80):
    try: urllib.request.urlopen(BASE + "/api/settings", timeout=1).read(); break
    except Exception: time.sleep(0.25)


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)

        # 전략 화면: 저장된 실제 앵글 데이터로 응답을 대신한다 (API 과금 없음)
        async def stub(route):
            await route.fulfill(status=200, content_type="application/json",
                                body=json.dumps(KW, ensure_ascii=False))
        await pg.route("**/api/keywords", stub)

        await pg.goto(BASE, wait_until="load")
        await pg.wait_for_timeout(1200)

        # 1) 주제 입력
        await pg.fill("#topic", "집사 옷 냄새가 주는 안정감")
        await pg.screenshot(path=OUT / "01-topic.png")
        print("  01-topic")

        # 2) 전략 앵글 3안
        await pg.click("#btn-keywords")
        await pg.wait_for_selector(".angle", timeout=15000)
        await pg.click(".angle")           # 하나 선택된 상태로
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT / "02-strategy.png")
        print("  02-strategy")

        # 3) 편집 화면 (보관함에서 완성 프로젝트 열기)
        await pg.click('.tab[data-view="library"]')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=OUT / "05-library.png")
        print("  05-library")

        rows = await pg.query_selector_all("#lib-body tr")
        for r in rows:
            if HERO in (await r.get_attribute("data-id") or ""):
                await (await r.query_selector(".open")).click(); break
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUT / "03-editor.png")
        print("  03-editor")

        # 4) 인스펙터 탭들 (오른쪽 패널만 잘라 확대 컷으로)
        insp = await pg.query_selector(".inspector")
        for panel, name in [("layer", "04a-layer"), ("card", "04b-card"),
                            ("image", "04c-image"), ("post", "04d-post")]:
            await pg.click(f'.itab[data-panel="{panel}"]')
            await pg.wait_for_timeout(500)
            await insp.screenshot(path=OUT / f"{name}.png")
            print(f"  {name}")

        # 5) 캔버스만 (편집 중인 카드 확대 컷)
        await pg.click('.itab[data-panel="layer"]')
        await pg.wait_for_timeout(300)
        canvas = await pg.query_selector(".canvas-wrap")
        await canvas.screenshot(path=OUT / "06-canvas.png")
        print("  06-canvas")

        await b.close()
    srv.should_exit = True

asyncio.run(main())
print("\n캡처 완료")
