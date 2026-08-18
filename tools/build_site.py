"""랜딩페이지를 Vercel용 정적 사이트(site/)로 빌드한다.

FastAPI 서버는 Vercel에서 돌릴 수 없다(Playwright/Chromium 용량, 파일 쓰기).
그래서 앱은 site/app/ 에 '서버 없는 웹앱'으로 따로 빌드한다(tools/build_webapp.py).
랜딩의 1차 CTA는 그 웹앱(/app/)으로 보낸다.

주의: 이 스크립트는 site/ 를 통째로 지우고 다시 만든다.
따라서 build_site.py 를 먼저, build_webapp.py 를 나중에 돌려야 한다.

사용법:
    python tools/build_site.py                      # 상대 경로로 빌드
    python tools/build_site.py https://내도메인.app  # OG 이미지를 절대 URL로
"""
from __future__ import annotations

import io
import re
import shutil
import sys
from pathlib import Path

# 윈도우 콘솔이 cp949 라 한글/기호 출력이 깨지지 않게
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SRC_HTML = ROOT / "app" / "templates" / "landing.html"
SRC_ASSETS = ROOT / "app" / "static" / "landing"
OUT = ROOT / "site"

# 배포 주소. OG 이미지와 canonical 은 크롤러가 절대 URL 을 요구한다.
# 여기에 고정해 두어야 CI 가 인자 없이 빌드해도 같은 결과가 나온다.
# 커스텀 도메인을 붙이면 이 값만 바꾸면 된다.
DEFAULT_BASE_URL = "https://cardnews-studio-seven.vercel.app"

# 랜딩 밖에 있지만 배포본에 실제로 존재하는 경로 (build_webapp.py 가 만든다)
ALLOWED_PATHS = {"/app/"}


def build(base_url: str = "") -> None:
    # 인자를 주면 그것을, 없으면 위 기본값을 쓴다.
    base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "static").mkdir(parents=True)
    shutil.copytree(SRC_ASSETS, OUT / "static" / "landing")

    html = SRC_HTML.read_text(encoding="utf-8")

    # 헤더 로고는 페이지 처음으로
    html = html.replace('<a class="brand" href="/cardnews-studio">',
                        '<a class="brand" href="#top">')
    # canonical 은 사이트 루트
    html = html.replace('<link rel="canonical" href="/cardnews-studio">',
                        f'<link rel="canonical" href="{base_url}/">' if base_url
                        else '<link rel="canonical" href="/">')
    # OG 이미지는 크롤러가 절대 URL을 요구한다
    if base_url:
        html = html.replace('content="/static/landing/og-cardnews-studio.png"',
                            f'content="{base_url}/static/landing/og-cardnews-studio.png"')
    # 앵커 목적지
    html = html.replace('<body>', '<body id="top">', 1)

    # 줄바꿈을 LF 로 고정한다. 윈도우에서 빌드하면 CRLF 가 되어
    # CI(리눅스) 결과와 달라지고, 워크플로가 매번 헛커밋을 만든다.
    (OUT / "index.html").write_text(html, encoding="utf-8", newline="\n")

    # 남은 절대 경로는 site/ 안에 실제 파일이 있어야 한다 (없으면 공개 사이트에서 404)
    leftovers = [h for h in re.findall(r'href="/(?!static/)[^"#][^"]*"', html)
                 if h[6:-1] not in ALLOWED_PATHS]
    if leftovers:
        raise SystemExit(f"앱 경로 링크가 남아 있습니다: {sorted(set(leftovers))}")

    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    files = sum(1 for f in OUT.rglob("*") if f.is_file())
    print(f"site/ 빌드 완료: {files}개 파일, {total / 1024 / 1024:.2f} MB")
    print(f"  1차 CTA → /app/ (웹앱)")
    print(f"  OG 이미지 → {base_url or '(상대 경로)'}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "")
