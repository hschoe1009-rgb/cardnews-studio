"""HTML 카드 → PNG. Playwright(Chromium)로 실제 렌더 화면을 캡처합니다."""
from __future__ import annotations

import asyncio
from pathlib import Path

from . import store

VIEWPORT = {"width": store.CANVAS_W, "height": store.CANVAS_H}


class RenderError(RuntimeError):
    pass


async def _shoot(base_url: str, project_id: str, indexes: list[int], out_dir: Path) -> list[Path]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RenderError(
            "playwright가 설치되어 있지 않습니다.\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium"
        ) from exc

    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.launch()
        except Exception as exc:
            raise RenderError(
                "Chromium을 실행하지 못했습니다. `python -m playwright install chromium` 을 실행하세요."
            ) from exc
        try:
            page = await browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
            for index in indexes:
                url = f"{base_url}/render?project={project_id}&index={index}"
                await page.goto(url, wait_until="load")
                await page.wait_for_selector("body[data-ready='1']", timeout=30000)
                stage = await page.query_selector("#stage")
                if stage is None:
                    raise RenderError(f"{index}번 카드 렌더에 실패했습니다.")
                target = out_dir / f"card-{index:02d}.png"
                await stage.screenshot(path=str(target))
                written.append(target)
        finally:
            await browser.close()
    return written


def export_cards(base_url: str, project_id: str, indexes: list[int]) -> list[Path]:
    out_dir = store.project_dir(project_id) / "cards"
    return asyncio.run(_shoot(base_url, project_id, indexes, out_dir))
