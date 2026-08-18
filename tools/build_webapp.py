"""로컬앱을 서버 없이 도는 웹앱(site/app/)으로 묶는다.

FastAPI 가 하던 일은 webapi.js 가 브라우저에서 대신한다. 그래서 화면과 편집기
코드(index.html / app.js / card.js / card.css)는 거의 그대로 쓴다.

바꾸는 것은 세 가지뿐이다.
  1) 절대 경로 /static/... 을 상대 경로로 (하위 폴더 배포라서)
  2) app.js 앞에 webapi.js 를 끼워 넣기
  3) 로컬 실행 전용 안내를 웹앱 문구로 교체

사용법:
    python tools/build_webapp.py
"""
from __future__ import annotations

import io
import re
import shutil
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "app"

# 배포 위치. Vercel 은 trailingSlash:false 라 /app/ 을 /app 으로 되돌린다.
# 그래서 HTML 안의 경로는 상대가 아니라 뿌리 기준 절대 경로여야 한다.
# (같은 이유로 webapi.js 는 자기 script 주소에서 brand.json 을 찾는다)
BASE = "/app/"

# 웹앱에 필요한 정적 파일만 고른다 (랜딩 자산은 제외)
ASSETS = [
    "app.js", "card.js", "card.css", "style.css", "webapi.js",
    "fonts/Pretendard-Regular.otf", "fonts/Pretendard-Bold.otf",
]


def build() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "static" / "fonts").mkdir(parents=True)

    for rel in ASSETS:
        src = ROOT / "app" / "static" / rel
        dst = OUT / "static" / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith((".js", ".css")):
            # 앱은 뿌리가 아니라 /app/ 아래에 놓인다. 그 위치로 맞춰 준다.
            txt = src.read_text(encoding="utf-8").replace("/static/", BASE + "static/")
            dst.write_text(txt, encoding="utf-8", newline="\n")
        else:
            shutil.copy2(src, dst)

    # 브랜드 정보는 웹앱도 읽는다 (유료 자료인 playbook.md 는 넣지 않는다)
    shutil.copy2(ROOT / "knowledge" / "brand.json", OUT / "brand.json")

    html = (ROOT / "app" / "templates" / "index.html").read_text(encoding="utf-8")

    # 1) 앱 경로에 맞추기
    html = (html.replace('href="/static/', 'href="' + BASE + 'static/')
                        .replace('src="/static/', 'src="' + BASE + 'static/'))

    # 2) webapi.js 를 app.js 보다 먼저 (module 이 아니라 일반 스크립트여야 먼저 실행된다)
    app_tag = '<script type="module" src="' + BASE + 'static/app.js"></script>'
    html = html.replace(
        app_tag,
        '<script src="' + BASE + 'static/webapi.js"></script>' + chr(10) + app_tag)
    if 'webapi.js' not in html:
        raise SystemExit('webapi.js 를 끼워 넣지 못했습니다. index.html 의 script 태그를 확인하세요.')

    # 3) 로컬 안내 문구를 웹앱용으로
    html = html.replace('<a class="logo" href="/cardnews-studio">',
                        '<a class="logo" href="/">')
    html = html.replace(
        '<p class="lead small">API 키는 프로젝트 폴더의 <code>.env</code> 에만 저장되며 외부로 전송되지 않습니다.</p>',
        '<p class="lead small">API 키는 <b>이 브라우저에만</b> 저장됩니다.</p>')
    html = html.replace(
        '<b>API 키는 사용하는 사람마다 각자 입력합니다.</b>',
        '<b>API 키는 쓰는 사람이 각자 넣습니다.</b>')
    html = html.replace(
        '입력한 키는 <b>이 브라우저에만</b> 저장되고 서버에는 남지 않습니다.',
        '서버가 없어 키는 <b>이 브라우저를 벗어나지 않습니다.</b> '
        '생성 요청은 브라우저에서 각 회사 서버로 직접 가고, 사용료는 본인 계정에 청구됩니다.')

    # 서버가 없으니 공용 키 저장 옵션은 뜻이 없다
    html = re.sub(
        r'\s*<label class="checkline">\s*<input type="checkbox" id="s-require".*?</label>',
        "", html, flags=re.S)
    html = re.sub(
        r'\s*<label class="checkline">\s*<input type="checkbox" id="s-share".*?</label>',
        '\n    <input type="checkbox" id="s-require" hidden>'
        '\n    <input type="checkbox" id="s-share" hidden>', html, flags=re.S)

    # 옵시디언 폴더 참조는 로컬 전용
    html = re.sub(
        r'\s*<label class="field"><span>옵시디언 전략 노트 폴더.*?</label>\s*<div id="dirs-status"[^>]*></div>',
        '\n    <textarea id="s-dirs" hidden></textarea>'
        '\n    <div id="dirs-status" hidden></div>', html, flags=re.S)

    html = html.replace("<title>카드뉴스 스튜디오</title>",
                        "<title>카드뉴스 스튜디오 — 웹앱</title>")

    (OUT / "index.html").write_text(html, encoding="utf-8", newline="\n")

    # 참조가 전부 실물을 가리키는지 본다 (경로를 잘못 바꾸면 여기서 걸린다)
    refs = set(re.findall(r'(?:src|href)="(/[^"#]+)"', html))
    for f in OUT.rglob("*"):
        if f.suffix in (".js", ".css"):
            refs |= set(re.findall(r"/app/static/[^\"')]+", f.read_text(encoding="utf-8")))
    dead = sorted(r for r in refs if r != "/" and not (OUT.parent / r.lstrip("/")).exists())
    if dead:
        raise SystemExit(f"실물 없는 참조: {dead}")
    print(f"  참조 {len(refs)}개 모두 실물 확인")

    files = sum(1 for f in OUT.rglob("*") if f.is_file())
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"site/app/ 빌드 완료: {files}개 파일, {size / 1024 / 1024:.2f} MB")
    print("  서버 없이 브라우저에서 전 기능 동작 (키는 각 사용자 부담)")


if __name__ == "__main__":
    build()
