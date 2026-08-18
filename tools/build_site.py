"""랜딩페이지를 Vercel용 정적 사이트(site/)로 빌드한다.

로컬 앱(FastAPI)은 Vercel에서 돌릴 수 없다. Playwright/Chromium 용량과
파일 쓰기(프로젝트 JSON·이미지·엑셀 DB) 때문이다. 그래서 공개 배포 대상은
'제품 소개 랜딩페이지'뿐이고, 앱은 각자 PC에서 run.bat 으로 실행한다.

지침서 6.3 규칙에 따라, 앱이 뒤에 없는 공개 랜딩에서는
1차 CTA를 앱 경로(/)가 아니라 실행 안내(#setup)로 보낸다.

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


def build(base_url: str = "") -> None:
    base_url = base_url.rstrip("/")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "static").mkdir(parents=True)
    shutil.copytree(SRC_ASSETS, OUT / "static" / "landing")

    html = SRC_HTML.read_text(encoding="utf-8")

    # 1차 CTA: 앱이 없으므로 실행 안내로 보낸다 (지침서 6.3)
    html = html.replace('href="/" data-ev="click_primary_cta"',
                        'href="#setup" data-ev="click_primary_cta"')
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

    # 남아 있는 앱 경로 링크가 없는지 확인 (있으면 공개 사이트에서 404 난다)
    leftovers = re.findall(r'href="/(?!static/)[^"#][^"]*"', html)
    if leftovers:
        raise SystemExit(f"앱 경로 링크가 남아 있습니다: {sorted(set(leftovers))}")

    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    files = sum(1 for f in OUT.rglob("*") if f.is_file())
    print(f"site/ 빌드 완료: {files}개 파일, {total / 1024 / 1024:.2f} MB")
    print(f"  1차 CTA → #setup (실행 안내)")
    print(f"  OG 이미지 → {base_url or '(상대 경로)'}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "")
