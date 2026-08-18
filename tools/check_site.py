"""빌드된 site/ 를 배포 전에 검사한다.

깨진 링크나 없는 자산이 있으면 여기서 멈춘다. Vercel 에 올라가고 나서
발견하는 것보다 낫다. 실패하면 종료 코드 1 을 돌려주므로 CI 가 중단된다.

    python tools/check_site.py
"""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
INDEX = SITE / "index.html"

problems: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def ok(msg: str) -> None:
    notes.append(msg)


def main() -> int:
    if not INDEX.exists():
        fail("site/index.html 이 없습니다. tools/build_site.py 를 먼저 실행하세요.")
        report()
        return 1

    raw = INDEX.read_bytes()
    html = raw.decode("utf-8")

    # 1) 줄바꿈이 LF 인가 (OS 마다 달라지면 CI 가 헛커밋을 만든다)
    if b"\r\n" in raw:
        fail("index.html 에 CRLF 가 섞여 있습니다. build_site.py 가 LF 로 쓰는지 확인하세요.")
    else:
        ok("줄바꿈 LF")

    # 2) 참조하는 자산이 실제로 있는가
    refs = set(re.findall(r'(?:src|href)="(/[^"]+)"', html))
    missing = sorted(r for r in refs if not (SITE / r.lstrip("/")).exists())
    if missing:
        fail(f"없는 자산 {len(missing)}개: {missing}")
    else:
        ok(f"참조 자산 {len(refs)}개 모두 존재")

    # 3) 앱 경로로 가는 <a> 링크가 남아 있지 않은가 (공개 사이트엔 앱이 없다).
    #    canonical 같은 <link> 는 대상이 아니다. 사용자가 눌러서 404 를 만나는 것만 본다.
    app_links = sorted({
        h for h in re.findall(r'<a\s[^>]*\shref="(/[^"]*)"', html)
        if not h.startswith("/static/")
    })
    if app_links:
        fail(f"앱 경로 링크가 남아 있습니다(공개 사이트에서 404): {app_links}")
    else:
        ok("앱 경로 링크 없음")

    # 4) 서버 API 를 부르지 않는가
    if "/api/" in html:
        fail("정적 사이트인데 /api/ 참조가 있습니다.")
    else:
        ok("서버 API 참조 없음")

    # 5) 필수 메타
    required = {
        "<title>": "title",
        'name="description"': "meta description",
        'rel="canonical"': "canonical",
        'property="og:title"': "og:title",
        'property="og:image"': "og:image",
        'rel="icon"': "favicon",
    }
    lost = [label for needle, label in required.items() if needle not in html]
    if lost:
        fail(f"메타 태그 누락: {lost}")
    else:
        ok(f"메타 태그 {len(required)}종 존재")

    # 6) 비밀이 섞여 들어가지 않았는가
    secret = re.search(r"sk-ant-api\w+|sk-proj-\w+|gh[pous]_[A-Za-z0-9]{20,}", html)
    if secret:
        fail("빌드 결과에 API 키로 보이는 문자열이 있습니다.")
    else:
        ok("비밀 문자열 없음")

    # 7) FAQ 개수 (화면과 구조화 데이터가 같은 배열에서 나온다)
    js = SITE / "static" / "landing" / "landing.js"
    if js.exists():
        body = js.read_text(encoding="utf-8")
        block = re.search(r"var FAQ = \[(.*?)\n  \];", body, re.S)
        count = len(re.findall(r"^\s{4}\['", block.group(1), re.M)) if block else 0
        if count < 5:
            fail(f"landing.js 의 FAQ 항목이 {count}개뿐입니다. 파싱이 깨졌을 수 있습니다.")
        else:
            ok(f"FAQ {count}문항")
    else:
        fail("landing.js 가 없습니다.")

    # 8) 용량 (모바일 첫 로딩 부담)
    total = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
    mb = total / 1024 / 1024
    if mb > 8:
        fail(f"site/ 용량이 {mb:.1f}MB 입니다. 이미지 최적화를 확인하세요.")
    else:
        ok(f"용량 {mb:.2f}MB")

    report()
    return 1 if problems else 0


def report() -> None:
    for n in notes:
        print(f"  OK   {n}")
    for p in problems:
        print(f"  실패  {p}")
    print()
    print("검사 실패" if problems else "검사 통과")


if __name__ == "__main__":
    sys.exit(main())
